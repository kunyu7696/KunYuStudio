/**
 * M10 游戏测试沙箱编排器。
 *
 * 六阶段全自动：build → launch(runClient) → wait-world → probes → collect → shutdown。
 * 依赖全部可注入（runGradle/cancelGradle/observer/fs 读取/时钟），node 单测用 fake 驱动；
 * 观察通道不可用时 wait-world 起标记 skipped，游戏进程仍被可靠关闭，报告给出引导。
 *
 * 游戏观察通道：kunyu-observer-agent（自研 JVM javaagent，HTTP 127.0.0.1:9876–9886），
 * 支持玩家状态 / 聚合快照 / 注册表计数 / 截图 / 优雅退出。
 *
 * 进世界为 attach 模式：agent 不提供反射建图能力，提示手动进入世界后轮询接管。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { cancelGradle, executeGradleBuild } from './gradleService'
import { diagnose, scanGameLog } from './crashAnalyzer'
import { dataUrlToPngBuffer } from './ai/pixelize'
import { detectJdk } from './jdkService'
import {
  fetchObserverSnapshot,
  fetchPlayerState,
  fetchRegistryCounts,
  fetchScreenshot,
  probeObserver,
  requestGameShutdown,
  type ObserverPlayerState,
  type ObserverRegistryCounts,
  type ObserverScreenshot,
  type ObserverSnapshot
} from './observer/observerClient'
import type { GradleEvent, GradleRunInput } from '../../shared/types/build'
import type {
  LogFinding,
  SandboxConfig,
  SandboxEvent,
  SandboxProbeResult,
  SandboxReport,
  SandboxStage,
  SandboxStageStatus
} from '../../shared/types/sandbox'

// --- 依赖注入 ----------------------------------------------------------------

export interface SandboxDeps {
  runGradle?: (input: GradleRunInput, sink: (event: GradleEvent) => void) => string
  cancelGradle?: (runId?: string) => boolean
  sleep?: (ms: number) => Promise<void>
  now?: () => Date
  idFactory?: () => string
  /** 读项目内相对路径文件（默认 fs，测试注入） */
  readProjectFile?: (root: string, relPath: string) => string | null
  /** 列 run/mods 下 jar 清单（默认 fs，测试注入） */
  listRunMods?: (root: string) => string[]
  /** 列 run/crash-reports 下报告文件名（默认 fs，测试注入） */
  listCrashReports?: (root: string) => string[]
  // --- kunyu-observer 观察通道（默认走 observerClient 真实 HTTP，测试注入 fake） ---
  /** 扫描 9876–9886 上的 observer 服务；命中返回端口，否则 null */
  observerScan?: () => Promise<number | null>
  /** 玩家状态（未进世界时对端返回 503，调用方据此轮询进世界） */
  observerPlayer?: (port: number) => Promise<ObserverPlayerState>
  /** 注册表条目计数 */
  observerRegistry?: (port: number) => Promise<ObserverRegistryCounts>
  /** 世界/实体/聊天/屏幕聚合快照 */
  observerSnapshot?: (port: number) => Promise<ObserverSnapshot>
  /** 截图（PNG data URL） */
  observerScreenshot?: (port: number) => Promise<ObserverScreenshot>
  /** 请求客户端优雅退出（未定位退出方法时对端返回 501，调用方退化为进程树终止） */
  observerShutdown?: (port: number) => Promise<{ ok: true; detail: string }>
}

type SandboxSink = (event: SandboxEvent) => void

interface RunState {
  canceled: boolean
  gradleRunId: string | null
}

const STAGE_ORDER: SandboxStage[] = ['build', 'launch', 'wait-world', 'probes', 'collect', 'shutdown']
type GradleDone = { exitCode: number | null; cancelled: boolean; timedOut: boolean }
const DEFAULT_LAUNCH_TIMEOUT_MS = 300_000
const DEFAULT_WAIT_WORLD_TIMEOUT_MS = 120_000
const WORLD_POLL_INTERVAL_MS = 3_000
const SHUTDOWN_WAIT_MS = 20_000
const MAX_LOG_BYTES = 2 * 1024 * 1024

export function createSandboxRunner(deps: SandboxDeps = {}): {
  run: (config: SandboxConfig, sink: SandboxSink) => Promise<SandboxReport>
  cancel: (runId?: string) => void
} {
  const runGradle = deps.runGradle ?? executeGradleBuild
  const cancelGradleBuild = deps.cancelGradle ?? cancelGradle
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const now = deps.now ?? (() => new Date())
  const newId = deps.idFactory ?? (() => randomUUID())
  const observerScan =
    deps.observerScan ?? (async () => (await probeObserver({ timeoutMs: 800 }))?.port ?? null)
  const observerPlayer = deps.observerPlayer ?? ((port: number) => fetchPlayerState(port, 5_000))
  const observerRegistry = deps.observerRegistry ?? ((port: number) => fetchRegistryCounts(port, 10_000))
  const observerSnapshot =
    deps.observerSnapshot ?? ((port: number) => fetchObserverSnapshot(port, { timeoutMs: 8_000 }))
  const observerScreenshot = deps.observerScreenshot ?? ((port: number) => fetchScreenshot(port, 10_000))
  const observerShutdown = deps.observerShutdown ?? ((port: number) => requestGameShutdown(port, 3_000))
  const runs = new Map<string, RunState>()

  function defaultReadProjectFile(root: string, relPath: string): string | null {
    // 兼容崩溃事件携带的绝对路径
    const abs = isAbsolute(relPath) ? relPath : join(root, relPath)
    try {
      if (!existsSync(abs)) return null
      const stat = statSync(abs)
      const fd = readFileSync(abs)
      const start = stat.size > MAX_LOG_BYTES ? stat.size - MAX_LOG_BYTES : 0
      return fd.subarray(start).toString('utf8')
    } catch {
      return null
    }
  }
  const readProjectFile = deps.readProjectFile ?? defaultReadProjectFile

  function defaultListRunMods(root: string): string[] {
    const dir = join(root, 'run', 'mods')
    try {
      return readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar')).sort()
    } catch {
      return []
    }
  }
  const listRunMods = deps.listRunMods ?? defaultListRunMods

  function defaultListCrashReports(root: string): string[] {
    const dir = join(root, 'run', 'crash-reports')
    try {
      return readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()
    } catch {
      return []
    }
  }
  const listCrashReports = deps.listCrashReports ?? defaultListCrashReports

  function cancel(runId?: string): void {
    // 未指定 runId 时取消最近一次运行（单活场景）
    const targetId = runId ?? [...runs.keys()].pop()
    if (!targetId) return
    const state = runs.get(targetId)
    if (!state) return
    state.canceled = true
    if (state.gradleRunId) cancelGradleBuild(state.gradleRunId)
  }

  async function run(config: SandboxConfig, sink: SandboxSink): Promise<SandboxReport> {
    const runId = newId()
    const state: RunState = { canceled: false, gradleRunId: null }
    runs.set(runId, state)
    const startedAt = now().toISOString()
    const startMs = now().getTime()

    const report: SandboxReport = {
      runId,
      ok: false,
      startedAt,
      durationMs: 0,
      stages: {},
      probes: [],
      logFindings: [],
      diagnosis: null,
      screenshotPath: null,
      exitCode: null,
      modsManifest: [],
      cancelled: false
    }

    const stage = (s: SandboxStage, status: SandboxStageStatus, detail: string): void => {
      report.stages[s] = { status, detail }
      sink({ type: 'phase', runId, stage: s, status, action: detail })
    }

    /** 桥装一次 gradle 运行：done 事件转为 Promise */
    function launchGradle(
      input: GradleRunInput,
      onEvent?: (e: GradleEvent) => void
    ): { gradleRunId: string; done: Promise<GradleDone> } {
      let resolveDone!: (r: GradleDone) => void
      const done = new Promise<GradleDone>((res) => {
        resolveDone = res
      })
      const gradleRunId = runGradle(input, (event) => {
        onEvent?.(event)
        if (event.type === 'phase' && event.phase === 'done') {
          resolveDone({ exitCode: event.exitCode, cancelled: event.cancelled, timedOut: event.timedOut })
        }
      })
      state.gradleRunId = gradleRunId
      return { gradleRunId, done }
    }

    const crashReportPaths: string[] = []
    let gameStarted = false
    let enteredWorld = false
    let worldDetail = ''
    let gameExit: GradleDone | null = null
    let clientDone: Promise<GradleDone> | null = null
    // 游戏观察通道：kunyu-observer-agent（HTTP 127.0.0.1:9876–9886）
    let observerPort: number | null = null

    // ---------------- JDK 预检 ----------------
    // dev 环境下 Electron 主进程 PATH 可能含 Java 25 等不兼容版本，
    // 必须显式指定兼容 JDK（项目配置 > 全局设置 > 扫描）供 build/runClient 使用。
    const jdkResult = await detectJdk()
    const javaHome = jdkResult.jdk?.home ?? undefined
    if (!jdkResult.compatible) {
      stage('build', 'failed', `JDK 检测失败：${jdkResult.message}`)
      finalizeCollect()
      return finish(report, state, startMs, now, sink, false)
    }

    // ---------------- build ----------------
    // 先注册 gradle 运行再发阶段事件，保证 running 期间 cancel 能杀到进程；
    // 启动器同步抛错（如缺 wrapper）也要落成失败报告而非让整个 run reject
    let buildResult: GradleDone
    try {
      const buildRun = launchGradle({ root: config.projectPath, tasks: ['build'], javaHome })
      stage('build', 'running', '正在构建（gradlew build）…')
      buildResult = await buildRun.done
    } catch (err) {
      stage('build', 'failed', `无法启动构建：${errMsg(err)}`)
      finalizeCollect()
      return finish(report, state, startMs, now, sink, false)
    }
    if (state.canceled) {
      return finish(report, state, startMs, now, sink, true)
    }
    if (buildResult.exitCode !== 0) {
      stage('build', 'failed', `构建失败（退出码 ${buildResult.exitCode ?? '?'}）`)
      finalizeCollect()
      return finish(report, state, startMs, now, sink, false)
    }
    stage('build', 'done', '构建成功')

    // ---------------- launch ----------------
    const launchTimeoutMs = config.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS
    const launchDeadline = now().getTime() + launchTimeoutMs

    // 先注册 runClient（runId 可被 cancel 命中）再发 running 事件
    try {
      clientDone = new Promise((resolveClient) => {
        const { done } = launchGradle({ root: config.projectPath, tasks: ['runClient'], javaHome }, (event) => {
          if (event.type === 'game-started') gameStarted = true
          if (event.type === 'crash') crashReportPaths.push(event.crash.reportPath)
        })
        void done.then(resolveClient)
      })
    } catch (err) {
      stage('launch', 'failed', `无法启动客户端：${errMsg(err)}`)
      skipStagesAfter(report, 'launch', '启动失败，后续阶段跳过')
      finalizeCollect()
      return finish(report, state, startMs, now, sink, false)
    }
    stage('launch', 'running', '正在启动开发客户端（runClient）…')

    while (!gameStarted && now().getTime() < launchDeadline) {
      if (state.canceled) return finish(report, state, startMs, now, sink, true)
      // 崩溃或进程提前退出
      const settled = await Promise.race([
        clientDone.then((r) => r as typeof r | null),
        sleep(1000).then(() => null)
      ])
      if (settled) {
        gameExit = settled
        break
      }
    }

    if (gameExit) {
      stage('launch', 'failed', '客户端在启动阶段退出')
      skipStagesAfter(report, 'launch', '启动失败，后续阶段跳过')
      finalizeCollect()
      report.exitCode = gameExit.exitCode
      return finish(report, state, startMs, now, sink, false)
    }
    if (!gameStarted) {
      stage('launch', 'failed', '启动超时（未检测到游戏启动标记）')
      cancelGradleBuild(state.gradleRunId ?? undefined)
      skipStagesAfter(report, 'launch', '启动超时，后续阶段跳过')
      finalizeCollect()
      return finish(report, state, startMs, now, sink, false)
    }
    stage('launch', 'done', '客户端已启动')

    // ---------------- wait-world ----------------
    // 唯一观察通道：kunyu-observer-agent。扫描端口段，未命中则按离线处理。
    stage('wait-world', 'running', '正在扫描 kunyu-observer 探针（9876–9886）…')
    try {
      observerPort = await observerScan()
    } catch {
      observerPort = null
    }

    if (observerPort === null) {
      stage(
        'wait-world',
        'skipped',
        'kunyu-observer 离线：请确认客户端以 -javaagent 方式启动（KunYu 启动 runClient 时会自动装入 kunyu-observer-agent）'
      )
      stage('probes', 'skipped', '游戏观察通道离线，探针跳过')
      await shutdownGame()
      finalizeCollect()
      return finish(report, state, startMs, now, sink, false)
    }

    // attach 模式：agent 不提供反射建图能力，提示手动进入世界，下方轮询 /v1/player 自动接管。
    stage(
      'wait-world',
      'running',
      `已连接 kunyu-observer（127.0.0.1:${observerPort}），请在游戏中进入任意世界，沙箱将自动接管…`
    )

    const waitDeadline = now().getTime() + (config.waitWorldTimeoutMs ?? DEFAULT_WAIT_WORLD_TIMEOUT_MS)
    while (now().getTime() < waitDeadline) {
      if (state.canceled) return finish(report, state, startMs, now, sink, true)
      // 未进世界时 /v1/player 返回 503（ObserverError），进入后返回玩家状态
      try {
        const p = await observerPlayer(observerPort)
        enteredWorld = true
        worldDetail = `(${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}) ${p.gameMode} [kunyu-observer]`
        break
      } catch {
        /* 仍在主菜单/加载中，继续轮询 */
      }
      await sleep(WORLD_POLL_INTERVAL_MS)
    }

    if (!enteredWorld) {
      stage('wait-world', 'failed', '等待进入世界超时')
      stage('probes', 'skipped', '未进入世界，探针跳过')
      await shutdownGame()
      finalizeCollect()
      return finish(report, state, startMs, now, sink, false)
    }
    stage('wait-world', 'done', `已进入世界：${worldDetail}`)

    // ---------------- probes ----------------
    stage('probes', 'running', '执行游戏内探针…')
    const probes: SandboxProbeResult[] = []
    // kunyu-observer 原生探针：玩家状态 / 注册表计数 / 聚合快照
    try {
      const p = await observerPlayer(observerPort)
      probes.push({
        name: '世界与玩家状态（kunyu-observer）',
        ok: true,
        detail: `玩家 ${p.name} @ (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})，${p.gameMode}，生命 ${p.health.toFixed(1)}/20，饥饿 ${p.food}/20`
      })
    } catch (err) {
      probes.push({ name: '世界与玩家状态（kunyu-observer）', ok: false, detail: errMsg(err) })
    }
    try {
      const reg = await observerRegistry(observerPort)
      const named = reg.mapping === 'named'
      const head = ['BLOCK', 'ITEM', 'ENTITY_TYPE']
        .filter((k) => reg.counts[k] !== undefined)
        .map((k) => `${k} ${reg.counts[k]} 项`)
      probes.push({
        name: '注册表内容计数（kunyu-observer）',
        ok: true,
        detail:
          (head.length > 0 ? `${head.join('、')}，` : '') +
          `共 ${reg.totalRegistries} 个注册表` +
          (named ? '' : '（混淆映射，键名为字段原名）') +
          (reg.failedFields > 0 ? `，${reg.failedFields} 个字段读取失败` : '')
      })
    } catch (err) {
      probes.push({ name: '注册表内容计数（kunyu-observer）', ok: false, detail: errMsg(err) })
    }
    try {
      const snap = await observerSnapshot(observerPort)
      probes.push({
        name: '世界与实体快照（kunyu-observer）',
        ok: true,
        detail: `维度 ${snap.world.dimension}，时间 ${snap.world.timeOfDay}，${snap.world.raining ? '降雨' : '晴天'}，附近 ${snap.nearby.entities.length} 个实体，最近聊天 ${snap.chat.messages.length} 条`
      })
    } catch (err) {
      probes.push({ name: '世界与实体快照（kunyu-observer）', ok: false, detail: errMsg(err) })
    }
    for (const p of probes) sink({ type: 'probe', runId, probe: p })
    report.probes = probes
    if (state.canceled) {
      await shutdownGame()
      return finish(report, state, startMs, now, sink, false)
    }
    stage(
      'probes',
      probes.every((p) => p.ok) ? 'done' : 'failed',
      `${probes.filter((p) => p.ok).length}/${probes.length} 条探针通过（kunyu-observer HTTP）`
    )

    // ---------------- collect ----------------
    stage('collect', 'running', '收集截图、日志与崩溃报告…')
    // observer 返回 PNG data URL，落盘到系统临时目录供报告/UI 引用
    try {
      const shot = await observerScreenshot(observerPort)
      const shotPath = join(tmpdir(), `kunyu-observer-sandbox-${runId}.png`)
      writeFileSync(shotPath, dataUrlToPngBuffer(shot.dataUrl))
      report.screenshotPath = shotPath
    } catch {
      /* 截图失败不致命：日志与崩溃报告仍在 finalizeCollect 中收集 */
    }
    finalizeCollect()
    stage('collect', 'done', `日志发现 ${report.logFindings.length} 条问题`)

    // ---------------- shutdown ----------------
    await shutdownGame()

    const probesOk = report.probes.every((p) => p.ok)
    return finish(report, state, startMs, now, sink, probesOk && report.diagnosis === null)

    // --- 内部辅助（闭包） ---
    async function shutdownGame(): Promise<void> {
      stage('shutdown', 'running', '正在关闭游戏客户端…')
      // 先请求 kunyu-observer 优雅退出（等价 mc.stop）；对端 501/离线时退化为进程树终止
      let gracefulRequested = false
      if (observerPort !== null) {
        try {
          await observerShutdown(observerPort)
          gracefulRequested = true
        } catch {
          /* 对端不支持优雅退出或已离线，直接走进程树终止 */
        }
      }
      // 已请求优雅退出时等待游戏自行退出（时长由注入 sleep 决定，测试中可立即超时走强制取消）；
      // 未请求成功时不白等，直接进程树终止
      const exited: GradleDone | null = gracefulRequested
        ? await Promise.race([
            clientDone?.then((r) => r as GradleDone | null) ?? Promise.resolve(null),
            sleep(SHUTDOWN_WAIT_MS).then(() => null)
          ])
        : null
      if (exited) {
        gameExit = exited
      } else {
        cancelGradleBuild(state.gradleRunId ?? undefined)
        if (clientDone) gameExit = await clientDone.catch(() => null)
      }
      report.exitCode = gameExit?.exitCode ?? null
      stage('shutdown', 'done', gameExit ? `客户端已退出（码 ${gameExit.exitCode ?? '?'}）` : '客户端已强制结束')
    }

    function finalizeCollect(): void {
      const latestLog = readProjectFile(config.projectPath, join('run', 'logs', 'latest.log'))
      let reportText: string | null = null
      let reportPath: string | null = null
      if (crashReportPaths.length > 0) {
        reportPath = crashReportPaths[crashReportPaths.length - 1]!
        reportText = readProjectFile(config.projectPath, reportPath)
      } else {
        const newest = findNewestCrashReport(config.projectPath, readProjectFile, listCrashReports)
        if (newest) {
          reportPath = newest.relPath
          reportText = newest.text
        }
      }
      report.logFindings = latestLog ? scanLogSafe(latestLog) : []
      report.diagnosis = diagnose({ reportText, reportPath, logText: latestLog })
      report.modsManifest = listRunMods(config.projectPath)
    }
  }

  return { run, cancel }
}

// --- 模块级纯辅助 -------------------------------------------------------------

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function finish(
  report: SandboxReport,
  state: RunState,
  startMs: number,
  now: () => Date,
  sink: SandboxSink,
  ok: boolean
): SandboxReport {
  report.durationMs = now().getTime() - startMs
  report.cancelled = state.canceled
  report.ok = ok && !state.canceled
  // 未记录的阶段标记 skipped，保证六阶段齐全；同时补发 phase 事件，
  // 让仅订阅事件流的外部状态（如渲染层 el-steps）与最终报告一致
  for (const s of STAGE_ORDER) {
    if (!report.stages[s]) {
      report.stages[s] = { status: 'skipped', detail: '未执行' }
      sink({ type: 'phase', runId: report.runId, stage: s, status: 'skipped', action: '未执行' })
    }
  }
  sink({ type: 'report', runId: report.runId, report })
  return report
}

function skipStagesAfter(report: SandboxReport, after: SandboxStage, detail: string): void {
  const idx = STAGE_ORDER.indexOf(after)
  for (const s of STAGE_ORDER.slice(idx + 1)) {
    report.stages[s] = { status: 'skipped', detail }
  }
}

/** 取最新 crash-report（按文件名排序，MC 报告名为 crash-YYYY-MM-DD_HH.MM.SS） */
function findNewestCrashReport(
  root: string,
  read: (root: string, rel: string) => string | null,
  list: (root: string) => string[]
): { relPath: string; text: string } | null {
  const files = list(root)
  if (files.length === 0) return null
  const relPath = join('run', 'crash-reports', files[files.length - 1]!)
  const text = read(root, relPath)
  return text ? { relPath, text } : null
}

/** scanGameLog 容错包装 */
function scanLogSafe(text: string): LogFinding[] {
  try {
    return scanGameLog(text)
  } catch {
    return []
  }
}
