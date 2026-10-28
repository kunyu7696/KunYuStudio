# KubeJS 物品 / 方块注册速查

> 依据 KubeJS 官方 wiki（kubejs.com/wiki/tutorials/item-registry 与 block-registry）重写整理。
> 属 B 站《从零开始的 MC 整合包制作教程》系列主题域（注册与标签篇）的官方文档蒸馏。
> 适用：KubeJS 6/7（MC 1.19 ~ 1.21.x）；标注了版本分叉处。

## 基本规则

- 注册脚本放 `startup_scripts/` 目录。
- 注册（registry）改动**不能热重载**，必须重启游戏；注册的是真实内容。
- 命名空间固定为 `kubejs`：`event.create('test_item')` → `kubejs:test_item`。

## 物品注册

```js
StartupEvents.registry('item', event => {
  event.create('test_item')                                  // 贴图约定：kubejs/assets/kubejs/textures/item/test_item.png
  event.create('test_item_1').texture('mobbo:item/lava')     // 改贴图路径：kubejs/assets/mobbo/textures/item/lava.png
  event.create('test_item_2').maxStackSize(16).glow(true)    // builder 方法可无限链式
  event.create('custom_sword', 'sword')                      // 第二参 = 物品类型
    .tier('diamond').attackDamageBaseline(10)
})
```

### 物品类型（create 第二参）

`basic`（默认）、`sword`、`pickaxe`、`axe`、`shovel`、`shears`、`hoe`、
`helmet`、`chestplate`、`leggings`、`boots`

### 通用 builder 方法（节选）

- 堆叠/耐久：`maxStackSize(n)`、`unstackable()`（=maxStackSize(1)）、`maxDamage(n)`
- 外观：`displayName(name)`、`name(itemstack => ...)`、`tooltip(text...)`（§ 颜色码）、
  `rarity(rarity)`、`glow(true)`、`color(index, hex)`、`color((itemstack, tintIndex) => ...)`（返回 -1 = 不染）
- 模型贴图：`texture(loc)`、`texture(key, loc)`（指定 layer）、`textureJson({layer0: ...})`、
  `modelJson({parent: ...})`、`parentModel(loc)`
- 行为：`useAnimation('drink'|'eat'|'bow'|'crossbow'|'spear'|'spyglass'|'block'|'none')`、
  `useDuration(stack => ticks)`（≤0 不可使用）、`use((level, player, hand) => boolean)`、
  `finishUsing((stack, level, entity) => stack)`、`releaseUsing((stack, level, entity, tick) => ...)`
- 杂项：`burnTime(ticks)`、`fireResistant(true)`、`tag(rl)`、`group(tabId)`、
  `containerItem(itemId)`（合成后剩余物）、`modifyAttribute(attr, id, value, op)`、
  `barWidth(stack => 0~13)`、`barColor(stack => Color.AQUA)`

### 工具类型方法

`tier('wood'|'stone'|'iron'|'gold'|'diamond'|'netherite')`、`modifyTier(t => ...)`（自定义 tier 语法）、
`attackDamageBaseline(d)`（自制武器类型才改）、`attackDamageBonus(d)`、`speedBaseline(s)`、`speed(s)`

### 盔甲类型方法

`tier('leather'|'chainmail'|'iron'|'gold'|'diamond'|'turtle'|'netherite')`、`modifyTier(t => ...)`

### 原版创造栏 group id

`search`、`buildingBlocks`、`decorations`、`redstone`、`transportation`、
`misc`、`food`、`tools`、`combat`、`brewing`

### 食物 food builder（版本分叉：1.21 用 nutrition，1.20~1.19 用 hunger）

```js
event.create('magic_steak').food(food => {
  food
    .nutrition(6)                              // 1.21；旧版写 .hunger(6)
    .saturation(6)                             // 实际回复 ≈ min(hunger*sat*2 + sat, 剩余饥饿值)
    .effect('minecraft:speed', 600, 0, 1)      // (效果, 时长tick, 等级, 概率)
    .removeEffect('minecraft:poison')
    .alwaysEdible()                            // 满饥饿也能吃（金苹果）
    .fastToEat()                               // 快速进食（干海带）
    .meat()                                    // 狗可吃
    .eaten(ctx => ctx.player.tell('好吃'))     // 食用回调
})
```

**可重载回调技巧**：`eaten` 等回调内的代码改完要重启；把回调指向 `startup_scripts/` 顶层
事件外的 `global.xxx` 函数，即可用 `/kubejs reload startup_scripts` 即时重载：

```js
event.create('magicer_steak').unstackable()
  .food(food => food.nutrition(7).eaten(ctx => global.myReloadable(ctx)))
global.myReloadable = ctx => ctx.player.tell('改完 reload 即生效')
```

## 方块注册

```js
StartupEvents.registry('block', event => {
  event.create('example_block')                 // kubejs:example_block，自动生成名字与贴图（创造栏 KubeJS 页）
    .displayName('My Custom Block')
    .soundType('wool')                          // 材质：影响音效与部分属性
    .hardness(1)                                // 硬度（挖掘时间）
    .resistance(1)                              // 爆炸抗性
    .requiresTool(true)                         // 必须用工具才掉落（配合下面两个标签）
    .tagBlock('minecraft:mineable/pickaxe')     // 镐子挖掘加速
    .tagBlock('minecraft:needs_iron_tool')      // 至少铁镐等级
    .tagBlock('my_namespace:my_tag')            // 任意自定义方块标签
})
```

### 方块类型（create 第二参）

`basic`（默认）、`slab`、`stairs`、`fence`、`fence_gate`、`pressure_plate`、`wall`、
`button`、`falling`（沙类重力方块）、`crop`（作物；额外方法 `.survive()`/`.crop()`/`.growTick()`/
`.item()` 指种子物品）、`cardinal`、`detector`

全部方法见官方 wiki 的 BlockBuilder 参考页（ref/BlockBuilder）。
