/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.19.2）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.19.2 loaderVersion=0.15.11
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.19.2 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.19.2 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.19.2/gui/simple_screen.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.gui;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
// [版本修正] 1.19.2 无 ButtonWidget.builder / DrawContext
import net.minecraft.client.gui.widget.TextFieldWidget;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.text.Text;
/**
 *  Screen  - Fabric 1.19.2
 *
 *  Screen
 *  HandledScreen Screen  ScreenHandler
 * /
 *
 * :
 * -
 * -
 * - /
 * -
 *
 * :
 * - init()  this.width / this.height
 * -  addDrawableChild()  addDrawable()
 *   addDrawable
 * -  addSelectableChild()
 * - shouldPause()  false
 * - render()  renderBackground()
 *    super.render()
 */
public class ExampleScreen extends Screen {
    private TextFieldWidget textField;
    /**
     *
     * Text
     */
    public ExampleScreen() {
        //  Text.literal() 1.19.2  String
        super(Text.literal(""));
    }
    /**
     *
     *
     * :  init()
     */
    @Override
    protected void init() {
        // ================================================================
        // ================================================================
        // 1.19.2  ButtonWidget.builder()  API
        this.addDrawableChild(
            new ButtonWidget(
                this.width / 2 - 100, this.height / 2 - 10, 200, 20,
                Text.literal(""),
                button -> {
                    System.out.println(": " + textField.getText());
                    this.client.setScreen(null);
                }
            )
        );
        // ================================================================
        // ================================================================
        this.addDrawableChild(
            new ButtonWidget(
                this.width / 2 - 100, this.height / 2 + 20, 200, 20,
                Text.literal(""),
                button -> this.client.setScreen(null)
            )
        );
        // ================================================================
        // ================================================================
        // : textRenderer, x, y, width, height,
        this.textField = new TextFieldWidget(
            this.textRenderer,
            this.width / 2 - 100,  // x
            this.height / 2 - 50,  // y
            200,                    //
            20,                     //
            Text.literal("...")  //
        );
        this.textField.setMaxLength(50);          //
        this.textField.setDrawsBackground(true);   //
        this.textField.active = true;
        // :  addSelectableChild
        // addSelectableChild
        this.addSelectableChild(this.textField);
        //  addDrawableChild
        this.addDrawableChild(this.textField);
    }
    /**
     *
     *
     *
     * @param matrices
     * @param mouseX    x
     * @param mouseY    y
     * @param delta
     */
    @Override
    public void render(MatrixStack matrices, int mouseX, int mouseY, float delta) {
        // 1.
        this.renderBackground(matrices);
        // 2.  super.render()
        //     addDrawableChild/addSelectableChild
        super.render(matrices, mouseX, mouseY, delta);
        // 3.
        // drawCenteredText : matrices, text, x(), y, color
        // [版本修正] 1.19.2 居中文字用静态 Screen.drawCenteredText
        // [版本修正] drawCenteredText 为 DrawableHelper 的 default 方法，经 Screen 继承直接调用
        this.drawCenteredText(
            matrices,
            this.textRenderer,
            this.title,
            this.width / 2,
            20,
            0xFFFFFF   //
        );
        // 4.

        this.textRenderer.draw(
            matrices,
            Text.literal(":"),
            this.width / 2 - 100,
            this.height / 2 - 65,
            0xAAAAAA   //
        );
    }
    /**
     *
     * - true:
     * - false:
     */
    @Override
    public boolean shouldPause() {
        return false;
    }
    /**
     *
     *  Esc
     */
    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (this.textField.isActive() && this.textField.keyPressed(keyCode, scanCode, modifiers)) {
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }
}
/**
 * ================================================================
 *  Screen
 * ================================================================
 * :
 *
 *   MinecraftClient.getInstance().setScreen(new ExampleScreen());
 *
 * :
 *
 */
