/**
 * modLibraryService 单测：
 * 库清单过滤（含资源类型）/ 旧条目 resourceType 读时归一 / 市场下载入库（mock marketService）/
 * 本地导入（jar/zip/mrpack + zip 结构类型探测）/ 移除 /
 * 加入整合包项目（按类型分流落盘 + provenance 仅 mod）/ 冲突覆盖 / 体检补登 / 世界目录列举。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// mock 市场层：downloadEntry 不触网，fetchToFile 直接写一个假 jar。
// JAR_BYTES 被提升后的 mock 工厂引用，必须走 vi.hoisted 避免 TDZ。
const { JAR_BYTES } = vi.hoisted(() => ({
  JAR_BYTES: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03])
}))

vi.mock('../marketService', () => ({
  getModDetail: vi.fn(),
  fetchToFile: vi.fn(async (_url: string, _platform: string, destFile: string) => {
    writeFileSync(destFile, JAR_BYTES)
  })
}))

/** 非 zip 魔数 */
const FAKE_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x00])

import { getModDetail } from '../marketService'
import {
  addEntryToProject,
  detectResourceType,
  downloadEntry,
  importLocalFiles,
  listEntries,
  listWorlds,
  pruneMissing,
  removeEntry,
  rescanLibrary
} from '../modLibraryService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { sourcesFilePath } from '../modpack/provenance'
import type { ModLibraryEntry } from '../../../shared/types/modLibrary'
import type { MarketModDetail } from '../../../shared/types/market'

let libraryRoot: string
let projectPath: string

beforeEach(() => {
  libraryRoot = mkdtempSync(join(tmpdir(), 'ky-modlib-'))
  projectPath = mkdtempSync(join(tmpdir(), 'ky-modproj-'))
  registerProjectRoot(projectPath)
})

afterEach(() => {
  unregisterProjectRoot(projectPath)
  rmSync(libraryRoot, { recursive: true, force: true })
  rmSync(projectPath, { recursive: true, force: true })
  vi.clearAllMocks()
})

/** 直接写库清单 + 对应 jar，造测试条目 */
function seedEntry(partial: Partial<ModLibraryEntry> & { fileName: string }): ModLibraryEntry {
  const entry: ModLibraryEntry = {
    resourceType: 'mod',
    name: partial.fileName.replace(/\.(jar|zip|mrpack)$/, ''),
    platform: 'local',
    projectId: null,
    versionId: null,
    slug: null,
    versionNumber: '',
    loaders: [],
    gameVersions: [],
    size: JAR_BYTES.length,
    downloadUrl: null,
    addedAt: new Date().toISOString(),
    ...partial
  }
  writeFileSync(join(libraryRoot, entry.fileName), JAR_BYTES)
  const raw = existsSync(join(libraryRoot, 'library.json'))
    ? (JSON.parse(readFileSync(join(libraryRoot, 'library.json'), 'utf8')) as {
        version: number
        entries: ModLibraryEntry[]
      })
    : { version: 1, entries: [] as ModLibraryEntry[] }
  raw.entries.push(entry)
  writeFileSync(join(libraryRoot, 'library.json'), JSON.stringify(raw, null, 2))
  return entry
}

/** 造一个合法的最小 zip（stored 条目，空数据体），仅用于结构探测 */
function buildZip(names: string[]): Buffer {
  const locals: Buffer[] = []
  const cds: Buffer[] = []
  let offset = 0
  for (const name of names) {
    const nameBuf = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local header sig
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 8) // method: stored
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0) // central dir sig
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 10) // method
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42) // local header offset
    cds.push(cd, nameBuf)
    offset += 30 + nameBuf.length
  }
  const cdBuf = Buffer.concat(cds)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(names.length, 8)
  eocd.writeUInt16LE(names.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cdBuf, eocd])
}

describe('listEntries 过滤与排序', () => {
  it('按加载器 / MC 版本 / 名称过滤，按 addedAt 倒序', () => {
    seedEntry({ fileName: 'sodium.jar', name: 'Sodium', loaders: ['fabric'], gameVersions: ['1.20.1'], addedAt: '2025-01-01T00:00:00.000Z' })
    seedEntry({ fileName: 'jade.jar', name: 'Jade', loaders: ['forge'], gameVersions: ['1.20.1'], addedAt: '2025-03-01T00:00:00.000Z' })
    seedEntry({ fileName: 'jei.jar', name: 'JEI', loaders: ['forge'], gameVersions: ['1.21.1'], addedAt: '2025-02-01T00:00:00.000Z' })

    const forge1201 = listEntries(libraryRoot, { loader: 'forge', mcVersion: '1.20.1' })
    expect(forge1201.map((e) => e.fileName)).toEqual(['jade.jar'])

    const forge = listEntries(libraryRoot, { loader: 'Forge' })
    expect(forge.map((e) => e.fileName)).toEqual(['jade.jar', 'jei.jar'])

    // 注意：所有 fileName 都含 '.jar'，查询词避开 j/a/r 以免后缀干扰
    expect(listEntries(libraryRoot, { query: 'jad' }).map((e) => e.fileName)).toEqual([
      'jade.jar'
    ])
    expect(listEntries(libraryRoot, { query: 'ei' }).map((e) => e.fileName)).toEqual(['jei.jar'])
    expect(listEntries(libraryRoot, { query: 'sod' }).map((e) => e.fileName)).toEqual([
      'sodium.jar'
    ])

    const all = listEntries(libraryRoot)
    expect(all.map((e) => e.fileName)).toEqual(['jade.jar', 'jei.jar', 'sodium.jar'])
  })

  it('清单缺失/损坏时回退空表', () => {
    expect(listEntries(libraryRoot)).toEqual([])
    writeFileSync(join(libraryRoot, 'library.json'), '{broken')
    expect(listEntries(libraryRoot)).toEqual([])
  })

  it('按资源类型精确过滤（空不过滤）', () => {
    seedEntry({ fileName: 'sodium.jar', resourceType: 'mod' })
    seedEntry({ fileName: 'faithful.zip', resourceType: 'resourcepack' })
    seedEntry({ fileName: 'complementary.zip', resourceType: 'shader' })

    expect(listEntries(libraryRoot, { type: 'resourcepack' }).map((e) => e.fileName)).toEqual(['faithful.zip'])
    expect(listEntries(libraryRoot, { type: 'shader' }).map((e) => e.fileName)).toEqual(['complementary.zip'])
    expect(listEntries(libraryRoot, { type: 'mod' }).map((e) => e.fileName)).toEqual(['sodium.jar'])
    expect(listEntries(libraryRoot)).toHaveLength(3)
  })

  it('旧条目缺 resourceType 字段时读时归一为 mod（不改盘文件）', () => {
    writeFileSync(join(libraryRoot, 'legacy.jar'), JAR_BYTES)
    const legacy = {
      fileName: 'legacy.jar',
      name: 'legacy',
      platform: 'local',
      projectId: null,
      versionId: null,
      slug: null,
      versionNumber: '',
      loaders: [],
      gameVersions: [],
      size: JAR_BYTES.length,
      downloadUrl: null,
      addedAt: '2025-01-01T00:00:00.000Z'
    }
    writeFileSync(join(libraryRoot, 'library.json'), JSON.stringify({ version: 1, entries: [legacy] }))

    const entries = listEntries(libraryRoot)
    expect(entries).toHaveLength(1)
    expect(entries[0].resourceType).toBe('mod')
    // 读时归一不落盘：盘上清单仍无 resourceType
    const onDisk = JSON.parse(readFileSync(join(libraryRoot, 'library.json'), 'utf8')) as { entries: Array<Record<string, unknown>> }
    expect(onDisk.entries[0].resourceType).toBeUndefined()
  })

  it('非法 resourceType 值同样归一为 mod', () => {
    seedEntry({ fileName: 'odd.jar' })
    const file = join(libraryRoot, 'library.json')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { entries: Array<Record<string, unknown>> }
    raw.entries[0].resourceType = 'not-a-type'
    writeFileSync(file, JSON.stringify(raw))
    expect(listEntries(libraryRoot)[0].resourceType).toBe('mod')
  })
})

describe('downloadEntry 市场下载入库', () => {
  const detail: MarketModDetail = {
    id: '123',
    platform: 'curseforge',
    slug: 'sodium',
    name: 'Sodium',
    summary: '',
    authors: ['jellysquid3'],
    iconUrl: null,
    downloads: 1,
    updatedAt: '2025-01-01T00:00:00.000Z',
    loaders: ['fabric'],
    gameVersions: ['1.20.1'],
    categories: [],
    url: 'https://example',
    description: '',
    files: [
      {
        id: 'f-1',
        name: 'Sodium 1.0',
        versionNumber: '1.0.0',
        fileName: 'sodium-fabric-1.0.0.jar',
        downloadUrl: 'https://example/sodium.jar',
        size: JAR_BYTES.length,
        releasedAt: '2025-01-01T00:00:00.000Z',
        loaders: ['fabric'],
        gameVersions: ['1.20.1'],
        dependencies: []
      }
    ]
  }

  it('下载落盘 + 清单登记（写入 resourceType）', async () => {
    vi.mocked(getModDetail).mockResolvedValue(detail)
    const result = await downloadEntry(
      libraryRoot,
      { platform: 'curseforge', projectId: '123', versionId: 'f-1' },
      'test-key'
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unexpected')
    expect(result.fileName).toBe('sodium-fabric-1.0.0.jar')
    expect(existsSync(join(libraryRoot, 'sodium-fabric-1.0.0.jar'))).toBe(true)

    const entries = listEntries(libraryRoot)
    expect(entries).toHaveLength(1)
    expect(entries[0].loaders).toEqual(['fabric'])
    expect(entries[0].gameVersions).toEqual(['1.20.1'])
    // 未传 projectType：按 .jar 扩展名归一为 mod
    expect(entries[0].resourceType).toBe('mod')
  })

  it('按传入 projectType 写入 resourceType（资源包）', async () => {
    const rpDetail: MarketModDetail = {
      ...detail,
      projectType: 'resourcepack',
      files: [{ ...detail.files[0], fileName: 'faithful-1.0.zip' }]
    }
    vi.mocked(getModDetail).mockResolvedValue(rpDetail)
    const result = await downloadEntry(
      libraryRoot,
      { platform: 'curseforge', projectId: '123', versionId: 'f-1', projectType: 'resourcepack' },
      'test-key'
    )
    expect(result.ok).toBe(true)
    const entries = listEntries(libraryRoot)
    expect(entries[0].resourceType).toBe('resourcepack')
    expect(entries[0].fileName).toBe('faithful-1.0.zip')
  })

  it('同名资源幂等返回「已在资源库中」', async () => {
    vi.mocked(getModDetail).mockResolvedValue(detail)
    const first = await downloadEntry(
      libraryRoot,
      { platform: 'curseforge', projectId: '123', versionId: 'f-1' },
      'test-key'
    )
    expect(first.ok).toBe(true)

    const second = await downloadEntry(
      libraryRoot,
      { platform: 'curseforge', projectId: '123', versionId: 'f-1' },
      'test-key'
    )
    expect(second.ok).toBe(true)
    if (!second.ok) throw new Error('unexpected')
    expect(second.message).toBe('已在资源库中')
    expect(listEntries(libraryRoot)).toHaveLength(1)
  })
})

describe('importLocalFiles 本地导入与类型识别', () => {
  it('jar 复制落盘并登记 local 条目（类型 mod）', async () => {
    const src = join(tmpdir(), 'local-mod.jar')
    writeFileSync(src, JAR_BYTES)
    const imported = await importLocalFiles(libraryRoot, [src])
    expect(imported).toHaveLength(1)
    expect(imported[0].platform).toBe('local')
    expect(imported[0].resourceType).toBe('mod')
    expect(existsSync(join(libraryRoot, 'local-mod.jar'))).toBe(true)
  })

  it('mrpack 识别为整合包', async () => {
    const src = join(tmpdir(), 'my-pack.mrpack')
    writeFileSync(src, buildZip(['modrinth.index.json']))
    const imported = await importLocalFiles(libraryRoot, [src])
    expect(imported).toHaveLength(1)
    expect(imported[0].resourceType).toBe('modpack')
  })

  it('zip 结构探测：shaders/ → 光影', async () => {
    const src = join(tmpdir(), 'complementary.zip')
    writeFileSync(src, buildZip(['shaders/', 'shaders/final.fsh', 'pack.mcmeta']))
    const imported = await importLocalFiles(libraryRoot, [src])
    expect(imported[0].resourceType).toBe('shader')
  })

  it('zip 结构探测：data/（无 shaders/）→ 数据包', async () => {
    const src = join(tmpdir(), 'terralith.zip')
    writeFileSync(src, buildZip(['data/', 'data/terralith/worldgen/biome/x.json', 'pack.mcmeta']))
    const imported = await importLocalFiles(libraryRoot, [src])
    expect(imported[0].resourceType).toBe('datapack')
  })

  it('zip 结构探测：assets/ → 资源包；仅 pack.mcmeta → 资源包；空 zip 默认资源包', async () => {
    const withAssets = join(tmpdir(), 'faithful.zip')
    writeFileSync(withAssets, buildZip(['assets/', 'assets/minecraft/textures/x.png']))
    const onlyMeta = join(tmpdir(), 'meta-only.zip')
    writeFileSync(onlyMeta, buildZip(['pack.mcmeta']))
    const empty = join(tmpdir(), 'empty.zip')
    writeFileSync(empty, buildZip(['readme.txt']))
    const imported = await importLocalFiles(libraryRoot, [withAssets, onlyMeta, empty])
    expect(imported.map((e) => e.resourceType)).toEqual(['resourcepack', 'resourcepack', 'resourcepack'])
  })

  it('zip 结构探测优先级：shaders/ 先于 data/（光影包同时含 data/ 时判光影）', async () => {
    const src = join(tmpdir(), 'shader-with-data.zip')
    writeFileSync(src, buildZip(['shaders/x.fsh', 'data/legacy.json']))
    const imported = await importLocalFiles(libraryRoot, [src])
    expect(imported[0].resourceType).toBe('shader')
  })

  it('不支持的后缀跳过；同名跳过', async () => {
    const txt = join(tmpdir(), 'note.txt')
    writeFileSync(txt, JAR_BYTES)
    expect(await importLocalFiles(libraryRoot, [txt])).toHaveLength(0)

    const src = join(tmpdir(), 'dup.jar')
    writeFileSync(src, JAR_BYTES)
    await importLocalFiles(libraryRoot, [src])
    const again = await importLocalFiles(libraryRoot, [src])
    expect(again).toHaveLength(0)
  })

  it('后缀合法但魔数不对时抛错', async () => {
    const bad = join(tmpdir(), 'broken.jar')
    writeFileSync(bad, FAKE_BYTES)
    await expect(importLocalFiles(libraryRoot, [bad])).rejects.toThrow(/不是有效的 jar/)
  })

  it('detectResourceType：无文件路径时 zip 默认资源包', () => {
    expect(detectResourceType('a.jar')).toBe('mod')
    expect(detectResourceType('a.MRPACK')).toBe('modpack')
    expect(detectResourceType('a.zip')).toBe('resourcepack')
  })
})

describe('removeEntry 移除', () => {
  it('删除 jar 与清单条目；不存在返回 false', () => {
    seedEntry({ fileName: 'bye.jar' })
    expect(removeEntry(libraryRoot, 'bye.jar')).toBe(true)
    expect(existsSync(join(libraryRoot, 'bye.jar'))).toBe(false)
    expect(listEntries(libraryRoot)).toHaveLength(0)
    expect(removeEntry(libraryRoot, 'bye.jar')).toBe(false)
  })
})

describe('addEntryToProject 加入整合包', () => {
  it('平台条目：复制到 run/mods 并写 provenance', async () => {
    seedEntry({
      fileName: 'sodium.jar',
      name: 'Sodium',
      platform: 'modrinth',
      projectId: 'AANobbMI',
      versionId: 'v1',
      slug: 'sodium',
      versionNumber: '1.0.0',
      loaders: ['fabric'],
      gameVersions: ['1.20.1'],
      downloadUrl: 'https://example/sodium.jar'
    })

    const result = await addEntryToProject(libraryRoot, projectPath, 'sodium.jar')
    expect(result.ok).toBe(true)
    expect(existsSync(join(projectPath, 'run', 'mods', 'sodium.jar'))).toBe(true)

    const sourcesFile = sourcesFilePath(projectPath)
    expect(existsSync(sourcesFile)).toBe(true)
    const raw = JSON.parse(readFileSync(sourcesFile, 'utf8')) as {
      entries: Array<{ fileName: string; modId: string; versionId: string }>
    }
    expect(raw.entries).toHaveLength(1)
    expect(raw.entries[0].fileName).toBe('sodium.jar')
    expect(raw.entries[0].modId).toBe('AANobbMI')
  })

  it('local 条目：只复制，不写 provenance', async () => {
    seedEntry({ fileName: 'homemade.jar', platform: 'local' })
    const result = await addEntryToProject(libraryRoot, projectPath, 'homemade.jar')
    expect(result.ok).toBe(true)
    expect(existsSync(sourcesFilePath(projectPath))).toBe(false)
  })

  it('同名冲突返回 conflict；overwrite=true 覆盖成功', async () => {
    seedEntry({
      fileName: 'sodium.jar',
      platform: 'modrinth',
      projectId: 'AANobbMI',
      versionId: 'v1',
      loaders: ['fabric'],
      gameVersions: ['1.20.1']
    })

    // 首次加入成功，第二次同名才冲突
    const first = await addEntryToProject(libraryRoot, projectPath, 'sodium.jar')
    expect(first.ok).toBe(true)

    const conflict = await addEntryToProject(libraryRoot, projectPath, 'sodium.jar')
    expect(conflict.ok).toBe(false)
    if (conflict.ok) throw new Error('unexpected')
    expect(conflict.conflict?.existingFile).toContain('sodium.jar')

    const overwritten = await addEntryToProject(libraryRoot, projectPath, 'sodium.jar', true)
    expect(overwritten.ok).toBe(true)
  })

  it('库中不存在条目时返回失败', async () => {
    const result = await addEntryToProject(libraryRoot, projectPath, 'ghost.jar')
    expect(result.ok).toBe(false)
  })

  it('resourcepack → run/resourcepacks；shader → run/shaderpacks（均不写 provenance）', async () => {
    seedEntry({ fileName: 'faithful.zip', resourceType: 'resourcepack' })
    seedEntry({ fileName: 'complementary.zip', resourceType: 'shader' })

    const rp = await addEntryToProject(libraryRoot, projectPath, 'faithful.zip')
    expect(rp.ok).toBe(true)
    if (!rp.ok) throw new Error('unexpected')
    expect(rp.message).toBe('run/resourcepacks')
    expect(existsSync(join(projectPath, 'run', 'resourcepacks', 'faithful.zip'))).toBe(true)

    const sh = await addEntryToProject(libraryRoot, projectPath, 'complementary.zip')
    expect(sh.ok).toBe(true)
    if (!sh.ok) throw new Error('unexpected')
    expect(sh.message).toBe('run/shaderpacks')
    expect(existsSync(join(projectPath, 'run', 'shaderpacks', 'complementary.zip'))).toBe(true)

    // 非 mod 类型不写来源坐标
    expect(existsSync(sourcesFilePath(projectPath))).toBe(false)
  })

  it('datapack 带 worldName → run/saves/<世界>/datapacks（自动建中间目录）', async () => {
    seedEntry({ fileName: 'terralith.zip', resourceType: 'datapack' })
    mkdirSync(join(projectPath, 'run', 'saves', '新世界'), { recursive: true })

    const result = await addEntryToProject(libraryRoot, projectPath, 'terralith.zip', false, '新世界')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unexpected')
    expect(result.message).toBe('run/saves/新世界/datapacks')
    expect(existsSync(join(projectPath, 'run', 'saves', '新世界', 'datapacks', 'terralith.zip'))).toBe(true)
    expect(existsSync(sourcesFilePath(projectPath))).toBe(false)
  })

  it('datapack 缺 worldName 或 worldName 非法时返回失败', async () => {
    seedEntry({ fileName: 'terralith.zip', resourceType: 'datapack' })

    const missing = await addEntryToProject(libraryRoot, projectPath, 'terralith.zip')
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('unexpected')
    expect(missing.error).toContain('数据包需要指定目标存档')

    for (const bad of ['..', 'a/b', 'a\\b']) {
      const result = await addEntryToProject(libraryRoot, projectPath, 'terralith.zip', false, bad)
      expect(result.ok).toBe(false)
    }
    expect(existsSync(join(projectPath, 'run', 'saves'))).toBe(false)
  })

  it('modpack 拒绝加入并提示从新建项目导入', async () => {
    seedEntry({ fileName: 'my-pack.mrpack', resourceType: 'modpack' })
    const result = await addEntryToProject(libraryRoot, projectPath, 'my-pack.mrpack')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unexpected')
    expect(result.error).toBe('整合包请从新建项目导入')
  })

  it('fileName 含路径分隔符时拒绝（防清单被篡改后的路径穿越）', async () => {
    seedEntry({ fileName: 'sodium.jar' })
    const result = await addEntryToProject(libraryRoot, projectPath, '..\\sodium.jar')
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unexpected')
    expect(result.error).toContain('资源库中不存在')
  })
})

describe('listWorlds 世界目录列举', () => {
  it('无 run/saves 目录时返回空表', () => {
    expect(listWorlds(projectPath)).toEqual([])
  })

  it('只返回目录，文件与不存在的子项被过滤', () => {
    const saves = join(projectPath, 'run', 'saves')
    mkdirSync(join(saves, '世界A'), { recursive: true })
    mkdirSync(join(saves, '世界B'), { recursive: true })
    writeFileSync(join(saves, 'readme.txt'), 'not a world')
    expect(listWorlds(projectPath).sort()).toEqual(['世界A', '世界B'])
  })
})

describe('库体检 pruneMissing / rescanLibrary', () => {
  it('删除悬空清单条目', () => {
    seedEntry({ fileName: 'exists.jar' })
    seedEntry({ fileName: 'ghost.jar' })
    rmSync(join(libraryRoot, 'ghost.jar'))
    expect(pruneMissing(libraryRoot)).toBe(1)
    expect(listEntries(libraryRoot).map((e) => e.fileName)).toEqual(['exists.jar'])
  })

  it('把清单缺失的 jar 补登为 local 条目', () => {
    writeFileSync(join(libraryRoot, 'orphan.jar'), JAR_BYTES)
    const added = rescanLibrary(libraryRoot)
    expect(added).toHaveLength(1)
    expect(added[0].platform).toBe('local')
    expect(listEntries(libraryRoot).map((e) => e.fileName)).toEqual(['orphan.jar'])
  })

  it('zip/mrpack 同样补登并按结构识别类型', () => {
    writeFileSync(join(libraryRoot, 'orphan-shader.zip'), buildZip(['shaders/final.fsh']))
    writeFileSync(join(libraryRoot, 'orphan-pack.mrpack'), buildZip(['modrinth.index.json']))
    writeFileSync(join(libraryRoot, 'ignore.txt'), JAR_BYTES)
    const added = rescanLibrary(libraryRoot)
    expect(added.map((e) => e.resourceType).sort()).toEqual(['modpack', 'shader'])
  })
})
