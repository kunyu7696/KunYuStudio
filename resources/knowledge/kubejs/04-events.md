# KubeJS 交互事件速查（方块 / 物品）

> 依据 KubeJS 官方 wiki（kubejs.com/wiki/tutorials/block-interactions 与 item-interactions）重写整理。
> 适用：KubeJS 6/7（MC 1.19 ~ 1.21.x）；1.18.2 旧语法仅作对照。

## 基本规则

- 方块交互事件（BlockEvents）可放 `server_scripts/` 或 `client_scripts/`。
- 物品交互事件（ItemEvents）一般放 `server_scripts/`。
- 1.19.2+ 用 `BlockEvents.xxx('方块id', event => ...)`；1.18.2 用 `onEvent('block.xxx', ...)` + 手动 if 过滤。
- 标注「可取消」的事件可用 `event.cancel()` 阻止原版行为。

## BlockEvents 方块交互

```js
// 挖掘后替换：石头被挖掉原地变圆石（broken 可取消）
BlockEvents.broken('minecraft:stone', event => {
  event.block.set('minecraft:cobblestone')
  event.cancel()                       // 取消原版破坏流程（不掉落物）
})

// 左键点击（可取消）：点沙子给圆石并移除沙子
BlockEvents.leftClicked('minecraft:sand', event => {
  event.player.give('minecraft:cobblestone')
  event.block.set('minecraft:air')
})

// 放置后替换（可取消）：放下工作台变原木
BlockEvents.placed('minecraft:crafting_table', event => {
  event.player.tell('NO CRAFTING FOR YOU')
  event.block.set('minecraft:oak_log')
})

// 右键点击（可取消）：禁用打开箱子
BlockEvents.rightClicked('minecraft:chest', event => event.cancel())

// 耕地踩踏（1.19.2+，可取消）：穿摔落保护 IV 靴子时不踩坏耕地
BlockEvents.farmlandTrampled(event => {
  if (event.player.feetArmorItem.hasEnchantment('minecraft:feather_falling', 4)) event.cancel()
})
```

## ItemEvents 物品交互

```js
// 阻止捡起圆石（1.19.2+，可取消）
ItemEvents.canPickUp('minecraft:cobblestone', event => event.cancel())

// 合成出钻石靴子时给玩家加游戏阶段（不可取消；需 GameStages 类模组配合）
ItemEvents.crafted('minecraft:diamond_boots', e => e.addGameStage('myCoolStage'))

// 禁止丢弃圆石（可取消）
ItemEvents.dropped('minecraft:cobblestone', e => e.cancel())

// 物品右键实体（可取消）：空桶右键山羊挤奶
ItemEvents.entityInteracted('minecraft:bucket', event => {
  if (event.target.type != 'minecraft:goat') return
  event.item.count--
  event.player.giveInHand('minecraft:milk_bucket')
  event.target.playSound('minecraft:entity.cow.milk')
})

// 无目标右键（空手/对空气，可取消）/ 无目标左右键首次按下（不可取消）
ItemEvents.rightClicked(event => { /* ... */ })
ItemEvents.firstRightClicked(event => { /* ... */ })
ItemEvents.firstLeftClicked(event => { /* ... */ })

// 进食触发（可取消）——见 05 篇的 foodEaten 计数示例
ItemEvents.foodEaten(event => { /* ... */ })

// 烧炼完成（不可取消）
ItemEvents.smelted(event => { /* ... */ })
```

## 常用事件对象成员

- `event.player`：玩家——`.give(物品)`、`.giveInHand(物品)`、`.tell(文本)`、`.feetArmorItem`、`.persistentData`
- `event.block`：方块——`.set('id')` 替换、`.id`
- `event.item`：手持物品栈——`.count--`、`.id`
- `event.target`（entityInteracted）：被点实体——`.type`、`.playSound('音效id')`
