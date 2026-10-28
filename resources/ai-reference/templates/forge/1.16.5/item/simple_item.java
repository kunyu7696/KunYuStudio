/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/item/simple_item.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroup; // 1.16.5 创造栏：ItemGroup（1.17+ 改名 CreativeModeTab）
import net.minecraft.item.Rarity;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 普通物品注册（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - DeferredRegister.create(ForgeRegistries.ITEMS, MODID) + RegistryObject。
 * - 物品进创造栏：Item.Properties.tab(ItemGroup.TAB_xxx)（无 tab 则不进任何创造栏）。
 * - 1.19.3+ 已移除 .tab()，改用 BuildCreativeModeTabContentsEvent；1.16.5 无需关心。
 */
public class ModItems {
    public static final DeferredRegister<Item> ITEMS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<Item> EXAMPLE_ITEM = ITEMS.register("example_item",
            () -> new Item(new Item.Properties()
                    .stacksTo(64)                    // 最大堆叠（MCP 名 maxStackSize）
                    .rarity(Rarity.COMMON)           // 稀有度：net.minecraft.item.Rarity
                    .tab(ItemGroup.TAB_MISC)));      // 进"杂项"创造栏
}
