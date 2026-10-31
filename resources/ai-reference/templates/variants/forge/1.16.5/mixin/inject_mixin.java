/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/mixin/inject_mixin.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.mixin;

import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * @Inject Mixin 示例（Forge 1.16.5，Mojmap）。
 * Forge 同样使用 SpongePowered Mixin；method 直接写 Mojmap 方法名（无 SRG 前缀）。
 * @At 常用注入点：HEAD / RETURN / TAIL / INVOKE；有返回值的方法用 CallbackInfoReturnable。
 * 注册：把 mixin_config.json（examplemod.mixins.json）在 mods.toml 中声明。
 * 注意：1.16.5 的 Minecraft 主循环方法名是 runTick（与新版一致）；
 *       目标方法签名若与你所用 mappings 不符，以实际反编译结果为准。
 */
@Mixin(Minecraft.class)
public class ExampleInjectMixin {

    @Inject(method = "runTick", at = @At("HEAD"), cancellable = true)
    private void onRunTickStart(CallbackInfo ci) {
        // 每 tick 开始前调用；ci.cancel() 可跳过原逻辑（建议仅在 HEAD 使用）
    }

    @Inject(method = "runTick", at = @At("TAIL"))
    private void onRunTickEnd(CallbackInfo ci) {
        // 每 tick 结束后调用
    }

    @Inject(method = "getRenderPartialTicks", at = @At("RETURN"), cancellable = true)
    private void onGetRenderPartialTicks(CallbackInfoReturnable<Float> cir) {
        // cir.setReturnValue(...) 可替换返回值；cir.getReturnValue() 读原值
    }
}
