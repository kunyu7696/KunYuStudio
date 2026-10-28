/**
 * ContentPack 内容模块化测试。
 * 覆盖：扫描概要/坏 pack.json 降级/平台引用解析/新建幂等/启用切换保真，
 * 以及组装器集成（合并 overrides、随包 jar、双清单引用、index.toml pack 归属、
 * 冲突先到先得、禁用包不产条目）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { zipEntries } from '../../ai/zipUtil'
import { openZip } from '../../performance/jarReader'
import { assembleModpack, previewModpack, type ModpackMeta } from '../modpackAssembler'
import { createContentPack, scanContentPacks, setPackEnabled } from '../contentPackIo'
import { parseContentPackDoc } from '../../../../shared/types/contentPack'

const META: ModpackMeta = { name: '红石包', mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.15.11' }

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), 'kunyu-contentpack-'))
}

/** 造一个合法的模组 jar（store-only zip，文件头 PK\x03\x04） */
function seedMod(root: string, fileName: string, dir = 'run/mods'): void {
  const abs = join(root, dir, fileName)
  mkdirSync(dirname(abs), { recursive: true })
  zipEntries([{ name: 'fabric.mod.json', from: 'data', data: JSON.stringify({ id: fileName }) }], abs)
}

function seedPack(
  root: string,
  id: string,
  manifest: Record<string, unknown>,
  files?: { rel: string; data: string }[]
): void {
  const packDir = join(root, 'content-packs', id)
  mkdirSync(packDir, { recursive: true })
  writeFileSync(join(packDir, 'pack.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  for (const f of files ?? []) {
    const abs = join(packDir, ...f.rel.split('/'))
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.data, 'utf-8')
  }
}

const BASE_MANIFEST = {
  format: 'kunyu-content-pack/1',
  id: 'tech-pack',
  name: '科技包',
  category: 'tech',
  version: '1.0.0',
  description: '机械动力与电力',
  author: 'kunyu',
  enabled: true,
  mods: []
}

describe('parseContentPackDoc 守卫', () => {
  it('正常清单全字段解析', () => {
    const r = parseContentPackDoc(BASE_MANIFEST, 'tech-pack')
    expect(r.manifest).not.toBeNull()
    expect(r.manifest?.name).toBe('科技包')
    expect(r.manifest?.category).toBe('tech')
    expect(r.manifest?.enabled).toBe(true)
    expect(r.warnings).toEqual([])
  })

  it('id 缺失 / 与目录名不一致 / 含路径穿越 → 整包拒', () => {
    expect(parseContentPackDoc({ ...BASE_MANIFEST, id: '' }, 'tech-pack').manifest).toBeNull()
    expect(parseContentPackDoc({ ...BASE_MANIFEST, id: 'other' }, 'tech-pack').manifest).toBeNull()
    expect(parseContentPackDoc({ ...BASE_MANIFEST, id: '../evil' }, 'tech-pack').manifest).toBeNull()
  })

  it('category 非法降级 other，enabled 非布尔降禁用并告警', () => {
    const r = parseContentPackDoc({ ...BASE_MANIFEST, category: 'magic', enabled: 'yes' }, 'tech-pack')
    expect(r.manifest?.category).toBe('other')
    expect(r.manifest?.enabled).toBe(false)
    expect(r.warnings.some((w) => w.includes('enabled'))).toBe(true)
  })

  it('CF 引用非法坐标跳条目；MR 引用缺哈希跳条目，各自告警', () => {
    const r = parseContentPackDoc(
      {
        ...BASE_MANIFEST,
        mods: [
          { platform: 'curseforge', projectID: 0, fileID: 1 },
          { platform: 'curseforge', projectID: 238222, fileID: 4591234, fileName: 'sodium.jar' },
          { platform: 'modrinth', path: 'mods/a.jar', sha1: 'x', sha512: 'y', size: 10, downloadUrl: 'https://x' },
          { platform: 'modrinth', path: 'mods/b.jar', sha1: '', sha512: 'y', size: 10, downloadUrl: 'https://x' }
        ]
      },
      'tech-pack'
    )
    expect(r.manifest?.mods).toHaveLength(2)
    expect(r.warnings).toHaveLength(2)
  })
})

describe('contentPackIo 扫描与操作', () => {
  it('无 content-packs 目录返回空数组；正常包返回概要全字段', () => {
    const root = tmpProject()
    expect(scanContentPacks(root)).toEqual([])

    seedPack(root, 'tech-pack', BASE_MANIFEST)
    const packs = scanContentPacks(root)
    expect(packs).toHaveLength(1)
    expect(packs[0]).toMatchObject({
      packId: 'tech-pack',
      name: '科技包',
      category: 'tech',
      enabled: true,
      valid: true,
      warnings: []
    })
  })

  it('坏 pack.json（坏 JSON / 缺 id / id 与目录名不一致）降级为 valid:false 并带告警', () => {
    const root = tmpProject()
    const bad1 = join(root, 'content-packs', 'bad-json')
    mkdirSync(bad1, { recursive: true })
    writeFileSync(join(bad1, 'pack.json'), '{broken', 'utf-8')
    seedPack(root, 'no-id', { format: 'kunyu-content-pack/1' })
    seedPack(root, 'mismatch', { ...BASE_MANIFEST, id: 'elsewhere' })

    const packs = scanContentPacks(root)
    expect(packs).toHaveLength(3)
    expect(packs.every((p) => !p.valid)).toBe(true)
    expect(packs.every((p) => p.warnings.length > 0)).toBe(true)
  })

  it('UTF-8 BOM 的 pack.json 正常解析（Windows 记事本/PowerShell 常见）', () => {
    const root = tmpProject()
    const dir = join(root, 'content-packs', 'tech-pack')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'pack.json'), '\uFEFF' + JSON.stringify(BASE_MANIFEST), 'utf-8')
    const packs = scanContentPacks(root)
    expect(packs).toHaveLength(1)
    expect(packs[0].valid).toBe(true)
    expect(packs[0].name).toBe('科技包')
  })

  it('createContentPack 生成 pack.json 与目录；同 id 二次拒绝；非法 id 拒绝', () => {
    const root = tmpProject()
    const ok = createContentPack(root, { id: 'quest-pack', name: '任务包', category: 'quest' })
    expect(ok.ok).toBe(true)
    expect(existsSync(join(root, 'content-packs', 'quest-pack', 'pack.json'))).toBe(true)
    expect(existsSync(join(root, 'content-packs', 'quest-pack', 'overrides'))).toBe(true)
    expect(existsSync(join(root, 'content-packs', 'quest-pack', 'mods'))).toBe(true)

    const dup = createContentPack(root, { id: 'quest-pack', name: '任务包2', category: 'quest' })
    expect(dup.ok).toBe(false)
    expect(dup.error).toContain('已存在')

    const bad = createContentPack(root, { id: '../evil', name: 'x', category: 'tech' })
    expect(bad.ok).toBe(false)
  })

  it('setPackEnabled 只改 enabled，其余字段与未知键保真', () => {
    const root = tmpProject()
    seedPack(root, 'tech-pack', { ...BASE_MANIFEST, custom_key: 'keep-me' })

    const off = setPackEnabled(root, 'tech-pack', false)
    expect(off.ok).toBe(true)
    const doc = JSON.parse(readFileSync(join(root, 'content-packs', 'tech-pack', 'pack.json'), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(doc.enabled).toBe(false)
    expect(doc.name).toBe('科技包')
    expect(doc.custom_key).toBe('keep-me')

    expect(setPackEnabled(root, 'missing', true).ok).toBe(false)
    expect(setPackEnabled(root, '../evil', true).ok).toBe(false)
  })
})

describe('组装器集成：内容包合并', () => {
  it('启用包的 overrides 与 jar 进 zip，CF 引用进 manifest，index.toml 带 pack 归属', () => {
    const root = tmpProject()
    seedMod(root, 'sodium.jar')
    seedPack(
      root,
      'tech-pack',
      {
        ...BASE_MANIFEST,
        mods: [{ platform: 'curseforge', projectID: 238222, fileID: 4591234, fileName: 'sodium-extra.jar' }]
      },
      [{ rel: 'overrides/config/quest.toml', data: 'quest = true' }]
    )
    seedMod(root, 'bundle.jar', 'content-packs/tech-pack/mods')

    const r = assembleModpack(root, META)
    expect(r.ok).toBe(true)
    const paths = openZip(r.zipPath!).entries().map((e) => e.path)
    expect(paths).toContain('overrides/config/quest.toml')
    expect(paths).toContain('overrides/mods/bundle.jar')
    // pack.toml/index.toml 依旧不进 zip；content-packs 源目录不整体进 zip
    expect(paths).not.toContain('pack.toml')
    expect(paths.some((p) => p.startsWith('content-packs/'))).toBe(false)

    const cf = JSON.parse(openZip(r.cfZipPath!).read('manifest.json').toString('utf8')) as {
      files: { projectID: number; fileID: number }[]
    }
    expect(cf.files).toContainEqual({ projectID: 238222, fileID: 4591234, required: true })

    const plan = r.plan!
    expect(plan.packs).toHaveLength(1)
    expect(plan.packs[0]).toMatchObject({ packId: 'tech-pack', enabled: true })

    const indexToml = readFileSync(join(root, 'index.toml'), 'utf-8')
    expect(indexToml).toContain('file = "overrides/config/quest.toml"')
    expect(indexToml).toContain('pack = "tech-pack"')
  })

  it('禁用包不产生条目与清单引用，但 plan.packs 仍列出概要', () => {
    const root = tmpProject()
    seedMod(root, 'sodium.jar')
    seedPack(root, 'tech-pack', { ...BASE_MANIFEST, enabled: false }, [
      { rel: 'overrides/config/quest.toml', data: 'quest = true' }
    ])

    const r = previewModpack(root, META)
    expect(r.ok).toBe(true)
    expect(r.plan!.zipEntries).not.toContain('overrides/config/quest.toml')
    expect(r.plan!.packs).toHaveLength(1)
    expect(r.plan!.packs[0].enabled).toBe(false)
  })

  it('项目 overrides 与内容包同路径冲突：项目优先 + 告警', () => {
    const root = tmpProject()
    seedMod(root, 'sodium.jar')
    mkdirSync(join(root, 'overrides'), { recursive: true })
    writeFileSync(join(root, 'overrides', 'shared.txt'), 'from-project', 'utf-8')
    seedPack(root, 'tech-pack', BASE_MANIFEST, [{ rel: 'overrides/shared.txt', data: 'from-pack' }])

    const r = previewModpack(root, META)
    expect(r.ok).toBe(true)
    expect(r.plan!.warnings.some((w) => w.includes('先到先得'))).toBe(true)
  })
})
