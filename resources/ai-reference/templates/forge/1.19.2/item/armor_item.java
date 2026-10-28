/*
 * KunYuEcosystem AI Reference 模板迁移（forge/1.20.1 -> forge/1.19.2）
 * provenance: translated-from-forge-1.20.1
 * 目标 loader=forge mc=1.19.2 loaderVersion=43.4.0
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.19.2 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.19.2 官方文档/Forge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | forge/1.19.2/item/armor_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
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
 * 盔甲物品（Forge 1.19.2）。
 * 要点：
 * - 1.19.2 构造：ArmorItem(ArmorMaterial, ArmorItem.Type, Item.Properties)。
 *   Type 取 HELMET/CHESTPLATE/LEGGINGS/BOOTS；材质用原版 ArmorMaterials 或自定义 ArmorMaterial。
 * - 盔甲层贴图：assets/examplemod/textures/models/armor/example_layer_1.png（裤甲 _layer_2）。
 * - 1.21.2+ 材质/类型改到 net.minecraft.world.item.armor 包，本模板按 1.19.2 写法。
 * - 独立 DeferredRegister：记得在主类构造器追加 ARMORS.register(modEventBus)。
 */
public class ModArmors {
    public static final DeferredRegister<Item> ARMORS =
            DeferredRegister.create(ForgeRegistries.ITEMS, ModMain.MOD_ID);

    public static final RegistryObject<ArmorItem> EXAMPLE_CHESTPLATE = ARMORS.register("example_chestplate",
            () -> new ArmorItem(ArmorMaterials.IRON, ArmorItem.Type.CHESTPLATE, new Item.Properties()));
}
