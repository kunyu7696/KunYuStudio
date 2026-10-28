import type {
  AcceptanceContract,
  AgentEvent,
  AgentFileChange,
  AgentMachineState,
  AgentPlan,
  AgentRunBudget,
  AgentRunCheckpoint,
  AgentRunRequest,
  AgentRunResult,
  WeaverSubtaskProgress
} from '../../../../shared/types/agent'
import type { AgentRunStore } from '../../agentRunStore'
import type { GradleEvent, GradleRunInput } from '../../../../shared/types/build'
import { TIER_RUN_BUDGETS, type StageId, type TierId } from '../../../../shared/types/tiers'
import type { AiChatRequest, AiChatResponse } from '../../../../shared/types/ai'
import type { ModLoader, ProjectType } from '../../../../shared/types/project'
import type { ModpackAssembleResult } from '../../../../shared/types/modpack'
import type { ModpackMeta } from '../../modpack/modpackAssembler'
import type { ContextBuilder, TemplateContent } from '../contextBuilder'
import type { ReferenceService } from '../referencePackageService'
import type { McpClient } from '../mcpClient'
import type { ToolRegistry } from '../toolRegistry'

export interface ResolvedProject {
  id: string
  name: string
  path: string
  /** 项目类型：export 阶段据此分派（整合包走真实组装） */
  type: ProjectType
  mcVersion: string
  loader: ModLoader | null
  loaderVersion: string | null
}

export interface RunState {
  canceled: boolean
  gradleRunId: string | null
  /** 暂停标志：暂停期间不启动新阶段/新轮次，晚到结果被忽略 */
  paused: boolean
  /** 显式状态机当前状态 */
  machineState: AgentMachineState
  /** resume 时需要唤醒的等待点 */
  pauseResolvers: Array<() => void>
  /** 暂停前状态（resume 时恢复） */
  resumeState: AgentMachineState | null
  /** 当前阶段（pause/resume 事件用） */
  stage: StageId
  /** 运行内事件发射器（供 pause/resume 从外部发事件） */
  emit: EmitFn
}

export function placeholderEmit(): void {
  throw new Error('emit 尚未初始化')
}

/** 模块级暂停闸门：暂停时挂起等待 resume；取消时立即放行 */
export function gatePaused(state: RunState): Promise<void> {
  if (!state.paused || state.canceled) return Promise.resolve()
  return new Promise<void>((resolvePromise) => {
    state.pauseResolvers.push(() => resolvePromise())
  })
}

export type EmitFn = (stage: StageId, event: Omit<AgentEvent, 'seq' | 'runId' | 'stage' | 'at'>) => void

export interface OrchestratorDeps {
  chat?: (req: AiChatRequest) => Promise<AiChatResponse>
  providerId?: () => string | null
  reference?: ReferenceService
  contextBuilder?: ContextBuilder
  registry?: ToolRegistry
  mcp?: Pick<McpClient, 'isEnabled' | 'getStatus' | 'callStaticTool'>
  runGradle?: (input: GradleRunInput, sink: (event: GradleEvent) => void) => string
  cancelGradleBuild?: (runId?: string) => boolean
  gradleBusy?: () => boolean
  resolveProject?: (id: string) => ResolvedProject | null
  /** export 阶段整合包真实组装（测试注入点；缺省用真实组装器） */
  assembleModpack?: (projectPath: string, meta: ModpackMeta) => ModpackAssembleResult
  javaHome?: () => string | undefined
  writeFile?: (absPath: string, content: string) => void
  now?: () => Date
  idFactory?: () => string
  /** 任务图持久化（历史任务 + 断点续跑）；缺省不持久化，测试可注入内存实现 */
  runStore?: AgentRunStore
}

export type AgentEventListener = (event: AgentEvent) => void

export interface Orchestrator {
  /**
   * 跑一次流水线。resumeFrom 传入历史断点快照时按 completedStage
   * 跳过已完成阶段的 LLM/构建/测试调用（断点续跑）。
   */
  run(
    request: AgentRunRequest,
    onEvent?: AgentEventListener,
    resumeFrom?: AgentRunCheckpoint
  ): Promise<AgentRunResult>
  cancel(runId: string): void
  /** 暂停：不启动新阶段/新轮次，晚到结果被忽略 */
  pause(runId: string): void
  /** 恢复：唤醒所有暂停等待点，流水线继续 */
  resume(runId: string): void
  /** 从历史任务记录断点续跑：恢复检查点后以新 runId 跑剩余阶段 */
  resumeRun(runId: string, onEvent?: AgentEventListener): Promise<AgentRunResult>
  isRunning(): boolean
  /** generate 阶段 FC 循环使用的工具注册表（诊断/UI 列举用） */
  getRegistry(): ToolRegistry
  /**
   * T2 对比视图：读取指定 run 中某文件的「run 前原文快照」。
   * found=false 表示该 run 无此文件快照（未 write-through / 已回滚 / runId 已淘汰）；
   * found=true 时 original 为 null 表示 create（原文不存在），string 为 modify 原文。
   */
  getRunFileSnapshot(runId: string, relPath: string): { found: boolean; original: string | null }
  /**
   * T2 单文件回滚：把指定 run 中某文件恢复到 run 前状态（modify 恢复原文；create 删文件）。
   * 幂等；无快照时 ok:false。
   */
  rollbackRunFile(runId: string, relPath: string): { ok: boolean; reason?: string }
}

// ---------------------------------------------------------------------------
// generate 阶段：FC 工具循环（含 bridge 模块迁移 / weaver 子任务调度）
// ---------------------------------------------------------------------------
export interface GeneratePipelineInput {
  runId: string
  state: RunState
  request: AgentRunRequest
  plan: AgentPlan
  tier: TierId
  tierMatched: string[]
  project: ResolvedProject | null
  comboActive: boolean
  templates: TemplateContent[]
  setTemplates: (t: TemplateContent[]) => void
  ctx: ContextBuilder
  mcpReady: boolean
  registry: ToolRegistry
  chat: (req: AiChatRequest) => Promise<AiChatResponse>
  providerId: string
  /** 档位解析后的实际模型（含覆盖；单次显式 model 已并入） */
  model: string | null
  emit: (stage: StageId, event: Omit<AgentEvent, 'seq' | 'runId' | 'stage' | 'at'>) => void
  /**
   * run 级预算追踪器（P1-6 修复）：AI 出图工具（texture_repaint）不经 budgetedChat，
   * 需在工具执行前手动计一次预算。understand/generate/build 的 LLM 调用走 budgetedChat 自动计入。
   */
  budget?: RunBudgetTracker
  /**
   * T1 write-through 端口（per-run）：终点复核拒绝已即时落盘的工具文件时据此回滚。
   * 无项目 run / 旧测试为 undefined|null（攒批模式，无回滚需求）。
   */
  writeThrough?: import('./writeThrough').WriteThroughPort | null
  /** 断点续跑：历史快照（织星档据此恢复子任务级进度，跳过已完成子任务） */
  resumeFrom?: AgentRunCheckpoint
  /** 织星档子任务级断点回调：每完成一个子任务由 generatePipeline 回调一次 */
  onSubtaskCheckpoint?: (progress: WeaverSubtaskProgress) => void
  /**
   * 调用模式（按阶段门控）：'generate' 完整生成轮给全部可见工具；
   * 'fix'（build/test 治愈轮的定向修复）剔除与修错无关的工具
   * （AI 出图、市场、子代理委派），防止模型在治愈轮跑偏烧预算。
   * 缺省 'generate'。
   */
  mode?: 'generate' | 'fix'
}

export interface GenerateOutcome {
  files: AgentFileChange[]
  notes: string
  /** 本轮经 content_upsert 成功保存的语义资产数（物品/方块/实体/模型） */
  assetSaves: number
  /** LLM 在最终 JSON 中产出的验收契约（特征③）；缺省为 null */
  contract: AcceptanceContract | null
  /**
   * P2 静态缺口（缺 Java 类 / 缺贴图 / 被闸门拒收的文件）——未闭合时不再清空已落盘成果，
   * 改为随收口结论上报：verdict 封顶 partial、gaps 显式列出、runStatus 落 failed 允许续跑。
   * 缺省 [] = 无缺口；「零产出」「代码型目标缺核心 Java」两类硬失败仍走清空路径不带假绿灯。
   */
  gaps?: string[]
}

export interface BuildLoopInput {
  runId: string
  state: RunState
  request: AgentRunRequest
  project: ResolvedProject
  tier: TierId
  ctx: ContextBuilder
  /**
   * P2a：构建失败回炉修复走「与 generate 同源的 FC 工具循环」，不再另起纯文本全量重吐通道。
   * 模型因此能拿到真实编译错误原文并用 edit_project_file 做定向修补（只改坏掉的那几行），
   * 而不是被要求重吐整份文件（实测最易触发截断与零产出）。
   * @param fixGoal 修复目标（必须含未删改的构建失败日志尾部 + 命中模式建议 + 重试提示）
   * @returns 本轮修复产出的文件变更（已由 write-through 落盘）；notes 供事件流展示
   */
  fixViaGenerate: (fixGoal: string) => Promise<{ files: AgentFileChange[]; notes: string }>
  emit: (stage: StageId, event: Omit<AgentEvent, 'seq' | 'runId' | 'stage' | 'at'>) => void
  files: AgentFileChange[]
  setFiles: (next: AgentFileChange[]) => void
  runGradle: (input: GradleRunInput, sink: (event: GradleEvent) => void) => string
  /** 等待一次 Gradle 运行结束；timeoutMs 为 watchdog（P1-12：done 事件丢失时按超时收口） */
  waitForGradleDone: (
    runId: string,
    timeoutMs?: number
  ) => Promise<{ exitCode: number | null; cancelled: boolean; timedOut: boolean }>
  cancelBuild: (runId?: string) => boolean
  writeFileSafe: (absPath: string, content: string) => void
  javaHome: string | undefined
}

// ---------------------------------------------------------------------------
// run 级预算熔断（P1-9）
// ---------------------------------------------------------------------------

/**
 * 预算熔断异常：超出 run 级预算（模型调用/Gradle 构建/墙钟）时抛出，
 * 由各阶段捕获点原样上抛，orchestrator 顶层转换为「已熔断停止」的失败回复。
 */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BudgetExceededError'
  }
}

export interface RunBudgetTracker {
  /** 计一次模型调用；超调用上限或墙钟上限时抛 BudgetExceededError */
  consumeModel(): void
  /** 计一次真实 Gradle 构建；超构建上限或墙钟上限时抛 BudgetExceededError */
  consumeBuild(): void
  /** 当前用量快照（随事件流推送 UI 实时显示） */
  snapshot(): AgentRunBudget
}

/**
 * 创建 run 级预算追踪器。onExceeded 在熔断前回调一次（用于先 emit 错误事件再抛出，
 * 保证 UI 时间轴能看到熔断原因）。
 */
export function createRunBudget(
  tier: TierId,
  now: () => Date,
  onExceeded?: (message: string) => void
): RunBudgetTracker {
  const cfg = TIER_RUN_BUDGETS[tier]
  const startMs = now().getTime()
  const startedAt = new Date(startMs).toISOString()
  const wallMaxMs = cfg.maxWallMinutes * 60_000
  let modelCalls = 0
  let gradleBuilds = 0
  const fail = (message: string): never => {
    onExceeded?.(message)
    throw new BudgetExceededError(message)
  }
  const checkWall = (): void => {
    if (now().getTime() - startMs > wallMaxMs) {
      fail(
        `本次运行已超过墙钟预算上限（${cfg.maxWallMinutes} 分钟），已熔断停止；` +
          '可将需求拆小后重试，或检查模型响应是否过慢。'
      )
    }
  }
  return {
    consumeModel() {
      checkWall()
      modelCalls += 1
      if (modelCalls > cfg.maxModelCalls) {
        fail(
          `本次运行模型调用已达 ${cfg.maxModelCalls} 次上限（当前档位的预算熔断），已停止以防继续消耗 API 额度；` +
            '可换更低档位、拆分需求后重试，或查看日志手动介入。'
        )
      }
    },
    consumeBuild() {
      checkWall()
      gradleBuilds += 1
      if (gradleBuilds > cfg.maxGradleBuilds) {
        fail(
          `本次运行 Gradle 构建已达 ${cfg.maxGradleBuilds} 次上限（当前档位的预算熔断），已停止；` +
            '请查看构建日志与命中模式手动介入。'
        )
      }
    },
    snapshot() {
      return {
        modelCallsUsed: modelCalls,
        modelCallsMax: cfg.maxModelCalls,
        gradleBuildsUsed: gradleBuilds,
        gradleBuildsMax: cfg.maxGradleBuilds,
        startedAt,
        wallMaxMs
      }
    }
  }
}
