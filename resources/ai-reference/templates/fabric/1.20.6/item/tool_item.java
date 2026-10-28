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
// KunYuEcosystem AI Reference v3.0 | fabric/1.20.6/item/tool_item.java | mapping: Yarn | provenance: extracted verbatim from source PDF; Chinese annotations unrecoverable (no ToUnicode)
// ============================================================================
/*
 * tool_item.java
 * ----------------------------------------------------------------------------
 * : Minecraft 1.20.6 (Fabric Loader + Fabric API + Yarn )
 * : /
 *
 *  API  Fabric 1.20.6  Yarn yarn-1.20.6+build.1
 *
 * 1.20.6  javadoc
 *   - public  SwordItem (ToolMaterial, int   attackDamage, float attackSpeed, Item.Settings)
 *   - protected PickaxeItem(ToolMaterial, int   attackDamage, float attackSpeed, Item.Settings)
 *   - protected AxeItem    (ToolMaterial, float attackDamage, float attackSpeed, Item.Settings)
 *   / attackDamage  int attackDamage  float
 *
 * protected
 *   PickaxeItem  AxeItem  1.20.6  protected  net.minecraft.item
 *    super  com.example.mod.item
 *   net.minecraft.item  new PickaxeItem(...)/new AxeItem(...)
 *   Java  JLS 6.6.2.1protected  new
 *   => / super(...)  protected
 *       public new CustomPickaxe(...)
 *   SwordItem  public new
 *
 *   / new PickaxeItem(...) public
 *    1.20.6
 *
 *
 *    ToolMaterial ToolMaterials.IRON  250
 *    FabricItemSettings().maxDamage(n)  maxDamage  1
 *
 * attackSpeed
 *   attackSpeed  -2.8F4.0F
 *
 *
 *   - 1.20.2~1.20.4  Yarn
 *   - 1.20.5 / 1.21  Item.Settings
 *        .sword(material, attackDamage, attackSpeed) / .pickaxe(...) / .axe(...)
 *      Tool “new ” 1.20.5+
 * ----------------------------------------------------------------------------
 */
package com.example.mod.item;
// [版本修正] FabricItemSettings 已移除；1.20.5+ 工具构造仅 (ToolMaterial, Item.Settings)，攻击属性经 createAttributeModifiers 注入
import net.minecraft.item.AxeItem;

import net.minecraft.item.Item;
import net.minecraft.item.PickaxeItem;
import net.minecraft.item.SwordItem;
import net.minecraft.item.ToolMaterial;
import net.minecraft.item.ToolMaterials;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;
/**
 * /
 */
public class ModToolItems {
    public static final String EXAMPLE_MOD_ID = "examplemod";
    // =========================================================================
    // SwordItem  public
    // =========================================================================
    //  IRON_SWORD new SwordItem(ToolMaterials.IRON, 3, -2.4F, new Item.Settings())
    // attackDamage  int = (1) + attackDamage +  3 + IRON
    public static final Item EXAMPLE_SWORD = register(
            "example_sword",
            new SwordItem(
                    ToolMaterials.IRON, // WOOD/STONE/IRON/DIAMOND/GOLD/NETHERITE
                    new Item.Settings().attributeModifiers(
                            // [版本修正] 1.20.5+ 攻击伤害/速度经 AttributeModifiersComponent 注入
                            SwordItem.createAttributeModifiers(ToolMaterials.IRON, 3, -2.4F)
                    )
            )
    );
    // =========================================================================
    // PickaxeItem  protected
    // =========================================================================
    //  IRON_PICKAXE (ToolMaterials.IRON, 1, -2.8F, settings)
    public static final Item EXAMPLE_PICKAXE = register(
            "example_pickaxe",
            new CustomPickaxeItem(
                    ToolMaterials.IRON,
                    1,        // attackDamageint
                    -2.8F,    // attackSpeed
                    new Item.Settings()
            )
    );
    // =========================================================================
    // AxeItem  protected
    // =========================================================================
    //  IRON_AXE (ToolMaterials.IRON, 6.0F, -3.0F, settings)
    //  attackDamage  float / int  6int float
    //  float  6.0F
    public static final Item EXAMPLE_AXE = register(
            "example_axe",
            new CustomAxeItem(
                    ToolMaterials.IRON,
                    6.0F,     // attackDamagefloat
                    -3.0F,    // attackSpeed
                    new Item.Settings()
            )
    );
    // =========================================================================
    //  public  super(...)  protected
    // =========================================================================
    /**
     *  PickaxeItem protected “”
     * (ToolMaterial, int attackDamage, float attackSpeed, Item.Settings)
     */
    public static class CustomPickaxeItem extends PickaxeItem {
        public CustomPickaxeItem(ToolMaterial material, int attackDamage, float attackSpeed, Settings settings) {
            // [版本修正] 1.20.5+ PickaxeItem 构造仅 (ToolMaterial, Item.Settings)
            super(material, settings.attributeModifiers(
                    PickaxeItem.createAttributeModifiers(material, attackDamage, attackSpeed)));
        }
    }

    /**
     *  AxeItem protected “”
     * (ToolMaterial, float attackDamage, float attackSpeed, Item.Settings)
     *  attackDamage  float int
     */
    public static class CustomAxeItem extends AxeItem {
        public CustomAxeItem(ToolMaterial material, float attackDamage, float attackSpeed, Settings settings) {
            // [版本修正] 1.20.5+ AxeItem 构造仅 (ToolMaterial, Item.Settings)
            super(material, settings.attributeModifiers(
                    AxeItem.createAttributeModifiers(material, attackDamage, attackSpeed)));
        }
    }
    /**
     * /
     *
     *   public static class CustomSwordItem extends SwordItem {
     *       public CustomSwordItem(ToolMaterial m, int attackDamage, float attackSpeed, Settings s) {
     *           super(m, attackDamage, attackSpeed, s);
     *       }
     *   }
     *
     *  SwordItem  public new SwordItem(...)
     */
    // =========================================================================
    // =========================================================================
    public static Item register(String name, Item item) {
        return Registry.register(Registries.ITEM, Identifier.of(EXAMPLE_MOD_ID, name), item);
    }
    /**
     *  onInitialize()
     */
    public static void registerToolItems() {
        @SuppressWarnings("unused")
        Item ensureClassInit = EXAMPLE_SWORD;
    }
    /*
     * ============================================================================
     *  ToolMaterial ToolMaterial
     * ============================================================================
     *  ToolMaterials
     *
     *   public class ExampleToolMaterial implements ToolMaterial {
     *       public static final ExampleToolMaterial INSTANCE = new ExampleToolMaterial();
     *
     *       @Override public int getDurability()             { return 512; }          //
     *       @Override public float getMiningSpeedMultiplier() { return 6.0F; }         //
     *       @Override public float getAttackDamage()          { return 2.0F; }         //
     *       @Override public int getMiningLevel()             { return 2; }           // /
     *       @Override public int getEnchantability()          { return 14; }          //
     *       @Override public Ingredient getRepairIngredient() { return Ingredient.of(Items.IRON_INGOT); }
     *   }
     *
     *    ToolMaterials.IRON  ExampleToolMaterial.INSTANCE
     * 1.20.6  ToolMaterial  Yarn getDurability / getMiningLevel
     * ============================================================================
     */
    private ModToolItems() {
    }
}
