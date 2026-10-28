/**
 * pack.toml 中间表示层测试。
 * 覆盖：build↔parse 回环、坏 TOML fail-fast、字段缺失告警、版本比对告警、
 * index.toml 快照内容、IR 覆写双清单、pack.toml/index.toml 不进 zip、自愈与预览只读。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { zipEntries } from '../../ai/zipUtil'
import { openZip } from '../../performance/jarReader'
import {
  assembleModpack,
  previewModpack,
  type ModpackMeta
} from '../modpackAssembler'
import {
  buildIndexToml,
  buildPackToml,
  packTomlVersionWarnings,
  parsePackToml
} from '../packTomlIo'

const META: ModpackMeta = { name: '红石包', mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.15.11' }

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'kunyu-packtoml-'))
}

/** 造一个合法的模组 jar（store-only zip，文件头 PK\x03\x04） */
function seedMod(root: string, fileName: string): void {
  const abs = join(root, 'run', 'mods', fileName)
  mkdirSync(dirname(abs), { recursive: true })
  zipEntries(
    [{ name: 'fabric.mod.json', from: 'data', data: JSON.stringify({ id: fileName }) }],
    abs
  )
}

describe('pack.toml 构建↔解析回环', () => {
  it('fabric 元数据 round-trip：name/author/version/description/versions 全保留', () => {
    const text = buildPackToml(META, { author: 'kunyu', version: '2.1.0', description: '测试包' })
    const r = parsePackToml(text)
    expect(r.ok).toBe(true)
    expect(r.ir).toMatchObject({
      format: 'packwiz:1.1.0',
      name: '红石包',
      author: 'kunyu',
      version: '2.1.0',
      description: '测试包',
      minecraft: '1.20.1',
      loader: 'fabric',
      loaderVersion: '0.15.11'
    })
    expect(r.warnings).toEqual([])
  })

  it('forge 加载器使用 forge 键名', () => {
    const text = buildPackToml({ ...META, loader: 'forge', loaderVersion: '47.2.0' })
    expect(text).toContain('forge = "47.2.0"')
    const r = parsePackToml(text)
    expect(r.ir?.loader).toBe('forge')
    expect(r.ir?.loaderVersion).toBe('47.2.0')
  })

  it('loaderVersion 为 null 时省略加载器键，解析产出告警', () => {
    const text = buildPackToml({ ...META, loaderVersion: null })
    const r = parsePackToml(text)
    expect(r.ok).toBe(true)
    expect(r.ir?.loaderVersion).toBeNull()
    expect(r.warnings.some((w) => w.includes('加载器'))).toBe(true)
  })
})

describe('pack.toml 解析边界', () => {
  it('坏 TOML 返回 ok=false 且报错可读', () => {
    const r = parsePackToml('name = [未闭合')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('pack.toml 解析失败')
  })

  it('字段缺失补默认值并产出中文告警', () => {
    const r = parsePackToml('format = "kunyu-modpack/1"\n')
    expect(r.ok).toBe(true)
    expect(r.ir?.name).toBe('')
    expect(r.ir?.minecraft).toBeNull()
    expect(r.warnings.some((w) => w.includes('name'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('[versions]'))).toBe(true)
    // 旧版 format=kunyu-modpack/1 兼容读取，但 ir 归一到 packwiz 并告警
    expect(r.ir?.format).toBe('packwiz:1.1.0')
    expect(r.warnings.some((w) => w.includes('kunyu-modpack/1'))).toBe(true)
  })

  it('版本比对：一致无告警，minecraft/加载器版本不一致各出一条', () => {
    const consistent = parsePackToml(buildPackToml(META))
    expect(packTomlVersionWarnings(consistent.ir, META)).toEqual([])

    const edited = parsePackToml(
      buildPackToml(META).replace('minecraft = "1.20.1"', 'minecraft = "1.20.2"')
    )
    const minecraftWarnings = packTomlVersionWarnings(edited.ir, META)
    expect(minecraftWarnings).toHaveLength(1)
    expect(minecraftWarnings[0]).toContain('1.20.2')

    const loaderEdited = parsePackToml(
      buildPackToml(META).replace('fabric-loader = "0.15.11"', 'fabric-loader = "0.16.0"')
    )
    const loaderWarnings = packTomlVersionWarnings(loaderEdited.ir, META)
    expect(loaderWarnings).toHaveLength(1)
    expect(loaderWarnings[0]).toContain('0.16.0')

    expect(packTomlVersionWarnings(null, META)).toEqual([])
  })
})

describe('index.toml 快照', () => {
  it('hash-format = sha256，mods 条目携带来源 meta，overrides 条目照登', () => {
    const text = buildIndexToml([
      {
        file: 'run/mods/sodium.jar',
        hash: 'a'.repeat(64),
        size: 100,
        platform: 'modrinth',
        slug: 'sodium',
        versionId: 'v1'
      },
      { file: 'overrides/config/x.conf', hash: 'b'.repeat(64), size: 3 }
    ])
    expect(text).toContain('# 由坤舆在组装时自动生成')
    expect(text).toContain('hash-format = "sha256"')
    expect(text).toContain('file = "run/mods/sodium.jar"')
    expect(text).toContain('platform = "modrinth"')
    expect(text).toContain('version-id = "v1"')
    expect(text).toContain('file = "overrides/config/x.conf"')
    // 空可选字段不得出现空键
    expect(text).not.toContain('slug = ""')
  })
})

describe('组装器接入 IR', () => {
  it('IR 描述字段覆写双清单；pack.toml/index.toml 不进 zip', () => {
    const root = tmpProject()
    seedMod(root, 'sodium.jar')
    writeFileSync(
      join(root, 'pack.toml'),
      buildPackToml(META, { author: 'kunyu', version: '3.0.0', description: '我的整合包' })
    )
    const r = assembleModpack(root, META)
    expect(r.ok).toBe(true)

    const paths = openZip(r.zipPath!).entries().map((e) => e.path)
    expect(paths).not.toContain('pack.toml')
    expect(paths).not.toContain('index.toml')

    const cf = JSON.parse(openZip(r.cfZipPath!).read('manifest.json').toString('utf8')) as {
      name: string
      version: string
      author: string
    }
    expect(cf.name).toBe('红石包')
    expect(cf.version).toBe('3.0.0')
    expect(cf.author).toBe('kunyu')

    const mr = JSON.parse(openZip(r.zipPath!).read('modrinth.index.json').toString('utf8')) as {
      name: string
      versionId: string
      summary: string
      dependencies: Record<string, string>
    }
    expect(mr.name).toBe('红石包')
    expect(mr.versionId).toBe('3.0.0')
    expect(mr.summary).toBe('我的整合包')
    expect(mr.dependencies.minecraft).toBe('1.20.1')
  })

  it('组装成功后 index.toml 快照落项目根（含 sha256 与来源 meta）', () => {
    const root = tmpProject()
    seedMod(root, 'sodium.jar')
    const r = assembleModpack(root, META)
    expect(r.ok).toBe(true)
    expect(existsSync(join(root, 'index.toml'))).toBe(true)
    const indexToml = readFileSync(join(root, 'index.toml'), 'utf-8')
    expect(indexToml).toContain('file = "run/mods/sodium.jar"')
    expect(indexToml).toMatch(/hash = "[0-9a-f]{64}"/)
  })

  it('pack.toml 缺失时自愈生成（存量项目免迁移）', () => {
    const root = tmpProject()
    seedMod(root, 'a.jar')
    expect(existsSync(join(root, 'pack.toml'))).toBe(false)
    const r = assembleModpack(root, META)
    expect(r.ok).toBe(true)
    const text = readFileSync(join(root, 'pack.toml'), 'utf-8')
    expect(text).toContain('name = "红石包"')
    expect(text).toContain('fabric-loader = "0.15.11"')
  })

  it('坏 TOML 组装 fail-fast 且不落盘', () => {
    const root = tmpProject()
    seedMod(root, 'a.jar')
    writeFileSync(join(root, 'pack.toml'), 'name = [未闭合')
    const r = assembleModpack(root, META)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('pack.toml 解析失败')
    expect(existsSync(join(root, 'dist'))).toBe(false)
  })
})

describe('预览只读', () => {
  it('preview 不写 pack.toml，坏 TOML 时 fail-fast', () => {
    const root = tmpProject()
    seedMod(root, 'a.jar')
    const clean = previewModpack(root, META)
    expect(clean.ok).toBe(true)
    expect(existsSync(join(root, 'pack.toml'))).toBe(false)

    writeFileSync(join(root, 'pack.toml'), 'name = [未闭合')
    const broken = previewModpack(root, META)
    expect(broken.ok).toBe(false)
    expect(broken.error).toContain('pack.toml 解析失败')
  })
})
