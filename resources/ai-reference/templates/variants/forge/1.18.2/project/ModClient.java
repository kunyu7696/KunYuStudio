/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.18.2）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=1.18.2 loaderVersion=40.2.0
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.18.2 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.18.2 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.18.2/project/ModClient.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod;

import com.example.examplemod.client.render.ExampleEntityRenderer;
import com.example.examplemod.entity.ModEntities;
import net.minecraft.client.renderer.entity.EntityRenderers; // 版本差异：EntityRenderersEvent 是 1.19+ 的类，1.18.2 在 FMLClientSetupEvent 中用 EntityRenderers.register
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent;

/**
 * 客户端专属注册示例（1.18.2）。
 * Forge 没有 client entrypoint：用 @Mod.EventBusSubscriber(value = Dist.CLIENT) 把本类
 * 挂到 MOD 总线，仅客户端环境加载；渲染器/屏幕/按键绑定都在这里注册。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
public class ModClient {

    @SubscribeEvent
    public static void onClientSetup(FMLClientSetupEvent event) {
        // 实体渲染器（详见 entity/entity_renderer.java）；enqueueWork 避免并行初始化问题
        event.enqueueWork(() ->
                EntityRenderers.register(ModEntities.EXAMPLE_ENTITY.get(), ExampleEntityRenderer::new));
        // 屏幕注册见 gui/screen_with_menu.java（同在 FMLClientSetupEvent 中 MenuScreens.register）
    }
}
