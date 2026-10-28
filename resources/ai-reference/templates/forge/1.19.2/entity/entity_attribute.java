/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.19.2）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=1.19.2 loaderVersion=43.4.0
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.19.2 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.19.2 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.19.2/entity/entity_attribute.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.minecraftforge.event.entity.EntityAttributeCreationEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;

/**
 * 实体属性注册（Forge 1.19.2）。
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
