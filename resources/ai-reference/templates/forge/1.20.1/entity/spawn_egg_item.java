// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.20.1/entity/spawn_egg_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import com.example.examplemod.entity.ModEntities;
import net.minecraft.world.item.Item;
import net.minecraftforge.common.ForgeSpawnEggItem;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 刷怪蛋（Forge 1.20.1）。
 * 要点：
 * - ForgeSpawnEggItem(Supplier<EntityType<? extends Mob>>, 底色, 斑点色, Item.Properties)。
 * - Supplier 延迟取值：注册阶段实体尚未就绪也不会 NPE。
 * - 创造栏见 item/simple_item.java 的 BuildCreativeModeTabContentsEvent 示例。
 * - 独立 DeferredRegister：记得在主类构造器追加 SPAWN_EGGS.register(modEventBus)。
 */
public class ModSpawnEggItems {
    public static final DeferredRegister<Item> SPAWN_EGGS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<ForgeSpawnEggItem> EXAMPLE_SPAWN_EGG =
            SPAWN_EGGS.register("example_spawn_egg",
                    () -> new ForgeSpawnEggItem(() -> ModEntities.EXAMPLE_ENTITY.get(),
                            0xFFFFFF,   // 底色
                            0x000000,   // 斑点色
                            new Item.Properties()));
}
