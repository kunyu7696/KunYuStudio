/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/gui/simple_screen.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.gui;

import com.mojang.blaze3d.matrix.MatrixStack; // 1.16.5 渲染栈：MatrixStack（GuiGraphics 是 1.19.4+ 产物）
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.TextFieldWidget; // 1.16.5 输入框：TextFieldWidget（EditBox 是 1.17+ 改名）
import net.minecraft.client.gui.widget.button.Button;
import net.minecraft.util.text.StringTextComponent; // 1.16.5 文本：StringTextComponent（Component.literal 是 1.17+ 写法）

/**
 * 普通屏幕（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - 继承 net.minecraft.client.gui.screen.Screen；控件在 init() 中创建（窗口缩放时会重新调用）。
 * - 1.16.5 render 签名：render(MatrixStack, int mouseX, int mouseY, float partialTicks)；
 *   先 renderBackground 再 super.render。
 * - 按钮构造：new Button(x, y, 宽, 高, ITextComponent, Button.IPressable)
 *   （Button.builder(...) 是 1.19+ 写法）。
 * - 打开方式：Minecraft.getInstance().displayGuiScreen(new ExampleScreen())；
 *   仅客户端可用（setScreen 是 1.17+ 改名）。
 */
public class ExampleScreen extends Screen {
    private TextFieldWidget inputBox;

    public ExampleScreen() {
        super(new StringTextComponent("Example Screen"));
    }

    @Override
    protected void init() {
        // 文本输入框：TextFieldWidget(font, x, y, 宽, 高, 提示文本)
        this.inputBox = new TextFieldWidget(this.font, this.width / 2 - 100, this.height / 2 - 40, 200, 20,
                new StringTextComponent("input"));
        this.inputBox.setMaxLength(50);
        this.addButton(this.inputBox); // 1.16.5 Screen.addButton(Widget)：加入渲染与事件列表

        // 按钮：IPressable 回调内可读取输入并关闭屏幕
        this.addButton(new Button(this.width / 2 - 100, this.height / 2, 200, 20,
                new StringTextComponent("OK"), button -> {
                    System.out.println("input = " + this.inputBox.getText()); // 1.17+ 改名 getValue()
                    this.onClose(); // 关闭屏幕
                }));
    }

    @Override
    public void render(MatrixStack matrixStack, int mouseX, int mouseY, float partialTicks) {
        this.renderBackground(matrixStack);
        super.render(matrixStack, mouseX, mouseY, partialTicks);
        // AbstractGui 静态助手：drawCenteredString(MatrixStack, FontRenderer, ITextComponent, x, y, color)
        drawCenteredString(matrixStack, this.font, this.title, this.width / 2, 20, 0xFFFFFF);
    }

    @Override
    public boolean isPauseScreen() {
        return false; // 单人游戏中打开此界面不暂停
    }
}
