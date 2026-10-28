/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.21.5）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.21.5 loaderVersion=0.16.14
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.5 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.5 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.21.5/item/armor_item.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
/*
 * armor_item.java
 * ----------------------------------------------------------------------------
 * : Minecraft 1.21.5 (Fabric Loader + Fabric API + Yarn )
 * :
 *
 *  API  Fabric 1.21.5  Yarn yarn-1.21.5+build.1
 *
 * ============================================================================
 *  ArmorMaterial.Builder  ——
 * ============================================================================
 *    1.21.5 ArmorMaterial.Builder
 *   - 1.21.5  ArmorMaterial net.minecraft.item.ArmorMaterial
 *     implements ArmorMaterial
 *   - ArmorMaterial.Builder record EquipmentTypeRegistryEntry<SoundEvent>
 *     1.20.5 1.21 /
 *     ArmorMaterial.builder()...build() 1.21.5
 *
 * 1.21.5  ArmorMaterial  javadoc
 *   - int          getDurability(ArmorItem.Type type)   //
 *   - int          getProtection(ArmorItem.Type type)    //
 *   - int          getEnchantability()                  //
 *   - SoundEvent   getEquipSound()                       //  SoundEvent RegistryEntry
 *   - Ingredient   getRepairIngredient()                //
 *   - String       getName()                              //
 *   - float        getToughness()                         //  2.0F 4.0F 0
 *   - float        getKnockbackResistance()               //  0.1F 0
 *

 *   1.21.5  getDurability / getProtection / getEnchantability
 *    1.20.4  Yarn  getDurabilityForType / getDefenseForType / getEnchantmentValue
 *   1.20.5+  record + Builder  1.21.5
 *
 * ArmorItem 1.21.5
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
import net.fabricmc.fabric.api.item.v1.FabricItemSettings;
import net.minecraft.item.ArmorItem;
import net.minecraft.item.ArmorMaterial;
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
     *  - 1.21.5  8  Builder
     *  - getRepairIngredient()  Ingredient
     *     new Ingredient.of(Items.XXX)
     *     Supplier<Ingredient>  get()
     */
    public static class ExampleArmorMaterial implements ArmorMaterial {
        public static final ExampleArmorMaterial INSTANCE = new ExampleArmorMaterial();
        //  5 15 33 37 33
        private static final int DURABILITY_MULTIPLIER = 33;
        //  Supplier “”
        private final Supplier<Ingredient> repairIngredientSupplier =
                () -> Ingredient.of(net.minecraft.item.Items.IRON_INGOT);
        //  assets/minecraft/textures/models/armor/<name>_layer_1/2.png
        private static final String NAME = "example_armor";
        @Override
        public int getDurability(ArmorItem.Type type) {
            // HELMET 11 / CHESTPLATE 16 / LEGGINGS 15 / BOOTS 13
            return switch (type) {
                case HELMET -> 11 * DURABILITY_MULTIPLIER;
                case CHESTPLATE -> 16 * DURABILITY_MULTIPLIER;
                case LEGGINGS -> 15 * DURABILITY_MULTIPLIER;
                case BOOTS -> 13 * DURABILITY_MULTIPLIER;

                default -> 0; // BODY/ 0
            };
        }
        @Override
        public int getProtection(ArmorItem.Type type) {
            // boots 3 / leggings 6 / chestplate 8 / helmet 3
            return switch (type) {
                case BOOTS, HELMET -> 3;
                case LEGGINGS -> 6;
                case CHESTPLATE -> 8;
                default -> 0;
            };
        }
        @Override
        public int getEnchantability() {
            //  10 9 22 10
            return 10;
        }
        @Override
        public SoundEvent getEquipSound() {
            // 1.21.5  ITEM_  ITEM_ARMOR_EQUIP_IRON
            // 1.20.5+  ARMOR_EQUIP_IRON
            return SoundEvents.ITEM_ARMOR_EQUIP_IRON;
        }
        @Override
        public Ingredient getRepairIngredient() {
            return repairIngredientSupplier.get();
        }
        @Override
        public String getName() {
            return NAME;
        }
        @Override
        public float getToughness() {
            //  2.0F 4.0F 0 2.0F
            return 2.0F;
        }
        @Override
        public float getKnockbackResistance() {
            //  0.1F 0 0
            return 0.0F;
        }
    }
    // =========================================================================
    // ///
    // =========================================================================
    // ArmorItem new ArmorItem(, , Item.Settings)
    //  1.20.5+ 1.21.5  ArmorItem.Type EquipmentType
    public static final Item EXAMPLE_HELMET = register(
            "example_helmet",
            new ArmorItem(ExampleArmorMaterial.INSTANCE, ArmorItem.Type.HELMET, new FabricItemSettings())
    );
    public static final Item EXAMPLE_CHESTPLATE = register(
            "example_chestplate",
            new ArmorItem(ExampleArmorMaterial.INSTANCE, ArmorItem.Type.CHESTPLATE, new FabricItemSettings())
    );
    public static final Item EXAMPLE_LEGGINGS = register(
            "example_leggings",
            new ArmorItem(ExampleArmorMaterial.INSTANCE, ArmorItem.Type.LEGGINGS, new FabricItemSettings())
    );
    public static final Item EXAMPLE_BOOTS = register(
            "example_boots",
            new ArmorItem(ExampleArmorMaterial.INSTANCE, ArmorItem.Type.BOOTS, new FabricItemSettings())
    );
    // =========================================================================
    // =========================================================================

    public static Item register(String name, Item item) {
        return Registry.register(Registries.ITEM, new Identifier(EXAMPLE_MOD_ID, name), item);
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
