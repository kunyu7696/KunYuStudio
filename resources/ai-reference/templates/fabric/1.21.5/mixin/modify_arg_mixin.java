/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.21.5）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.21.5 loaderVersion=0.16.14
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.5 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.5 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.21.5/mixin/modify_arg_mixin.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.mixin;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.text.Text;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;
/**

 * @ModifyArg Mixin  - Fabric 1.21.5
 *
 *  @ModifyArg
 *
 * @ModifyArg :
 * -
 * -  @Inject @ModifyArg
 * -
 *
 * @ModifyArg :
 * - method:    @ModifyArg
 * - at:         INVOKE
 *   - value:   "INVOKE"
 *   - target:   JVM
 * - index:      0
 * - name:
 *
 * JVM :
 *   Lnet/minecraft/client/font/TextRenderer;drawWithShadow(
 *       Lnet/minecraft/client/util/math/MatrixStack;  <- 0
 *       Lnet/minecraft/text/Text;                      <- 1
 *       F                                              <- 2 (float)
 *       F                                              <- 3 (float)
 *       I                                              <- 4 (int, )
 *   )I                                                 <-  int
 *
 * :
 * 1. target
 * 2.
 * 3.
 * 4. index  0
 * 5.  index  target
 */
@Mixin(TitleScreen.class)
public class ExampleModifyArgMixin {
    /**
     * 1:  TitleScreen  x
     *
     * : TitleScreen.render()  TextRenderer.drawWithShadow()
     * :  3 index=2 x float
     */
    @ModifyArg(
        method = "render",   //
        at = @At(
            value = "INVOKE",
            // target : "L;()"
            target = "Lnet/minecraft/client/font/TextRenderer;drawWithShadow(Lnet/minecraft/client/util/math/MatrixStack;Lnet/minecraft/text/Text;FFI)I"
        ),
        index = 2   //  3 x float 0
    )
    private float modifyTextX(float originalX) {
        // : originalX  x
        // :  x
        return originalX + 10.0f;  //  10
    }
    /**
     * 2:
     *
     *  TextRenderer.drawWithShadow() int
     */
    @ModifyArg(
        method = "render",
        at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/client/font/TextRenderer;drawWithShadow(Lnet/minecraft/client/util/math/MatrixStack;Lnet/minecraft/text/Text;FFI)I"
        ),
        index = 4   //  5 int
    )
    private int modifyTextColor(int originalColor) {
        // : originalColor ARGB
        // :
        return 0xFF0000;  //
    }
    /**

     * 3:  Text
     *
     *  TextRenderer.draw()
     */
    @ModifyArg(
        method = "render",
        at = @At(
            value = "INVOKE",
            // : draw  drawWithShadow
            target = "Lnet/minecraft/client/font/TextRenderer;draw(Lnet/minecraft/client/util/math/MatrixStack;Lnet/minecraft/text/Text;FFI)I"
        ),
        index = 1   //  2 Text
    )
    private Text modifyTextContent(Text originalText) {
        // : originalText
        // :
        return Text.literal("");
    }
}
