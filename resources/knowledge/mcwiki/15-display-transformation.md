# 展示实体与 transformation（Display Entities）

三种展示实体（1.19.4+）：`item_display`、`block_display`、`text_display`，只渲染、无碰撞无 AI，是原版「自定义模型/悬浮文字/装饰」的主力载体。

## 生成与变换字段

```
/summon item_display ~ ~ ~ {item:{id:"minecraft:diamond_sword",count:1},
  transformation:{translation:[0f,1f,0f],scale:[2f,2f,2f],
    left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f]}}
```

- `translation`：平移偏移（**实体本身坐标不变**，只是渲染位置偏移）
- `scale`：缩放，**以模型中心点为基准**拉伸，不是从脚下
- `left_rotation` / `right_rotation`：旋转。四元数 `[x,y,z,w]`，或轴角写法 `{axis:[0f,1f,0f],angle:45f}`（angle 单位为度）；左乘/右乘顺序影响最终结果，叠加旋转时注意
- 动态修改（数据包核心手法）：

```
data modify entity @e[tag=my_model,limit=1] transformation.scale set value [1f,3f,1f]
data modify entity @e[tag=my_model,limit=1] transformation.translation set value [0f,2f,0f]
```

## 插值动画

- `interpolation_duration`：变换过渡 tick 数（>0 时客户端平滑插值）
- `start_interpolation`：设为 0 立即从当前值开始插值；改 transformation 前先把 start_interpolation 设 0，否则不生效
-  teleport_duration：实体位置移动的平滑（与 transformation 插值是两回事）

## 矩阵形式（高级）

transformation 也可以直接写成 4×4 行主序 16 个浮点的矩阵：

```
transformation:[1f,0f,0f,0f, 0f,1f,0f,0f, 0f,0f,1f,0f, 0f,0f,0f,1f]   # 单位矩阵
transformation:[2f,0f,0f,0f, 0f,2f,0f,0f, 0f,0f,2f,0f, 0f,0f,0f,1f]   # 三轴等比×2
```

- 矩阵形式能表达**错切（shear）**等非刚体变换，是四元数字段做不到的
- 多次旋转/复合变换手算矩阵易错，建议先用平移+轴角搭好再换算；显示实体只是 transformation 的演示载体，同一套数学适用于任何接受变换的场景

## 其他常用字段

- `billboard`：`center`（始终面向玩家）/ `vertical` / `horizontal` / `fixed`
- `brightness`：`{block:15,sky:15}` 强制亮度，悬浮文字常配
- text_display：`text`（文本组件）、`background`（ARGB 背景色，0 为透明）、`see_through`、`text_opacity`
- item_display 可带 `item_display` 上下文（gui/ground/fixed 等），复用物品模型 display 槽位

## 悬浮文字（text_display 典型用法）

```
/summon text_display ~ ~2 ~ {text:'{"text":"欢迎","color":"gold"}',
  billboard:"center",background:0,see_through:1b}
```

- 多行/多色用文本组件数组拼接；动态改字：`data modify entity ... text set value ...`

> 本条目知识点结构参考了 B 站/抖音 UP 主「筱燚」的《数据包 / 资源包 / 实例》系列教程（第 5、57~61 期），正文按 Minecraft 官方 wiki 与公开文档重写。感谢社区创作者的整理与分享。
