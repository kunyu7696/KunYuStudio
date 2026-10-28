/**
 * 整合包启动测试：
 * 证明「目录断言」与「日志增量判定」各司其职，且**基线快照不误判**——
 * 上一次运行残留的 `Loading N mods` 与旧崩溃报告绝不能算成本次成功。
 */
import { describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import type { LaunchTestRunInput } from '../launchTest'
import { runLaunchTest, type LaunchTestDeps } from '../launchTest'
import type {
  ImportBatchInput,
  ImportBatchResult,
  LauncherInstance
} from '../../../../shared/types/launcher'
import { zipEntries } from '../../ai/zipUtil'

/** 造一个合法 jar（不依赖 javac，避免 JDK 缺失时静默跳过） */
function makeJar(absPath: string): void {
  mkdirSync(join(absPath, '..'), { recursive: true })
  zipEntries([{ name: 'fabric.mod.json', from: 'data', data: '{"id":"demo"}' }], absPath)
}

interface Harness {
  deps: LaunchTestDeps
  input: LaunchTestRunInput
  gameRoot: string
  modsDir: string
  logPath: string
  crashDir: string
  /** 每次轮询时执行（模拟游戏写日志/崩溃） */
  onPoll: (index: number) => void
}

function makeHarness(opts: {
  /** 已存在的旧日志内容（基线） */
  baselineLog?: string
  instance?: LauncherInstance | null
  importResult?: (input: ImportBatchInput) => ImportBatchResult
  launchOk?: boolean
  timeoutMs?: number
}): Harness {
  const root = mkdtempSync(join(tmpdir(), 'kunyu-launchtest-'))
  const projDir = join(root, 'proj')
  const gameRoot = join(root, 'instance')
  makeJar(join(projDir, 'run', 'mods', 'a.jar'))
  makeJar(join(projDir, 'run', 'mods', 'b.jar'))
  mkdirSync(join(gameRoot, 'logs'), { recursive: true })
  mkdirSync(join(gameRoot, 'crash-reports'), { recursive: true })
  const logPath = join(gameRoot, 'logs', 'latest.log')
  if (opts.baselineLog) writeFileSync(logPath, opts.baselineLog, 'utf8')

  const modsDir = join(gameRoot, 'mods')
  const crashDir = join(gameRoot, 'crash-reports')

  const instance: LauncherInstance | null =
    opts.instance === undefined
      ? {
          id: 'official:1.20.1',
          launcherId: 'official:1',
          name: '1.20.1',
          gamePath: gameRoot,
          mcVersion: '1.20.1',
          loader: 'fabric'
        }
      : opts.instance

  let clock = 0
  let polls = 0

  const harness: Harness = {
    gameRoot,
    modsDir,
    logPath,
    crashDir,
    onPoll: () => {},
    input: {
      projectPath: projDir,
      mcVersion: '1.20.1',
      loader: 'fabric',
      launcherId: 'official:1',
      instanceId: 'official:1.20.1',
      timeoutMs: opts.timeoutMs ?? 4_500
    },
    deps: {
      async resolveInstance() {
        return instance ? { kind: 'official', instance } : null
      },
      async importBatch(input): Promise<ImportBatchResult> {
        if (opts.importResult) return opts.importResult(input)
        mkdirSync(modsDir, { recursive: true })
        for (const src of input.artifactPaths) {
          const name = src.split(/[\\/]/).pop() ?? 'mod.jar'
          copyFileSync(src, join(modsDir, name))
        }
        return {
          ok: true,
          imported: input.artifactPaths.map((s) => s.split(/[\\/]/).pop() ?? ''),
          conflicts: [],
          failed: [],
          modsDir
        }
      },
      async launch() {
        return opts.launchOk ?? true
      },
      now: () => clock,
      async sleep(ms) {
        clock += ms
        harness.onPoll(polls++)
      }
    }
  }
  return harness
}

describe('runLaunchTest', () => {
  it('基线快照不误判：上次残留的 Loading N mods 不算本次成功', async () => {
    const h = makeHarness({
      baselineLog: '[10:00:00] [main/INFO]: Loading 5 mods with fabric-loader\n'
    })
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('timeout')
    expect(result.ok).toBe(false)
    // 目录断言仍然如实反映模组已就位
    expect(result.verifiedInInstance).toEqual(['a.jar', 'b.jar'])
    expect(result.missing).toEqual([])
  })

  it('日志增量出现 Loading N mods → mods-visible', async () => {
    const h = makeHarness({})
    h.onPoll = () => {
      appendFileSync(h.logPath, '[10:00:01] [main/INFO]: Loading 2 mods with fabric-loader\n')
    }
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('mods-visible')
    expect(result.ok).toBe(true)
    expect(result.summary).toContain('Loading 2 mods')
  })

  it('新增崩溃报告 → crashed', async () => {
    const h = makeHarness({})
    h.onPoll = (i) => {
      if (i === 0) writeFileSync(join(h.crashDir, 'crash-2026-09-21.txt'), 'crash')
    }
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('crashed')
    expect(result.ok).toBe(false)
  })

  it('只有启动标记 → launched-only（不报假成功）', async () => {
    const h = makeHarness({})
    h.onPoll = (i) => {
      if (i === 0) appendFileSync(h.logPath, '[10:00:01] [main/INFO]: Setting user: Player\n')
    }
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('launched-only')
    expect(result.ok).toBe(false)
    expect(result.summary).toContain('模组已就位 2/2')
    expect(result.logSignals?.some((l) => l.includes('Setting user'))).toBe(true)
  })

  it('导入失败 → failed 且带中文原因', async () => {
    const h = makeHarness({
      importResult: () => ({
        ok: false,
        imported: [],
        conflicts: [],
        failed: [{ fileName: 'a.jar', error: '磁盘被占用' }],
        modsDir: 'X'
      })
    })
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('failed')
    expect(result.error).toContain('1 个模组复制失败')
    expect(result.planned).toEqual(['a.jar', 'b.jar'])
  })

  it('实例不存在 → failed', async () => {
    const h = makeHarness({ instance: null })
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('failed')
    expect(result.error).toContain('实例不存在')
  })

  it('run/mods 为空 → failed 并提示先放入模组', async () => {
    const h = makeHarness({})
    const emptyProj = join(tmpdir(), `kunyu-empty-${Date.now()}`)
    mkdirSync(join(emptyProj, 'run', 'mods'), { recursive: true })
    const result = await runLaunchTest({ ...h.input, projectPath: emptyProj }, h.deps)
    expect(result.verdict).toBe('failed')
    expect(result.error).toContain('没有可用模组')
  })

  it('启动器缺失 → failed 但保留目录断言结果', async () => {
    const h = makeHarness({ launchOk: false })
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('failed')
    expect(result.verifiedInInstance).toEqual(['a.jar', 'b.jar'])
    expect(result.error).toContain('启动器进程缺失')
  })
})

/* ---------------------------------------------------------------------- */
/* P1③：场景断言链 + 真 join 证据（ready 行不足为证）                       */
/* ---------------------------------------------------------------------- */

describe('runLaunchTest 场景断言链（P1③）', () => {
  it('mods 就绪后捕获世界加入标记 → world-joined（最强判定，四项断言全 verified）', async () => {
    const h = makeHarness({})
    h.onPoll = (i) => {
      if (i === 0) appendFileSync(h.logPath, '[10:00:01] [main/INFO]: Loading 2 mods with fabric-loader\n')
      if (i === 1) appendFileSync(h.logPath, '[10:00:03] [Server thread/INFO]: Preparing spawn area: 0%\n')
    }
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('world-joined')
    expect(result.ok).toBe(true)
    expect(result.summary).toContain('真实进入世界')
    const byId = new Map(result.assertions?.map((a) => [a.id, a]))
    expect(byId.get('mods-in-instance')?.state).toBe('verified')
    expect(byId.get('game-boot')?.state).toBe('verified')
    expect(byId.get('mods-loaded')?.state).toBe('verified')
    expect(byId.get('world-join')?.state).toBe('verified')
    expect(byId.get('world-join')?.evidence).toContain('Preparing spawn area')
  })

  it('无 mods 就绪行但有 join 标记（NeoForge 风格日志）→ world-joined，加载断言由 join 顶替', async () => {
    const h = makeHarness({})
    h.onPoll = (i) => {
      if (i === 0) appendFileSync(h.logPath, '[10:00:01] [Server thread/INFO]: Steve joined the game\n')
    }
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('world-joined')
    expect(result.ok).toBe(true)
    const byId = new Map(result.assertions?.map((a) => [a.id, a]))
    expect(byId.get('mods-loaded')?.state).toBe('verified')
    expect(byId.get('mods-loaded')?.evidence).toContain('顶替')
  })

  it('仅 mods 就绪行、无 join 标记 → mods-visible，world-join 如实 inconclusive（不计失败）', async () => {
    const h = makeHarness({})
    h.onPoll = () => {
      appendFileSync(h.logPath, '[10:00:01] [main/INFO]: Loading 2 mods with fabric-loader\n')
    }
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('mods-visible')
    expect(result.ok).toBe(true)
    const byId = new Map(result.assertions?.map((a) => [a.id, a]))
    expect(byId.get('mods-loaded')?.state).toBe('verified')
    expect(byId.get('world-join')?.state).toBe('inconclusive')
    expect(byId.get('world-join')?.evidence).toContain('非失败')
  })

  it('只有启动标记 → mods-loaded 断言 failed（就绪窗口内未读到加载记录）', async () => {
    const h = makeHarness({})
    h.onPoll = (i) => {
      if (i === 0) appendFileSync(h.logPath, '[10:00:01] [main/INFO]: Setting user: Player\n')
    }
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('launched-only')
    const byId = new Map(result.assertions?.map((a) => [a.id, a]))
    expect(byId.get('game-boot')?.state).toBe('verified')
    expect(byId.get('mods-loaded')?.state).toBe('failed')
    expect(byId.get('world-join')?.state).toBe('inconclusive')
  })

  it('超时：boot/mods-loaded 均 inconclusive（没跑起来不归罪内容）', async () => {
    const h = makeHarness({})
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('timeout')
    const byId = new Map(result.assertions?.map((a) => [a.id, a]))
    expect(byId.get('mods-in-instance')?.state).toBe('verified')
    expect(byId.get('game-boot')?.state).toBe('inconclusive')
    expect(byId.get('mods-loaded')?.state).toBe('inconclusive')
  })

  it('新增崩溃报告：game-boot failed', async () => {
    const h = makeHarness({})
    h.onPoll = (i) => {
      if (i === 0) writeFileSync(join(h.crashDir, 'crash-2026-09-21.txt'), 'crash')
    }
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('crashed')
    const byId = new Map(result.assertions?.map((a) => [a.id, a]))
    expect(byId.get('game-boot')?.state).toBe('failed')
  })

  it('基线残留的 join 标记不算本次真 join（基线快照同样覆盖 world-join）', async () => {
    const h = makeHarness({
      baselineLog: '[09:59:00] [Server thread/INFO]: Preparing spawn area: 100%\n'
    })
    const result = await runLaunchTest(h.input, h.deps)
    expect(result.verdict).toBe('timeout')
    const byId = new Map(result.assertions?.map((a) => [a.id, a]))
    expect(byId.get('world-join')?.state).toBe('inconclusive')
  })
})