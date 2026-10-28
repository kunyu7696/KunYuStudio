/**
 * 单项断言复验：证据链可复现——
 * - file-exists / texture-ready / registry-entry：直接读盘重评（复用 contractEvaluator 纯函数）
 * - build-pass：重跑一次真实 Gradle clean build（单次、不进治愈循环），结论转 BuildConclusion 后评估
 * - runtime-world / runtime-inventory（P1）：重新探测观察通道，由代码读取运行中游戏后重评；
 *   离线如实标 unverified（不是「没问题」）
 * - user-confirmation（P1）：重新采集真机截图挂证据，置 awaiting-user 交人工确认；离线标 unverified
 * - gametest-runtime（P1）：可独立重跑 runGameTestServer，按报告重评（跑一次真实无头测试）
 *
 * 所有真机/构建副作用均可经 RecheckDeps 注入，便于单测模拟在线/离线/通过/失败。
 */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AcceptanceAssertion, BuildConclusion, GameTestReport } from '../../../shared/types/agent'
import type { GradleEvent, GradleRunInput } from '../../../shared/types/build'
import { executeGradleBuild } from '../gradleService'
import { runGameTestServer } from '../gameTestRunner'
import {
  fetchBlockAt,
  fetchInventory,
  fetchScreenshot,
  probeObserver,
  type ObserverEndpoint
} from '../observer/observerClient'
import {
  evaluateBuildPass,
  evaluateFileExists,
  evaluateGameTestRuntime,
  evaluateRegistryEntry,
  evaluateRuntimeInventory,
  evaluateRuntimeWorld,
  evaluateTextureReady,
  evaluateUserConfirmation
} from './contractEvaluator'
import { dataUrlToPngBuffer } from './pixelize'

export interface RecheckDeps {
  /** 当前打开项目根（无项目时静态断言标 unverified） */
  projectPath: string | null
  javaHome?: string
  /** 测试注入假 Gradle；缺省走真实 executeGradleBuild */
  runGradle?: (input: GradleRunInput, sink: (event: GradleEvent) => void) => string
  /** P1：观察通道探测（缺省 probeObserver）；单测注入模拟在线/离线 */
  probeObserver?: () => Promise<ObserverEndpoint | null>
  /** P1：真机读取（缺省走 observerClient）；单测注入 */
  fetchBlock?: (port: number, pos: { x: number; y: number; z: number }) => Promise<{ block: string }>
  fetchInventory?: (port: number) => Promise<{ slots: { id: string }[] }>
  fetchScreenshot?: (port: number, timeoutMs?: number) => Promise<{ dataUrl: string }>
  /** P1：GameTest 单项复跑（缺省 runGameTestServer）；单测注入 */
  runGameTest?: (input: { root: string; javaHome: string }) => Promise<GameTestReport>
  /** user-confirmation 截图落盘目录（缺省系统临时目录） */
  screenshotDir?: string
  /** 截图落盘（缺省 writeFileSync）；单测注入避免真写盘 */
  writeFile?: (path: string, data: Buffer) => void
}

/** 探测运行中游戏：已进入世界返回观察端口，否则 null（异常吞掉按离线处理）。 */
async function probeRuntimePort(deps: RecheckDeps): Promise<number | null> {
  try {
    const probe = deps.probeObserver ?? probeObserver
    const obs = await probe()
    return obs?.health.inGame ? obs.port : null
  } catch {
    return null
  }
}

/**
 * 复验单项断言，返回更新后的断言（status/actual/reason/evidence 全部重算）。
 */
export async function recheckAssertion(
  assertion: AcceptanceAssertion,
  deps: RecheckDeps
): Promise<AcceptanceAssertion> {
  const a: AcceptanceAssertion = { ...assertion, status: 'pending', reason: undefined }
  switch (a.kind) {
    case 'file-exists':
      return evaluateFileExists(deps.projectPath, a)
    case 'texture-ready':
      return evaluateTextureReady(deps.projectPath, a)
    case 'registry-entry':
      return evaluateRegistryEntry(deps.projectPath, a)
    case 'build-pass': {
      if (!deps.projectPath) {
        return { ...a, status: 'unverified', reason: '无打开项目' }
      }
      const build = await runSingleBuild(deps)
      return evaluateBuildPass(a, build)
    }
    case 'runtime-world': {
      const port = await probeRuntimePort(deps)
      let reading: { block: string } | null = null
      if (port !== null && a.x !== undefined && a.y !== undefined && a.z !== undefined) {
        try {
          const fetchBlock = deps.fetchBlock ?? fetchBlockAt
          reading = await fetchBlock(port, { x: a.x, y: a.y, z: a.z })
        } catch {
          reading = null
        }
      }
      return evaluateRuntimeWorld(a, reading)
    }
    case 'runtime-inventory': {
      const port = await probeRuntimePort(deps)
      let ids: string[] | null = null
      if (port !== null) {
        try {
          const fetchInv = deps.fetchInventory ?? fetchInventory
          const inv = await fetchInv(port)
          ids = inv.slots.map((s) => s.id)
        } catch {
          ids = null
        }
      }
      return evaluateRuntimeInventory(a, ids)
    }
    case 'user-confirmation': {
      const port = await probeRuntimePort(deps)
      let screenshotPath: string | null = null
      if (port !== null) {
        try {
          const shot = await (deps.fetchScreenshot ?? fetchScreenshot)(port, 8000)
          screenshotPath = join(deps.screenshotDir ?? tmpdir(), `kunyu-recheck-confirm-${Date.now()}.png`)
          ;(deps.writeFile ?? writeFileSync)(screenshotPath, dataUrlToPngBuffer(shot.dataUrl))
        } catch {
          screenshotPath = null
        }
      }
      return evaluateUserConfirmation(a, screenshotPath)
    }
    case 'gametest-runtime': {
      if (!deps.projectPath) {
        return { ...a, status: 'unverified', reason: '无打开项目' }
      }
      const runGameTest =
        deps.runGameTest ??
        ((input: { root: string; javaHome: string }) =>
          runGameTestServer({ root: input.root, javaHome: input.javaHome, timeoutMs: 120_000 }))
      const report = await runGameTest({ root: deps.projectPath, javaHome: deps.javaHome ?? '' })
      return evaluateGameTestRuntime(report, a)
    }
    default:
      return {
        ...assertion,
        reason: '该类型断言暂不支持单项复跑'
      }
  }
}

/** 跑一次真实 Gradle clean build 并等待结束（事件经 sink 桥装 Promise，orchestrator 同款模式）。 */
function runSingleBuild(deps: RecheckDeps): Promise<BuildConclusion> {
  const runGradle = deps.runGradle ?? executeGradleBuild
  const input: GradleRunInput = {
    root: deps.projectPath!,
    tasks: ['clean', 'build'],
    javaHome: deps.javaHome,
    timeoutMs: 30 * 60 * 1000
  }
  return new Promise((resolvePromise) => {
    // A-03：settle 守卫保证只 settle 一次；外层超时比 Gradle 侧 timeoutMs 多 90s
    // 宽限（daemon 收尾 / 事件投递延迟）。若 phase=done 事件因 daemon 崩溃、进程
    // 被杀或 runId 不匹配而永不到达，外层超时也能收口，避免 UI 永久停在"复验中"。
    let settled = false
    let watchdog: ReturnType<typeof setTimeout>
    const settle = (conclusion: BuildConclusion): void => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      resolvePromise(conclusion)
    }
    watchdog = setTimeout(() => {
      settle({
        status: 'skipped',
        rounds: 0,
        summary: '单项复验：等待 Gradle 结果超时（done 事件可能丢失），按环境问题处理。',
        matchedPatternIds: []
      })
    }, input.timeoutMs! + 90_000)
    let runId: string
    try {
      runId = runGradle(input, (event) => {
        if (event.type === 'phase' && event.phase === 'done' && event.runId === runId) {
          const exitCode = event.exitCode
          if (exitCode === 0 && !event.cancelled && !event.timedOut) {
            settle({
              status: 'pass',
              rounds: 1,
              summary: '单项复验：Gradle clean build 通过（exit 0）。',
              matchedPatternIds: [],
              exitCode: 0
            })
          } else if (event.cancelled || event.timedOut || exitCode === null) {
            settle({
              status: 'skipped',
              rounds: 0,
              summary: event.timedOut
                ? '单项复验：Gradle 构建超时，按环境问题处理。'
                : '单项复验：Gradle 构建被中断，按环境问题处理。',
              matchedPatternIds: []
            })
          } else {
            settle({
              status: 'fail',
              rounds: 1,
              summary: `单项复验：Gradle clean build 失败（exit ${exitCode}）。`,
              matchedPatternIds: [],
              exitCode
            })
          }
        }
      })
    } catch (err) {
      settle({
        status: 'skipped',
        rounds: 0,
        summary: `单项复验：Gradle 启动失败（环境问题）：${(err as Error).message}`,
        matchedPatternIds: []
      })
    }
  })
}
