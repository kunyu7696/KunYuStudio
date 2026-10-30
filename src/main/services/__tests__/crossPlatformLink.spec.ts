import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// mock marketService：编排层不触网，轻量查询全部拦截
vi.mock('../marketService', () => ({
  findProjectBySlug: vi.fn(),
  searchProjectCandidates: vi.fn(),
  listModFiles: vi.fn(),
  isCurseforgeAvailable: vi.fn(() => true)
}))

import {
  findProjectBySlug,
  isCurseforgeAvailable,
  listModFiles,
  searchProjectCandidates
} from '../marketService'
import {
  buildCrossLinkReport,
  buildDuplicates,
  buildMissingDeps,
  crossMapPath,
  latestCompatible,
  normalizeModName,
  pickCounterpartMatch,
  type LinkedEntry
} from '../crossPlatformLink'
import { writeSources } from '../modpack/provenance'
import type { CrossPlatformCandidate, MarketModFile } from '../../../shared/types/market'
import type { ModSourceEntry } from '../../../shared/types/modpack'

function entry(over: Partial<ModSourceEntry>): ModSourceEntry {
  return {
    fileName: 'a.jar',
    platform: 'modrinth',
    modId: 'mr1',
    versionId: 'v1',
    slug: 'sodium',
    name: 'Sodium',
    versionNumber: '0.5.0',
    downloadUrl: null,
    size: 1,
    installedAt: new Date().toISOString(),
    ...over
  }
}

function file(over: Partial<MarketModFile>): MarketModFile {
  return {
    id: 'v1',
    name: 'n',
    versionNumber: '0.5.0',
    fileName: 'a.jar',
    downloadUrl: '',
    size: 1,
    releasedAt: '2024-01-01T00:00:00Z',
    loaders: ['fabric'],
    gameVersions: ['1.20.1'],
    dependencies: [],
    ...over
  }
}

function candidate(
  over: Partial<CrossPlatformCandidate> & { platform?: 'curseforge' | 'modrinth' } = {}
): CrossPlatformCandidate & { platform: 'curseforge' | 'modrinth' } {
  return {
    id: 'cf1',
    slug: 'sodium',
    name: 'Sodium',
    updatedAt: '2024-01-01T00:00:00Z',
    platform: 'curseforge',
    ...over
  }
}

describe('crossPlatformLink — 纯函数', () => {
  it('normalizeModName：小写并去除非字母数字', () => {
    expect(normalizeModName('Just Enough Items (JEI)')).toBe('justenoughitemsjei')
    expect(normalizeModName('sodium-extra')).toBe('sodiumextra')
  })

  it('pickCounterpartMatch：slug 精确优先于名称归一化', () => {
    const target = { slug: 'sodium', name: 'Sodium' }
    const byName = candidate({ id: 'x', slug: 'sodium-fork', name: 'Sodium' })
    const bySlug = candidate({ id: 'y', slug: 'Sodium', name: '别的名字' })
    expect(pickCounterpartMatch([byName, bySlug], target)?.id).toBe('y')
    expect(pickCounterpartMatch([byName], target)?.id).toBe('x')
    expect(pickCounterpartMatch([candidate({ id: 'z', slug: 'other', name: 'Other' })], target)).toBeNull()
  })

  it('latestCompatible：按 mcVersion+loader 过滤取最新；无适配返回 null', () => {
    const files = [
      file({ id: 'old', releasedAt: '2024-01-01T00:00:00Z' }),
      file({ id: 'new', releasedAt: '2024-06-01T00:00:00Z' }),
      file({ id: 'forge-only', releasedAt: '2024-09-01T00:00:00Z', loaders: ['forge'] }),
      file({ id: 'other-mc', releasedAt: '2024-12-01T00:00:00Z', gameVersions: ['1.21'] })
    ]
    expect(latestCompatible(files, '1.20.1', 'fabric')?.id).toBe('new')
    expect(latestCompatible(files, '1.19.2', 'fabric')).toBeNull()
    // loader 缺省时不过滤加载器
    expect(latestCompatible(files, '1.20.1', '')?.id).toBe('forge-only')
  })

  it('buildDuplicates：任一平台身份相交即判跨平台重复；无交集不报', () => {
    const cfSide = entry({ fileName: 'jei-cf.jar', platform: 'curseforge', modId: '238222', name: 'JEI' })
    const mrSide = entry({ fileName: 'jei-mr.jar', platform: 'modrinth', modId: 'uXXRzYQy', name: 'JEI' })
    const linked: LinkedEntry[] = [
      // 仅 CF 侧解析出了对侧映射（单向）也能识别
      { entry: cfSide, counterpart: candidate({ id: 'uXXRzYQy', slug: 'jei', platform: 'modrinth' }) },
      { entry: mrSide, counterpart: null }
    ]
    const dups = buildDuplicates(linked)
    expect(dups).toHaveLength(1)
    expect(dups[0]).toMatchObject({ cfFileName: 'jei-cf.jar', mrFileName: 'jei-mr.jar' })
    // 无交集 → 不报
    expect(
      buildDuplicates([
        { entry: cfSide, counterpart: null },
        { entry: mrSide, counterpart: null }
      ])
    ).toHaveLength(0)
  })

  it('buildMissingDeps：跨平台等价视为已满足；optional 不报；同一前置去重', () => {
    const a = entry({ fileName: 'a.jar', platform: 'modrinth', modId: 'mrA', versionId: 'v1', name: 'A' })
    const b = entry({ fileName: 'b.jar', platform: 'curseforge', modId: 'cfB', versionId: 'v2', name: 'B' })
    const linked: LinkedEntry[] = [
      { entry: a, counterpart: candidate({ id: 'cfA', platform: 'curseforge' }) },
      { entry: b, counterpart: null }
    ]
    const ownFiles = new Map<string, MarketModFile[]>([
      [
        'modrinth:mrA',
        [
          file({
            id: 'v1',
            dependencies: [
              { platform: 'curseforge', modId: 'cfB', relationType: 'required' }, // 同平台已装
              { platform: 'curseforge', modId: 'cfA', relationType: 'required' }, // 跨平台等价已装
              { platform: 'modrinth', modId: 'mrOpt', relationType: 'optional' }, // 可选不报
              { platform: 'modrinth', modId: 'mrY', relationType: 'required' } // 缺失
            ]
          })
        ]
      ],
      [
        'curseforge:cfB',
        [
          file({
            id: 'v2',
            dependencies: [{ platform: 'modrinth', modId: 'mrY', relationType: 'required' }] // 同一前置去重
          })
        ]
      ]
    ])
    const missing = buildMissingDeps(linked, ownFiles)
    expect(missing).toHaveLength(1)
    expect(missing[0]).toMatchObject({ fileName: 'a.jar', depPlatform: 'modrinth', depModId: 'mrY' })
  })
})

describe('crossPlatformLink — 报告编排（mock 平台查询）', () => {
  let root = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(isCurseforgeAvailable).mockReturnValue(true)
    root = await mkdtemp(join(tmpdir(), 'kunyu-crosslink-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('版本滞后 + 对侧映射 + 更新超前；映射缓存落盘后第二次不再联网', async () => {
    writeSources(root, [entry({})])
    vi.mocked(listModFiles).mockResolvedValue([
      file({ id: 'v1', versionNumber: '0.5.0', releasedAt: '2024-01-01T00:00:00Z' }),
      file({ id: 'v2', versionNumber: '0.6.0', releasedAt: '2024-06-01T00:00:00Z' })
    ])
    vi.mocked(findProjectBySlug).mockResolvedValue(
      candidate({ id: '238222', slug: 'sodium', updatedAt: '2024-07-01T00:00:00Z' })
    )

    const meta = { mcVersion: '1.20.1', loader: 'fabric' }
    const r1 = await buildCrossLinkReport(root, meta, '')
    expect(r1.ok).toBe(true)
    expect(r1.items).toHaveLength(1)
    const item = r1.items[0]!
    expect(item.updateAvailable).toBe(true)
    expect(item.latest?.versionNumber).toBe('0.6.0')
    expect(item.counterpart).toMatchObject({ platform: 'curseforge', id: '238222', matchedBy: 'slug' })
    // 对侧项目 07-01 更新晚于本侧最新 06-01 → 超前
    expect(item.counterpartAhead).toBe(true)
    expect(r1.matchedCount).toBe(1)
    expect(r1.updateCount).toBe(1)
    // 缓存已落盘
    expect(existsSync(crossMapPath(root))).toBe(true)
    const disk = JSON.parse(readFileSync(crossMapPath(root), 'utf8')) as {
      entries: Record<string, { candidate: { id: string } | null }>
    }
    expect(disk.entries['modrinth:mr1']?.candidate?.id).toBe('238222')

    // 第二次：映射走缓存不再联网（版本列表仍每次查询，保证滞后判断新鲜）
    const r2 = await buildCrossLinkReport(root, meta, '')
    expect(r2.items[0]?.counterpart?.id).toBe('238222')
    expect(vi.mocked(findProjectBySlug)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(searchProjectCandidates)).not.toHaveBeenCalled()
  })

  it('slug 未命中时回退名称归一化匹配', async () => {
    writeSources(root, [entry({})])
    vi.mocked(listModFiles).mockResolvedValue([file({})])
    vi.mocked(findProjectBySlug).mockResolvedValue(null)
    vi.mocked(searchProjectCandidates).mockResolvedValue([
      candidate({ id: 'nope', slug: 'other', name: 'Other Mod' }),
      candidate({ id: 'hit', slug: 'sodium-ports', name: 'sodium' })
    ])

    const r = await buildCrossLinkReport(root, { mcVersion: '1.20.1', loader: 'fabric' }, '')
    expect(r.items[0]?.counterpart).toMatchObject({ id: 'hit', matchedBy: 'name' })
  })

  it('映射未命中写负缓存：缓存期内同一模组不再发起对侧查询', async () => {
    writeSources(root, [entry({})])
    vi.mocked(listModFiles).mockResolvedValue([file({})])
    vi.mocked(findProjectBySlug).mockResolvedValue(null)
    vi.mocked(searchProjectCandidates).mockResolvedValue([
      candidate({ id: 'nope', slug: 'other', name: 'Other Mod' })
    ])

    const meta = { mcVersion: '1.20.1', loader: 'fabric' }
    const r1 = await buildCrossLinkReport(root, meta, '')
    expect(r1.items[0]?.counterpart).toBeNull()
    expect(vi.mocked(findProjectBySlug)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(searchProjectCandidates)).toHaveBeenCalledTimes(1)

    const r2 = await buildCrossLinkReport(root, meta, '')
    expect(r2.items[0]?.counterpart).toBeNull()
    // 负缓存生效：两个查询均未再发起
    expect(vi.mocked(findProjectBySlug)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(searchProjectCandidates)).toHaveBeenCalledTimes(1)
  })

  it('CF 不可用（无 Key 且镜像未启用）：CF 侧降级跳过，MR 侧照常', async () => {
    vi.mocked(isCurseforgeAvailable).mockReturnValue(false)
    writeSources(root, [
      entry({ fileName: 'cf.jar', platform: 'curseforge', modId: '238222', slug: 'jei', name: 'JEI' }),
      entry({ fileName: 'mr.jar', platform: 'modrinth', modId: 'mr9', slug: 'sodium', name: 'Sodium' })
    ])
    vi.mocked(listModFiles).mockResolvedValue([file({})])
    vi.mocked(findProjectBySlug).mockResolvedValue(candidate({ id: 'x' }))

    const r = await buildCrossLinkReport(root, { mcVersion: '1.20.1', loader: 'fabric' }, '')
    expect(r.cfUnavailable).toBe(true)
    const cfItem = r.items.find((i) => i.platform === 'curseforge')!
    const mrItem = r.items.find((i) => i.platform === 'modrinth')!
    // CF 装模组：本侧版本列表被跳过（无滞后判断），但 MR 对侧仍映射
    expect(cfItem.latest).toBeNull()
    expect(cfItem.updateAvailable).toBe(false)
    expect(cfItem.counterpart?.platform).toBe('modrinth')
    // MR 装模组：本侧照常查询，CF 对侧被跳过
    expect(vi.mocked(listModFiles)).toHaveBeenCalledTimes(1)
    expect(mrItem.counterpart).toBeNull()
  })

  it('来源记录为空：直接返回空报告不触网', async () => {
    const r = await buildCrossLinkReport(root, { mcVersion: '1.20.1', loader: 'fabric' }, '')
    expect(r.ok).toBe(true)
    expect(r.items).toHaveLength(0)
    expect(vi.mocked(listModFiles)).not.toHaveBeenCalled()
  })
})
