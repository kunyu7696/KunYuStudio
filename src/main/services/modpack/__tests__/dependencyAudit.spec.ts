/**
 * dependencyAudit 单测（P3-1b）：jar 依赖解析与缺席/冲突判定。
 * 真实 tmpdir + zipEntries 自产合法 jar 夹具（与 modpackAssembler.spec 同款），
 * 不依赖 javac/jar，避免 JDK 缺失假绿。
 */
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { zipEntries } from '../../ai/zipUtil'
import { auditDependencies, buildDependencyGraph, extractJarDeps, normalizeModId } from '../dependencyAudit'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'kunyu-depaudit-'))
}

/** 造一个带指定元数据的合法 jar（store-only zip） */
function makeJar(absPath: string, entries: Array<{ name: string; data: string }>): void {
  mkdirSync(dirname(absPath), { recursive: true })
  zipEntries(entries.map((e) => ({ name: e.name, from: 'data' as const, data: e.data })), absPath)
}

function fabricJar(dir: string, fileName: string, modJson: Record<string, unknown>): void {
  makeJar(join(dir, fileName), [{ name: 'fabric.mod.json', data: JSON.stringify(modJson) }])
}

function forgeJar(dir: string, fileName: string, toml: string): void {
  makeJar(join(dir, fileName), [{ name: 'META-INF/mods.toml', data: toml }])
}

describe('normalizeModId', () => {
  it('小写 + 下划线收敛', () => {
    expect(normalizeModId('GeckoLib')).toBe('geckolib')
    expect(normalizeModId('  Sodium_Extra ')).toBe('sodium-extra')
  })
})

describe('extractJarDeps：fabric.mod.json', () => {
  it('depends→required / recommends+suggests→optional / breaks→incompatible；系统键跳过', () => {
    const dir = tmpDir()
    fabricJar(dir, 'sodium.jar', {
      id: 'sodium',
      depends: { minecraft: '>=1.20', fabricloader: '*', 'fabric-api': '*', 'some-lib': '>=1.0' },
      recommends: { 'iris_shaders': '*' },
      suggests: { reeses_sodium_options: '*' },
      breaks: { optifabric: '*' }
    })
    const d = extractJarDeps(join(dir, 'sodium.jar'), 'sodium.jar')
    expect(d.modId).toBe('sodium')
    expect(d.deps).toContainEqual({ target: 'some-lib', kind: 'required' })
    expect(d.deps).toContainEqual({ target: 'iris-shaders', kind: 'optional' })
    expect(d.deps).toContainEqual({ target: 'reeses-sodium-options', kind: 'optional' })
    expect(d.deps).toContainEqual({ target: 'optifabric', kind: 'incompatible' })
    // 系统键一律不参与
    expect(d.deps.find((x) => x.target === 'minecraft')).toBeUndefined()
    expect(d.deps.find((x) => x.target === 'fabricloader')).toBeUndefined()
    expect(d.deps.find((x) => x.target === 'fabric-api')).toBeUndefined()
  })

  it('fabric.mod.json 损坏 → modId=null（跳过不炸）', () => {
    const dir = tmpDir()
    fabricJar(dir, 'bad.jar', { name: 'no id field' })
    const d = extractJarDeps(join(dir, 'bad.jar'), 'bad.jar')
    expect(d.modId).toBeNull()
    expect(d.deps).toEqual([])
  })
})

describe('extractJarDeps：mods.toml', () => {
  it('modId 段内 type=optional / mandatory=false → optional；其余 required；incompatible 识别', () => {
    const dir = tmpDir()
    forgeJar(dir, 'epic.jar', `
modLoader="javafml"
loaderVersion="[47,)"
license="GPL-3.0"
[[mods]]
modId="epicfight"
version="1.0.0"
[[dependencies.epicfight]]
modId="forge"
mandatory=true
[[dependencies.epicfight]]
modId="playeranimator"
mandatory=true
[[dependencies.epicfight]]
modId="jei"
mandatory=false
[[dependencies.epicfight]]
modId="optifine"
type="incompatible"
`)
    const d = extractJarDeps(join(dir, 'epic.jar'), 'epic.jar')
    expect(d.modId).toBe('epicfight')
    expect(d.deps).toContainEqual({ target: 'playeranimator', kind: 'required' })
    expect(d.deps).toContainEqual({ target: 'jei', kind: 'optional' })
    expect(d.deps).toContainEqual({ target: 'optifine', kind: 'incompatible' })
    // forge 是系统键
    expect(d.deps.find((x) => x.target === 'forge')).toBeUndefined()
  })

  it('neoforge.mods.toml 优先于 mods.toml', () => {
    const dir = tmpDir()
    makeJar(join(dir, 'neo.jar'), [
      { name: 'META-INF/neoforge.mods.toml', data: '[[mods]]\nmodId="neomod"\n' },
      { name: 'META-INF/mods.toml', data: '[[mods]]\nmodId="should-not-win"\n' }
    ])
    const d = extractJarDeps(join(dir, 'neo.jar'), 'neo.jar')
    expect(d.modId).toBe('neomod')
  })
})

describe('auditDependencies', () => {
  it('缺必需前置 / 缺可选联动 / 冲突共存三档各归其位', () => {
    const dir = tmpDir()
    fabricJar(dir, 'main.jar', {
      id: 'mainmod',
      depends: { 'missing-lib': '*' },
      recommends: { 'missing-addon': '*' },
      breaks: { evilmod: '*' }
    })
    fabricJar(dir, 'evil.jar', { id: 'evilmod' })
    const decls = [
      extractJarDeps(join(dir, 'main.jar'), 'main.jar'),
      extractJarDeps(join(dir, 'evil.jar'), 'evil.jar')
    ]
    const r = auditDependencies(decls)
    expect(r.parsed).toBe(2)
    expect(r.missingRequired.some((m) => m.includes('missing-lib'))).toBe(true)
    expect(r.missingOptional.some((m) => m.includes('missing-addon'))).toBe(true)
    expect(r.conflicts.some((m) => m.includes('evilmod'))).toBe(true)
  })

  it('在场依赖不误报；可选目标在场也不报', () => {
    const dir = tmpDir()
    fabricJar(dir, 'a.jar', { id: 'amod', depends: { bmod: '*' }, recommends: { cmod: '*' } })
    fabricJar(dir, 'b.jar', { id: 'bmod' })
    fabricJar(dir, 'c.jar', { id: 'cmod' })
    const r = auditDependencies(['a.jar', 'b.jar', 'c.jar'].map((n) => extractJarDeps(join(dir, n), n)))
    expect(r.missingRequired).toEqual([])
    expect(r.missingOptional).toEqual([])
    expect(r.conflicts).toEqual([])
  })

  it('元数据损坏的 jar 计入 skipped 且不拖垮审计', () => {
    const dir = tmpDir()
    fabricJar(dir, 'good.jar', { id: 'goodmod', depends: { 'missing-x': '*' } })
    fabricJar(dir, 'bad.jar', { noId: true })
    const r = auditDependencies([
      extractJarDeps(join(dir, 'good.jar'), 'good.jar'),
      extractJarDeps(join(dir, 'bad.jar'), 'bad.jar')
    ])
    expect(r.parsed).toBe(1)
    expect(r.skipped).toEqual(['bad.jar'])
    expect(r.missingRequired.some((m) => m.includes('missing-x'))).toBe(true)
  })

  it('空输入：全空结果', () => {
    const r = auditDependencies([])
    expect(r.parsed).toBe(0)
    expect(r.skipped).toEqual([])
    expect(r.missingRequired).toEqual([])
    expect(r.missingOptional).toEqual([])
    expect(r.conflicts).toEqual([])
  })
})

describe('zip 夹具自检', () => {
  it('makeJar 产物带合法 PK 头', () => {
    const dir = tmpDir()
    fabricJar(dir, 'x.jar', { id: 'x' })
    const bytes = readFileSync(join(dir, 'x.jar'))
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    expect(bytes[2]).toBe(0x03)
    expect(bytes[3]).toBe(0x04)
  })
})

describe('buildDependencyGraph（P3-2 只读关系图）', () => {
  it('在场 required→satisfied 边；缺席 required/optional→missing 边 + 虚影节点', () => {
    const dir = tmpDir()
    fabricJar(dir, 'main.jar', {
      id: 'mainmod',
      depends: { libmod: '*', 'missing-lib': '*' },
      suggests: { 'missing-addon': '*' }
    })
    fabricJar(dir, 'lib.jar', { id: 'libmod' })
    const decls = ['main.jar', 'lib.jar'].map((n) => extractJarDeps(join(dir, n), n))
    const g = buildDependencyGraph(decls, new Map())

    // 节点：2 个在场 jar + 2 个虚影
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      'jar:lib.jar',
      'jar:main.jar',
      'mod:missing-addon',
      'mod:missing-lib'
    ])
    const ghost = g.nodes.find((n) => n.id === 'mod:missing-lib')
    expect(ghost?.ghost).toBe(true)
    expect(ghost?.platform).toBeNull()

    expect(g.edges).toContainEqual({
      from: 'jar:main.jar',
      to: 'jar:lib.jar',
      kind: 'required',
      state: 'satisfied'
    })
    expect(g.edges).toContainEqual({
      from: 'jar:main.jar',
      to: 'mod:missing-lib',
      kind: 'required',
      state: 'missing'
    })
    expect(g.edges).toContainEqual({
      from: 'jar:main.jar',
      to: 'mod:missing-addon',
      kind: 'optional',
      state: 'missing'
    })
    expect(g.edges).toHaveLength(3)
  })

  it('incompatible 在场→conflict 边；缺席→不成边', () => {
    const decls = [
      { fileName: 'a.jar', modId: 'amod', deps: [
        { target: 'evilmod', kind: 'incompatible' as const },
        { target: 'not-here', kind: 'incompatible' as const }
      ] },
      { fileName: 'b.jar', modId: 'evilmod', deps: [] }
    ]
    const g = buildDependencyGraph(decls, new Map())
    expect(g.edges).toEqual([
      { from: 'jar:a.jar', to: 'jar:b.jar', kind: 'incompatible', state: 'conflict' }
    ])
    expect(g.nodes.some((n) => n.id === 'mod:not-here')).toBe(false)
  })

  it('元数据缺失的 jar 是孤立节点（无边）；自我依赖跳过', () => {
    const decls = [
      { fileName: 'solo.jar', modId: null, deps: [] },
      { fileName: 'self.jar', modId: 'selfmod', deps: [{ target: 'selfmod', kind: 'required' as const }] }
    ]
    const g = buildDependencyGraph(decls, new Map())
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toEqual([])
    expect(g.nodes.find((n) => n.fileName === 'solo.jar')?.modId).toBeNull()
  })

  it('展示名与平台取自来源记录，无记录回退 fileName + local', () => {
    const decls = [{ fileName: 'sodium.jar', modId: 'sodium', deps: [] }]
    const src = {
      fileName: 'sodium.jar',
      platform: 'modrinth' as const,
      modId: 'AANobbMI',
      versionId: 'v1',
      slug: 'sodium',
      name: 'Sodium',
      versionNumber: '0.5.0',
      downloadUrl: 'https://example.com/x.jar',
      size: 1,
      installedAt: '2026-01-01T00:00:00Z'
    }
    const g = buildDependencyGraph(decls, new Map([[src.fileName, src]]))
    expect(g.nodes[0]?.name).toBe('Sodium')
    expect(g.nodes[0]?.platform).toBe('modrinth')

    const g2 = buildDependencyGraph(decls, new Map())
    expect(g2.nodes[0]?.name).toBe('sodium.jar')
    expect(g2.nodes[0]?.platform).toBe('local')
  })
})
