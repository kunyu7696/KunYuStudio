/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/gui/screen_with_menu.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.gui;

import com.example.examplemod.ModMain;
import com.mojang.blaze3d.matrix.MatrixStack;
import net.minecraft.client.gui.screen.inventory.ContainerScreen; // 1.16.5 容器屏幕基类：ContainerScreen（AbstractContainerScreen 是 1.17+ 改名）
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.PlayerInventory; // 1.16.5 玩家背包：PlayerInventory（1.17+ 改名 Inventory）
import net.minecraft.inventory.IInventory; // 1.16.5 容器接口：IInventory（1.17+ 改名 Container）
import net.minecraft.inventory.Inventory;  // 默认实现：Inventory(槽数)
import net.minecraft.inventory.container.Container; // 1.16.5 菜单基类：Container（AbstractContainerMenu 是 1.17+ 改名）
import net.minecraft.inventory.container.ContainerType;
import net.minecraft.inventory.container.Slot;
import net.minecraft.item.ItemStack;
import net.minecraft.network.PacketBuffer; // 1.16.5 网络缓冲：PacketBuffer（FriendlyByteBuf 是 1.17+ 改名）
import net.minecraft.util.ResourceLocation;
import net.minecraft.util.text.ITextComponent; // 1.16.5 文本接口：ITextComponent（Component 是 1.17+ 改名）
import net.minecraftforge.common.extensions.IForgeContainerType;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 容器界面（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - 容器类型：IForgeContainerType.create(工厂)，工厂签名 (int id, PlayerInventory inv, PacketBuffer buf)。
 * - 注册表：ForgeRegistries.CONTAINERS（1.17+ 改名 ForgeRegistries.MENU_TYPES）。
 * - 屏幕：ContainerScreen<容器>，实现抽象方法 drawGuiContainerBackgroundLayer 绘制背景贴图；
 *   尺寸字段是 xSize/ySize，左上角是 guiLeft/guiTop（imageWidth/leftPos 是 1.17+ 改名）。
 * - 客户端绑定：FMLClientSetupEvent.enqueueWork 里
 *   net.minecraft.client.gui.ScreenManager.register(ModContainers.EXAMPLE_CONTAINER.get(),
 *   ExampleContainerScreen::new)（MenuScreens.register 是 1.18+ 写法）。
 * - 屏幕类仅客户端可用，实际项目建议放到 client 包并只在客户端环境加载。
 */
public class ModContainers {
    public static final DeferredRegister<ContainerType<?>> CONTAINERS =
            DeferredRegister.create(ForgeRegistries.CONTAINERS, ModMain.MOD_ID);

    public static final RegistryObject<ContainerType<ExampleContainer>> EXAMPLE_CONTAINER =
            CONTAINERS.register("example_container", () -> IForgeContainerType.create(ExampleContainer::new));

    /** 容器（服务端/客户端共用）。 */
    public static class ExampleContainer extends Container {
        private static final int CONTAINER_SIZE = 9;

        /** 网络打开：服务端 openContainer 时由 IForgeContainerType 工厂进入。 */
        public ExampleContainer(int windowId, PlayerInventory playerInventory, PacketBuffer buf) {
            this(windowId, playerInventory, new Inventory(CONTAINER_SIZE));
        }

        /** 直接打开：TileEntity 等持有真实容器时使用。 */
        public ExampleContainer(int windowId, PlayerInventory playerInventory, IInventory inventory) {
            super(ModContainers.EXAMPLE_CONTAINER.get(), windowId);
            checkContainerSize(inventory, CONTAINER_SIZE);
            inventory.startOpen(playerInventory.player);
            // 容器槽位：3x3
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 3; col++) {
                    this.addSlot(new Slot(inventory, col + row * 3, 8 + col * 18, 18 + row * 18));
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

        /** shift 点击转移：1.16.5 方法名 transferStackInSlot（quickMoveStack 是 1.17+ 改名）。 */
        @Override
        public ItemStack transferStackInSlot(PlayerEntity player, int index) {
            // 按需实现转移逻辑
            return ItemStack.EMPTY;
        }

        @Override
        public boolean stillValid(PlayerEntity player) {
            // 实际项目应校验距离，例如 stillValid(this.accessiblePos, player, ModBlocks.XXX.get())
            return true;
        }
    }

    /** 屏幕（仅客户端）。 */
    public static class ExampleContainerScreen extends ContainerScreen<ExampleContainer> {
        private static final ResourceLocation TEXTURE =
                new ResourceLocation(ModMain.MOD_ID, "textures/gui/example_container.png");

        public ExampleContainerScreen(ExampleContainer container, PlayerInventory playerInventory, ITextComponent title) {
            super(container, playerInventory, title);
            this.xSize = 176;   // 背景宽（1.17+ 改名 imageWidth）
            this.ySize = 166;   // 背景高（1.17+ 改名 imageHeight）
        }

        /** ContainerScreen 抽象方法：绘制背景（partialTicks, mouseX, mouseY）。 */
        @Override
        protected void drawGuiContainerBackgroundLayer(MatrixStack matrixStack, float partialTicks, int mouseX, int mouseY) {
            // 默认 blit 假定贴图 256x256
            this.blit(matrixStack, this.guiLeft, this.guiTop, 0, 0, this.xSize, this.ySize);
        }

        @Override
        public void render(MatrixStack matrixStack, int mouseX, int mouseY, float partialTicks) {
            this.renderBackground(matrixStack);
            super.render(matrixStack, mouseX, mouseY, partialTicks);
            this.renderHoveredTooltip(matrixStack, mouseX, mouseY); // 物品悬浮提示
        }
    }
}
