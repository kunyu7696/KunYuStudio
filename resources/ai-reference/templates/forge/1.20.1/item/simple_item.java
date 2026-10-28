// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.20.1/item/simple_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
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
 * 普通物品注册（Forge 1.20.1）。
 * 要点：
 * - DeferredRegister.create(ForgeRegistries.ITEMS, MODID) + RegistryObject。
 * - 1.20.1 物品默认不进任何创造栏：用 BuildCreativeModeTabContentsEvent（MOD 总线）添加。
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
