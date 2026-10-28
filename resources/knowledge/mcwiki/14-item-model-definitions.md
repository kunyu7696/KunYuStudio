# 物品模型定义（Item Model Definitions，1.21.4+）

1.21.4 起物品显示从「模型 JSON + overrides 谓词」改为独立的**物品模型定义**体系：

```
assets/<ns>/items/<id>.json        ← 定义「这个物品长什么样」（本条目主角）
assets/<ns>/models/item/<id>.json  ← 模型本体（父模型/贴图/display，和旧版一样）
```

## 基本写法（model 类型）

```json
{
  "model": {
    "type": "minecraft:model",
    "model": "mypack:item/my_sword"
  }
}
```

- 没写 items/ 定义时，游戏按约定找 `models/item/<id>.json`（旧行为兼容）
- 父模型常用：`item/generated`（扁平贴图）、`item/handheld`（手持工具）

## condition 类型：二选一

```json
{
  "model": {
    "type": "minecraft:condition",
    "property": "minecraft:using_item",
    "on_true":  { "type": "minecraft:model", "model": "mypack:item/bow_pulling" },
    "on_false": { "type": "minecraft:model", "model": "mypack:item/bow" }
  }
}
```

- 常用 property：`using_item`（正在使用，拉弓/进食蓄力帧）、`has_component`、`selected`（在主手选中）、`custom_model_data`（flags 布尔位）、`xmas`、`shift_down`、`fishing_rod/cast` 等

## select 类型：多分支

```json
{
  "model": {
    "type": "minecraft:select",
    "property": "minecraft:custom_name",
    "cases": [
      { "when": ["黄金剑"], "model": { "type": "minecraft:model", "model": "mypack:item/gold_sword" } }
    ],
    "fallback": { "type": "minecraft:model", "model": "mypack:item/iron_sword" }
  }
}
```

- **命名物品自动变材质（1.21.5+ 推荐做法）**：property 用 `minecraft:custom_name`，铁砧改名即换贴图，不再需要堆 custom_model_data 数字
- 其他 property：`component`（任意组件值匹配）、`charge_type`、`trim_material`、`local_time`（时钟/指南针）、`context_dimension` 等

## range_dispatch 类型：按数值阈值

```json
{
  "model": {
    "type": "minecraft:range_dispatch",
    "property": "minecraft:damage",
    "scale": 1.0,
    "entries": [
      { "threshold": 0.5, "model": { "type": "minecraft:model", "model": "mypack:item/worn" } },
      { "threshold": 0.9, "model": { "type": "minecraft:model", "model": "mypack:item/breaking" } }
    ],
    "fallback": { "type": "minecraft:model", "model": "mypack:item/intact" }
  }
}
```

- 应用：按耐久/数量/蓄力进度切模型帧；property 常用 `count`、`damage`、`custom_model_data`（取 floats 某下标）、`time`、`compass` 等

## composite 类型：多层叠加

```json
{
  "model": {
    "type": "minecraft:composite",
    "models": [
      { "type": "minecraft:model", "model": "mypack:item/potion_layer" },
      { "type": "minecraft:model", "model": "mypack:item/bottle_base" }
    ]
  }
}
```

- 数组里**靠后的条目先渲染（垫底），靠前的后渲染（在上层）**；药水「瓶身+药液分层」就是这个结构
- 每一层都可以再嵌套 condition/select/transformation，组合出「按内容物/数量/耐久换图层」的效果

## custom_model_data 组件（1.21.4 重构后）

```
/give @s apple[minecraft:custom_model_data={floats:[1.0],flags:[true],strings:["vip"],colors:[16711680]}]
```

- 不再是单个数字，而是 floats/flags/strings/colors 四个数组
- 对接：range_dispatch 的 `custom_model_data`（读 floats）、condition 的 `custom_model_data`（读 flags）、select 的 `custom_model_data`（读 strings）

## 进食/使用动画

- 1.21.2+ 物品加 `minecraft:consumable` 组件（`animation: eat/drink/bow/spear...`）获得使用动作与音效
- 蓄力帧贴图 = condition `using_item` 切模型（弓的 pulling_0/1/2 就是这个机制），可再叠 range_dispatch 按使用进度切帧

## 模型变换（display 之外的局部变换）

物品模型定义各层可带 `transformation`（translation/scale/rotation），做「盾牌双态、左手翻转」一类修正；与展示实体的 transformation 概念同构（见 15-display-transformation）

> 本条目知识点结构参考了 B 站/抖音 UP 主「筱燚」的《数据包 / 资源包 / 实例》系列教程（第 50、51、53~56、62、63 期），正文按 Minecraft 官方 wiki 与公开文档重写。感谢社区创作者的整理与分享。
