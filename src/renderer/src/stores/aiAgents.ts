import { defineStore } from 'pinia'
import { ElMessageBox } from 'element-plus'
import {
  type AgentArtifact,
  type AgentEvent,
  type AgentIntent,
  type AgentPhaseState,
  type AgentRunBudget,
  type AgentRunRecord,
  type AgentRunRequest,
  type RunOutcome
} from '../../../shared/types/agent'
import {
  ALL_STAGE_IDS,
  STAGE_METAS,
  type StageId,
  type TierId
} from '../../../shared/types/tiers'
import type { LoaderId } from '../../../shared/types/aiReference'
import type { ChatAttachment } from '../../../shared/types/ai'
import { routeTier } from '../../../shared/services/agentRouter'
import { detectLockConflict } from '../../../shared/services/manualLock'
import { useAiChatStore } from './aiChat'
import { useProjectStore } from './project'
import { useEditorStore } from './editor'
import { useExplorerStore } from './explorer'
import { useSettingsStore } from './settings'
import { useUiStore } from './ui'
import { buildPromptWithDocs, toDisplayAttachment } from '../utils/attachment'

const MAX_STAGE_LOGS = 50

/**
 * file-written 副作用防抖（500ms）。
 * write-through 让文件随工具调用陆续落盘：每次落盘刷新文件树并在 Monaco 打开该文件
 * （「看得见 AI 在写什么」的工作可见性）；终点批量落盘等密集事件折叠为最后一次。
 * 打开/刷新时置「流式揭示」标记，CodeEditor 按行渐进铺开内容（伪流式观感）。
 */
let fileWrittenTimer: ReturnType<typeof setTimeout> | null = null
let pendingWrittenPath: string | null = null

function scheduleFileWrittenSideEffects(relPath: string): void {
  pendingWrittenPath = relPath
  if (fileWrittenTimer) clearTimeout(fileWrittenTimer)
  fileWrittenTimer = setTimeout(() => {
    fileWrittenTimer = null
    const rel = pendingWrittenPath
    pendingWrittenPath = null
    if (!rel) return
    const project = useProjectStore().currentProject
    const explorerStore = useExplorerStore()
    // 刷新文件树并自动展开/选中该文件（否则 refreshAll 会把树折叠回根，看不出 AI 改了什么）
    void (async () => {
      await explorerStore.refreshAll()
      await explorerStore.revealFile(rel)
    })()
    if (project) {
      const abs = `${project.path}/${rel}`
      const editorStore = useEditorStore()
      // 先置标记再触发呈现：已打开 → reloadTab 驱动内容 watch 播动画；
      // 未打开 → openByPath 挂载后由 onMounted 消费标记播动画
      editorStore.requestStreamReveal(abs)
      if (editorStore.tabs.some((t) => t.path === abs)) {
        void editorStore.reloadTab(abs)
      } else {
        void editorStore.openByPath(abs)
      }
    }
  }, 500)
}

export interface AgentStageState {
  id: StageId
  name: string
  title: string
  responsibility: string
  phase: AgentPhaseState
  action: string
  /** 最近的过程日志（滚动） */
  logs: string[]
  /** 推理模型的思考过程（reasoning_content），按 LLM 调用轮次累计 */
  thoughts: string[]
  artifacts: AgentArtifact[]
  expanded: boolean
}

function freshStages(): AgentStageState[] {
  return STAGE_METAS.map((m) => ({
    id: m.id,
    name: m.name,
    title: m.title,
    responsibility: m.responsibility,
    phase: 'waiting' as AgentPhaseState,
    action: '待命',
    logs: [],
    thoughts: [],
    artifacts: [],
    expanded: false
  }))
}

/** 时间轴条目：一次工具调用（可聚合成「已读取/编辑/执行」折叠组） */
export interface AgentTimelineTool {
  kind: 'tool'
  /** artifact id，去重用 */
  id: string
  /** 工具名（英文标识，如 content_upsert） */
  tool: string
  /** 原始标题 */
  title: string
  /** 参数预览（JSON 片段） */
  body: string
  /** T1：执行结果（tool-activity 事件回填）；undefined=进行中/未回报 */
  ok?: boolean
  /** T1：一行结果摘要（tool-activity 事件回填） */
  resultSummary?: string
  stage: StageId
  at: string
  /**
   * M3：本条为子代理内部活动（agent_delegate 委派的子代理所执行的工具调用）。
   * 渲染层据此把它从主平铺流分流，聚合到对应委派节点下嵌套展示。
   */
  subAgent?: boolean
  /** M3：子代理内部调用的稳定 id（r{round}-{index} 或 t{i}-r{round}-{index}），进行中→结果合并用 */
  subCallId?: string
  /** M3：归属的委派调用 id（主代理 agent_delegate 的 callId） */
  parentCallId?: string
  /** M3：子代理任务标题（嵌套节点标题用） */
  subAgentTask?: string
}
/** 时间轴条目：一条普通过程日志（护栏/阶段说明等） */
export interface AgentTimelineLog {
  kind: 'log'
  text: string
  stage: StageId
  at: string
}
export type AgentTimelineItem = AgentTimelineTool | AgentTimelineLog

const MAX_TIMELINE = 200

function entryId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 五档 Agent 流水线 store（M8）：五档（迅工/匠造/大师/桥接/织星）共用一条
 * 五阶段轨道（understand→generate→build→test→export）。订阅 agent:event
 * 重建轨道状态，运行结束把最终回复作为 assistant 气泡写回 aiChat。
 */
export const useAiAgentsStore = defineStore('aiAgents', {
  state: () => ({
    /** 当前/最近一次运行 id */
    runId: null as string | null,
    running: false,
    /** 暂停态（TR-9.1） */
    paused: false,
    /** 轨道是否可见：chat 意图运行结束后自动收起 */
    visible: false,
    /** 最近一次运行的意图（普通问答不展示轨道） */
    lastIntent: null as AgentIntent | null,
    /** 最近一次运行的档位（自动路由或手动指定） */
    lastTier: null as TierId | null,
    /** 自动路由命中的关键词（手动档为空） */
    tierMatched: [] as string[],
    canceled: false,
    stages: freshStages(),
    /** 工作流时间轴：工具调用与日志按事件到达顺序交错保存（气泡内折叠块展示） */
    timeline: [] as AgentTimelineItem[],
    /** 版本矩阵中选中的目标组合（无打开项目时生效） */
    targetCombo: { loader: 'fabric' as LoaderId, mcVersion: '1.20.1' },
    subscribed: false,
    /**
     * 用户手动选择的档位；null = 关键词自动路由（默认）。
     * 运行中禁改；档位只控制深度（修复轮次/文件数/工具循环），全部免费不限量。
     */
    selectedTier: null as TierId | null,
    /** 历史任务列表（agent_runs，按最近活动倒序，最多 20 条） */
    history: [] as AgentRunRecord[],
    /** 历史任务是否已拉取过（避免每次展开都打 IPC） */
    historyLoaded: false,
    /** 最近一次运行的最终回复（制作完成态展示用；resetRun 清空） */
    lastReply: null as string | null,
    /** 本次运行资源预算快照（P1-9 熔断；事件流随带最新用量，resetRun 清空） */
    budget: null as AgentRunBudget | null,
    /**
     * 最近一次运行的结论（会话结束「运行详情」面板的三态事实源：
     * success/partial/failed/inconclusive）；chat/异常早退时为 null，resetRun 清空。
     */
    lastOutcome: null as RunOutcome | null,
    /** 后台任务接管轮询句柄（T-1：旧渲染层的 invoke awaiter 已销毁，靠轮询收尾） */
    backgroundSyncTimer: null as ReturnType<typeof setInterval> | null,
    /**
     * 当前 AI 助手会话绑定的项目 id：打开项目时绑定、关闭项目时清空。
     * 面板与轨道只反映该项目的运行/历史，避免跨项目串任务。
     */
    sessionProjectId: null as string | null,
    /**
     * 已作废运行的 runId：切换/关闭项目时把在跑的旧运行取消并作废其 runId，
     * handleEvent 据此丢弃旧运行的迟到事件，避免其过程/产物串进新项目。
     */
    mutedRunId: null as string | null,
    /**
     * 启动接管的后台运行 runId（syncBackgroundRun 探测到窗口重载前遗留的运行）。
     * 此类运行尚未绑定项目；随后启动恢复打开项目时（openForProject）应认领而非取消。
     */
    adoptedRunId: null as string | null
  }),

  getters: {
    /** 当前活跃阶段：优先 running，否则取最近一个完成/出错的阶段 */
    activeStage(state): AgentStageState | null {
      const running = state.stages.find((s) => s.phase === 'running')
      if (running) return running
      for (let i = state.stages.length - 1; i >= 0; i--) {
        const s = state.stages[i]
        if (s.phase !== 'waiting') return s
      }
      return null
    },
    /** 本次运行所有阶段的执行日志汇总（供消息气泡实时展示工作流） */
    currentLogs(state): string[] {
      return state.stages.flatMap((s) => s.logs).filter(Boolean)
    },
    /** 本次运行所有阶段的思考过程汇总（reasoning_content） */
    currentThoughts(state): string[] {
      return state.stages.flatMap((s) => s.thoughts).filter(Boolean)
    },
    /** 工具调用统计：按工具名聚合调用次数，供气泡展示「已调用 N 个工具」摘要 */
    toolCallStats(state): { name: string; count: number }[] {
      const map = new Map<string, number>()
      for (const s of state.stages) {
        for (const a of s.artifacts) {
          if (a.kind !== 'tool-call') continue
          // title 形如「工具调用 · content_upsert」，取最后一段作为工具名
          const name = a.title.split('·').pop()?.trim() || a.title
          map.set(name, (map.get(name) ?? 0) + 1)
        }
      }
      return Array.from(map.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
    },
    /** 工具调用总数 */
    toolCallCount(state): number {
      let n = 0
      for (const s of state.stages) {
        n += s.artifacts.filter((a) => a.kind === 'tool-call').length
      }
      return n
    },
    /** 供消息流气泡嵌入的本次运行产出（文件/构建/截图） */
    runArtifacts(state): (runId: string) => AgentArtifact[] {
      return (runId: string) => {
        if (state.runId !== runId) return []
        return state.stages.flatMap((s) => s.artifacts)
      }
    }
  },

  actions: {
    ensureSubscription(): void {
      if (this.subscribed) return
      this.subscribed = true
      window.api.on('agent:event', (event: unknown) => {
        this.handleEvent(event as AgentEvent)
      })
    },

    setTarget(loader: LoaderId, mcVersion: string): void {
      this.targetCombo = { loader, mcVersion }
    },

    /** 停止后台接管轮询（用户主动发起新运行时由 run()/resumeRun() 调用） */
    stopBackgroundSync(): void {
      if (this.backgroundSyncTimer) {
        clearInterval(this.backgroundSyncTimer)
        this.backgroundSyncTimer = null
      }
    },

    /**
     * 启动时后台任务接管（T-1，审查）：窗口刷新/热重载会重建 pinia
     * store，而主进程的运行仍在继续——不接管则事件流无人订阅、用户重发请求只会
     * 撞互斥。查询主进程互斥状态：有活跃运行则恢复订阅、点亮轨道并轮询至运行
     * 结束（本次运行的完成信号只能靠轮询，因为原 invoke awaiter 已随旧渲染层销毁）。
     * App.vue onMounted 调用一次；用户主动发起的 run/resumeRun 不经过这里。
     */
    async syncBackgroundRun(): Promise<void> {
      try {
        if (this.running || this.backgroundSyncTimer) return
        const s = await window.api.agent.active()
        if (!s?.active || this.running) return
        this.ensureSubscription()
        this.visible = true
        this.running = true
        if (s.runId && !this.runId) this.runId = s.runId
        // 记录为「启动接管」：稍后启动恢复打开项目时由此认领（不取消），
        // 而非被 openForProject 当作「从别的项目切过来」的旧运行取消
        this.adoptedRunId = s.runId ?? null
        const stage = this.stages.find((x) => x.id === 'understand')
        if (stage && stage.phase === 'waiting') {
          stage.phase = 'running'
          stage.action = '检测到后台任务仍在运行，已重新接管事件流'
        }
        this.backgroundSyncTimer = setInterval(() => {
          void window.api
            .agent.active()
            .then((st) => {
              if (st?.active) return
              this.stopBackgroundSync()
              this.running = false
              void this.loadHistory(true).catch(() => {})
            })
            .catch(() => {})
        }, 3000)
      } catch {
        /* 查询失败不阻塞启动 */
      }
    },

    /**
     * AI 规划阶段驱动 understand 轨道（原全流程 AI 制作向导 Step2；灵感台暂未复用）。
     * 规划本身走轻量 planner（不进编排器），但用同样的轨道语义让用户看到
     * AI 正在「拆解任务」；后续 agents.run() 时 resetRun 会清盘重来。
     */
    beginPlanning(idea: string): void {
      this.resetRun()
      this.visible = true
      const stage = this.stages.find((s) => s.id === 'understand')
      if (stage) {
        stage.phase = 'running'
        stage.action = '正在拆解创意需求'
        stage.logs = [
          `收到${idea.length > 40 ? idea.slice(0, 40) + '…' : idea}`,
          '调用规划模型拆解玩法机制、内容模块、数值进度与美术资源…'
        ]
        stage.expanded = true
      }
    },

    finishPlanning(success: boolean, detail?: string): void {
      const stage = this.stages.find((s) => s.id === 'understand')
      if (!stage) return
      if (success) {
        stage.phase = 'done'
        stage.action = '规划完成，等待确认构建'
        if (detail) stage.logs.push(`规划概要：${detail}`)
      } else {
        stage.phase = 'error'
        stage.action = '规划失败'
        if (detail) stage.logs.push(detail)
      }
    },

    /** 手动选择档位；null 恢复自动路由。运行中禁改。 */
    setTier(tier: TierId | null): void {
      if (this.running) return
      this.selectedTier = tier
    },

    resetRun(): void {
      this.stages = freshStages()
      this.timeline = []
      this.canceled = false
      this.paused = false
      this.lastIntent = null
      this.lastTier = null
      this.tierMatched = []
      this.lastReply = null
      this.budget = null
      this.lastOutcome = null
    },

    // ---------------- 与项目绑定：打开项目主动开启，关闭项目收起并清盘 ----------------

    /**
     * 打开项目时主动开启 AI 助手：面板展开、历史任务按该项目刷新。
     * 若此前在别的项目里还有运行中的任务，先取消并作废，避免它继续写进旧项目、
     * 或把旧项目的运行过程与产物串进刚打开的新项目。
     */
    openForProject(projectId: string): void {
      if (this.sessionProjectId === projectId) {
        useUiStore().showAiPanel()
        return
      }
      // 启动接管（T-1）：窗口重载前遗留的后台运行尚未绑定项目，
      // 此时打开的项目即为它的归属——认领而不取消，并把历史切到该项目。
      const adopted = this.running && this.adoptedRunId !== null && this.sessionProjectId === null
      if (adopted) {
        this.adoptedRunId = null
        this.history = []
        this.historyLoaded = false
      } else {
        this.resetSessionForProject(projectId)
      }
      this.sessionProjectId = projectId
      useUiStore().showAiPanel()
      if (!adopted) void this.loadHistory(true).catch(() => {})
    },

    /** 关闭项目：收起 AI 助手并清空运行/会话状态，避免下次打开别的项目时串入本次上下文 */
    closeForProject(): void {
      this.resetSessionForProject(null)
      useUiStore().hideAiPanel()
    },

    /**
     * 把 AI 助手会话重绑到指定项目（null = 无项目）：作废在跑的旧运行
     * （取消 + 作废 runId 以丢弃其迟到事件）、清空轨道/时间轴/历史，
     * 使面板只反映目标项目。
     */
    resetSessionForProject(projectId: string | null): void {
      if (this.running) {
        if (this.runId) {
          this.mutedRunId = this.runId
          void this.cancel()
        } else {
          // 刚发起、首个事件尚未回填 runId：异步查明后补作废并取消，避免其事件串进新项目
          void window.api
            .agent.active()
            .then((s) => {
              if (!s?.active || !s.runId) return
              this.mutedRunId = s.runId
              void window.api.agent.cancel(s.runId)
            })
            .catch(() => {})
        }
      }
      this.stopBackgroundSync()
      this.resetRun()
      this.runId = null
      this.adoptedRunId = null
      this.running = false
      this.visible = false
      this.history = []
      this.historyLoaded = false
      this.sessionProjectId = projectId
    },

    handleEvent(event: AgentEvent): void {
      // 已作废的旧运行（切换/关闭项目时被取消）：丢弃其迟到事件，避免串进当前项目
      if (this.mutedRunId && event.runId === this.mutedRunId) return
      // runId 在首个事件到达时回填（发起调用时主进程生成 id）
      if (!this.runId) {
        this.runId = event.runId
      } else if (event.runId !== this.runId) {
        return
      }
      // 预算快照（P1-9）：主进程每个事件随带最新用量，直接覆盖
      if (event.budget) this.budget = event.budget
      const stage = this.stages.find((s) => s.id === event.stage)
      if (!stage) return

      if (event.type === 'paused') this.paused = true
      else if (event.type === 'resumed') this.paused = false

      if (event.phase) {
        stage.phase = event.phase
        if (event.action) stage.action = event.action
        // 进入运行/出错时自动展开，便于感知过程
        if (event.phase === 'running' || event.phase === 'error') stage.expanded = true
      } else if (event.action) {
        stage.action = event.action
      }
      if (event.detail) {
        stage.logs.push(event.detail)
        if (stage.logs.length > MAX_STAGE_LOGS) {
          stage.logs.splice(0, stage.logs.length - MAX_STAGE_LOGS)
        }
        this.timeline.push({
          kind: 'log',
          text: event.detail,
          stage: event.stage,
          at: event.at
        })
      }
      // 推理过程：每次 LLM 调用的 reasoning_content 追加到阶段 thoughts
      if (event.thought) {
        stage.thoughts.push(event.thought)
        stage.expanded = true
      }
      if (event.artifact) {
        const idx = stage.artifacts.findIndex((a) => a.id === event.artifact!.id)
        if (idx >= 0) stage.artifacts.splice(idx, 1, event.artifact)
        else stage.artifacts.push(event.artifact)
        stage.expanded = true
        // 工具调用进入时间轴（按 artifact id 去重，更新事件不重复插入）
        if (event.artifact.kind === 'tool-call') {
          const exists = this.timeline.some(
            (item) => item.kind === 'tool' && item.id === event.artifact!.id
          )
          if (!exists) {
            const toolName = event.artifact.title.split('·').pop()?.trim() ?? event.artifact.title
            this.timeline.push({
              kind: 'tool',
              id: event.artifact.id,
              tool: toolName,
              title: event.artifact.title,
              body: event.artifact.body ?? '',
              stage: event.stage,
              at: event.at
            })
          }
        }
      }
      // T1：工具执行结果回填——合并进对应 tool-call 卡片（callId 一一对应），
      // 找不到（时间轴被裁剪等）时补一张结果卡片，保证「AI 做了什么」始终可见
      if (event.type === 'tool-activity' && event.toolActivity) {
        const act = event.toolActivity
        // M3：子代理内部活动——按 (parentCallId, subCallId) 合并，不进主平铺匹配
        if (act.parentCallId) {
          const existing = this.timeline.find(
            (t) => t.kind === 'tool' && t.subAgent && t.parentCallId === act.parentCallId && t.subCallId === act.callId
          )
          if (existing && existing.kind === 'tool') {
            if (act.ok || act.summary) {
              existing.ok = act.ok
              existing.resultSummary = act.summary
            }
          } else {
            this.timeline.push({
              kind: 'tool',
              id: `sub-${act.parentCallId}-${act.callId}`,
              tool: act.tool,
              title: act.subAgentTask ? `子代理 · ${act.tool}` : act.tool,
              body: act.summary,
              ok: act.ok,
              resultSummary: act.summary,
              stage: event.stage,
              at: event.at,
              subAgent: true,
              subCallId: act.callId,
              parentCallId: act.parentCallId,
              subAgentTask: act.subAgentTask
            })
          }
        } else {
          const artId = `tool-${act.callId}`
          const item = this.timeline.find((t) => t.kind === 'tool' && t.id === artId)
          if (item && item.kind === 'tool') {
            item.ok = act.ok
            item.resultSummary = act.summary
          } else {
            this.timeline.push({
              kind: 'tool',
              id: artId,
              tool: act.tool,
              title: act.path ? `${act.tool} · ${act.path}` : act.tool,
              body: act.path ?? act.summary,
              ok: act.ok,
              resultSummary: act.summary,
              stage: event.stage,
              at: event.at
            })
          }
        }
      }
      // T1：文件落盘事实——防抖刷新文件树 + Monaco 打开该文件（工作台同步可见）
      if (event.type === 'file-written' && event.fileWritten) {
        scheduleFileWrittenSideEffects(event.fileWritten.path)
      }
      if (this.timeline.length > MAX_TIMELINE) {
        this.timeline.splice(0, this.timeline.length - MAX_TIMELINE)
      }
    },

    /**
     * 发起一次流水线运行。普通问答请继续使用 aiChat.send（M6 路径）。
     * 返回错误文案；null 表示已提交。
     */
    async run(message: string, attachments: ChatAttachment[] = []): Promise<string | null> {
      const text = message.trim()
      const docs = attachments.filter((a) => a.kind === 'doc')
      const images = attachments.filter((a) => a.kind === 'image').map((a) => a.dataUrl ?? '')
      const hasImage = images.some((u) => u.length > 0)
      if ((!text && attachments.length === 0) || this.running) return null
      // 文档文本拼入请求；纯图片消息给一个默认引导语
      let enriched = buildPromptWithDocs(text, docs)
      if (!enriched.trim() && hasImage) enriched = '请查看我上传的图片并回答。'
      this.ensureSubscription()

      const projectStore = useProjectStore()
      const project = projectStore.currentProject
      const settings = useSettingsStore()

      // 冲突检测：本次自动流程需要的档位 vs 人工锁定（TR-10.2）
      const requiredTier = routeTier(enriched, this.selectedTier).tier
      if (detectLockConflict(requiredTier, settings.ai.manualLock)) {
        const choice = await this.promptLockConflict(requiredTier, settings.ai.manualLock.tier as TierId)
        if (choice === 'cancel' || choice === 'wait') return null
        // unlock：解除锁定后继续
      }

      // 上下文路由：活动文件转项目相对路径，选中原文透传
      const editor = useEditorStore()
      let activeFile: string | null = null
      const absActive = editor.activePath
      if (absActive && project && absActive.startsWith(project.path)) {
        activeFile = absActive
          .slice(project.path.length)
          .replace(/^[\\/]+/, '')
          .replace(/\\/g, '/')
      }
      const request: AgentRunRequest = {
        message: enriched,
        projectId: project?.id ?? null,
        loader: (project?.loader as LoaderId | null) ?? this.targetCombo.loader,
        mcVersion: project?.mcVersion || this.targetCombo.mcVersion,
        tier: this.selectedTier,
        context: {
          sourceView: 'agent-assistant',
          activeFile,
          selection: editor.activeSelection?.text ?? null
        },
        images: hasImage ? images : undefined
      }

      this.stopBackgroundSync()
      this.resetRun()
      this.runId = null
      this.mutedRunId = null
      this.adoptedRunId = null
      // runId 先由首个事件填充；visible 立即置位让轨道马上出现
      this.visible = true
      this.running = true
      this.canceled = false

      const chatStore = useAiChatStore()
      chatStore.ensureSession()
      chatStore.entries.push({
        id: entryId(),
        role: 'user',
        content: text,
        attachments: attachments.length > 0 ? attachments.map(toDisplayAttachment) : undefined
      })
      chatStore.syncActive(true)

      let result
      try {
        result = await window.api.agent.run(request)
      } catch (err) {
        this.running = false
        this.visible = false
        // 失败回填同样只在原项目会话内可见（等待期间切换项目则丢弃）
        if (this.sessionProjectId === (project?.id ?? null)) {
          chatStore.entries.push({
            id: entryId(),
            role: 'assistant',
            content: `Agent 运行未能启动：${(err as Error).message}`
          })
          chatStore.syncActive()
        }
        return null
      }

      // 运行期间 AI 助手已被重绑到别的项目（切换/关闭项目）：本次运行的收尾回填会串项目，丢弃
      if (this.sessionProjectId !== (project?.id ?? null)) return null

      this.runId = result.runId
      this.running = false
      this.canceled = result.canceled
      this.lastIntent = result.intent
      this.lastTier = result.tier
      this.tierMatched = result.tierMatched
      this.lastReply = result.reply
      this.lastOutcome = result.outcome ?? null

      // 普通问答：轨道收起，只保留对话气泡
      if (result.intent === 'chat' && !result.canceled) {
        this.visible = false
      }

      chatStore.entries.push({
        id: entryId(),
        role: 'assistant',
        content: result.reply,
        agentRunId: result.intent === 'chat' ? undefined : result.runId,
        agentIntent: result.intent === 'chat' ? undefined : result.intent
      })
      chatStore.syncActive()
      // 运行结束后刷新历史任务列表（本次 run 已落库）；后台刷新失败不影响主流程
      void this.loadHistory(true).catch(() => {})
      return null
    },

    async cancel(): Promise<void> {
      if (this.runId) await window.api.agent.cancel(this.runId)
    },

    // ---------------- 历史任务（任务图持久化） ----------------

    /** 拉取最近 20 条历史任务（按 AI 助手绑定的项目过滤，未绑定时回落到当前打开项目） */
    async loadHistory(force = false): Promise<void> {
      if (this.historyLoaded && !force) return
      const projectId =
        this.sessionProjectId ?? (useProjectStore().currentProject?.id ?? null)
      this.history = await window.api.agent.history({ projectId, limit: 20 })
      this.historyLoaded = true
    },

    /** 断点续跑：从历史断点恢复，以新 runId 跑剩余阶段（事件仍走 agent:event） */
    async resumeRun(historyRunId: string): Promise<string | null> {
      if (this.running) return '已有 Agent 任务在运行，请等待完成或取消后再试'
      const boundId = this.sessionProjectId
      this.ensureSubscription()
      this.stopBackgroundSync()
      this.resetRun()
      this.runId = null
      this.mutedRunId = null
      this.adoptedRunId = null
      this.visible = true
      this.running = true
      this.canceled = false

      const chatStore = useAiChatStore()
      chatStore.ensureSession()

      const res = await window.api.agent.resumeRun(historyRunId)
      if (!res.ok) {
        this.running = false
        this.visible = false
        chatStore.entries.push({
          id: entryId(),
          role: 'assistant',
          content: `续跑未能启动：${res.errorMessage}`
        })
        chatStore.syncActive()
        return res.errorMessage
      }

      const result = res.result
      // 续跑期间 AI 助手已被重绑到别的项目：丢弃收尾回填，避免串项目
      if (this.sessionProjectId !== boundId) return null
      this.runId = result.runId
      this.running = false
      this.canceled = result.canceled
      this.lastIntent = result.intent
      this.lastTier = result.tier
      this.tierMatched = result.tierMatched
      this.lastReply = result.reply
      this.lastOutcome = result.outcome ?? null
      if (result.intent === 'chat' && !result.canceled) this.visible = false

      chatStore.entries.push({
        id: entryId(),
        role: 'assistant',
        content: result.reply,
        agentRunId: result.intent === 'chat' ? undefined : result.runId,
        agentIntent: result.intent === 'chat' ? undefined : result.intent
      })
      chatStore.syncActive()
      // 续跑结束后刷新历史列表（新 run 记录 + 旧记录状态）
      await this.loadHistory(true)
      return null
    },

    /** 删除历史任务记录（连带事件流水），随后刷新列表 */
    async deleteRun(historyRunId: string): Promise<void> {
      await window.api.agent.deleteRun(historyRunId)
      await this.loadHistory(true)
    },

    /**
     * 单项断言复验后用更新后的契约 artifact 替换轨道内同 id 产物。
     * 仅对当前 run 有效（runArtifacts 只读当前 run，复跑入口也只挂在当前运行的气泡上）。
     */
    updateArtifact(runId: string, artifact: AgentArtifact): void {
      if (this.runId !== runId) return
      for (const s of this.stages) {
        const idx = s.artifacts.findIndex((a) => a.id === artifact.id)
        if (idx >= 0) {
          s.artifacts.splice(idx, 1, artifact)
          return
        }
      }
    },

    /**
     * 手动导出产物（导出已从流水线分离）：基于当前打开的项目导出 jar/zip，
     * 有 runId 时附带该运行的构建结论与文件清单作为决策上下文。
     * 结果经 AGENT_EVENT 推回轨道（handleEvent 按 id 去重更新 export 节点）。
     */
    async exportNow(): Promise<{ ok: boolean; message: string }> {
      if (this.running) return { ok: false, message: '任务运行中，请等待完成后再导出' }
      const project = useProjectStore().currentProject
      if (!project) return { ok: false, message: '请先打开一个项目再导出' }
      this.ensureSubscription()
      const stage = this.stages.find((s) => s.id === 'export')
      if (stage) {
        stage.phase = 'running'
        stage.action = '正在整理构建产物…'
        stage.expanded = true
      }
      const res = await window.api.agent.exportNow({
        runId: this.runId ?? undefined,
        project: {
          id: project.id,
          name: project.name,
          path: project.path,
          type: project.type,
          mcVersion: project.mcVersion,
          loader: project.loader,
          loaderVersion: project.loaderVersion
        }
      })
      if (!res.ok) {
        if (stage) {
          stage.phase = 'error'
          stage.action = `导出失败：${res.errorMessage}`
        }
        return { ok: false, message: res.errorMessage }
      }
      const artifact = res.artifact
      if (stage) {
        const idx = stage.artifacts.findIndex((a) => a.id === artifact.id)
        if (idx >= 0) stage.artifacts.splice(idx, 1, artifact)
        else stage.artifacts.push(artifact)
        stage.phase = artifact.export?.status === 'ok' ? 'done' : 'skipped'
        stage.action = artifact.export?.summary ?? stage.action
      }
      return { ok: true, message: artifact.export?.summary ?? '已导出' }
    },

    async pause(): Promise<void> {
      if (this.runId) await window.api.agent.pause(this.runId)
    },

    async resume(): Promise<void> {
      if (this.runId) await window.api.agent.resume(this.runId)
    },

    /** 锁定档位（持久化，TR-10.1） */
    async lock(tier: TierId, source = 'agent-track'): Promise<void> {
      const settings = useSettingsStore()
      await settings.patchSection('ai', {
        manualLock: { tier, source, lockedAt: new Date().toISOString() }
      })
    },

    /** 解除锁定 */
    async unlock(): Promise<void> {
      const settings = useSettingsStore()
      await settings.patchSection('ai', {
        manualLock: { tier: null, source: null, lockedAt: null }
      })
    },

    /**
     * 冲突弹窗（TR-10.2）：三个出口映射三选项。
     * confirm=unlock；cancel=cancel；close(X)=wait。
     */
    async promptLockConflict(requiredTier: TierId, lockedTier: TierId): Promise<'wait' | 'cancel' | 'unlock'> {
      try {
        await ElMessageBox.confirm(
          `自动流程需要「${requiredTier}」档，但当前已锁定在「${lockedTier}」档。` +
            '点右上角 × 或按 Esc = 暂停自动、等待你手动接管。',
          '档位锁定冲突',
          {
            confirmButtonText: '解除锁定并继续',
            cancelButtonText: '取消自动流程',
            distinguishCancelAndClose: true,
            type: 'warning'
          }
        )
        await this.unlock()
        return 'unlock'
      } catch (action) {
        return action === 'cancel' ? 'cancel' : 'wait'
      }
    },

    toggleStage(id: StageId): void {
      const stage = this.stages.find((s) => s.id === id)
      if (stage) stage.expanded = !stage.expanded
    }
  }
})

/** 阶段 id 全集（渲染层断言用，避免直接引 ALL_STAGE_IDS 未使用告警） */
export const ALL_AGENT_STAGE_IDS = ALL_STAGE_IDS
