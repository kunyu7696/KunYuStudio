# 资源包与数据包目录结构

## 资源包（客户端，assets）

```
assets/<ns>/
  blockstates/<id>.json         方块状态 → 模型变体
  models/block/<id>.json        方块模型
  models/item/<id>.json         物品模型
  textures/block|item|entity/... PNG 贴图
  geo/entity/<id>.geo.json      GeckoLib 几何（mod 扩展约定）
  animations/entity/...         GeckoLib 动画
  lang/en_us.json, zh_cn.json   语言
  sounds.json                   声音事件声明
  sounds/...                    OGG 音频
  shaders/, font/, texts/...    着色器/字体/署名等
  atlases/blocks.json           雪碧图图集（1.20.1 仍自动；自定义图集用此目录）
```

- 资源包加载失败最常见：JSON 语法错（注意 BOM）、模型引用了 textures 表里不存在的变量

## 数据包（服务端，data）

```
data/<ns>/
  recipes/                     合成/烧炼/切石配方
  loot_tables/blocks|entities|chests/...
  advancement/                 进度
  tags/blocks|items|entity_types|fluids/...
  functions/                   mcfunction
  damage_type/                 伤害类型（1.19.5+）
  worldgen/biome|configured_feature|placed_feature|structure|...
  predicates/ item_modifiers/ recipes/ 的扩展数据
```

- 全局共享：`data/minecraft/tags/...` 可扩展原版标签；`data/minecraft/worldgen/...` 覆盖原版（谨慎）

## 加载与优先级

- 内置模组资源随 jar 加载；外部 datapack/resourcepack 按包顺序覆盖
- 开发时 `/reload` 重载数据包；`F3+T` 重载资源包
- 单模组内不要用外部包覆盖自己的内容，优先级混淆难调试

## 校验

- 启动日志三类错误：`Failed to load datapack`（JSON 结构）、`Couldn't parse ...`（字段值）、`Missing ... referenced by`（引用目标不存在，如配方产物未注册）
- KunYuStudio 生成器统一 stripBom 读写，手编文件也要避开 UTF-8 BOM 导致解析失败
