// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.20.1/entity/entity_renderer.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
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
 * 实体渲染器（Forge 1.20.1，Mojmap）。
 * 要点：
 * - 继承 MobRenderer<实体, 模型>，构造器调 super(context, model, shadowRadius)。
 * - 贴图：assets/examplemod/textures/entity/example_entity.png，getTextureLocation 返回 ResourceLocation。
 * - 注册在 MOD 总线的 EntityRenderersEvent.RegisterRenderers 中完成（见 project/ModClient.java）。
 * - 无自定义模型时可复用原版模型层：ModelLayers.PLAYER / COW / CHICKEN 等。
 */
public class ExampleEntityRenderer extends MobRenderer<ModEntities.ExampleEntity, HumanoidModel<ModEntities.ExampleEntity>> {
    private static final ResourceLocation TEXTURE =
            new ResourceLocation(ModMain.MOD_ID, "textures/entity/example_entity.png");

    public ExampleEntityRenderer(EntityRendererProvider.Context context) {
        super(context, new HumanoidModel<>(context.bakeLayer(ModelLayers.PLAYER)), 0.5f);
    }

    @Override
    public ResourceLocation getTextureLocation(ModEntities.ExampleEntity entity) {
        return TEXTURE;
    }
}
