import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import { IpcChannels } from '../../../shared/types/ipc'
import type {
  BuildProblem,
  ConsoleLine,
  CrashSummary,
  GradleEvent,
  JdkDetectResult
} from '../../../shared/types/build'
import {
  MAX_CONSOLE_LINES,
  makeConsoleLine,
  parseChunk
} from '../utils/buildLogParser'
import { useUiStore } from './ui'
import { useEditorStore } from './editor'
import { useProjectStore } from './project'

export type PanelTab = 'terminal' | 'problems'
export type RunMode = 'build' | 'build-run' | 'run' | 'clean' | 'custom'

interface FlowState {
  mode: RunMode
  steps: string[]
  /** 当前进行到的步骤索引 */
  active: number
  failed: boolean
}

interface BuildState {
  panelVisible: boolean
  /** 折叠态：只保留标题栏（可再次展开），与完全关闭区分 */
  panelCollapsed: boolean
  panelHeight: number
  activeTab: PanelTab
  running: boolean
  runId: string | null
  currentTasks: string[]
  /** 运行阶段：构建中 / 游戏客户端运行中 */
  phase: 'idle' | 'building' | 'game'
  flow: FlowState | null
  lines: ConsoleLine[]
  problems: BuildProblem[]
  crash: CrashSummary | null
  gameStarted: boolean
  lastResult: { ok: boolean; cancelled: boolean; timedOut: boolean; durationMs: number; tasks: string[] } | null
  jdk: JdkDetectResult | null
  /** 终端自定义任务输入 */
  commandInput: string
  /** 终端自动滚动锁定标记 */
  autoscroll: boolean
}

let lineSeq = 0
const problemSeen = new Set<string>()

/** buildAndRun 期间暂存项目根，build 的 done 事件后续接 runClient */
let pendingBuildRunRoot: string | null = null
/** 最近一次运行的项目根（日志路径解析需要） */
let lastRunRoot: string | null = null

/** 构建类任务默认超时 20 分钟（首次运行需下载 Gradle 发行包与依赖） */
const BUILD_TIMEOUT_MS = 20 * 60 * 1000

const STEPS_BUILD_RUN = ['环境检测', 'Gradle 构建', '启动客户端', '进入游戏']
const STEPS_BUILD = ['环境检测', 'Gradle 构建']
const STEPS_RUN = ['环境检测', '启动客户端', '进入游戏']
const STEPS_CLEAN = ['环境检测', '清理构建产物']

function stepsForMode(mode: RunMode): string[] {
  switch (mode) {
    case 'build-run':
      return STEPS_BUILD_RUN
    case 'run':
      return STEPS_RUN
    case 'clean':
      return STEPS_CLEAN
    default:
      return STEPS_BUILD
  }
}

export const useBuildStore = defineStore('build', {
  state: (): BuildState => ({
    panelVisible: false,
    panelCollapsed: false,
    panelHeight: 160,
    activeTab: 'terminal',
    running: false,
    runId: null,
    currentTasks: [],
    phase: 'idle',
    flow: null,
    lines: [],
    problems: [],
    crash: null,
    gameStarted: false,
    lastResult: null,
    jdk: null,
    commandInput: '',
    autoscroll: true
  }),

  getters: {
    errorCount: (s) => s.problems.filter((p) => p.severity === 'error').length,
    warningCount: (s) => s.problems.filter((p) => p.severity === 'warning').length,
    isGameTask: (s) => s.currentTasks.includes('runClient'),
    statusText(s): string {
      if (s.running) {
        if (s.phase === 'game') return s.gameStarted ? '游戏运行中' : '正在启动游戏…'
        return `正在执行：${s.currentTasks.join(' ')}`
      }
      if (s.lastResult) {
        if (s.lastResult.cancelled) return '任务已取消'
        if (s.lastResult.timedOut) return '任务超时'
        return s.lastResult.ok ? '构建成功' : '构建失败'
      }
      return '就绪'
    }
  },

  actions: {
    /** 订阅主进程 Gradle 事件（全局一次） */
    initEvents(): void {
      window.api.on(IpcChannels.GRADLE_EVENT, (...args: unknown[]) => {
        this.handleEvent(args[0] as GradleEvent)
      })
    },

    openPanel(tab?: PanelTab): void {
      if (tab) this.activeTab = tab
      this.panelVisible = true
      this.panelCollapsed = false
    },

    togglePanel(): void {
      this.panelVisible = !this.panelVisible
      if (this.panelVisible) this.panelCollapsed = false
    },

    /** 折叠为标题栏 / 从标题栏展开（保持面板可见） */
    toggleCollapsed(): void {
      if (!this.panelVisible) {
        this.panelVisible = true
        this.panelCollapsed = false
        return
      }
      this.panelCollapsed = !this.panelCollapsed
    },

    setHeight(h: number): void {
      this.panelHeight = Math.min(420, Math.max(120, Math.round(h)))
    },

    clearConsole(): void {
      this.lines = []
      this.problems = []
      problemSeen.clear()
    },

    addLine(level: ConsoleLine['level'], text: string): void {
      this.lines.push(makeConsoleLine(++lineSeq, level, text))
      if (this.lines.length > MAX_CONSOLE_LINES) {
        this.lines.splice(0, this.lines.length - MAX_CONSOLE_LINES)
      }
    },

    /** 检测并缓存 JDK 检测结果（按当前项目的 loader/MC 版本推导版本要求；loader 缺失时按纯 MC 版本推导） */
    async detectJdk(configuredPath?: string | null): Promise<JdkDetectResult> {
      const cp = useProjectStore().currentProject
      // loader 为空（如导入项目未探测）也必须带上 mcVersion 走主进程纯 MC 推导，
      // 否则整体落 1.20.1 时代默认值，26.3 项目永远推不到 JDK 25
      const context = cp?.mcVersion
        ? { loader: cp.loader ?? null, mcVersion: cp.mcVersion }
        : undefined
      const result = await window.api.jdk.detect(configuredPath ?? null, context)
      this.jdk = result
      return result
    },

    /**
     * 发起 Gradle 任务。
     * @param root 项目根
     * @param tasks gradle 任务
     * @param mode 流程模式（步骤条展示）
     * @param timeoutMs 超时；默认构建类任务 20 分钟，runClient 无超时
     */
    async run(root: string, tasks: string[], mode: RunMode, timeoutMs?: number): Promise<void> {
      if (this.running) {
        ElMessage.warning('已有 Gradle 任务正在运行')
        return
      }

      // 环境检测（步骤 0）：优先使用项目配置的 JDK
      const configuredJdk = useProjectStore().currentProject?.jdkPath ?? null
      const jdk = await this.detectJdk(configuredJdk)
      if (!jdk.compatible) {
        this.openPanel('terminal')
        this.addLine('error', `[环境检测] ${jdk.message}`)
        this.flow = {
          mode,
          steps: stepsForMode(mode),
          active: 0,
          failed: true
        }
        this.lastResult = { ok: false, cancelled: false, timedOut: false, durationMs: 0, tasks }
        ElMessage.error(`未找到兼容的 JDK ${jdk.requirements.requiredMajor}，无法构建`)
        return
      }

      this.running = true
      this.currentTasks = tasks
      this.crash = null
      this.gameStarted = false
      this.lastResult = null
      this.problems = []
      this.autoscroll = true
      problemSeen.clear()
      this.phase = tasks.includes('runClient') ? 'game' : 'building'
      this.flow = {
        mode,
        steps: stepsForMode(mode),
        active: 0,
        failed: false
      }
      this.openPanel('terminal')
      this.addLine('dim', `$ ./gradlew ${tasks.join(' ')} --console=plain`)
      this.addLine('info', `[环境检测] ${jdk.message}`)
      lastRunRoot = root

      try {
        this.runId = await window.api.gradle.run({
          root,
          tasks,
          javaHome: jdk.jdk?.home,
          timeoutMs: timeoutMs ?? (tasks.includes('runClient') ? undefined : BUILD_TIMEOUT_MS)
        })
        // 任务已启动，进入对应执行步骤（环境检测之后）
        this.flow.active = 1
      } catch (err) {
        this.running = false
        this.phase = 'idle'
        if (this.flow) this.flow.failed = true
        this.addLine('error', `无法启动构建：${(err as Error).message}`)
        this.lastResult = {
          ok: false,
          cancelled: false,
          timedOut: false,
          durationMs: 0,
          tasks
        }
      }
    },

    build(root: string): Promise<void> {
      return this.run(root, ['build'], 'build')
    },

    clean(root: string): Promise<void> {
      return this.run(root, ['clean'], 'clean')
    },

    /** 仅启动开发客户端（不重新构建） */
    runClient(root: string): Promise<void> {
      return this.run(root, ['runClient'], 'run')
    },

    /** 自定义任务（终端输入框） */
    runCustom(root: string, raw: string): Promise<void> {
      const tasks = raw.trim().split(/\s+/).filter(Boolean)
      if (tasks.length === 0) return Promise.resolve()
      return this.run(root, tasks, 'custom')
    },

    /**
     * 一键构建并运行（T5.4）：build 成功后自动接 runClient；失败停在错误步骤。
     */
    async buildAndRun(root: string): Promise<void> {
      await this.run(root, ['build'], 'build-run')
      // build 阶段的 done 事件在 handleEvent 中触发 runClient（需要 root，存到 waitNext）
      pendingBuildRunRoot = root
    },

    cancel(): void {
      void window.api.gradle.cancel(this.runId ?? undefined)
      this.addLine('warning', '正在停止 Gradle 任务…')
    },

    /** 点击问题项：切到项目管理模块并在代码区打开对应文件 */
    async jumpProblem(p: BuildProblem): Promise<void> {
      if (!p.file || !p.line) {
        ElMessage.warning('该问题没有关联的代码位置')
        return
      }
      const editor = useEditorStore()
      const ui = useUiStore()
      ui.setActiveModule('project-manager')
      const err = await editor.openAtLocation(p.file, p.line, p.column ?? 1)
      if (err) ElMessage.error(`无法打开文件：${err}`)
    },

    /** 在编辑器中打开崩溃报告 */
    async openCrashReport(): Promise<void> {
      if (!this.crash) return
      const editor = useEditorStore()
      const ui = useUiStore()
      ui.setActiveModule('project-manager')
      const err = await editor.openAtLocation(this.crash.reportPath)
      if (err) ElMessage.error(`无法打开崩溃报告：${err}`)
    },

    handleEvent(evt: GradleEvent): void {
      switch (evt.type) {
        case 'output': {
          const root = lastRunRoot
          if (!root) return
          const { lines, problems } = parseChunk(evt.text, root, problemSeen)
          for (const ln of lines) this.addLine(ln.level, ln.text)
          if (problems.length > 0) {
            this.problems.push(...problems)
          }
          break
        }
        case 'game-started':
          this.gameStarted = true
          if (this.flow) this.flow.active = this.flow.steps.length - 1
          this.addLine('success', '[游戏] 开发客户端已启动，Minecraft 正在运行')
          ElMessage.success('游戏客户端已启动')
          break
        case 'crash':
          this.crash = evt.crash
          this.addLine('error', `[游戏崩溃] ${evt.crash.keyword}`)
          this.addLine('error', `  描述：${evt.crash.description}`)
          this.addLine('error', `  根因：${evt.crash.cause}`)
          ElMessage.error(`游戏崩溃：${evt.crash.keyword}`)
          break
        case 'phase':
          if (evt.phase === 'done') this.onRunDone(evt)
          break
      }
    },

    onRunDone(evt: {
      runId: string
      exitCode: number | null
      cancelled: boolean
      timedOut: boolean
      durationMs: number
    }): void {
      const tasks = this.currentTasks
      const wasBuildRun = this.flow?.mode === 'build-run'
      const wasBuild = tasks.includes('build') && !tasks.includes('runClient')
      const ok = evt.exitCode === 0 && !evt.cancelled && !evt.timedOut

      if (ok) {
        // active 允许超过最后一个索引（= steps.length），此时 el-steps 全部显示完成勾
        if (this.flow) this.flow.active = this.flow.active + 1
        this.addLine('success', `任务完成（${(evt.durationMs / 1000).toFixed(1)}s）`)
        if (this.errorCount > 0) this.addLine('warning', `共 ${this.problems.length} 条问题，请查看「问题」标签`)
      } else {
        if (this.flow) this.flow.failed = true
        const reason = evt.cancelled ? '任务已被用户取消' : evt.timedOut ? '任务超时' : `进程退出码 ${evt.exitCode}`
        this.addLine('error', `任务失败：${reason}`)
        if (this.errorCount > 0) {
          this.openPanel('problems')
        } else {
          this.openPanel('terminal')
        }
      }

      this.lastResult = {
        ok,
        cancelled: evt.cancelled,
        timedOut: evt.timedOut,
        durationMs: evt.durationMs,
        tasks
      }

      // T5.4：一键构建运行 —— 构建成功后自动启动客户端
      if (ok && wasBuildRun && wasBuild && pendingBuildRunRoot) {
        const root = pendingBuildRunRoot
        this.running = false
        this.phase = 'idle'
        pendingBuildRunRoot = null
        // 流程延续：复用同一条 flow，runClient 阶段 active=2
        this.addLine('dim', '构建成功，自动启动开发客户端…')
        void this.continueRunClient(root)
        return
      }

      this.running = false
      this.runId = null
      this.phase = 'idle'
      pendingBuildRunRoot = null
    },

    /** buildAndRun 的第二阶段（沿用 build-run 流程步骤条） */
    async continueRunClient(root: string): Promise<void> {
      const jdk = this.jdk
      this.running = true
      this.currentTasks = ['runClient']
      this.phase = 'game'
      if (this.flow) this.flow.active = 2
      this.addLine('dim', '$ ./gradlew runClient --console=plain')
      try {
        this.runId = await window.api.gradle.run({
          root,
          tasks: ['runClient'],
          javaHome: jdk?.jdk?.home ?? undefined
        })
      } catch (err) {
        this.running = false
        this.phase = 'idle'
        if (this.flow) this.flow.failed = true
        this.addLine('error', `无法启动游戏：${(err as Error).message}`)
      }
    }
  }
})
