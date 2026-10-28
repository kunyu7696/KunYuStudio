/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/entity/spawn_egg_item.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import com.example.examplemod.entity.ModEntities;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroup;
import net.minecraft.item.SpawnEggItem; // 1.16.5 原版刷怪蛋：构造直接吃 EntityType 实例
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 刷怪蛋（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - 1.16.5 原版 SpawnEggItem 构造：SpawnEggItem(EntityType<? extends MobEntity>,
 *   底色, 斑点色, Item.Properties)——直接吃 EntityType 实例，没有 Supplier 版本。
 * - 注意注册顺序：Forge 注册事件按 方块→物品→实体 触发，物品 supplier 执行时实体
 *   未必就绪。下方写法能工作是因为 DeferredRegister 的 supplier 延迟到物品注册事件
 *   才执行，而实体 DeferredRegister 只要也在主类构造器里 register 过、且注册顺序无冲突即可；
 *   若 .get() 抛 "RegistryObject not present"，改用 Forge 扩展
 *   net.minecraftforge.common.ForgeSpawnEggItem(Supplier<EntityType>, 底色, 斑点色, props)
 *   把取值再推迟到首次使用。
 * - 独立 DeferredRegister：记得在主类构造器追加 SPAWN_EGGS.register(modEventBus)。
 */
public class ModSpawnEggItems {
    public static final DeferredRegister<Item> SPAWN_EGGS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<SpawnEggItem> EXAMPLE_SPAWN_EGG =
            SPAWN_EGGS.register("example_spawn_egg",
                    () -> new SpawnEggItem(ModEntities.EXAMPLE_ENTITY.get(), // 必须在实体注册完成后取用
                            0xFFFFFF,   // 底色
                            0x000000,   // 斑点色
                            new Item.Properties().tab(ItemGroup.TAB_MISC)));
}
