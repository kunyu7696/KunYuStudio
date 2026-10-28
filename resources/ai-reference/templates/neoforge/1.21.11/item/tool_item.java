/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.11）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.11 loaderVersion=21.11.45
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.11 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.11 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.11/item/tool_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.item.PickaxeItem;
import net.minecraft.world.item.SwordItem;
import net.minecraft.world.item.Tiers;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 工具物品（NeoForge 1.21.11）。
 * 要点：
 * - 1.21.11 仍是 Tier 体系：PickaxeItem(Tier, 攻击伤害增量, 攻速修正, Item.Properties)。
 *   （1.21.2+ 才改为 ToolMaterial 数据组件。）
 * - Tier 用原版 Tiers（WOOD/STONE/IRON/DIAMOND/NETHERITE/GOLD）或自定义 Tier 实现。
 * - 剑：new SwordItem(Tiers.IRON, 3, -2.4f, props)；斧/铲同理（AxeItem/ShovelItem）。
 * - 独立 DeferredRegister：记得在主类构造器追加 TOOLS.register(modEventBus)。
 */
public class ModTools {
    public static final DeferredRegister<Item> TOOLS =
            DeferredRegister.create(Registries.ITEM, ModMain.MOD_ID);

    public static final DeferredHolder<Item, PickaxeItem> EXAMPLE_PICKAXE = TOOLS.register("example_pickaxe",
            () -> new PickaxeItem(Tiers.IRON, 1, -2.8f, new Item.Properties()));

    public static final DeferredHolder<Item, SwordItem> EXAMPLE_SWORD = TOOLS.register("example_sword",
            () -> new SwordItem(Tiers.IRON, 3, -2.4f, new Item.Properties()));
}
