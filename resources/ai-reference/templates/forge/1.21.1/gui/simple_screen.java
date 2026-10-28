/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.21.1）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=1.21.1 loaderVersion=52.0.57
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.1 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.1 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.21.1/gui/simple_screen.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.gui;

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * 普通屏幕（Forge 1.21.1，Mojmap）。
 * 要点：
 * - 继承 net.minecraft.client.gui.screens.Screen；控件在 init() 中创建（窗口缩放时会重新调用）。
 * - 1.21.1 render 签名：render(GuiGraphics, int, int, float)；先 renderBackground 再 super.render。
 * - 打开方式：Minecraft.getInstance().setScreen(new ExampleScreen())；仅客户端可用。
 */
public class ExampleScreen extends Screen {
    private EditBox inputBox;

    public ExampleScreen() {
        super(Component.literal("Example Screen"));
    }

    @Override
    protected void init() {
        // 文本输入框
        this.inputBox = new EditBox(this.font, this.width / 2 - 100, this.height / 2 - 40, 200, 20,
                Component.literal("input"));
        this.inputBox.setMaxLength(50);
        this.addRenderableWidget(this.inputBox);

        // 按钮：Button.builder(文本, 回调).bounds(x, y, 宽, 高).build()
        this.addRenderableWidget(Button.builder(Component.literal("OK"), button -> {
                    System.out.println("input = " + this.inputBox.getValue());
                    this.onClose(); // 关闭屏幕（等价 Fabric 的 close()）
                })
                .bounds(this.width / 2 - 100, this.height / 2, 200, 20)
                .build());
    }

    @Override
    public void render(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
        this.renderBackground(guiGraphics);
        super.render(guiGraphics, mouseX, mouseY, partialTick);
        guiGraphics.drawCenteredString(this.font, this.title, this.width / 2, 20, 0xFFFFFF);
    }

    @Override
    public boolean isPauseScreen() {
        return false; // 单人游戏中打开此界面不暂停
    }
}
