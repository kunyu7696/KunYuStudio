// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.1/entity/entity_attribute.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.EntityAttributeCreationEvent;

/**
 * 实体属性注册（NeoForge 1.21.1）。
 * 事件类：net.neoforged.neoforge.event.entity.EntityAttributeCreationEvent（MOD 总线）。
 * 在 event.put(EntityType, AttributeSupplier) 中登记属性；漏掉会在实体生成时抛 NPE。
 */
@EventBusSubscriber(modid = ModMain.MOD_ID, bus = EventBusSubscriber.Bus.MOD)
public class ModEntityAttributes {

    @SubscribeEvent
    public static void onEntityAttributeCreation(EntityAttributeCreationEvent event) {
        event.put(ModEntities.EXAMPLE_ENTITY.get(),
                ModEntities.ExampleEntity.createAttributes().build());
        // 多个实体继续 event.put(...) 即可
    }
}
