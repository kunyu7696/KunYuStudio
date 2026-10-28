/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.21.10）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.21.10 loaderVersion=0.19.5
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.10 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.10 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.21.10/enchantment/custom_enchantment.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.enchantment;
import net.minecraft.enchantment.Enchantment;
import net.minecraft.enchantment.EnchantmentTarget;
import net.minecraft.enchantment.Enchantments;
import net.minecraft.entity.EquipmentSlot;
// [版本修正] EquipmentSlotGroup 为 1.20.5+ 类，本版本删除该 import
import net.minecraft.item.ItemStack;
import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;
/**
 *  - Fabric 1.21.10
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
    /**
     *
     * ModInitializer onInitialize()
     */
    public static final Enchantment EXAMPLE_ENCHANTMENT = Registry.register(
        Registries.ENCHANTMENT,
        new Identifier("examplemod", "example_enchantment"),
        new ExampleEnchantment(
            Enchantment.Rarity.RARE,           // :
            EnchantmentTarget.WEAPON,          // :
            EquipmentSlot.MAINHAND             // :
        )
    );
    /**
     *
     */
    public static void register() {
    }
    // ================================================================
    // ================================================================
    public static class ExampleEnchantment extends Enchantment {
        /**
         *
         *
         * @param rarity
         * @param target
         * @param slots
         */
        public ExampleEnchantment(Rarity rarity, EnchantmentTarget target, EquipmentSlot... slots) {
            super(rarity, target, slots);
        }
        /**
         *

         * ""
         *
         * : 10 + (level - 1) * 15
         * 1: 10, 2: 25, 3: 40
         *
         * @param level
         * @return
         */
        @Override
        public int getMinPower(int level) {
            return 10 + (level - 1) * 15;
        }
        /**
         *
         *
         *  getMinPower + 50
         *
         * @param level
         * @return
         */
        @Override
        public int getMaxPower(int level) {
            return super.getMinPower(level) + 50;
        }
        /**
         *
         * :  3  3
         *
         * @return
         */
        @Override
        public int getMaxLevel() {
            return 3;
        }
        /**
         *
         *  EnchantmentTarget
         *
         * @param stack
         * @return
         */
        @Override
        public boolean isAcceptableItem(ItemStack stack) {
            // :  EnchantmentTarget
            return super.isAcceptableItem(stack);
        }
        /**
         *
         *  true
         *
         * @param other
         * @return
         */
        @Override
        public boolean canCombine(Enchantment other) {
            // :
            // if (other == Enchantments.SHARPNESS) {
            //     return false;
            // }
            return super.canCombine(other);
        }
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
