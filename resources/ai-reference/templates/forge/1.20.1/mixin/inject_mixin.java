// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.20.1/mixin/inject_mixin.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.mixin;

import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * @Inject Mixin 示例（Forge 1.20.1）。
 * Forge 同样使用 SpongePowered Mixin；method 直接写 Mojang 官方映射方法名（无 SRG 前缀）。
 * @At 常用注入点：HEAD / RETURN / TAIL / INVOKE；有返回值的方法用 CallbackInfoReturnable。
 * 注册：把 mixin_config.json（examplemod.mixins.json）在 mods.toml 中声明。
 */
@Mixin(Minecraft.class)
public class ExampleInjectMixin {

    @Inject(method = "tick", at = @At("HEAD"), cancellable = true)
    private void onTickStart(CallbackInfo ci) {
        // 每 tick 开始前调用；ci.cancel() 可跳过原逻辑（建议仅在 HEAD 使用）
    }

    @Inject(method = "tick", at = @At("TAIL"))
    private void onTickEnd(CallbackInfo ci) {
        // 每 tick 结束后调用
    }

    @Inject(method = "getFps", at = @At("RETURN"), cancellable = true)
    private void onGetFps(CallbackInfoReturnable<Integer> cir) {
        // cir.setReturnValue(...) 可替换返回值；cir.getReturnValue() 读原值
    }
}
