// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.20.1/entity/entity_renderer.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.client.render;
import com.example.mod.entity.ExampleEntity;
import net.minecraft.client.render.entity.EntityRenderer;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.model.EntityModel;
import net.minecraft.client.render.entity.model.EntityModelLayer;
import net.minecraft.util.Identifier;
/**
 *  - Fabric 1.20.1
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
    public ExampleEntityRenderer(EntityRendererFactory.Context ctx) {

        super(ctx);
        //  ctx.getPart()
        //  EntityModelLayerRegistry
        this.model = new ExampleEntityModel<>(ctx.getPart(ExampleEntityModel.LAYER_LOCATION));
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
 * import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
 * import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
 *
 * public class ExampleModClient implements ClientModInitializer {
 *
 *     @Override
 *     public void onInitializeClient() {
 *         //
 *         EntityRendererRegistry.register(
 *             ExampleEntity.EXAMPLE_ENTITY,
 *             ExampleEntityRenderer::new
 *         );
 *
 *         //
 *         EntityModelLayerRegistry.registerModelLayer(
 *             ExampleEntityModel.LAYER_LOCATION,
 *             ExampleEntityModel::getTexturedModelData
 *         );
 *     }
 * }
 */
