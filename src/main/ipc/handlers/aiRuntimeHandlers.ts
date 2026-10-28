import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import { getAllSettings, getSection, setSettings } from '../../services/settingsService'
import { getCustomMcpManager, initCustomMcpManager, testCustomMcpServer } from '../../services/ai/mcpClient'
import { parseMcpToolFilter } from '../../../shared/mcpToolFilter'
import { getDb } from '../../services/db'
import { createAgentRunStore, type AgentRunStore } from '../../services/agentRunStore'
import { getKbBackend } from '../../services/ai/kbRagSingleton'
import type {
  AcceptanceAssertion,
  AgentArtifact,
  AgentEvent,
  AgentFileChange,
  AgentRunRequest,
  AgentRunResult,
  BuildConclusion
} from '../../../shared/types/agent'
import { buildContractArtifact, mergeAssertions, summarizeContract } from '../../services/ai/contractEvaluator'
import { recheckAssertion } from '../../services/ai/recheckAssertion'
import { regenerateTextureAsset } from '../../services/ai/regenerateAssetService'
import { collectExportOutcome } from '../../services/ai/orchestrator/exportStage'
import type { ResolvedProject } from '../../services/ai/orchestrator/types'
import type { TierId } from '../../../shared/types/tiers'
import { openProject } from '../../services/projectService'
import type { ModPlanDraft } from '../../../shared/types/planner'
import { planModIdeas } from '../../services/ai/plannerService'
import type { IpcContext } from '../context'
import { handle } from '../handle'
import { notifyPetAgentEvent } from '../../services/dsh/petService'

/** 自定义 MCP server 入参 schema 片段：command/args 结构校验 */
const MCP_SERVER_SCHEMA = {
  type: 'object',
  required: ['command', 'args'],
  properties: {
    command: { type: 'string', minLength: 1, maxLength: 1024 },
    args: { type: 'array', items: { type: 'string', maxLength: 8192 }, maxItems: 1024 },
    env: { type: 'object', additionalProperties: { type: 'string' } },
    timeoutMs: { type: 'number', minimum: 1000, maximum: 300000 }
  }
} as const

/**
 * 从持久化设置重建自定义 MCP server 列表并同步（占位符用当前项目根替换）。
 * 打开/导入项目后由 projectHandlers 调用：修复「启动时无项目→占位符快速失败，
 * 之后永不重连」的时序问题。
 */
export async function resyncCustomMcpFromSettings(projectRoot: string | null): Promise<void> {
  // 用 init 而非 get：即使用户从未打开过设置页，启用的预置服务也应随项目打开而连接
  const mgr = initCustomMcpManager()
  const servers = getAllSettings().ai.customMcpServers
  const resolveStr = (v: string): string =>
    projectRoot ? v.split('__PROJECT_ROOT__').join(projectRoot) : v
  const sanitized = servers
    .map((s) => ({
      id: s.id,
      name: s.name,
      transport: 'stdio' as const,
      command: s.command,
      args: s.args.map(resolveStr),
      env: Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, resolveStr(String(v ?? ''))])),
      timeoutMs: s.timeoutMs,
      enabled: s.enabled,
      category: s.category,
      permission: s.permission,
      toolFilter: s.toolFilter
    }))
    .filter((s) => s.id && s.command)
  await mgr.syncFromSettings(sanitized)
}

/**
 * M7 AI 体系：参考包 / 五 Agent / 漂移监测 / mcdev-mcp。
 * 全部依赖共享的 aiRuntime 单例（由聚合层构建）。
 */
export function registerAiRuntimeHandlers(ctx: IpcContext): void {
  const aiRuntime = ctx.aiRuntime

  // 监测与探针事件桥接到渲染层
  aiRuntime.monitor.setEmitter((event) => {
    if (!ctx.win.isDestroyed()) ctx.win.webContents.send(IpcChannels.MONITOR_EVENT, event)
  })
  aiRuntime.probe.setListener((event, status) => {
    if (!ctx.win.isDestroyed()) {
      ctx.win.webContents.send(IpcChannels.MONITOR_EVENT, event, status)
    }
  })

  ipcMain.handle(IpcChannels.REF_GET_MANIFEST, () => aiRuntime.reference.getManifest())
  ipcMain.handle(IpcChannels.REF_GET_TEMPLATE, (_event, id: string) =>
    aiRuntime.reference.readTemplate(id)
  )

  // 同一时刻只允许一个 Agent 运行（runId 由首个事件回报，取消用同 id）
  let activeAgentRunId: string | null = null
  ipcMain.handle(IpcChannels.AGENT_RUN, (_event, req: AgentRunRequest) => {
    if (activeAgentRunId) {
      throw new Error('已有 Agent 任务在运行，请等待完成或取消后再试')
    }
    // A-02：互斥占位必须在 run() 同步启动前写入，不能等到首个事件回调——
    // 否则两个并发 IPC 调用在极端 I/O 交错下会同时穿过 null 检查。
    // 真实 runId 在首个事件回报后替换占位（取消仍用事件回报的真实 id）。
    activeAgentRunId = `pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const promise = aiRuntime.orchestrator.run(req, (agentEvent: AgentEvent) => {
      activeAgentRunId = agentEvent.runId
      if (!ctx.win.isDestroyed()) {
        ctx.win.webContents.send(IpcChannels.AGENT_EVENT, agentEvent)
      }
      notifyPetAgentEvent(agentEvent)
    })
    void promise.finally(() => {
      activeAgentRunId = null
    })
    return promise
  })
  // 全流程 AI 制作 · AI 极速规划：一次性拆解，不进流水线、不占运行互斥锁
  ipcMain.handle(
    IpcChannels.AGENT_PLAN,
    async (
      _event,
      message: string,
      projectType?: import('../../../shared/types/planner').PlanProjectType
    ): Promise<{ ok: true; plan: ModPlanDraft } | { ok: false; errorMessage: string }> => {
      try {
        const type = projectType === 'modpack' ? 'modpack' : 'mod'
        const plan = await planModIdeas(typeof message === 'string' ? message : '', type)
        return { ok: true as const, plan }
      } catch (err) {
        return { ok: false as const, errorMessage: (err as Error).message }
      }
    }
  )
  ipcMain.handle(IpcChannels.AGENT_CANCEL, (_event, runId: string) => {
    aiRuntime.orchestrator.cancel(runId)
  })
  ipcMain.handle(IpcChannels.AGENT_PAUSE, (_event, runId: string) => {
    aiRuntime.orchestrator.pause(runId)
  })
  ipcMain.handle(IpcChannels.AGENT_RESUME, (_event, runId: string) => {
    aiRuntime.orchestrator.resume(runId)
  })
  // T-1（审查）：窗口刷新/热重载会重建渲染层 store，而主进程的运行
  // 仍在继续——暴露互斥状态供渲染层启动时接管事件流，避免幽灵任务（不接管时
  // 事件无人订阅、用户重发请求只会撞互斥报错）。
  ipcMain.handle(IpcChannels.AGENT_ACTIVE, () => ({
    active: activeAgentRunId !== null,
    // pending_ 占位 id 对渲染层无意义（取消/续跑都认事件回报的真实 id），
    // 置 null 由首个 agent:event 回填
    runId: activeAgentRunId && !activeAgentRunId.startsWith('pending_') ? activeAgentRunId : null
  }))

  // ---------------- Agent 任务图持久化：历史任务 / 断点续跑 ----------------
  // 惰性单例复用 prepare 语句；表结构由 getDb() 内 migrate 保证
  let runStore: AgentRunStore | null = null
  const store = (): AgentRunStore => {
    if (!runStore) runStore = createAgentRunStore(getDb())
    return runStore
  }

  ipcMain.handle(
    IpcChannels.AGENT_HISTORY,
    (_event, opts?: { projectId?: string | null; limit?: number }) =>
      store().listRuns({ projectId: opts?.projectId ?? null, limit: opts?.limit ?? 20 })
  )
  ipcMain.handle(IpcChannels.AGENT_HISTORY_DETAIL, (_event, runId: string) => ({
    run: store().getRun(runId),
    events: store().getRunEvents(runId)
  }))
  ipcMain.handle(
    IpcChannels.AGENT_RESUME_RUN,
    async (
      _event,
      runId: string
    ): Promise<{ ok: true; result: AgentRunResult } | { ok: false; errorMessage: string }> => {
      if (activeAgentRunId) {
        return { ok: false, errorMessage: '已有 Agent 任务在运行，请等待完成或取消后再试' }
      }
      activeAgentRunId = runId  // A-02：立即占位，防止并发窗口内重复提交
      try {
        const promise = aiRuntime.orchestrator.resumeRun(runId, (agentEvent: AgentEvent) => {
          if (!ctx.win.isDestroyed()) {
            ctx.win.webContents.send(IpcChannels.AGENT_EVENT, agentEvent)
          }
          notifyPetAgentEvent(agentEvent)
        })
        void promise.finally(() => {
          activeAgentRunId = null
        })
        return { ok: true as const, result: await promise }
      } catch (err) {
        // 记录缺失/已完成等前置校验失败：中文错误文案直接回给渲染层
        return { ok: false as const, errorMessage: (err as Error).message }
      }
    }
  )
  ipcMain.handle(IpcChannels.AGENT_RUN_DELETE, (_event, runId: string) =>
    store().deleteRun(runId)
  )

  // 单项断言复验（证据链 #6）：重跑该校验 → 合并回契约 → 持久化事件 → 返回更新后的 artifact
  ipcMain.handle(
    IpcChannels.AGENT_RECHECK_ASSERTION,
    async (_event, runId: string, artifactId: string, assertion: AcceptanceAssertion) => {
      try {
        if (!assertion || typeof assertion !== 'object' || typeof assertion.id !== 'string') {
          return { ok: false as const, errorMessage: '断言参数无效' }
        }
        // 从持久化事件流中取最新契约（artifactId 定位，取最后一条同名 artifact）
        const events = store().getRunEvents(runId)
        const contractEvent = [...events]
          .reverse()
          .find((e) => e.artifact?.id === artifactId && e.artifact.kind === 'contract')
        const contract = contractEvent?.artifact?.contract
        if (!contract) {
          return { ok: false as const, errorMessage: '未找到该运行的验收契约（可能运行未产出契约）' }
        }
        const updated = await recheckAssertion(assertion, {
          projectPath: ctx.activeProject.current,
          javaHome: getSection('java').globalJdkHome || undefined
        })
        const next = summarizeContract(mergeAssertions(contract, [updated]))
        const artifact = buildContractArtifact(artifactId, next)
        // 持久化一条 artifact 更新事件（同 id 覆盖语义由渲染层按 id 去重实现）
        const at = new Date().toISOString()
        const seq = events.length > 0 ? Math.max(...events.map((e) => e.seq)) + 1 : 0
        store().appendEvent(runId, {
          runId,
          seq,
          stage: contractEvent!.stage,
          type: 'artifact',
          at,
          artifact
        } as AgentEvent)
        return { ok: true as const, artifact }
      } catch (err) {
        return { ok: false as const, errorMessage: (err as Error).message }
      }
    }
  )

  // 手动导出产物（导出已从流水线分离）：
  // 优先使用入参 project（当前打开的项目）；有 runId 时附带该运行的构建结论与文件清单
  // 作为导出决策上下文。manual=true 时不要求本次构建 pass，build/libs 存在 jar 即导出。
  // 结果以 export-result artifact 追加到同一事件流持久化，并经 AGENT_EVENT 推送
  // 让渲染层轨道 export 节点点亮（runId 守卫防止串扰到其他运行）。
  ipcMain.handle(
    IpcChannels.AGENT_EXPORT_NOW,
    async (
      _event,
      input: { runId?: string; project?: ResolvedProject }
    ): Promise<
      | { ok: true; artifact: AgentArtifact }
      | { ok: false; errorMessage: string }
    > => {
      try {
        const { runId, project: inputProject } = input ?? {}
        if (!inputProject && !runId) {
          return { ok: false as const, errorMessage: '请先打开一个项目再导出' }
        }

        // 有 runId 时从事件流重建构建结论 + 文件清单
        let build: BuildConclusion | null = null
        let files: AgentFileChange[] = []
        let tier: TierId = 'artisan'
        let resolvedProject: ResolvedProject | null = inputProject ?? null
        if (runId) {
          const record = store().getRun(runId)
          if (record) {
            tier = record.tier
            const events = store().getRunEvents(runId)
            const buildEvent = [...events]
              .reverse()
              .find((e) => e.artifact?.kind === 'build-result')
            build = buildEvent?.artifact?.build ?? null
            const filesEvent = [...events]
              .reverse()
              .find((e) => e.artifact?.kind === 'file-change')
            files = filesEvent?.artifact?.files ?? []
            // run 记录里的 projectId 仅在入参未提供项目时用于反查
            if (!resolvedProject && record.projectId) {
              try {
                const p = openProject(record.projectId)
                if (p) {
                  resolvedProject = {
                    id: p.id,
                    name: p.name,
                    path: p.path,
                    type: p.type,
                    mcVersion: p.mcVersion,
                    loader: p.loader,
                    loaderVersion: p.loaderVersion
                  }
                }
              } catch {
                /* 项目记录异常按无项目处理 */
              }
            }
          }
        }

        const outcome = collectExportOutcome({
          tier,
          project: resolvedProject,
          build,
          files,
          manual: true
        })
        const artifact: AgentArtifact = {
          id: `${runId ?? 'manual'}-export`,
          kind: 'export-result',
          title: '导出产物',
          export: outcome,
          body: outcome.artifacts.map((a) => a.path).join('\n') || undefined
        }

        // 有 runId 时持久化到事件流（轨道点亮）；纯手动导出（无 runId）只返回结果
        if (runId) {
          const events = store().getRunEvents(runId)
          const at = new Date().toISOString()
          const seq = events.length > 0 ? Math.max(...events.map((e) => e.seq)) + 1 : 0
          const evt: AgentEvent = {
            type: 'artifact',
            seq,
            runId,
            stage: 'export',
            at,
            action: outcome.summary,
            artifact
          }
          store().appendEvent(runId, evt)
          if (!ctx.win.isDestroyed()) {
            ctx.win.webContents.send(IpcChannels.AGENT_EVENT, evt)
          }
        }
        return { ok: true as const, artifact }
      } catch (err) {
        return { ok: false as const, errorMessage: (err as Error).message }
      }
    }
  )

  // 资源替换局部重跑（批5）：只对单个贴图 PNG 做 AI 重绘并原地回写，不重跑整个模组
  ipcMain.handle(
    IpcChannels.AGENT_REGENERATE_ASSET,
    async (
      _event,
      input: { projectPath: string; relPath: string; instruction: string; providerId?: string }
    ) => {
      try {
        const req = input ?? ({} as typeof input)
        if (!req.projectPath || typeof req.projectPath !== 'string') {
          return { ok: false as const, errorMessage: '请先打开一个项目再重跑贴图' }
        }
        return await regenerateTextureAsset({
          projectPath: req.projectPath,
          relPath: typeof req.relPath === 'string' ? req.relPath : '',
          instruction: typeof req.instruction === 'string' ? req.instruction : '',
          providerId: typeof req.providerId === 'string' ? req.providerId : undefined
        })
      } catch (err) {
        return { ok: false as const, errorMessage: `贴图重跑异常：${(err as Error).message}` }
      }
    }
  )

  // ---------------- T2：run 前原文快照读取（对比视图）/ 单文件回滚 ----------------
  // 端口按 runId 保留在 orchestrator 实例级表（LRU），快照 map 只接纳工具层已校验的
  // 相对路径——未知 runId/路径一律 found:false / ok:false，天然防路径逃逸。
  ipcMain.handle(IpcChannels.AGENT_GET_FILE_SNAPSHOT, (_event, runId: string, relPath: string) => {
    if (typeof runId !== 'string' || typeof relPath !== 'string') {
      return { found: false, original: null }
    }
    return aiRuntime.orchestrator.getRunFileSnapshot(runId, relPath)
  })
  ipcMain.handle(IpcChannels.AGENT_ROLLBACK_FILE, (_event, runId: string, relPath: string) => {
    if (typeof runId !== 'string' || typeof relPath !== 'string' || !relPath) {
      return { ok: false, reason: '参数无效' }
    }
    return aiRuntime.orchestrator.rollbackRunFile(runId, relPath)
  })

  // ---------------- A3 离线模型预置流水线 ----------------
  // 清单/缓存状态查询；手动预取（进度经 aiRuntime:model-event 推送）
  ipcMain.handle(IpcChannels.MODELS_LIST, () => ({
    ...ctx.aiRuntime.models.listModels(),
    kbBackend: getKbBackend()
  }))
  ipcMain.handle(
    IpcChannels.MODELS_PREFETCH,
    async (): Promise<
      | { ok: true; result: import('../../../shared/types/models').ModelListResult }
      | { ok: false; errorMessage: string }
    > => {
      try {
        const result = await ctx.aiRuntime.models.prefetchAll(ctx.win)
        return { ok: true as const, result: { ...result, kbBackend: getKbBackend() } }
      } catch (err) {
        // 理论上 prefetchAll 内部已消化单模型失败；此处兜底防 DB 异常穿透
        return { ok: false as const, errorMessage: (err as Error).message }
      }
    }
  )

  ipcMain.handle(IpcChannels.MONITOR_GET_STATE, () => aiRuntime.monitor.getState())
  ipcMain.handle(IpcChannels.MONITOR_CHECK, () => aiRuntime.monitor.runUpstreamCheck())
  ipcMain.handle(IpcChannels.PROBE_RUN, (_event, comboId: string) =>
    aiRuntime.probe.runBuildProbe(comboId)
  )

  ipcMain.handle(IpcChannels.MCP_GET_STATUS, () => aiRuntime.mcp.getStatus())
  ipcMain.handle(IpcChannels.MCP_SET_ENABLED, async (_event, enabled: boolean) => {
    // 先持久化用户意图；启用是后台流水线（内置索引首次约 2GB），立即返回当前状态，
    // 渲染层轮询 MCP_GET_STATUS 获取 initializing/ready/error 进度
    setSettings({ ai: { mcpEnabled: enabled } })
    if (enabled) {
      void aiRuntime.mcp.enable()
      return aiRuntime.mcp.getStatus()
    }
    await aiRuntime.mcp.disable()
    return aiRuntime.mcp.getStatus()
  })
  ipcMain.handle(IpcChannels.MCP_REFRESH, () => aiRuntime.mcp.refresh())
  // A2：开发者自定义 stdio MCP server 测试（短连接，10s 内）。
  // handle 包装：拒绝非主窗口/子帧调用；schema 仅校验 command/args 的
  // 类型与长度（结构校验，不能阻止 {command:'calc'} 这类"合法但任意"的命令——
  // 自定义 MCP 本身就是用户自配的开发者能力，不在此处做命令白名单）。
  // 命令注入（cmd.exe 元字符）防护见 mcpClient.resolveStdioSpawn 的 assertCmdSafe（S-01）。
  handle(IpcChannels.MCP_TEST_SERVER, [MCP_SERVER_SCHEMA], async (_event, cfg) => {
    const args = Array.isArray(cfg.args) ? cfg.args.filter((v: unknown) => typeof v === 'string') : []
    // __PROJECT_ROOT__ 占位符：有项目则替换；无项目直接返回友好提示，不让子进程带字面量崩掉
    const projectRoot = ctx.activeProject.current
    const hasPlaceholder = (list: string[]): boolean => list.some((a) => a.includes('__PROJECT_ROOT__'))
    if (hasPlaceholder(args) && !projectRoot) {
      return { ok: false, tools: [], error: '该服务绑定项目目录（__PROJECT_ROOT__），请先打开一个项目再测试' }
    }
    const resolveStr = (v: string): string => (projectRoot ? v.split('__PROJECT_ROOT__').join(projectRoot) : v)
    const rawEnv = cfg.env && typeof cfg.env === 'object' ? (cfg.env as Record<string, string>) : {}
    return testCustomMcpServer({
      command: typeof cfg.command === 'string' ? cfg.command : '',
      args: args.map(resolveStr),
      env: Object.fromEntries(Object.entries(rawEnv).map(([k, v]) => [k, resolveStr(String(v ?? ''))])),
      timeoutMs: typeof cfg.timeoutMs === 'number' ? cfg.timeoutMs : 30_000
    })
  })
  // 自定义 MCP 持久连接管理
  ipcMain.handle(IpcChannels.MCP_LIST_CUSTOM_TOOLS, () => {
    const mgr = getCustomMcpManager()
    return mgr ? mgr.list() : []
  })
  // MCP_SYNC_CUSTOM：handle 包装 + schema 校验 servers 数组结构。
  // 内联归一化保留（占位符替换 / category / permission 枚举收敛）。
  handle(
    IpcChannels.MCP_SYNC_CUSTOM,
    [{ type: 'array', items: MCP_SERVER_SCHEMA, maxItems: 64 }],
    async (_event, servers) => {
      const mgr = initCustomMcpManager()
      if (!Array.isArray(servers)) return
      // 替换 __PROJECT_ROOT__ 占位符为当前项目根（支持独立参数、--opt=__PROJECT_ROOT__ 内嵌及 env）
      const projectRoot = ctx.activeProject.current
      const resolveStr = (v: string): string =>
        projectRoot ? v.split('__PROJECT_ROOT__').join(projectRoot) : v
      const resolveRoot = (args: string[]): string[] => args.map(resolveStr)
      const sanitized = servers
        .filter((s: unknown) => s && typeof s === 'object')
        .map((s: Record<string, unknown>) => {
          const categoryRaw = s['category']
          const permissionRaw = s['permission']
          const argsRaw = Array.isArray(s['args']) ? s['args'].filter((v: unknown) => typeof v === 'string') : []
          const category: 'texture' | 'code' | 'game-control' | 'general' =
            categoryRaw === 'texture' || categoryRaw === 'code' || categoryRaw === 'game-control' || categoryRaw === 'general'
              ? categoryRaw
              : 'general'
          const permission: 'read' | 'interact' | 'admin' =
            permissionRaw === 'read' || permissionRaw === 'interact' || permissionRaw === 'admin'
              ? permissionRaw
              : 'read'
          const envRaw = s['env'] && typeof s['env'] === 'object' ? (s['env'] as Record<string, string>) : {}
          const env: Record<string, string> = {}
          for (const [k, v] of Object.entries(envRaw)) env[k] = resolveStr(String(v ?? ''))
          return {
            id: typeof s['id'] === 'string' ? s['id'] : '',
            name: typeof s['name'] === 'string' ? s['name'] : '',
            transport: 'stdio' as const,
            command: typeof s['command'] === 'string' ? s['command'] : '',
            args: resolveRoot(argsRaw),
            env,
            timeoutMs: typeof s['timeoutMs'] === 'number' ? s['timeoutMs'] : 30_000,
            enabled: Boolean(s['enabled']),
            category,
            permission,
            toolFilter: parseMcpToolFilter(s['toolFilter'])
          }
        })
        .filter((s) => s.id && s.command)
      await mgr.syncFromSettings(sanitized)
    }
  )
  // MCP_CALL_CUSTOM_TOOL：schema 校验 serverId/toolName 为字符串、args 为对象。
  handle(
    IpcChannels.MCP_CALL_CUSTOM_TOOL,
    [
      { type: 'string', minLength: 1, maxLength: 256 },
      { type: 'string', minLength: 1, maxLength: 256 },
      { type: ['object', 'null'], additionalProperties: true }
    ],
    async (_event, serverId: string, toolName: string, args: Record<string, unknown>) => {
      const mgr = getCustomMcpManager()
      if (!mgr) return { ok: false, text: '', error: 'CustomMcpManager 未初始化' }
      return mgr.callTool(serverId, toolName, args ?? {})
    }
  )
}
