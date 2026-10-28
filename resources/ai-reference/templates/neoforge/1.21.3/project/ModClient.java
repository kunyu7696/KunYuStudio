/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.3）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.3 loaderVersion=21.3.0-beta
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.3 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.3 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.3/project/ModClient.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod;

import com.example.examplemod.client.render.ExampleEntityRenderer;
import com.example.examplemod.entity.ModEntities;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.EntityRenderersEvent;

/**
 * 客户端专属注册示例（NeoForge 1.21.3）。
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
