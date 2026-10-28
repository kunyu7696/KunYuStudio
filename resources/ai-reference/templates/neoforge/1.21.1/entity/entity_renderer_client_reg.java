// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.1/entity/entity_renderer_client_reg.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.client.render;

import com.example.examplemod.ModMain;
import com.example.examplemod.client.model.ExampleBipedModel;
import com.example.examplemod.entity.ModEntities;

import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.resources.ResourceLocation;

/**
 * 实体渲染器 + 客户端注册范式。
 * NeoForge 1.21.1 / Mojmap。
 *
 * 要点：
 * 1. 渲染器只负责「模型 + 贴图 + 影子半径」，泛型为 <实体, 模型>。
 * 2. 模型层 ModelLayerLocation 与渲染器必须成对注册，漏注册模型层运行期直接崩溃。
 * 3. 渲染注册只走 MOD 总线的 EntityRenderersEvent，禁止写进通用初始化代码。
 * 4. 1.21 起 ResourceLocation 用 fromNamespaceAndPath。
 */
public class ExampleEntityRenderer extends MobRenderer<ModEntities.ExampleEntity, ExampleBipedModel<ModEntities.ExampleEntity>> {

    private static final ResourceLocation TEXTURE =
            ResourceLocation.fromNamespaceAndPath(ModMain.MOD_ID, "textures/entity/example_entity.png");

    public ExampleEntityRenderer(EntityRendererProvider.Context context) {
        super(context, new ExampleBipedModel<>(context.bakeLayer(ModClient.EXAMPLE_LAYER)), 0.5f);
    }

    @Override
    public ResourceLocation getTextureLocation(ModEntities.ExampleEntity entity) {
        return TEXTURE;
    }
}

/* ============================================================================
 * 客户端注册（src/main/java/com/example/examplemod/client/ModClient.java）
 * —— 与 project/ModClient.java 的骨架合并，MOD 总线事件
 * ============================================================================
 *
 * package com.example.examplemod.client;
 *
 * import com.example.examplemod.ModMain;
 * import com.example.examplemod.client.model.ExampleBipedModel;
 * import com.example.examplemod.client.render.ExampleEntityRenderer;
 * import com.example.examplemod.entity.ModEntities;
 * import net.minecraft.client.model.geom.ModelLayerLocation;
 * import net.minecraft.resources.ResourceLocation;
 * import net.neoforged.bus.api.SubscribeEvent;
 * import net.neoforged.fml.common.EventBusSubscriber;
 * import net.neoforged.neoforge.client.event.EntityRenderersEvent;
 *
 * @EventBusSubscriber(modid = ModMain.MOD_ID, bus = EventBusSubscriber.Bus.MOD)
 * public final class ModClient {
 *
 *     public static final ModelLayerLocation EXAMPLE_LAYER = new ModelLayerLocation(
 *             ResourceLocation.fromNamespaceAndPath(ModMain.MOD_ID, "example_entity"), "main");
 *
 *     private ModClient() {}
 *
 *     @SubscribeEvent
 *     public static void registerLayerDefinitions(EntityRenderersEvent.RegisterLayerDefinitions event) {
 *         event.registerLayerDefinition(EXAMPLE_LAYER, ExampleBipedModel::createBodyLayer);
 *     }
 *
 *     @SubscribeEvent
 *     public static void registerRenderers(EntityRenderersEvent.RegisterRenderers event) {
 *         event.registerEntityRenderer(ModEntities.EXAMPLE_ENTITY.get(), ExampleEntityRenderer::new);
 *     }
 * }
 */
