// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.1/mixin/modify_arg_mixin.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.mixin;

import net.minecraft.client.gui.screens.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyArg;

/**
 * @ModifyArg Mixin 示例（NeoForge 1.21.1）。
 * 用途：拦截方法体内某一次调用的单个参数并替换。
 * target 需写 JVM 描述符（Mojang 官方映射类名）：
 *   Lnet/minecraft/client/gui/GuiGraphics;drawCenteredString(Lnet/minecraft/client/gui/Font;Lnet/minecraft/network/chat/Component;III)V
 * 参数序号从 0 起：font=0, text=1, x=2, y=3, color=4。
 */
@Mixin(TitleScreen.class)
public class ExampleModifyArgMixin {

    @ModifyArg(
            method = "render",
            at = @At(
                    value = "INVOKE",
                    target = "Lnet/minecraft/client/gui/GuiGraphics;drawCenteredString(Lnet/minecraft/client/gui/Font;Lnet/minecraft/network/chat/Component;III)V"
            ),
            index = 4   // 颜色参数
    )
    private int modifyTitleColor(int originalColor) {
        return 0xFF5555; // 改成红色
    }
}
