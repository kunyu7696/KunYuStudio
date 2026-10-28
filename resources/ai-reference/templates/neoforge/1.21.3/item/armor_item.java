/*
 * KunYuEcosystem AI Reference 模板迁移（neoforge/1.21.1 -> neoforge/1.21.3）
 * provenance: translated-from-neoforge-1.21.1
 * 目标 loader=neoforge mc=1.21.3 loaderVersion=21.3.0-beta
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.3 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.3 官方文档/NeoForge docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.2 | neoforge/1.21.3/item/armor_item.java | mapping: Mojang official | provenance: adapted from official loader MDK/docs
// ============================================================================
package com.example.examplemod.item;

import com.example.examplemod.ModMain;
import net.minecraft.world.entity.EquipmentType;
import net.minecraft.world.item.ArmorItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.equipment.ArmorMaterials;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * 盔甲物品（NeoForge 1.21.3）。
 * 要点：
 * - 1.21.2+（含 1.21.3）构造：ArmorItem(Holder<ArmorMaterial>, EquipmentType, Item.Properties)；
 *   ArmorItem.Type 内部枚举已移除，部位改用 net.minecraft.world.entity.EquipmentType。
 * - 1.21.2+ 材质常量类移到 net.minecraft.world.item.equipment.ArmorMaterials
 *   （1.21.1 及更早仍在 net.minecraft.world.item.ArmorMaterials）。
 * - 1.21.2+ Item.Properties 强制 setId：必须用 DeferredRegister.Items + registerItem（自动注入 id）。
 * - 盔甲层贴图：assets/examplemod/textures/models/armor/example_layer_1.png（裤甲 _layer_2）。
 * - 独立 DeferredRegister：记得在主类构造器追加 ARMORS.register(modEventBus)。
 */
public class ModArmors {
    public static final DeferredRegister.Items ARMORS =
            DeferredRegister.createItems(ModMain.MOD_ID);

    public static final DeferredHolder<Item, ArmorItem> EXAMPLE_CHESTPLATE = ARMORS.registerItem("example_chestplate",
            props -> new ArmorItem(ArmorMaterials.IRON, EquipmentType.CHESTPLATE, props));
}
