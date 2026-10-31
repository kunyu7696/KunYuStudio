/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.20.6）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.20.6 loaderVersion=0.15.11
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.20.6 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.20.6 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.20.6/item/armor_item.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
/*
 * armor_item.java
 * ----------------------------------------------------------------------------
 * : Minecraft 1.20.6 (Fabric Loader + Fabric API + Yarn )
 * :
 *
 *  API  Fabric 1.20.6  Yarn yarn-1.20.6+build.1
 *
 * ============================================================================
 *  ArmorMaterial.Builder  ——
 * ============================================================================
 *    1.20.6 ArmorMaterial.Builder
 *   - 1.20.6  ArmorMaterial net.minecraft.item.ArmorMaterial
 *     implements ArmorMaterial
 *   - ArmorMaterial.Builder record EquipmentTypeRegistryEntry<SoundEvent>
 *     1.20.5 1.21 /
 *     ArmorMaterial.builder()...build() 1.20.6
 *
 * 1.20.6  ArmorMaterial  javadoc
 *   - int          getDurability(ArmorItem.Type type)   //
 *   - int          getProtection(ArmorItem.Type type)    //
 *   - int          getEnchantability()                  //
 *   - SoundEvent   getEquipSound()                       //  SoundEvent RegistryEntry
 *   - Ingredient   getRepairIngredient()                //
 *   - String       getName()                              //
 *   - float        getToughness()                         //  2.0F 4.0F 0
 *   - float        getKnockbackResistance()               //  0.1F 0
 *

 *   1.20.6  getDurability / getProtection / getEnchantability
 *    1.20.4  Yarn  getDurabilityForType / getDefenseForType / getEnchantmentValue
 *   1.20.5+  record + Builder  1.20.6
 *
 * ArmorItem 1.20.6
 *   public ArmorItem(ArmorMaterial material, ArmorItem.Type type, Item.Settings settings)
 *    ArmorItem.Type  ArmorItem HELMET / CHESTPLATE / LEGGINGS / BOOTS
 *    BODY /
 *
 *
 *    =  ×
 *     HELMET=11, CHESTPLATE=16, LEGGINGS=15, BOOTS=13
 *    15 11×15=165 16×15=240 15×15=225 13×15=195
 *
 *
 *   boots=3, leggings=6, chestplate=8, helmet=3 1/2/3/1
 * ----------------------------------------------------------------------------
 */
package com.example.mod.item;
// [版本修正] 1.20.5+ ArmorMaterial 改为 record + RegistryEntry 注册，FabricItemSettings 已移除
import net.minecraft.item.ArmorItem;
import net.minecraft.item.ArmorMaterial;
import net.minecraft.registry.entry.RegistryEntry;
import java.util.Map;
import java.util.List;
import java.util.EnumMap;
import net.minecraft.item.Item;
import net.minecraft.recipe.Ingredient;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.sound.SoundEvent;
import net.minecraft.sound.SoundEvents;
import net.minecraft.util.Identifier;
import java.util.function.Supplier;
/**
 *
 */
public class ModArmorItems {
    public static final String EXAMPLE_MOD_ID = "examplemod";
    // =========================================================================
    //  ArmorMaterial
    // =========================================================================
    /**
     *  “example_armor”
     *
     *
     *  - 1.20.6  8  Builder
     *  - getRepairIngredient()  Ingredient
     *     new Ingredient.of(Items.XXX)
     *     Supplier<Ingredient>  get()
     */
    // [版本修正] 1.20.5+ ArmorMaterial 为 record：
    //   (Map<ArmorItem.Type,Integer> defense, int enchantability, RegistryEntry<SoundEvent> equipSound,
    //    Supplier<Ingredient> repairIngredient, List<ArmorMaterial.Layer> layers, float toughness, float knockbackResistance)
    public static final RegistryEntry<ArmorMaterial> EXAMPLE_ARMOR_MATERIAL = Registry.register(
            Registries.ARMOR_MATERIAL,
            Identifier.of(EXAMPLE_MOD_ID, "example_armor"),
            new ArmorMaterial(
                    // [版本修正] record 组件序（comp_2298~2304）：defense, enchantability, equipSound, repairIngredient, layers, toughness, knockbackResistance
                    new EnumMap<>(Map.of(   // defense 按槽位
                            ArmorItem.Type.BOOTS, 3,
                            ArmorItem.Type.LEGGINGS, 6,
                            ArmorItem.Type.CHESTPLATE, 8,
                            ArmorItem.Type.HELMET, 3
                    )),
                    10,                     // enchantability
                    RegistryEntry.of(SoundEvents.ITEM_ARMOR_EQUIP_IRON), // equipSound（1.20.6/1.21.1 仍叫 ITEM_ARMOR_EQUIP_IRON）
                    () -> Ingredient.of(net.minecraft.item.Items.IRON_INGOT), // repairIngredient
                    List.of(new ArmorMaterial.Layer(Identifier.of(EXAMPLE_MOD_ID, "example_armor"))), // layers
                    2.0F,                   // toughness
                    0.0F                    // knockbackResistance
            )
    );
    // =========================================================================
    // ///
    // =========================================================================
    // ArmorItem new ArmorItem(, , Item.Settings)
    //  1.20.5+ 1.20.6  ArmorItem.Type EquipmentType
    public static final Item EXAMPLE_HELMET = register(
            "example_helmet",
            new ArmorItem(EXAMPLE_ARMOR_MATERIAL, ArmorItem.Type.HELMET, new Item.Settings())
    );
    public static final Item EXAMPLE_CHESTPLATE = register(
            "example_chestplate",
            new ArmorItem(EXAMPLE_ARMOR_MATERIAL, ArmorItem.Type.CHESTPLATE, new Item.Settings())
    );
    public static final Item EXAMPLE_LEGGINGS = register(
            "example_leggings",
            new ArmorItem(EXAMPLE_ARMOR_MATERIAL, ArmorItem.Type.LEGGINGS, new Item.Settings())
    );
    public static final Item EXAMPLE_BOOTS = register(
            "example_boots",
            new ArmorItem(EXAMPLE_ARMOR_MATERIAL, ArmorItem.Type.BOOTS, new Item.Settings())
    );
    // =========================================================================
    // =========================================================================

    public static Item register(String name, Item item) {
        return Registry.register(Registries.ITEM, Identifier.of(EXAMPLE_MOD_ID, name), item);
    }
    /**
     *  onInitialize()
     */
    public static void registerArmorItems() {
        @SuppressWarnings("unused")
        Item ensureClassInit = EXAMPLE_HELMET;
    }
    /*
     * ============================================================================
     *
     * ============================================================================
     *
     *   assets/minecraft/textures/models/armor/example_armor_layer_1.png   +
     *   assets/minecraft/textures/models/armor/example_armor_layer_2.png   +
     *  example_armor  getName()
     *
     *
     *    assets/<modid>/models/item/example_helmet.json  model.json
     *    assets/<modid>/textures/item/example_helmet.png
     *
     * ============================================================================
     */
    /*
     * ============================================================================
     *
     * ============================================================================
     *  ArmorItem  DyeableArmorItem
     *   new DyeableArmorItem(ExampleArmorMaterial.INSTANCE, ArmorItem.Type.CHESTPLATE, new FabricItemSettings())
     *  JSON  textures  leather
     * ============================================================================
     */
    private ModArmorItems() {
    }
}
