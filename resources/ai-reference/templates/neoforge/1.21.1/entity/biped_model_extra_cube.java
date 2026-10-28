// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.1/entity/biped_model_extra_cube.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.client.model;

import net.minecraft.client.model.HumanoidModel;
import net.minecraft.client.model.geom.ModelPart;
import net.minecraft.client.model.geom.PartPose;
import net.minecraft.client.model.geom.builders.CubeDeformation;
import net.minecraft.client.model.geom.builders.CubeListBuilder;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MeshDefinition;
import net.minecraft.client.model.geom.builders.PartDefinition;
import net.minecraft.world.entity.LivingEntity;

/**
 * 人形（Humanoid）模型 + 追加自定义部件范式（示例：背部赃物袋）。
 * NeoForge 1.21.1 / Mojmap。
 *
 * 要点：
 * 1. HumanoidModel.createMesh(CubeDeformation, float) 返回 MeshDefinition，
 *    已含 head/hat/body/左右臂/左右腿，再向指定部件 addOrReplaceChild 追加 cube。
 * 2. 追加部件的 texOffs 必须落在贴图画布内（本例 64×64，texOffs(40,16) 起 6×6×4 盒子）。
 * 3. 追加部件挂到 body 下随躯干联动；按语义选择父部件（head/arm 同理）。
 * 4. 渲染层经 EntityRenderersEvent.RegisterLayerDefinitions 注册 createBodyLayer，
 *    纹理尺寸必须与 LayerDefinition.create(mesh, 64, 64) 一致。
 * 5. 1.21 起 ResourceLocation 构造器私有，注册命名空间时用 fromNamespaceAndPath。
 */
public class ExampleBipedModel<T extends LivingEntity> extends HumanoidModel<T> {

    public ExampleBipedModel(ModelPart root) {
        super(root);
    }

    public static LayerDefinition createBodyLayer() {
        MeshDefinition mesh = HumanoidModel.createMesh(CubeDeformation.NONE, 0.0f);
        PartDefinition body = mesh.getRoot().getChild("body");
        body.addOrReplaceChild("loot_sack",
                CubeListBuilder.create()
                        .texOffs(40, 16)
                        .addBox(-3.0f, 6.0f, 2.5f, 6.0f, 6.0f, 4.0f),
                PartPose.ZERO);
        return LayerDefinition.create(mesh, 64, 64);
    }
}
