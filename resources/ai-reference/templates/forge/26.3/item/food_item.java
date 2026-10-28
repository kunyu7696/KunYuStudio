/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/26.3）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=26.3 loaderVersion=66.0.11
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 26.3 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 26.3 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/26.3/item/food_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.food.FoodProperties;
import net.minecraft.world.item.Item;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 食物物品（Forge 26.3）。
 * 要点：
 * - Item.Properties().food(FoodProperties)；Builder 支持 nutrition/saturationMod/alwaysEat/effect。
 * - effect 传 Supplier 是 Forge 扩展，可避免过早初始化药水注册表。
 * - 独立 DeferredRegister：记得在主类构造器追加 FOODS.register(modEventBus)。
 */
public class ModFoods {
    public static final DeferredRegister<Item> FOODS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<Item> EXAMPLE_FOOD = FOODS.register("example_food",
            () -> new Item(new Item.Properties()
                    .food(new FoodProperties.Builder()
                            .nutrition(4)          // 饥饿值 +4
                            .saturationMod(0.6f)   // 饱和度系数 0.6
                            .effect(() -> new MobEffectInstance(MobEffects.MOVEMENT_SPEED, 200, 0), 1.0f)
                            .alwaysEat()           // 不饿也能吃
                            .build())));
}
