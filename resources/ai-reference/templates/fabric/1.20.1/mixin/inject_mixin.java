// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.20.1/mixin/inject_mixin.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.mixin;
import net.minecraft.client.MinecraftClient;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
/**
 * @Inject Mixin  - Fabric 1.20.1

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
