/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/entity/entity_attribute.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.entity;

import com.example.examplemod.ModMain;
import net.minecraft.entity.ai.attributes.GlobalEntityTypeAttributes; // 1.16.5 专属：属性全局登记表
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLCommonSetupEvent;

/**
 * 实体属性注册（Forge 1.16.5）。
 * 要点：
 * - 1.16.5 【没有】 EntityAttributeCreationEvent（该事件 1.17+ 才加入 Forge）；
 *   正确做法是在 FMLCommonSetupEvent 里 enqueueWork 调 GlobalEntityTypeAttributes.put。
 * - enqueueWork 必须：GlobalEntityTypeAttributes 内部是 HashMap，注册阶段多线程，
 *   不入队会有并发修改风险。
 * - 漏掉注册会在实体生成时抛 NPE（"Attribute ... has no default value" 或直接空指针）。
 */
@Mod.EventBusSubscriber(modid = ModMain.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD)
public class ModEntityAttributes {

    @SubscribeEvent
    public static void onCommonSetup(FMLCommonSetupEvent event) {
        event.enqueueWork(() -> GlobalEntityTypeAttributes.put(
                ModEntities.EXAMPLE_ENTITY.get(),
                ModEntities.ExampleEntity.createAttributes().create())); // 注意 1.16.5 构建方法是 .create()，不是 .build()
        // 多个实体继续 GlobalEntityTypeAttributes.put(...) 即可
    }
}
