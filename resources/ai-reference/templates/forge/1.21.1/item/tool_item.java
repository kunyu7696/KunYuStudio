/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.21.1）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=1.21.1 loaderVersion=52.0.57
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.1 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.1 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.21.1/item/tool_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.Item; // 补齐缺失 import：下方使用了 Item.Properties
import net.minecraft.world.item.PickaxeItem;
import net.minecraft.world.item.SwordItem;
import net.minecraft.world.item.Tiers;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 工具物品（Forge 1.21.1）。
 * 要点：
 * - 镐：PickaxeItem(Tier, Item.Properties)；伤害/攻速经 Properties.attributes(...) 注入（1.20.5+ 组件化）。
 * - Tier 用原版 Tiers（WOOD/STONE/IRON/DIAMOND/NETHERITE/GOLD）或自定义 Tier 实现。
 * - 剑：new SwordItem(Tiers.IRON, props.attributes(SwordItem.createAttributes(Tiers.IRON, 3, -2.4f)))；斧/铲同理。
 * - 独立 DeferredRegister：记得在主类构造器追加 TOOLS.register(modEventBus)。
 */
public class ModTools {
    public static final DeferredRegister<Item> TOOLS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<PickaxeItem> EXAMPLE_PICKAXE = TOOLS.register("example_pickaxe",
            // 版本差异：1.20.5+ 工具构造简化为 (Tier, Properties)，攻击伤害/攻速经 attributes() 注入
            () -> new PickaxeItem(Tiers.IRON, new Item.Properties()
                    .attributes(PickaxeItem.createAttributes(Tiers.IRON, 1.0f, -2.8f))));

    public static final RegistryObject<SwordItem> EXAMPLE_SWORD = TOOLS.register("example_sword",
            () -> new SwordItem(Tiers.IRON, new Item.Properties()
                    .attributes(SwordItem.createAttributes(Tiers.IRON, 3, -2.4f))));
}
