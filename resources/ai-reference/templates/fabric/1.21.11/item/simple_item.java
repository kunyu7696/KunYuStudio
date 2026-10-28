/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.21.11）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.21.11 loaderVersion=0.19.5
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.11 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.11 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.21.11/item/simple_item.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
/*
 * simple_item.java
 * ----------------------------------------------------------------------------
 * : Minecraft 1.21.11 (Fabric Loader + Fabric API + Yarn )
 * :
 *
 *  AI  API  Fabric 1.21.11
 *   - FabricItemSettings : net.fabricmc.fabric.api.item.v1.FabricItemSettings
 *   - : Registry.register(Registries.ITEM, new Identifier(modId, name), item)
 *   - Identifier : new Identifier("mod_id", "item_name")
 *
 *
 *   1. Fabric 1.21.11  FabricItemSettings  Item.Settings
 *      FabricItemSettings  Item.Settings Fabric
 *       Fabric
 *   2. 1.21.11  Registriesnet.minecraft.registry.Registries
 *       Registry.ITEMRegistry.register
 *      Registries.ITEM
 *   3. 1.19.3  ItemGroup  Item.Settings  .group(ItemGroup)
 *       1.21.11  .group(...)
 *      Fabric API  FabricItemGroupEvents
 *   4. public static final Item XXX = register(...)
 *       register Fabric
 *      onInitialize
 *   5.  fabric.mod.json  mod id
 *
 * ----------------------------------------------------------------------------
 */
package com.example.mod.item;
import net.fabricmc.fabric.api.item.v1.FabricItemSettings;

import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;
/**
 *
 *
 */
public class ModItems {
    // TODO:  EXAMPLE_MOD_ID  fabric.mod.json  mod id
    public static final String EXAMPLE_MOD_ID = "examplemod";
    /**
     *
     *
     *  Anew Item(new FabricItemSettings())
     *  Bnew Item(new Item.Settings())   // Item.Settings = net.minecraft.item.Item$Settings
     *
     *  FabricItemSettings maxCount/maxDamage/rarity/fireproof
     */
    public static final Item EXAMPLE_ITEM = register(
            "example_item",
            new Item(new FabricItemSettings())
            // .maxCount(16)        //  64 maxDamagemaxCount  1
            // .rarity(Rarity.UNCOMMON)
            // .fireproof()         //
    );
    /**
     *
     * maxDamage “” 1
     */
    public static final Item EXAMPLE_DURABLE_ITEM = register(
            "example_durable_item",
            new Item(new FabricItemSettings().maxDamage(256))
    );
    /**
     *  Registries.ITEM
     *
     * Registry.register  item
     * onInitialize
     *  static final  ModItems
     */
    public static Item register(String name, Item item) {
        // new Identifier(namespace, path)namespace = mod idpath =
        return Registry.register(Registries.ITEM, new Identifier(EXAMPLE_MOD_ID, name), item);
    }
    /**
     *
     *   public class ExampleMod implements ModInitializer {
     *       @Override
     *       public void onInitialize() {
     *           ModItems.registerModItems();
     *           ...
     *       }
     *   }
     *
     *  JVM  ModItems
     *  static final
     *  ModItems
     */
    public static void registerModItems() {
        // /
        @SuppressWarnings("unused")
        Item ensureClassInit = EXAMPLE_ITEM;
    }
    /*
     * ============================================================================
     * 1.21.11

     * ============================================================================
     * 1.21.11  Item.Settings.group(ItemGroup) Fabric API
     *
     * import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
     * import net.minecraft.item.ItemGroups;
     *
     * ItemGroupEvents.modifyEntriesEvent(ItemGroups.INGREDIENTS).register(
     *         entries -> entries.add(ModItems.EXAMPLE_ITEM));
     *
     * /
     * ============================================================================
     */
    /*
     * ============================================================================
     *
     *   1. assets/<modid>/lang/en_us.json  zh_cn.json
     *        { "item.examplemod.example_item": "Example Item" }
     *      item.<modid>.<name>
     *   2.
     *      assets/<modid>/models/item/example_item.json    model.json
     *      assets/<modid>/textures/item/example_item.png
     * ============================================================================
     */
    private ModItems() {
    }
}
