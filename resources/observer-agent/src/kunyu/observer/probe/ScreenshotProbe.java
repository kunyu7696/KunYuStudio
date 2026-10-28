package kunyu.observer.probe;

import javax.imageio.ImageIO;
import java.awt.GraphicsDevice;
import java.awt.GraphicsEnvironment;
import java.awt.Rectangle;
import java.awt.Robot;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;

/**
 * v1 截图兜底：java.awt.Robot 截主显示器整屏。
 *
 * <p>与旧 Fabric mod（渲染线程 TAIL 读帧缓冲 glReadPixels）的差异：
 * Robot 截的是整屏而非游戏窗口，可能包含桌面其它内容；headless、
 * 远程桌面断开、屏保锁屏等场景会失败或得到黑屏——此时返回 500，
 * harness 按三态契约转 inconclusive，不会误判为验收失败。</p>
 *
 * <p>后续迭代：反射调用 MC 自身截图管线（ScreenshotRecorder / NativeImage）
 * 读帧缓冲，恢复窗口级精准抓帧（需解决 render TAIL 时机问题，见批 3）。</p>
 */
public final class ScreenshotProbe {
    private ScreenshotProbe() {
    }

    public static byte[] capturePng() throws Exception {
        if (GraphicsEnvironment.isHeadless()) {
            throw new IllegalStateException("headless 环境，Robot 不可用");
        }
        GraphicsDevice device = GraphicsEnvironment.getLocalGraphicsEnvironment().getDefaultScreenDevice();
        Rectangle bounds = device.getDefaultConfiguration().getBounds();
        Robot robot = new Robot(device);
        BufferedImage image = robot.createScreenCapture(bounds);
        ByteArrayOutputStream out = new ByteArrayOutputStream(1 << 16);
        if (!ImageIO.write(image, "png", out)) {
            throw new IllegalStateException("ImageIO 无 PNG writer");
        }
        return out.toByteArray();
    }
}
