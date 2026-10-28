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
// KunYuEcosystem AI Reference v3.2 | forge/1.21.1/enchantment/custom_enchantment.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.enchantment;

import com.example.examplemod.ModMain;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.EnchantmentHelper;

/**
 * 自定义附魔（Forge 1.21.1）。
 * 要点：
 * - 版本差异：1.21 起附魔全面数据驱动——Enchantment 的 (Rarity, EnchantmentCategory, EquipmentSlot...)
 *   构造已移除（Rarity/EnchantmentCategory 均不复存在），不能再用 DeferredRegister&lt;Enchantment&gt;
 *   注册自定义附魔类（1.20.1 的继承 Enchantment 写法在 1.21.1 上必然编译失败）。
 * - 正确姿势：附魔本体写在数据包 JSON：data/examplemod/enchantment/example_enchantment.json；
 *   Java 侧仅保留 ResourceKey&lt;Enchantment&gt; 用于查询附魔等级等逻辑。
 * - 名称翻译键：enchantment.examplemod.example_enchantment（assets/examplemod/lang/en_us.json）。
 * - 附魔可用物品用 tag 声明（supported_items），如原版 #minecraft:enchantable/weapon 或自定义 tag。
 */
public class ModEnchantments {
    /** 版本差异：1.21 不再 DeferredRegister<Enchantment>，改 ResourceKey 引用数据包附魔。 */
    public static final ResourceKey<Enchantment> EXAMPLE_ENCHANTMENT =
            ResourceKey.create(Registries.ENCHANTMENT,
                    ResourceLocation.fromNamespaceAndPath(ModMain.MOD_ID, "example_enchantment"));

    /**
     * 附魔定义（data/examplemod/enchantment/example_enchantment.json）示例：
     * <pre>
     * {
     *   "anvil_cost": 8,
     *   "max_cost": { "base": 30, "per_level_above_first": 5 },
     *   "min_cost": { "base": 10, "per_level_above_first": 5 },
     *   "max_level": 3,
     *   "weight": 2,
     *   "slots": [ "mainhand" ],
     *   "supported_items": "#minecraft:enchantable/weapon",
     *   "exclusive_set": "#minecraft:exclusive_set/damage",
     *   "description": { "translate": "enchantment.examplemod.example_enchantment" }
     * }
     * </pre>
     * 也可在 datagen 用 RegistrySetBuilder + BootstrapContext&lt;Enchantment&gt; 生成上述 JSON。
     */

    /** 查询附魔等级示例（1.20.5+：Enchantment 一律走 Holder，不再直接传 Enchantment 实例）。 */
    public static int getExampleLevel(ItemStack stack,
                                      net.minecraft.core.RegistryAccess registries) {
        var holder = registries.lookupOrThrow(Registries.ENCHANTMENT).getOrThrow(EXAMPLE_ENCHANTMENT);
        return EnchantmentHelper.getItemEnchantmentLevel(holder, stack);
    }
}
