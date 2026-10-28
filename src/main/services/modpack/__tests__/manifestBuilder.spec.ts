/**
 * 双清单构建纯函数测试：
 * CF 只重写 files[] 且坐标必须数值；MR 写入 path/双哈希/直链；
 * loaderVersion 缺失时省略键（绝不写空串）并告警；README 含 EULA 与来源表。
 */
import { describe, expect, it } from 'vitest'
import type { CurseForgeFileEntry, ModJarPlan, ModrinthFileEntry } from '../../../../shared/types/modpack'
import {
  buildCurseForgeManifest,
  buildModpackReadme,
  buildModrinthIndex,
  curseForgeLoaderId,
  modrinthLoaderKey
} from '../manifestBuilder'

const cfFiles: CurseForgeFileEntry[] = [{ projectID: 238222, fileID: 4591234, required: true }]

const mrFiles: ModrinthFileEntry[] = [
  {
    path: 'mods/sodium.jar',
    hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
    fileSize: 1024,
    downloads: ['https://cdn.example/sodium.jar'],
    env: { client: 'required', server: 'required' }
  }
]

describe('buildCurseForgeManifest', () => {
  it('只重写 files[]，其余骨架字段原样沿用', () => {
    const base = {
      minecraft: { version: '1.20.1', modLoaders: [{ id: 'fabric-0.15.11', primary: true }] },
      manifestType: 'minecraftModpack',
      manifestVersion: 1,
      name: '红石主题包',
      version: '1.0.0',
      author: '',
      files: [{ projectID: 1, fileID: 1, required: false }],
      overrides: 'overrides'
    }
    const out = buildCurseForgeManifest(base, cfFiles)
    expect(out.files).toEqual(cfFiles)
    expect(out.name).toBe('红石主题包')
    expect(out.manifestType).toBe('minecraftModpack')
    expect(out.overrides).toBe('overrides')
    // 不改动入参
    expect(base.files).toHaveLength(1)
  })

  it('坐标保持数值型且 required 为 true', () => {
    const out = buildCurseForgeManifest({}, cfFiles)
    const files = out.files as CurseForgeFileEntry[]
    expect(typeof files[0]?.projectID).toBe('number')
    expect(typeof files[0]?.fileID).toBe('number')
    expect(files[0]?.required).toBe(true)
  })

  it('meta 存在时重写 minecraft 段（版本与加载器以项目记录为权威）', () => {
    const base = {
      minecraft: { version: '1.19.2', modLoaders: [{ id: 'forge-43.0.0', primary: true }] },
      manifestType: 'minecraftModpack',
      manifestVersion: 1,
      name: '包',
      version: '1.0.0',
      author: '',
      files: [],
      overrides: 'overrides'
    }
    const out = buildCurseForgeManifest(base, cfFiles, {
      mcVersion: '1.20.1',
      loader: 'fabric',
      loaderVersion: '0.15.11'
    })
    const mc = out.minecraft as { version: string; modLoaders: Array<{ id: string; primary: boolean }> }
    expect(mc.version).toBe('1.20.1')
    expect(mc.modLoaders).toEqual([{ id: 'fabric-0.15.11', primary: true }])
    // 骨架其余字段不动
    expect(out.name).toBe('包')
  })

  it('loaderVersion 缺失时 modLoaders 置空（绝不写裸加载器 id 冒充版本）', () => {
    const out = buildCurseForgeManifest({}, cfFiles, {
      mcVersion: '1.21.1',
      loader: 'neoforge',
      loaderVersion: null
    })
    const mc = out.minecraft as { version: string; modLoaders: unknown[] }
    expect(mc.version).toBe('1.21.1')
    expect(mc.modLoaders).toEqual([])
  })
})

describe('buildModrinthIndex', () => {
  it('写入 files 条目结构（path/hashes/fileSize/downloads/env）', () => {
    const { index } = buildModrinthIndex({}, 'fabric', '0.15.11', '1.20.1', mrFiles)
    const files = index.files as ModrinthFileEntry[]
    expect(files[0]).toEqual(mrFiles[0])
    expect(files[0]?.hashes.sha512).toHaveLength(128)
  })

  it('保留骨架中的 minecraft 依赖并写入加载器版本', () => {
    const { index, warnings } = buildModrinthIndex(
      { dependencies: { minecraft: '1.20.1' }, name: '包', summary: '' },
      'fabric',
      '0.15.11',
      '1.20.1',
      mrFiles
    )
    expect(index.dependencies).toEqual({ minecraft: '1.20.1', 'fabric-loader': '0.15.11' })
    expect(index.name).toBe('包')
    expect(warnings).toEqual([])
  })

  it('forge 的加载器键名为 forge（非 fabric-loader）', () => {
    const { index } = buildModrinthIndex({}, 'forge', '47.2.0', '1.20.1', [])
    expect(index.dependencies).toEqual({ minecraft: '1.20.1', forge: '47.2.0' })
  })

  it('loaderVersion 缺失时省略加载器键并告警（绝不写空串）', () => {
    const { index, warnings } = buildModrinthIndex(
      { dependencies: { minecraft: '1.20.1' } },
      'fabric',
      null,
      '1.20.1',
      mrFiles
    )
    expect(index.dependencies).toEqual({ minecraft: '1.20.1' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('fabric-loader')
  })

  it('骨架里遗留的旧加载器键在版本缺失时被删除', () => {
    const { index } = buildModrinthIndex(
      { dependencies: { minecraft: '1.20.1', 'fabric-loader': '0.14.21' } },
      'fabric',
      null,
      '1.20.1',
      []
    )
    expect((index.dependencies as Record<string, string>)['fabric-loader']).toBeUndefined()
  })
})

describe('命名约定与 README', () => {
  it('加载器 id / 键名约定与骨架一致', () => {
    expect(curseForgeLoaderId('fabric', '0.15.11')).toBe('fabric-0.15.11')
    expect(curseForgeLoaderId('fabric', null)).toBe('fabric')
    expect(modrinthLoaderKey('fabric')).toBe('fabric-loader')
    expect(modrinthLoaderKey('neoforge')).toBe('neoforge')
  })

  it('README 含 EULA 合规说明与模组来源表', () => {
    const jar: ModJarPlan = {
      fileName: 'sodium.jar',
      size: 1024,
      disposition: 'modrinth-files',
      bundledInOverrides: true,
      env: { client: 'required', server: 'unsupported' },
      reason: 'Modrinth 清单坐标（含直链与双哈希）'
    }
    const text = buildModpackReadme(
      '红石包',
      '1.20.1',
      'fabric',
      '0.15.11',
      [jar],
      new Map([
        [
          'sodium.jar',
          {
            fileName: 'sodium.jar',
            platform: 'modrinth',
            modId: 'AANobbMI',
            versionId: 'v1',
            slug: 'sodium',
            name: 'Sodium',
            versionNumber: '0.5.0',
            downloadUrl: 'https://cdn.example/sodium.jar',
            size: 1024,
            installedAt: '2026-09-21T00:00:00.000Z'
          }
        ]
      ])
    )
    expect(text).toContain('红石包')
    expect(text).toContain('EULA')
    expect(text).toContain('sodium.jar')
    expect(text).toContain('modrinth')
    expect(text).toContain('许可协议')
    // client-only 模组的分发方式需区分目录
    expect(text).toContain('client-overrides/mods')
  })
})