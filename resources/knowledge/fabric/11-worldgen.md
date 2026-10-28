# 世界生成（Worldgen）入口

1.20.1 世界生成全部数据驱动（JSON），Fabric API 只负责把自定义内容挂进生物群系。

## 自定义矿石

`data/<ns>/worldgen/configured_feature/ruby_ore.json`：`type: minecraft:ore`，config 里 targets 指定 `target`（stone/deepslate 规则测试）与 state（方块状态），size 矿脉大小。

`data/<ns>/worldgen/placed_feature/ruby_ore.json`：引用 configured_feature，placement：
- `minecraft:count`（每区块次数）、`minecraft:height_range`（`minecraft:trapezoid`/`minecraft:uniform` + height_provider absolute y 区间）、`minecraft:in_square`（区块内 xz 抖动）、`minecraft:biome`（仅匹配群系）

## 挂进生物群系

```java
BiomeModifications.addFeature(BiomeSelectors.foundInOverworld(),
    GenerationStep.Feature.UNDERGROUND_ORES,
    RegistryKey.of(RegistryKeys.PLACED_FEATURE, new Identifier(MOD_ID, "ruby_ore")));
```

- 生成阶段顺序：RAW_GENERATION → LAKES → UNDERGROUND_STRUCTURES → SURFACE_STRUCTURES → UNDERGROUND_ORES → VEGETAL_DECORATION → TOP_LAYER_MODIFICATION

## 自定义生物群系（1.20.1）

- JSON 路径 `data/<ns>/worldgen/biome/<name>.json`：has_precipitation/temperature/downfall/effects（天空/雾/水颜色、环境音、粒子、背景音乐）/spawners/spawn_costs/carvers/features（每阶段一个 tag 或列表）
- 注册无需代码：放进 worldgen/biome 即被注册表加载
- 让群系实际出现：需要通过 multi-noise 参数（`data/minecraft/worldgen/noise_settings/overworld.json` 不可覆盖则用 datapack 密度函数）或自定义维度；简单需求优先用 BiomeModifications 修改现有群系

## 自定义结构（地牢/营地）

- `structure` + `structure_set`（spacing/separation/salt 决定生成密度）+ `template_pool`（jigsaw 池，引用 `structures/<id>.nbt` 结构文件）
- nbt 结构文件用结构方块导出后放 `data/<ns>/structures/`

## 树/花/特征

- 树 = configured_feature type `minecraft:tree`（trunk_provider + foliage_provider + minimum_size 配置）
- 简单装饰（自定义花）：`minecraft:simple_block` 特征 + placed_feature count/rarity_filter/in_square

## 调试

- `/locate feature`、`/place feature <id>` 直接放置 placed_feature 验证
- JSON 报错在启动日志 worldgen 加载阶段，关键字 `Couldn't parse feature configuration`
