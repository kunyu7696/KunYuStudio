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
// KunYuEcosystem AI Reference v3.0 | fabric/1.21.5/gui/screen_with_menu.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.gui;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.inventory.Inventory;
import net.minecraft.inventory.SimpleInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.ScreenHandlerType;
import net.minecraft.screen.slot.Slot;
import net.minecraft.util.Identifier;
/**
 * ================================================================
 * GUIScreenHandler + HandledScreen- Fabric 1.21.5
 * ================================================================
 *
 *
 * 1. ExampleScreenHandler -
 * 2. ExampleScreen        -
 *
 * :
 * -  ScreenHandler  syncId
 * -  Packet  syncId
 * -  syncId  ScreenHandlerType  Screen
 * - Screen  ScreenHandler  syncId
 *
 * :
 * - ScreenHandlerType  Registries.SCREEN_HANDLER
 * -
 *   : (int syncId, PlayerInventory)
 *   : (int syncId, PlayerInventory, Inventory)
 * - transferSlotshift+click shift
 * - canUse  true
 * - Slot  0
 */
public class ExampleScreenHandler extends ScreenHandler {
    // ================================================================
    // ScreenHandlerType
    // ================================================================
    //  Registry.register  Registries.SCREEN_HANDLER
    // ScreenHandlerType  ScreenHandlerFactory
    // [版本修正] 1.19.3+ ScreenHandlerType 构造需第二参 FeatureFlags.VANILLA_FEATURES
    public static final ScreenHandlerType<ExampleScreenHandler> EXAMPLE_SCREEN_HANDLER =
        Registry.register(
            Registries.SCREEN_HANDLER,
            new Identifier("examplemod", "example_gui"),
            new ScreenHandlerType<>(ExampleScreenHandler::new, net.minecraft.resource.featuretoggle.FeatureFlags.VANILLA_FEATURES)
        );
    //  Inventory
    private final Inventory inventory;
    // ================================================================
    // ================================================================
    //  ScreenHandlerType  ScreenHandler
    //  syncId  PlayerInventory Inventory
    public ExampleScreenHandler(int syncId, PlayerInventory playerInventory) {
        this(syncId, playerInventory, new SimpleInventory(9));
    }
    // ================================================================
    // ================================================================
    //  Inventory
    public ExampleScreenHandler(int syncId, PlayerInventory playerInventory, Inventory inventory) {
        //  ScreenHandlerType  syncId
        super(EXAMPLE_SCREEN_HANDLER, syncId);
        checkSize(inventory, 9);
        this.inventory = inventory;

        //  Inventory ""
        inventory.onOpen(playerInventory.player);
        // ================================================================
        // ================================================================
        // : inventory, index(), x(), y()
        // : x, y
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 3; j++) {
                // 3x3  (8, 18)
                this.addSlot(new Slot(inventory, j + i * 3, 8 + j * 18, 18 + i * 18));
            }
        }
        // ================================================================
        // ================================================================
        // : 39 = 27
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 9; j++) {
                //  y=66
                this.addSlot(new Slot(playerInventory, 9 + j + i * 9, 8 + j * 18, 66 + i * 18));
            }
        }
        // : 19
        for (int j = 0; j < 9; j++) {
            //  y=124
            this.addSlot(new Slot(playerInventory, j, 8 + j * 18, 124));
        }
    }
    // ================================================================
    // shift+click
    // ================================================================
    //  shift+
    //  ItemStack
    // [版本修正] Yarn 1.21.5+build.1 起抽象方法更名为 quickMove（原 transferSlot）
    @Override
    public ItemStack quickMove(PlayerEntity player, int index) {
        Slot slot = this.slots.get(index);
        if (!slot.hasStack()) {
            return ItemStack.EMPTY;
        }
        ItemStack originalStack = slot.getStack();
        ItemStack copyStack = originalStack.copy();
        // :
        // 0~8: 3x3
        // 9~35:
        // 36~44:
        if (index < 9) {
            if (!this.insertItem(originalStack, 9, 45, true)) {
                return ItemStack.EMPTY;
            }
        } else {
            // /
            if (!this.insertItem(originalStack, 0, 9, false)) {
                return ItemStack.EMPTY;
            }
        }
        if (originalStack.isEmpty()) {
            slot.setStack(ItemStack.EMPTY);
        } else {
            slot.markDirty();
        }
        return copyStack;
    }
    // ================================================================
    // ================================================================

    @Override
    public boolean canUse(PlayerEntity player) {
        //  true
        return this.inventory.canPlayerUse(player);
    }
}
/**
 * ================================================================
 *  Screen HandledScreen
 * ================================================================
 * HandledScreen  ScreenHandler
 *
 */
class ExampleScreen extends net.minecraft.client.gui.screen.ingame.HandledScreen<ExampleScreenHandler> {
    /**
     *  Screen
     * ScreenRegistry.register
     */
    public ExampleScreen(ExampleScreenHandler handler, PlayerInventory inventory, net.minecraft.text.Text title) {
        super(handler, inventory, title);
    }
    @Override
    protected void init() {
        super.init();
        this.backgroundWidth = 176;
        this.backgroundHeight = 166;
        this.titleX = (this.backgroundWidth - this.textRenderer.getWidth(this.title)) / 2;
    }
    /**
     *
     * : src/main/resources/assets/examplemod/textures/gui/example_gui.png
     *  256x256 176x166
     */
    // [版本修正] 1.20+ GUI 全面 DrawContext 化；贴图绘制走 context.drawTexture(Identifier,...)
    @Override
    protected void drawBackground(net.minecraft.client.gui.DrawContext context, float delta, int mouseX, int mouseY) {
        int x = (this.width - this.backgroundWidth) / 2;
        int y = (this.height - this.backgroundHeight) / 2;
        context.drawTexture(
            new Identifier("examplemod", "textures/gui/example_gui.png"),
            x, y, 0, 0, this.backgroundWidth, this.backgroundHeight
        );
    }
    @Override
    public void render(net.minecraft.client.gui.DrawContext context, int mouseX, int mouseY, float delta) {
        this.renderBackground(context);
        super.render(context, mouseX, mouseY, delta);
        this.drawMouseoverTooltip(context, mouseX, mouseY);
    }
}
/**
 * ================================================================
 *
 * ================================================================
 * ScreenHandlerType ModInitializer:
 *   // ExampleScreenHandler.EXAMPLE_SCREEN_HANDLER
 *
 * Screen ClientModInitializer:
 *
 *   import net.fabricmc.fabric.api.client.screen.v1.ScreenRegistry;
 *
 *   ScreenRegistry.register(
 *       ExampleScreenHandler.EXAMPLE_SCREEN_HANDLER,
 *       ExampleScreen::new

 *   );
 *
 * ================================================================
 *  GUI  BlockEntity  Item
 * ================================================================
 *
 *   player.openHandledScreen(new SimpleNamedScreenHandlerFactory(
 *       (syncId, playerInventory, player) -> new ExampleScreenHandler(syncId, playerInventory, blockInventory),
 *       Text.literal("")
 *   ));
 */
