package com.kunyu.observer.mixin;

import com.kunyu.observer.capture.ScreenshotCapture;
import net.minecraft.client.MinecraftClient;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * 在 {@code MinecraftClient.render(boolean)} TAIL（帧已绘制、swapBuffers 之前）
 * 处理排队中的截图请求。这是与原版 F2 截图等价的抓帧时机；在其它时机 glReadPixels
 * 可能读到交换后未定义的 back buffer（世界内白屏）。
 */
@Mixin(MinecraftClient.class)
public class MinecraftClientMixin {
    @Inject(method = "render(Z)V", at = @At("TAIL"))
    private void kunyu$captureFrame(boolean tick, CallbackInfo ci) {
        ScreenshotCapture.runPendingCapture();
    }
}
