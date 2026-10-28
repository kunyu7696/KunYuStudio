// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.20.1/entity/entity_attribute.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.minecraftforge.event.entity.EntityAttributeCreationEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/**
 * 实体属性注册（Forge 1.20.1）。
 * Forge 没有 FabricDefaultAttributeRegistry：监听 MOD 总线的 EntityAttributeCreationEvent，
 * 在 event.put(EntityType, AttributeSupplier) 中登记属性；漏掉会在实体生成时抛 NPE。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD)
public class ModEntityAttributes {

    @SubscribeEvent
    public static void onEntityAttributeCreation(EntityAttributeCreationEvent event) {
        event.put(ModEntities.EXAMPLE_ENTITY.get(),
                ModEntities.ExampleEntity.createAttributes().build());
        // 多个实体继续 event.put(...) 即可
    }
}
