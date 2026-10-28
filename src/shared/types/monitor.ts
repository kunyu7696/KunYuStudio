/**
 * 版本漂移监测、编译探针与外部运行时（MCP）共享类型（M7）。
 * 主进程 monitorService/probeService/mcpClient 与渲染层
 * aiMonitor store 共用同一模型。
 */
import type { LoaderId, MappingType } from './aiReference'

/** 组合健康灯色：green=最近回测通过 / yellow=上游出新 build 待重测 / red=回测失败 / unknown=未测 / deprecated=已废弃（框架级不可用，冻结）/ beta=上游仍为 Beta，矩阵禁用（向导灰显，待官方 GA） */
export type ComboHealth = 'green' | 'yellow' | 'red' | 'unknown' | 'deprecated' | 'beta'

/** 版本分层：core=主力强制验证 / extended=次主流 / legacy=遗产（新建向导默认隐藏） */
export type VersionTier = 'core' | 'extended' | 'legacy'

/** 版本矩阵中一个加载器×MC 版本组合 */
export interface ComboMatrixCell {
  /** 组合唯一 id，如 fabric-1.20.1 */
  id: string
  loader: LoaderId
  mcVersion: string
  /** 当前登记的加载器版本（监测基线，如 Fabric loader 0.19.5 / Forge 47.4.23） */
  loaderVersion: string
  /** 漂移监测到的上游最新版（仅 UI 提示有新版本，不写进工程） */
  latestLoaderVersion?: string
  mapping: MappingType
  jdk: number
  health: ComboHealth
  /** 文档评估的漂移风险等级 */
  driftRisk: 'low' | 'medium' | 'high'
  /** 是否为 M7 激活路径（仅 fabric/1.20.1 为 true） */
  active: boolean
  /** 该组合登记的模板数量（active 为磁盘实物，其余为储备登记） */
  templateCount: number
  /** 最近一次真实编译回测签字时间（ISO），未测为 null */
  verifiedAt: string | null
  note: string
  /** 版本分层（core/extended/legacy），缺省按 mcVersion 派生 */
  tier?: VersionTier
  /** 组合级门禁健康度（由矩阵门禁真机构建回写 manifest：matrixGate.spec writeBackMatrixHealth） */
  matrixHealth?: {
    templateCount: number
    verifiedCount: number
    passRate: number
    lastVerifiedAt: string | null
  }
  /** 禁用组合（health==='beta' 时为 true：向导格子灰显不可选，创建链路也会被矩阵拦截） */
  disabled?: boolean
}

/** 漂移事件类型：加载器出新版本 / MC 出新版本 / 回测通过 / 回测失败 */
export type DriftEventKind = 'loader-new' | 'mc-new' | 'build-pass' | 'build-fail'

export interface DriftEvent {
  id: string
  comboId: string
  kind: DriftEventKind
  fromVersion: string | null
  toVersion: string | null
  /** ISO 时间 */
  at: string
  message: string
}

/** 上游检查进度阶段 */
export type MonitorStage =
  | 'idle'
  | 'fabric-meta'
  | 'mojang-manifest'
  | 'forge-maven'
  | 'neoforge-maven'
  | 'compare'
  | 'done'

export interface MonitorState {
  checking: boolean
  stage: MonitorStage
  lastCheckAt: string | null
  lastCheckError: string | null
  cells: ComboMatrixCell[]
  events: DriftEvent[]
}

/** 主进程 -> 渲染层监测事件 */
export type MonitorEventType =
  | 'check-started'
  | 'stage'
  | 'combo-drift'
  | 'check-finished'
  | 'probe-progress'
  | 'probe-finished'

export interface MonitorEvent {
  type: MonitorEventType
  /** 单调序号 */
  seq: number
  stage?: MonitorStage
  /** 0-100 */
  progress?: number
  comboId?: string
  drift?: DriftEvent
  state?: MonitorState
  message?: string
  at: string
}

/** 编译探针运行状态 */
export type ProbePhase = 'idle' | 'preparing' | 'downloading' | 'building' | 'signing' | 'pass' | 'fail' | 'skipped'

export interface ProbeStatus {
  comboId: string
  phase: ProbePhase
  /** 0-100，仅运行中有意义 */
  progress: number
  message: string
  /** 结束后写入的灯色 */
  health: ComboHealth
  /** 失败时的错误摘要（命中的错误模式 id 列表） */
  matchedPatternIds?: string[]
  at: string
}

/** mcdev-mcp 静态服务状态分级 */
export type McpStatusKind =
  | 'disabled'
  | 'node-missing'
  | 'package-unavailable'
  | 'not-initialized'
  | 'initializing'
  | 'connecting'
  | 'ready'
  | 'error'

export interface McpStatus {
  kind: McpStatusKind
  /** 已发现的工具名（ready 时非空） */
  tools: string[]
  /** 人类可读说明（引导文案/错误细节） */
  detail: string
  /** init 引导命令（复制按钮用） */
  initCommand: string
  at: string
}

/** 自定义 MCP server 运行时状态 */
export interface CustomMcpRuntime {
  id: string
  name: string
  enabled: boolean
  status: 'connecting' | 'ready' | 'disconnected' | 'error'
  tools: string[]
  error?: string
}
