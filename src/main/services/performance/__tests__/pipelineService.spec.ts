/**
 * TR-17.1：三模式集成——
 * - 半自动：analyzeModsDirectory 全量入榜，坏 jar 不阻断其余
 * - 人工：importSpark 文本归因合并
 * - 全自动（织星）：runFullAuto 静态 + JFR 动态采集归因
 * - 安装钩子：createPostInstallHook 计数 / 失败仅告警
 *
 * 使用真实 javac/jar 构建 jar，内存 SQLite 仓储。
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\kunyu-test' }
}))

vi.mock('../../settingsService', () => ({
  getSection: () => ({ globalJdkHome: 'C:\\Program Files\\Java\\jdk-17' })
}))

import { migrate } from '../../db'
import { createProfileRepository, type ProfileRepository } from '../profileRepository'
import {
  analyzeModsDirectory,
  createPostInstallHook,
  importSpark,
  runFullAuto,
  syncCollectionRules,
  type PipelineEvent
} from '../pipelineService'

const JDK = 'C:\\Program Files\\Java\\jdk-17'
const javac = join(JDK, 'bin', 'javac.exe')
const jarTool = join(JDK, 'bin', 'jar.exe')

let work: string
let modsDir: string
let repo: ProfileRepository
let pathA: string
let pathB: string

/** 用真实 javac/jar 构建含 fabric.mod.json 的模组 jar */
function buildRealJar(
  stage: string,
  modId: string,
  pkg: string,
  classes: Array<{ name: string; body: string }>,
  outFile: string
): void {
  mkdirSync(stage, { recursive: true })
  const pkgPath = pkg.replace(/\./g, '/')
  for (const c of classes) {
    const file = join(stage, pkgPath, `${c.name}.java`)
    mkdirSync(join(stage, pkgPath), { recursive: true })
    writeFileSync(file, `package ${pkg};\npublic class ${c.name} {\n${c.body}\n}\n`)
  }
  execFileSync(javac, ['-d', stage, ...classes.map((c) => join(stage, pkgPath, `${c.name}.java`))], {
    windowsHide: true
  })
  writeFileSync(
    join(stage, 'fabric.mod.json'),
    JSON.stringify({ id: modId, version: '1.0.0' })
  )
  execFileSync(jarTool, ['cf', outFile, '-C', stage, '.'], { windowsHide: true })
}

beforeEach(() => {
  if (!existsSync(javac) || !existsSync(jarTool)) return
  work = join(tmpdir(), `perf-pipe-${Date.now()}-${Math.floor(Math.random() * 1e6)}`)
  modsDir = join(work, 'proj', 'run', 'mods')
  mkdirSync(modsDir, { recursive: true })

  pathA = join(modsDir, 'mod-a-1.0.0.jar')
  pathB = join(modsDir, 'mod-b-1.0.0.jar')
  buildRealJar(
    join(work, 'stage-a'),
    'mod-a',
    'com.examplea.foo',
    [
      { name: 'FooA', body: 'public void tick() { }' },
      { name: 'HelperA', body: 'public int v() { return 1; }' }
    ],
    pathA
  )
  buildRealJar(
    join(work, 'stage-b'),
    'mod-b',
    'com.exampleb.bar',
    [
      { name: 'BazB', body: 'public void update() { }' },
      { name: 'HelperB', body: 'public int v() { return 2; }' }
    ],
    pathB
  )

  const db = new Database(':memory:')
  migrate(db)
  repo = createProfileRepository(db)
})

afterEach(() => {
  if (work) rmSync(work, { recursive: true, force: true })
})

const keyA = () => ({
  modId: 'mod-a',
  version: '1.0.0',
  loader: 'fabric',
  mcVersion: '1.20.1'
})

describe('半自动 analyzeModsDirectory', () => {
  it('全部 jar 入榜可查询', () => {
    if (!existsSync(javac)) return
    const r = analyzeModsDirectory(repo, {
      dir: modsDir,
      loader: 'fabric',
      mcVersion: '1.20.1'
    })
    expect(r.total).toBe(2)
    expect(r.succeeded).toBe(2)
    expect(repo.countProfiles()).toBe(2)
    expect(repo.getProfile(keyA())?.identity.modId).toBe('mod-a')
  })

  it('坏 jar 失败不阻断其余，不回滚已入榜画像', () => {
    if (!existsSync(javac)) return
    writeFileSync(join(modsDir, 'broken.jar'), 'not-a-jar')
    const r = analyzeModsDirectory(repo, {
      dir: modsDir,
      loader: 'fabric',
      mcVersion: '1.20.1'
    })
    expect(r.total).toBe(3)
    expect(r.succeeded).toBe(2)
    const broken = r.results.find((x) => !x.ok)
    expect(broken?.error).toBeTruthy()
    expect(repo.countProfiles()).toBe(2)
  })
})

describe('安装钩子 createPostInstallHook', () => {
  it('jar 被分析计数，非 jar 跳过', () => {
    if (!existsSync(javac)) return
    const hook = createPostInstallHook(repo)
    const r = hook([pathA, pathB, join(modsDir, 'note.txt')], 'fabric', '1.20.1')
    expect(r.analyzed).toBe(2)
    expect(r.warnings).toEqual([])
    expect(repo.countProfiles()).toBe(2)
  })

  it('分析失败仅告警不抛错', () => {
    if (!existsSync(javac)) return
    const hook = createPostInstallHook(repo)
    const r = hook([join(modsDir, 'missing.jar')], 'fabric', '1.20.1')
    expect(r.analyzed).toBe(0)
    expect(r.warnings).toHaveLength(1)
  })
})

const JFR_SAMPLE = `
jdk.ExecutionSample {
  stackTrace = [
    com.examplea.foo.FooA.tick(FooA.java:10)
    net.minecraft.server.MinecraftServer.tick(MinecraftServer.java:500)
  ]
}
jdk.ExecutionSample {
  stackTrace = [
    com.examplea.foo.FooA.tick(FooA.java:11)
    net.minecraft.server.MinecraftServer.tick(MinecraftServer.java:501)
  ]
}
jdk.ExecutionSample {
  stackTrace = [
    net.unknown.thing.X.run(X.java:1)
    java.lang.Thread.run(Thread.java:829)
  ]
}
`

describe('全自动 runFullAuto（静态 + JFR 动态）', () => {
  it('静态入榜 → JFR 归因合并，进度事件完整', () =>
    new Promise<void>((done) => {
      if (!existsSync(javac)) {
        done()
        return
      }
      const events: PipelineEvent[] = []
      runFullAuto(
        repo,
        {
          jarPaths: [pathA],
          loader: 'fabric',
          mcVersion: '1.20.1',
          collector: { kind: 'jfr', collect: async () => JFR_SAMPLE }
        },
        (e) => events.push(e)
      ).then((r) => {
        expect(r.static.succeeded).toBe(1)
        expect(r.dynamic.ok).toBe(true)
        expect(r.dynamic.modIds).toContain('mod-a')
        const profile = repo.getProfile(keyA())
        expect(profile?.dynamicMetrics?.source).toBe('jfr')
        expect(profile?.dynamicMetrics?.cpu.topMethods[0]?.className).toBe(
          'com.examplea.foo.FooA'
        )
        expect(profile?.dynamicMetrics?.cpu.averageCpuPercent).toBeCloseTo(66.7, 1)
        expect(events[events.length - 1]?.stage).toBe('done')
        done()
      })
    }))

  it('动态采集失败不影响静态画像', async () => {
    if (!existsSync(javac)) return
    const r = await runFullAuto(repo, {
      jarPaths: [pathA],
      loader: 'fabric',
      mcVersion: '1.20.1',
      collector: {
        kind: 'jfr',
        collect: async () => {
          throw new Error('game offline')
        }
      }
    })
    expect(r.dynamic.ok).toBe(false)
    expect(r.dynamic.error).toContain('offline')
    expect(repo.countProfiles()).toBe(1)
  })
})

describe('人工 importSpark', () => {
  it('文本 CPU 树归因合并到已入榜画像', () => {
    if (!existsSync(javac)) return
    analyzeModsDirectory(repo, { dir: modsDir, loader: 'fabric', mcVersion: '1.20.1' })
    const text = `
tick average 12.0ms
  100% com.examplea.foo.FooA.tick()
`
    const r = importSpark(repo, { text, loader: 'fabric', mcVersion: '1.20.1' })
    expect(r.ok).toBe(true)
    expect(r.profilesUpdated).toBe(1)
    const profile = repo.getProfile(keyA())
    expect(profile?.dynamicMetrics?.source).toBe('spark')
    expect(profile?.dynamicMetrics?.tick.averageTickMs).toBe(12)
  })

  it('报告文件不存在时失败回执不抛错', () => {
    if (!existsSync(javac)) return
    const r = importSpark(repo, { filePath: join(work, 'nope.txt') })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不存在')
  })
})

describe('集合级规则 syncCollectionRules（R11/R12）', () => {
  function buildConflictSet(): string {
    const dir = join(work, 'conflict-mods')
    mkdirSync(dir, { recursive: true })
    const jars: Array<[string, string, string]> = [
      ['sodium', 'com.demo.sodium', join(dir, 'sodium.jar')],
      ['optifine', 'com.demo.optifine', join(dir, 'optifine.jar')],
      ['jei', 'com.demo.jei', join(dir, 'jei.jar')],
      ['emi', 'com.demo.emi', join(dir, 'emi.jar')]
    ]
    for (const [modId, pkg, out] of jars) {
      buildRealJar(
        join(work, `stage-${modId}`),
        modId,
        pkg,
        [{ name: `${modId}Main`, body: 'public void boot() { }' }],
        out
      )
    }
    return dir
  }

  const keyOf = (modId: string) => ({
    modId,
    version: '1.0.0',
    loader: 'fabric',
    mcVersion: '1.20.1'
  })

  it('R11 冲突对（remove）与 R12 功能重复（disable）命中并扣分', () => {
    if (!existsSync(javac)) return
    const dir = buildConflictSet()
    analyzeModsDirectory(repo, { dir, loader: 'fabric', mcVersion: '1.20.1' })

    const sodium = repo.getProfile(keyOf('sodium'))
    const r11 = sodium?.advice.find((a) => a.ruleId === 'R11')
    expect(r11?.action).toBe('remove')
    expect(r11?.severity).toBe('critical')
    // sodium+optifine 同属「渲染管线重写」标签，R11(35)+R12(4)
    expect(sodium?.advice.some((a) => a.ruleId === 'R12')).toBe(true)
    expect(sodium?.score.scores.compatibility).toBe(61)
    expect(sodium?.staticFeatures.dependencies.conflicts).toHaveLength(1)

    const jei = repo.getProfile(keyOf('jei'))
    const r12 = jei?.advice.find((a) => a.ruleId === 'R12')
    expect(r12?.action).toBe('disable')
    expect(r12?.severity).toBe('low')
    expect(jei?.score.scores.compatibility).toBe(96)
  })

  it('冲突一方移除后重算，旧 R11/R12 建议不残留', () => {
    if (!existsSync(javac)) return
    const dir = buildConflictSet()
    analyzeModsDirectory(repo, { dir, loader: 'fabric', mcVersion: '1.20.1' })
    repo.deleteProfile(keyOf('optifine'))
    repo.deleteProfile(keyOf('emi'))

    const updated = syncCollectionRules(repo, { loader: 'fabric', mcVersion: '1.20.1' })
    expect(updated).toBe(2)

    const sodium = repo.getProfile(keyOf('sodium'))
    expect(sodium?.advice.some((a) => a.ruleId === 'R11')).toBe(false)
    expect(sodium?.score.scores.compatibility).toBe(100)
    expect(sodium?.staticFeatures.dependencies.conflicts).toEqual([])

    const jei = repo.getProfile(keyOf('jei'))
    expect(jei?.advice.some((a) => a.ruleId === 'R12')).toBe(false)
  })
})
