// ============================================================================
// KunYuEcosystem AI Reference v3.3 | fabric/1.20.1/entity/freeform/entity_renderer_client_reg.java | mapping: Yarn | provenance: hand-curated（实体自由代码范式·渲染器与客户端注册）
// ============================================================================
package com.example.mod.client.render;

import com.example.mod.ExampleModClient;
import com.example.mod.entity.ExampleEntity;

import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.MobEntityRenderer;
import net.minecraft.util.Identifier;

/**
 * 实体渲染器 + 客户端注册范式。
 * Fabric 1.20.1 / Yarn。
 *
 * 要点：
 * 1. 渲染器只负责「模型 + 贴图 + 影子半径」，泛型为 <实体, 模型>。
 * 2. EntityModelLayer 常量必须定义在客户端入口类（*Client）里，
 *    ctx.getPart(LAYER) 与 EntityModelLayerRegistry 注册的模型数据一一对应，
 *    漏注册运行期直接崩溃「No model for layer」。
 * 3. 全部渲染注册只能出现在 ClientModInitializer 的 onInitializeClient——
 *    写进 common 入口（ModInitializer）会导致 dedicated server 加载客户端类崩溃。
 * 4. 贴图路径约定 assets/<modid>/textures/entity/<entity_id>.png。
 */
public class ExampleEntityRenderer extends MobEntityRenderer<ExampleEntity, ExampleBipedModel<ExampleEntity>> {

    private static final Identifier TEXTURE =
        new Identifier("examplemod", "textures/entity/example_entity.png");

    public ExampleEntityRenderer(EntityRendererFactory.Context ctx) {
        super(ctx, new ExampleBipedModel<>(ctx.getPart(ExampleModClient.EXAMPLE_MODEL_LAYER)), 0.5f);
    }

    @Override
    public Identifier getTexture(ExampleEntity entity) {
        return TEXTURE;
    }
}

/* ============================================================================
 * 客户端入口（src/main/java/com/example/mod/ExampleModClient.java）
 * —— fabric.mod.json 的 entrypoints.client 必须登记本类全限定名
 * ============================================================================
 *
 * package com.example.mod;
 *
 * import com.example.mod.client.render.ExampleBipedModel;
 * import com.example.mod.client.render.ExampleEntityRenderer;
 * import com.example.mod.entity.ExampleEntity;
 * import net.fabricmc.api.ClientModInitializer;
 * import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
 * import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
 * import net.minecraft.client.render.entity.model.EntityModelLayer;
 * import net.minecraft.util.Identifier;
 *
 * public class ExampleModClient implements ClientModInitializer {
 *
 *     public static final EntityModelLayer EXAMPLE_MODEL_LAYER =
 *         new EntityModelLayer(new Identifier("examplemod", "example_entity"), "main");
 *
 *     @Override
 *     public void onInitializeClient() {
 *         EntityRendererRegistry.register(ExampleEntity.EXAMPLE_ENTITY, ExampleEntityRenderer::new);
 *         EntityModelLayerRegistry.registerModelLayer(
 *             EXAMPLE_MODEL_LAYER, ExampleBipedModel::getTexturedModelData);
 *     }
 * }
 */
