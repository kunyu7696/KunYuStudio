/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.19.2）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.19.2 loaderVersion=0.15.11
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.19.2 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.19.2 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.19.2/entity/spawn_egg_item.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
package com.example.mod.item;
import com.example.mod.entity.ExampleEntity;
// [版本修正] FabricSpawnEggItem 不存在于任何版本 fabric-api，改用原版 net.minecraft.item.SpawnEggItem
import net.minecraft.item.SpawnEggItem;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroup;
// [版本修正] ≤1.19.2 无 Registries，注册表在 net.minecraft.util.registry.Registry
import net.minecraft.util.registry.Registry;
import net.minecraft.util.Identifier;
import net.minecraft.util.Rarity;
/**
 *  - Fabric 1.19.2
 *
 *
 * 1.  FabricSpawnEggItem
 * 2.  Registry.register  Registries.ITEM
 *
 * Fabric 1.19.2  FabricSpawnEggItem
 * Supplier<EntityType<?>>  EntityType
 *
 *  Supplier
 *
 * :
 * -  new SpawnEggItem() FabricSpawnEggItem
 * - Supplier  EntityType
 * -  RGB 0xRRGGBB
 * - Item.Settings  new Item.Settings()
 * -  ItemGroup
 */
public class ModSpawnEggItems {

    /**
     *
     * :
     * - primaryColor:   0xRRGGBB
     * - secondaryColor: 0xRRGGBB
     */
    public static final Item EXAMPLE_SPAWN_EGG = registerSpawnEgg(
        //  Supplier
        () -> ExampleEntity.EXAMPLE_ENTITY,
        0xFFFFFF,   // :
        0x000000,   // :
        new Item.Settings()
            .rarity(Rarity.UNCOMMON)
            // 1.19.2  ItemGroups
            // : 1.19.2  ItemGroup
            //  ItemGroupEvents.modifyEntriesEvent
    );
    /**
     *
     *
     * @param entityTypeSupplier  Supplier
     * @param primaryColor      0xRRGGBB
     * @param secondaryColor    0xRRGGBB
     * @param settings
     * @return  Item
     */
    private static Item registerSpawnEgg(
        // [版本修正] SpawnEggItem 构造要求 EntityType<? extends MobEntity>
        java.util.function.Supplier<EntityType<? extends net.minecraft.entity.mob.MobEntity>> entityTypeSupplier,
        int primaryColor,
        int secondaryColor,
        Item.Settings settings
    ) {
        //  FabricSpawnEggItem
        // FabricSpawnEggItem
        // [版本修正] 原版 SpawnEggItem 构造为 (EntityType, int, int, Item.Settings)
        Item spawnEgg = new SpawnEggItem(
            entityTypeSupplier.get(),
            primaryColor,
            secondaryColor,
            settings
        );
        //  Registries.ITEM
        // : mod_id  mod ID
        return Registry.register(
            Registry.ITEM,
            new Identifier("examplemod", "example_spawn_egg"),
            spawnEgg
        );
    }
    /**
     *
     * ModInitializer onInitialize()
     */
    public static void register() {
        // Java  static
    }
}
/**
 * ================================================================
 *
 * ================================================================
 *  Fabric 1.19.2  ItemGroupEvents :
 *
 * import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
 * import net.minecraft.item.ItemGroups;
 *
 * ItemGroupEvents.modifyEntriesEvent(ItemGroups.INGREDIENTS)
 *     .register(entries -> {
 *         entries.add(ModSpawnEggItems.EXAMPLE_SPAWN_EGG);
 *     });
 */
