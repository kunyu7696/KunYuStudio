# 客户端渲染与资源文件

## 模型 JSON（物品/方块）

- 物品模型 `assets/<ns>/models/item/<id>.json`；方块状态 `assets/<ns>/blockstates/<id>.json` → 方块模型 `models/block/<id>.json`
- 物品：`"parent": "minecraft:item/generated"`（贴图 sprite）或 `minecraft:item/handheld`（工具手持姿态）
- 方块模型 parent `minecraft:block/cube_all`（整图六面）/ `cube_bottom_top` / `cube_column`（原木：side/end）
- 自定义 cube 模型（elements）：from/to 0..16，每面 faces 指定 uv 与 texture 变量；**不要**在含 elements 时挂 item/generated 或 handheld 父链（ModelLoader 会丢弃 elements 改从 layer0 重建，模型隐形）

## 贴图

- 方块/物品：`assets/<ns>/textures/item|block/<id>.png`，通常 16×16
- 实体：`textures/entity/<id>.png`，尺寸由模型 UV 决定（人形 64×64）
- 路径用下划线小写；模型里引用 `"<var>": "<ns>:item/<id>"`
- 多贴图变量在模型顶层 `textures` 映射，粒子贴图键固定 `particle`

## Blockbench geo 模型（GeckoLib）

- 落盘 `assets/<ns>/geo/entity/<id>.geo.json`；动画 `assets/<ns>/animations/entity/<id>.animation.json`
- GeoModel 的三个 Identifier：getModelResource / getTextureResource / getAnimationResource
- 骨骼动画 idle/walk 用 AnimationController 的 state.isMoving() 切换

## 渲染器注册

```java
EntityRendererRegistry.register(ModEntities.GOBLIN, GoblinRenderer::new);
EntityModelLayerRegistry.registerModelLayer(GOBLIN_LAYER, GoblinModel::getTexturedModelData);
```

- 自定义 ModelPart：`TexturedModelData.getRoot().addChild("head", ModelPartBuilder.create()...)`；UV 偏移在 `.uv(u,v).cuboid(...)`
- 透明/发光材质：重写 RenderLayer（`RenderLayer.getEntityTranslucentEmissive`）

## HUD 与世界渲染

- `HudRenderCallback`（fabric-rendering-v1）：`DrawContext` 画贴图/文字
- `WorldRenderEvents.AFTER_ENTITIES`：世界空间画线框（MatrixStack + VertexConsumer，1.20.1 立即模式 RenderSystem）
- 粒子：注册 `DefaultParticleType`（alwaysSpawn 工厂），client 注册 ParticleFactory 提供 SpriteProvider

## 声音

- `assets/<ns>/sounds.json` 声明事件 → ogg 放 `assets/<ns>/sounds/...`（必须 OGG 单声道/44.1kHz）
- 代码：`Registry.register(Registries.SOUND_EVENT, id, SoundEvent.of(id))`；`world.playSound(null, pos, event, category, vol, pitch)`

## 常见崩溃

- `FileNotFoundException: models/item/<id>_spawn_egg.json`：刷怪蛋缺模板模型
- `Unable to load model`：模型引用的贴图变量在 textures 表中缺失
- 紫黑方块/品红黑实体：贴图路径错或未刷新资源（F3+T）
