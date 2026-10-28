/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.21.4）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.21.4 loaderVersion=0.16.14
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.4 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.4 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.21.4/gui/simple_screen.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.gui;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.gui.widget.TextFieldWidget;
// [版本修正] 1.20+ GUI 全面 DrawContext 化，MatrixStack 不再用于 Screen
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;
/**
 *  Screen  - Fabric 1.21.4
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
        //  Text.literal() 1.21.4  String
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
        // 1.21.4  ButtonWidget.builder()  API
        this.addDrawableChild(
            ButtonWidget.builder(
                Text.literal(""),  //
                button -> {
                    // :
                    //  ClientPlayNetworking

                    System.out.println(": " + textField.getText());
                    this.client.setScreen(null);
                }
            )
            // : x, y, width, height
            .dimensions(this.width / 2 - 100, this.height / 2 - 10, 200, 20)
            .build()
        );
        // ================================================================
        // ================================================================
        this.addDrawableChild(
            ButtonWidget.builder(
                Text.literal(""),
                button -> this.client.setScreen(null)  //
            )
            .dimensions(this.width / 2 - 100, this.height / 2 + 20, 200, 20)
            .build()
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
    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        // 1.
        this.renderBackground(context);
        // 2.  super.render()
        super.render(context, mouseX, mouseY, delta);
        // 3. [版本修正] 1.20+ 居中文字用 DrawContext.drawCenteredTextWithShadow
        context.drawCenteredTextWithShadow(
            this.textRenderer,
            this.title,
            this.width / 2,
            20,
            0xFFFFFF   //
        );
        // 4.
        context.drawText(
            this.textRenderer,
            Text.literal(":"),
            this.width / 2 - 100,
            this.height / 2 - 65,
            0xAAAAAA,   //
            false
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
