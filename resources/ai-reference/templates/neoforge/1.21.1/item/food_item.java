// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.1/item/food_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.Item;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 食物物品（NeoForge 1.21.1）。
 * 要点：
 * - Item.Properties().food(FoodProperties)；1.20.5+ 饱和度方法名为 saturationModifier，
 *   "不饿也能吃"方法名为 alwaysEdible（1.20.4 及更早为 alwaysEat）。
 * - effect 传 Supplier 是 NeoForge 扩展，可避免过早初始化药水注册表。
 * - 独立 DeferredRegister：记得在主类构造器追加 FOODS.register(modEventBus)。
 */
public class ModFoods {
    public static final DeferredRegister<Item> FOODS =
            DeferredRegister.create(Registries.ITEM, ModMain.MOD_ID);

    public static final DeferredHolder<Item, Item> EXAMPLE_FOOD = FOODS.register("example_food",
            () -> new Item(new Item.Properties()
                    .food(new FoodProperties.Builder()
                            .nutrition(4)                // 饥饿值 +4
                            .saturationModifier(0.6f)    // 饱和度系数 0.6
                            .effect(() -> new MobEffectInstance(MobEffects.MOVEMENT_SPEED, 200, 0), 1.0f)
                            .alwaysEdible()              // 不饿也能吃（1.20.5+ 方法名；1.20.4 为 alwaysEat）
                            .build())));
}
