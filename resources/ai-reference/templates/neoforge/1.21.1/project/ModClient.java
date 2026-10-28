// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.1/project/ModClient.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod;

import com.example.examplemod.client.render.ExampleEntityRenderer;
import com.example.examplemod.entity.ModEntities;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;

/**
 * 客户端专属注册示例（NeoForge 1.21.1）。
 * NeoForge 没有 client entrypoint：用 @EventBusSubscriber(value = Dist.CLIENT) 把本类
 * 挂到 MOD 总线，仅客户端环境加载；渲染器/屏幕/按键绑定都在这里注册。
 * 注意注解类是 net.neoforged.fml.common.EventBusSubscriber（不同于 Forge 的嵌套注解）。
 */
@EventBusSubscriber(modid = ModMain.MOD_ID, bus = EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
public class ModClient {

    @SubscribeEvent
    public static void onRegisterRenderers(EntityRenderersEvent.RegisterRenderers event) {
        // 实体渲染器（详见 entity/entity_renderer.java）
        event.registerEntityRenderer(ModEntities.EXAMPLE_ENTITY.get(), ExampleEntityRenderer::new);
        // 屏幕注册见 gui/screen_with_menu.java（FMLClientSetupEvent 中 MenuScreens.register）
    }
}
