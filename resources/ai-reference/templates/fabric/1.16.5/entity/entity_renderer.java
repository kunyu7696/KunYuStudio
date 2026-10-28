/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.16.5）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.16.5 loaderVersion=0.14.0
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.16.5 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.16.5 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.16.5/entity/entity_renderer.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.client.render;
import com.example.mod.entity.ExampleEntity;
// [版本修正] 1.16.5 无 EntityRendererFactory/EntityModelLayer（1.17+ 才有）；
// 渲染器构造吃 EntityRenderDispatcher，注册走 rendereregistry.v1.EntityRendererRegistry
import net.minecraft.client.render.entity.EntityRenderDispatcher;
import net.minecraft.client.render.entity.EntityRenderer;
import net.minecraft.client.render.entity.model.EntityModel;
import net.minecraft.util.Identifier;
/**
 *  - Fabric 1.16.5
 *
 *
 * 1.  EntityRenderer
 * 2.  EntityRendererRegistry
 * 3. EntityModel
 *
 * :
 * - EntityRenderer ClientModInitializer
 * - EntityRendererFactory.Context
 * - getTexture()
 * -  EntityModelLayerRegistry
 * -
 *
 * :
 *   EntityRendererRegistry.register(ExampleEntity.EXAMPLE_ENTITY, ExampleEntityRenderer::new);
 *
 * :
 *   EntityModelLayerRegistry.registerModelLayer(ExampleEntityModel.LAYER_LOCATION, ExampleEntityModel::getTexturedModelData);
 */
public class ExampleEntityRenderer extends EntityRenderer<ExampleEntity> {
    //  EntityModel  ExampleEntityModel
    private final EntityModel<ExampleEntity> model;
    /**
     *
     * EntityRendererFactory.Context  Fabric
     *
     *
     * @param ctx
     */
    // [版本修正] 1.16.5 EntityRenderer 构造为 (EntityRenderDispatcher)
    public ExampleEntityRenderer(EntityRenderDispatcher dispatcher) {
        super(dispatcher);
        // 1.16.5 模型直接 new（无 ModelLayer 烘焙机制）
        this.model = new ExampleEntityModel<>();
        // 0.0~1.00.5
        this.shadowRadius = 0.5f;
    }
    /**
     *
     * : mod_id:textures/entity/xxx.png
     * : src/main/resources/assets/examplemod/textures/entity/example_entity.png
     *
     * @param entity
     * @return
     */
    @Override
    public Identifier getTexture(ExampleEntity entity) {
        return new Identifier("examplemod", "textures/entity/example_entity.png");
    }
}
/**
 * ================================================================
 *  ClientModInitializer
 * ================================================================
 *
 * import net.fabricmc.fabric.api.client.rendereregistry.v1.EntityRendererRegistry;
 *
 * public class ExampleModClient implements ClientModInitializer {
 *
 *     @Override
 *     public void onInitializeClient() {
 *         //
 *         // [版本修正] 1.16.5 用 rendereregistry.v1，Factory.create(dispatcher, context)
 *         EntityRendererRegistry.INSTANCE.register(
 *             ExampleEntity.EXAMPLE_ENTITY,
 *             (dispatcher, context) -> new ExampleEntityRenderer(dispatcher)
 *         );
 *     }
 * }
 */
