/**
 * 织星 TierDispatcher（TR-11.1）。
 *
 * 把整合包计划的子任务：
 * 1) 映射到执行档位（计划显式指定优先，否则按目标关键词路由）；
 * 2) 构造结构化上下文（目标、档位、loader/MC 版本、共享约束、已完成产物摘要）；
 * 3) 顺序调度对应档位执行器，收集产物并更新上下文；
 * 4) 聚合全部产物与分档说明。
 *
 * 编排本身通过依赖注入与执行器解耦，便于在 vitest 中 mock 各档执行器。
 */
import { routeTier } from '../../../shared/services/agentRouter'
import {
  TIER_CONFIGS,
  WEAVER_MAX_SUBTASKS,
  type TierId
} from '../../../shared/types/tiers'
import type {
  AcceptanceContract,
  AgentFileChange,
  AgentPlan,
  PlannedSubtask
} from '../../../shared/types/agent'
import { BudgetExceededError } from './orchestrator/types'

/** 一个待调度作业 */
export interface DispatchJob {
  /** 0-based */
  index: number
  total: number
  tier: TierId
  /** 多作业时的展示标签；单作业为空 */
  label: string
  goal: string
}

/** 跨子任务共享的工程环境与约束 */
export interface SharedContext {
  /** 整合包总目标 */
  goal: string
  loader?: string
  mcVersion?: string
  /** 跨子任务共享约束（统一命名空间 / 包名 / 兼容性要求等） */
  constraints?: string
}

/** 解析子任务档位：显式合法 tier 优先，否则按 goal 关键词路由（routeTier 至少回落到匠造） */
export function resolveSubtaskTier(sub: PlannedSubtask): TierId {
  if (sub.tier && sub.tier in TIER_CONFIGS) return sub.tier
  return routeTier(sub.goal).tier
}

/** 计划 → 作业清单（限量；无有效子任务时回落到整包目标单作业） */
export function buildDispatchJobs(plan: AgentPlan): DispatchJob[] {
  const raws = (plan.subtasks ?? [])
    .filter((s) => s && typeof s.goal === 'string' && s.goal.trim().length > 0)
    .slice(0, WEAVER_MAX_SUBTASKS)
  const list: PlannedSubtask[] = raws.length > 0 ? raws : [{ goal: plan.goal }]
  return list.map((s, i) => {
    const tier = resolveSubtaskTier(s)
    return {
      index: i,
      total: list.length,
      tier,
      label:
        list.length > 1
          ? `子任务 ${i + 1}/${list.length} · ${TIER_CONFIGS[tier].name}（${TIER_CONFIGS[tier].title}）`
          : '',
      goal: s.goal
    }
  })
}

/** 汇总已产出文件，供后序子任务感知前序产物（路径 + 动作；限量，取最新） */
export function summarizePriorArtifacts(
  files: AgentFileChange[],
  maxItems = 12
): string {
  const accepted = files.filter((f) => f.accepted)
  if (accepted.length === 0) return ''
  const tail = accepted.slice(-maxItems).map((f) => `- [${f.action}] ${f.path}`)
  if (accepted.length > maxItems) {
    tail.push(`- ……另有 ${accepted.length - maxItems} 个文件`)
  }
  return ['已完成的前序产物（保持兼容，勿重复/冲突）：', ...tail].join('\n')
}

/** 为单个子任务构造结构化目标上下文 */
export function buildSubtaskGoal(
  job: DispatchJob,
  shared: SharedContext,
  priorFiles: AgentFileChange[]
): string {
  const parts: string[] = []
  const head =
    job.total > 1 ? `【整合包子任务 ${job.index + 1}/${job.total}】${job.goal}` : job.goal
  parts.push(head)
  parts.push(`执行档位：${TIER_CONFIGS[job.tier].name}（${TIER_CONFIGS[job.tier].title}）`)

  const env = [
    shared.loader ? `Loader：${shared.loader}` : '',
    shared.mcVersion ? `MC 版本：${shared.mcVersion}` : ''
  ].filter(Boolean)
  if (env.length > 0) parts.push(env.join(' · '))
  if (shared.constraints) parts.push(`共享约束：${shared.constraints}`)

  const prior = summarizePriorArtifacts(priorFiles)
  if (prior) parts.push(prior)

  parts.push(`整合包总目标：${shared.goal}`)
  return parts.join('\n')
}

/** 调度事件（映射到事件流「子任务 N · 档位 · 状态」） */
export type DispatchEvent =
  | { kind: 'start'; job: DispatchJob }
  | { kind: 'finish'; job: DispatchJob; fileCount: number }
  | { kind: 'skip-cancel'; job: DispatchJob }
  | { kind: 'fail'; job: DispatchJob; error: string }

/** 单作业执行结果 */
export interface JobOutcome {
  files: AgentFileChange[]
  notes: string
  /** 该作业产出的验收契约（runToolLoop 返回；无契约为 null） */
  contract?: AcceptanceContract | null
  /**
   * dispatchSubtasks 聚合的全部子任务契约（按子任务顺序，含 null）。
   * 单作业 JobOutcome 不含此字段；仅 dispatchSubtasks 返回时填充。
   * 调用方负责用 mergeSubtaskContracts 合并。
   */
  contracts?: (AcceptanceContract | null)[]
}

/** 依赖注入：闸门 / 取消 / 模型解析 / 事件 / 各档执行器 */
export interface DispatchDeps {
  gate: () => Promise<void>
  isCanceled: () => boolean
  /** 按子任务档位解析 provider/model（含分档覆盖；调用方负责锁定收敛） */
  resolveModel: (tier: TierId) => { providerId: string; model: string | null }
  emit: (event: DispatchEvent) => void
  runJob: (
    job: DispatchJob,
    goal: string,
    providerId: string,
    model: string | null
  ) => Promise<JobOutcome>
  /**
   * 子任务级进度回调（任务图持久化 #4）：每完成一个子任务调用一次，
   * 参数为截至目前的累计产物；orchestrator 据此覆盖写断点快照，
   * 进程中断续跑时跳过已完成子任务而不是重跑整个 generate 阶段。
   */
  onSubtaskProgress?: (acc: JobOutcome & { completed: number }) => void
  /** 断点续跑：跳过前 N 个已完成的子任务 */
  skipCompleted?: number
  /** 断点续跑：已完成子任务的累计产物（作为后续子任务的前序上下文与最终聚合基数） */
  resumed?: JobOutcome
}

/** 顺序调度全部子任务并聚合产物 */
export async function dispatchSubtasks(
  jobs: DispatchJob[],
  shared: SharedContext,
  deps: DispatchDeps
): Promise<JobOutcome> {
  const skip = Math.max(0, deps.skipCompleted ?? 0)
  const allFiles: AgentFileChange[] = [...(deps.resumed?.files ?? [])]
  const notes: string[] = deps.resumed?.notes ? [deps.resumed.notes] : []
  // P1-5：收集每个子任务的契约，织星档不再丢弃子任务契约
  const contracts: (AcceptanceContract | null)[] = [...(deps.resumed?.contracts ?? [])]
  let completed = skip

  for (const job of jobs) {
    if (job.index < skip) continue // 断点续跑：已完成的子任务直接跳过
    await deps.gate()
    if (deps.isCanceled()) {
      deps.emit({ kind: 'skip-cancel', job })
      break
    }
    const { providerId, model } = deps.resolveModel(job.tier)
    const goal = buildSubtaskGoal(job, shared, allFiles)
    deps.emit({ kind: 'start', job })

    // P1-5 子任务异常隔离：单个子任务 throw 不能让整个织星 run 崩溃，
    // 记录失败原因、该子任务契约记 null、继续执行后续子任务
    let outcome: JobOutcome
    try {
      outcome = await deps.runJob(job, goal, providerId, model)
    } catch (err) {
      // 预算熔断必须原样上抛：织星档是唯一在此处吞异常的路径，
      // 漏判会让最高档的"任一超限即熔断停止"承诺失效。
      if (err instanceof BudgetExceededError) throw err
      const msg = err instanceof Error ? err.message : String(err)
      notes.push(
        job.total > 1
          ? `【子任务 ${job.index + 1} · ${TIER_CONFIGS[job.tier].name}】执行异常：${msg}`
          : `执行异常：${msg}`
      )
      contracts.push(null)
      deps.emit({ kind: 'fail', job, error: msg })
      completed = job.index + 1
      if (deps.isCanceled()) break
      continue
    }
    allFiles.push(...outcome.files)
    contracts.push(outcome.contract ?? null)

    if (deps.isCanceled()) {
      deps.emit({ kind: 'skip-cancel', job })
      break
    }
    if (outcome.notes) {
      notes.push(
        job.total > 1
          ? `【子任务 ${job.index + 1} · ${TIER_CONFIGS[job.tier].name}】${outcome.notes}`
          : outcome.notes
      )
    }
    completed = job.index + 1
    deps.emit({ kind: 'finish', job, fileCount: outcome.files.length })
    deps.onSubtaskProgress?.({
      completed,
      files: [...allFiles],
      notes: notes.join('\n\n')
    })
  }

  return { files: allFiles, notes: notes.join('\n\n'), contracts }
}
