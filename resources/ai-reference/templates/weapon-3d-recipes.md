# 3D 武器 Cube 配方库（已验证坐标）

> 供 Agent 生成 `itemType=tool` 武器时直接套用。坐标系：0..16，y+ 向上；
> 每配方给出 elements（from/to/rotation）、贴图分区、display 增强。
> 通用规则：
> - `textureSize: 16`、`texture: "#all"`（六面全写，缺键=剔面）；
>   **uv 必须按 cube 划分子区域**（如刃面 uv [0,0,5,16]、柄面 uv [6,5,11,16]），
>   禁止全部面 [0,0,16,16]——否则同一张图被拉伸到每个零件上，成品是杂色条纹
> - 贴图用 `texture_paint` 生成（禁止手写 pixels），按下方「贴图分区」提示构图
> - 严禁给 cubeModel 配 `parent: "item/handheld"`——parent 链顶为 builtin/generated 时，
>   游戏 ModelLoader 会丢弃 elements 改从 layer0 重建，导致模型全场景隐形；
>   编译器已自动内联原版手持 display（第三/第一人称/GUI/地面等全部槽位），
>   display 仅需写增强槽位做槽位级覆盖；大武器给 `thirdperson_righthand` scale 1.3~1.6
> - rotation 仅单轴、22.5 的倍数、±45 内，origin 必须在该 cube 内部
> - 生成后必须 content_upsert 物品（带 cubeModel）→ 项目生成 → 构建验证

## katana（武士刀，细长微弯）

```json
{
  "textureSize": 16,
  "elements": [
    { "name": "blade",  "from": [7.4, 5, 7.4], "to": [8.6, 15.5, 8.6],
      "rotation": { "origin": [8, 5, 8], "axis": "z", "angle": 22.5 },
      "uvRegion": "刃面 uv [0,0,5,16]（上/下面 [0,0,5,2]）" },
    { "name": "tsuba",  "from": [6.5, 4.6, 6.5], "to": [9.5, 5.4, 9.5],
      "uvRegion": "镡面 uv [6,0,11,5]（侧棱 [6,0,11,2]）" },
    { "name": "tsuka",  "from": [7.3, 0.5, 7.3], "to": [8.7, 4.6, 8.7],
      "uvRegion": "柄面 uv [6,5,11,16]" },
    { "name": "kashira","from": [7.2, 0, 7.2], "to": [8.8, 0.5, 8.8],
      "uvRegion": "铛面 uv [11,13,14,16]" }
  ]
}
```

- 贴图分区（16×16 画布）：x0-4 竖直刃身（脊深色→刃口红→刃尖高光），x6-10/y0-4 镡（金/古铜），
  x6-10/y5-15 柄（深色底+红绳斜纹缠绕），x11-13/y13-15 铛（金属）
- display 增强：`thirdperson_righthand: { scale: [1.3, 1.3, 1.3] }`
- 气质关键词：黑身红刃、雪白刃纹、金镡，按用户描述换色

## greatsword（大剑，宽厚压迫感）

```json
{
  "textureSize": 16,
  "elements": [
    { "name": "blade",   "from": [6.5, 5, 7.25], "to": [9.5, 15, 8.75] },
    { "name": "edge",    "from": [7.4, 5, 7.0],  "to": [8.6, 15, 9.0] },
    { "name": "guard",   "from": [4.5, 4, 7],    "to": [11.5, 5, 9] },
    { "name": "grip",    "from": [7.5, 0.5, 7.5],"to": [8.5, 4, 8.5] },
    { "name": "pommel",  "from": [7, 0, 7],      "to": [9, 0.5, 9] }
  ]
}
```

- 贴图分区：左半宽刃身、右上护手、右下柄与配重
- display 增强：`thirdperson_righthand: { scale: [1.5, 1.5, 1.5] }`

## spear（长枪，超长杆）

```json
{
  "textureSize": 16,
  "elements": [
    { "name": "shaft", "from": [7.5, 0, 7.5],  "to": [8.5, 13, 8.5] },
    { "name": "neck",  "from": [7.3, 13, 7.3], "to": [8.7, 14, 8.7] },
    { "name": "head",  "from": [7.4, 14, 7.4], "to": [8.6, 16, 8.6] }
  ]
}
```

- 贴图分区：竖条杆身木纹/金属，顶部枪头亮色
- display 增强：`thirdperson_righthand: { scale: [1.4, 1.4, 1.4] }`

## staff（法杖，悬浮宝石）

```json
{
  "textureSize": 16,
  "elements": [
    { "name": "shaft", "from": [7.5, 0, 7.5], "to": [8.5, 12, 8.5] },
    { "name": "gem",   "from": [7, 12.5, 7],  "to": [9, 14.5, 9],
      "rotation": { "origin": [8, 13.5, 8], "axis": "y", "angle": 45 } },
    { "name": "ring",  "from": [6.8, 13.2, 7.8], "to": [9.2, 13.8, 8.2],
      "rotation": { "origin": [8, 13.5, 8], "axis": "y", "angle": 45 } }
  ]
}
```

- 贴图分区：杆身、宝石（高饱和+高光点）、环饰
- display 增强：`thirdperson_righthand: { scale: [1.3, 1.3, 1.3] }`

## axe（战斧）

```json
{
  "textureSize": 16,
  "elements": [
    { "name": "handle", "from": [7.5, 0, 7.5], "to": [8.5, 11, 8.5] },
    { "name": "head",   "from": [5, 9, 7.3],   "to": [8.5, 13, 8.7] },
    { "name": "spike",  "from": [7.3, 13, 7.3],"to": [8.7, 14.5, 8.7] }
  ]
}
```

- 贴图分区：柄、斧刃（亮刃口+暗斧背）、顶刺
- display 增强：`thirdperson_righthand: { scale: [1.35, 1.35, 1.35] }`

## dagger（匕首，短巧）

```json
{
  "textureSize": 16,
  "elements": [
    { "name": "blade", "from": [7.5, 4, 7.5],  "to": [8.5, 9.5, 8.5] },
    { "name": "guard", "from": [6.8, 3.4, 7.3],"to": [9.2, 4, 8.7] },
    { "name": "grip",  "from": [7.4, 1, 7.4],  "to": [8.6, 3.4, 8.6] }
  ]
}
```

- display 增强：不需要放大，保持小巧

## 创作指引

1. 用户描述武器时先匹配最近配方，再按描述改坐标/配色（如「更长」→ 刃 to.y 加大 + rotation 微调）
2. 弯刃/斜刃一律用 rotation（22.5 倍数），不要阶梯拼 cube
3. 装饰件（宝石/穗带/符文）用小 cube 叠加，每个面都映射贴图高亮区
4. 生成后自检：所有 from ≤ to；rotation origin 在 cube 内；面 uv 不超 0..textureSize
