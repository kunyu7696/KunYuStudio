/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.18.2）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=1.18.2 loaderVersion=40.2.0
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.18.2 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.18.2 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.18.2/mixin/inject_mixin.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.mixin;

import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * @Inject Mixin 示例（Forge 1.18.2）。
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
