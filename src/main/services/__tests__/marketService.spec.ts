import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// mock httpUtil：所有 HTTP 调用拦截（HttpUtilError 保留真实构造签名供 404 判定）
vi.mock('../httpUtil', () => ({
  httpGetJson: vi.fn(),
  httpDownload: vi.fn(),
  HttpUtilError: class HttpUtilError extends Error {
    readonly code: string
    readonly status?: number
    constructor(code: string, message: string, status?: number) {
      super(message)
      this.code = code
      this.status = status
    }
  }
}))

// mock settingsService：镜像开关可控（P1-10 默认关闭，镜像用例显式开启）
const mockAllowCfMirror = vi.hoisted(() => ({ value: true }))
vi.mock('../settingsService', () => ({
  getSection: vi.fn((section: string) =>
    section === 'marketplace'
      ? { curseforgeApiKey: '', allowCfMirror: mockAllowCfMirror.value }
      : {}
  )
}))

import { httpDownload, httpGetJson, HttpUtilError } from '../httpUtil'
import {
  findProjectBySlug,
  getModDetail,
  installMod,
  listModFiles,
  searchMods
} from '../marketService'
import { createProvenanceRecorder, writeSources } from '../modpack/provenance'

function zipBuffer(): Buffer {
  // 最小 ZIP/JAR 头：PK\x03\x04 + 若干字节
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(32, 0)])
}

describe('marketService — P3-3 轻量查询（跨平台联动复用）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAllowCfMirror.value = true
  })

  it('listModFiles（Modrinth）：单次请求拉取版本列表并适配为 MarketModFile', async () => {
    vi.mocked(httpGetJson).mockResolvedValueOnce({
      status: 200,
      data: [
        {
          id: 'v2',
          name: 'Sodium 0.6',
          version_number: '0.6.0',
          date_published: '2024-06-01T00:00:00Z',
          loaders: ['fabric'],
          game_versions: ['1.20.1'],
          dependencies: [],
          files: [
            {
              url: 'https://cdn.example/sodium.jar',
              filename: 'sodium.jar',
              size: 10,
              primary: true,
              hashes: { sha1: 'a', sha512: 'b' }
            }
          ]
        }
      ]
    })
    const files = await listModFiles('modrinth', 'mr1', '')
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      id: 'v2',
      versionNumber: '0.6.0',
      hashes: { sha1: 'a', sha512: 'b' }
    })
    expect(vi.mocked(httpGetJson)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(httpGetJson).mock.calls[0]![0]).toContain('/project/mr1/version')
  })

  it('findProjectBySlug（Modrinth）：404 返回 null；命中返回候选', async () => {
    vi.mocked(httpGetJson).mockRejectedValueOnce(new HttpUtilError('http', 'HTTP 404', 404))
    await expect(findProjectBySlug('modrinth', 'nope', '')).resolves.toBeNull()

    vi.mocked(httpGetJson).mockResolvedValueOnce({
      status: 200,
      data: { id: 'mr9', slug: 'sodium', title: 'Sodium', updated: '2024-06-01T00:00:00Z' }
    })
    await expect(findProjectBySlug('modrinth', 'sodium', '')).resolves.toMatchObject({
      id: 'mr9',
      slug: 'sodium',
      name: 'Sodium',
      updatedAt: '2024-06-01T00:00:00Z'
    })
  })

  it('findProjectBySlug（CurseForge）：slug 精确命中返回候选，未命中返回 null', async () => {
    const mod = {
      id: 238222,
      slug: 'jei',
      name: 'JEI',
      summary: '',
      downloadCount: 1,
      dateModified: '2024-01-01T00:00:00Z',
      authors: [],
      categories: [],
      latestFiles: []
    }
    vi.mocked(httpGetJson).mockResolvedValueOnce({ status: 200, data: { data: [mod] } })
    await expect(findProjectBySlug('curseforge', 'jei', '')).resolves.toMatchObject({
      id: '238222',
      slug: 'jei'
    })
    expect(vi.mocked(httpGetJson).mock.calls[0]![0]).toContain('slug=jei')

    vi.mocked(httpGetJson).mockResolvedValueOnce({ status: 200, data: { data: [mod] } })
    await expect(findProjectBySlug('curseforge', 'other', '')).resolves.toBeNull()
  })
})

describe('marketService — CurseForge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAllowCfMirror.value = true
  })

  it('未配置 Key 且镜像未显式允许时拒绝走第三方镜像（P1-10 默认关闭）', async () => {
    mockAllowCfMirror.value = false
    await expect(searchMods({ platform: 'curseforge', query: 'x' }, '')).rejects.toThrow('第三方镜像')
    expect(vi.mocked(httpGetJson)).not.toHaveBeenCalled()
  })

  it('未配置 API Key 时走 MCIM 镜像（不带 x-api-key）', async () => {
    vi.mocked(httpGetJson).mockResolvedValueOnce({ status: 200, data: { data: [], pagination: { resultCount: 0, totalCount: 0 } } })
    const res = await searchMods({ platform: 'curseforge', query: 'x' }, '')
    expect(res.items).toHaveLength(0)
    const [url, opts] = vi.mocked(httpGetJson).mock.calls[0]!
    expect(url).toContain('https://mod.mcimirror.top/curseforge/v1/mods/search')
    expect((opts as { headers: Record<string, string> }).headers['x-api-key']).toBeUndefined()
  })

  it('镜像模式下详情文件下载地址改写为 MCIM（官方 CDN 已强制 Key）', async () => {
    const mod = {
      id: 238222,
      slug: 'jei',
      name: 'JEI',
      summary: 's',
      downloadCount: 1,
      dateModified: '2024-01-01T00:00:00Z',
      authors: [],
      categories: [],
      latestFiles: []
    }
    const file = {
      id: 8973700,
      displayName: 'jei-1.20.1-fabric-15.0.0.jar',
      fileName: 'jei-1.20.1-fabric-15.0.0.jar',
      downloadUrl: 'https://edge.forgecdn.net/files/8973/700/jei-1.20.1-fabric-15.0.0.jar',
      fileLength: 100,
      fileDate: '2024-01-01T00:00:00Z',
      gameVersions: ['1.20.1', 'Fabric'],
      dependencies: []
    }
    vi.mocked(httpGetJson)
      .mockResolvedValueOnce({ status: 200, data: { data: mod } })
      .mockResolvedValueOnce({ status: 200, data: { data: [file] } })
    const detail = await getModDetail('curseforge', '238222', '')
    expect(detail.files[0]!.downloadUrl).toBe(
      'https://mod.mcimirror.top/files/8973/700/jei-1.20.1-fabric-15.0.0.jar'
    )
  })

  it('配置 Key 时走官方 API 且保留官方下载地址', async () => {
    const mod = {
      id: 238222, slug: 'jei', name: 'JEI', summary: 's', downloadCount: 1,
      dateModified: '2024-01-01T00:00:00Z', authors: [], categories: [], latestFiles: []
    }
    const file = {
      id: 8973700, displayName: 'a.jar', fileName: 'a.jar',
      downloadUrl: 'https://edge.forgecdn.net/files/8973/700/a.jar',
      fileLength: 100, fileDate: '2024-01-01T00:00:00Z', gameVersions: ['1.20.1'], dependencies: []
    }
    vi.mocked(httpGetJson)
      .mockResolvedValueOnce({ status: 200, data: { data: mod } })
      .mockResolvedValueOnce({ status: 200, data: { data: [file] } })
    const detail = await getModDetail('curseforge', '238222', 'key-xxx')
    expect(detail.files[0]!.downloadUrl).toBe('https://edge.forgecdn.net/files/8973/700/a.jar')
    const [url] = vi.mocked(httpGetJson).mock.calls[0]!
    expect(url).toContain('https://api.curseforge.com/v1/mods/238222')
  })

  it('搜索结果适配为统一结构', async () => {
    const mod = {
      id: 123,
      slug: 'sodium',
      name: 'Sodium',
      summary: 'Rendering engine',
      downloadCount: 1000,
      dateModified: '2024-01-01T00:00:00Z',
      authors: [{ name: 'jellysquid' }],
      categories: [{ name: 'performance' }],
      latestFiles: [],
      logo: { thumbnailUrl: 'https://img/1.png' }
    }
    vi.mocked(httpGetJson).mockResolvedValueOnce({ status: 200, data: { data: [mod], pagination: { resultCount: 1, totalCount: 1 } } })

    const res = await searchMods({ platform: 'curseforge', query: 'sodium' }, 'key-xxx')
    expect(res.items).toHaveLength(1)
    expect(res.items[0].platform).toBe('curseforge')
    expect(res.items[0].slug).toBe('sodium')
    expect(res.items[0].iconUrl).toBe('https://img/1.png')
    expect(res.items[0].authors).toEqual(['jellysquid'])
  })
})

describe('marketService — Modrinth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无需 API Key 即可搜索', async () => {
    const p = {
      id: 'AANobbMI',
      slug: 'sodium',
      title: 'Sodium',
      description: 'Rendering',
      icon_url: null,
      downloads: 5000,
      updated: '2024-02-02T00:00:00Z',
      categories: ['fabric'],
      loaders: ['fabric'],
      game_versions: ['1.20.1']
    }
    vi.mocked(httpGetJson).mockResolvedValueOnce({ status: 200, data: { hits: [p], total_hits: 1 } })

    const res = await searchMods({ platform: 'modrinth', query: 'sodium' }, '')
    expect(res.items).toHaveLength(1)
    expect(res.items[0].platform).toBe('modrinth')
    expect(res.items[0].id).toBe('AANobbMI')
    expect(res.items[0].gameVersions).toEqual(['1.20.1'])
  })

  it('详情返回版本列表（按时间倒序）', async () => {
    const project = {
      id: 'AANobbMI', slug: 'sodium', title: 'Sodium', description: '',
      icon_url: null, downloads: 0, updated: '', categories: [], loaders: [], game_versions: []
    }
    const oldV = {
      id: 'old', name: '0.4', version_number: '0.4.0', date_published: '2023-01-01T00:00:00Z',
      loaders: ['fabric'], game_versions: ['1.20.1'], dependencies: [],
      files: [{ url: 'https://cdn/old.jar', filename: 'sodium-0.4.0.jar', size: 100, primary: true }]
    }
    const newV = {
      id: 'new', name: '0.5', version_number: '0.5.0', date_published: '2024-01-01T00:00:00Z',
      loaders: ['fabric'], game_versions: ['1.20.1'], dependencies: [],
      files: [{ url: 'https://cdn/new.jar', filename: 'sodium-0.5.0.jar', size: 200, primary: true }]
    }
    vi.mocked(httpGetJson)
      .mockResolvedValueOnce({ status: 200, data: project })
      .mockResolvedValueOnce({ status: 200, data: [oldV, newV] })

    const detail = await getModDetail('modrinth', 'AANobbMI', '')
    expect(detail.files).toHaveLength(2)
    expect(detail.files[0].id).toBe('new') // 倒序
    expect(detail.files[0].downloadUrl).toBe('https://cdn/new.jar')
  })
})

describe('marketService — installMod', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('下载 jar 校验 zip 头并写入 run/mods', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'kunyu-mktest-'))
    const projectPath = join(tmp, 'proj')
    vi.mocked(httpGetJson)
      .mockResolvedValueOnce({ status: 200, data: { id: 'AANobbMI', slug: 'sodium', title: 'Sodium', description: '', icon_url: null, downloads: 0, updated: '', categories: [], loaders: [], game_versions: [] } })
      .mockResolvedValueOnce({ status: 200, data: [{ id: 'v1', name: '0.5', version_number: '0.5.0', date_published: '', loaders: ['fabric'], game_versions: ['1.20.1'], dependencies: [], files: [{ url: 'https://cdn/new.jar', filename: 'sodium-0.5.0.jar', size: 200, primary: true }] }] })

    // httpDownload 模拟：把 zip 头写入目标路径
    vi.mocked(httpDownload).mockImplementation(async (_url, dest) => {
      await writeFile(dest, zipBuffer())
      return zipBuffer().length
    })

    const result = await installMod(
      { platform: 'modrinth', modId: 'AANobbMI', versionId: 'v1', projectPath, includeDependencies: false },
      ''
    )
    expect(result.ok).toBe(true)
    expect(result.fileName).toBe('sodium-0.5.0.jar')
    expect(result.installed?.endsWith(join('run', 'mods', 'sodium-0.5.0.jar'))).toBe(true)
  })

  it('同 slug 已存在时报冲突（不覆盖）', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'kunyu-mktest-'))
    const projectPath = join(tmp, 'proj')
    const modsDir = join(projectPath, 'run', 'mods')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(modsDir, { recursive: true })
    writeFileSync(join(modsDir, 'sodium-0.4.0.jar'), zipBuffer())

    vi.mocked(httpGetJson)
      .mockResolvedValueOnce({ status: 200, data: { id: 'AANobbMI', slug: 'sodium', title: 'Sodium', description: '', icon_url: null, downloads: 0, updated: '', categories: [], loaders: [], game_versions: [] } })
      .mockResolvedValueOnce({ status: 200, data: [{ id: 'v1', name: '0.5', version_number: '0.5.0', date_published: '', loaders: ['fabric'], game_versions: ['1.20.1'], dependencies: [], files: [{ url: 'https://cdn/new.jar', filename: 'sodium-0.5.0.jar', size: 200, primary: true }] }] })

    const result = await installMod(
      { platform: 'modrinth', modId: 'AANobbMI', versionId: 'v1', projectPath, includeDependencies: false },
      ''
    )
    expect(result.ok).toBe(false)
    expect(result.conflict).toBeTruthy()
  })
})

describe('marketService — 来源记录（整合包组装依赖）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const project = {
    id: 'AANobbMI',
    slug: 'sodium',
    title: 'Sodium',
    description: '',
    icon_url: null,
    downloads: 0,
    updated: '',
    categories: [],
    loaders: [],
    game_versions: []
  }

  function version(id: string, fileName: string, deps: unknown[] = []): unknown {
    return {
      id,
      name: id,
      version_number: `0.5.${id}`,
      date_published: '',
      loaders: ['fabric'],
      game_versions: ['1.20.1'],
      dependencies: deps,
      files: [{ url: `https://cdn/${fileName}`, filename: fileName, size: 200, primary: true }]
    }
  }

  async function mockInstall(): Promise<string> {
    const tmp = await mkdtemp(join(tmpdir(), 'kunyu-mkprov-'))
    const projectPath = join(tmp, 'proj')
    vi.mocked(httpDownload).mockImplementation(async (_url, dest) => {
      await writeFile(dest, zipBuffer())
      return zipBuffer().length
    })
    return projectPath
  }

  function readSourcesFile(projectPath: string): { entries: Array<Record<string, unknown>> } | null {
    const file = join(projectPath, '.kunyu', 'modpack.json')
    if (!existsSync(file)) return null
    return JSON.parse(readFileSync(file, 'utf8')) as { entries: Array<Record<string, unknown>> }
  }

  it('注入记录器时写入平台坐标与文件大小', async () => {
    const projectPath = await mockInstall()
    vi.mocked(httpGetJson)
      .mockResolvedValueOnce({ status: 200, data: project })
      .mockResolvedValueOnce({ status: 200, data: [version('v1', 'sodium-0.5.0.jar')] })

    const recorder = createProvenanceRecorder(projectPath)
    const result = await installMod(
      { platform: 'modrinth', modId: 'AANobbMI', versionId: 'v1', projectPath, includeDependencies: false },
      '',
      undefined,
      recorder
    )
    expect(result.ok).toBe(true)
    const file = readSourcesFile(projectPath)
    expect(file?.entries).toHaveLength(1)
    expect(file?.entries[0]).toMatchObject({
      fileName: 'sodium-0.5.0.jar',
      platform: 'modrinth',
      modId: 'AANobbMI',
      versionId: 'v1',
      slug: 'sodium',
      downloadUrl: 'https://cdn/sodium-0.5.0.jar'
    })
    expect(file?.entries[0]?.size).toBe(zipBuffer().length)
  })

  it('未注入记录器时不产生 .kunyu/modpack.json', async () => {
    const projectPath = await mockInstall()
    vi.mocked(httpGetJson)
      .mockResolvedValueOnce({ status: 200, data: project })
      .mockResolvedValueOnce({ status: 200, data: [version('v1', 'sodium-0.5.0.jar')] })

    await installMod(
      { platform: 'modrinth', modId: 'AANobbMI', versionId: 'v1', projectPath, includeDependencies: false },
      ''
    )
    expect(readSourcesFile(projectPath)).toBeNull()
  })

  it('覆盖安装时旧坐标被清掉，只留新版本记录', async () => {
    const projectPath = await mockInstall()
    const modsDir = join(projectPath, 'run', 'mods')
    mkdirSync(modsDir, { recursive: true })
    writeFileSync(join(modsDir, 'sodium-0.4.0.jar'), zipBuffer())
    writeSources(projectPath, [
      {
        fileName: 'sodium-0.4.0.jar',
        platform: 'modrinth',
        modId: 'AANobbMI',
        versionId: 'old',
        slug: 'sodium',
        name: 'Sodium',
        versionNumber: '0.4.0',
        downloadUrl: 'https://cdn/old.jar',
        size: 100,
        installedAt: '2026-01-01T00:00:00.000Z'
      }
    ])

    vi.mocked(httpGetJson)
      .mockResolvedValueOnce({ status: 200, data: project })
      .mockResolvedValueOnce({ status: 200, data: [version('v1', 'sodium-0.5.0.jar')] })

    const result = await installMod(
      {
        platform: 'modrinth',
        modId: 'AANobbMI',
        versionId: 'v1',
        projectPath,
        includeDependencies: false,
        overwrite: true
      },
      '',
      undefined,
      createProvenanceRecorder(projectPath)
    )
    expect(result.ok).toBe(true)
    const names = readSourcesFile(projectPath)?.entries.map((e) => e.fileName)
    expect(names).toEqual(['sodium-0.5.0.jar'])
  })

  it('required 依赖一并安装时也记录来源坐标', async () => {
    const projectPath = await mockInstall()
    vi.mocked(httpGetJson)
      .mockResolvedValueOnce({ status: 200, data: project })
      .mockResolvedValueOnce({
        status: 200,
        data: [version('v1', 'sodium-0.5.0.jar', [{ project_id: 'P7dR8mSH', dependency_type: 'required' }])]
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { ...project, id: 'P7dR8mSH', slug: 'fabric-api', title: 'Fabric API' }
      })
      .mockResolvedValueOnce({ status: 200, data: [version('fapi1', 'fabric-api-0.90.jar')] })

    const result = await installMod(
      { platform: 'modrinth', modId: 'AANobbMI', versionId: 'v1', projectPath, includeDependencies: true },
      '',
      undefined,
      createProvenanceRecorder(projectPath)
    )
    expect(result.ok).toBe(true)
    const entries = readSourcesFile(projectPath)?.entries ?? []
    expect(entries.map((e) => e.fileName).sort()).toEqual(['fabric-api-0.90.jar', 'sodium-0.5.0.jar'])
    expect(entries.find((e) => e.fileName === 'fabric-api-0.90.jar')?.modId).toBe('P7dR8mSH')
    // 依赖链共 4 次 MR 请求 + 2 次下载，平台限速累计等待接近 5s，放宽超时
  }, 15000)
})

describe('marketService — 多内容类型（M16）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('CF 搜索按类型带 classId，mod 类型附 modLoaderType', async () => {
    vi.mocked(httpGetJson).mockResolvedValue({ status: 200, data: { data: [], pagination: { resultCount: 0, totalCount: 0 } } })

    await searchMods({ platform: 'curseforge', query: 'x', projectType: 'resourcepack' }, '')
    let url = String(vi.mocked(httpGetJson).mock.calls.at(-1)![0])
    expect(url).toContain('classId=12')
    expect(url).not.toContain('modLoaderType')

    await searchMods({ platform: 'curseforge', query: 'x', projectType: 'datapack' }, '')
    url = String(vi.mocked(httpGetJson).mock.calls.at(-1)![0])
    expect(url).toContain('classId=6945')

    await searchMods({ platform: 'curseforge', query: 'x', projectType: 'shader' }, '')
    url = String(vi.mocked(httpGetJson).mock.calls.at(-1)![0])
    expect(url).toContain('classId=6552')

    await searchMods({ platform: 'curseforge', query: 'x', projectType: 'modpack' }, '')
    url = String(vi.mocked(httpGetJson).mock.calls.at(-1)![0])
    expect(url).toContain('classId=4471')

    await searchMods({ platform: 'curseforge', query: 'x', projectType: 'mod', loader: 'fabric' }, '')
    url = String(vi.mocked(httpGetJson).mock.calls.at(-1)![0])
    expect(url).toContain('classId=6')
    expect(url).toContain('modLoaderType=4')
  })

  it('MR 搜索按类型带 project_type facet（datapack/resourcepack/shader/modpack）', async () => {
    vi.mocked(httpGetJson).mockResolvedValue({ status: 200, data: { hits: [], total_hits: 0 } })

    await searchMods({ platform: 'modrinth', query: 'x', projectType: 'datapack' }, '')
    let url = String(vi.mocked(httpGetJson).mock.calls.at(-1)![0])
    expect(decodeURIComponent(url)).toContain('project_type:datapack')

    await searchMods({ platform: 'modrinth', query: 'x', projectType: 'shader' }, '')
    url = String(vi.mocked(httpGetJson).mock.calls.at(-1)![0])
    expect(decodeURIComponent(url)).toContain('project_type:shader')

    // mod 默认且加载器 facet 仅 mod 生效
    await searchMods({ platform: 'modrinth', query: 'x', loader: 'fabric' }, '')
    url = String(vi.mocked(httpGetJson).mock.calls.at(-1)![0])
    expect(decodeURIComponent(url)).toContain('project_type:mod')
    expect(decodeURIComponent(url)).toContain('categories:fabric')

    // datapack 不应附加加载器 facet（datapack 的加载器维度不是 fabric/forge）
    await searchMods({ platform: 'modrinth', query: 'x', projectType: 'datapack', loader: 'fabric' }, '')
    url = String(vi.mocked(httpGetJson).mock.calls.at(-1)![0])
    expect(decodeURIComponent(url)).not.toContain('categories:fabric')
  })

  it('资源包安装到 run/resourcepacks（.zip），不写来源记录', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'kunyu-mkrp-'))
    const projectPath = join(tmp, 'proj')
    vi.mocked(httpGetJson)
      .mockResolvedValueOnce({ status: 200, data: { id: 'P1', slug: 'faithful', title: 'Faithful', description: '', icon_url: null, downloads: 0, updated: '', categories: [], loaders: [], game_versions: [] } })
      .mockResolvedValueOnce({ status: 200, data: [{ id: 'v1', name: '1.0', version_number: '1.0', date_published: '', loaders: [], game_versions: ['1.20.1'], dependencies: [], files: [{ url: 'https://cdn/faithful.zip', filename: 'faithful.zip', size: 200, primary: true }] }] })
    vi.mocked(httpDownload).mockImplementation(async (_url, dest) => {
      await writeFile(dest, zipBuffer())
      return zipBuffer().length
    })

    const recorder = createProvenanceRecorder(projectPath)
    const result = await installMod(
      { platform: 'modrinth', modId: 'P1', versionId: 'v1', projectPath, projectType: 'resourcepack' },
      '',
      undefined,
      recorder
    )
    expect(result.ok).toBe(true)
    expect(result.installedDir).toBe('run/resourcepacks')
    expect(result.installed?.endsWith(join('run', 'resourcepacks', 'faithful.zip'))).toBe(true)
    // 非模组不写来源记录
    expect(existsSync(join(projectPath, '.kunyu', 'modpack.json'))).toBe(false)
  })

  it('数据包安装到唯一存档的 datapacks 目录并附提示', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'kunyu-mkdp-'))
    const projectPath = join(tmp, 'proj')
    mkdirSync(join(projectPath, 'run', 'saves', 'world1'), { recursive: true })
    vi.mocked(httpGetJson)
      .mockResolvedValueOnce({ status: 200, data: { id: 'P2', slug: 'terralith', title: 'Terralith', description: '', icon_url: null, downloads: 0, updated: '', categories: [], loaders: [], game_versions: [] } })
      .mockResolvedValueOnce({ status: 200, data: [{ id: 'v1', name: '2.4', version_number: '2.4', date_published: '', loaders: ['datapack'], game_versions: ['1.20.1'], dependencies: [], files: [{ url: 'https://cdn/terralith.zip', filename: 'terralith.zip', size: 200, primary: true }] }] })
    vi.mocked(httpDownload).mockImplementation(async (_url, dest) => {
      await writeFile(dest, zipBuffer())
      return zipBuffer().length
    })

    const result = await installMod(
      { platform: 'modrinth', modId: 'P2', versionId: 'v1', projectPath, projectType: 'datapack' },
      ''
    )
    expect(result.ok).toBe(true)
    expect(result.installed?.endsWith(join('run', 'saves', 'world1', 'datapacks', 'terralith.zip'))).toBe(true)
    expect(result.note).toContain('重进存档')
  })

  it('整合包下载到 modpacks/ 并提示导入，不递归依赖', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'kunyu-mkmp-'))
    const projectPath = join(tmp, 'proj')
    vi.mocked(httpGetJson)
      .mockResolvedValueOnce({ status: 200, data: { id: 'P3', slug: 'all-the-mods', title: 'ATM', description: '', icon_url: null, downloads: 0, updated: '', categories: [], loaders: [], game_versions: [] } })
      .mockResolvedValueOnce({ status: 200, data: [{ id: 'v1', name: '1.0', version_number: '1.0', date_published: '', loaders: [], game_versions: ['1.20.1'], dependencies: [{ project_id: 'DEP', dependency_type: 'required' }], files: [{ url: 'https://cdn/atm.mrpack', filename: 'atm.mrpack', size: 200, primary: true }] }] })
    vi.mocked(httpDownload).mockImplementation(async (_url, dest) => {
      await writeFile(dest, zipBuffer())
      return zipBuffer().length
    })

    const result = await installMod(
      { platform: 'modrinth', modId: 'P3', versionId: 'v1', projectPath, projectType: 'modpack', includeDependencies: true },
      ''
    )
    expect(result.ok).toBe(true)
    expect(result.installedDir).toBe('modpacks')
    expect(result.note).toContain('导入')
    // 整合包不递归依赖：httpGetJson 只调用 2 次（详情+版本），无依赖详情请求
    expect(vi.mocked(httpGetJson).mock.calls).toHaveLength(2)
  })
})
