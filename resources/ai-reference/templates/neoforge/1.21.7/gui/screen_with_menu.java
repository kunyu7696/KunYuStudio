/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.7）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.7 loaderVersion=21.7.25
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.7 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.7 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.7/gui/screen_with_menu.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.gui;

import com.example.examplemod.ModMain;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.Container;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.common.extensions.IMenuTypeExtension;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 容器界面（NeoForge 1.21.7）。
 * 要点：
 * - 菜单：MenuType 用 IMenuTypeExtension.create(工厂) 创建，工厂签名 (int id, Inventory inv, FriendlyByteBuf buf)。
 * - 屏幕：AbstractContainerScreen<Menu>，实现 renderBg 绘制背景贴图。
 * - 客户端注册屏幕：FMLClientSetupEvent（MOD 总线）中
 *   MenuScreens.register(ModMenus.EXAMPLE_MENU.get(), ModMenus.ExampleMenuScreen::new);
 * - 屏幕类仅客户端可用，实际项目建议放到 client 包并只在客户端环境加载。
 */
public class ModMenus {
    public static final DeferredRegister<MenuType<?>> MENUS =
            DeferredRegister.create(Registries.MENU, ModMain.MOD_ID);

    public static final DeferredHolder<MenuType<?>, MenuType<ExampleMenu>> EXAMPLE_MENU =
            MENUS.register("example_menu", () -> IMenuTypeExtension.create(ExampleMenu::new));

    /** 菜单（服务端/客户端共用）。 */
    public static class ExampleMenu extends AbstractContainerMenu {
        private static final int CONTAINER_SIZE = 9;

        /** 网络打开：服务端 openMenu 时由 IMenuTypeExtension 工厂进入。 */
        public ExampleMenu(int containerId, Inventory playerInventory, FriendlyByteBuf buf) {
            this(containerId, playerInventory, new SimpleContainer(CONTAINER_SIZE));
        }

        /** 直接打开：BlockEntity 等持有真实容器时使用。 */
        public ExampleMenu(int containerId, Inventory playerInventory, Container container) {
            super(ModMenus.EXAMPLE_MENU.get(), containerId);
            checkContainerSize(container, CONTAINER_SIZE);
            container.startOpen(playerInventory.player);
            // 容器槽位：3x3
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 3; col++) {
                    this.addSlot(new Slot(container, col + row * 3, 8 + col * 18, 18 + row * 18));
                }
            }
            // 玩家背包 3x9 + 快捷栏
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 9; col++) {
                    this.addSlot(new Slot(playerInventory, col + row * 9 + 9, 8 + col * 18, 84 + row * 18));
                }
            }
            for (int col = 0; col < 9; col++) {
                this.addSlot(new Slot(playerInventory, col, 8 + col * 18, 142));
            }
        }

        @Override
        public ItemStack quickMoveStack(Player player, int index) {
            // 按需实现 shift 点击转移逻辑
            return ItemStack.EMPTY;
        }

        @Override
        public boolean stillValid(Player player) {
            // 实际项目应校验距离：player.distanceToSqr(...) <= 64
            return true;
        }
    }

    /** 屏幕（仅客户端）。 */
    public static class ExampleMenuScreen extends AbstractContainerScreen<ExampleMenu> {
        private static final ResourceLocation TEXTURE =
                ResourceLocation.fromNamespaceAndPath(ModMain.MOD_ID, "textures/gui/example_menu.png");

        public ExampleMenuScreen(ExampleMenu menu, Inventory playerInventory, Component title) {
            super(menu, playerInventory, title);
            this.imageWidth = 176;   // 背景宽
            this.imageHeight = 166;  // 背景高
        }

        @Override
        protected void renderBg(GuiGraphics guiGraphics, float partialTick, int mouseX, int mouseY) {
            guiGraphics.blit(TEXTURE, this.leftPos, this.topPos, 0, 0, this.imageWidth, this.imageHeight);
        }

        @Override
        public void render(GuiGraphics guiGraphics, int mouseX, int mouseY, float partialTick) {
            this.renderBackground(guiGraphics);
            super.render(guiGraphics, mouseX, mouseY, partialTick);
            this.renderTooltip(guiGraphics, mouseX, mouseY);
        }
    }
}
