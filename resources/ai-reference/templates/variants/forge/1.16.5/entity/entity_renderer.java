/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/entity/entity_renderer.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.client.render;

import com.example.examplemod.ModMain;
import com.example.examplemod.entity.ModEntities;
import net.minecraft.client.renderer.entity.EntityRendererManager; // 1.16.5 渲染上下文：EntityRendererManager（1.17+ 改 EntityRendererProvider.Context）
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.client.renderer.entity.model.BipedModel; // 1.16.5 人形模型：BipedModel（HumanoidModel/ModelLayers 是 1.17+ 产物）
import net.minecraft.util.ResourceLocation; // 1.16.5：net.minecraft.util.ResourceLocation（1.17+ 移入 net.minecraft.resources）

/**
 * 实体渲染器（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - 继承 MobRenderer<实体, 模型>，构造器调 super(EntityRendererManager, 模型实例, 影子半径)。
 * - 1.16.5 没有 ModelLayers/bakeLayer：模型直接 new，如 new BipedModel<>(0.0f)。
 * - 贴图：assets/examplemod/textures/entity/example_entity.png，getTextureLocation 返回 ResourceLocation。
 * - 注册：FMLClientSetupEvent.enqueueWork 里
 *   RenderingRegistry.registerEntityRenderingHandler(...)（见 project/ModClient.java）。
 *   EntityRenderersEvent.RegisterRenderers 是 1.17+ 的事件，1.16.5 不存在。
 */
public class ExampleEntityRenderer extends MobRenderer<ModEntities.ExampleEntity, BipedModel<ModEntities.ExampleEntity>> {
    private static final ResourceLocation TEXTURE =
            new ResourceLocation(ModMain.MOD_ID, "textures/entity/example_entity.png");

    public ExampleEntityRenderer(EntityRendererManager renderManager) {
        super(renderManager, new BipedModel<>(0.0f), 0.5f);
    }

    @Override
    public ResourceLocation getTextureLocation(ModEntities.ExampleEntity entity) {
        return TEXTURE;
    }
}
