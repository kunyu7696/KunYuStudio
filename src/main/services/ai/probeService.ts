import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type {
  ComboHealth,
  MonitorEvent,
  ProbePhase,
  ProbeStatus
} from '../../../shared/types/monitor'
import type { GradleEvent } from '../../../shared/types/build'
import type { ModLoader } from '../../../shared/types/project'
import {
  cancelGradle,
  executeGradleBuild,
  hasActiveRun
} from '../gradleService'
import { detectJdk, parseJavaMajor } from '../jdkService'
import { getSection } from '../settingsService'
import { getToolchain } from '../../templates/loaderVersionMatrix'
import {
  ACTIVE_PROBE_COMBOS,
  ensureProbeProject,
  isActiveProbeCombo
} from './buildProbe'
import type { ReferenceService } from './referencePackageService'

export type ProbeEventListener = (event: MonitorEvent, status: ProbeStatus) => void

/** 首次需下载 Gradle 发行包与依赖，给 30 分钟上限 */
const PROBE_TIMEOUT_MS = 30 * 60 * 1000
/** 参与错误模式匹配的日志窗口（保留尾部 256KB） */
const MATCH_LOG_WINDOW = 256 * 1024

const execFileAsync = promisify(execFile)

/** 实测工具链签名（verified 描述串）：版本取自统一版本矩阵，与探针工程实际用法一致 */
function toolchainSignature(loader: ModLoader, mcVersion: string, javaHome: string | undefined): string {
  const tc = getToolchain(loader, mcVersion)
  const jdkNote = `jdk ${tc.jdk}（编译宿主 ${javaHome ?? 'PATH 默认'}）`
  switch (tc.loader) {
    case 'fabric':
      return (
        `active toolchain: minimal fabric mod gradle build exit 0; ` +
        `loader ${tc.loaderVersion}, yarn ${tc.yarnVersion}, fabric-api ${tc.fabricVersion}, ` +
        `loom ${tc.loomVersion}, gradle ${tc.gradleVersion}, ${jdkNote}`
      )
    case 'forge':
      return (
        `active toolchain: minimal forge mod gradle build exit 0; ` +
        `forge ${tc.forgeVersion}, forgegradle ${tc.forgeGradleVersion}, gradle ${tc.gradleVersion}, ${jdkNote}`
      )
    case 'neoforge':
      return (
        `active toolchain: minimal neoforge mod gradle build exit 0; ` +
        `neoforge ${tc.neoForgeVersion}, moddev ${tc.modDevGradleVersion}, gradle ${tc.gradleVersion}, ${jdkNote}`
      )
  }
}

function javacPath(home: string): string {
  return join(home, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac')
}

async function javaMajorOf(home: string): Promise<number | null> {
  const java = join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (!existsSync(java)) return null
  try {
    const { stderr } = await execFileAsync(java, ['-version'], { timeout: 8000 })
    return parseJavaMajor(stderr)?.major ?? null
  } catch {
    return null
  }
}

/**
 * 按矩阵 jdk 要求选择探针编译宿主：
 * 1) userData/ai/jdks 便携 JDK 精确匹配（须含 javac）
 * 2) 系统已装 JDK 精确匹配（detectJdk 候选，排除纯 JRE）
 * 3) 全局设置兜底（版本不符会让构建真实失败并留痕）
 */
async function resolveProbeJavaHome(requiredJdk: number): Promise<string | undefined> {
  try {
    const portableBase = join(app.getPath('userData'), 'ai', 'jdks')
    if (existsSync(portableBase)) {
      for (const name of readdirSync(portableBase)) {
        const home = join(portableBase, name)
        if (!existsSync(javacPath(home))) continue
        if ((await javaMajorOf(home)) === requiredJdk) return home
      }
    }
  } catch {
    /* 便携目录不可读不致命 */
  }
  const detected = await detectJdk()
  const exact = detected.candidates.find(
    (c) => c.major === requiredJdk && Boolean(c.home) && existsSync(javacPath(c.home))
  )
  if (exact) return exact.home
  return getSection('java').globalJdkHome ?? undefined
}
export interface ProbeService {
  isProbing(): boolean
  getStatus(): ProbeStatus | null
  /** 非 active 组合立即返回 skipped 且不改任何状态 */
  runBuildProbe(comboId: string): Promise<ProbeStatus>
  cancelBuildProbe(): boolean
  setListener(listener: ProbeEventListener | null): void
}

interface InternalState {
  status: ProbeStatus
  runId: string | null
  seq: number
  log: string
  resolveDone: ((status: ProbeStatus) => void) | null
  /** 本次探针实际使用的编译宿主 JDK（verified 签名用） */
  javaHome?: string
}

export function createProbeService(deps: {
  reference: ReferenceService
  now?: () => Date
}): ProbeService {
  const now = deps.now ?? (() => new Date())
  let listener: ProbeEventListener | null = null
  let state: InternalState | null = null

  function currentHealth(comboId: string): ComboHealth {
    return deps.reference.listMatrixCells().find((c) => c.id === comboId)?.health ?? 'unknown'
  }

  function makeStatus(
    comboId: string,
    phase: ProbePhase,
    progress: number,
    message: string,
    health: ComboHealth
  ): ProbeStatus {
    return { comboId, phase, progress, message, health, at: now().toISOString() }
  }

  function emit(event: MonitorEvent): void {
    if (listener && state) {
      try {
        listener(event, state.status)
      } catch {
        /* 监听器异常不影响探针 */
      }
    }
  }

  function transition(next: ProbeStatus, progress?: number): void {
    if (!state) return
    // 阶段进度单调递增（pass/fail/skipped 终态除外）
    const monotonic: ProbePhase[] = ['preparing', 'downloading', 'building', 'signing']
    const curIdx = monotonic.indexOf(state.status.phase)
    const nextIdx = monotonic.indexOf(next.phase)
    if (curIdx >= 0 && nextIdx >= 0 && nextIdx < curIdx) return
    state.status = next
    emit({
      type: 'probe-progress',
      seq: ++state.seq,
      comboId: next.comboId,
      progress: progress ?? next.progress,
      message: next.message,
      at: next.at
    })
  }

  function finish(status: ProbeStatus): ProbeStatus {
    if (!state) return status
    state.status = status
    emit({
      type: 'probe-finished',
      seq: ++state.seq,
      comboId: status.comboId,
      message: status.message,
      at: status.at
    })
    const resolveDone = state.resolveDone
    state.resolveDone = null
    state.runId = null
    resolveDone?.(status)
    return status
  }

  function handleGradleEvent(ev: GradleEvent): void {
    if (!state) return
    if (ev.type === 'output') {
      state.log += ev.text
      if (state.log.length > MATCH_LOG_WINDOW * 2) {
        state.log = state.log.slice(-MATCH_LOG_WINDOW)
      }

      // 阶段启发：下载 → 任务执行（building）→ remapJar/jar（封裝 signing）
      const runningHealth = currentHealth(state.status.comboId)
      if (/Download https?:|Downloading|Download /i.test(ev.text)) {
        transition(
          makeStatus(state.status.comboId, 'downloading', 30, '正在下载 Gradle 与依赖…', runningHealth)
        )
      }
      if (/(^|\n)> Task /.test(ev.text) || /:compileJava\b/.test(ev.text)) {
        transition(
          makeStatus(state.status.comboId, 'building', 70, '正在编译与执行 Gradle 任务…', runningHealth)
        )
      }
      if (/:remapJar\b|:jar\b/.test(ev.text)) {
        transition(
          makeStatus(state.status.comboId, 'signing', 92, '正在 remap/封裝产物…', runningHealth)
        )
      }
      return
    }

    if (ev.type === 'phase' && ev.phase === 'done') {
      const comboId = state.status.comboId
      if (ev.cancelled) {
        finish(
          makeStatus(
            comboId,
            'skipped',
            0,
            ev.timedOut ? '编译探针超时，已终止（未回写灯色）' : '编译探针已被取消（未回写灯色）',
            currentHealth(comboId)
          )
        )
        return
      }

      if (ev.exitCode === 0) {
        const at = now().toISOString()
        const combo = ACTIVE_PROBE_COMBOS[comboId]
        const verified = toolchainSignature(combo.loader, combo.mcVersion, state.javaHome)
        const templates = deps.reference
          .listTemplates(combo.loader, combo.mcVersion)
          .map((t) => ({ id: t.id, build: 'pass' as const, verified }))
        deps.reference.recordProbeResult({ comboId, health: 'green', verifiedAt: at, templates })
        finish(
          makeStatus(
            comboId,
            'pass',
            100,
            `真实编译通过（${templates.length} 个 active 模板标记 pass，用时 ${(ev.durationMs / 1000).toFixed(0)}s）`,
            'green'
          )
        )
        return
      }

      // 失败：错误模式匹配，回写红灯（不改动模板 build 状态）
      const probeCombo = ACTIVE_PROBE_COMBOS[comboId]
      const matched = deps.reference.matchErrorPatterns(
        probeCombo.loader,
        probeCombo.mcVersion,
        state.log
      )
      const at = now().toISOString()
      deps.reference.recordProbeResult({ comboId, health: 'red', verifiedAt: at })
      const ids = matched.map((m) => m.pattern.id)
      const patternText = ids.length > 0 ? `；命中错误模式：${ids.join(', ')}` : ''
      finish({
        comboId,
        phase: 'fail',
        progress: 100,
        message: `真实编译失败（exit ${ev.exitCode ?? 'null'}）${patternText}`,
        health: 'red',
        matchedPatternIds: ids.length > 0 ? ids : undefined,
        at
      })
    }
  }

  return {
    isProbing() {
      return state?.runId !== null && state?.runId !== undefined
    },
    getStatus() {
      return state?.status ?? null
    },
    setListener(l) {
      listener = l
    },
    cancelBuildProbe() {
      if (!state?.runId) return false
      return cancelGradle(state.runId)
    },
    async runBuildProbe(comboId) {
      // 储备/未知组合：立即 skipped，绝不执行构建、绝不改状态
      const cell = deps.reference.listMatrixCells().find((c) => c.id === comboId)
      if (!cell) {
        return makeStatus(comboId, 'skipped', 0, '未知组合，探针未执行', 'unknown')
      }
      if (!cell.active) {
        return makeStatus(
          comboId,
          'skipped',
          0,
          '储备组合（参考包 manifest 未激活该组合），未启用真实回测（状态保持不变）',
          cell.health
        )
      }
      if (!isActiveProbeCombo(comboId)) {
        return makeStatus(
          comboId,
          'skipped',
          0,
          '该组合不在探针版本矩阵（loaderVersionMatrix）中，未执行真实编译（状态保持不变）',
          cell.health
        )
      }
      if (state?.runId) {
        return makeStatus(comboId, 'skipped', 0, '已有探针任务运行中', currentHealth(comboId))
      }
      // 与用户项目构建互斥（共享 Gradle 执行通道，避免 daemon/锁竞争）
      if (hasActiveRun()) {
        return makeStatus(
          comboId,
          'skipped',
          0,
          '当前有 Gradle 任务运行中，探针暂缓执行（状态保持不变）',
          currentHealth(comboId)
        )
      }

      const initial = makeStatus(comboId, 'preparing', 5, '正在准备最小探针工程…', cell.health)
      state = { status: initial, runId: null, seq: 0, log: '', resolveDone: null }
      emit({ type: 'probe-progress', seq: ++state.seq, comboId, progress: 5, message: initial.message, at: initial.at })

      const result = new Promise<ProbeStatus>((resolve) => {
        if (state) state.resolveDone = resolve
      })

      let projectDir: string
      try {
        const info = ensureProbeProject(comboId)
        projectDir = info.dir
        transition(
          makeStatus(
            comboId,
            'preparing',
            10,
            info.created ? '探针工程已生成，即将启动 Gradle…' : '复用既有探针工程，即将启动 Gradle…',
            cell.health
          )
        )
      } catch (err) {
        // 工程准备失败属环境问题，不代表编译失败：不改灯色
        return finish(
          makeStatus(comboId, 'skipped', 0, `探针工程准备失败：${(err as Error).message}`, cell.health)
        )
      }

      const sink = (ev: GradleEvent): void => handleGradleEvent(ev)
      try {
        // 按矩阵 jdk 要求选编译宿主（jdk8/17/21 分组合精确匹配，便携 JDK 优先）；
        // FabricToolchain.hostJdk 优先（1.21.6+ loom 1.18.4 强制宿主 JVM 25，编译目标仍 21）
        const def = ACTIVE_PROBE_COMBOS[comboId]
        const probeTc = getToolchain(def.loader, def.mcVersion)
        const requiredJdk = 'hostJdk' in probeTc && probeTc.hostJdk ? probeTc.hostJdk : probeTc.jdk
        const javaHome = await resolveProbeJavaHome(requiredJdk)
        if (state) state.javaHome = javaHome
        transition(
          makeStatus(
            comboId,
            'preparing',
            12,
            `探针编译宿主（目标 JDK ${requiredJdk}）：${javaHome ?? 'PATH 默认'}`,
            cell.health
          )
        )
        const runId = executeGradleBuild(
          // --no-daemon：与矩阵门禁对齐——构建 JVM 随任务结束退出，
          // 避免常驻 GradleDaemon 锁定 loom-cache 映射 jar 污染后续构建/清理
          {
            root: projectDir,
            tasks: ['clean', 'build'],
            javaHome,
            timeoutMs: PROBE_TIMEOUT_MS,
            extraArgs: ['--no-daemon']
          },
          sink
        )
        if (state) state.runId = runId
      } catch (err) {
        // 启动失败（如互斥冲突）不代表编译失败：不改灯色
        return finish(
          makeStatus(comboId, 'skipped', 0, `无法启动 Gradle：${(err as Error).message}`, cell.health)
        )
      }

      return result
    }
  }
}

/* ------------------------------ Electron 单例 ------------------------------ */

let singleton: ProbeService | null = null

export function initProbeService(reference: ReferenceService): ProbeService {
  if (singleton) return singleton
  singleton = createProbeService({ reference })
  return singleton
}

export function getProbeService(): ProbeService | null {
  return singleton
}
