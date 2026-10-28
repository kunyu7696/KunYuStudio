/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.3）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.3 loaderVersion=21.3.0-beta
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.3 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.3 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.3/item/tool_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.PickaxeItem;
import net.minecraft.world.item.SwordItem;
import net.minecraft.world.item.ToolMaterial;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 工具物品（NeoForge 1.21.3）。
 * 要点：
 * - 1.21.2+（含 1.21.3）Tier 体系已重构：Tiers 枚举移除，改用 ToolMaterial record
 *   （常量 ToolMaterial.WOOD/STONE/IRON/DIAMOND/GOLD/NETHERITE）；
 *   构造器变为 (ToolMaterial, float 攻击伤害, float 攻速修正, Item.Properties)。
 * - 1.21.2+ Item.Properties 强制 setId：必须用 DeferredRegister.Items + registerItem（自动注入 id）。
 * - 剑：new SwordItem(ToolMaterial.IRON, 3.0f, -2.4f, props)；斧/铲同理（AxeItem/ShovelItem）。
 * - 独立 DeferredRegister：记得在主类构造器追加 TOOLS.register(modEventBus)。
 */
public class ModTools {
    public static final DeferredRegister.Items TOOLS =
            DeferredRegister.createItems(ModMain.MOD_ID);

    public static final DeferredHolder<Item, PickaxeItem> EXAMPLE_PICKAXE = TOOLS.registerItem("example_pickaxe",
            props -> new PickaxeItem(ToolMaterial.IRON, 1.0f, -2.8f, props));

    public static final DeferredHolder<Item, SwordItem> EXAMPLE_SWORD = TOOLS.registerItem("example_sword",
            props -> new SwordItem(ToolMaterial.IRON, 3.0f, -2.4f, props));
}
