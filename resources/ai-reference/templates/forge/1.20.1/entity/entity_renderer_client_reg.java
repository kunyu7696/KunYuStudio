// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.20.1/entity/entity_renderer_client_reg.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
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
 * Forge 1.20.1 / Mojmap。
 *
 * 要点：
 * 1. 渲染器只负责「模型 + 贴图 + 影子半径」，泛型为 <实体, 模型>。
 * 2. 模型层 ModelLayerLocation 与渲染器必须成对注册：漏注册模型层，
 *    bakeLayer 会在运行期抛「Missing model layer」。
 * 3. 全部渲染注册只能走 MOD 总线 + Dist.CLIENT 的 EntityRenderersEvent，
 *    写进通用初始化代码会让 dedicated server 加载客户端类而崩溃。
 * 4. 贴图路径约定 assets/<modid>/textures/entity/<entity_id>.png。
 */
public class ExampleEntityRenderer extends MobRenderer<ModEntities.ExampleEntity, ExampleBipedModel<ModEntities.ExampleEntity>> {

    private static final ResourceLocation TEXTURE =
            new ResourceLocation(ModMain.MOD_ID, "textures/entity/example_entity.png");

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
 * —— 与 project/ModClient.java 的骨架合并，MOD 总线 + Dist.CLIENT
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
 * import net.minecraftforge.api.distmarker.Dist;
 * import net.minecraftforge.client.event.EntityRenderersEvent;
 * import net.minecraftforge.eventbus.api.SubscribeEvent;
 * import net.minecraftforge.fml.common.Mod;
 *
 * @Mod.EventBusSubscriber(modid = ModMain.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD, value = Dist.CLIENT)
 * public final class ModClient {
 *
 *     public static final ModelLayerLocation EXAMPLE_LAYER =
 *             new ModelLayerLocation(new ResourceLocation(ModMain.MOD_ID, "example_entity"), "main");
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
