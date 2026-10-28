// ============================================================================
// KunYuEcosystem AI Reference v3.3 | fabric/1.20.1/entity/freeform/biped_model_extra_cube.java | mapping: Yarn | provenance: hand-curated（实体自由代码范式·人形模型追加部件）
// ============================================================================
package com.example.mod.client.render;

import net.minecraft.client.model.Dilation;
import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelPartData;
import net.minecraft.client.model.ModelTransform;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.entity.model.BipedEntityModel;
import net.minecraft.client.render.entity.model.EntityModelPartNames;
import net.minecraft.entity.LivingEntity;

/**
 * 人形（Biped）模型 + 追加自定义部件范式（示例：背部赃物袋）。
 * Fabric 1.20.1 / Yarn。
 *
 * 要点：
 * 1. 从 BipedEntityModel.getModelData(Dilation.NONE, 0.0f) 拿到标准人形骨架
 *    （head/hat/body/左右臂/左右腿），再向指定部件 addChild 追加自定义 cube——
 *    白得 Biped 自带的人形走路/挥臂动画（setAngles 已由父类实现）。
 * 2. 追加部件的 uv 必须落在贴图画布内（本例 64×64 人形皮肤布局，uv(40,16)
 *    起一块 6×6×4 的盒子），自建皮肤时按实际画布调整。
 * 3. 追加部件挂到 body 下会随躯干联动；挂到 head/arm 同理，按语义选择父部件。
 * 4. 渲染层经 EntityModelLayerRegistry 注册本类的 getTexturedModelData，
 *    纹理尺寸必须与 TexturedModelData.of(modelData, 64, 64) 一致。
 */
public class ExampleBipedModel<T extends LivingEntity> extends BipedEntityModel<T> {

    public ExampleBipedModel(ModelPart root) {
        super(root);
    }

    public static TexturedModelData getTexturedModelData() {
        // 标准人形骨架（无膨胀、零 pivot 偏移）
        ModelData modelData = BipedEntityModel.getModelData(Dilation.NONE, 0.0f);
        // 向躯干追加一个 6×6×4 的背部口袋（uv 起点 40,16，64×64 画布内）
        ModelPartData body = modelData.getRoot().getChild(EntityModelPartNames.BODY);
        body.addChild(
            "loot_sack",
            ModelPartBuilder.create()
                .uv(40, 16)
                .cuboid(-3.0f, 6.0f, 2.5f, 6.0f, 6.0f, 4.0f),
            ModelTransform.pivot(0.0f, 0.0f, 0.0f)
        );
        return TexturedModelData.of(modelData, 64, 64);
    }
}
