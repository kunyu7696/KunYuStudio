# GeckoLib 骨骼动画实体（blockbench_geo）模板

> 适用：entityType 实体 + `renderer.modelType = "blockbench_geo"`。
> 生成器自动完成：geo.json 落盘 `assets/<ns>/geo/entity/<id>.geo.json`、
> 参数化 idle/walk/attack 动画落盘 `assets/<ns>/animations/entity/<id>.animation.json`、
> GeoEntity 实体类 + GeoModel + GeoEntityRenderer（Yarn 1.20.1，GeckoLib 4.4.9）、
> build.gradle 注入 cloudsmith maven 与 `geckolib-fabric-1.20.1` 依赖、fabric.mod.json depends。
> Agent 只需在 content_upsert 时提供 `renderer.geoJson`（内嵌 .geo.json 文本），
> 禁止手写 Java 渲染层代码，禁止引用未在此登记的 GeckoLib API。

## 硬约束

- 仅允许下列两套内置骨骼模板改尺寸（P2 首期）；骨骼名必须原样保留
  （动画按骨骼名匹配：head / body / arm_left / arm_right / leg_left / leg_right /
  leg_front_left / leg_front_right / leg_hind_left / leg_hind_right）
- `minecraft:geometry[0].description.identifier` 必须是 `geometry.<实体id>`
- 贴图尺寸用 description.texture_width/height 声明（默认 64×64）；贴图像素画走
  `texture_paint` 工具（禁止手写 pixels），uv 必须与贴图分区对应
- cube 的 pivot 是骨骼旋转中心，uv 为盒式 [x, y] 原点（box uv）
- 单位：1 格 = 16 像素；y+ 向上；pivot/origin 坐标系原点在实体脚下中心

## 模板 A：人形（humanoid，64×64）

```json
{
  "format_version": "1.12.0",
  "minecraft:geometry": [
    {
      "description": { "identifier": "geometry.<id>", "texture_width": 64, "texture_height": 64 },
      "bones": [
        { "name": "body", "pivot": [0, 12, 0], "cubes": [
          { "origin": [-4, 12, -2], "size": [8, 12, 4], "uv": [16, 16] } ] },
        { "name": "head", "parent": "body", "pivot": [0, 24, 0], "cubes": [
          { "origin": [-4, 24, -4], "size": [8, 8, 8], "uv": [0, 0] } ] },
        { "name": "arm_left", "parent": "body", "pivot": [5, 22, 0], "cubes": [
          { "origin": [4, 12, -2], "size": [4, 12, 4], "uv": [32, 48] } ] },
        { "name": "arm_right", "parent": "body", "pivot": [-5, 22, 0], "cubes": [
          { "origin": [-8, 12, -2], "size": [4, 12, 4], "uv": [40, 16] } ] },
        { "name": "leg_left", "pivot": [2, 12, 0], "cubes": [
          { "origin": [0, 0, -2], "size": [4, 12, 4], "uv": [16, 48] } ] },
        { "name": "leg_right", "pivot": [-2, 12, 0], "cubes": [
          { "origin": [-4, 0, -2], "size": [4, 12, 4], "uv": [0, 16] } ] }
      ]
    }
  ]
}
```

- 改尺寸：调 size/origin/pivot（保持 pivot 在肢体根部关节处）；uv 按贴图分区平移
- 加装饰（角/帽/尾）：新增 cube 挂到最近骨骼，禁止新增骨骼名以外的自定义骨骼
  （多余骨骼不会被动画驱动，保持静止）

## 模板 B：四足（quadruped，64×64）

```json
{
  "format_version": "1.12.0",
  "minecraft:geometry": [
    {
      "description": { "identifier": "geometry.<id>", "texture_width": 64, "texture_height": 64 },
      "bones": [
        { "name": "body", "pivot": [0, 9, 0], "cubes": [
          { "origin": [-3, 6, -7], "size": [6, 6, 14], "uv": [0, 16] } ] },
        { "name": "head", "parent": "body", "pivot": [0, 11, -7], "cubes": [
          { "origin": [-3, 8, -13], "size": [6, 6, 6], "uv": [0, 0] } ] },
        { "name": "leg_front_left", "pivot": [2, 6, -5], "cubes": [
          { "origin": [1, 0, -6], "size": [2, 6, 2], "uv": [0, 36] } ] },
        { "name": "leg_front_right", "pivot": [-2, 6, -5], "cubes": [
          { "origin": [-3, 0, -6], "size": [2, 6, 2], "uv": [8, 36] } ] },
        { "name": "leg_hind_left", "pivot": [2, 6, 5], "cubes": [
          { "origin": [1, 0, 4], "size": [2, 6, 2], "uv": [16, 36] } ] },
        { "name": "leg_hind_right", "pivot": [-2, 6, 5], "cubes": [
          { "origin": [-3, 0, 4], "size": [2, 6, 2], "uv": [24, 36] } ] }
      ]
    }
  ]
}
```

## 自动生成的动画（无需手写）

生成器按骨骼名参数化烘焙关键帧（正弦 5 点采样，catmullrom 平滑），两参数可调：

| 动画 | 触发 | 周期（speed=1） | 内容 |
| ---- | ---- | ---- | ---- |
| `animation.<id>.idle` | 站立 | 2s 循环 | 头部 ±4° 轻摆 + 躯干呼吸浮动 |
| `animation.<id>.walk` | 移动 | 1s 循环 | 人形：腿 ±25° 对摆、臂 ±20° 反相；四足：对角步态 |
| `animation.<id>.attack` | 攻击 | 0.5s 单次 | 人形：右臂挥击 0→-90°→20°→0；四足：头部撕咬 |

- amplitude（摆幅倍率，默认 1）与 speed（速度倍率，默认 1）为生成参数；
  需要调整时在需求中说明（如「走路慢一点」→ speed 0.7）
- 无法归类（arm/leg 骨骼不足）时只生成 idle，walk/attack 省略，避免怪异抽动

## .animation.json 手改格式（进阶，供生成后微调）

```json
{
  "format_version": "1.8.0",
  "animations": {
    "animation.<id>.walk": {
      "loop": true,
      "animation_length": 1.0,
      "bones": {
        "leg_left": {
          "lerp_mode": "catmullrom",
          "rotation": { "0": [25, 0, 0], "0.5": [-25, 0, 0], "1": [25, 0, 0] }
        }
      }
    }
  }
}
```

- `loop`: true 循环 / `"hold_on_last_frame"` 定格末帧 / 省略为播放一次
- 通道：`rotation`（度）/ `position`（像素）/ `scale`；关键帧键为秒
- 从 Blockbench 导出的 .bbmodel 动画可由工具链转换为该格式
  （骨骼 uuid→名称、关键帧插值映射自动完成，molang 表达式不支持会被跳过）
