/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.21.8）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.21.8 loaderVersion=0.19.5
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.8 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.8 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.21.8/mixin/inject_mixin.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.mixin;
import net.minecraft.client.MinecraftClient;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
/**
 * @Inject Mixin  - Fabric 1.21.8

 *
 *  @Inject
 *
 * @Inject :
 * - HEAD, RETURN, TAIL
 * -
 * -  CallbackInfo  CallbackInfoReturnable
 *
 * @At :
 * - "HEAD"
 * - "RETURN"       return
 * - "TAIL"
 * - "INVOKE"       target
 * - "INVOKE_ASSIGN"
 * - "FIELD_ACCESS"
 *
 * :
 * 1.  mixin
 * 2. @Mixin
 * 3.  CallbackInfo
 * 4.  CallbackInfoReturnable<T>  CallbackInfo
 * 5. CallbackInfo.cancel()  RETURN/HEAD
 * 6. CallbackInfoReturnable.setReturnValue()
 */
@Mixin(MinecraftClient.class)
public class ExampleInjectMixin {
    /**
     *  MinecraftClient.tick()
     *
     * @param ci
     *           - ci.cancel():
     *           - : HEAD  cancel
     */
    @Inject(
        method = "tick",           //  SRG
        at = @At("HEAD"),          // :
        cancellable = true         //  cancel  true
    )
    private void onTickStart(CallbackInfo ci) {
        //  tick
        // : method  private
        // :  tick
        // if (someCondition) {
        //     ci.cancel();  //
        // }
    }
    /**
     *  MinecraftClient.tick()
     *  TAIL
     */
    @Inject(
        method = "tick",
        at = @At("TAIL"),
        cancellable = false
    )
    private void onTickEnd(CallbackInfo ci) {
        //  tick
    }
    /**
     *
     *  CallbackInfoReturnable
     *
     * @param cir
     */
    @Inject(
        method = "getCurrentFps",   //
        at = @At("RETURN"),         //
        cancellable = true
    )
    private void onGetCurrentFps(CallbackInfoReturnable<Integer> cir) {
        // :

        // cir.setReturnValue(cir.getReturnValue() * 2);  //
        // cir.cancel();  //
    }
}
