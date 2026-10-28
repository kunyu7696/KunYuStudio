/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.20.4）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.20.4 loaderVersion=20.4.240
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.20.4 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.20.4 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.20.4/item/food_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
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
 * 食物物品（NeoForge 1.20.4）。
 * 要点：
 * - Item.Properties().food(FoodProperties)；1.20.4 饱和度方法名为 saturationMod
 *   （1.20.5+ 才改名为 saturationModifier，1.20.4 调用它会编译失败）。
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
                            .saturationMod(0.6f)         // 饱和度系数 0.6（1.20.4 方法名；1.20.5+ 为 saturationModifier）
                            .effect(() -> new MobEffectInstance(MobEffects.MOVEMENT_SPEED, 200, 0), 1.0f)
                            .alwaysEat()                 // 不饿也能吃
                            .build())));
}
