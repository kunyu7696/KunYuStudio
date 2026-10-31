/*
 * KunYuEcosystem AI Reference 模板（forge/1.16.5 手写修订版）
 * provenance: rewritten-for-forge-1.16.5-mojmap
 * 目标 loader=forge mc=1.16.5 loaderVersion=36.2.42
 * 映射：Mojmap 1.16.5 —— 1.17 包重构前的平铺包结构
 *       （net.minecraft.item / net.minecraft.block / net.minecraft.entity 等，无 net.minecraft.world. 前缀）。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.16.5/item/armor_item.java | mapping: Mojmap 1.16.5 (flat packages) | provenance: rewritten for real 1.16.5 API
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.inventory.EquipmentSlotType; // 1.16.5 装备槽：net.minecraft.inventory.EquipmentSlotType（1.17+ 改名 EquipmentSlot）
import net.minecraft.item.ArmorItem;
import net.minecraft.item.ArmorMaterial; // 1.16.5 盔甲材质枚举：ArmorMaterial（ArmorMaterials 是 1.17+ 产物）
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroup;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

/**
 * 盔甲物品（Forge 1.16.5，Mojmap 平铺包）。
 * 要点：
 * - 1.16.5 构造：ArmorItem(IArmorMaterial, EquipmentSlotType, Item.Properties)。
 *   槽位取 HEAD/CHEST/LEGS/FEET；材质用原版枚举 ArmorMaterial 或自定义 IArmorMaterial 实现。
 * - 盔甲层贴图：assets/examplemod/textures/models/armor/example_layer_1.png（裤甲 _layer_2）。
 * - 独立 DeferredRegister：记得在主类构造器追加 ARMORS.register(modEventBus)。
 */
public class ModArmors {
    public static final DeferredRegister<Item> ARMORS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<ArmorItem> EXAMPLE_CHESTPLATE = ARMORS.register("example_chestplate",
            () -> new ArmorItem(ArmorMaterial.IRON, EquipmentSlotType.CHEST,
                    new Item.Properties().tab(ItemGroup.TAB_COMBAT)));
}
