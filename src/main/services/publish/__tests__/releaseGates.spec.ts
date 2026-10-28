/**
 * releaseGates 单测（P4 发布 preflight 质量门）。
 * 真实 tmpdir + zipEntries 自产合法 jar（与 dependencyAudit.spec 同款夹具）；
 * 组合健康度经 deps.getHealth 注桩，本模块零 electron 依赖、零 mock。
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { zipEntries } from '../../ai/zipUtil'
import type { ComboHealth } from '../../../../shared/types/monitor'
import type { ModSourceEntry } from '../../../../shared/types/modpack'
import { persistLaunchTestResult, readLaunchTestRecord } from '../../modpack/launchTest'
import { writeSources } from '../../modpack/provenance'
import { runReleaseQualityGates } from '../releaseGates'

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'kunyu-gates-'))
}

function makeJar(absPath: string, entries: Array<{ name: string; data: string }>): void {
  mkdirSync(dirname(absPath), { recursive: true })
  zipEntries(entries.map((e) => ({ name: e.name, from: 'data' as const, data: e.data })), absPath)
}

function fabricJar(root: string, fileName: string, modJson: Record<string, unknown>): void {
  makeJar(join(root, 'run', 'mods', fileName), [
    { name: 'fabric.mod.json', data: JSON.stringify(modJson) }
  ])
}

/** 本地（无平台坐标）来源记录：必随包 → 许可门管辖 */
function localSource(fileName: string, license?: string): ModSourceEntry {
  return {
    fileName,
    platform: 'local',
    modId: '',
    versionId: '',
    slug: '',
    name: fileName,
    versionNumber: '',
    downloadUrl: null,
    size: 1,
    installedAt: '',
    ...(license ? { license } : {})
  }
}

function healthStub(health: ComboHealth): (loader: string, mcVersion: string) => ComboHealth {
  return () => health
}

const META = { mcVersion: '1.20.1', loader: 'fabric' }

function gate(result: ReturnType<typeof runReleaseQualityGates>, id: string) {
  const c = result.checks.find((x) => x.id === id)
  if (!c) throw new Error(`缺少检查项 ${id}`)
  return c
}

describe('导出产物卫生门（P9）', () => {
  it('run/mods 含 kunyu-observer 观察组件 → 硬门拦截（ready=false）', () => {
    const root = tmpProject()
    fabricJar(root, 'kunyu-observer-1.0.0.jar', { id: 'kunyu-observer' })
    fabricJar(root, 'normal-mod.jar', { id: 'normal-mod' })
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    const c = gate(r, 'artifact-hygiene')
    expect(c.severity).toBe('block')
    expect(c.ok).toBe(false)
    expect(c.detail).toContain('kunyu-observer-1.0.0.jar')
    expect(c.detail).not.toContain('normal-mod.jar')
    expect(r.ready).toBe(false)
  })

  it('无观察组件 → 通过且 ready 不受本门影响', () => {
    const root = tmpProject()
    fabricJar(root, 'normal-mod.jar', { id: 'normal-mod' })
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    expect(gate(r, 'artifact-hygiene').ok).toBe(true)
    expect(r.ready).toBe(true)
  })
})

describe('许可合规门', () => {
  it('空项目：license/deps 全 ok；无启动记录 → launch-test 软告警不过；ready=true', () => {
    const r = runReleaseQualityGates(tmpProject(), META, { getHealth: healthStub('green') })
    expect(gate(r, 'license-restricted').ok).toBe(true)
    expect(gate(r, 'deps-required').ok).toBe(true)
    const lt = gate(r, 'launch-test')
    expect(lt.severity).toBe('warn')
    expect(lt.ok).toBe(false)
    expect(lt.detail).toContain('尚未做过启动测试')
    expect(r.ready).toBe(true)
  })
  it('restricted 许可随包 → 硬门拦截（ready=false）', () => {
    const root = tmpProject()
    fabricJar(root, 'arr-mod.jar', { id: 'arr-mod' })
    writeSources(root, [localSource('arr-mod.jar', 'ARR')])
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    const c = gate(r, 'license-restricted')
    expect(c.severity).toBe('block')
    expect(c.ok).toBe(false)
    expect(c.detail).toContain('arr-mod.jar')
    expect(r.ready).toBe(false)
  })

  it('copyleft 许可随包 → 软告警，不拦截', () => {
    const root = tmpProject()
    fabricJar(root, 'gpl-mod.jar', { id: 'gpl-mod' })
    writeSources(root, [localSource('gpl-mod.jar', 'GPL-3.0')])
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    const c = gate(r, 'license-copyleft')
    expect(c.severity).toBe('warn')
    expect(c.ok).toBe(false)
    expect(r.ready).toBe(true)
  })

  it('无许可数据随包 → unknown 软告警', () => {
    const root = tmpProject()
    fabricJar(root, 'cf-mod.jar', { id: 'cf-mod' })
    writeSources(root, [localSource('cf-mod.jar')])
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    const c = gate(r, 'license-unknown')
    expect(c.severity).toBe('warn')
    expect(c.ok).toBe(false)
    expect(c.detail).toContain('cf-mod.jar')
  })

  it('permissive 许可随包 → 三个许可项全 ok', () => {
    const root = tmpProject()
    fabricJar(root, 'mit-mod.jar', { id: 'mit-mod' })
    writeSources(root, [localSource('mit-mod.jar', 'MIT')])
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    expect(gate(r, 'license-restricted').ok).toBe(true)
    expect(gate(r, 'license-copyleft').ok).toBe(true)
    expect(gate(r, 'license-unknown').ok).toBe(true)
  })
})

describe('依赖审计门', () => {
  it('缺必需前置 → 硬门拦截', () => {
    const root = tmpProject()
    fabricJar(root, 'sodium.jar', { id: 'sodium', depends: { 'some-lib': '>=1.0' } })
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    const c = gate(r, 'deps-required')
    expect(c.severity).toBe('block')
    expect(c.ok).toBe(false)
    expect(c.detail).toContain('some-lib')
    expect(r.ready).toBe(false)
  })

  it('缺可选联动 → 软告警', () => {
    const root = tmpProject()
    fabricJar(root, 'sodium.jar', { id: 'sodium', recommends: { iris_shaders: '*' } })
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    const c = gate(r, 'deps-optional')
    expect(c.severity).toBe('warn')
    expect(c.ok).toBe(false)
    expect(r.ready).toBe(true)
  })

  it('声明冲突的模组共存 → 硬门拦截', () => {
    const root = tmpProject()
    fabricJar(root, 'a.jar', { id: 'mod-a', breaks: { 'mod-b': '*' } })
    fabricJar(root, 'b.jar', { id: 'mod-b' })
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    const c = gate(r, 'deps-conflicts')
    expect(c.severity).toBe('block')
    expect(c.ok).toBe(false)
    expect(r.ready).toBe(false)
  })

  it('必需前置在场 → 依赖项全 ok', () => {
    const root = tmpProject()
    fabricJar(root, 'sodium.jar', { id: 'sodium', depends: { 'some-lib': '*' } })
    fabricJar(root, 'lib.jar', { id: 'some-lib' })
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    expect(gate(r, 'deps-required').ok).toBe(true)
    expect(gate(r, 'deps-conflicts').ok).toBe(true)
  })
})

describe('运行验收门（启动测试落盘记录）', () => {
  function seedRecord(root: string, verdict: 'world-joined' | 'crashed' | 'timeout'): void {
    persistLaunchTestResult(root, {
      ok: verdict === 'world-joined',
      verdict,
      summary: `测试摘要 ${verdict}`
    })
  }

  it('crashed → 硬门拦截', () => {
    const root = tmpProject()
    seedRecord(root, 'crashed')
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    const c = gate(r, 'launch-test')
    expect(c.severity).toBe('block')
    expect(c.ok).toBe(false)
    expect(c.detail).toContain('crashed')
    expect(r.ready).toBe(false)
  })

  it('timeout → 软告警', () => {
    const root = tmpProject()
    seedRecord(root, 'timeout')
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    const c = gate(r, 'launch-test')
    expect(c.severity).toBe('warn')
    expect(c.ok).toBe(false)
    expect(r.ready).toBe(true)
  })

  it('world-joined → ok 通过', () => {
    const root = tmpProject()
    seedRecord(root, 'world-joined')
    const r = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    expect(gate(r, 'launch-test').ok).toBe(true)
  })

  it('persist/read 往返；坏 JSON → null', () => {
    const root = tmpProject()
    expect(readLaunchTestRecord(root)).toBeNull()
    seedRecord(root, 'world-joined')
    const rec = readLaunchTestRecord(root)
    expect(rec?.verdict).toBe('world-joined')
    expect(rec?.ok).toBe(true)
    expect(typeof rec?.at).toBe('number')
    // 损坏文件按未验证处理，不炸
    writeFileSync(join(root, '.kunyu', 'launch-test-last.json'), '{oops', 'utf-8')
    expect(readLaunchTestRecord(root)).toBeNull()
  })
})

describe('组合健康度门', () => {
  it('green → ok；unknown/red → 软告警不过', () => {
    const root = tmpProject()
    const green = runReleaseQualityGates(root, META, { getHealth: healthStub('green') })
    expect(gate(green, 'combo-health').ok).toBe(true)

    const unknown = runReleaseQualityGates(root, META, { getHealth: healthStub('unknown') })
    const cu = gate(unknown, 'combo-health')
    expect(cu.severity).toBe('warn')
    expect(cu.ok).toBe(false)
    expect(cu.detail).toContain('尚未完成真机验证')

    const red = runReleaseQualityGates(root, META, { getHealth: healthStub('red') })
    expect(gate(red, 'combo-health').ok).toBe(false)
    // warn 不影响 ready
    expect(unknown.ready).toBe(true)
    expect(red.ready).toBe(true)
  })

  it('getHealth 收到的 loader/mcVersion 与项目元数据一致', () => {
    const root = tmpProject()
    let seen: [string, string] | null = null
    runReleaseQualityGates(root, META, {
      getHealth: (loader, mc) => {
        seen = [loader, mc]
        return 'green'
      }
    })
    expect(seen).toEqual(['fabric', '1.20.1'])
  })
})
