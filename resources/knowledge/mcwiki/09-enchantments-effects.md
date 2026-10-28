# 附魔（Enchantments）与状态效果（Status Effects）

## 自定义附魔（1.20.1 代码注册）

```java
public static final Enchantment LIFE_STEAL = Registry.register(
    Registries.ENCHANTMENT, new Identifier(MOD_ID, "life_steal"),
    new Enchantment(Enchantment.Rarity.COMMON, EnchantmentTarget.WEAPON,
        new EquipmentSlot[] { EquipmentSlot.MAINHAND }));
```

- Rarity：COMMON/UNCOMMON/RARE/VERY_RARE（影响附魔台出现权重）
- EnchantmentTarget：WEAPON（剑斧）、ARMOR / ARMOR_FEET / ARMOR_HEAD…、BOW、CROSSBOW、TRIDENT、WEARABLE、FISHING_ROD、DIGGER（工具）、VANISHABLE
- 关键方法重写：
  - `getMinPower(level)` / `getMaxPower(level)`：附魔台出现的等级区间
  - `getMaxLevel()`：最高等级（默认 1）
  - `isAvailableForEnchantedBookOffer()` / `isAvailableForRandomSelection()`
  - `canAccept(other)`：互斥（如锋利↔亡灵杀手）
- 语言键：`enchantment.<ns>.<id>`、`enchantment.<ns>.<id>.desc`（附魔书提示）
- 实际生效逻辑要自己写：在攻击/受伤事件或 Mixin 里读 `EnchantmentHelper.getLevel(...)`，1.20.1 没有属性式附魔钩子

## 状态效果（药水效果）

```java
public static final StatusEffect BLEED = Registry.register(
    Registries.STATUS_EFFECT, new Identifier(MOD_ID, "bleed"),
    new BleedEffect().setCategory(StatusEffectCategory.HARMFUL).setColor(0x8a0303));
```

- 类别 BENEFICIAL/NEUTRAL/HARMFUL 决定粒子颜色倾向与玩家死亡提示
- 自定义 Effect 类重写 `applyUpdateEffects(entity, amplifier)`（每 tick/每秒结算，如中毒掉血）、`canApplyUpdateEffect(duration, amplifier)`（节奏）、`applyInstantEffect`（瞬间型）
- 属性修饰型效果更简单：重写 `adjustModifierAmount` + 构造时 `addAttributeModifier(...)`（速度/力量等都是这个机制）

## 药水与药箭

- 药水走酿造配方数据（1.20.1 用 `Potion` 注册 + `BrewingRecipeRegistry.registerPotionRecipe`）
```java
Registry.register(Registries.POTION, id, new Potion(new StatusEffectInstance(BLEED, 600, 0)));
```
- 喷溅/滞留/药箭是同一 Potion 的不同载体；滞留云需要效果有正确的类型注册
- 语言键：`item.minecraft.potion.effect.<id>` / `splash_potion.effect.<id>` / `tipped_arrow.effect.<id>` / `lingering_potion.effect.<id>` 四个都要写

## 状态效果实例

`new StatusEffectInstance(effect, duration, amplifier, ambient, showParticles, showIcon)`：
- duration 单位 tick（20t=1 秒）
- amplifier 0 = 等级 I
- ambient 信标效果样式（半透明粒子）
