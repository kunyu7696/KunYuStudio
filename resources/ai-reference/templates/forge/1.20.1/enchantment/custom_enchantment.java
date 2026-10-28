// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.20.1/enchantment/custom_enchantment.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.enchantment;

import com.example.examplemod.ModMain;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.Enchantment;
import net.minecraft.world.item.enchantment.EnchantmentCategory;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 自定义附魔（Forge 1.20.1）。
 * 要点：
 * - 1.20.1 附魔仍是 Java 类：继承 Enchantment，构造 (Rarity, EnchantmentCategory, EquipmentSlot...)。
 * - getMinCost/getMaxCost 决定附魔台消耗；getMaxLevel 最大等级；checkCompatibility 控制可否叠加。
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
            super(Enchantment.Rarity.RARE, EnchantmentCategory.WEAPON, EquipmentSlot.MAINHAND);
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
        public boolean checkCompatibility(Enchantment other) {
            // 例：与锋利互斥 —— return other != Enchantments.SHARPNESS && super.checkCompatibility(other);
            return super.checkCompatibility(other);
        }

        @Override
        public boolean canEnchant(ItemStack stack) {
            return super.canEnchant(stack);
        }
    }
}
