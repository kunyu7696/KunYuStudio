/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/enchantment/custom_enchantment.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.enchantment;

import com.example.examplemod.ModMain;
import net.minecraft.enchantment.Enchantment; // 1.16.5 附魔：net.minecraft.enchantment 包
import net.minecraft.enchantment.EnchantmentType; // 1.16.5 附魔类别：EnchantmentType（EnchantmentCategory 是 1.17+ 改名）
import net.minecraft.inventory.EquipmentSlotType;
import net.minecraft.item.ItemStack;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 自定义附魔（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - 1.16.5 附魔仍是 Java 类：继承 Enchantment，构造
 *   (Rarity, EnchantmentType, EquipmentSlotType[])——槽位是显式数组，不是 varargs。
 * - getMinCost/getMaxCost 决定附魔台消耗；getMaxLevel 最大等级。
 * - 互斥控制方法名随映射/版本不同：1.16.5 Mojmap 为 isCompatibleWith(Enchantment)
 *   （MCP 名 canApplyTogether；1.17+ Mojmap 名 checkCompatibility），按需重写并加 @Override。
 * - 名称翻译键：enchantment.examplemod.example_enchantment（assets/examplemod/lang/en_us.json）。
 * - 注意：1.21+ 已改为数据驱动 JSON（见 neoforge 模板 enchantment/custom_enchantment.json）。
 */
public class ModEnchantments {
    public static final DeferredRegister<Enchantment> ENCHANTMENTS =
            DeferredRegister.create(ForgeRegistries.ENCHANTMENTS, ModMain.MOD_ID);

    public static final RegistryObject<Enchantment> EXAMPLE_ENCHANTMENT =
            ENCHANTMENTS.register("example_enchantment", ExampleEnchantment::new);

    public static class ExampleEnchantment extends Enchantment {
        public ExampleEnchantment() {
            super(Enchantment.Rarity.RARE, EnchantmentType.WEAPON,
                    new EquipmentSlotType[]{EquipmentSlotType.MAINHAND});
        }

        @Override
        public int getMinCost(int level) {
            return 10 + (level - 1) * 15;   // 1 级 10，2 级 25，3 级 40
        }

        @Override
        public int getMaxCost(int level) {
            return getMinCost(level) + 50;
        }

        @Override
        public int getMaxLevel() {
            return 3;
        }

        @Override
        public boolean canEnchant(ItemStack stack) {
            return super.canEnchant(stack); // 例：return stack.getItem() instanceof SwordItem || super.canEnchant(stack);
        }
    }
}
