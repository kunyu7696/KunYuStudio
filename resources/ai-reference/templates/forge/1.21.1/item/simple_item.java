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
// KunYuEcosystem AI Reference v3.2 | forge/1.21.1/item/simple_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Rarity;
import net.minecraftforge.event.BuildCreativeModeTabContentsEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 普通物品注册（Forge 1.21.1）。
 * 要点：
 * - DeferredRegister.create(ForgeRegistries.ITEMS, MODID) + RegistryObject。
 * - 1.21.1 物品默认不进任何创造栏：用 BuildCreativeModeTabContentsEvent（MOD 总线）添加。
 */
public class ModItems {
    public static final DeferredRegister<Item> ITEMS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<Item> EXAMPLE_ITEM = ITEMS.register("example_item",
            () -> new Item(new Item.Properties()
                    .stacksTo(64)
                    .rarity(Rarity.COMMON)));

    // 创造栏添加（MOD 总线，可放在本类或 ModClient）：
    // @Mod.EventBusSubscriber(modid = ModMain.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD)
    // public static class CreativeTabHandler {
    //     @SubscribeEvent
    //     public static void onBuildCreativeTabs(BuildCreativeModeTabContentsEvent event) {
    //         if (event.getTabKey() == CreativeModeTabs.INGREDIENTS) {
    //             event.accept(EXAMPLE_ITEM);
    //         }
    //     }
    // }
}
