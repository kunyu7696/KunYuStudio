/**
 * 通用建模器文档模型类型（ModelDocument）。
 *
 * 定位：ModelDocument 是建模器的原生文档（层级/多贴图/动画/格式元数据的唯一存放处），
 * `ModelAsset`（content.ts）降级为"编译产物 / 交换格式"（原建模器通用化方案 §4.2）。
 *
 * 本层为纯数据层：不依赖 DOM/three/Electron；所有字段必须可 JSON 序列化
 * （IPC 传输与 .kunyu/modeler/<id>.json 落盘的前提）。
 * 坐标约定：16 单位 = 1 方块，Y 轴向上；文档本身不做 0..16 夹取——
 * 越界约束属于格式能力（javaBlock 导出时降级），文档层保持通用。
 */

/** 二维向量（贴图像素坐标 / UV 尺寸） */
export type Vec2 = [number, number]
/** 三维向量（模型空间坐标 / 欧拉角度，单位：度） */
export type Vec3 = [number, number, number]

/** 稳定节点标识（选择/场景桥/动画通道/撤销全部以 id 为目标，不用数组下标） */
export type NodeId = string
export type TextureId = string
export type AnimationId = string

/** v1 支持的文档格式（free 为内部通用格式，无游戏约束） */
export type FormatId = 'java_block' | 'java_item' | 'bedrock_entity' | 'bedrock_block' | 'geckolib' | 'free'

/** 立方体六个面（Minecraft 原版命名） */
export const FACE_NAMES = ['north', 'south', 'east', 'west', 'up', 'down'] as const
export type FaceName = (typeof FACE_NAMES)[number]

/** 允许的面内贴图旋转角 */
export type FaceRotation = 0 | 90 | 180 | 270

/** 原版 display 槽位 */
export const DISPLAY_SLOTS = [
  'thirdperson_righthand',
  'thirdperson_lefthand',
  'firstperson_righthand',
  'firstperson_lefthand',
  'head',
  'gui',
  'ground',
  'fixed'
] as const
export type DisplaySlot = (typeof DISPLAY_SLOTS)[number]

/** 单面的 UV/贴图绑定（faces 中缺键 = 该面剔除不渲染） */
export interface FaceBinding {
  /** [u1, v1, u2, v2] 贴图像素坐标 */
  uv?: [number, number, number, number]
  /** 绑定的贴图 id（对应 doc.textures 键）；缺省 = 无贴图纯色面 */
  texture?: TextureId
  /** 面内贴图旋转（90° 倍数） */
  rotation?: FaceRotation
  /** 原版 cullface（按邻块面剔除） */
  cullface?: FaceName
  /** 原版染色索引（草/树叶等） */
  tint?: number
}

/** box-uv 绑定：十字展开在贴图上的左上角像素坐标 */
export interface BoxUvBinding {
  uvOffset: Vec2
}

/** 全体节点公共字段 */
export interface ModelNodeBase {
  id: NodeId
  name: string
  /** 父节点；null = Outliner 顶层（出现在 doc.root 中） */
  parent: NodeId | null
  visible: boolean
  locked: boolean
}

/** 立方体节点：from/to 为父空间坐标 */
export interface CubeNode extends ModelNodeBase {
  type: 'cube'
  from: Vec3
  to: Vec3
  /** 立方体旋转中心（Java origin 语义） */
  origin: Vec3
  /** 三轴旋转角（度）；Java 导出时按能力矩阵降级（单轴 ±45°、22.5° 步进）并告警 */
  rotation: Vec3
  /** 原版 inflate（面外扩） */
  inflate?: number
  /** 原版 shade（环境光遮蔽明暗），缺省 true */
  shade?: boolean
  faces: Partial<Record<FaceName, FaceBinding>>
  /** box-uv 模式绑定；与 faces[].uv 互斥由格式层裁决（文档层两者均可存在） */
  boxUv?: BoxUvBinding
}

/** 组/骨骼节点：children 保存子节点顺序（父子即骨骼链） */
export interface GroupNode extends ModelNodeBase {
  type: 'group'
  children: NodeId[]
  /** 骨骼 pivot（旋转中心） */
  origin: Vec3
  rotation: Vec3
  scale?: Vec3
}

/** 定位器节点：标记挂点（动画/生成链路引用），无几何 */
export interface LocatorNode extends ModelNodeBase {
  type: 'locator'
  position: Vec3
}

/**
 * 网格面（B4-1，v2）：3 = 三角 / 4 = 四边，顶点索引按逆时针（法线朝外）。
 * 不支持 ngon（对齐 .bbmodel mesh 文档化子集）。
 */
export interface MeshFace {
  /** 顶点索引（指向所属 MeshNode.vertices 下标），长度 3 或 4 */
  vertices: number[]
  /** 逐顶点 UV（贴图像素坐标，v 向下），长度与 vertices 一致 */
  uv: Vec2[]
  /** 绑定贴图 id；缺省 = 无贴图灰面 */
  texture?: TextureId
}

/**
 * 网格节点（B4-1，v2）：自由多边形几何。
 * 顶点跨面共享（真索引网格），存放在父空间（与 cube.from/to 同语义）；
 * origin/rotation 与立方体同模型——局部矩阵 T(origin)·R·T(−origin)。
 * v2 不进入绘画/UV 编辑器（逐顶点 UV 与 cube 的 per-face rect 不同体系）。
 */
export interface MeshNode extends ModelNodeBase {
  type: 'mesh'
  /** 顶点（父空间坐标，跨面共享） */
  vertices: Vec3[]
  faces: MeshFace[]
  /** 旋转中心（同立方体 origin 语义） */
  origin: Vec3
  rotation: Vec3
  /**
   * 逐顶点蒙皮权重（v3 C3a 权重绘制）：与 vertices **等长**，每项为
   * { 组节点 id: 权重 }（0–1，绘制后逐顶点归一化到和 1）；空对象 = 该顶点
   * 不受任何骨骼影响。缺省 = 全刚性（glTF 导出回退「顶点刚性跟随父组」）。
   * 仅 glTF 蒙皮导出消费（JOINTS_0/WEIGHTS_0，最多 4 关节/顶点）；
   * MC 原版/基岩格式不支持逐顶点权重（导出时告警并忽略）。
   * 顶点增删（环切/切刀）由编辑链同步扩展本数组。
   */
  weights?: Record<NodeId, number>[]
}

export type ModelNode = CubeNode | GroupNode | LocatorNode | MeshNode

export function isCubeNode(node: ModelNode): node is CubeNode {
  return node.type === 'cube'
}
export function isGroupNode(node: ModelNode): node is GroupNode {
  return node.type === 'group'
}
export function isLocatorNode(node: ModelNode): node is LocatorNode {
  return node.type === 'locator'
}
export function isMeshNode(node: ModelNode): node is MeshNode {
  return node.type === 'mesh'
}

/**
 * 贴图动画元数据（B2-1 flipbook）：Java .png.mcmeta 公开格式子集。
 * 贴图本体为竖直拼接帧条（height = width × 帧数）；frametime 单位 = 游戏刻。
 */
export interface TextureAnimation {
  /** 每帧停留刻数（≥1） */
  frametime: number
  /** 帧间插值（缺省 false） */
  interpolate?: boolean
  /** 自定义帧序（0 基索引，可重复；缺省 = 顺序播放全部帧） */
  frames?: number[]
}

/**
 * 纹理层（B2-2，v2）：多层编辑源。
 * data 始终是像素唯一事实来源；layers 为编辑态缓存，
 * 任何层变更后由渲染层烘焙为单张 data 写回文档。
 */
export interface TextureLayer {
  id: string
  name: string
  /** data:image/png;base64,...（本层像素，尺寸必须等于贴图画布） */
  data: string
  /** 可见性（烘焙时跳过 false 层） */
  visible: boolean
  /** 不透明度 0–1（烘焙时 globalAlpha） */
  opacity: number
}

/**
 * 参考图（B3-1，v2）：视口底衬图，不入烘焙/导出链。
 * 仅作建模对齐参照，渲染层用 THREE.PlaneGeometry 承载。
 */
export interface ReferenceImage {
  id: string
  name: string
  /** data:image/png;base64,...（文档自包含） */
  data: string
  /** 平面中心位置（模型空间坐标，16 单位 = 1 方块） */
  position: Vec3
  /** 平面尺寸（宽度 × 高度，16 单位 = 1 方块） */
  size: Vec2
  /** 不透明度 0–1 */
  opacity: number
  /** 是否可见 */
  visible: boolean
}

/** 贴图：v1 内嵌 data URL（单文件原子保存、跨进程简单）；上限 512×512 由 UI/格式层把关 */
export interface ModelTexture {
  id: TextureId
  name: string
  width: number
  height: number
  /** data:image/png;base64,...（文档自包含设计：data 始终是像素唯一事实来源） */
  data: string
  /**
   * 纹理层编辑源（可选，B2-2）。
   * 存在时层栈为编辑事实；data 为烘焙结果，导出/渲染/生成全部以 data 为准。
   * 空数组视为无层（回退单基层）。
   */
  layers?: TextureLayer[]
  /**
   * 独立 PNG 文件引用（可选，POSIX 相对路径，如 textures/foo.png）。
   * 仅作格式互操作元数据：.bbmodel 导入时保留 path、导出时写回并把 PNG
   * 物化到导出目录（随格式导出落地）；文档落盘与渲染始终以 data 内嵌为准，
   * 本字段不参与像素加载链，可为空（缺省 = 无外部引用）。
   */
  file?: string
  /** UV 画布尺寸（缺省等于 width×height） */
  uvSize?: Vec2
  visible: boolean
  /**
   * flipbook 动画元数据（可选）。存在时该贴图被视为竖直帧条：
   * height = width × 帧数；生成器落盘 PNG 旁写同名 .png.mcmeta。
   */
  animation?: TextureAnimation
}

/** 关键帧插值方式 */
export type Interpolation = 'linear' | 'catmullrom' | 'step'
/** 动画循环模式（hold = 最后一帧定格，对应 Bedrock hold_on_last_frame） */
export type LoopMode = 'once' | 'loop' | 'hold'
export type AnimationChannelName = 'rotation' | 'position' | 'scale'

/**
 * Bezier 缓动（v2 曲线编辑器）：W3C cubic-bezier(x1,y1,x2,y2) 公开定义。
 * 记在前一帧上、管辖「本帧 → 下一帧」区间，仅对 linear 区间生效。
 */
export interface BezierEasing {
  cp: [number, number, number, number]
}

export interface Keyframe {
  /** 秒 */
  time: number
  value: Vec3
  interpolation: Interpolation
  /** 自定义缓动（可选；catmullrom/step 区间忽略） */
  easing?: BezierEasing
}

/** 单节点动画通道（轨道 = 骨骼 × 通道） */
export interface NodeAnimationChannels {
  rotation?: Keyframe[]
  position?: Keyframe[]
  scale?: Keyframe[]
}

export interface ModelAnimation {
  id: AnimationId
  name: string
  /** 秒 */
  length: number
  loop: LoopMode
  /** 键 = 目标节点 id；节点删除时由 document 层同步清理 */
  channels: Record<NodeId, NodeAnimationChannels>
}

/* ------------------------------------------------------------------ */
/* 动画控制器（B1-2，v2）：状态机定义 → Java 代码生成                       */
/* ------------------------------------------------------------------ */

/**
 * 转移条件枚举（「Molang 子集」落地形态）：v2 只覆盖 Java 生成端可直接判定的
 * 四个谓词。molang 风格字符串存储便于后续扩展全语言；
 * always = 无条件转移（进入状态即立即求值，适合串联一次性动画）。
 */
export const CONTROLLER_CONDITIONS = ['always', 'is_moving', 'is_attacking', 'is_hurt'] as const
export type ControllerCondition = (typeof CONTROLLER_CONDITIONS)[number]

/** 状态间转移：from 状态播放中每 tick 求值条件，首个满足者切换 */
export interface ControllerTransition {
  /** 源状态名 */
  from: string
  to: string
  condition: ControllerCondition
}

/** 动画控制器状态：引用文档内动画；缺省用进入时的循环模式 */
export interface ControllerState {
  name: string
  /** 引用 doc.animations 的动画 id */
  animation: AnimationId
}

/**
 * 动画控制器：状态机 + 初始状态 + 转移表。
 * 存放在 formatData.controllers（数组，v2 仅消费第一个），
 * 不进入 nodes/animations 主结构——控制器是「生成链元数据」而非几何/动画本体。
 */
export interface ModelAnimationController {
  name: string
  initialState: string
  states: ControllerState[]
  transitions: ControllerTransition[]
}

/** display 槽位变换 */
export interface DisplayTransform {
  rotation?: Vec3
  translation?: Vec3
  scale?: Vec3
}

export interface DocumentSettings {
  /** 默认 UV 模式（新建面/自动 UV 的走向；per-face 与 box 绑定可在节点级混存） */
  uvMode: 'per_face' | 'box'
  /** 兜底贴图画布尺寸（具体尺寸在各 Texture 上） */
  textureSize?: Vec2
  /** 视口可见边界（单位：格） */
  visibleBox?: Vec3
  /** box-uv 展开画布尺寸 */
  boxUv?: { width: number; height: number }
}

export interface DocumentMeta {
  createdAt: number
  updatedAt: number
  editorVersion: string
}

/** 文档树不变量问题码 */
export type DocumentIssueCode =
  | 'missing_node'
  | 'parent_child_mismatch'
  | 'orphan_node'
  | 'duplicate_entry'
  | 'parent_cycle'
  | 'texture_ref_missing'
  | 'animation_node_missing'
  | 'mesh_face_invalid'
  | 'mesh_weights_invalid'

/** 校验问题（nodeId 为关联节点，便于 UI 定位） */
export interface DocumentIssue {
  code: DocumentIssueCode
  message: string
  nodeId?: NodeId
}

/** 建模器源文档（编辑器原生格式，落盘 .kunyu/modeler/<id>.json） */
export interface ModelDocument {
  schemaVersion: 1
  id: string
  name: string
  format: FormatId
  settings: DocumentSettings
  /**
   * 扁平存储：结构操作 O(1)、undo 只记录被改节点、IPC 直传。
   * 层级顺序由 root（顶层）与 group.children（子级）共同表达。
   */
  nodes: Record<NodeId, ModelNode>
  /** Outliner 顶层顺序 */
  root: NodeId[]
  textures: Record<TextureId, ModelTexture>
  /** 参考图（B3-1）：视口底衬，不入烘焙/导出链 */
  referenceImages?: ReferenceImage[]
  animations: Record<AnimationId, ModelAnimation>
  display?: Partial<Record<DisplaySlot, DisplayTransform>>
  /** 格式专属字段透传（Java parent、Bedrock identifier…），保证导入→编辑→导出往返不丢 */
  formatData?: Record<string, unknown>
  meta: DocumentMeta
}
