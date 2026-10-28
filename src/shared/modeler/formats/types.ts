/**
 * 格式注册表公共契约（方案 §4.1 formats/）。
 *
 * 每种格式一份 FormatDefinition：
 * - capabilities：能力矩阵，UI 按它开关约束提示（而不是在 UI 里写死 Java 规则）；
 * - exportDocument：ModelDocument → 格式产物，携带降级告警（越界/多轴旋转/层级丢失等）；
 * - importDocument：格式产物 → ModelDocument（读时兼容，同样可带告警）。
 *
 * 本层为纯函数层：不依赖 DOM/three/Electron。涉及 PNG 编解码的环节通过
 * 依赖注入（resolvePixels/encodePixels）由调用方提供，shared 层保持环境中性。
 */
import type { FormatId, ModelDocument, ModelTexture, NodeId } from '../types'

/** 格式能力矩阵（UI 约束提示与导出降级裁决的唯一事实来源） */
export interface FormatCapabilities {
  /** 支持的节点类型（mesh = B4-1 自由多边形网格） */
  nodes: { cube: boolean; group: boolean; locator: boolean; mesh: boolean }
  /** 贴图约束：多贴图 / 单张最大边长 / 仅正方形 */
  textures: { multi: boolean; maxSize: number; squareOnly: boolean }
  /** UV 能力：逐面 UV / box-uv / 面内旋转 */
  uv: { perFace: boolean; box: boolean; faceRotation: boolean }
  /** 立方体旋转：free = 三轴自由；singleAxis = 单轴 ±maxAngle、step 步进（Java 原版） */
  rotation: { mode: 'free' | 'singleAxis'; maxAngle?: number; step?: number }
  /** 坐标允许范围（Java 原版 0..16；null = 不限制） */
  coordinateRange: { min: number; max: number } | null
  /** 组层级（导出时是否需要拍平/丢弃组变换） */
  hierarchy: boolean
  /** 骨骼 pivot（组 origin 旋转） */
  pivots: boolean
  /** 动画 */
  animations: boolean
  /** display 槽位 */
  display: boolean
}

/** 导出/导入降级告警（UI 展示「发生了什么损失」的依据） */
export interface FormatDowngrade {
  severity: 'warning' | 'info'
  /** 机器可读代码（测试断言用） */
  code: string
  message: string
  nodeId?: NodeId
}

/** 格式导出结果：产物 + 降级告警列表 */
export interface FormatExportResult<TOutput> {
  output: TOutput
  downgrades: FormatDowngrade[]
}

/** 格式导入结果：文档 + 降级告警列表 */
export interface FormatImportResult {
  doc: ModelDocument
  downgrades: FormatDowngrade[]
}

/** 注入：把文档贴图解码为行优先像素串（'' = 透明，#rrggbb/#rrggbbaa） */
export type ResolvePixels = (tex: ModelTexture) => string[] | null
/** 注入：把行优先像素串编码为贴图 data URL */
export type EncodePixels = (pixels: string[], width: number, height: number) => string

/** 格式定义（编解码双向 + 能力声明） */
export interface FormatDefinition<TExport = unknown, TImport = unknown> {
  id: FormatId
  /** 显示名（UI 格式徽章） */
  name: string
  capabilities: FormatCapabilities
  /** 导出；缺省 = 该格式暂不支持导出 */
  exportDocument?: (doc: ModelDocument, options?: TExport extends void ? void : unknown) => FormatExportResult<TExport>
  /** 导入；缺省 = 该格式暂不支持导入 */
  importDocument?: (input: TImport, options?: unknown) => FormatImportResult
}
