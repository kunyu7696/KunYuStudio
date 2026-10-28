# 维度与自定义结构（Dimension / Structure）

## 维度类型（dimension_type）

`data/<ns>/dimension_type/<id>.json` 决定一个维度的物理规则：

```json
{
  "ultrawarm": false, "natural": true,
  "coordinate_scale": 1.0,
  "has_skylight": true, "has_ceiling": false,
  "ambient_light": 0.0,
  "min_y": -64, "height": 384, "logical_height": 384,
  "infiniburn": "#minecraft:infiniburn_overworld",
  "effects": "minecraft:overworld",
  "bed_works": true, "respawn_anchor_works": false,
  "piglin_safe": false, "has_raids": true,
  "monster_spawn_light_level": 0,
  "monster_spawn_block_light_limit": 0
}
```

- `min_y + height`：建筑限高范围；`logical_height`：传送到该维度时搜寻落脚点的高度范围
- `coordinate_scale`：相对主世界的坐标缩放（下界=8）
- `effects`：天空/迷雾视觉（overworld/the_nether/the_end）

### 突破限高（覆盖原版维度类型）

在数据包里放 `data/minecraft/dimension_type/overworld.json`，把 `min_y/height` 改大（如 min_y -512、height 1024）即可突破建筑限高——**原理就是数据包覆盖原版文件**。风险：与其他改同一文件的包/模组互斥；已生成的旧区块只有基岩层分布等生成期特征不变，建筑高度上限即时生效；改过高的值会放大存档体积与渲染负担。

## 自定义维度

`data/<ns>/dimension/<id>.json`：

```json
{
  "type": "mypack:my_dim_type",
  "generator": {
    "type": "minecraft:noise",
    "biome_source": { "type": "minecraft:multi_noise", "preset": "minecraft:overworld" },
    "settings": "minecraft:overworld"
  }
}
```

- generator 也可用 `flat`（超平坦）或 `debug`
- 进维度测试：`execute in <ns>:<id> run tp @s ~ ~ ~`；正式做跨维度传送门一般配合自定义方块/结构 + 函数检测触发传送

## 自定义结构生成（拼图/Jigsaw 流程）

原版村庄/掠夺者前哨站式的结构生成四件套：

```
data/<ns>/structure/<name>.nbt           结构方块 SAVE 模式导出的结构文件
data/<ns>/worldgen/template_pool/<id>.json   模板池：哪些 NBT、怎么拼、processors
data/<ns>/worldgen/structure/<id>.json       结构定义：起始池、jigsaw 大小、生物群系、生成高度
data/<ns>/worldgen/structure_set/<id>.json   结构集：散布频率/间距/种子盐值
```

流程要点：

1. 用结构方块 SAVE 模式把搭好的建筑存成 NBT（注意结构尺寸上限，大建筑拆成多块用拼图连接）
2. 拼图方块（jigsaw）标记连接点：`target_pool` 指向下一段模板池、`name/target` 名称配对、生成后变成什么（`final_state`）
3. template_pool 里 `elements` 带权重，`processors` 可加规则（随机替换方块、完整性腐化）
4. structure JSON：`start_pool`、`size`（向外拼的层数 ≤7）、`biomes`、`step`（生成阶段）、`terrain_adaptation`
5. structure_set：`placement` 的 `spacing/separation`（盐值 salt 改动可整体挪生成位置）
6. 测试：`/locate structure <ns>:<id>`、`/place structure <ns>:<id>`、`/place jigsaw ...` 逐段验证

## 结构里的战利品箱

让生成出来的箱子首次打开时自动填充：

- 在结构 NBT 中给箱子/桶等容器写上 `LootTable` 字段，值指向数据包里的战利品表（如 `mypack:chests/my_treasure`），并带 `LootTableSeed` 可选定种子
- 生成后容器先不填充，玩家首次打开时才按表滚点——这是原版沉船/村庄铁匠铺的同一机制
- 编辑结构 NBT 可用外部 NBT 编辑器；战利品表本体写法见 18-loot-predicate-item-modifier

> 本条目知识点结构参考了 B 站/抖音 UP 主「筱燚」的《数据包 / 资源包 / 实例》系列教程（第 29、31、40、66 期），正文按 Minecraft 官方 wiki 与公开文档重写。感谢社区创作者的整理与分享。
