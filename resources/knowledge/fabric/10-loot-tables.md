# 战利品表（Loot Tables）要点

## 文件位置

- 方块掉落：`data/<ns>/loot_tables/blocks/<block_id>.json`
- 实体掉落：`data/<ns>/loot_tables/entities/<entity_id>.json`
- 缺失时方块不掉落任何东西（实体默认无掉落）

## 顶层结构

```json
{
  "type": "minecraft:block",
  "pools": [ { "rolls": 1, "entries": [ ... ], "conditions": [ ... ], "functions": [ ... ] } ]
}
```

- 多 pool：一个表多个 pool 各自独立掷骰（如一个 pool 掉主物品，另一个 pool 概率掉额外物）

## Entry 类型

- `minecraft:item`：`{ "type": "minecraft:item", "name": "mymod:ruby", "weight": 80 }`
- `minecraft:tag`：从物品标签随机一个
- `minecraft:empty`：空手（weight 权重决定概率，如 1/4 不掉）
- `minecraft:alternatives` / `group` / `sequence`：组合子 entry（条件继承）

## 常用条件 conditions

- `minecraft:survives_explosion`：被炸掉时仍掉落（方块表基本必带）
- `minecraft:random_chance`：`{ "chance": 0.25 }`
- `minecraft:killed_by_player` / `minecraft:entity_properties`：实体表条件
- `minecraft:match_tool`：配合 `minecraft:enchantment_present` 判定精准采集/时运
- 精准采集让方块掉自身而不是掉落物：用两个 alternatives entry 分别 match_tool silk_touch

## 常用函数 functions

- `minecraft:set_count`：`{ "count": { "type": "minecraft:uniform", "min": 1, "max": 3 } }`
- `minecraft:uniform` / `minecraft:binomial`（n,p）分布
- `minecraft:apply_bonus`：时运/抢夺加成，formula `minecraft:ore_drops` 或 `minecraft:binomial_with_bonus_count`
- `minecraft:explosion_decay`：爆炸每破坏一个方块减少一次 roll
- `minecraft:enchant_with_levels`（实体掉落附魔装备）、`minecraft:set_damage`（随机耐久）
- `minecraft:looting_enchant`：抢夺加成（实体）
- `minecraft:set_nbt`：1.20.1 可用（给掉落物打 NBT，如自定义实体掉落带名字的物品）

## 实体掉落范式（稀有物 + 主掉落）

- pool1：rolls=1，item 主掉落（weight 100）+ empty（weight 20），functions 加 looting_enchant
- pool2：rolls=1，random_chance 0.05，稀有 item

## 代码侧引用

- 实体死亡掉落可直接用 JSON 表；若需要动态逻辑（如按阶段掉不同物），重写 `MobEntity.dropLoot(DamageSource, causedByPlayer)` 调 `this.dropItem(ItemConvertible, count)`
- 随机表调试：游戏内 `/loot` 命令测试注入箱子
