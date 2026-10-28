/**
 * AI 反幻觉参考包共享类型（M7）。
 * 与 resources/ai-reference/manifest.json 的结构一一对应；
 * 主进程 referencePackageService 加载校验，渲染进程经 IPC 只读消费。
 */
import type { ComboHealth } from './monitor'

export type LoaderId = 'fabric' | 'forge' | 'neoforge'

export type MappingType = 'yarn' | 'mojang_official'

/** 参考包覆盖的 12 类内容 */
export type ContentType =
  | 'advancement'
  | 'block'
  | 'command'
  | 'enchantment'
  | 'entity'
  | 'gui'
  | 'item'
  | 'mixin'
  | 'project'
  | 'recipe'
  | 'tag'
  | 'worldgen'

/** 模板编译回测状态（探针签字前为 pending） */
export type BuildStatus = 'pending' | 'pass' | 'fail'

/** 模板来源：pdf=从源 PDF 原样提取；scaffold=依 README 清单重构；mdk-adapted=依官方 MDK 适配改写；translated-from-<loader>-<version>=脚本从种子组合复制并按目标 versionFingerprint 重写版本号（M23 矩阵补齐）；hand-curated=实体域自由代码手工精编（P0 grounding，对照 Yarn 源码逐条核验签名） */
export type TemplateProvenance =
  | 'pdf'
  | 'scaffold'
  | 'mdk-adapted'
  | 'hand-curated'
  | `translated-from-${string}`

export interface AppliesTo {
  loaders: LoaderId[]
  mcVersions: string[]
}

export interface ManifestTemplate {
  id: string
  loader: LoaderId
  version: string
  type: ContentType
  /** 相对参考包根目录的路径，如 templates/fabric/1.20.1/block/simple_block.java */
  file: string
  filename: string
  contentTypes: ContentType[]
  keywords: string[]
  appliesTo: AppliesTo
  /** 探针签字版本/结论，未回测为 null */
  verified: string | null
  verifiedAt: string | null
  build: BuildStatus
  active: boolean
  provenance: TemplateProvenance
}

export interface ActiveVersion {
  loader: LoaderId
  version: string
}

export interface InactiveCombo {
  loader: LoaderId
  version: string
  /** 文档登记的储备模板数（M7 无实物文件） */
  templateCount: number
  active: false
  note: string
}

export interface ScopeControl {
  m7ActiveVersions: ActiveVersion[]
  registeredButInactive: InactiveCombo[]
  rule: string
}

export interface MappingInfo {
  type: MappingType
  identifierClass: string
  registryClass: string
  description: string
}

/** active 组合的模板构建钉版（project/README.md 环境表） */
export interface TemplatePin {
  /** Fabric loader / Forge / NeoForge 加载器版本 */
  loaderVersion: string
  gradle: string
  /** Fabric 专属：yarn 映射版本 */
  yarnMappings?: string
  /** Fabric 专属：fabric-api 版本 */
  fabricApi?: string
  /** Fabric：loom 插件版本；Forge：ForgeGradle 版本区间；NeoForge：ModDevGradle 插件版本 */
  loom?: string
}

export interface VersionFingerprint {
  id: string
  loader: LoaderId
  mcVersion: string
  loaderVersion: string
  mapping: MappingType
  jdk: number
  health: ComboHealth
  verifiedAt: string | null
  driftRisk: 'low' | 'medium' | 'high'
  note: string
  /** 版本分层（core/extended/legacy），缺省按 mcVersion 派生 */
  tier?: import('./monitor').VersionTier
  /** 仅 active 组合：模板实际钉死的工具链版本 */
  templatePin?: TemplatePin
  /** 组合级门禁健康度（由矩阵门禁真机构建回写：matrixGate.spec writeBackMatrixHealth） */
  matrixHealth?: MatrixHealthSummary
}

/** 组合级模板健康度汇总 */
export interface MatrixHealthSummary {
  templateCount: number
  verifiedCount: number
  passRate: number
  lastVerifiedAt: string | null
}

export interface ErrorPattern {
  id: string
  category: string
  categoryLabel: string
  errorType: string
  /** 可直接 new RegExp(pattern) 的正则源串 */
  pattern: string
  severity: 'critical' | 'major' | 'minor' | 'warning' | 'info'
  mcVersions: string[]
  loaders: LoaderId[]
  cause: string
  solution: string
  /** 可选修复代码片段 */
  fixCode?: string
  exampleError: string
}

export interface ApiIndexEntry {
  id: string
  classPath: string
  member: string | null
  kind: 'class' | 'method' | 'field' | 'constructor'
  signature: string
  mapping: MappingType
  loaders: LoaderId[]
  mcVersions: string[]
  example: string
  commonError: string | null
}

/** 文档声明口径与实际产物对照（诚实记录，不凑数） */
export interface VendorClaims {
  document: string
  claimedTemplateFiles: number
  claimedActiveTemplates: number
  claimedInactiveTemplates: number
  claimedErrorPatterns: number
  claimedApiIndex: number
  note: string
}

export interface ManifestStats {
  templateCount: number
  activeTemplateCount: number
  inactiveComboCount: number
  inactiveRegisteredTemplateCount: number
  errorPatternCount: number
  apiIndexCount: number
  contentTypes: number
  provenance: Record<TemplateProvenance, number>
  vendorClaims: VendorClaims
}

export interface ReferenceManifest {
  manifestVersion: string
  generatedAt: string
  description: string
  scopeControl: ScopeControl
  mappingTypes: Record<LoaderId, MappingInfo>
  versionFingerprints: VersionFingerprint[]
  templates: ManifestTemplate[]
  errorPatterns: ErrorPattern[]
  apiIndex: ApiIndexEntry[]
  stats: ManifestStats
}

/* ------------------------- userData overlay（探针回写） ------------------------- */

export interface TemplateOverlayState {
  verified: string | null
  verifiedAt: string | null
  build: BuildStatus
}

export interface ComboOverlayState {
  health: ComboHealth
  verifiedAt: string | null
  /** 监测发现的最新加载器版本（黄灯依据） */
  latestLoaderVersion?: string
  /** 组合级门禁健康度档案（矩阵门禁真机构建回写；原存 manifest.matrixHealth，统一后由本层承载） */
  matrixHealth?: MatrixHealthSummary
}

/**
 * userData/ai/ai-reference-overlay.json（矩阵健康状态唯一真源）：
 * 安装目录内参考包只读；探针签字/上游监测/矩阵门禁结果统一写入本 overlay。
 * manifest.json 冻结为静态基线（坐标 pin/模板/指纹），不再被任何流程回写；
 * 其 health/verifiedAt/matrixHealth 仅在 overlay 无记录时作一次性种子迁入。
 * 读写收敛于 main/services/ai/matrixHealthStore.ts。
 */
export interface ReferenceOverlay {
  version: 1
  /** key = 模板 id */
  templates: Record<string, TemplateOverlayState>
  /** key = 组合 id（如 fabric-1.20.1） */
  combos: Record<string, ComboOverlayState>
}

/** 合并 overlay 后的模板视图（读模板时返回） */
export interface TemplateView extends ManifestTemplate {
  content: string
}

export interface MatchedErrorPattern {
  pattern: ErrorPattern
  /** 日志中的命中片段 */
  matchedText: string
}
