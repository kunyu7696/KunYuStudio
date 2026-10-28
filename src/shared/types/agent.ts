/**
 * 五档 Agent 体系共享类型（M8，依文档重构）。
 *
 * 五档（sprinter/artisan/master/bridge/weaver，见 ./tiers）跑同一条全链路
 * 流水线：understand → generate → build → test → export。orchestrator 主进程
 * 产出事件（stage 语义），aiAgents store 消费重建轨道状态。
 */
import type { LoaderId } from './aiReference'
import type { StageId, TierId } from './tiers'

/** 阶段在轨道中的相位 */
export type AgentPhaseState = 'waiting' | 'running' | 'done' | 'error' | 'skipped'

/** understand 阶段判定的用户意图 */
export type AgentIntent = 'chat' | 'code' | 'fix' | 'verify'

/** 迁移计划（bridge 档 understand 产出） */
export interface MigrationPlan {
  sourceLoader: string
  targetLoader: string
  /** 迁移模块顺序清单（generate 按序执行） */
  modules: string[]
}

/** understand 阶段产出的结构化计划 */
export interface AgentPlan {
  intent: AgentIntent
  /** 命中的内容类型（block/item/...） */
  contentTypes: string[]
  /** 待执行阶段（understand 除外；chat 时为 []） */
  stages: StageId[]
  goal: string
  /** 本次运行的档位（自动路由或用户手动指定） */
  tier: TierId
  /** bridge 档迁移计划 */
  migrationPlan?: MigrationPlan
  /** weaver 档整合包子任务清单（结构化，可逐子任务指定档位） */
  subtasks?: PlannedSubtask[]
  /** 实体生成模式：schema=可视化语义资产（缺省）；freeform=目录外自定义行为直写 Java（实体类/Goal/渲染器） */
  entityMode?: 'schema' | 'freeform'
}

/** 织星档单个子任务：计划可显式指定档位，否则由 TierDispatcher 按目标关键词路由 */
export interface PlannedSubtask {
  goal: string
  /** 计划显式指定的执行档位；缺省时按 goal 关键词路由 */
  tier?: TierId
}

/** generate 产出的单个文件变更（写盘前必须经路径安全校验） */
export interface AgentFileChange {
  /** 相对项目根的 POSIX 风格路径 */
  path: string
  action: 'create' | 'modify'
  content: string
  /** 路径/写盘校验是否通过（逃逸路径被拒绝时为 false 并带 reason） */
  accepted: boolean
  reason?: string
}

/** build 阶段的构建结论（治愈循环轮次由档位决定） */
export interface BuildConclusion {
  status: 'pass' | 'fail' | 'skipped'
  /** 实际修复轮次（0..N，档位上限见 tiers.ts） */
  rounds: number
  summary: string
  matchedPatternIds: string[]
  /** 末次 Gradle 构建退出码（0=成功；启动失败/取消/超时为 null）——证据链用 */
  exitCode?: number | null
  /**
   * 环境阻塞（显式「本次判定无效」语义）：
   * true 表示构建/验证因环境原因未能执行——矩阵组合未激活、项目缺 gradlew、
   * Gradle 互斥占用、Gradle 启动失败、构建被外部中断——这些都不是内容本身的失败。
   * 当无任何真实失败信号时，RunOutcome 据此判 inconclusive（无法判定），不再误判 failed。
   * 用户主动取消不置此位（走 canceled 语义）。
   */
  blockedByEnvironment?: boolean
  /**
   * 构建失败九层分类。
   * toolchain→dependency→compile→resources→packaging→bootstrap→mixin→registry→gameplay，
   * 按构建流水线序取最早有证据的层（早层失败会向下游级联，最早层通常是根因）。
   * pass/skipped/无证据时缺省；治愈循环据此注入分层修复策略。
   */
  failureLayer?: BuildFailureLayer | null
  /** 中文层级名（如「编译层」），随 failureLayer 给出 */
  failureLayerLabel?: string
  /** 分类证据：首个命中日志行或命中模式 id */
  failureEvidence?: string
  /**
   * P7（假设-证伪纪律）：治愈循环修复轨迹。
   * 每轮失败追加一行「第N轮｜层级｜证据｜是否与上轮同层（=上一假设已证伪）」，
   * 末轮收口随结论落库——用户在运行详情里能看到「诊断换了几次方向、卡在哪一层」，
   * 而不是只看到一个最终失败摘要。
   */
  repairTrace?: string[]
}

/** 构建失败九层 id（按构建流水线顺序；分类实现见 main 侧 buildFailureLayers.ts） */
export type BuildFailureLayer =
  | 'toolchain'
  | 'dependency'
  | 'compile'
  | 'resources'
  | 'packaging'
  | 'bootstrap'
  | 'mixin'
  | 'registry'
  | 'gameplay'

/** 特性④ GameTest 无头测试运行报告（解析 runGameTestServer stdout） */
export interface GameTestReport {
  status: 'pass' | 'fail' | 'skipped'
  /** 通过的方法名（test_<id>） */
  passed: string[]
  /** 失败的方法名 + 错误摘要 */
  failed: { name: string; error: string }[]
  summary: string
  durationMs: number
}

/** test 阶段的产物（kunyu-observer 全自动游戏测试） */
export interface TestOutcome {
  status: 'connected-ok' | 'connected-fail' | 'skipped' | 'gametest-ok' | 'gametest-fail'
  screenshotPath: string | null
  summary: string
  /** 特性④：GameTest 无头运行报告（无 gametest 内容时为 null） */
  gameTest?: GameTestReport | null
}

/** export 阶段产物清单 */
export interface ExportArtifactEntry {
  kind: 'jar' | 'zip' | 'files'
  path: string
}

/**
 * P1 视觉自审结论（test 阶段后的 visualReview 节点）。
 * 仅 code 意图且产出含模型资产时触发；方案 A：离线三视图渲染 + 硬门清单 +
 * 数值指标护栏 + 真机画面辅证；不达标回写模型 JSON（≤3 轮），轮次耗尽回滚。
 */
export interface VisualReviewGateResult {
  /** 硬门 id（identifiable/proportionate/noFloating/noBlackFace/textureBound） */
  id: string
  label: string
  pass: boolean
  note: string
}

export interface VisualReviewMetrics {
  occupancy: number
  clipping: number
  contrast: number
  edgeDensity: number
  viewConsistency: number
}

export interface VisualReviewOutcome {
  status: 'pass' | 'fail' | 'skipped'
  /** 视觉模型评分 0-100；skipped 时为 null */
  score: number | null
  /** 视觉模型反馈 / 跳过原因 */
  feedback: string
  /** 实际回写轮次（0..3） */
  rounds: number
  /** 终评截图绝对路径（真机辅证帧；无真机时为 null） */
  screenshotPath: string | null
  /** 硬门逐项结论（一票否决）；未触发/skipped 时缺省 */
  gates?: VisualReviewGateResult[] | null
  /** 离线三视图数值指标 */
  metrics?: VisualReviewMetrics | null
  /** 指标越界清单（客观护栏，非空即不达标） */
  metricViolations?: string[]
  /** 轮次耗尽后模型文件已回滚到验收前状态 */
  rolledBack?: boolean
  /** 证据来源：offline=离线三视图；live=真机画面；mixed=两者 */
  evidence?: 'offline' | 'live' | 'mixed' | null
}

export interface ExportOutcome {
  status: 'ok' | 'skipped'
  artifacts: ExportArtifactEntry[]
  summary: string
  /** 非阻断告警（如整合包来源缺失、目标被占用改名等） */
  notes?: string[]
}

// ---------------------------------------------------------------------------
// 特性③：AcceptanceContract 验收契约（generate 阶段产出，分阶段评估）
// ---------------------------------------------------------------------------

export type AssertionKind =
  | 'file-exists'
  | 'registry-entry'
  | 'build-pass'
  | 'texture-ready'
  | 'gametest-runtime'
  | 'user-confirmation'
  // P0-a：真机断言——机器可判定，由代码读取运行中游戏后判定，
  // 不再依赖模型自述。需要 kunyu-observer 观察通道在线。
  | 'runtime-world'
  | 'runtime-inventory'
/**
 * 断言状态（验证三态显式化）。
 *
 * 三态语义：verified=已验证通过、failed=已验证失败、unverified=未验证
 * （离线/跳过/未覆盖——不是「没问题」）。
 * 向后兼容：pass/fail/skipped 为旧值（历史 run 事件、持久化契约），
 * 展示层按 pass=verified / fail=failed / skipped=unverified 归一。
 */
export type AssertionStatus =
  | 'pending'
  | 'pass'
  | 'fail'
  | 'skipped'
  | 'awaiting-user'
  | 'verified'
  | 'failed'
  | 'unverified'

/** 断言证据（可复现）：构建类断言必带，schema 校验类可省略 */
export interface AssertionEvidence {
  type: 'build-log' | 'screenshot' | 'file' | 'command'
  /** 证据文件绝对路径（build-log/screenshot/file） */
  path?: string
  /** 触发该证据的命令（command/build-log） */
  command?: string
  /** 命令退出码 */
  exitCode?: number
  timestamp?: string
}

/** 支持单项复验的断言类型（渲染层「复跑此项」按钮与主进程 recheckAssertion 共用的单一事实源） */
export const RECHECKABLE_ASSERTION_KINDS: ReadonlySet<AssertionKind> = new Set([
  'file-exists',
  'texture-ready',
  'registry-entry',
  'build-pass',
  // P1：真机/无头复验（重探观察通道或重跑 GameTest，离线如实标 unverified）
  'runtime-world',
  'runtime-inventory',
  'user-confirmation',
  'gametest-runtime'
])

export interface AcceptanceAssertion {
  /** 唯一 id（LLM 给或自动 `${kind}-${i}`） */
  id: string
  kind: AssertionKind
  /** 中文描述，直接展示 */
  description: string
  /**
   * 主期望值：
   * - file-exists / texture-ready / registry-entry：相对项目根的 POSIX 路径
   * - build-pass：留空字符串
   */
  expected: string
  /** texture-ready 期望尺寸，如 "16x16"；省略只校验是合法 PNG */
  expectedSize?: string
  /** registry-entry 文件内匹配次数下限（默认 1） */
  min?: number
  /** registry-entry 匹配正则（缺省匹配任意非空行） */
  regex?: string
  /**
   * runtime-world 断言的世界坐标（整数方块坐标）；由 LLM 提供，代码读取该坐标方块判定。
   * 其余断言类型忽略此三元组。
   */
  x?: number
  y?: number
  z?: number
  /** 评估后填实际值（路径/计数/尺寸/方块名/背包匹配） */
  actual?: string
  status: AssertionStatus
  reason?: string
  /** user-confirmation 真机证据截图绝对路径（awaiting-user 时附带，卡片渲染缩略图）
   * @deprecated 统一走 evidence（type=screenshot）；保留仅为兼容历史数据 */
  evidencePath?: string
  /** 证据链：构建类断言必带命令/退出码/日志；静态校验类带文件路径 */
  evidence?: AssertionEvidence
}

export interface AcceptanceContract {
  /** 整体结论：全 verified→verified；任一 failed→failed；含 pending/awaiting→pending；其余 unverified */
  overall: AssertionStatus
  assertions: AcceptanceAssertion[]
  /** 中文摘要（如"验收 3/4 通过，1 项未验证"） */
  summary: string
}

// ---------------------------------------------------------------------------
// RunOutcome：运行结论单一事实源
// ---------------------------------------------------------------------------

/**
 * 流水线收口处汇总的运行结论。标题、状态、历史一律由它派生，
 * 绝不再拼接模型自述的 plan.goal。
 */
export interface RunOutcome {
  /** 构建结论（未触发为 null） */
  build: BuildConclusion | null
  /** 测试结论（未触发为 null） */
  test: TestOutcome | null
  /** 视觉自审结论（未触发为 null） */
  visualReview: VisualReviewOutcome | null
  /** 导出结论（未触发为 null） */
  export: ExportOutcome | null
  /** 验收契约（未产出为 null） */
  contract: AcceptanceContract | null
  /** 实际落盘文件数（含 FC 写入 + 语义资产代码生成路径） */
  filesWritten: number
  /** 被路径/写盘校验拒绝的文件数 */
  filesRejected: number
  /** 语义资产落盘数（content_upsert 等工具路径） */
  assetSaves: number
  /** 是否有任何产出（文件或语义资产） */
  hasAnyOutput: boolean
  /** 是否有代码产出（.java 文件或语义资产） */
  hasCodeOutput: boolean
  /**
   * 总结论：success=构建通过且有产出；partial=有产出但构建失败/未触发；
   * failed=构建失败无产出或假绿灯；
   * inconclusive=环境/工具链阻塞导致无法判定（无真实失败信号，本次验收结论无效）
   */
  verdict: 'success' | 'partial' | 'failed' | 'inconclusive'
  /**
   * 落库运行状态：由 verdict 派生——
   * success→completed（绿灯）；partial/failed→failed（可断点续跑）。
   * P0-5：断言未评估（pending/skipped/unverified）与验收契约缺失也不得 completed——
   * 落 failed 开放续跑复验；仅 awaiting-user（人工确认项）仍可 completed。
   * P0-b：环境阻塞（inconclusive）单独落 inconclusive——既不冒充失败，也不冒充完成，
   * UI 显式提示「无法判定（环境问题，可重试）」。
   */
  runStatus: 'completed' | 'failed' | 'inconclusive'
  /** 一句话中文结论（替代 plan.goal 标题） */
  headline: string
  /** 验收缺口：构建通过但未达完全成功的具体原因（空=无缺口） */
  gaps: string[]
  /**
   * 三态验收面板：逐项列出本次运行的验收维度，
   * verified=有实证支撑 / inconclusive=未验证（跳过、未触发、待人工确认）/ failed=明确失败。
   * 未验证项不计入已验证——composeReply 据此在会话结束时渲染显式面板。
   */
  checks: RunCheck[]
}

/**
 * 三态验收项（RunOutcome.checks 的元素）。
 * 三态验收：每条验收项明确标 verified/inconclusive/failed，
 * inconclusive 不得计入完成。
 */
export interface RunCheck {
  /** 维度标识（output/build/test/visual/export/contract/promised-types/generate-gaps） */
  id: string
  /** 中文标签 */
  label: string
  /** verified=已验证；inconclusive=未验证；failed=失败 */
  state: 'verified' | 'inconclusive' | 'failed'
  /** 证据一句话（构建摘要 / 测试摘要 / 评分 / 缺口原因等） */
  evidence?: string
}

export type AgentArtifactKind =
  | 'plan'
  | 'retrieval'
  | 'file-change'
  | 'build-result'
  | 'probe-screenshot'
  | 'export-result'
  | 'tool-call'
  | 'error'
  | 'contract'
  | 'gametest'
  | 'texture-candidates'
  | 'todo-list'

/** 贴图候选（kind=texture-candidates）：AI 一次重绘出的多个方案，供开发者挑选写回 */
export interface TextureCandidateSet {
  /** 目标资产 */
  assetKind: 'item' | 'model'
  assetId: string
  size: 16 | 32
  /** 需求摘要（截断 200 字） */
  prompt: string
  provider?: string
  /** AI 自动写回的候选序号（1-based） */
  appliedIndex: number
  warnings?: string[]
  variants: Array<{
    /** 1-based 序号 */
    index: number
    /** 像素化后的小 PNG data URL，直接给 <img> 用 */
    dataUrl: string
    /** size*size 项语义像素，写回资产用 */
    pixels: string[]
    palette: string[]
    colorCount: number
    /** 供本地重跑像素化（进程内缓存，重启失效） */
    sourceToken?: string
  }>
}

/** 待办清单条目（kind=todo-list）：模型经 todo_write 工具自维护的进度面板 */
export interface AgentTodoItem {
  /** 稳定 id（模型未给时按序号生成 t1/t2…） */
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** 阶段节点可展开产物 */
export interface AgentArtifact {
  id: string
  kind: AgentArtifactKind
  title: string
  /** 文件变更（kind=file-change） */
  files?: AgentFileChange[]
  /** 构建结论（kind=build-result） */
  build?: BuildConclusion
  /** 截图 file:// 路径（kind=probe-screenshot） */
  screenshotPath?: string
  /** 检索命中的模板/工具摘要 */
  references?: string[]
  /** 导出产物（kind=export-result） */
  export?: ExportOutcome
  /** 验收契约（kind=contract） */
  contract?: AcceptanceContract
  /** GameTest 无头运行报告（kind=gametest） */
  gameTest?: GameTestReport | null
  /** 贴图候选画廊（kind=texture-candidates） */
  textureCandidates?: TextureCandidateSet
  /** 待办清单（kind=todo-list）：todo_write 每次提交的完整清单 */
  todos?: AgentTodoItem[]
  /** 通用正文（探针输出/错误细节/工具调用摘要等） */
  body?: string
}

/** 主进程 -> 渲染层 Agent 轨道事件 */
export type AgentEventType =
  | 'phase'
  | 'artifact'
  | 'reply'
  | 'error'
  | 'log'
  | 'paused'
  | 'resumed'
  | 'tool-activity'
  | 'file-written'

/**
 * type=tool-activity：单条工具调用活动（卡片流：读取了 X / 写入了 Y）。
 * 在 runToolLoop 工具分发收口点对全部工具（读/搜/写/构建，含被护栏拦截的调用）发出。
 */
export interface AgentToolActivity {
  /** FC 工具调用 id（渲染层据此把结果合并回对应 tool-call 卡片，一一对应） */
  callId: string
  /** 工具名（write_project_file / read_project_file / template_search …） */
  tool: string
  /** 活动类别：渲染层配色/图标用 */
  kind: 'read' | 'search' | 'write' | 'build' | 'other'
  /** 目标项目相对 POSIX 路径（文件类工具；可空） */
  path?: string
  /** 一行结果摘要（已截断） */
  summary: string
  ok: boolean
  /**
   * M3 子代理嵌套：本条活动归属的子代理委派调用 id（主代理 agent_delegate 的 callId）。
   * 渲染层据此把子代理内部活动聚合到对应委派卡片下，而非混进主时间轴平铺流。
   * 主代理自身的活动不带此字段。
   */
  parentCallId?: string
  /** M3：子代理任务标题（嵌套节点展示用；仅子代理活动携带） */
  subAgentTask?: string
}

/**
 * type=file-written：文件已实际落盘（T1 write-through 即时写盘 / 终点统一写盘 / 自愈轮修复写盘）。
 * 渲染层据此防抖刷新文件树并在 Monaco 打开该文件。
 */
export interface AgentFileWritten {
  path: string
  action: 'create' | 'modify'
  bytes: number
}

/** 显式编排状态机状态（TR-9.1） */
export type AgentMachineState =
  | 'idle'
  | 'understanding'
  | 'generating'
  | 'building'
  | 'testing'
  | 'exporting'
  | 'fixing'
  | 'paused'
  | 'failed'

/**
 * run 级资源预算快照（P1-9 熔断）：随事件流实时推送，
 * UI 据此显示「已用 X 次调用 / 上限 Y」，超限由主进程熔断并如实告知。
 */
export interface AgentRunBudget {
  modelCallsUsed: number
  modelCallsMax: number
  gradleBuildsUsed: number
  gradleBuildsMax: number
  /** 运行起点（ISO 时间） */
  startedAt: string
  /** 墙钟上限（毫秒） */
  wallMaxMs: number
}

export interface AgentEvent {
  type: AgentEventType
  /** 每次运行的单调事件序号 */
  seq: number
  runId: string
  /** 事件所属流水线阶段 */
  stage: StageId
  phase?: AgentPhaseState
  /** 显式状态机当前状态（paused/resumed/log 事件携带） */
  state?: AgentMachineState
  /** 当前动作文案（中文，直接展示） */
  action?: string
  detail?: string
  /** 推理模型的思考过程（reasoning_content），前端在消息气泡内渲染「思考」折叠块 */
  thought?: string
  artifact?: AgentArtifact
  /** type=reply 时的最终回复文本 */
  reply?: string
  /** run 级资源预算实时快照（P1-9）：每次事件随带，渲染层展示最新用量 */
  budget?: AgentRunBudget
  /** type=tool-activity：工具调用活动卡片（T1） */
  toolActivity?: AgentToolActivity
  /** type=file-written：文件落盘事实（T1） */
  fileWritten?: AgentFileWritten
  at: string
}

export interface AgentRunRequest {
  message: string
  /** 当前项目 id；无项目为 null（generate 只回片段不写盘） */
  projectId: string | null
  /** 目标组合（17 个组合全激活；与工程实际组合不一致时由 orchestrator 提示，不拒绝） */
  loader: LoaderId
  mcVersion: string
  /** 覆盖默认模型 */
  model?: string
  /**
   * 用户在面板手动选择的档位；null/undefined = 关键词自动路由。
   */
  tier?: TierId | null
  /** 上下文路由：来源面板 / 活动文件 / 选中内容（渲染层按当前视图补充） */
  context?: AgentRequestContext
  /** 用户上传的图片（data URL），随 understand/chat 首轮消息交给视觉模型 */
  images?: string[]
}

/** 渲染层按活动面板补充的工程上下文（TR-10 上下文路由） */
export interface AgentRequestContext {
  /** 来源面板标识 */
  sourceView: string
  /** 当前活动文件相对路径；null 表示无 */
  activeFile?: string | null
  /** 编辑器选中文本（截断后）；null 表示无 */
  selection?: string | null
}

/** 阶段顺序与展示元数据统一从 tiers.ts 导出，渲染层与主进程共用 */
export { ALL_STAGE_IDS, STAGE_METAS, TIER_METAS, ALL_TIER_IDS } from './tiers'

export interface AgentRunResult {
  runId: string
  intent: AgentIntent
  /** 本次运行的档位 */
  tier: TierId
  /** 自动路由命中的关键词（手动档为空数组） */
  tierMatched: string[]
  /** 最终回复（成为 assistant 气泡） */
  reply: string
  files: AgentFileChange[]
  build: BuildConclusion | null
  test: TestOutcome | null
  /** P1 真机视觉自审（未触发/未启用时为 null） */
  visualReview?: VisualReviewOutcome | null
  export: ExportOutcome | null
  /** 被跳过的阶段（如探针离线） */
  skippedStages: StageId[]
  canceled: boolean
  /**
   * 运行结论（会话结束「运行详情」面板的三态事实源：success/partial/failed/inconclusive）。
   * 仅完整流水线返回时携带；chat/异常早退为空，面板按可用产物派生兜底。
   */
  outcome?: RunOutcome
}

// ---------------------------------------------------------------------------
// Agent 任务图跨运行持久化：断点快照与历史记录（agent_runs / agent_run_events）
// ---------------------------------------------------------------------------

/**
 * Weaver 子任务级进度（任务图持久化 #4）：每完成一个子任务覆盖写一次。
 * 中断续跑时跳过前 completed 个子任务，并以其累计产物作为前序上下文。
 */
export interface WeaverSubtaskProgress {
  /** 已完成的子任务数（从 0 起，与 plan.subtasks 顺序一致） */
  completed: number
  /** 已完成子任务的累计文件变更 */
  files: AgentFileChange[]
  /** 已完成子任务的累计说明文本 */
  notes: string
  /** 已完成子任务的累计语义资产落盘数 */
  assetSaves: number
}

/** 断点续跑快照（version 1）：每完成一个阶段由 orchestrator 覆盖写一次。
 * 恢复时按 completedStage 决定跳过哪些阶段的 LLM/构建/测试调用。
 */
export interface AgentRunCheckpoint {
  version: 1
  /** 已完成到的阶段（done 表示全部完成） */
  completedStage: 'understand' | 'generate' | 'build' | 'test' | 'export' | 'done'
  plan?: AgentPlan
  files?: AgentFileChange[]
  /** TemplateContent[]；序列化为 unknown 防 shared 层循环依赖，orchestrator 内断言回 TemplateContent[] */
  templates?: unknown[]
  contract?: AcceptanceContract | null
  build?: BuildConclusion | null
  test?: TestOutcome | null
  export?: ExportOutcome | null
  skippedStages?: StageId[]
  generateNotes?: string
  /** 续跑提示：上轮收口的三态结论与缺口，续跑时注入 notes 头部，防止「已验证/未验证」区分在长任务中衰减 */
  lastOutcomeHint?: { runStatus: string; verdict: string; gaps: string[] }
  /** Weaver 子任务级进度（仅织星档 generate 阶段内推进；v1 快照的可选增量字段） */
  subtaskProgress?: WeaverSubtaskProgress
}

/**
 * 任务图运行状态：interrupted = 进程退出时仍处于 running，启动时统一改写；
 * inconclusive = 环境/工具链阻塞导致本次判定无效，可修复环境后重试。
 */
export type AgentRunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'interrupted'
  | 'inconclusive'

/** Agent 单次运行的累计模型用量（usage 落库；token/成本可查） */
export interface AgentRunUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** 计费的模型调用次数 */
  modelCalls: number
}

/** 历史任务记录（agent_runs 行反序列化；request.images 已剥离，仅存 imageCount） */
export interface AgentRunRecord {
  id: string
  projectId: string | null
  tier: TierId
  intent: AgentIntent | string
  /** 已剥离 images 的请求（图片仅保留 imageCount 计数） */
  request: AgentRunRequest & { imageCount?: number }
  checkpoint: AgentRunCheckpoint | null
  status: AgentRunStatus
  reply: string | null
  /** 累计模型用量；旧记录/厂商未返回 usage 时为 null */
  usage: AgentRunUsage | null
  createdAt: number
  updatedAt: number
  finishedAt: number | null
}

