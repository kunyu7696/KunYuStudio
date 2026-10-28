// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.1/item/armor_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.core.registries.Registries;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterials;
import net.minecraft.world.item.Item;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 盔甲物品（NeoForge 1.21.1）。
 * 要点：
 * - 1.21.1 构造：ArmorItem(ArmorMaterial, ArmorItem.Type, Item.Properties)。
 *   Type 取 HELMET/CHESTPLATE/LEGGINGS/BOOTS；材质用原版 ArmorMaterials 或自定义 ArmorMaterial。
 * - 1.21.1 材质枚举仍在 net.minecraft.world.item.ArmorMaterials（1.21.2+ 才移到 item.armor 包）。
 * - 盔甲层贴图：assets/examplemod/textures/models/armor/example_layer_1.png（裤甲 _layer_2）。
 * - 独立 DeferredRegister：记得在主类构造器追加 ARMORS.register(modEventBus)。
 */
public class ModArmors {
    public static final DeferredRegister<Item> ARMORS =
            DeferredRegister.create(Registries.ITEM, ModMain.MOD_ID);

    public static final DeferredHolder<Item, ArmorItem> EXAMPLE_CHESTPLATE = ARMORS.register("example_chestplate",
            () -> new ArmorItem(ArmorMaterials.IRON, ArmorItem.Type.CHESTPLATE, new Item.Properties()));
}
