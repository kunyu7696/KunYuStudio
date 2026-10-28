/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.18.2）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=1.18.2 loaderVersion=40.2.0
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.18.2 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.18.2 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.18.2/item/simple_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.CreativeModeTab; // 版本差异：≤1.19.2 用 CreativeModeTab + .tab()；1.19.3+ 才改 CreativeModeTabs + BuildCreativeModeTabContentsEvent
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Rarity;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 普通物品注册（Forge 1.18.2）。
 * 要点：
 * - DeferredRegister.create(ForgeRegistries.ITEMS, MODID) + RegistryObject。
 * - 1.18.2 物品进创造栏：Item.Properties.tab(CreativeModeTab.TAB_xxx)（无 tab 则不进任何创造栏）。
 */
public class ModItems {
    public static final DeferredRegister<Item> ITEMS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<Item> EXAMPLE_ITEM = ITEMS.register("example_item",
            () -> new Item(new Item.Properties()
                    .stacksTo(64)
                    .rarity(Rarity.COMMON)
                    .tab(CreativeModeTab.TAB_MISC))); // 进"杂项"创造栏；1.19.3+ 移除 .tab()，改用 BuildCreativeModeTabContentsEvent
}
