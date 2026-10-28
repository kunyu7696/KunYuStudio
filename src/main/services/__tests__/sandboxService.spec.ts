import { describe, expect, it, vi } from 'vitest'
import { existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

// 编排器默认依赖；本文件全部走注入，mock 掉以切断 gradleService → electron 链
vi.mock('../gradleService', () => ({
  executeGradleBuild: vi.fn(),
  cancelGradle: vi.fn()
}))
// jdkService 依赖 settingsService → electron-store，node 环境不可用
vi.mock('../jdkService', () => ({
  detectJdk: vi.fn(async () => ({
    jdk: { home: 'C:/Program Files/Java/jdk-17', javaPath: 'C:/Program Files/Java/jdk-17/bin/java.exe', version: '17.0.12', major: 17, source: 'configured' },
    requirements: { requiredMajor: 17, preferredMajor: 17, maxMajor: 23 },
    requiredMajor: 17,
    compatible: true,
    message: '已选用 JDK 17.0.12',
    candidates: [],
    javaHomeEnv: ''
  }))
}))

import { createSandboxRunner } from '../sandboxService'
import type { GradleEvent, GradleRunInput } from '../../../shared/types/build'
import type { SandboxConfig, SandboxEvent } from '../../../shared/types/sandbox'

// --- fake Gradle --------------------------------------------------------------

interface ClientCtl {
  sendStarted: () => void
  sendCrash: (reportPath: string) => void
  sendDone: (exitCode: number | null, cancelled?: boolean) => void
}

interface FakeGradle {
  runGradle: ReturnType<typeof vi.fn>
  cancelGradle: ReturnType<typeof vi.fn>
  cancelCalls: Array<string | undefined>
  client: ClientCtl | null
}

function makeGradle(
  buildExitCode: number,
  onClient?: (ctl: ClientCtl) => void
): FakeGradle {
  const fake: FakeGradle = { runGradle: vi.fn(), cancelGradle: vi.fn(), cancelCalls: [], client: null }
  let seq = 0
  const sinks = new Map<string, (e: GradleEvent) => void>()

  fake.runGradle.mockImplementation((input: GradleRunInput, sink: (e: GradleEvent) => void) => {
    const rid = `g${++seq}`
    sinks.set(rid, sink)
    if (input.tasks[0] === 'build') {
      queueMicrotask(() => {
        sink({ type: 'phase', runId: rid, phase: 'done', exitCode: buildExitCode, cancelled: false, timedOut: false, durationMs: 5 })
      })
    } else {
      const ctl: ClientCtl = {
        sendStarted: () => sink({ type: 'game-started', runId: rid }),
        sendCrash: (reportPath) =>
          sink({
            type: 'crash',
            runId: rid,
            crash: {
              reportPath,
              description: 'Ticking entity',
              headline: 'java.lang.OutOfMemoryError: Java heap space',
              cause: 'java.lang.OutOfMemoryError: Java heap space',
              keyword: '内存不足'
            }
          }),
        sendDone: (exitCode, cancelled = false) =>
          sink({ type: 'phase', runId: rid, phase: 'done', exitCode, cancelled, timedOut: false, durationMs: 5 })
      }
      fake.client = ctl
      onClient?.(ctl)
    }
    return rid
  })

  fake.cancelGradle.mockImplementation((runId?: string) => {
    fake.cancelCalls.push(runId)
    const target = runId ?? [...sinks.keys()].pop()
    if (target) {
      sinks.get(target)?.({
        type: 'phase',
        runId: target,
        phase: 'done',
        exitCode: null,
        cancelled: true,
        timedOut: false,
        durationMs: 0
      })
      sinks.delete(target)
    }
    return true
  })

  return fake
}

// --- fake kunyu-observer -------------------------------------------------------

interface ObserverFakes {
  observerScan: ReturnType<typeof vi.fn>
  observerPlayer: ReturnType<typeof vi.fn>
  observerRegistry: ReturnType<typeof vi.fn>
  observerSnapshot: ReturnType<typeof vi.fn>
  observerScreenshot: ReturnType<typeof vi.fn>
  observerShutdown: ReturnType<typeof vi.fn>
}

const PLAYER_IN_WORLD = {
  name: 'Player86',
  uuid: 'abc',
  x: 12.3,
  y: 64.0,
  z: -5.7,
  yaw: 0,
  pitch: 0,
  health: 20,
  food: 18,
  onGround: true,
  selectedSlot: 0,
  gameMode: '生存模式'
}

function makeObserver(opts: { playerFailsBeforeEnter?: number; onShutdown?: () => void } = {}): ObserverFakes {
  let playerCalls = 0
  const fails = opts.playerFailsBeforeEnter ?? 0
  return {
    observerScan: vi.fn(async () => 9876),
    observerPlayer: vi.fn(async () => {
      playerCalls++
      if (playerCalls <= fails) throw new Error('observer /v1/player 503：玩家尚未进入世界')
      return PLAYER_IN_WORLD
    }),
    observerRegistry: vi.fn(async () => ({
      ok: true as const,
      holder: 'net.minecraft.registry.Registries',
      mapping: 'named' as const,
      totalRegistries: 42,
      failedFields: 0,
      counts: { BLOCK: 950, ITEM: 1234, ENTITY_TYPE: 130 }
    })),
    observerSnapshot: vi.fn(async () => ({
      now: 1,
      player: {} as never,
      world: { time: 1000, timeOfDay: 3000, dimension: 'minecraft:overworld', raining: false },
      nearby: {
        radius: 24,
        entities: [
          { type: 'cow', name: 'Cow', uuid: 'u1', x: 1, y: 64, z: 2, distance: 3 },
          { type: 'pig', name: 'Pig', uuid: 'u2', x: 2, y: 64, z: 3, distance: 5 }
        ]
      },
      chat: { messages: ['<Player86> hello'] },
      screen: { open: false },
      guard: { enabled: true, windowMs: 30000, maxEvents: 60, used: 0, remaining: 60, rejectedTotal: 0 }
    })),
    // 1x1 透明 PNG 的 data URL
    observerScreenshot: vi.fn(async () => ({
      mime: 'image/png' as const,
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      bytes: 95
    })),
    observerShutdown: vi.fn(async () => {
      opts.onShutdown?.()
      return { ok: true as const, detail: '已请求客户端优雅退出' }
    })
  }
}

// --- 公共工具 -----------------------------------------------------------------

function baseConfig(over: Partial<SandboxConfig> = {}): SandboxConfig {
  return { projectPath: 'C:/proj', ...over }
}

function makeClock(): { now: () => Date; sleep: ReturnType<typeof vi.fn>; t: () => number } {
  let time = 1_000_000
  return {
    now: () => new Date(time),
    sleep: vi.fn(async (ms: number) => {
      time += ms
    }),
    t: () => time
  }
}

function makeReader(files: Record<string, string>): (root: string, p: string) => string | null {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
  const table = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]))
  // Windows 盘符路径（C:/...）在 POSIX 上 isAbsolute 为 false，这里显式视为绝对路径，
  // 否则 join(root, 'C:/proj/...') 会拼出不存在的键导致用例在 linux/mac CI 上假失败
  const isWinAbs = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p)
  return (root: string, p: string) =>
    table.get(norm(isAbsolute(p) || isWinAbs(p) ? p : join(root, p))) ?? null
}

function collectEvents(): { events: SandboxEvent[]; push: (e: SandboxEvent) => void } {
  const events: SandboxEvent[] = []
  return { events, push: (e) => events.push(e) }
}

const OOM_CRASH = `---- Minecraft Crash Report ----
// Oops.

Time: 2026-09-16 10:00:00
Description: Ticking entity

java.lang.OutOfMemoryError: Java heap space
\tat net.minecraft.server.MinecraftServer.tick(MinecraftServer.java:100)
\tat net.minecraft.server.level.ServerLevel.tick(ServerLevel.java:200)
`

// --- 用例 ---------------------------------------------------------------------

describe('sandboxService', () => {
  it('场景1：全流程成功 —— 六阶段全 done，探针/截图/清单入报告，客户端被关闭', async () => {
    const gradle = makeGradle(0, (c) => queueMicrotask(() => c.sendStarted()))
    const observer = makeObserver()
    const clock = makeClock()
    const reader = makeReader({
      'C:/proj/run/logs/latest.log': 'Sound engine started\nOpenAL initialized\n'
    })
    const runner = createSandboxRunner({
      runGradle: gradle.runGradle,
      cancelGradle: gradle.cancelGradle,
      sleep: clock.sleep,
      now: clock.now,
      readProjectFile: reader,
      listRunMods: () => ['fabric-api.jar', 'sodium.jar'],
      listCrashReports: () => [],
      ...observer
    })
    const { events, push } = collectEvents()

    const report = await runner.run(baseConfig(), push)

    expect(report.ok).toBe(true)
    expect(report.cancelled).toBe(false)
    expect(report.stages.build?.status).toBe('done')
    expect(report.stages.launch?.status).toBe('done')
    expect(report.stages['wait-world']?.status).toBe('done')
    expect(report.stages['wait-world']?.detail).toContain('kunyu-observer')
    expect(report.stages.probes?.status).toBe('done')
    expect(report.stages.collect?.status).toBe('done')
    expect(report.stages.shutdown?.status).toBe('done')
    // 3 条原生探针：玩家状态 / 注册表计数 / 聚合快照
    expect(report.probes).toHaveLength(3)
    expect(report.probes.every((p) => p.ok)).toBe(true)
    expect(report.probes[1]?.detail).toContain('BLOCK 950 项')
    expect(report.screenshotPath).toBeTruthy()
    expect(report.screenshotPath?.startsWith(tmpdir())).toBe(true)
    expect(existsSync(report.screenshotPath!)).toBe(true)
    unlinkSync(report.screenshotPath!)
    expect(report.modsManifest).toEqual(['fabric-api.jar', 'sodium.jar'])
    expect(report.diagnosis).toBeNull()
    expect(report.exitCode).toBeNull()
    // build 1 次 + runClient 1 次；优雅退出等待超时后 shutdown 强杀 cancel 1 次
    expect(gradle.runGradle).toHaveBeenCalledTimes(2)
    expect(observer.observerShutdown).toHaveBeenCalledTimes(1)
    expect(gradle.cancelCalls).toHaveLength(1)
    // 事件流：阶段事件 + 每探针一个 probe 事件 + 最终 report
    expect(events.some((e) => e.type === 'report')).toBe(true)
    expect(events.filter((e) => e.type === 'probe')).toHaveLength(3)
  })

  it('场景2：build 失败立即短路，不启动客户端，后续阶段 skipped', async () => {
    const gradle = makeGradle(1)
    const clock = makeClock()
    const runner = createSandboxRunner({
      runGradle: gradle.runGradle,
      cancelGradle: gradle.cancelGradle,
      sleep: clock.sleep,
      now: clock.now,
      readProjectFile: makeReader({}),
      listRunMods: () => [],
      listCrashReports: () => []
    })

    const report = await runner.run(baseConfig(), vi.fn())

    expect(report.ok).toBe(false)
    expect(report.stages.build?.status).toBe('failed')
    expect(report.stages.launch?.status).toBe('skipped')
    expect(report.stages.shutdown?.status).toBe('skipped')
    expect(gradle.runGradle).toHaveBeenCalledTimes(1)
    expect(gradle.cancelGradle).not.toHaveBeenCalled()
  })

  it('场景3：kunyu-observer 离线 —— wait-world/probes 软跳过，游戏仍可靠关闭', async () => {
    const gradle = makeGradle(0, (c) => queueMicrotask(() => c.sendStarted()))
    const clock = makeClock()
    const runner = createSandboxRunner({
      runGradle: gradle.runGradle,
      cancelGradle: gradle.cancelGradle,
      sleep: clock.sleep,
      now: clock.now,
      readProjectFile: makeReader({}),
      listRunMods: () => [],
      listCrashReports: () => [],
      observerScan: async () => null
    })

    const report = await runner.run(baseConfig(), vi.fn())

    expect(report.ok).toBe(false)
    expect(report.stages.launch?.status).toBe('done')
    expect(report.stages['wait-world']?.status).toBe('skipped')
    expect(report.stages['wait-world']?.detail).toContain('kunyu-observer')
    expect(report.stages.probes?.status).toBe('skipped')
    expect(report.stages.shutdown?.status).toBe('done')
    expect(gradle.runGradle).toHaveBeenCalledTimes(2)
    expect(gradle.cancelCalls).toHaveLength(1)
  })

  it('场景4：attach 模式等待进入世界超时 —— wait-world failed、probes skipped', async () => {
    const gradle = makeGradle(0, (c) => queueMicrotask(() => c.sendStarted()))
    // 玩家探测始终 503（留在主菜单）
    const observer = makeObserver({ playerFailsBeforeEnter: Number.MAX_SAFE_INTEGER })
    const clock = makeClock()
    const runner = createSandboxRunner({
      runGradle: gradle.runGradle,
      cancelGradle: gradle.cancelGradle,
      sleep: clock.sleep,
      now: clock.now,
      readProjectFile: makeReader({}),
      listRunMods: () => [],
      listCrashReports: () => [],
      ...observer
    })

    const report = await runner.run(baseConfig({ waitWorldTimeoutMs: 6000 }), vi.fn())

    expect(report.ok).toBe(false)
    expect(report.stages['wait-world']?.status).toBe('failed')
    expect(report.stages.probes?.status).toBe('skipped')
    expect(report.stages.shutdown?.status).toBe('done')
    // 2 次世界轮询（0ms、3000ms）
    expect(observer.observerPlayer).toHaveBeenCalledTimes(2)
    expect(gradle.cancelCalls).toHaveLength(1)
  })

  it('场景5：启动阶段崩溃 —— crash 报告被读取并产出 OOM 诊断', async () => {
    const crashAbs = 'C:/proj/run/crash-reports/crash-2026-09-16_10.00.00-client.txt'
    const gradle = makeGradle(0, (c) =>
      queueMicrotask(() => {
        c.sendCrash(crashAbs)
        c.sendDone(255)
      })
    )
    const clock = makeClock()
    const runner = createSandboxRunner({
      runGradle: gradle.runGradle,
      cancelGradle: gradle.cancelGradle,
      sleep: clock.sleep,
      now: clock.now,
      readProjectFile: makeReader({ [crashAbs]: OOM_CRASH }),
      listRunMods: () => [],
      listCrashReports: () => ['crash-2026-09-16_10.00.00-client.txt']
    })

    const report = await runner.run(baseConfig(), vi.fn())

    expect(report.ok).toBe(false)
    expect(report.stages.launch?.status).toBe('failed')
    expect(report.stages['wait-world']?.status).toBe('skipped')
    expect(report.exitCode).toBe(255)
    expect(report.diagnosis).not.toBeNull()
    expect(report.diagnosis?.category).toBe('out-of-memory')
    expect(report.diagnosis?.reportPath).toBe(crashAbs)
    expect(gradle.runGradle).toHaveBeenCalledTimes(2)
  })

  it('场景6：build 阶段被 cancel —— 标记 cancelled 且不启动客户端', async () => {
    const gradle = makeGradle(0)
    const clock = makeClock()
    const runner = createSandboxRunner({
      runGradle: gradle.runGradle,
      cancelGradle: gradle.cancelGradle,
      sleep: clock.sleep,
      now: clock.now,
      readProjectFile: makeReader({}),
      listRunMods: () => [],
      listCrashReports: () => []
    })

    let runId = ''
    const reportPromise = runner.run(baseConfig(), (e) => {
      // build running 阶段事件到达即取消
      if (!runId && e.type === 'phase' && e.stage === 'build') {
        runId = e.runId
        runner.cancel(runId)
      }
    })
    const report = await reportPromise

    expect(report.cancelled).toBe(true)
    expect(report.ok).toBe(false)
    expect(gradle.runGradle).toHaveBeenCalledTimes(1)
    expect(gradle.cancelCalls).toHaveLength(1)
  })

  it('场景7：启动器同步抛错（如缺 gradlew）—— 落成 build failed 报告而非 reject', async () => {
    const runGradle = vi.fn(() => {
      throw new Error('项目中未找到 Gradle Wrapper（gradlew.bat），无法构建')
    })
    const cancelGradle = vi.fn(() => true)
    const clock = makeClock()
    const events: SandboxEvent[] = []
    const runner = createSandboxRunner({
      runGradle,
      cancelGradle,
      sleep: clock.sleep,
      now: clock.now,
      readProjectFile: makeReader({}),
      listRunMods: () => [],
      listCrashReports: () => []
    })

    const report = await runner.run(baseConfig(), (e) => events.push(e))

    expect(report.ok).toBe(false)
    expect(report.stages.build?.status).toBe('failed')
    expect(report.stages.build?.detail).toContain('gradlew.bat')
    expect(report.stages.launch?.status).toBe('skipped')
    expect(events.some((e) => e.type === 'report')).toBe(true)
    expect(runGradle).toHaveBeenCalledTimes(1)
  })

  it('场景8：优雅退出成功 —— observerShutdown 后客户端自行退出，不再进程树强杀', async () => {
    let clientCtl: ClientCtl | null = null
    const gradle = makeGradle(0, (c) => {
      clientCtl = c
      queueMicrotask(() => c.sendStarted())
    })
    // 对端接受优雅退出请求后，游戏进程自行退出（exit 0）；
    // 同步 sendDone，保证 clientDone 链在 race 中先于注入 sleep 解决
    const observer = makeObserver({
      onShutdown: () => clientCtl?.sendDone(0)
    })
    const clock = makeClock()
    const runner = createSandboxRunner({
      runGradle: gradle.runGradle,
      cancelGradle: gradle.cancelGradle,
      sleep: clock.sleep,
      now: clock.now,
      readProjectFile: makeReader({ 'C:/proj/run/logs/latest.log': 'Sound engine started\n' }),
      listRunMods: () => [],
      listCrashReports: () => [],
      ...observer
    })

    const report = await runner.run(baseConfig(), vi.fn())

    expect(report.ok).toBe(true)
    expect(observer.observerShutdown).toHaveBeenCalledTimes(1)
    // 优雅退出生效：无需进程树终止
    expect(gradle.cancelCalls).toHaveLength(0)
    expect(report.exitCode).toBe(0)
    expect(report.stages.shutdown?.status).toBe('done')
    expect(report.stages.shutdown?.detail).toContain('码 0')
  })
})
