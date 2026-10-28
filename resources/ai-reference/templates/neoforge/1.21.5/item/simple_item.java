/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.5）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.5 loaderVersion=21.5.98
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.5 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.5 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.5/item/simple_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Rarity;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.event.BuildCreativeModeTabContentsEvent;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 普通物品注册（NeoForge 1.21.5）。
 * 要点：
 * - DeferredRegister.Items 简写：DeferredRegister.createItems(MODID)。
 * - 物品默认不进任何创造栏：用 BuildCreativeModeTabContentsEvent（MOD 总线）添加。
 */
public class ModItems {
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(ModMain.MOD_ID);

    public static final DeferredHolder<Item, Item> EXAMPLE_ITEM = ITEMS.register("example_item",
            () -> new Item(new Item.Properties()
                    .stacksTo(64)
                    .rarity(Rarity.COMMON)));

    // 创造栏添加（MOD 总线，可放在本类或 ModClient）：
    // @EventBusSubscriber(modid = ModMain.MOD_ID, bus = EventBusSubscriber.Bus.MOD)
    // public static class CreativeTabHandler {
    //     @SubscribeEvent
    //     public static void onBuildCreativeTabs(BuildCreativeModeTabContentsEvent event) {
    //         if (event.getTabKey() == CreativeModeTabs.INGREDIENTS) {
    //             event.accept(EXAMPLE_ITEM);
    //         }
    //     }
    // }
}
