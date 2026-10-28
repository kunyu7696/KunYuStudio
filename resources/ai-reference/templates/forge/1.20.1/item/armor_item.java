// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.20.1/item/armor_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.ArmorMaterials;
import net.minecraft.world.item.Item; // 补齐缺失 import：下方使用了 Item.Properties
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 盔甲物品（Forge 1.20.1）。
 * 要点：
 * - 1.20.1 构造：ArmorItem(ArmorMaterial, ArmorItem.Type, Item.Properties)。
 *   Type 取 HELMET/CHESTPLATE/LEGGINGS/BOOTS；材质用原版 ArmorMaterials 或自定义 ArmorMaterial。
 * - 盔甲层贴图：assets/examplemod/textures/models/armor/example_layer_1.png（裤甲 _layer_2）。
 * - 1.21.2+ 材质/类型改到 net.minecraft.world.item.armor 包，本模板按 1.20.1 写法。
 * - 独立 DeferredRegister：记得在主类构造器追加 ARMORS.register(modEventBus)。
 */
public class ModArmors {
    public static final DeferredRegister<Item> ARMORS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<ArmorItem> EXAMPLE_CHESTPLATE = ARMORS.register("example_chestplate",
            () -> new ArmorItem(ArmorMaterials.IRON, ArmorItem.Type.CHESTPLATE, new Item.Properties()));
}
