/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.10）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.10 loaderVersion=21.10.64
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.10 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.10 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.10/entity/entity_renderer.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.client.render;

import com.example.examplemod.ModMain;
import com.example.examplemod.entity.ModEntities;
import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.resources.ResourceLocation;

/**
 * 实体渲染器（NeoForge 1.21.10，Mojmap）。
 * 要点：
 * - 继承 MobRenderer<实体, 模型>，构造器调 super(context, model, shadowRadius)。
 * - 1.21 起 ResourceLocation 构造器私有：用 ResourceLocation.fromNamespaceAndPath(namespace, path)。
 * - 贴图：assets/examplemod/textures/entity/example_entity.png。
 * - 注册在 MOD 总线的 EntityRenderersEvent.RegisterRenderers 中完成（见 project/ModClient.java）。
 * - 无自定义模型时可复用原版模型层：ModelLayers.PLAYER / COW / CHICKEN 等。
 */
public class ExampleEntityRenderer extends MobRenderer<ModEntities.ExampleEntity, HumanoidModel<ModEntities.ExampleEntity>> {
    private static final ResourceLocation TEXTURE =
            ResourceLocation.fromNamespaceAndPath(ModMain.MOD_ID, "textures/entity/example_entity.png");

    public ExampleEntityRenderer(EntityRendererProvider.Context context) {
        super(context, new HumanoidModel<>(context.bakeLayer(ModelLayers.PLAYER)), 0.5f);
    }

    @Override
    public ResourceLocation getTextureLocation(ModEntities.ExampleEntity entity) {
        return TEXTURE;
    }
}
