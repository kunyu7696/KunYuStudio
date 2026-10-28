# KubeJS 标签编辑速查

> 依据 KubeJS 官方 wiki（kubejs.com/wiki/tutorials/tags）重写整理。
> 属 B 站《从零开始的 MC 整合包制作教程》系列主题域（注册与标签篇）的官方文档蒸馏。
> 适用：KubeJS 6/7（MC 1.19 ~ 1.21.x）。

## 基本规则

- 标签脚本放 `server_scripts/` 目录，改完 `/reload` 生效。
- 标签按注册表分类（item / block / fluid / entity_type …），**不能按 NBT 打标签**。
- **配方使用的是 item 标签**——即使对象是方块（如 `minecraft:cobblestone`），配方里也用 item 标签。

## 事件写法

```js
// 第一参 = 注册表：'item' / 'block' / 'fluid' / 'entity_type'，或其他模组的注册表（要带命名空间）
ServerEvents.tags('item', event => {
  event.add('forge:cobblestone', 'minecraft:diamond_ore')       // 加入标签
  event.remove('forge:cobblestone', 'minecraft:mossy_cobblestone') // 移除成员
  event.removeAll('forge:ingots/copper')                        // 清空整个标签
  event.add('forge:completely_new_tag', 'minecraft:clay_ball')  // 新标签 = 直接 add 即创建
  event.add('c:stones', '#forge:stone')                         // 标签套标签：第二参加 # 前缀
  event.removeAllTagsFrom('minecraft:stick')                    // 移除某物品上的全部标签
  event.add('itemfilters:check_nbt', 'some_item:with_nbt')      // FTB Quests NBT 检查需要这个标签
})
```

## 行为类标签示例

标签不只给配方用，也驱动游戏行为：

```js
ServerEvents.tags('block', event => {
  // 把高草加进可攀爬标签 → 真的变成可攀爬
  event.add('minecraft:climbable', 'minecraft:tall_grass')
})
```

## 按条件批量加标签

`event.get(tag).getObjectIds()` 取标签成员，配合正则配料过滤：

```js
ServerEvents.tags('item', event => {
  // 把 forge:stone 里所有不含 diorite 的石头搬进 c:stone
  const stones = event.get('forge:stone').getObjectIds()
  const blacklist = Ingredient.of(/.*diorite.*/)
  stones.forEach(stone => {
    if (!blacklist.test(stone)) event.add('c:stone', stone)
  })
})
```

## 常用场景

- 统一模组间同名物品：把各模组的铜锭都塞进 `forge:ingots/copper`（或 1.21 的 `c:ingots/copper`），配方用标签即可互通。
- 挖掘等级/工具类型：`minecraft:mineable/pickaxe`、`minecraft:needs_iron_tool` 等方块标签决定挖掘行为。
- 配方替换前先查标签：`/kjs hand` 手持物品可看其所属全部标签。
