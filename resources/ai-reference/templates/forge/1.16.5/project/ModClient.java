/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/project/ModClient.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod;

import com.example.examplemod.client.render.ExampleEntityRenderer;
import com.example.examplemod.entity.ModEntities;
import com.example.examplemod.gui.ModContainers;
import net.minecraft.client.gui.ScreenManager; // 1.16.5 屏幕绑定：ScreenManager.register（MenuScreens 是 1.18+ 产物）
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.client.registry.RenderingRegistry; // 1.16.5 渲染器注册：RenderingRegistry（EntityRenderersEvent 是 1.17+ 产物）
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent;

/**
 * 客户端专属注册示例（1.16.5）。
 * Forge 没有 client entrypoint：用 @Mod.EventBusSubscriber(value = Dist.CLIENT) 把本类
 * 挂到 MOD 总线，仅客户端环境加载；渲染器/屏幕/按键绑定都在这里注册。
 * 两个注册表都不是线程安全结构，必须放进 FMLClientSetupEvent.enqueueWork。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
public class ModClient {

    @SubscribeEvent
    public static void onClientSetup(FMLClientSetupEvent event) {
        event.enqueueWork(() -> {
            // 实体渲染器（详见 entity/entity_renderer.java）
            RenderingRegistry.registerEntityRenderingHandler(
                    ModEntities.EXAMPLE_ENTITY.get(), ExampleEntityRenderer::new);
            // 容器屏幕绑定（详见 gui/screen_with_menu.java）
            ScreenManager.register(
                    ModContainers.EXAMPLE_CONTAINER.get(), ModContainers.ExampleContainerScreen::new);
        });
    }
}
