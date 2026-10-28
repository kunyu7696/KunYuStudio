/**
 * 模组性能画像数据模型（依《模组性能画像 + 静态分析规则》设计）。
 *
 * 三阶段数据：
 * - identity / staticFeatures：jar 导入阶段静态分析产出
 * - dynamicMetrics：JFR / Spark 动态采样产出（可为 null）
 * - score / advice：由静态 + 动态数据评分产出
 */

/** 模组唯一标识信息 */
export interface ModIdentity {
  modId: string
  version: string
  /** 加载器：fabric / forge / quilt */
  loader: string
  mcVersion: string
  /** jar 文件 sha256 */
  fileHash: string
  modName: string
  /** jar 在磁盘上的绝对路径（可能为空，如手动导入） */
  filePath: string
}

/** 钩子注入汇总 */
export interface HookSummary {
  tickCallbacks: number
  eventListeners: number
  injectionPoints: number
}

/** 依赖关系汇总 */
export interface DependencySummary {
  hardDeps: string[]
  softDeps: string[]
  /** 声明或检测到的冲突对象 */
  conflicts: string[]
}

/** 字节码风险汇总（计数，明细由 advice 承载） */
export interface BytecodeSummary {
  mainThreadBlockingCalls: number
  tickLoopAllocations: number
  unboundedCaches: number
  unsynchronizedStaticFields: number
  nativeMethodCalls: number
}

/** 静态特征 */
export interface StaticFeatures {
  classCount: number
  mixinCount: number
  mixinTargets: string[]
  hooks: HookSummary
  dependencies: DependencySummary
  bytecode: BytecodeSummary
}

/** 热点方法 */
export interface MethodHotspot {
  className: string
  method: string
  /** 采样自时间占比 0–100 */
  selfPercent: number
}

export interface CpuMetrics {
  sampleDurationMs: number
  averageCpuPercent: number
  topMethods: MethodHotspot[]
}

/** 分配热点类型 */
export interface AllocationHotspot {
  type: string
  bytesPerSec: number
}

export interface MemoryMetrics {
  heapUsedMb: number
  allocationRateMbps: number
  topAllocators: AllocationHotspot[]
}

export interface TickMetrics {
  averageTickMs: number
  /** tick 超时/掉刻次数 */
  tickDrops: number
  tps: number
}

export interface EventCount {
  eventName: string
  count: number
}

/** 动态采样指标 */
export interface DynamicMetrics {
  cpu: CpuMetrics
  memory: MemoryMetrics
  tick: TickMetrics
  events: EventCount[]
  sampledAt: string
  source: 'jfr' | 'spark'
}

/** 五维评分（每维 0–100） */
export interface ScoreSet {
  overall: number
  cpuEfficiency: number
  memoryEfficiency: number
  tickImpact: number
  compatibility: number
}

export type ProfileSeverity = 'good' | 'warn' | 'bad'

export interface ProfileScore {
  scores: ScoreSet
  severity: ProfileSeverity
  tags: string[]
}

/** 建议可执行动作类型（一键优化用；manual = 需用户自行处理） */
export type AdviceAction = 'disable' | 'remove' | 'config' | 'manual'

export type AdviceSeverity = 'low' | 'medium' | 'high' | 'critical'

/** 结论来源：static 静态分析 / runtime 运行时采样 / heuristic 启发式推测 */
export type AdviceSource = 'static' | 'runtime' | 'heuristic'

export interface ProfileAdvice {
  /** 画像内唯一建议 id（ruleId + 序号） */
  id: string
  /** 来源规则 id（R01–R12 或评分规则） */
  ruleId: string
  severity: AdviceSeverity
  /** 结论可信度来源标签（由产出规则决定） */
  source: AdviceSource
  message: string
  /** 证据描述（类/方法/字段/冲突对象） */
  evidence: string
  action: AdviceAction
  /** 动作详情（配置键/目标文件等，执行器使用） */
  actionDetail: string
}

/** 完整模组性能画像 */
export interface ModPerformanceProfile {
  identity: ModIdentity
  staticFeatures: StaticFeatures
  dynamicMetrics: DynamicMetrics | null
  score: ProfileScore
  advice: ProfileAdvice[]
  analyzedAt: string
}

/** 画像业务主键（用于 upsert 与查询） */
export interface ProfileKey {
  modId: string
  version: string
  loader: string
  mcVersion: string
}

/** 排行榜排序维度 */
export type ScoreOrderKey = keyof ScoreSet

/** 排行榜查询参数 */
export interface LeaderboardQuery {
  orderBy: ScoreOrderKey
  loader?: string
  mcVersion?: string
  severity?: ProfileSeverity
  limit?: number
}

/** 排行榜单行：画像标识 + 名称 + 分数 + 建议数（跨进程 DTO） */
export interface LeaderboardEntry extends ProfileKey {
  modName: string
  severity: ProfileSeverity
  tags: string[]
  scores: ScoreSet
  adviceCount: number
}

/** 一键优化安全动作类型（跨进程 DTO） */
export type SafeActionKind = 'disable' | 'remove' | 'config'

export interface PlannedAction {
  kind: SafeActionKind
  /** disable/remove：相对 mods 根路径；config：相对配置根路径 */
  target: string
  configKey?: string
  configValue?: string
  adviceId?: string
}

export type ReceiptStatus = 'done' | 'skipped' | 'rejected'

export interface ActionReceipt {
  adviceId?: string
  kind: SafeActionKind
  target: string
  status: ReceiptStatus
  detail: string
}

export function profileKeyText(key: ProfileKey): string {
  return `${key.modId}|${key.version}|${key.loader}|${key.mcVersion}`
}

/** 画像空静态特征默认值（分析失败时兜底） */
export function createEmptyStaticFeatures(): StaticFeatures {
  return {
    classCount: 0,
    mixinCount: 0,
    mixinTargets: [],
    hooks: { tickCallbacks: 0, eventListeners: 0, injectionPoints: 0 },
    dependencies: { hardDeps: [], softDeps: [], conflicts: [] },
    bytecode: {
      mainThreadBlockingCalls: 0,
      tickLoopAllocations: 0,
      unboundedCaches: 0,
      unsynchronizedStaticFields: 0,
      nativeMethodCalls: 0
    }
  }
}
