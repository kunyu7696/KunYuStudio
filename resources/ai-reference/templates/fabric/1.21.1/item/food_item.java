/*
 * KunYuEcosystem AI Reference 模板迁移（fabric/1.20.1 -> fabric/1.21.1）
 * provenance: translated-from-fabric-1.20.1
 * 目标 loader=fabric mc=1.21.1 loaderVersion=0.15.11
 * 注意：本文件由脚本从种子组合复制并替换版本号得到。Java API、Yarn/Mojmap 命名、
 *       加载器 DSL 在 1.21.1 上可能与种子版本存在差异，构建失败时
 *       请优先查阅 1.21.1 官方文档/Fabric docs。
 * verifiedAt 为 null 表示本模板尚未在目标版本真机编译验证。
 */
// ============================================================================
// KunYuEcosystem AI Reference v3.0 | fabric/1.21.1/item/food_item.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
/*
 * food_item.java
 * ----------------------------------------------------------------------------
 * : Minecraft 1.21.1 (Fabric Loader + Fabric API + Yarn )
 * :
 *
 *  API  Fabric 1.21.1  Yarn yarn-1.21.1+build.3
 *
 * 1.21.1  API  javadoc
 *   - net.minecraft.item.FoodComponent FoodComponent.Builder
 *   -  Item.Settings.food(FoodComponent)
 *   - Registry.register(Registries.ITEM, ...).
 *
 * FoodComponent.Builder 1.21.1
 *   hunger(int)                  // 1 =
 *   saturationModifier(float)    // “”
 *   meat()                        // “”
 *   alwaysEdible()                //
 *   snack()                       // “”
 *   statusEffect(StatusEffectInstance, float) //
 *   build()                       //  FoodComponent
 *
 *
 *   1. 1.21.1  net.minecraft.item.FoodComponent
 *       1.20.5+ FoodComponent  net.minecraft.component.FoodComponent
 *       DataComponent  1.21.1  component
 *   2. saturationModifier “”
 *       ≈ hunger × saturationModifier × 2
 *       hunger=5saturationModifier=0.6F hunger=40.6F
 *       hunger=80.8F 0.6F
 *   3. 1.21.1  Builder  usingConvertsTo(...)
 *       1.20.5+ “”1.21.1

 *      Item.Settings.recipeRemainder(Item) /
 *   4.  food(...) “”use/finishUsing
 * ----------------------------------------------------------------------------
 */
package com.example.mod.item;
// [版本修正] FabricItemSettings 已移除，改用原版 new Item.Settings()
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.entity.effect.StatusEffects;
// [版本修正] 1.20.5+ FoodComponent 迁至 net.minecraft.component.type.FoodComponent，且 Builder 无 meat()
import net.minecraft.component.type.FoodComponent;
import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
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
            new Item(new Item.Settings().food(
                    new FoodComponent.Builder()
                            .nutrition(6)
                            .saturationModifier(0.6F)
                            .build()
            ))
    );
    /**
     *  2—— +
     */
    public static final Item EXAMPLE_SPECIAL_FOOD = register(
            "example_special_food",
            new Item(new Item.Settings().food(
                    new FoodComponent.Builder()
                            .nutrition(4)
                            .saturationModifier(0.8F)
                            .alwaysEdible()           //
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
        return Registry.register(Registries.ITEM, Identifier.of(EXAMPLE_MOD_ID, name), item);
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
