# 进度（Advancements）

## 文件与结构

`data/<ns>/advancement/<id>.json`

```json
{
  "parent": "minecraft:story/root",
  "display": {
    "icon": { "item": "mymod:ruby" },
    "title": "获得第一颗红宝石",
    "description": "挖掘红宝石矿石",
    "frame": "task",
    "announce_to_chat": false,
    "show_toast": true,
    "hidden": false
  },
  "criteria": {
    "got_ruby": {
      "trigger": "minecraft:inventory_changed",
      "conditions": { "items": [ { "items": ["mymod:ruby"] } ] }
    }
  },
  "requirements": [ ["got_ruby"] ]
}
```

- frame：task（圆角）/ goal（菱形）/ challenge（挑战，经验奖励）
- 根进度（无 parent）需要 background 字段（指向方块贴图，仅根可见）

## 常用触发器 trigger

- `minecraft:inventory_changed`：物品栏变化（items 条件，最常用）
- `minecraft:mined_block`：破坏方块（block: id）
- `minecraft:player_killed_entity`：击杀实体（entity type 条件）
- `minecraft:entity_killed_player`：被某实体杀死
- `minecraft:consume_item`：吃下物品
- `minecraft:changed_dimension`：切换维度（to: the_nether）
- `minecraft:location`：进入坐标/结构（located 条件：village/stronghold）
- `minecraft:item_durability_changed`、`minecraft:enchanted_item`、`minecraft:brewed_potion`
- `minecraft:tick`：每 tick 检测（配合自定义 predicate，慎用）

## requirements 逻辑

- `[ ["a"], ["b"] ]`：AND（全部满足）
- `[ ["a", "b"] ]`：OR（同组任一）
- 多条件复杂组合：外层 AND，内层 OR

## 奖励 rewards

```json
"rewards": {
  "recipes": ["mymod:ruby_block"],
  "loot": ["mymod:rewards/ruby_bonus"],
  "experience": 100,
  "function": "mymod:unlock_all"
}
```

## 设计建议

- 引导链用 parent 串树：root → 采集 → 合成 → 进阶；隐藏挑战进度 `hidden: true`
- toast 频率控制：链式进度连续弹出会刷屏，中间节点 `show_toast: false`
