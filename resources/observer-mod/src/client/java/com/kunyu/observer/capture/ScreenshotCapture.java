package com.kunyu.observer.capture;

import com.kunyu.observer.KunyuObserverClient;
import com.mojang.blaze3d.platform.GlStateManager;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gl.Framebuffer;
import org.lwjgl.BufferUtils;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL30;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.Base64;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 从主帧缓冲读回当前游戏画面并编码 PNG（1.20.1 Yarn 映射）。
 *
 * <p><b>抓帧时机（关键）：</b>不能用 {@code mc.execute(...)} 投递读像素任务——
 * 该队列在每帧渲染开始前排空，此时读到的是 swapBuffers 之后的 back buffer，
 * 部分 GPU 驱动交换后 back buffer 内容未定义（实测世界内为纯白帧，主菜单偶发正常）。
 * 正确时机与原版截图键一致：在 {@code MinecraftClient.render(boolean)} 执行完毕、
 * swapBuffers 之前抓帧。本类把请求排队到 {@link #PENDING}，由
 * {@code MinecraftClientMixin} 在 render TAIL 调用 {@link #runPendingCapture()}。</p>
 *
 * <p>OpenGL 原点在左下角，写图时逐行垂直翻转。</p>
 */
public final class ScreenshotCapture {
    private ScreenshotCapture() {
    }

    /** 待处理抓帧请求；同一时刻只允许一个（HTTP 护栏已限流，竞争极低）。 */
    private static final AtomicReference<CompletableFuture<byte[]>> PENDING = new AtomicReference<>();

    /**
     * 抓取当前帧并返回 PNG 字节。
     * 可从任意线程调用（HTTP 线程）；抓帧本身由渲染线程在下一帧 render TAIL 完成。
     */
    public static byte[] capturePng() throws Exception {
        CompletableFuture<byte[]> future = new CompletableFuture<>();
        if (!PENDING.compareAndSet(null, future)) {
            throw new IllegalStateException("已有截图请求正在处理");
        }
        try {
            return future.get(5, TimeUnit.SECONDS);
        } finally {
            PENDING.compareAndSet(future, null);
        }
    }

    /** 抓取当前帧并返回 data URL（{@code data:image/png;base64,...}）。 */
    public static String captureDataUrl() throws Exception {
        byte[] png = capturePng();
        return "data:image/png;base64," + Base64.getEncoder().encodeToString(png);
    }

    /**
     * 由 MinecraftClientMixin 在 {@code render(boolean)} TAIL 调用（渲染线程，帧未 swap）。
     * 无待处理请求时直接返回，零开销。
     */
    public static void runPendingCapture() {
        CompletableFuture<byte[]> future = PENDING.getAndSet(null);
        if (future == null) return;
        try {
            future.complete(readFramebufferPng());
        } catch (Throwable t) {
            future.completeExceptionally(t);
        }
    }

    /** 在渲染线程、帧已绘制完毕时读主帧缓冲并编码 PNG。 */
    private static byte[] readFramebufferPng() throws Exception {
        MinecraftClient mc = MinecraftClient.getInstance();
        Framebuffer fb = mc.getFramebuffer();
        int width = fb.textureWidth;
        int height = fb.textureHeight;
        ByteBuffer buffer = BufferUtils.createByteBuffer(width * height * 4);

        // beginRead() 只把颜色纹理绑到采样器（供 shader 采样），并不绑定 FBO 到
        // GL_READ_FRAMEBUFFER。glReadPixels 默认从窗口 FBO 0 读取，而窗口缓冲 alpha
        // 位深通常为 0，读回全 A=0。必须显式绑定游戏 FBO 到 READ_FRAMEBUFFER，
        // 把 READ_BUFFER 切到 COLOR_ATTACHMENT0，读完恢复窗口默认。
        GlStateManager._glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER, fb.fbo);
        GL11.glReadBuffer(GL30.GL_COLOR_ATTACHMENT0);
        GL11.glPixelStorei(GL11.GL_PACK_ALIGNMENT, 4);
        GL11.glPixelStorei(GL11.GL_PACK_ROW_LENGTH, 0);
        GL11.glReadPixels(0, 0, width, height, GL11.GL_RGBA, GL11.GL_UNSIGNED_BYTE, buffer);
        GL11.glReadBuffer(GL11.GL_BACK);
        GlStateManager._glBindFramebuffer(GL30.GL_READ_FRAMEBUFFER, 0);
        buffer.rewind();

        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
        int[] row = new int[width];
        for (int y = 0; y < height; y++) {
            for (int x = 0; x < width; x++) {
                int r = buffer.get() & 0xFF;
                int g = buffer.get() & 0xFF;
                int b = buffer.get() & 0xFF;
                int a = buffer.get() & 0xFF;
                row[x] = (a << 24) | (r << 16) | (g << 8) | b;
            }
            // OpenGL 首行在底部，翻转后写入
            image.getRaster().setDataElements(0, height - 1 - y, width, 1, row);
        }

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (!ImageIO.write(image, "png", out)) {
            throw new IllegalStateException("ImageIO 无 PNG writer");
        }
        byte[] png = out.toByteArray();
        KunyuObserverClient.LOGGER.debug("[kunyu-observer] 帧缓冲抓帧完成 {}x{}（{} 字节）", width, height, png.length);
        return png;
    }
}
