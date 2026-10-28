# 战利品表、谓词与物品修饰器（Loot / Predicate / Item Modifier）

三件套都放数据包：`loot_tables/`、`predicates/`、`item_modifiers/`，彼此可互相引用复用。

## 战利品表骨架

`data/<ns>/loot_tables/<路径>/<id>.json`：

```json
{
  "type": "minecraft:chest",
  "pools": [
    {
      "rolls": 3, "bonus_rolls": 1,
      "entries": [
        { "type": "minecraft:item", "name": "minecraft:diamond", "weight": 2 },
        { "type": "minecraft:item", "name": "minecraft:iron_ingot", "weight": 8,
          "functions": [ { "function": "minecraft:set_count", "count": { "min": 1, "max": 4 } } ] },
        { "type": "minecraft:empty", "weight": 5 }
      ]
    }
  ]
}
```

- `type`：`block/entity/chest/fishing/gameplay/archaeology/gift...`，决定可用上下文参数
- `rolls` 支持数值或 `{min,max}`、`{"type":"minecraft:uniform",...}` 等数值提供器
- entries 类型：`item`、`tag`（expand:true 平铺）、`loot_table`（嵌套别的表）、`dynamic`（如方块自身掉落 self）、`empty`（空签做概率）、`alternatives/group/sequence`（分支组合）

## 常用 functions（修改产出物）

- `set_count`、`set_damage`、`set_components`（写物品组件，1.20.5+ 替代 set_nbt）、`set_name`、`set_lore`、`set_enchantments`
- `apply_bonus`（时运/抢夺加成，`formula: ore_drops` 是矿石翻倍机制）、`limit_count`、`furnace_smelt`（烧炼，配 match_tool 丝绸判断做生熟切换）、`copy_components/copy_name`
- `looting_enchant`：按抢夺等级追加数量

## 常用 conditions（概率与门槛）

- `random_chance`（0~1 概率）、`random_chance_with_looting`
- `killed_by_player`（玩家击杀才掉）
- `entity_properties`（对 this/killer 等目标做谓词检查，如 `on_fire`）
- `match_tool`（检测工具，如精准采集）、`survives_explosion`
- `inverted`（取反）、`any_of/all_of`（逻辑组合）、`weather_check`、`time_check`、`location_check`
- `value_check` + `score`：读记分板分数做条件（把抽奖/商店系统的分数接进掉落）

## 谓词（predicate）：可复用条件

`data/<ns>/predicates/<id>.json` 的内容就是一个 condition（或数组）：

```json
{
  "condition": "minecraft:entity_properties",
  "entity": "this",
  "predicate": { "type": "minecraft:player", "location": { "dimension": "minecraft:the_nether" } }
}
```

- 三处复用：战利品表 `{ "condition": "minecraft:reference", "name": "mypack:my_pred" }`、命令 `execute if predicate mypack:my_pred`、进度触发条件
- 抽成谓词文件比到处复制 condition 好维护

## 物品修饰器（item_modifier）：可复用函数

`data/<ns>/item_modifiers/<id>.json` 的内容就是一个 loot function（或数组），两处用：

```
/item modify entity @s weapon.mainhand mypack:add_lore
```

- 战利品表里 `{ "function": "minecraft:reference", "name": "mypack:add_lore" }`
- 典型：统一给装备加 lore/属性修饰/耐久，比逐个 set_xxx 干净

## 结构战利品箱

容器（箱子/桶/漏斗）NBT 写 `LootTable: "mypack:chests/xxx"` 即可延迟滚点；在自定义结构里见 17-dimension-and-structure。

> 本条目知识点结构参考了 B 站/抖音 UP 主「筱燚」的《数据包 / 资源包 / 实例》系列教程（第 33~35 期），正文按 Minecraft 官方 wiki 与公开文档重写。感谢社区创作者的整理与分享。
