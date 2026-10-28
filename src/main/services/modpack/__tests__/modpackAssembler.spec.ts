/**
 * 整合包组装器测试（真实 tmpdir + 自产合法 zip 夹具）。
 * 不依赖 javac/jar：用 zipEntries 生成带 PK 头的合法 zip 作为模组 jar，
 * 避免「JDK 缺失即静默跳过」的假绿。
 *
 * 覆盖：空 run/mods 不出空包、缺 MC 版本拒绝、zip 条目白名单、
 * 改名映射字节相等、双清单 files[]、项目名非法字符、dist 自包含缺陷已修、
 * config 映射、EULA 排除。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ModSourceEntry } from '../../../../shared/types/modpack'
import { zipEntries } from '../../ai/zipUtil'
import { openZip } from '../../performance/jarReader'
import { sha1Of } from '../hashUtil'
import {
  assembleModpack,
  findLatestDistArtifacts,
  previewModpack,
  sanitizePackName,
  scanModCandidates,
  type ModpackMeta
} from '../modpackAssembler'
import { writeSources } from '../provenance'

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'kunyu-modpack-'))
}

/** 造一个合法的模组 jar（store-only zip，文件头 PK\x03\x04） */
function makeJar(absPath: string, marker: string): Buffer {
  mkdirSync(dirname(absPath), { recursive: true })
  const payload = JSON.stringify({ id: marker })
  zipEntries([{ name: 'fabric.mod.json', from: 'data', data: payload }], absPath)
  return readFileSync(absPath)
}

function source(fileName: string, partial: Partial<ModSourceEntry> = {}): ModSourceEntry {
  return {
    fileName,
    platform: 'modrinth',
    modId: 'AANobbMI',
    versionId: 'v1',
    slug: 'sodium',
    name: 'Sodium',
    versionNumber: '0.5.0',
    downloadUrl: 'https://cdn.example/sodium.jar',
    size: 0,
    installedAt: '2026-09-21T00:00:00.000Z',
    ...partial
  }
}

const META: ModpackMeta = { name: '红石包', mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.15.11' }

/** 项目内准备一个模组 jar，并写入来源记录（size 与真实文件一致） */
function seedMod(root: string, fileName: string, marker: string, partial: Partial<ModSourceEntry> = {}): Buffer {
  const abs = join(root, 'run', 'mods', fileName)
  const bytes = makeJar(abs, marker)
  const existing = [...readSourcesSafe(root).values()].filter((e) => e.fileName !== fileName)
  writeSources(root, [...existing, source(fileName, { size: bytes.length, ...partial })])
  return bytes
}

function readSourcesSafe(root: string): Map<string, ModSourceEntry> {
  const p = join(root, '.kunyu', 'modpack.json')
  if (!existsSync(p)) return new Map()
  const raw = JSON.parse(readFileSync(p, 'utf8')) as { entries: ModSourceEntry[] }
  return new Map(raw.entries.map((e) => [e.fileName, e]))
}

describe('组装前置校验', () => {
  it('run/mods 为空时拒绝组装且不产生空包', () => {
    const root = tmpProject()
    const r = assembleModpack(root, META)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('run/mods')
    expect(existsSync(join(root, 'dist'))).toBe(false)
  })

  it('缺少 MC 版本时拒绝组装（清单缺版本会装不上）', () => {
    const root = tmpProject()
    seedMod(root, 'a.jar', 'a')
    const r = assembleModpack(root, { ...META, mcVersion: '' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('Minecraft 版本')
  })

  it('扫描候选时排除非 jar 文件', () => {
    const root = tmpProject()
    seedMod(root, 'a.jar', 'a')
    writeFileSync(join(root, 'run', 'mods', 'notes.txt'), 'x')
    expect(scanModCandidates(root).map((c) => c.fileName)).toEqual(['a.jar'])
  })
})

describe('打包内容', () => {
  it('包内条目为双清单 + README + overrides/mods（改名映射）', () => {
    const root = tmpProject()
    seedMod(root, 'sodium.jar', 'sodium')
    const r = assembleModpack(root, META)
    expect(r.ok).toBe(true)
    // P-02：.mrpack 规范只允许 modrinth.index.json + overrides/，不含 CF manifest.json / README.md
    const mrPaths = openZip(r.zipPath!).entries().map((e) => e.path)
    expect(mrPaths).not.toContain('manifest.json')
    expect(mrPaths).not.toContain('README.md')
    expect(mrPaths).toContain('modrinth.index.json')
    expect(mrPaths).toContain('overrides/mods/sodium.jar')
    // P-02：CF zip 含 manifest.json + README.md，但不含 modrinth.index.json（对称裁剪）
    const cfPaths = openZip(r.cfZipPath!).entries().map((e) => e.path)
    expect(cfPaths).toContain('manifest.json')
    expect(cfPaths).not.toContain('modrinth.index.json')
    expect(cfPaths).toContain('README.md')
    expect(r.entryCount).toBe(mrPaths.length)
  })

  it('改名映射后字节与原 jar 完全一致', () => {
    const root = tmpProject()
    const bytes = seedMod(root, 'sodium.jar', 'sodium')
    const r = assembleModpack(root, META)
    const inside = openZip(r.zipPath!).read('overrides/mods/sodium.jar')
    expect(Buffer.compare(inside, bytes)).toBe(0)
  })

  it('双清单 files[] 分别为 CF 数值坐标与 MR 双哈希直链', () => {
    const root = tmpProject()
    seedMod(root, 'jei.jar', 'jei', { platform: 'curseforge', modId: '238222', versionId: '4591234' })
    const mrBytes = seedMod(root, 'sodium.jar', 'sodium')
    const r = assembleModpack(root, META)

    const cf = JSON.parse(openZip(r.cfZipPath!).read('manifest.json').toString('utf8')) as {
      files: Array<{ projectID: number; fileID: number; required: boolean }>
    }
    expect(cf.files).toEqual([{ projectID: 238222, fileID: 4591234, required: true }])

    const mr = JSON.parse(openZip(r.zipPath!).read('modrinth.index.json').toString('utf8')) as {
      files: Array<{ path: string; hashes: { sha1: string; sha512: string }; fileSize: number; downloads: string[] }>
      dependencies: Record<string, string>
    }
    expect(mr.files).toHaveLength(1)
    expect(mr.files[0]?.path).toBe('mods/sodium.jar')
    expect(mr.files[0]?.hashes.sha1).toBe(sha1Of(mrBytes))
    expect(mr.files[0]?.hashes.sha512).toHaveLength(128)
    expect(mr.files[0]?.downloads).toEqual(['https://cdn.example/sodium.jar'])
    expect(mr.dependencies['fabric-loader']).toBe('0.15.11')
    expect(mr.dependencies.minecraft).toBe('1.20.1')
  })

  it('项目根 config/ 映射为 overrides/config/', () => {
    const root = tmpProject()
    seedMod(root, 'a.jar', 'a')
    mkdirSync(join(root, 'config'), { recursive: true })
    writeFileSync(join(root, 'config', 'sodium-options.json'), '{"quality":true}')
    const r = assembleModpack(root, META)
    const paths = openZip(r.zipPath!).entries().map((e) => e.path)
    expect(paths).toContain('overrides/config/sodium-options.json')
  })

  it('源码/构建产物/Gradle 工程/运行目录一律不进包', () => {
    const root = tmpProject()
    seedMod(root, 'a.jar', 'a')
    for (const rel of ['src/main/java/A.java', 'build/libs/a.jar', '.gradle/x.bin', 'gradlew', 'run/config/x.txt', 'run/logs/latest.log']) {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), 'x')
    }
    const r = assembleModpack(root, META)
    const paths = openZip(r.zipPath!).entries().map((e) => e.path)
    expect(paths.some((p) => p.startsWith('src/'))).toBe(false)
    expect(paths.some((p) => p.startsWith('build/'))).toBe(false)
    expect(paths.some((p) => p.startsWith('.gradle/'))).toBe(false)
    expect(paths).not.toContain('gradlew')
    expect(paths).not.toContain('run/config/x.txt')
    expect(paths).not.toContain('run/logs/latest.log')
  })

  it('游戏本体 jar 被排除并在告警中说明 EULA 原因', () => {
    const root = tmpProject()
    seedMod(root, 'a.jar', 'a')
    makeJar(join(root, 'run', 'mods', 'server.jar'), 'server')
    const r = assembleModpack(root, META)
    expect(r.plan?.exclusions.map((e) => e.fileName)).toContain('server.jar')
    expect(r.plan?.warnings.some((w) => w.includes('EULA'))).toBe(true)
    expect(openZip(r.zipPath!).entries().map((e) => e.path)).not.toContain('overrides/mods/server.jar')
  })

  it('fabric environment=client 的 jar：MR 落 client-overrides/mods，CF 落 overrides/mods', () => {
    const root = tmpProject()
    const abs = join(root, 'run', 'mods', 'sodium.jar')
    mkdirSync(dirname(abs), { recursive: true })
    zipEntries(
      [{ name: 'fabric.mod.json', from: 'data', data: JSON.stringify({ id: 'sodium', environment: 'client' }) }],
      abs
    )
    const bytes = readFileSync(abs)
    writeSources(root, [source('sodium.jar', { size: bytes.length })])

    const r = assembleModpack(root, META)
    expect(r.ok).toBe(true)
    // MR zip：client-only 落 client-overrides/mods
    const mrPaths = openZip(r.zipPath!).entries().map((e) => e.path)
    expect(mrPaths).toContain('client-overrides/mods/sodium.jar')
    expect(mrPaths).not.toContain('overrides/mods/sodium.jar')
    // CF zip：所有模组统一 overrides/mods（CF 不认 client-overrides）
    const cfPaths = openZip(r.cfZipPath!).entries().map((e) => e.path)
    expect(cfPaths).toContain('overrides/mods/sodium.jar')
    expect(cfPaths).not.toContain('client-overrides/mods/sodium.jar')

    const mr = JSON.parse(openZip(r.zipPath!).read('modrinth.index.json').toString('utf8')) as {
      files: Array<{ path: string; env?: { client: string; server: string } }>
    }
    expect(mr.files[0]?.env).toEqual({ client: 'required', server: 'unsupported' })
  })

  it('来源记录的 Modrinth 项目侧别优先于 jar 内探测（权威信号）', () => {
    const root = tmpProject()
    // jar 内无 environment 信号，但来源记录标记 server unsupported
    seedMod(root, 'sodium.jar', 'sodium', { clientSide: 'required', serverSide: 'unsupported' })
    const r = assembleModpack(root, META)
    const mrPaths = openZip(r.zipPath!).entries().map((e) => e.path)
    expect(mrPaths).toContain('client-overrides/mods/sodium.jar')
    // CF zip 同样应有该模组在 overrides/mods
    const cfPaths = openZip(r.cfZipPath!).entries().map((e) => e.path)
    expect(cfPaths).toContain('overrides/mods/sodium.jar')
  })

  it('CF 清单 minecraft 段以项目元数据重写（骨架中的模板默认值不生效）', () => {
    const root = tmpProject()
    seedMod(root, 'jei.jar', 'jei', { platform: 'curseforge', modId: '238222', versionId: '4591234' })
    // 骨架里放一个错误的版本/加载器，模拟旧模板残留
    writeFileSync(
      join(root, 'manifest.json'),
      JSON.stringify({
        minecraft: { version: '1.19.2', modLoaders: [{ id: 'forge-43.0.0', primary: true }] },
        manifestType: 'minecraftModpack',
        manifestVersion: 1,
        name: '红石包',
        version: '1.0.0',
        author: '',
        files: [],
        overrides: 'overrides'
      })
    )
    const r = assembleModpack(root, META)
    const cf = JSON.parse(openZip(r.cfZipPath!).read('manifest.json').toString('utf8')) as {
      minecraft: { version: string; modLoaders: Array<{ id: string; primary: boolean }> }
    }
    expect(cf.minecraft.version).toBe('1.20.1')
    expect(cf.minecraft.modLoaders).toEqual([{ id: 'fabric-0.15.11', primary: true }])
  })
})

describe('产物落盘', () => {
  it('项目名含非法字符时 dist 文件名仍合法，且重复组装覆盖旧包（MR .mrpack + CF .zip）', () => {
    const root = tmpProject()
    seedMod(root, 'a.jar', 'a')
    const meta: ModpackMeta = { ...META, name: '红石:主题/包' }
    expect(sanitizePackName(meta.name)).toBe('红石_主题_包')

    const first = assembleModpack(root, meta)
    expect(first.ok).toBe(true)
    expect(first.zipPath).toBeDefined()
    expect(first.cfZipPath).toBeDefined()
    expect(first.zipPath).toMatch(/\.mrpack$/)
    expect(first.cfZipPath).toMatch(/-cf\.zip$/)
    const second = assembleModpack(root, meta)
    expect(second.zipPath).toBe(first.zipPath)
    expect(second.cfZipPath).toBe(first.cfZipPath)

    const paths = openZip(second.zipPath!).entries().map((e) => e.path)
    // 第二次打包不得把上一次的 zip 自包含进包（dist 已加入排除表）
    expect(paths.some((p) => p.startsWith('dist/'))).toBe(false)
    expect(paths.some((p) => p.endsWith('.zip'))).toBe(false)
  })

  it('干跑预览产出计划但不落盘', () => {
    const root = tmpProject()
    seedMod(root, 'a.jar', 'a')
    const r = previewModpack(root, META)
    expect(r.ok).toBe(true)
    expect(r.plan?.zipEntries).toContain('overrides/mods/a.jar')
    expect(r.plan?.jars[0]?.reason.length).toBeGreaterThan(0)
    expect(existsSync(join(root, 'dist'))).toBe(false)
  })
})

describe('findLatestDistArtifacts（P0-6：发布预检与上传对齐同一文件）', () => {
  it('组装后按平台分拣：.mrpack 归 MR，-cf.zip 归 CF', () => {
    const root = tmpProject()
    seedMod(root, 'a.jar', 'a')
    const r = assembleModpack(root, META)
    expect(r.ok).toBe(true)
    const artifacts = findLatestDistArtifacts(join(root, 'dist'))
    expect(artifacts.mrpackPath).toBe(r.zipPath)
    expect(artifacts.cfZipPath).toBe(r.cfZipPath)
    expect(artifacts.mrpackMtime).toBeGreaterThan(0)
    expect(artifacts.cfZipMtime).toBeGreaterThan(0)
  })

  it('dist 缺失/为空时返回空串字段，不抛错', () => {
    const root = tmpProject()
    const missing = findLatestDistArtifacts(join(root, 'dist'))
    expect(missing).toEqual({ mrpackPath: '', mrpackMtime: 0, cfZipPath: '', cfZipMtime: 0 })
    mkdirSync(join(root, 'dist'), { recursive: true })
    expect(findLatestDistArtifacts(join(root, 'dist')).mrpackPath).toBe('')
  })
})