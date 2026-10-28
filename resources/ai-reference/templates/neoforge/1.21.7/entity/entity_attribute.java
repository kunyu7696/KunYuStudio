/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.7）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.7 loaderVersion=21.7.25
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.7 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.7 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.7/entity/entity_attribute.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.entity.EntityAttributeCreationEvent;

/**
 * 实体属性注册（NeoForge 1.21.7）。
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
