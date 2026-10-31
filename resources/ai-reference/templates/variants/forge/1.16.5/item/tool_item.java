/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/item/tool_item.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroup;
import net.minecraft.item.ItemTier; // 1.16.5 工具材质枚举：ItemTier（Tiers 类是 1.17 包重构后的产物）
import net.minecraft.item.PickaxeItem;
import net.minecraft.item.SwordItem;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 工具物品（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - 镐：PickaxeItem(IItemTier, 攻击伤害增量, 攻速修正, Item.Properties)。
 * - 材质用原版枚举 ItemTier（WOOD/STONE/IRON/DIAMOND/NETHERITE/GOLD）；
 *   自定义材质实现 net.minecraft.item.IItemTier 接口（1.17+ 改名 Tier）。
 * - 剑：new SwordItem(ItemTier.IRON, 3, -2.4F, props)；斧/铲同理（AxeItem/ShovelItem）。
 * - 独立 DeferredRegister：记得在主类构造器追加 TOOLS.register(modEventBus)。
 */
public class ModTools {
    public static final DeferredRegister<Item> TOOLS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<PickaxeItem> EXAMPLE_PICKAXE = TOOLS.register("example_pickaxe",
            () -> new PickaxeItem(ItemTier.IRON, 1, -2.8F,
                    new Item.Properties().tab(ItemGroup.TAB_TOOLS)));

    public static final RegistryObject<SwordItem> EXAMPLE_SWORD = TOOLS.register("example_sword",
            () -> new SwordItem(ItemTier.IRON, 3, -2.4F,
                    new Item.Properties().tab(ItemGroup.TAB_COMBAT)));
}
