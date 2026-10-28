/**
 * run 会话主体：
 * createOrchestrator().run() 的完整流水线（understand → generate → build → test → reply）。
 * 导出（jar/zip）已从流水线分离为手动操作（AGENT_EXPORT_NOW），不再自动执行。
 * 原方法闭包捕获的依赖改经 RunSessionContext 显式传入；方法体逐行原样搬迁，零行为变更。
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AsyncLocalStorage } from 'node:async_hooks'

import {
  type AcceptanceContract,
  type AgentEvent,
  type AgentFileChange,
  type AgentIntent,
  type AgentMachineState,
  type AgentPlan,
  type AgentRunCheckpoint,
  type AgentRunRequest,
  type AgentRunResult,
  type AgentRunStatus,
  type AgentRunUsage,
  type BuildConclusion,
  type ExportOutcome,
  type GameTestReport,
  type TestOutcome,
  type VisualReviewOutcome
} from '../../../../shared/types/agent'
import {
  buildContractArtifact,
  evaluateAfterBuild,
  evaluateAfterGameTest,
  evaluateAfterGenerate,
  evaluateAfterRuntimeScreenshot,
  evaluateAfterTest,
  hasPendingRuntimeAssertion,
  hasPendingUserConfirmation
} from '../contractEvaluator'
import { evaluateRuntimeAssertions } from '../runtimeProbe'
import { TIER_CONFIGS, type StageId } from '../../../../shared/types/tiers'
import {
  buildDiagnosisReport,
  classifyFailure,
  collectRuntimeSignals,
  writeDiagnosisReport,
  type FailureSignals
} from '../diagnosis'
import { runTestHealLoop } from '../testHealLoop'
import { factsToPromptLine, readFacts } from '../fcTools/projectFacts'
import { routeTier } from '../../../../shared/services/agentRouter'
import { resolveTierModel } from '../../../../shared/services/tierModelResolver'
import { resolveTierWithLock } from '../../../../shared/services/manualLock'
import type { AiUsage, ChatMessage } from '../../../../shared/types/ai'
import type { GradleEvent, GradleRunInput } from '../../../../shared/types/build'
import { getSection } from '../../settingsService'
import { findMissingContentTypes, generateProjectContent, importForeignContentStubs } from '../../contentService'
import { cancelGradle, hasActiveRun } from '../../gradleService'
import { runGameTestServer } from '../../gameTestRunner'
import { type TemplateContent } from '../contextBuilder'
import {
  fetchPlayerState,
  fetchScreenshot,
  probeObserver,
  type ObserverEndpoint
} from '../../observer/observerClient'
import { dataUrlToPngBuffer } from '../pixelize'
import {
  gatePaused,
  placeholderEmit,
  BudgetExceededError,
  createRunBudget,
  type AgentEventListener,
  type GeneratePipelineInput,
  type OrchestratorDeps,
  type ResolvedProject,
  type RunBudgetTracker,
  type RunState
} from './types'
import { mergeGeneratedIntoFiles, runGeneratePipeline } from './generatePipeline'
import { hasGradlew, isComboActive, runBuildLoop } from './buildLoop'
import { createWriteThrough, type WriteThroughPort } from './writeThrough'
import { buildArtifact } from './exportStage'
import { mergeFileChanges, parsePlanJson, sanitizePlan } from './planParse'
import { intentLabel, mcpCapabilitySection, understandMessages } from './prompts'
import { composeReply } from './reply'
import { deriveRunOutcome } from './runOutcome'
import { findModelAssetPaths, runVisualReview } from './visualReview'
import { renderModelSnapshot } from '../modelSnapshot'
import { detectComboMismatch } from './comboCheck'

/**
 * per-run 注入的作用域（P1-9）：替代旧的实例级 activeProjectRoot/activeProjectType 可变全局。
 * 工具的 available()/写盘根解析经 AsyncLocalStorage 按 run 读取——两个 run 交错时，
 * 前一个 run 的写盘工具不会写进另一个项目。run 之外（集成服务列举工具等）回落到
 * 最近一次 run 的 scope，保持旧的「粘性项目」语义。
 */
export interface RunScope {
  /** 当前 run 解析到的项目根；content_* 语义资产工具按此定位 .kunyu/content */
  projectRoot: string | null
  /** 与 projectRoot 同步更新的项目类型；market_install_mod 等工具仅对 'modpack' 暴露 */
  projectType: string | null
  /** 与 projectRoot 同步更新的项目 loader；fabric_* 写盘工具仅对 fabric 项目暴露（防 Yarn 覆盖 Mojmap） */
  projectLoader: string | null
  /** 本轮用户上传的参考图（PNG/JPEG data URL，已在渲染层压缩）；texture_pixelize 等工具引用 */
  referenceImages: string[]
  /** 当前 run 的预算追踪器；FC 工具内的 gradle_build 也计入构建预算 */
  budget: RunBudgetTracker | null
  /**
   * T1 write-through 端口（per-run）：write_project_file 验收通过立即写盘。
   * 无项目 run 为 null（工具退回攒批模式）。
   */
  writeThrough: WriteThroughPort | null
}

export const emptyScope = (): RunScope => ({
  projectRoot: null,
  projectType: null,
  projectLoader: null,
  referenceImages: [],
  budget: null,
  writeThrough: null
})

/**
 * runOrchestratorSession 的显式上下文：createOrchestrator 组装一次（成员均为稳定引用），
 * 替代原 run 方法对 createOrchestrator 闭包的隐式捕获。
 */
export interface RunSessionContext {
  deps: OrchestratorDeps
  /** 存活 run 状态表：cancel/pause/resume 与 run 共享 */
  runs: Map<string, RunState>
  /** per-run scope 的 AsyncLocalStorage 通道 */
  runScopeCtx: AsyncLocalStorage<RunScope>
  /** 回写「最近一次 run 的 scope」（run 之外回落的粘性项目语义） */
  setLastScope: (scope: RunScope) => void
  reference: NonNullable<OrchestratorDeps['reference']>
  builderCtx: NonNullable<OrchestratorDeps['contextBuilder']>
  mcp: NonNullable<OrchestratorDeps['mcp']>
  chat: NonNullable<OrchestratorDeps['chat']>
  now: () => Date
  newId: () => string
  registry: NonNullable<OrchestratorDeps['registry']>
  runGradle: (input: GradleRunInput, sink: (event: GradleEvent) => void) => string
  /** 等待一次 Gradle 运行结束（实例级 waiter 表在 index.ts 内桥接；timeoutMs 为 watchdog，P1-12） */
  waitForGradleDone: (
    runId: string,
    timeoutMs?: number
  ) => Promise<{ exitCode: number | null; cancelled: boolean; timedOut: boolean }>
  resolveJavaHome: () => string | undefined
  resolveProjectById: (id: string) => ResolvedProject | null
  writeFileSafe: (absPath: string, content: string) => void
  /**
   * T2：run 创建 write-through 端口后登记（runId → port 保留在 orchestrator 实例级表），
   * 使 run 结束（runs 表删除）后渲染层仍可对该 run 的文件做对比/单文件回滚。
   */
  registerWriteThrough: (runId: string, port: WriteThroughPort) => void
}

/**
 * 跑一次流水线。resumeFrom 传入历史断点快照时按 completedStage
 * 跳过已完成阶段的 LLM/构建/测试调用（断点续跑）。
 */
export async function runOrchestratorSession(
  ctx: RunSessionContext,
  request: AgentRunRequest,
  onEvent?: AgentEventListener,
  resumeFrom?: AgentRunCheckpoint
): Promise<AgentRunResult> {
  const {
    deps,
    runs,
    runScopeCtx,
    setLastScope,
    reference,
    builderCtx,
    mcp,
    chat,
    now,
    newId,
    registry,
    runGradle,
    waitForGradleDone,
    resolveJavaHome,
    resolveProjectById,
    writeFileSafe,
    registerWriteThrough
  } = ctx
  const runId = newId()
  const state: RunState = {
    canceled: false,
    gradleRunId: null,
    paused: false,
    machineState: 'idle',
    pauseResolvers: [],
    stage: 'understand',
    resumeState: null,
    emit: placeholderEmit
  }
  runs.set(runId, state)
  let seq = 0
  // per-run 作用域（P1-9）：先建立空 scope（待项目解析后再回填），
  // 避免纯聊天/无项目 run 残留上一项目语义资产工具可用性；
  // enterWith 使本次 run 的全部异步延续都读到本 scope（交错 run 互不串扰）。
  const scope: RunScope = {
    ...emptyScope(),
    // 本轮用户上传的参考图（PNG/JPEG data URL，已在渲染层压缩）；texture_pixelize 等工具引用
    referenceImages: Array.isArray(request.images)
      ? request.images.filter((u) => typeof u === 'string')
      : []
  }
  runScopeCtx.enterWith(scope)
  setLastScope(scope)
  /** run 级预算追踪器：tier 路由完成后创建；emit 随事件附快照供 UI 实时显示 */
  let budget: RunBudgetTracker | null = null
  /** run 级 token 用量累计（usage 落库）：所有计费调用经 budgetedChat，收尾统一落库 */
  let usageTotal: AgentRunUsage | null = null
  const accumulateUsage = (u: AiUsage | undefined): void => {
    if (!usageTotal) {
      usageTotal = { promptTokens: 0, completionTokens: 0, totalTokens: 0, modelCalls: 0 }
    }
    usageTotal.modelCalls += 1
    if (!u) return
    usageTotal.promptTokens += u.promptTokens ?? 0
    usageTotal.completionTokens += u.completionTokens ?? 0
    // 厂商只给分项时回退求和，保证 totalTokens 始终有意义
    usageTotal.totalTokens +=
      u.totalTokens ?? (u.promptTokens ?? 0) + (u.completionTokens ?? 0)
  }

  // ---------------- 任务图持久化：断点续跑状态 ----------------
  const runStore = deps.runStore
  /** 各阶段完成等级：恢复时 completedStage >= 某阶段即跳过该阶段的实际执行 */
  const STAGE_ORDER: Record<AgentRunCheckpoint['completedStage'], number> = {
    understand: 0,
    generate: 1,
    build: 2,
    test: 3,
    export: 4,
    done: 5
  }
  const resumeLevel = resumeFrom ? STAGE_ORDER[resumeFrom.completedStage] : -1
  /** 当前断点快照（随阶段推进逐步合并字段） */
  let checkpoint: AgentRunCheckpoint = resumeFrom
    ? { ...resumeFrom, version: 1 }
    : { version: 1, completedStage: 'understand' }
  /** 覆盖写断点；持久化失败绝不影响运行 */
  const persistCheckpoint = (
    patch: Partial<AgentRunCheckpoint> & {
      completedStage: AgentRunCheckpoint['completedStage']
    }
  ): void => {
    checkpoint = { ...checkpoint, ...patch, version: 1 }
    try {
      runStore?.saveCheckpoint(runId, checkpoint)
    } catch {
      /* 持久化失败静默 */
    }
  }
  /** 统一落库收尾（状态 + 最终回复 + 可选断点 + token 用量）；失败静默 */
  const persistFinish = (
    status: AgentRunStatus,
    reply?: string,
    finalCheckpoint?: AgentRunCheckpoint
  ): void => {
    try {
      runStore?.finishRun(runId, status, reply, finalCheckpoint, usageTotal ?? undefined)
    } catch {
      /* 持久化失败静默 */
    }
  }

  const finishCanceled = (rest?: Partial<AgentRunResult>): AgentRunResult => {
    runs.delete(runId)
    persistFinish('canceled', undefined, checkpoint)
    return {
      runId,
      intent: rest?.intent ?? 'chat',
      tier: rest?.tier ?? 'artisan',
      tierMatched: rest?.tierMatched ?? [],
      reply: '已取消本次运行。',
      files: rest?.files ?? [],
      build: rest?.build ?? null,
      test: rest?.test ?? null,
      export: rest?.export ?? null,
      skippedStages: rest?.skippedStages ?? [],
      canceled: true
    }
  }

  const emit = (
    stage: StageId,
    event: Omit<AgentEvent, 'seq' | 'runId' | 'stage' | 'at'>
  ): void => {
    if (state.canceled) return // 取消后忽略晚到事件
    const full: AgentEvent = {
      ...event,
      seq: ++seq,
      runId,
      stage,
      at: now().toISOString(),
      // run 级预算实时快照（P1-9）：每次事件随带，渲染层展示「已用 X / 上限 Y」
      ...(budget ? { budget: budget.snapshot() } : {})
    }
    // 事件流持久化（历史详情的数据源）；失败绝不影响运行与推送
    try {
      runStore?.appendEvent(runId, full)
    } catch {
      /* 持久化失败静默 */
    }
    onEvent?.(full)
  }
  state.emit = emit

  const MACHINE_LABELS: Record<AgentMachineState, string> = {
    idle: '空闲',
    understanding: '理解需求',
    generating: '生成内容',
    building: '构建验证',
    testing: '游戏实测',
    exporting: '整理导出',
    fixing: '自动修复',
    paused: '已暂停',
    failed: '失败'
  }

  function setMachine(stage: StageId, machine: AgentMachineState): void {
    state.stage = stage
    state.machineState = machine
    emit(stage, { type: 'log', detail: `状态：${MACHINE_LABELS[machine]}`, state: machine })
  }

  /** 阶段入口：先过暂停闸门，再切换显式状态 */
  async function enter(stage: StageId, machine: AgentMachineState): Promise<void> {
    await gatePaused(state)
    if (state.canceled) return
    setMachine(stage, machine)
  }

  const emptyResult = (
    intent: AgentIntent,
    reply: string,
    rest?: Partial<AgentRunResult>
  ): AgentRunResult => ({
    runId,
    intent,
    tier: rest?.tier ?? 'artisan',
    tierMatched: rest?.tierMatched ?? [],
    reply,
    files: [],
    build: null,
    test: null,
    export: null,
    skippedStages: [],
    canceled: state.canceled,
    ...rest
  })

  // ---------------- 档位路由（手动档优先，关键词次之，默认匠造） ----------------
  const rawRoute = routeTier(request.message, request.tier)
  // 人工档位锁定：锁定后收敛到锁定档（TR-10.1，不越档）
  const route = {
    ...rawRoute,
    tier: resolveTierWithLock(rawRoute.tier, getSection('ai').manualLock)
  }
  const tierCfg = TIER_CONFIGS[route.tier]

  // run 级预算熔断：模型调用/Gradle 构建/墙钟三维硬上限，超限即停止并如实告知。
  // onExceeded 先 emit 错误事件（UI 时间轴可见熔断原因），再抛 BudgetExceededError。
  budget = createRunBudget(route.tier, now, (message) => {
    emit(state.stage, { type: 'error', detail: message })
  })
  scope.budget = budget
  /** 计入预算的模型调用入口：understand/generate/构建修复/测试自愈/视觉自审全部走此通道 */
  const budgetedChat = async (req: Parameters<typeof chat>[0]): ReturnType<typeof chat> => {
    budget!.consumeModel()
    const response = await chat(req)
    // 解析 usage 累计到 run 级，收尾统一落库（token/成本可查）
    accumulateUsage(response.usage)
    return response
  }
  /** 计入预算的 Gradle 构建入口：build 阶段与测试自愈重建全部走此通道 */
  const budgetedRunGradle: typeof runGradle = (input, sink) => {
    budget!.consumeBuild()
    return runGradle(input, sink)
  }

  // 以下流水线主体整体包在 try 中：预算熔断异常在末尾统一转为「已熔断停止」失败回复。
  // （不重排缩进：try 的唯一职责是兜住 BudgetExceededError）
  try {
  // 任务图持久化：创建运行主记录（request.images 在 store 内剥离，绝不让大段 data URL 落库）
  try {
    runStore?.createRun({
      id: runId,
      projectId: request.projectId,
      tier: route.tier,
      intent: resumeFrom?.plan?.intent ?? 'chat',
      request
    })
  } catch {
    /* 持久化失败静默 */
  }

  // ---------------- 档位模型解析（可选覆盖 → 默认提供商） ----------------
  let pid = ''
  let tierModel: string | null = null
  try {
    const resolved = resolveTierModel(route.tier, getSection('ai'))
    pid = resolved.providerId
    tierModel = resolved.model
    emit('understand', {
      type: 'log',
      detail:
        route.matched.length > 0
          ? `档位：${tierCfg.name}（${tierCfg.title}）· 命中关键词：${route.matched.join('、')}`
          : request.tier
            ? `档位：${tierCfg.name}（${tierCfg.title}）· 手动指定`
            : `档位：${tierCfg.name}（${tierCfg.title}）· 默认`
    })
    emit('understand', {
      type: 'log',
      detail: `模型：${tierModel || '（提供商默认）'}${resolved.overridden ? ' · 本档覆盖' : ''}`
    })
  } catch (err) {
    emit('understand', { type: 'error', detail: (err as Error).message })
    runs.delete(runId)
    // 失败也要保留 reply（失败原因落历史，列表可见）与 checkpoint（可续跑）
    const failReply = '我还没有可用的模型连接：请打开「设置 → AI 助手」配置提供商与默认模型后再试。'
    persistFinish('failed', failReply, checkpoint)
    return emptyResult('chat', failReply)
  }

  // 单次请求显式 model 优先于档位配置
  const effectiveModel = request.model ?? tierModel

  const ask = async (
    messages: ChatMessage[],
    temperature: number
  ): Promise<{ content: string; reasoning: string }> => {
    // 不传 maxTokens：由 aiService 回退到提供商配置（设置 → AI 助手），
    // 推理模型需要较大的输出预算（思维链计入 max_tokens），硬编码 4096 会导致空回复
    const response = await budgetedChat({
      providerId: pid,
      model: effectiveModel ?? undefined,
      messages,
      temperature
    })
    return { content: response.content ?? '', reasoning: response.reasoning ?? '' }
  }

  // ---------------- understand：意图判定 + 计划 ----------------
  await enter('understand', 'understanding')
  if (state.canceled) return finishCanceled({ tier: route.tier })
  emit('understand', {
    type: 'phase',
    phase: 'running',
    action: resumeFrom?.plan ? '正在恢复上次运行进度…' : '正在理解你的意图…'
  })
  let plan: AgentPlan
  if (resumeLevel >= 0 && resumeFrom?.plan) {
    // 断点续跑：计划已在历史断点中，跳过 understand 的 LLM 调用直接恢复
    plan = resumeFrom.plan
    emit('understand', {
      type: 'phase',
      phase: 'done',
      action: `（续跑）已恢复：意图：${intentLabel(plan.intent)}｜目标：${plan.goal}`,
      artifact: {
        id: `${runId}-plan`,
        kind: 'plan',
        title: `执行计划 · ${intentLabel(plan.intent)}（续跑恢复）`,
        body: JSON.stringify(plan, null, 2),
        references: plan.contentTypes
      }
    })
  } else {
  try {
    const aiSettings = getSection('ai')
    const { content: raw, reasoning } = await ask(
      understandMessages(request, route.tier, aiSettings.entityFreeformEnabled, aiSettings.globalFreeformEnabled),
      0.1
    )
    if (reasoning) {
      emit('understand', { type: 'log', thought: reasoning })
    }
    if (state.canceled) return finishCanceled({ intent: 'chat', tier: route.tier })
    const parsed = parsePlanJson(raw, route.tier)
    if (parsed) {
      plan = parsed
    } else {
      // 模型未按 JSON 作答：视为普通问答，直接回答
      emit('understand', {
        type: 'phase',
        phase: 'done',
        action: '判定为普通问答，无需进入工程流水线'
      })
      const answer = raw.trim() || '（模型没有返回内容）'
      emit('understand', { type: 'reply', reply: answer })
      runs.delete(runId)
      persistFinish('completed', answer)
      return emptyResult('chat', answer, { tier: route.tier })
    }
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err
    const detail = `理解阶段调用失败：${(err as Error).message}`
    emit('understand', { type: 'error', detail })
    runs.delete(runId)
    // 失败也要保留 reply（失败原因落历史，列表可见）与 checkpoint（可续跑重跑 understand）
    persistFinish('failed', detail, checkpoint)
    return emptyResult(
      'chat',
      `模型调用失败（${(err as Error).message}）。请检查网络与 API Key，或稍后重试。`,
      { tier: route.tier }
    )
  }

  plan = sanitizePlan(plan, request.message)
  // 把判定出的真实意图回写 agent_runs.intent——
  // createRun 时 plan 未定只能占位 'chat'，不回写则历史列表永远显示「普通问答」
  runStore?.updateIntent(runId, plan.intent)
  const planMeta: string[] = [`${tierCfg.name}（${tierCfg.title}）档`]
  if (plan.migrationPlan) {
    planMeta.push(`迁移 ${plan.migrationPlan.sourceLoader} → ${plan.migrationPlan.targetLoader}，共 ${plan.migrationPlan.modules.length} 个模块`)
  }
  if (plan.subtasks && plan.subtasks.length > 0) {
    planMeta.push(`拆解 ${plan.subtasks.length} 个子任务`)
  }
  emit('understand', {
    type: 'phase',
    phase: 'done',
    action: `意图：${intentLabel(plan.intent)}｜目标：${plan.goal}`,
    artifact: {
      id: `${runId}-plan`,
      kind: 'plan',
      title: `执行计划 · ${intentLabel(plan.intent)}`,
      body: JSON.stringify(plan, null, 2),
      references: [planMeta.join('，'), ...plan.contentTypes]
    }
  })
  // understand 完成：保存首个断点（计划已可复用，进程崩溃后可从 generate 续跑）
  persistCheckpoint({ completedStage: 'understand', plan })
  }

  if (plan.intent === 'chat') {
    emit('understand', { type: 'phase', phase: 'running', action: '正在组织回答…' })
    const base = reference.getSystemPromptBase() ?? ''
    // 自我认知语料：回答「KunYuStudio 是什么/有哪些功能/怎么用」的事实来源（参考包未收录则缺省不注入）
    const capabilities = reference.getKunyuCapabilities()
    const { content: answer, reasoning } = await ask(
      [
        {
          role: 'system',
          content:
            base +
            (capabilities
              ? `\n\n## 附：KunYu Studio（你所在的应用）能力清单\n\n${capabilities}`
              : '') +
            mcpCapabilitySection() +
            '\n\n你是 KunYu Studio 的 Minecraft Mod 开发助手。直接用中文回答用户问题，' +
            '不确定的事实要说明不确定，不要编造 API 与版本号。'
        },
        { role: 'user', content: request.message, images: request.images }
      ],
      0.5
    ).catch((err: Error) => {
      // 预算熔断必须上抛（外层统一转失败回复），不能吞成「回答失败」
      if (err instanceof BudgetExceededError) throw err
      return { content: `回答失败：${err.message}`, reasoning: '' }
    })
    if (reasoning) emit('understand', { type: 'log', thought: reasoning })
    emit('understand', { type: 'reply', reply: answer })
    runs.delete(runId)
    persistFinish('completed', answer, { ...checkpoint, completedStage: 'done', plan })
    return emptyResult('chat', answer, { tier: route.tier, tierMatched: route.matched })
  }

  const skippedStages: StageId[] = []
  // 断点续跑：恢复历史跳过阶段清单（export/reply 汇总需要完整视图）
  if (resumeFrom?.skippedStages) skippedStages.push(...resumeFrom.skippedStages)
  const project = request.projectId ? resolveProjectById(request.projectId) : null
  // per-run 注入：工具的 available()/写盘根解析按本 run 的项目生效
  scope.projectRoot = project ? project.path : null
  scope.projectType = project ? project.type : null
  scope.projectLoader = project ? project.loader : null
  // write-through：write_project_file 即时落盘端口（file-written 事件按 generate 阶段推送，
  // 渲染层据此刷新文件树/在 Monaco 打开——工作台不再是运行中途的黑盒）
  const writeThrough = project
    ? createWriteThrough({
        projectRoot: project.path,
        writeFile: writeFileSafe,
        onFileWritten: (info) => emit('generate', { type: 'file-written', fileWritten: info })
      })
    : null
  scope.writeThrough = writeThrough
  // 端口按 runId 登记到实例级表——run 结束后「对比/单文件回滚」仍可用
  if (writeThrough) registerWriteThrough(runId, writeThrough)
  // 请求组合与工程实际组合不一致时提示（不拒绝，17 个组合全激活）
  const mismatch = detectComboMismatch(request, project)
  if (mismatch) {
    const projLoader = project?.loader ?? '?'
    const projMc = project?.mcVersion ?? '?'
    const reqLoader = mismatch.loader ?? project?.loader ?? request.loader
    const reqMc = mismatch.mcVersion ?? project?.mcVersion ?? request.mcVersion
    emit('understand', {
      type: 'log',
      detail:
        `组合不一致提示：请求 ${reqLoader}/${reqMc}，工程实际 ${projLoader}/${projMc}。` +
        `生成将按工程实际组合走（17 个组合全激活，不拒绝跨组合请求）；如需针对请求组合生成，请先切换或新建对应工程。`
    })
  }
  const comboActive = isComboActive(reference, request.loader, request.mcVersion)

  // ---------------- generate：FC 工具循环 + 文件变更 ----------------
  let files: AgentFileChange[] = []
  let generateNotes = ''
  let templates: TemplateContent[] = []
  /** content_upsert 语义资产落盘后经 generateProjectContent 生成的工程文件（视觉自审定位模型 JSON 用） */
  let assetFilePaths: string[] = []
  /** 特性③：LLM 产出的验收契约，跨 build/test 阶段逐步评估 */
  let contract: AcceptanceContract | null = null
  /** 首次 generate 的入参（test 治愈闭环的定向修复复用） */
  let genInput: GeneratePipelineInput | null = null
  /** generate 阶段产出的语义资产数（供 composeReply 判定真实产出） */
  let genAssetSaves = 0
  /** generate 阶段上报的静态缺口（缺 Java/贴图/被拒文件）；非空则封顶 partial 并可续跑 */
  let genGaps: string[] = []
  if (plan.stages.includes('generate')) {
    await enter('generate', 'generating')
    if (state.canceled) return finishCanceled({ intent: plan.intent, tier: route.tier, tierMatched: route.matched })

    if (resumeLevel >= 1 && resumeFrom) {
      // 断点续跑：generate 已完成且文件仍在盘上——恢复产物，跳过 FC 工具循环与写盘。
      // genInput 仍构造（test 自愈闭环的定向修复复用），但不执行。
      files = resumeFrom.files ?? []
      templates = (resumeFrom.templates ?? []) as TemplateContent[]
      contract = resumeFrom.contract ?? null
      generateNotes = resumeFrom.generateNotes ?? ''
      // 上轮三态结论注入 notes 头部（build/test 阶段与最终 reply 均引用 notes），防三态区分衰减
      const hint = resumeFrom.lastOutcomeHint
      if (hint && hint.verdict !== 'success') {
        const gapText = hint.gaps.length > 0 ? `；缺口：${hint.gaps.join('、')}` : ''
        const hintLine = `上轮运行结论 ${hint.verdict}（${hint.runStatus}）${gapText}——续跑时优先针对这些缺口验证或修复，不要重复已完成的工作。`
        generateNotes = `${hintLine}\n${generateNotes}`.trim()
        emit('generate', { type: 'log', detail: `（续跑）${hintLine}` })
      }
      // 领域事实行一并注入续跑 notes 头部，与 generate 首轮 system 注入同源
      const factsLine = factsToPromptLine(readFacts(project?.path))
      if (factsLine) {
        generateNotes = `项目事实：${factsLine}\n${generateNotes}`.trim()
      }
      emit('generate', {
        type: 'phase',
        phase: 'running',
        action: '（续跑）正在恢复生成产物…'
      })
      genInput = {
        runId,
        state,
        request,
        plan,
        tier: route.tier,
        tierMatched: route.matched,
        project,
        comboActive,
        templates,
        setTemplates: (t) => {
          templates = t
        },
        ctx: builderCtx,
        mcpReady: mcp.isEnabled() && mcp.getStatus().kind === 'ready',
        registry,
        chat: budgetedChat,
        providerId: pid,
        model: effectiveModel,
        emit,
        budget,
        resumeFrom,
        onSubtaskCheckpoint: (p) =>
          persistCheckpoint({
            completedStage: checkpoint.completedStage,
            subtaskProgress: p
          })
      }
      const resumedAccepted = files.filter((f) => f.accepted).length
      emit('generate', {
        type: 'phase',
        phase: 'done',
        action: `（续跑）已恢复：${files.length} 个文件变更（${resumedAccepted} 个已写入项目）`,
        artifact: {
          id: `${runId}-files`,
          kind: 'file-change',
          title: '文件变更（续跑恢复）',
          files,
          body: generateNotes || undefined
        }
      })
      if (contract) {
        emit('generate', {
          type: 'artifact',
          artifact: buildContractArtifact(`${runId}-contract`, contract)
        })
      }
    } else {
    emit('generate', {
      type: 'phase',
      phase: 'running',
      action: project
        ? `正在检索参考并生成文件变更（写入 ${project.name}）…`
        : '当前没有打开的项目，仅生成代码片段，不会写盘…'
    })

    genInput = {
      runId,
      state,
      request,
      plan,
      tier: route.tier,
      tierMatched: route.matched,
      project,
      comboActive,
      templates,
      setTemplates: (t) => {
        templates = t
      },
      ctx: builderCtx,
      mcpReady: mcp.isEnabled() && mcp.getStatus().kind === 'ready',
      registry,
      chat: budgetedChat,
      providerId: pid,
      model: effectiveModel,
      emit,
      budget,
      writeThrough,
      resumeFrom,
      onSubtaskCheckpoint: (p) =>
        persistCheckpoint({
          completedStage: checkpoint.completedStage,
          subtaskProgress: p
        })
    }
    const genOutcome = await runGeneratePipeline(genInput)
    genAssetSaves = genOutcome.assetSaves
    if (state.canceled) return finishCanceled({ intent: plan.intent, tier: route.tier, tierMatched: route.matched })
    files = genOutcome.files
    generateNotes = genOutcome.notes
    contract = genOutcome.contract
    // P2：静态缺口（缺 Java 类 / 缺贴图 / 被闸门拒收）——已落盘文件保留，
    // 缺口随收口结论上报（verdict 封顶 partial、runStatus 落 failed 可续跑补齐）
    genGaps = genOutcome.gaps ?? []
    if (genGaps.length > 0) {
      emit('generate', {
        type: 'log',
        detail:
          `本次产出保留 ${genOutcome.files.filter((f) => f.accepted).length} 个已落盘文件，` +
          `另有 ${genGaps.length} 项未闭环缺口（不判成功、可在构建验证后继续补齐）：${genGaps.join('；')}`
      })
    }

    if (project) {
      // T1：write_project_file 分片已 write-through 实时落盘（含 file-written 事件），
      // 终点循环只写「最终 JSON files 通道」的文件，不重复写盘/重复推事件
      const alreadyWritten = writeThrough?.written()
      for (const change of files) {
        if (!change.accepted) continue
        if (alreadyWritten?.has(change.path)) continue
        const abs = resolve(project.path, change.path)
        try {
          writeFileSafe(abs, change.content)
          emit('generate', {
            type: 'file-written',
            fileWritten: {
              path: change.path,
              action: change.action,
              bytes: Buffer.byteLength(change.content, 'utf8')
            }
          })
          emit('generate', {
            type: 'log',
            detail: `${change.action === 'create' ? '创建' : '更新'} ${change.path}`
          })
        } catch (err) {
          change.accepted = false
          change.reason = `写盘失败：${(err as Error).message}`
        }
      }
    }

    // 语义资产已由 content_upsert 落盘：立刻生成 Java/资源，
    // 否则用户看到 src/ 下没有文件会误判「什么都没生成」。
    let assetFiles: string[] = []
    if (project && genOutcome.assetSaves > 0) {
      try {
        const gen = generateProjectContent(project.path)
        assetFiles = gen.files.map((f) => f.path)
        assetFilePaths = assetFiles
        // P1-2：把 generateProjectContent 生成的代码/资源文件合并进 files 数组，
        // 否则 composeReply 收到的 files 恒为空，文件变更卡片不显示具体文件列表。
        files = mergeGeneratedIntoFiles(files, gen.files)
        // 为每个生成的代码/资源文件补发 file-written 事件：
        // content_upsert 路径的产物此前只写盘不推事件，导致工作台文件树不刷新、
        // 中间编辑器不自动打开，用户看到「什么都没生成」。
        for (const gf of gen.files) {
          if (gf.action === 'delete') continue
          const abs = resolve(project.path, gf.path)
          let bytes = 0
          try {
            bytes = statSync(abs).size
          } catch {
            /* 文件刚写盘瞬间被占用，size 取 0 不影响编辑器打开 */
          }
          emit('generate', {
            type: 'file-written',
            fileWritten: { path: gf.path, action: 'create', bytes }
          })
        }
        emit('generate', {
          type: 'log',
          detail: `已保存 ${genOutcome.assetSaves} 个语义资产，并生成 ${assetFiles.length} 个代码/资源文件`
        })
        if (gen.diverged.length > 0) {
          emit('generate', {
            type: 'log',
            detail: `${gen.diverged.length} 个文件因手工改动被跳过，可在可视化编辑器点「生成代码与资源」确认覆盖`
          })
        }
      } catch (err) {
        emit('generate', {
          type: 'log',
          detail: `语义资产已保存，但生成代码/资源失败：${(err as Error).message}`
        })
      }
    }

    const accepted = files.filter((f) => f.accepted).length
    const assetSaves = genOutcome.assetSaves

    // P1-4 兼容性兜底：AI 直写 Java/资源（未走 content_upsert）时，
    // 按 blockstates/models/item 反向导入最小语义骨架，让可视化编辑器可见可改；
    // 同名单全量重写文件登记为漂移保护，避免用户首次点「生成」时 AI 产物被静默覆盖。
    // 非模组工程 / 骨架校验失败等异常一律静默跳过，不影响主流水线。
    if (project && (plan.intent === 'code' || plan.intent === 'fix') && accepted > 0) {
      try {
        const stubbed = importForeignContentStubs(project.path)
        const stubCount = stubbed.blocks.length + stubbed.items.length
        if (stubCount > 0) {
          emit('generate', {
            type: 'log',
            detail:
              `兼容性兜底：已将直写产物反向导入可视化编辑器骨架（方块 ${stubbed.blocks.length}、物品 ${stubbed.items.length}）；` +
              `${stubbed.protectedFiles} 个同名文件登记为漂移保护，编辑器「生成」时默认跳过、需确认后覆盖`
          })
        }
      } catch {
        /* 非模组工程或无产物目录时跳过 */
      }
    }
    // 只走 content_upsert 的轮次 files 为 []（提示词允许），同样属于成功。
    // 注意：files 全部被安全校验拒绝（accepted=0）不算产出——否则会出现
    // 「零写盘但生成成功 → 旧代码构建通过 → 回复宣称完成」的假绿灯（鬼泣之刃事件）。
    const produced = accepted > 0 || assetSaves > 0
    // P1-E①：部分文件写盘被拒（accepted>0 但有 rejected）时给出排查指引，
    // 否则用户只看到「N 个已写入」而不知有文件被丢，生成物不完整还构建绿灯。
    const partialRejected = files.filter((f) => !f.accepted && f.reason)
    if (accepted > 0 && partialRejected.length > 0) {
      emit('generate', {
        type: 'log',
        detail:
          `${partialRejected.length} 个文件写盘被拒（如 ${partialRejected[0]?.path}：${partialRejected[0]?.reason}）。` +
          `生成物可能不完整；若构建失败或功能缺失，请检查安全软件拦截/目录只读/文件占用后回复「继续」。`
      })
    }
    emit('generate', {
      type: 'phase',
      phase: produced ? 'done' : 'error',
      action: !project
        ? `产出 ${files.length} 个代码片段（未写盘）`
        : assetSaves > 0
          ? `已保存 ${assetSaves} 个语义资产，生成 ${assetFiles.length} 个代码/资源文件，另有 ${accepted} 个文件变更写入项目`
          : `产出 ${files.length} 个文件变更，${accepted} 个已写入项目`,
      artifact: {
        id: `${runId}-files`,
        kind: 'file-change',
        title: project ? '文件变更（已写盘）' : '代码片段（无项目，未写盘）',
        files,
        body: generateNotes || undefined
      }
    })

    // 特性③：generate 后立即评估①④（file-exists + texture-ready），其余 pending
    if (contract) {
      const evaluated = evaluateAfterGenerate(project?.path ?? null, contract)
      contract = evaluated
      emit('generate', {
        type: 'artifact',
        artifact: buildContractArtifact(`${runId}-contract`, evaluated)
      })
    }

    // 反幻觉硬门：code/fix 意图在有项目时必须有真实落盘（文件写入或语义资产）。
    // 零产出说明模型没完成工作，旧代码照样能编译通过、jar 照样存在，
    // 继续跑 build/test/export 只会制造全线绿灯的假象。直接判失败并给出可执行建议。
    if (project && (plan.intent === 'code' || plan.intent === 'fix') && !produced) {
      for (const s of ['build', 'test', 'export'] as StageId[]) {
        if (!skippedStages.includes(s)) skippedStages.push(s)
      }
      // 分流：模型有产出但全部写盘失败（EPERM/EACCES 等权限/占用问题）
      // 与「模型零产出」是两类完全不同的问题——前者换模型永远修不好，
      // 后者才是模型能力问题。归因必须指向正确的对象，否则用户照着建议重试只会浪费额度。
      const rejectedWithReason = files.filter((f) => !f.accepted && f.reason)
      const writeBlocked =
        files.length > 0 &&
        accepted === 0 &&
        rejectedWithReason.some((f) => /EPERM|EACCES|EBUSY|ENOSPC|EROFS|operation not permitted/i.test(f.reason ?? ''))
      let failReply: string
      if (writeBlocked) {
        const lines = rejectedWithReason
          .slice(0, 5)
          .map((f) => `- \`${f.path}\` → ${f.reason}`)
          .join('\n')
        failReply =
          `**写入失败**（${tierCfg.name}档） —— 模型已产出 ${files.length} 个文件变更，但**一个都没能写入项目目录**，` +
          `已中止后续构建/游戏测试/导出，避免「旧代码编译通过」被误报成成功。\n\n` +
          `失败明细（前 ${Math.min(5, rejectedWithReason.length)} 条）：\n${lines}\n\n` +
          `这是**磁盘/权限问题，不是模型问题**——换模型重试多少次都是同样的结果。请按以下方式排查后回复「继续」：\n` +
          `1. 检查项目目录是否被第三方安全软件（EDR/DLP 类，如 sysdiag）拦截写入——可临时退出或将项目目录加入白名单；\n` +
          `2. 确认项目目录不是只读，且当前用户有写权限；\n` +
          `3. 关闭可能占用这些文件的程序（杀毒软件实时扫描、另一个编辑器/IDE）。`
      } else {
        failReply =
          `**生成失败**（${tierCfg.name}档） —— 模型这一轮没有产出任何文件或语义资产，` +
          `已中止后续构建/游戏测试/导出，避免「旧代码编译通过」被误报成成功。\n\n` +
          `建议按以下任一方式继续：\n` +
          `1. 切换更强模型（如大师档对应的模型）后，回复「继续」重试；\n` +
          `2. 在工坊点「⚡快速创建」先生成物品/方块骨架（保证注册、模型、创造分类齐全），再让我补充行为与贴图；\n` +
          `3. 若你已有手工代码，告诉我具体文件路径，我基于现有内容修改而不是重新生成。`
      }
      emit('understand', { type: 'reply', reply: failReply })
      runs.delete(runId)
      persistFinish('failed', failReply, {
        ...checkpoint,
        completedStage: 'understand',
        plan,
        skippedStages: [...skippedStages]
      })
      return {
        runId,
        intent: plan.intent,
        tier: route.tier,
        tierMatched: route.matched,
        reply: failReply,
        files,
        build: null,
        test: null,
        export: null,
        skippedStages,
        canceled: false
      }
    }
    // generate 完成：保存断点（含 files/templates/contract/generateNotes，供 build/test 中断后续跑）
    persistCheckpoint({
      completedStage: 'generate',
      plan,
      files,
      templates,
      contract,
      generateNotes,
      skippedStages: [...skippedStages]
    })
    }
  }

  // ---------------- build：真实 Gradle 治愈循环（轮次按档位） ----------------
  /**
   * P2a：把构建/测试失败的原始证据回灌进「同一 FC 工具循环」做定向修复。
   * 与 generate 同源（同一 registry / write-through / 预算记账），因此模型能用
   * edit_project_file 只改出错的那几行，而不是被要求重吐整份文件（最易截断、最易零产出）。
   * @param stage 事件归属阶段（build 治愈 → 'build'；测试自愈 → 'test'）
   */
  const fixViaGenerate = async (
    fixGoal: string,
    stage: StageId = 'build'
  ): Promise<{ files: AgentFileChange[]; notes: string }> => {
    if (!genInput || !project) return { files: [], notes: '' }
    const fixPlan: AgentPlan = {
      ...plan,
      goal: fixGoal,
      subtasks: undefined,
      migrationPlan: undefined
    }
    const outcome = await runGeneratePipeline({
      ...genInput,
      plan: fixPlan,
      templates,
      // 治愈轮按 fix 模式门控工具（剔除 AI 出图/市场/委派，见 FIX_MODE_EXCLUDED_TOOLS）
      mode: 'fix',
      // 修复轮是一次独立的新产出：不复用历史断点（否则织星会按旧快照跳过子任务致修复被跳过），
      // 也不写回子任务断点（修复轮失败时不应污染既有检查点）
      resumeFrom: undefined,
      onSubtaskCheckpoint: undefined
    })
    const alreadyWritten = writeThrough?.written()
    for (const change of outcome.files) {
      if (!change.accepted) continue
      if (alreadyWritten?.has(change.path)) continue
      try {
        writeFileSafe(resolve(project.path, change.path), change.content)
        emit(stage, {
          type: 'file-written',
          fileWritten: {
            path: change.path,
            action: change.action,
            bytes: Buffer.byteLength(change.content, 'utf8')
          }
        })
      } catch (err) {
        change.accepted = false
        change.reason = `写盘失败：${(err as Error).message}`
      }
    }
    files = mergeFileChanges(files, outcome.files)
    return { files: outcome.files, notes: outcome.notes }
  }

  let build: BuildConclusion | null = null
  if (plan.stages.includes('build')) {
    if (resumeLevel >= 2 && resumeFrom) {
      // 断点续跑：build 已完成，恢复构建结论，跳过 runBuildLoop（重发 phase 事件保持轨道可感知）
      build = resumeFrom.build ?? null
      emit('build', {
        type: 'phase',
        phase: build ? (build.status === 'pass' ? 'done' : build.status === 'fail' ? 'error' : 'skipped') : 'done',
        action: `（续跑）已恢复构建结论：${build?.summary ?? '无'}`,
        artifact: build ? buildArtifact(`${runId}-build`, build) : undefined
      })
    } else {
      // 统一 skip 出口：先让节点短暂进入 running（轨道可感知「这个阶段被评估过」），
      // 下一拍再落 skipped；直接连续两条 phase 事件会同帧覆盖，用户根本看不到 running。
      const emitSkip = async (
        summary: string,
        blockedByEnvironment = false
      ): Promise<void> => {
        build = {
          status: 'skipped',
          rounds: 0,
          summary,
          matchedPatternIds: [],
          // P0-b：矩阵未激活 / 缺 gradlew / Gradle 互斥 均属环境阻塞（无真实失败信号时判 inconclusive）
          ...(blockedByEnvironment ? { blockedByEnvironment: true } : {})
        }
        skippedStages.push('build')
        await enter('build', 'building')
        emit('build', { type: 'phase', phase: 'running', action: '评估构建可行性…' })
        // 给渲染层一次事件循环窗口，让 running 至少渲染一帧再落 skipped
        await new Promise<void>((r) => setTimeout(r, 50))
        if (state.canceled) return
        emit('build', {
          type: 'phase',
          phase: 'skipped',
          action: summary,
          artifact: buildArtifact(`${runId}-build`, build!)
        })
      }

      if (!project) {
        await emitSkip('没有打开的项目，无法执行真实 Gradle 构建。')
      } else if (!comboActive) {
        await emitSkip(
          `组合 ${request.loader}/${request.mcVersion} 未在参考包激活清单中，跳过真实构建回测。`,
          true
        )
      } else if (!hasGradlew(project)) {
        await emitSkip('项目目录缺少 gradlew，无法构建；请先通过新建项目向导生成完整工程。', true)
      } else {
        const busy = deps.gradleBusy ? deps.gradleBusy() : hasActiveRun()
        if (busy) {
          await emitSkip('已有 Gradle 任务在运行，为避免互斥冲突本次跳过构建。', true)
        } else {
          await enter('build', 'building')
          if (state.canceled) {
            return finishCanceled({ intent: plan.intent, tier: route.tier, tierMatched: route.matched, files })
          }
          build = await runBuildLoop({
            runId,
            state,
            request,
            project,
            tier: route.tier,
            ctx: builderCtx,
            fixViaGenerate,
            emit,
          files,
          setFiles: (next) => {
            files = next
          },
          runGradle: budgetedRunGradle,
          waitForGradleDone,
          cancelBuild: deps.cancelGradleBuild ?? cancelGradle,
          writeFileSafe,
          javaHome: resolveJavaHome()
        })
        if (state.canceled) {
          return finishCanceled({
            intent: plan.intent,
            tier: route.tier,
            tierMatched: route.matched,
            files,
            build
          })
        }
      }
    }
  }
  }

  // 特性③：build 后评估③（build-pass），re-emit contract artifact
  // 续跑恢复 build 时契约快照已含评估结果，跳过重复评估
  if (contract && resumeLevel < 2) {
    const evaluated = evaluateAfterBuild(contract, build)
    contract = evaluated
    emit('build', {
      type: 'artifact',
      artifact: buildContractArtifact(`${runId}-contract`, evaluated)
    })
  }
  // build 完成：保存断点（构建结论落库，test 阶段中断后可跳过重建）
  if (plan.stages.includes('build') && resumeLevel < 2) {
    persistCheckpoint({
      completedStage: 'build',
      plan,
      files,
      templates,
      contract,
      generateNotes,
      build,
      skippedStages: [...skippedStages]
    })
  }

  // ---------------- test：GameTest 无头预跑 + kunyu-observer 游戏沙箱兜底（TR-12.1 + 特性④） ----------------
  let test: TestOutcome | null = null
  let testReportPath: string | null = null
  if (plan.stages.includes('test')) {
    // P1-2（审查）：构建失败/未执行时短路测试段——产物未通过编译验证
    // 或 jar 未重建，真机结果必然失真，且与构建失败消息互相干扰（实证：运行
    // build error 后仍扫 kunyu-observer 并发「测试跳过」横幅）。verify 等无构建段的
    // 运行 build===null，不受影响。
    if (build && build.status !== 'pass') {
      await enter('test', 'testing')
      const summary =
        build.status === 'fail'
          ? '构建失败，测试阶段跳过：先修复构建问题，再重跑测试'
          : `构建未执行（${build.summary}），测试阶段跳过`
      test = { status: 'skipped', screenshotPath: null, summary }
      emit('test', { type: 'phase', phase: 'skipped', action: summary })
    } else if (resumeLevel >= 3 && resumeFrom) {
      // 断点续跑：test 已完成，恢复测试结论，跳过整个测试段（重发 phase 事件保持轨道可感知）
      await enter('test', 'testing')
      if (state.canceled) {
        return finishCanceled({ intent: plan.intent, tier: route.tier, tierMatched: route.matched, files, build })
      }
      test = resumeFrom.test ?? null
      emit('test', {
        type: 'phase',
        phase: test?.status === 'skipped' ? 'skipped' : 'done',
        action: `（续跑）已恢复测试结论：${test?.summary ?? '无'}`
      })
    } else {
    await enter('test', 'testing')
    if (state.canceled) {
      return finishCanceled({ intent: plan.intent, tier: route.tier, tierMatched: route.matched, files, build })
    }

    // === 特性④ GameTest 无头预跑（仅模组项目 + 含 .kunyu/content/gametest/*.json）===
    // GameTest 通过 → 跳过真机探针；失败/跳过 → 回退 kunyu-observer 真机探针。
    let gameTestReport: GameTestReport | null = null
    if (project && (existsSync(join(project.path, 'gradlew')) || existsSync(join(project.path, 'gradlew.bat')))) {
      const gametestDir = join(project.path, '.kunyu', 'content', 'gametest')
      if (existsSync(gametestDir)) {
        try {
          const jsonFiles = readdirSync(gametestDir).filter((f) => f.endsWith('.json'))
          if (jsonFiles.length > 0) {
            emit('test', {
              type: 'phase',
              phase: 'running',
              action: `检测到 ${jsonFiles.length} 个 GameTest 定义，启动 runGameTestServer 无头测试…`
            })
            gameTestReport = await runGameTestServer({
              root: project.path,
              javaHome: resolveJavaHome() ?? '',
              timeoutMs: 120000,
              onOutput: (text) => emit('test', { type: 'log', detail: text })
            })
            emit('test', {
              type: 'artifact',
              artifact: {
                id: `${runId}-gametest`,
                kind: 'gametest',
                title:
                  gameTestReport.status === 'pass'
                    ? `GameTest 通过（${gameTestReport.passed.length} 项）`
                    : gameTestReport.status === 'fail'
                      ? `GameTest 失败（${gameTestReport.failed.length} 项）`
                      : 'GameTest 跳过',
                gameTest: gameTestReport,
                body: gameTestReport.summary
              }
            })

            // 特性③ + ④ 集成：contract 含 gametest-runtime 立即按 GameTest 报告评估
            if (contract) {
              contract = evaluateAfterGameTest(gameTestReport, contract)
              emit('test', {
                type: 'artifact',
                artifact: buildContractArtifact(`${runId}-contract`, contract)
              })
            }

            // 决策：通过 + contract 无 pending → 跳过真机探针
            const hasPending = contract
              ? contract.assertions.some((a) => a.status === 'pending')
              : false
            if (gameTestReport.status === 'pass' && !hasPending) {
              const durSec = Math.round(gameTestReport.durationMs / 1000)
              test = {
                status: 'gametest-ok',
                screenshotPath: null,
                summary: `无头测试通过：${gameTestReport.summary}（耗时 ${durSec}s）`,
                gameTest: gameTestReport
              }
              emit('test', {
                type: 'phase',
                phase: 'done',
                action: 'GameTest 全通过，跳过 kunyu-observer 真机探针'
              })
            } else if (gameTestReport.status === 'fail') {
              const firstFail = gameTestReport.failed[0]
              const durSec = Math.round(gameTestReport.durationMs / 1000)
              test = {
                status: 'gametest-fail',
                screenshotPath: null,
                summary:
                  `无头测试失败：${gameTestReport.summary}` +
                  (firstFail ? `（首个失败：${firstFail.name} - ${firstFail.error}）` : '') +
                  `（耗时 ${durSec}s）`,
                gameTest: gameTestReport
              }
              emit('test', {
                type: 'phase',
                phase: 'error',
                action: 'GameTest 失败，跳过真机探针（无头结果已足够诊断）'
              })
            }
            // status='skipped' → test 保持 null，继续走 kunyu-observer 真机探针
          }
        } catch (err) {
          emit('test', {
            type: 'log',
            detail: `GameTest 预跑异常：${(err as Error).message}，回退 kunyu-observer 兜底`
          })
        }
      }
    }

    // === 测试阶段自动启动游戏（设置 ai.autoLaunchGameOnTest，默认开；B 方案）===
    // 观察通道离线且无 Gradle 任务在跑时，主动拉起开发客户端（构建脚本已注入观察探针），
    // 轮询等待通道就绪后再进入真机探针循环。B 方案不做「关客户端→自愈重构建」的互杀处理，
    // 冲突时由 fixAndRebuild 给出提示（见下方）。
    if (
      test === null &&
      project &&
      !state.canceled &&
      resumeLevel < 3 &&
      getSection('ai').autoLaunchGameOnTest !== false &&
      hasGradlew(project)
    ) {
      let online = false
      try {
        online = !!(await probeObserver({ timeoutMs: 400 }))
      } catch {
        online = false
      }
      if (!online && !hasActiveRun()) {
        emit('test', {
          type: 'phase',
          phase: 'running',
          action: '观察通道离线：自动启动开发客户端（gradlew runClient，自动装入观察探针）…'
        })
        try {
          state.gradleRunId = runGradle(
            { root: project.path, tasks: ['runClient'], javaHome: resolveJavaHome() },
            () => {}
          )
        } catch (err) {
          emit('test', { type: 'log', detail: `自动启动开发客户端失败：${(err as Error).message}` })
        }
        // runClient 进程一旦结束（游戏关闭 / 启动失败），观察通道就不可能再上线：
        // 记下退出码并跳出等待，避免空等到 180s 超时（P2 卡死检测：等待必须有终止条件）
        let clientEnded = false
        let clientExit: number | null = null
        try {
          state.gradleRunId = runGradle(
            { root: project.path, tasks: ['runClient'], javaHome: resolveJavaHome() },
            (ev) => {
              if (ev.type === 'phase' && ev.phase === 'done') {
                clientEnded = true
                clientExit = ev.exitCode
              }
            }
          )
        } catch (err) {
          emit('test', { type: 'log', detail: `自动启动开发客户端失败：${(err as Error).message}` })
        }
        const deadline = Date.now() + 180_000
        let waited = 0
        let probeOnline = false
        while (!state.canceled && !clientEnded && Date.now() < deadline) {
          // 暂停时不轮询（恢复后继续等待）：等待也是有代价的动作，必须服从暂停闸门
          await gatePaused(state)
          if (state.canceled || clientEnded) break
          await new Promise((r) => setTimeout(r, 3000))
          waited += 3
          try {
            const obs = await probeObserver({ timeoutMs: 400 })
            if (obs) {
              emit('test', {
                type: 'phase',
                phase: 'running',
                action:
                  `观察通道已上线（端口 ${obs.port}，${obs.health.inGame ? '已进入世界' : '尚未进入世界'}），` +
                  '开始真机测试…'
              })
              probeOnline = true
              break
            }
          } catch {
            /* 继续等待 */
          }
          if (waited % 15 === 0) {
            emit('test', {
              type: 'log',
              detail:
                `仍在等待游戏启动（已 ${waited}s）：客户端启动后请进入任意存档，` +
                '观察探针就绪后本阶段会自动继续。'
            })
          }
        }
        if (clientEnded && !probeOnline && !state.canceled) {
          emit('test', {
            type: 'log',
            detail:
              `开发客户端进程已退出（runClient 退出码 ${clientExit ?? '未知'}），观察通道未上线：` +
              '请查看构建输出与游戏日志后重试（已在启动失败时停止等待，不再空等超时）。'
          })
        }
      }
    }

    // === kunyu-observer 真机探针（仅当 GameTest 未产 outcome）===
    if (test === null) {
      const heal = await runTestHealLoop({
      isCanceled: () => state.canceled,
      gate: async () => {
        await gatePaused(state)
      },
      // 需人工：立即自动暂停（与 pause() 等价，直接操作闭包 state）
      pause: async () => {
        state.resumeState = state.machineState === 'paused' ? null : state.machineState
        state.paused = true
        state.machineState = 'paused'
        emit('test', {
          type: 'paused',
          state: 'paused',
          detail: '检测到需人工处理的问题，已自动暂停并生成诊断报告'
        })
      },
      // 一次完整探测：kunyu-observer 连接/状态/截图 + crash/log 采集
      probe: async () => {
        emit('test', {
          type: 'phase',
          phase: 'running',
          action: '正在扫描 kunyu-observer 探针（127.0.0.1:9876–9886）…'
        })
        let observer: ObserverEndpoint | null = null
        try {
          observer = await probeObserver({ timeoutMs: 400 })
        } catch {
          observer = null
        }
        if (observer) {
          try {
            // 未进入世界时玩家状态返回 503：给出引导而非触发自愈
            const player = await fetchPlayerState(observer.port, 3000)
            const shot = await fetchScreenshot(observer.port, 8000)
            const screenshotPath = join(tmpdir(), `kunyu-observer-${runId}.png`)
            writeFileSync(screenshotPath, dataUrlToPngBuffer(shot.dataUrl))
            const runtime = project
              ? collectRuntimeSignals(project.path)
              : { crashReport: null, latestLog: null }
            const passed = runtime.crashReport === null
            const summary =
              `kunyu-observer 真机探针：玩家 ${player.name} @ (${player.x.toFixed(1)}, ` +
              `${player.y.toFixed(1)}, ${player.z.toFixed(1)}) ${player.gameMode}，` +
              (passed ? '运行期无崩溃报告。' : `检测到崩溃报告：${(runtime.crashReport ?? '').slice(0, 120)}`)
            const outcome: TestOutcome = {
              status: passed ? 'connected-ok' : 'connected-fail',
              screenshotPath,
              summary
            }
            emit('test', {
              type: 'phase',
              phase: passed ? 'done' : 'error',
              action: passed
                ? 'kunyu-observer 截图与状态采集完成'
                : 'kunyu-observer 探测到崩溃，正在分类…',
              artifact: {
                id: `${runId}-observer-shot`,
                kind: 'probe-screenshot',
                title: '游戏实时截图（kunyu-observer）',
                screenshotPath,
                body: summary
              }
            })
            const signals: FailureSignals = {
              passed,
              crashReport: runtime.crashReport,
              latestLog: runtime.latestLog,
              introspectionOk: true,
              introspectionError: null
            }
            return { test: outcome, signals }
          } catch (obsErr) {
            const statusCode = (obsErr as { status?: number }).status
            if (statusCode === 503) {
              const skipped: TestOutcome = {
                status: 'skipped',
                screenshotPath: null,
                summary: 'kunyu-observer 已连接，但玩家尚未进入世界：请进入存档后重试测试阶段。'
              }
              emit('test', {
                type: 'phase',
                phase: 'skipped',
                action: 'observer 在线但未进入世界，测试阶段跳过',
                artifact: {
                  id: `${runId}-test`,
                  kind: 'error',
                  title: '游戏测试跳过',
                  body: skipped.summary
                }
              })
              return {
                test: skipped,
                signals: {
                  passed: false,
                  crashReport: null,
                  latestLog: null,
                  introspectionOk: false,
                  introspectionError: skipped.summary
                }
              }
            }
            emit('test', {
              type: 'log',
              detail: `kunyu-observer 探针异常：${(obsErr as Error).message}，回退离线引导`
            })
          }
        }

        const skipped: TestOutcome = {
          status: 'skipped',
          screenshotPath: null,
          summary:
            '游戏观察通道离线：需要同机运行以 kunyu-observer-agent 探针启动的 Minecraft 并进入世界。' +
            '最快启用方式：AI 助手面板顶部横幅点「一键启用」（或 设置 → AI → 内置探针 → 一键注入当前项目），' +
            '随后启动游戏（runClient 会自动装入探针）并进入存档后重跑测试。'
        }
        emit('test', {
          type: 'phase',
          phase: 'skipped',
          action: 'kunyu-observer 离线，测试阶段跳过并给出引导',
          artifact: {
            id: `${runId}-test`,
            kind: 'error',
            title: '游戏测试跳过',
            body: skipped.summary
          }
        })
        const sig: FailureSignals = {
          passed: false,
          crashReport: null,
          latestLog: null,
          introspectionOk: false,
          introspectionError: null
        }
        return { test: skipped, signals: sig }
      },
      classify: classifyFailure,
      writeReport: async (round, cls, signals) => {
        const md = buildDiagnosisReport({ runId, round, cls, signals })
        return project ? writeDiagnosisReport(project.path, runId, md) : ''
      },
      // 可修复：定向生成 → 写盘 → 重构建
      fixAndRebuild: async (round, cls) => {
        emit('test', {
          type: 'log',
          action: `第 ${round} 次自愈 · ${cls.label}`,
          detail: cls.suggestion
        })
        if (!genInput) return
        // P2a：测试失败同样回灌进同一 FC 工具循环（真实证据原文 + 定向修补工具），
        // 与构建治愈轮共用 fixViaGenerate（同一 registry / write-through / 预算记账）
        await fixViaGenerate(
          `修复游戏测试发现的「${cls.label}」问题。\n` +
            `【原始证据（未删改）】\n${cls.evidence.map((e) => `- ${e}`).join('\n')}\n` +
            `【建议修复方向】${cls.suggestion}\n\n` +
            '要求：改动既有文件优先用 edit_project_file 做 search/replace 原地修补（可一次传多个 edits）；' +
            '需要新增文件才用 write_project_file 提交完整内容。不要只解释问题，必须真正改到代码。',
          'test'
        )

        if (project && comboActive && hasGradlew(project)) {
          // B 方案：测试阶段可能自动拉起了开发客户端，它会长期占用 Gradle 运行槽，
          // 此时无法再跑 build。给出明确提示，由用户关闭游戏后重跑测试阶段。
          if (hasActiveRun()) {
            emit('test', {
              type: 'log',
              detail:
                '自愈重构建已跳过：开发客户端（runClient）正在运行并占用 Gradle 运行槽。' +
                '请关闭游戏（或点「停止」结束客户端）后重跑测试阶段以应用修复。'
            })
          } else {
            build = await runBuildLoop({
            runId,
            state,
            request,
            project,
            tier: route.tier,
            ctx: builderCtx,
            fixViaGenerate: (goal) => fixViaGenerate(goal, 'test'),
            emit,
            files,
            setFiles: (next) => {
              files = next
            },
            runGradle: budgetedRunGradle,
            waitForGradleDone,
            cancelBuild: deps.cancelGradleBuild ?? cancelGradle,
            writeFileSafe,
            javaHome: resolveJavaHome()
            })
          }
        }
      }
    })

    test = heal.test
    testReportPath = heal.reportPath
    } // end if (test === null) kunyu-observer fallback

    // 统一处理 skipped 与诊断报告（GameTest 或 kunyu-observer 任一产 outcome）
    if (test?.status === 'skipped') skippedStages.push('test')
    if (testReportPath) {
      emit('test', { type: 'log', detail: `诊断报告已生成：${testReportPath}` })
    }
    }
  }

  // 特性③：test 后评估②（registry-entry，纯静态读文件文本按 min/regex 数匹配）
  // 续跑恢复 test 时契约快照已含评估结果，跳过重复评估
  if (contract && resumeLevel < 3) {
    let evaluated = evaluateAfterTest(project?.path ?? null, contract)

    // P0-a：真机断言执行器——把机器可判定的 runtime-* 断言下沉到观察通道，
    // 由代码读取运行中游戏后判定（不再由模型读值自述、自任裁判）。
    if (hasPendingRuntimeAssertion(evaluated)) {
      let runtimePort: number | null = null
      try {
        const obs = await probeObserver({ timeoutMs: 400 })
        if (obs?.health.inGame) runtimePort = obs.port
      } catch {
        runtimePort = null
      }
      evaluated = await evaluateRuntimeAssertions(runtimePort, evaluated)
      emit('test', {
        type: 'log',
        detail:
          runtimePort === null
            ? '真机断言：观察通道离线，未读取运行中游戏（runtime-* 断言标未验证）'
            : '真机断言：已由代码读取运行中游戏并完成判定（runtime-* 断言）'
      })
      emit('test', {
        type: 'artifact',
        artifact: buildContractArtifact(`${runId}-contract`, evaluated)
      })
    }

    // 第三类 oracle（user-confirmation）：用真机探针截图挂证据
    if (hasPendingUserConfirmation(evaluated)) {
      let evidencePath = test?.screenshotPath ?? null
      // 本阶段没留下截图（如 GameTest 全通过提前短路）时，单独向 observer 要一帧
      if (!evidencePath) {
        try {
          const obs = await probeObserver({ timeoutMs: 400 })
          if (obs?.health.inGame) {
            const shot = await fetchScreenshot(obs.port, 8000)
            evidencePath = join(tmpdir(), `kunyu-observer-${runId}-confirm.png`)
            writeFileSync(evidencePath, dataUrlToPngBuffer(shot.dataUrl))
            emit('test', {
              type: 'artifact',
              artifact: {
                id: `${runId}-observer-confirm-shot`,
                kind: 'probe-screenshot',
                title: '人工确认用真机截图（kunyu-observer）',
                screenshotPath: evidencePath,
                body: '验收契约含人工确认项，已采集真机画面供核对'
              }
            })
          }
        } catch {
          // 观察通道离线：user-confirmation 会被标 skipped，不阻塞主流水线
          evidencePath = null
        }
      }
      evaluated = evaluateAfterRuntimeScreenshot(evaluated, evidencePath)
    }

    contract = evaluated
    emit('test', {
      type: 'artifact',
      artifact: buildContractArtifact(`${runId}-contract`, evaluated)
    })
  }

  // ---------------- visualReview：真机视觉自审（P1） ----------------
  // 触发条件：code 意图 + 构建通过 + 产出含模型资产 + 设置开关开启。
  // 截图送视觉模型评分；不达标回写模型坐标/display 复评（≤2 轮）。
  // 观察通道离线 / 提供商不支持视觉 / 异常 → skipped，不阻塞流水线。
  let visualReview: VisualReviewOutcome | null = null
  const reviewModelPaths = project
    ? [
        ...findModelAssetPaths(files),
        ...findModelAssetPaths(assetFilePaths.map((p) => ({ path: p, accepted: true }) as AgentFileChange))
      ].map((p) => resolve(project.path, p))
    : []
  if (
    plan.intent === 'code' &&
    build?.status === 'pass' &&
    reviewModelPaths.length > 0 &&
    getSection('ai').visualReviewEnabled !== false &&
    resumeLevel < 3 &&
    !state.canceled
  ) {
    await enter('test', 'testing')
    emit('test', {
      type: 'phase',
      phase: 'running',
      action: `视觉自审：离线三视图渲染 + 硬门清单评审（对象 ${reviewModelPaths.length} 个模型）…`
    })
    const capture = async (): Promise<{ dataUrl: string; savedPath: string } | null> => {
      // 唯一观察通道：kunyu-observer（HTTP data URL 截图）
      try {
        const obs = await probeObserver({ timeoutMs: 400 })
        if (obs) {
          const shot = await fetchScreenshot(obs.port, 8000)
          const p = join(tmpdir(), `kunyu-visualreview-${runId}-${Date.now()}.png`)
          writeFileSync(p, dataUrlToPngBuffer(shot.dataUrl))
          return { dataUrl: shot.dataUrl, savedPath: p }
        }
      } catch {
        /* 观察探针离线 */
      }
      return null
    }
    const askVision = async (messages: ChatMessage[]): Promise<string> => {
      const resp = await budgetedChat({
        providerId: pid,
        messages,
        ...(effectiveModel ? { model: effectiveModel } : {}),
        maxTokens: 1200,
        temperature: 0.2,
        toolChoice: 'none'
      })
      return resp.content
    }
    try {
      visualReview = await runVisualReview(
        {
          snapshot: (abs) =>
            renderModelSnapshot((p) => {
              try {
                return readFileSync(p)
              } catch {
                return null
              }
            }, abs),
          capture,
          ask: askVision,
          readFile: (abs) => {
            try {
              return existsSync(abs) ? readFileSync(abs, 'utf8') : null
            } catch {
              return null
            }
          },
          writeFile: writeFileSafe,
          log: (detail) => emit('test', { type: 'log', detail })
        },
        reviewModelPaths,
        request.message.slice(0, 200)
      )
    } catch (err) {
      // 预算熔断必须上抛（外层统一转失败回复），不能降级为视觉自审 skipped
      if (err instanceof BudgetExceededError) throw err
      // 未配视觉模型 / 模型不支持图片 / 网络异常等：优雅降级为 skipped
      visualReview = {
        status: 'skipped',
        score: null,
        feedback: `视觉自审不可用：${(err as Error).message}`,
        rounds: 0,
        screenshotPath: null
      }
    }
    emit('test', {
      type: 'phase',
      phase:
        visualReview.status === 'pass' ? 'done' : visualReview.status === 'fail' ? 'error' : 'skipped',
      action:
        visualReview.status === 'skipped'
          ? `视觉自审跳过：${visualReview.feedback}`
          : `视觉自审${visualReview.status === 'pass' ? '通过' : '未达标'}：` +
            `${visualReview.score}/100（回写 ${visualReview.rounds} 轮` +
            `${visualReview.rolledBack ? '，已回滚模型' : ''}）` +
            (visualReview.gates?.some((g) => !g.pass)
              ? `，硬门未过：${visualReview.gates.filter((g) => !g.pass).map((g) => g.id).join('、')}`
              : ''),
      artifact: {
        id: `${runId}-visual-review`,
        kind: 'probe-screenshot',
        title: '视觉自审（离线三视图 + 硬门清单）',
        screenshotPath: visualReview.screenshotPath ?? undefined,
        body: [
          visualReview.feedback,
          ...(visualReview.gates ?? []).map((g) => `${g.pass ? '✓' : '✗'} ${g.label}${g.note ? ` —— ${g.note}` : ''}`),
          ...(visualReview.metricViolations ?? []).map((v) => `指标越界：${v}`)
        ].join('\n')
      }
    })
  }

  // test 段完成（含 visualReview 视觉自审快照）：保存断点，export 中断后可续跑
  if (plan.stages.includes('test') && resumeLevel < 3) {
    persistCheckpoint({
      completedStage: 'test',
      plan,
      files,
      templates,
      contract,
      generateNotes,
      build,
      test,
      skippedStages: [...skippedStages]
    })
  }

  // ---------------- export：已从流水线分离为手动操作 ----------------
  // 做 mod 会持续产出多个内容（方块/物品/配方…），全部做完后
  // 才由用户手动导出 jar/zip 产物。流水线只负责 understand→generate→build→test；
  // 导出走 AGENT_EXPORT_NOW IPC（aiRuntimeHandlers.ts），复用 collectExportOutcome
  // 决策并追加 export-result artifact 到同一事件流（轨道节点照常点亮）。
  const exportOutcome: ExportOutcome | null = null

  // ---------------- 汇总最终回复 ----------------
  // P0-2/P0-4：验收门禁——核对计划承诺的内容类型是否均已落盘语义资产。
  // 任何承诺类型缺失则 verdict 降级为 partial，并在 gaps 显式列出。
  const missingContentTypes = project
    ? findMissingContentTypes(project.path, plan.contentTypes)
    : []
  const reply = composeReply({
    request,
    plan,
    tier: route.tier,
    tierMatched: route.matched,
    project,
    files,
    assetSaves: genAssetSaves,
    build,
    test,
    visualReview,
    export: exportOutcome,
    contract,
    missingContentTypes,
    generateGaps: genGaps,
    notes: generateNotes
  })
  emit('understand', { type: 'reply', reply })
  runs.delete(runId)
  // P0-B：落库状态由 RunOutcome 派生（composeReply 内部同一纯函数，可重复调用）。
  // 只有 verdict=success 才记 completed；构建失败/零产出记 failed 并可断点续跑：
  // 构建失败续跑重跑 build+治愈循环（completedStage='generate'），
  // 零产出等其他失败从 generate 重跑（completedStage='understand'）。
  // P0-5：断言未评估/契约缺失也落 failed 开放续跑——
  // 构建通过且唯一问题是断言未评估时，从 build 续跑（恢复代码产物，重跑 test 链 +
  // 契约复评 + 视觉自审 + 导出），不重烧 understand/generate 额度。
  const finalOutcome = deriveRunOutcome({
    files,
    assetSaves: genAssetSaves,
    build,
    test,
    visualReview: visualReview ?? null,
    export: exportOutcome,
    contract,
    missingContentTypes,
    generateGaps: genGaps,
    contractExpected: plan.stages.includes('generate')
  })
  const runTestFailed = test?.status === 'connected-fail' || test?.status === 'gametest-fail'
  const runUnassessed = contract
    ? contract.assertions.filter((a) => ['pending', 'skipped', 'unverified'].includes(a.status))
    : []
  const runFailedAsserts = contract
    ? contract.assertions.filter((a) => a.status === 'fail' || a.status === 'failed')
    : []
  const resumeStage: AgentRunCheckpoint['completedStage'] =
    finalOutcome.runStatus === 'completed'
      ? 'done'
      : finalOutcome.runStatus === 'inconclusive'
        ? // P0-b：环境阻塞——保留 understand/generate 产物，续跑从 build 重跑（修复环境后即生效）
          'generate'
        : build?.status === 'fail'
          ? 'generate'
          : genGaps.length > 0
            ? // P2：静态缺口未闭合——保留计划与已落盘产物，续跑直接重跑 generate 补齐缺口
              'generate'
            : contract !== null &&
            runUnassessed.length > 0 &&
            runFailedAsserts.length === 0 &&
            missingContentTypes.length === 0 &&
            !runTestFailed &&
            visualReview?.status !== 'fail'
          ? 'build'
          : 'understand'
  // 把上轮三态结论与缺口写进断点快照，续跑时注入 notes 头部，防止「已验证/未验证」在长任务中衰减
  persistFinish(finalOutcome.runStatus, reply, {
    ...checkpoint,
    completedStage: resumeStage,
    lastOutcomeHint: {
      runStatus: finalOutcome.runStatus,
      verdict: finalOutcome.verdict,
      gaps: finalOutcome.gaps
    }
  })
  return {
    runId,
    intent: plan.intent,
    tier: route.tier,
    tierMatched: route.matched,
    reply,
    files,
    build,
    test,
    visualReview,
    export: exportOutcome,
    skippedStages,
    canceled: false,
    // 会话结束「运行详情」面板的三态事实源（与落库 runStatus 同源，可重复调用）
    outcome: finalOutcome
  }
  } catch (err) {
    // 预算熔断（P1-9）：转为「已熔断停止」失败回复，避免失控的修复循环继续烧 API 额度
    if (err instanceof BudgetExceededError) {
      const reply = `**已熔断停止**（${tierCfg.name}档） —— ${err.message}`
      emit('understand', { type: 'reply', reply })
      runs.delete(runId)
      persistFinish('failed', reply, { ...checkpoint, completedStage: 'understand' })
      return {
        runId,
        intent: checkpoint.plan?.intent ?? 'code',
        tier: route.tier,
        tierMatched: route.matched,
        reply,
        files: [],
        build: null,
        test: null,
        export: null,
        skippedStages: [],
        canceled: false
      }
    }
    // P0-3：非预算异常（429/超时/网络错误等）也不得逃出 run()。
    // 修复前 throw err 导致 runs.delete / persistFinish 未执行，
    // 历史永远显示"运行中"且无法断点续跑。
    const detail = (err as Error).message || String(err)
    emit(state.stage, { type: 'error', detail })
    const reply = `**运行异常中止** —— ${detail}。请检查网络与 API Key，或稍后重试。`
    emit('understand', { type: 'reply', reply })
    runs.delete(runId)
    persistFinish('failed', reply, { ...checkpoint, completedStage: 'understand' })
    return {
      runId,
      intent: checkpoint.plan?.intent ?? 'code',
      tier: route.tier,
      tierMatched: route.matched,
      reply,
      files: [],
      build: null,
      test: null,
      export: null,
      skippedStages: [],
      canceled: false
    }
  }
}
