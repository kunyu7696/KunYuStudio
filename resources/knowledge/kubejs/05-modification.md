# KubeJS 修改既有物品 / 方块速查

> 依据 KubeJS 官方 wiki（kubejs.com/wiki/tutorials/item-modification 与 block-modification）重写整理。
> 适用：KubeJS 6/7（MC 1.19 ~ 1.21.x）；已标注当前失效的 API。

## 基本规则

- 修改脚本放 `startup_scripts/` 目录（改动注册属性，**需重启游戏**生效）。
- `ItemEvents.modification` 改既有物品属性，`BlockEvents.modification` 改既有方块属性。
- 完整属性表见官方 wiki 参考页：ref/MutableItem、ref/MutableToolTier、ref/FoodBuilder、ref/MutableBlock。

## 修改既有物品

```js
ItemEvents.modification(event => {
  event.modify('minecraft:ender_pearl', item => {
    item.maxStackSize = 64
    item.fireResistant = true
    item.rarity = 'UNCOMMON'                      // COMMON / UNCOMMON / RARE / EPIC
  })

  event.modify('minecraft:ancient_debris', item => {
    item.rarity = 'RARE'
    item.burnTime = 16000                          // 可作燃料的燃烧时长
  })

  event.modify('minecraft:turtle_helmet', item => {
    item.rarity = 'EPIC'
    item.maxDamage = 481                           // 耐久上限
    item.craftingRemainder = Item.of('minecraft:scute').item  // 合成后剩余物
  })
})
```

### 食物属性（版本注意）

```js
ItemEvents.modification(event => {
  event.modify('minecraft:diamond', item => {
    item.foodProperties = food => {
      food.hunger(2)
      food.saturation(3)
      food.fastToEat()
      // ⚠ food.eaten(...) 在 1.21.1 已坏，进食回调请用下方 ItemEvents.foodEaten 替代
    }
  })
  event.modify('minecraft:pumpkin_pie', item => {
    item.foodProperties = null                     // 设为 null = 不可食用
  })
})
```

进食回调的可靠写法（`server_scripts/`，配合 `persistentData` 持久计数）：

```js
ItemEvents.foodEaten('minecraft:diamond', event => {
  const { player } = event
  const eaten = (player.persistentData.getInt('diamonds_eaten') ?? 0) + 1
  player.persistentData.putInt('diamonds_eaten', eaten)
  player.tell(`你吃下了钻石！累计 ${eaten} 颗。`)
})
```

### 工具 tier 修改（⚠ 当前版本失效）

官方注明 `item.tier = tier => {...}` 修改方式暂不可用（KubeJS issue #662），请改用
非 tier 属性直接调（如 `item.maxDamage`）。工具/盔甲各 tier 默认值（调参基准）：

| 工具 tier | 挖掘等级 | 耐久 | 挖掘速度 | 攻击加成 | 附魔适性 |
|---|---|---|---|---|---|
| Wood | 0 | 59 | 2 | 0 | 15 |
| Stone | 1 | 131 | 4 | 1 | 5 |
| Iron | 2 | 250 | 6 | 2 | 14 |
| Diamond | 3 | 1561 | 8 | 3 | 10 |
| Gold | 0 | 32 | 12 | 0 | 22 |
| Netherite | 4 | 2031 | 9 | 4 | 15 |

盔甲耐久（头/胸/腿/脚）：皮革 65/75/80/55，铁 195/225/240/165，钻石 429/495/528/363，
下界合金 481/555/592/407（韧性 3、击退抗性 0.1）；海龟壳仅头盔 325，鞘翅仅胸甲 432。

## 修改既有方块

```js
BlockEvents.modification(event => {
  event.modify('minecraft:stone', block => {
    block.destroySpeed = 0.1     // 破坏速度（越小越难挖）
    block.hasCollision = false   // 移除碰撞箱（可穿过）
  })
})
```
