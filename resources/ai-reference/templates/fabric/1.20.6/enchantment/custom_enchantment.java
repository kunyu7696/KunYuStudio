/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.20.6）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.20.6 loaderVersion=0.15.11
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.20.6 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.20.6 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.20.6/enchantment/custom_enchantment.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.enchantment;
// [版本修正] 1.20.5+ 附魔全面数据驱动化：Enchantment 不再可代码构造（EnchantmentTarget 已删除），
// 改为 data/<modid>/enchantment/*.json + RegistryKey 引用
import net.minecraft.enchantment.Enchantment;
import net.minecraft.registry.RegistryKey;
import net.minecraft.registry.RegistryKeys;
import net.minecraft.util.Identifier;
/**
 *  - Fabric 1.20.6
 *
 *
 * 1.  Enchantment
 * 2.  Registry.register  Registries.ENCHANTMENT
 * 3.
 *
 * :

 * - Enchantment.Rarity:
 *   COMMON      weight=10
 *   UNCOMMON    weight=5
 *   RARE        weight=2
 *   VERY_RARE   weight=1
 *
 * - EnchantmentTarget:
 *   ALL
 *   ARMOR
 *   FEET/LEGS/CHEST/HEAD
 *   WEAPON
 *   TOOL          ///
 *   BOW
 *   FISHING_ROD
 *   BREAKABLE
 *   TRIDENT
 *   CROSSBOW
 *   VANISHABLE
 *
 * - EquipmentSlot[]:
 *   MAINHAND
 *   OFFHAND
 *   HEAD
 *   CHEST
 *   LEGS
 *   FEET
 *
 * :
 * -  mod_id  mod ID
 * - getMinPower : 10 + (level - 1) * 15
 * - getMaxPower  getMinPower + 15~50
 * - getMaxLevel
 * - canCombine  false
 */
public class ModEnchantments {
    // [版本修正] 1.20.5+ 附魔为数据驱动：仅需声明 RegistryKey，
    // 附魔定义写在 data/examplemod/enchantment/example_enchantment.json
    public static final RegistryKey<Enchantment> EXAMPLE_ENCHANTMENT =
        RegistryKey.of(RegistryKeys.ENCHANTMENT, Identifier.of("examplemod", "example_enchantment"));

    public static void register() {
        // 数据驱动附魔无需代码注册；JSON 由数据包加载
    }
}
/**
 * ================================================================
 *
 * ================================================================
 * : assets/examplemod/lang/en_us.json
 *
 * {

 *     "enchantment.examplemod.example_enchantment": "Example Enchantment",
 *     "enchantment.examplemod.example_enchantment.desc": "A custom enchantment"
 * }
 *
 * : assets/examplemod/lang/zh_cn.json
 *
 * {
 *     "enchantment.examplemod.example_enchantment": "",
 *     "enchantment.examplemod.example_enchantment.desc": ""
 * }
 *
 * ================================================================
 *  ID
 * ================================================================
 * -  Identifier
 * - : enchantment.<mod_id>.<enchantment_name>
 * -  ID
 */
