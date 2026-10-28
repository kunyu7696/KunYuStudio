# 模型工坊（Modeler）

> KunYuStudio 自研的通用 3D 建模器：架构、文档模型、格式矩阵与操作说明合一。
> **clean-room 红线**：不读取、不复制 Blockbench 源码，仅依据官方 wiki 与公开
> 格式规范独立实现；`.bbmodel` 只做文档化子集互操作。

---

## 一、定位

为 KunYuStudio 五类内容对象（方块 / 物品 / 实体 / 生物群系 / 进度）与自由模型提供
统一的建模能力：立方体 / 骨骼（组）/ 定位点 / 网格四类节点，UV、贴图直绘、
权重蒙皮、关键帧动画全链路，随项目构建编译进资源包或写回实体。

## 二、分层

```
src/shared/modeler/            # 纯数据/数学/命令层（不依赖 DOM/three/Electron）
├─ types.ts                    #   ModelDocument 类型（cube|group|locator 扁平 map + root）
├─ document.ts                 #   CRUD/树不变量/复制重排/序列化（全部不可变更新）
├─ commands.ts                 #   CommandStack + diffDocument 引用差分补丁
├─ transform.ts                #   Mat4/节点局部·世界变换/多选平移/包围盒
├─ uv.ts                       #   自动 UV / box-uv 十字展开 / 面旋转 / 自动排布
├─ query.ts                    #   可见性/射线拾取/文档摘要
└─ formats/                    #   格式注册表：能力矩阵 / 降级告警 / 各格式编解码

src/renderer/src/modules/modeler/
├─ ModelerWorkbench.vue        # 工作台三栏（Outliner / 视口 / 属性 + UV + 贴图）
├─ ModelerViewport.vue         # 3D 视口（gizmo / 选择 / 绘画 / 绘画网格）
├─ ModelerUvEditor.vue         # UV 编辑器（per-face + box-uv，拖拽提交命令栈）
└─ preview/                    # 只读 3D 预览（elements|cube|plane 三形态）

src/renderer/src/stores/modeler.ts   # 文档状态 + 命令栈 + 自动保存调度

src/main/services/modeler/
├─ modelerIo.ts                # PNG 贴图导入/导出（≤512 校验）+ bbmodel 外链贴图物化
└─ modelerBackup.ts            # 显式保存（备份轮转 + 原子写）/ autosave 影子 / 崩溃恢复
```

## 三、文档模型（ModelDocument）

- **扁平 map + root/children 顺序表**：结构操作 O(1)，undo 只记录被触及条目；
- **不可变更新**：所有 `document.ts` 函数返回新文档，Vue shallowRef 与差分
  命令都依赖此约定；
- **树不变量**：父子双向一致、无环、无孤儿；`validateDocument` 统一校验；
- **坐标约定**：16 单位 = 1 方块、Y 向上；文档层不做 0..16 夹取（越界属于
  格式能力，如 java_block 导出时降级告警）；
- **层级语义**：父链连续空间——组旋转绕 pivot 转动整棵子树，子树存储坐标不变；
- **存储**：`.kunyu/modeler/<id>.json`，贴图 base64 内嵌使文档自包含、可随
  项目做版本管理；`MODELER_SCHEMA_VERSION` 版本化，旧文档读取时自动迁移。

## 四、撤销栈

- 命令栈基于 `diffDocument` 引用差分：只记录被触及节点的补丁，内存可控；
- 撤销 / 重做跨工具统一（变换、绘画、权重、UV、结构操作同栈）。

## 五、格式矩阵

- **导出**：Java 方块 / Java 物品模型、Bedrock 实体 / Bedrock 方块、
  GeckoLib、自由模型、OBJ；
- **导入**：`.bbmodel`、OBJ（体素化）、DAE、FBX、glTF、geo.json、
  JEM / JPM、皮肤；
- 能力矩阵驱动降级：目标格式不支持的特性在导出时给出明确告警而非静默丢失。

## 六、界面与入口

- 活动栏「模型工坊」任意项目可用；工坊编辑器右栏 3D 预览可一键跳转；
- 工作台三栏：左 Outliner（节点树 + 贴图）/ 中视口 / 右属性 + UV + 动画时间轴。

## 七、视口操作

- 五工具：移动 / 旋转 / 缩放 / 绘画 / 权重绘制；
- 网格子对象模式：对象 / 顶点 / 面 / 边 / 切刀；
- gizmo 拖拽、框选、多选整体平移；
- 绘画模式：直接在模型表面绘贴图（含不透明度支持），`Alt` 拾色、
  `Shift` 直线；
- 权重绘制：骨骼蒙皮权重刷，支持镜像到 2D 面板。

## 八、UV 编辑

- per-face UV 与 box-uv 十字展开双模式；
- 自动 UV、面旋转、自动排布、整像素吸附；
- 拖拽经命令栈提交，可撤销。

## 九、动画时间轴

- 三通道（位移 / 旋转 / 缩放）关键帧；
- 缓动曲线编辑；
- `.animation.json` 互导；
- 动画控制器状态机（Bedrock controller 编解码）。

## 十、保存与恢复

- `Ctrl+S` 显式保存：备份轮转 + 原子写；
- autosave 影子文档 + 崩溃恢复检测；
- 保存 → 应用到对象 / 实体写回，或随项目构建编译进资源包。

## 十一、快捷键速查

| 分类 | 按键 | 功能 |
| --- | --- | --- |
| 工具 | `W` / `E` / `R` | 移动 / 旋转 / 缩放 |
| 工具 | `B` / `K` | 绘画 / 权重绘制 |
| 网格 | `1`–`5` | 对象 / 顶点 / 面 / 边 / 切刀 |
| 选择 | `Ctrl+A` | 全选 |
| 选择 | `Esc` | 逐级取消选择 / 取消切刀第一点 |
| 编辑 | `Delete` | 删除选中 |
| 编辑 | `Ctrl+Z` | 撤销 |
| 编辑 | `Ctrl+Y` / `Ctrl+Shift+Z` | 重做 |
| 文件 | `Ctrl+S` | 保存 |
| 绘画 | `Alt` | 拾色 |
| 绘画 | `Shift` | 直线 |

## 十二、已知限制

- 复杂网格操作（knife 进阶 / loop cut / 高级 weight paint）后置；
- `.bbmodel` 互操作为文档化子集，不保证覆盖 Blockbench 全部私有扩展；
- 单张贴图尺寸上限 512px。

## 十三、验证命令（Windows PowerShell）

```powershell
node scripts/run-vitest.cjs run src/shared/modeler   # 建模器核心单测
npm run typecheck                                    # 双端类型检查
```

---

*—— kunyu (睏欤)*
