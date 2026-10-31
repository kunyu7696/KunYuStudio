/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.16.5）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.16.5 loaderVersion=0.14.0
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.16.5 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.16.5 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.16.5/item/food_item.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
/*
 * food_item.java
 * ----------------------------------------------------------------------------
 * : Minecraft 1.16.5 (Fabric Loader + Fabric API + Yarn )
 * :
 *
 *  API  Fabric 1.16.5  Yarn yarn-1.16.5+build.10
 *
 * 1.16.5  API  javadoc
 *   - net.minecraft.item.FoodComponent FoodComponent.Builder
 *   -  Item.Settings.food(FoodComponent)
 *   - Registry.register(Registries.ITEM, ...).
 *
 * FoodComponent.Builder 1.16.5
 *   hunger(int)                  // 1 =
 *   saturationModifier(float)    // “”
 *   meat()                        // “”
 *   alwaysEdible()                //
 *   snack()                       // “”
 *   statusEffect(StatusEffectInstance, float) //
 *   build()                       //  FoodComponent
 *
 *
 *   1. 1.16.5  net.minecraft.item.FoodComponent
 *       1.20.5+ FoodComponent  net.minecraft.component.FoodComponent
 *       DataComponent  1.16.5  component
 *   2. saturationModifier “”
 *       ≈ hunger × saturationModifier × 2
 *       hunger=5saturationModifier=0.6F hunger=40.6F
 *       hunger=80.8F 0.6F
 *   3. 1.16.5  Builder  usingConvertsTo(...)
 *       1.20.5+ “”1.16.5

 *      Item.Settings.recipeRemainder(Item) /
 *   4.  food(...) “”use/finishUsing
 * ----------------------------------------------------------------------------
 */
package com.example.mod.item;
import net.fabricmc.fabric.api.item.v1.FabricItemSettings;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
import net.minecraft.item.FoodComponent;
import net.minecraft.item.Item;
// [版本修正] ≤1.19.2 无 Registries，注册表在 net.minecraft.util.registry.Registry
import net.minecraft.util.registry.Registry;
import net.minecraft.util.Identifier;
/**
 *
 */
public class ModFoodItems {
    public static final String EXAMPLE_MOD_ID = "examplemod";
    /**
     *  1
     * hunger=63 saturationModifier=0.6F
     */
    public static final Item EXAMPLE_FOOD = register(
            "example_food",
            new Item(new FabricItemSettings().food(
                    new FoodComponent.Builder()
                            .hunger(6)
                            .saturationModifier(0.6F)
                            .meat()
                            .build()
            ))
    );
    /**
     *  2—— +
     */
    public static final Item EXAMPLE_SPECIAL_FOOD = register(
            "example_special_food",
            new Item(new FabricItemSettings().food(
                    new FoodComponent.Builder()
                            .hunger(4)
                            .saturationModifier(0.8F)
                            .alwaysEdible()           //
                            .snack()                    //
                            //  100%  5  Ichance  0.0F~1.0F
                            .statusEffect(
                                    new StatusEffectInstance(StatusEffects.SPEED, 5 * 20, 0),
                                    1.0F
                            )
                            //  30%
                            .statusEffect(
                                    new StatusEffectInstance(StatusEffects.REGENERATION, 3 * 20, 1),
                                    0.3F
                            )
                            .build()
            ))
            //  64 .maxCount(16)
    );
    // =========================================================================
    // =========================================================================
    public static Item register(String name, Item item) {
        return Registry.register(Registry.ITEM, new Identifier(EXAMPLE_MOD_ID, name), item);
    }
    /**
     *  onInitialize()
     */
    public static void registerFoodItems() {
        @SuppressWarnings("unused")
        Item ensureClassInit = EXAMPLE_FOOD;

    }
    /*
     * ============================================================================
     *
     * ============================================================================
     *   item.<modid>.<name>
     *   assets/<modid>/models/item/example_food.json  model.json
     *   assets/<modid>/textures/item/example_food.png
     *
     * “” FabricItemGroupEvents
     *   ItemGroupEvents.modifyEntriesEvent(ItemGroups.FOOD_AND_DRINKS)
     *       .register(entries -> entries.add(ModFoodItems.EXAMPLE_FOOD));
     * ============================================================================
     */
    private ModFoodItems() {
    }
}
