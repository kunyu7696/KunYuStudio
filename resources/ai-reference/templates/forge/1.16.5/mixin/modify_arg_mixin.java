/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/mixin/modify_arg_mixin.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.mixin;

import net.minecraft.client.gui.screen.TitleScreen; // 1.16.5 标题界面：net.minecraft.client.gui.screen.TitleScreen
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

/**
 * @ModifyArg Mixin 示例（Forge 1.16.5，Mojmap）。
 * 用途：拦截方法体内某一次调用的单个参数并替换。
 * 1.16.5 TitleScreen.render 中闪烁标语通过 AbstractGui 静态助手绘制：
 *   drawCenteredString(matrixStack, fontRenderer, splash, x, y, color)
 * target 需写 JVM 描述符（Mojmap 类名，静态方法所属类是 AbstractGui）：
 *   Lnet/minecraft/client/gui/AbstractGui;drawCenteredString(
 *       Lcom/mojang/blaze3d/matrix/MatrixStack;
 *       Lnet/minecraft/client/gui/FontRenderer;Ljava/lang/String;III)V
 * 静态调用参数从 0 起包含全部实参：matrixStack=0, font=1, text=2, x=3, y=4, color=5。
 * （GuiGraphics.drawCenteredString 实例调用风格是 1.19.4+ 的写法，勿混入。）
 */
@Mixin(TitleScreen.class)
public class ExampleModifyArgMixin {

    @ModifyArg(
            method = "render",
            at = @At(
                    value = "INVOKE",
                    target = "Lnet/minecraft/client/gui/AbstractGui;drawCenteredString(Lcom/mojang/blaze3d/matrix/MatrixStack;Lnet/minecraft/client/gui/FontRenderer;Ljava/lang/String;III)V"
            ),
            index = 5   // 颜色参数（静态调用：matrixStack=0 ... color=5）
    )
    private int modifySplashColor(int originalColor) {
        return 0xFF5555; // 改成红色
    }
}
