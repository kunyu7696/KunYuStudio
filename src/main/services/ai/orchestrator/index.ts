/**
 * 五档 Agent 编排器（M8，依《完整架构与代码文档》重构）。
 *
 * 全链路流水线：understand（判意图/路由档位/迁移计划/子任务拆解）
 * → generate（Function Calling 工具循环 + 结构化文件变更）
 * → build（真实 Gradle 治愈循环，修复轮次按档位 0/1/3/4/5）
 * → test（kunyu-observer 游戏沙箱全自动运行测试）。
 * 导出（jar / 整合包 zip）已从流水线分离为手动操作（AGENT_EXPORT_NOW）。
 *
 * 五档（sprinter/artisan/master/bridge/weaver）只控制深度：
 * 编译修复轮次、每轮文件数、工具循环轮次、prompt 侧重；模型用用户当前选择。
 * 闲聊只经过 understand。
 *
 * 资源熔断（P1-9）：单次运行受 TIER_RUN_BUDGETS 约束（模型调用/Gradle 构建/墙钟三维上限），
 * 超限即熔断停止并如实告知，事件流随带 budget 快照供 UI 实时显示。
 *
 * 安全边界：
 * - 任何写盘路径都做绝对化越界校验（拒绝 `..`、盘符、UNC、项目根外）
 * - 模型只能调用 ToolRegistry 注册的工具（mcdev-mcp 仅 8 个只读白名单）
 * - 用户取消：晚到的模型结果忽略，进行中的 Gradle 调 cancelGradle
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'

import {
  type AgentMachineState,
  type AgentRunCheckpoint,
  type AgentRunRequest,
  type AgentRunResult
} from '../../../../shared/types/agent'
import type { GradleEvent, GradleRunInput } from '../../../../shared/types/build'
import { chat as defaultChat } from '../../aiService'
import { getSection } from '../../settingsService'
import { openProject } from '../../projectService'
import { cancelGradle, executeGradleBuild, hasActiveRun } from '../../gradleService'
import { createContextBuilder } from '../contextBuilder'
import { createGradleWaiterTable } from './gradleWaiter'
import { getReferenceService } from '../referencePackageService'
import { getKbRag } from '../kbRagSingleton'
import { getMcDataService } from '../../mcDataService'
import { getMcpClient, initMcpClient, getCustomMcpManager } from '../mcpClient'
import { createToolRegistry, registerMcdevTools, registerCustomMcpTools, type ToolRegistry } from '../toolRegistry'
import { isSubAgentToolAllowed, runSubAgent } from '../subAgentRunner'
import { registerDshTools } from '../../dsh/dshHost'
import { getDb } from '../../db'
import { createAgentRunStore } from '../../agentRunStore'
import {
  type AgentEventListener,
  type Orchestrator,
  type OrchestratorDeps,
  type ResolvedProject,
  type RunState
} from './types'
import {
  emptyScope,
  runOrchestratorSession,
  type RunScope,
  type RunSessionContext
} from './runSession'
import type { WriteThroughPort } from './writeThrough'

// 公共 API 与原 orchestrator.ts 保持一致（barrel 对外 re-export）
export type { AgentEventListener, Orchestrator, OrchestratorDeps } from './types'
export { parsePlanJson, parseCoderJson, validateFileChanges } from './planParse'
export { detectComboMismatch } from './comboCheck'

export function createOrchestrator(deps: OrchestratorDeps = {}): Orchestrator {
  const reference = deps.reference ?? getReferenceService()
  const builderCtx = deps.contextBuilder ?? createContextBuilder(reference)
  const mcp =
    deps.mcp ??
    getMcpClient() ??
    initMcpClient({ javaHome: () => getSection('java').globalJdkHome || undefined })
  const chat = deps.chat ?? defaultChat
  const now = deps.now ?? (() => new Date())
  const newId = deps.idFactory ?? (() => randomUUID())
  const runs = new Map<string, RunState>()

  /**
   * T2：最近 run 的 write-through 端口表（runId → port）。runs 表在 run 结束即删，
   * 而「对比/回滚」发生在 run 结束之后——端口按 runId 在此保留，LRU 淘汰最旧。
   * 端口内快照 map 只接纳工具层已校验的相对路径，回滚/读取天然防路径逃逸。
   */
  const recentWriteThroughs = new Map<string, WriteThroughPort>()
  const MAX_RECENT_WT = 20
  const registerWriteThrough = (runId: string, port: WriteThroughPort): void => {
    recentWriteThroughs.delete(runId) // 重插到末尾（LRU 序）
    recentWriteThroughs.set(runId, port)
    while (recentWriteThroughs.size > MAX_RECENT_WT) {
      const oldest = recentWriteThroughs.keys().next().value
      if (oldest === undefined) break
      recentWriteThroughs.delete(oldest)
    }
  }

  const runScopeCtx = new AsyncLocalStorage<RunScope>()
  let lastScope: RunScope = emptyScope()
  const scopeOf = (): RunScope => runScopeCtx.getStore() ?? lastScope

  // 实例级 Gradle done 等待表（gradleWaiter.ts）：runGradle sink 收到 phase=done 时在此 resolve。
  // 收进实例避免模块级共享 Map 在多实例并发 + runId 碰撞时的隐式串扰依赖。
  // P1-12：wait 带 watchdog（超时按 timedOut=true 收口），done 事件丢失不再永久挂起。
  const gradleWaiters = createGradleWaiterTable()
  const bridgeGradleSink =
    (sink: (event: GradleEvent) => void) =>
    (event: GradleEvent): void => {
      sink(event)
      if (event.type === 'phase' && event.phase === 'done') {
        gradleWaiters.deliver(event.runId, {
          exitCode: event.exitCode,
          cancelled: event.cancelled,
          timedOut: event.timedOut
        })
      }
    }
  /** 等待一次 Gradle 运行结束：done 事件经桥装 Promise 返回（探针服务同款模式）。 */
  function waitForGradleDone(
    runId: string,
    timeoutMs?: number
  ): Promise<{ exitCode: number | null; cancelled: boolean; timedOut: boolean }> {
    return gradleWaiters.wait(runId, timeoutMs)
  }
  const runGradle: (input: GradleRunInput, sink: (event: GradleEvent) => void) => string = (input, sink) =>
    (deps.runGradle ?? executeGradleBuild)(input, bridgeGradleSink(sink))

  // 显式标注 ToolRegistry：runSubAgent 闭包在初始化器内反向引用 registry，
  // 不标注会形成循环类型推断（TS7022/7023）；运行时 TDZ 不可达见下行注释。
  const registry: ToolRegistry =
    deps.registry ??
    createToolRegistry({
      contextBuilder: builderCtx,
      reference,
      mcp,
      runGradle: (input, sink) => {
        // FC 工具内的 gradle_build 同样计入 run 级预算（无 run 上下文时不计数）
        runScopeCtx.getStore()?.budget?.consumeBuild()
        return runGradle(input, sink)
      },
      javaHome: () => resolveJavaHome(),
      projectRoot: () => scopeOf().projectRoot,
      projectType: () => scopeOf().projectType,
      projectLoader: () => scopeOf().projectLoader,
      referenceImages: () => scopeOf().referenceImages,
      // T1 write-through：write_project_file 即时落盘端口按当前 run scope 读取（无项目 run 为 null）
      writeThrough: () => scopeOf().writeThrough,
      kbRag: () => getKbRag(),
      mcData: () => getMcDataService(),
      // M1 子代理委派：成本闸门 = 设置 ai.subAgentEnabled（默认关）
      subAgentEnabled: () => getSection('ai').subAgentEnabled,
      // 闭包引用 registry：工具执行时 registry 早已完成装配，TDZ 不可达
      runSubAgent: async ({ task, context, ctx, onToolActivity }) => {
        const ai = getSection('ai')
        const providerId = ai.defaultProviderId ?? ai.providers.find((p) => p.enabled)?.id
        if (!providerId) {
          return { ok: false, text: '', error: '未配置可用 AI 提供商，请先在设置页配置', rounds: 0 }
        }
        return runSubAgent({
          task,
          context,
          ctx,
          tools: registry.getToolDefinitions().filter((d) => isSubAgentToolAllowed(d.function.name)),
          executeTool: (name, args, c) => registry.executeTool(name, args, c),
          chat,
          providerId,
          onToolActivity
        })
      },
      // P1：mc_launch 一键运行通道——后台启动 runClient（不等待 done，由用户关闭客户端收尾）。
      // 已有 Gradle 任务时拒绝，避免抢占运行槽导致构建失败。
      launchDevClient: async (root) => {
        if (hasActiveRun()) {
          return { ok: false, text: '', error: '已有 Gradle 任务在运行，请先停止后再启动客户端' }
        }
        try {
          runGradle({ root, tasks: ['runClient'], javaHome: resolveJavaHome() }, () => {})
          return {
            ok: true,
            text: '已在后台启动开发客户端（runClient）。进入本地测试世界后用 mc_state 轮询确认（观察通道 9876-9886）。'
          }
        } catch (err) {
          return { ok: false, text: '', error: `启动客户端失败：${(err as Error).message}` }
        }
      }
    })
  registerMcdevTools(registry, mcp)
  // 自定义 MCP 工具注入 FC 循环（社区 MCP 路由器：mc-texture-cli / @mcdxai/minecraft-dev-mcp 等）
  const customMcpManager = getCustomMcpManager()
  if (customMcpManager) registerCustomMcpTools(registry, customMcpManager)
  // DSH 社区插件工具注入 FC 循环（兼容宿主已加载的 ctx.tools.register 注册项）
  registerDshTools(registry)

  function resolveJavaHome(): string | undefined {
    if (deps.javaHome) return deps.javaHome()
    const configured = getSection('java').globalJdkHome
    return configured || undefined
  }

  function resolveProjectById(id: string): ResolvedProject | null {
    if (deps.resolveProject) return deps.resolveProject(id)
    try {
      const project = openProject(id)
      if (!project) return null
      return {
        id: project.id,
        name: project.name,
        path: project.path,
        type: project.type,
        mcVersion: project.mcVersion,
        loader: project.loader,
        loaderVersion: project.loaderVersion
      }
    } catch {
      return null
    }
  }

  function writeFileSafe(absPath: string, content: string): void {
    if (deps.writeFile) {
      deps.writeFile(absPath, content)
      return
    }
    mkdirSync(dirname(absPath), { recursive: true })
    // Windows 下文件被 Gradle daemon / 杀毒扫描 / 其他编辑器占用时，
    // writeFileSync 会抛 EPERM/EBUSY/EACCES；短暂重试几次等句柄释放。
    let lastErr: unknown
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        writeFileSync(absPath, content, 'utf8')
        return
      } catch (err) {
        lastErr = err
        const code = (err as NodeJS.ErrnoException).code
        if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') break
        // 同步等待 120ms 再重试（busy-wait，总最多 360ms）。
        // 注意：循环体必须保留可观察副作用，否则 esbuild/terser minify 会把
        // 空 busy-wait 循环整体删除（实测产物里 3 次重试零间隔，等于没重试）。
        const until = Date.now() + 120
        while (Date.now() < until) {
          ;(globalThis as { __kunyuIoSpin?: number }).__kunyuIoSpin = Date.now()
        }
      }
    }
    // 三次仍失败：抛出最后一次错误，调用方会写入 change.reason
    throw lastErr
  }

  // run 流水线主体（runSession.ts）的显式上下文：替代原 run 方法对闭包的隐式捕获，组装一次即可
  const sessionCtx: RunSessionContext = {
    deps,
    runs,
    runScopeCtx,
    setLastScope: (scope) => {
      lastScope = scope
    },
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
  }

  return {
    isRunning: () => runs.size > 0,
    getRegistry: () => registry,

    getRunFileSnapshot(runId: string, relPath: string): { found: boolean; original: string | null } {
      const port = recentWriteThroughs.get(runId)
      const snap = port?.snapshotOf(relPath)
      if (snap === undefined) return { found: false, original: null }
      return { found: true, original: snap }
    },

    rollbackRunFile(runId: string, relPath: string): { ok: boolean; reason?: string } {
      const port = recentWriteThroughs.get(runId)
      if (!port) return { ok: false, reason: '该运行的快照已不存在（可能已被更早的运行淘汰）' }
      if (port.snapshotOf(relPath) === undefined) {
        return { ok: false, reason: '该文件没有可回滚的快照（未经过即时写盘或已回滚）' }
      }
      port.rollback([relPath])
      return { ok: true }
    },

    cancel(runId: string): void {
      const state = runs.get(runId)
      if (!state) return
      state.canceled = true
      // 唤醒暂停等待点，让流水线走到 canceled 检查并退出
      const resolvers = state.pauseResolvers.splice(0)
      for (const r of resolvers) r()
      if (state.gradleRunId) {
        const canceller = deps.cancelGradleBuild ?? cancelGradle
        canceller(state.gradleRunId)
      }
    },

    pause(runId: string): void {
      const s = runs.get(runId)
      if (!s || s.canceled || s.paused) return
      s.resumeState = s.machineState === 'paused' ? null : s.machineState
      s.paused = true
      s.machineState = 'paused'
      s.emit(s.stage, {
        type: 'paused',
        state: 'paused',
        detail: '已暂停：恢复后继续后续步骤'
      })
    },

    resume(runId: string): void {
      const s = runs.get(runId)
      if (!s || s.canceled || !s.paused) return
      s.paused = false
      const back: AgentMachineState = s.resumeState ?? 'idle'
      s.resumeState = null
      s.machineState = back
      const resolvers = s.pauseResolvers.splice(0)
      s.emit(s.stage, {
        type: 'resumed',
        state: back,
        detail: '已恢复：流水线继续'
      })
      for (const r of resolvers) r()
    },

    async resumeRun(historyRunId: string, onEvent?: AgentEventListener): Promise<AgentRunResult> {
      const store = deps.runStore
      if (!store) throw new Error('任务图存储未启用，无法续跑历史任务')
      const record = store.getRun(historyRunId)
      if (!record) throw new Error(`找不到历史任务记录（${historyRunId}），可能已被删除`)
      if (record.status === 'completed') throw new Error('该任务已完成，无需续跑')
      if (!record.checkpoint) throw new Error('该任务没有可用的断点快照，无法续跑')
      // 以新 runId 重跑：历史记录保持只读，续跑产生全新的运行与事件流
      return this.run(record.request, onEvent, record.checkpoint)
    },

    async run(
      request: AgentRunRequest,
      onEvent?: AgentEventListener,
      resumeFrom?: AgentRunCheckpoint
    ): Promise<AgentRunResult> {
      // 流水线主体已搬至 runSession.ts；此处仅组装委托
      return runOrchestratorSession(sessionCtx, request, onEvent, resumeFrom)
    }
  }
}

// 生产编排器：Gradle done 事件的 waiter 桥接由 createOrchestrator 实例内部完成。
// 挂载任务图持久化（agent_runs 任务图 + 断点续跑快照）
export function createProductionOrchestrator(): Orchestrator {
  return createOrchestrator({ runStore: createAgentRunStore(getDb()) })
}

let singleton: Orchestrator | null = null

export function initOrchestrator(): Orchestrator {
  singleton = createProductionOrchestrator()
  return singleton
}

export function getOrchestrator(): Orchestrator {
  if (!singleton) return initOrchestrator()
  return singleton
}
