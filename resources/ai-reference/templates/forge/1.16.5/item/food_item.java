/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/item/food_item.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.item.Food; // 1.16.5 食物属性类：Food（1.17+ 改名 FoodProperties）
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroup;
import net.minecraft.potion.EffectInstance; // 1.16.5 药水效果：net.minecraft.potion 包
import net.minecraft.potion.Effects;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 食物物品（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - Item.Properties().food(Food)；Food.Builder 支持 nutrition/saturationMod/alwaysEat/effect。
 * - 1.16.5 方法名是 saturationMod（1.20.2+ 改名 saturationModifier）。
 * - effect 传 Supplier 可避免注册阶段过早实例化 EffectInstance。
 * - 独立 DeferredRegister：记得在主类构造器追加 FOODS.register(modEventBus)。
 */
public class ModFoods {
    public static final DeferredRegister<Item> FOODS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<Item> EXAMPLE_FOOD = FOODS.register("example_food",
            () -> new Item(new Item.Properties()
                    .tab(ItemGroup.TAB_FOOD)         // 进"食物"创造栏
                    .food(new Food.Builder()
                            .nutrition(4)            // 饥饿值 +4
                            .saturationMod(0.6f)     // 饱和度系数 0.6
                            .effect(() -> new EffectInstance(Effects.MOVEMENT_SPEED, 200, 0), 1.0f)
                            .alwaysEat()             // 不饿也能吃
                            .build())));
}
