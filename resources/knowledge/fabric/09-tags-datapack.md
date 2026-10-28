# 标签（Tags）与数据包（Datapack）

## 标签

- 方块标签 `data/minecraft/tags/blocks/<name>.json` 或 `data/<ns>/tags/blocks/<name>.json`
- 物品标签 `tags/items`；实体 `tags/entity_types`；流体 `tags/fluids`；附魔/状态效果等

```json
{ "replace": false, "values": [ "mymod:ruby_ore", "#minecraft:logs", { "id": "mymod:deepslate_ruby_ore", "required": false } ] }
```

- 引用另一个标签用 `#namespace:name`；`required:false` 时目标缺失不报错
- 代码访问：`BlockTags.create(new Identifier("mymod","gems"))`；服务端用 `world.getRegistryManager().get(RegistryKeys.BLOCK).getOrThrow(tagKey)`
- 物品判断：`stack.isIn(ItemTags...)`（1.20.1 为 `isIn(TagKey)`），方块状态 `state.isIn(BlockTags...)`
- 约定标签：矿物放 `#minecraft:mineable/pickaxe`、需要工具 `#minecraft:needs_iron_tool`；否则挖掘等级不对

## 数据包内容（server-side data）

| 类型 | 路径 |
| --- | --- |
| 合成配方 | `data/<ns>/recipes/<id>.json` |
| 战利品表 | `data/<ns>/loot_tables/blocks|entities/<id>.json` |
| 进度 | `data/<ns>/advancement/<id>.json` |
| 标签 | `data/<ns>/tags/<registry>/<id>.json` |
| 函数 | `data/<ns>/functions/<id>.mcfunction` |
| 修饰器/特征/结构 | `data/<ns>/worldgen/...` |

## 配方 JSON 示例（有序）

```json
{
  "type": "minecraft:crafting_shaped",
  "pattern": [" R ", " R ", " S "],
  "key": { "R": { "item": "mymod:ruby" }, "S": { "item": "minecraft:stick" } },
  "result": { "item": "mymod:ruby_sword", "count": 1 }
}
```

- 无序：`crafting_shapeless` + `ingredients` 数组
- 烧炼：`smelting` + `ingredient` / `result` / `experience` / `cookingtime`

## 战利品表结构（方块）

`type: minecraft:block`，一个 pool：
- `rolls` 次数；`entries`：`minecraft:item`（name）、`minecraft:tag`、空 entry `minecraft:empty`（weight 控制概率）
- `conditions`：`minecraft:survives_explosion`
- `functions`：`minecraft:set_count`（数量区间）、`minecraft:apply_bonus`（时运）、`minecraft:explosion_decay`

## 进度（Advancement）

- `criteria`：常用触发器 `minecraft:inventory_changed`（物品条件）、`minecraft:player_killed_entity`、`minecraft:mined_block`
- 父进度 `"parent": "minecraft:story/root"`；display 定义图标/标题/框型（task/goal/challenge）

## 调试

- `/reload` 重载数据包；启动日志中 `Parsing error loading ...` 为 JSON 语法/引用错误
- 1.20.1 物品 ingredient 写法 `{"item":"..."}` 与 1.21 的 `{"items":[...]}` 不同，注意版本
