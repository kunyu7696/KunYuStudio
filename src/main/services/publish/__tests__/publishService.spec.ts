import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../httpUtil', () => {
  class HttpUtilError extends Error {
    constructor(
      public code: 'timeout' | 'network' | 'http',
      message: string,
      public status?: number
    ) {
      super(message)
    }
  }
  return {
    HttpUtilError,
    httpGetJson: vi.fn(),
    httpPostMultipart: vi.fn()
  }
})

import { HttpUtilError, httpGetJson, httpPostMultipart } from '../../httpUtil'
import {
  __resetCfVersionsCache,
  listCfGameVersions,
  publishModpack,
  publishToCurseForge,
  publishToModrinth,
  runPublishPreflight,
  type PublishInput
} from '../publishService'

let dir = ''
let zipPath = ''

const BASE_INPUT: Omit<PublishInput, 'zipPath'> = {
  versionNumber: '1.0.0',
  title: '首个正式版',
  changelog: '- 初始发布',
  releaseType: 'release',
  mcVersion: '1.20.1',
  loader: 'fabric'
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kunyu-publish-'))
  zipPath = join(dir, 'pack.zip')
  // 合法 zip 魔数 PK\x03\x04
  writeFileSync(zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))
  __resetCfVersionsCache()
  vi.clearAllMocks()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('publishToModrinth', () => {
  it('multipart 组包正确（裸 token + data/file 字段）', async () => {
    vi.mocked(httpPostMultipart).mockResolvedValueOnce({ status: 200, data: { id: 'ver123' } })

    const url = await publishToModrinth(
      { ...BASE_INPUT, zipPath },
      { token: 'mrp_tok', projectId: 'my-pack' }
    )

    expect(url).toBe('https://modrinth.com/project/my-pack/version/ver123')
    const [callUrl, opts] = vi.mocked(httpPostMultipart).mock.calls[0]!
    expect(callUrl).toBe('https://api.modrinth.com/v2/version')
    expect(opts?.headers?.Authorization).toBe('mrp_tok')
    const keys = Object.keys(opts?.fields ?? {}).sort()
    expect(keys).toEqual(['data', 'file'])
    const data = JSON.parse(String(opts?.fields?.data)) as Record<string, unknown>
    expect(data.project_id).toBe('my-pack')
    expect(data.version_number).toBe('1.0.0')
    expect(data.version_type).toBe('release')
    expect(data.loaders).toEqual(['fabric'])
    expect(data.game_versions).toEqual(['1.20.1'])
    const file = opts?.fields?.file as { filename: string; contentType: string }
    expect(file.filename).toBe('pack.zip')
    expect(file.contentType).toBe('application/zip')
  })

  it('非 zip 文件（缺 PK 魔数）拒绝', async () => {
    const bad = join(dir, 'bad.zip')
    writeFileSync(bad, Buffer.from('not a zip'))
    await expect(
      publishToModrinth({ ...BASE_INPUT, zipPath: bad }, { token: 't', projectId: 'p' })
    ).rejects.toThrow('不是合法的 zip')
  })
})

describe('publishToCurseForge', () => {
  const CF_VERSIONS = [
    { id: 4, name: 'Fabric' },
    { id: 8000, name: '1.20.1' }
  ]

  it('组包正确（X-Api-Token + metadata gameVersions）', async () => {
    vi.mocked(httpGetJson).mockResolvedValueOnce({ status: 200, data: CF_VERSIONS })
    vi.mocked(httpPostMultipart).mockResolvedValueOnce({ status: 200, data: { id: 555 } })

    const url = await publishToCurseForge(
      { ...BASE_INPUT, zipPath },
      { token: 'cf_tok', projectId: '123456' }
    )

    expect(url).toBe('https://www.curseforge.com/minecraft/modpacks/123456/files/555')
    const [getUrl, getOpts] = vi.mocked(httpGetJson).mock.calls[0]!
    expect(getUrl).toBe('https://minecraft.curseforge.com/api/game/versions')
    expect(getOpts?.headers?.['X-Api-Token']).toBe('cf_tok')

    const [postUrl, postOpts] = vi.mocked(httpPostMultipart).mock.calls[0]!
    expect(postUrl).toBe('https://minecraft.curseforge.com/api/projects/123456/upload-file')
    expect(postOpts?.headers?.['X-Api-Token']).toBe('cf_tok')
    const meta = JSON.parse(String(postOpts?.fields?.metadata)) as Record<string, unknown>
    expect(meta.changelogType).toBe('markdown')
    expect(meta.displayName).toBe('首个正式版')
    expect(meta.gameVersions).toEqual([8000, 4])
    expect(meta.releaseType).toBe('release')
  })

  it('gameVersions 未匹配时报错并附建议', async () => {
    vi.mocked(httpGetJson).mockResolvedValueOnce({ status: 200, data: [{ id: 4, name: 'Fabric' }] })
    await expect(
      publishToCurseForge({ ...BASE_INPUT, zipPath }, { token: 'cf_tok', projectId: '123456' })
    ).rejects.toThrow('未匹配到 MC 1.20.1 / fabric')
  })

  it('listCfGameVersions 10 分钟进程缓存（第二次不再请求）', async () => {
    vi.mocked(httpGetJson).mockResolvedValue({ status: 200, data: CF_VERSIONS })
    await listCfGameVersions('t')
    await listCfGameVersions('t')
    expect(vi.mocked(httpGetJson)).toHaveBeenCalledTimes(1)
    __resetCfVersionsCache()
    await listCfGameVersions('t')
    expect(vi.mocked(httpGetJson)).toHaveBeenCalledTimes(2)
  })
})

describe('publishModpack', () => {
  const AUTH = {
    modrinth: { token: 'mrp_tok', projectId: 'my-pack' },
    curseforge: { token: 'cf_tok', projectId: '123456' }
  }

  it('未配置 token 的平台返回设置指引，不阻断另一平台', async () => {
    vi.mocked(httpPostMultipart).mockResolvedValueOnce({ status: 200, data: { id: 'v1' } })
    const results = await publishModpack(
      { ...BASE_INPUT, zipPath },
      ['modrinth', 'curseforge'],
      { modrinth: AUTH.modrinth }
    )
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ platform: 'modrinth', ok: true })
    expect(results[1]).toMatchObject({ platform: 'curseforge', ok: false })
    expect(results[1]!.error).toContain('设置 → 发布')
    expect(vi.mocked(httpPostMultipart)).toHaveBeenCalledTimes(1)
  })

  it('MR 失败不回滚，CF 仍执行（部分失败语义）', async () => {
    vi.mocked(httpPostMultipart)
      .mockRejectedValueOnce(new HttpUtilError('http', 'HTTP 403：无权限', 403))
      .mockResolvedValueOnce({ status: 200, data: { id: 777 } })
    vi.mocked(httpGetJson).mockResolvedValueOnce({
      status: 200,
      data: [
        { id: 4, name: 'Fabric' },
        { id: 8000, name: '1.20.1' }
      ]
    })
    const results = await publishModpack({ ...BASE_INPUT, zipPath }, ['modrinth', 'curseforge'], AUTH)
    expect(results[0]).toMatchObject({ platform: 'modrinth', ok: false })
    expect(results[0]!.error).toContain('平台返回错误：HTTP 403：无权限')
    expect(results[1]).toMatchObject({ platform: 'curseforge', ok: true })
    expect(results[1]!.url).toContain('/files/777')
  })

  it('超时错误映射为中文提示', async () => {
    vi.mocked(httpPostMultipart).mockRejectedValueOnce(new HttpUtilError('timeout', '上传超时'))
    const results = await publishModpack({ ...BASE_INPUT, zipPath }, ['modrinth'], AUTH)
    expect(results[0]!.error).toBe('请求超时，请检查网络或稍后重试')
  })

  it('P0-6：按平台选产物——CF 上传 -cf.zip，MR 上传 .mrpack', async () => {
    const mrpack = join(dir, 'pack.mrpack')
    const cfZip = join(dir, 'pack-cf.zip')
    writeFileSync(mrpack, Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]))
    writeFileSync(cfZip, Buffer.from([0x50, 0x4b, 0x03, 0x04, 2]))
    vi.mocked(httpPostMultipart)
      .mockResolvedValueOnce({ status: 200, data: { id: 'v1' } })
      .mockResolvedValueOnce({ status: 200, data: { id: 9 } })
    vi.mocked(httpGetJson).mockResolvedValueOnce({
      status: 200,
      data: [
        { id: 4, name: 'Fabric' },
        { id: 8000, name: '1.20.1' }
      ]
    })
    const results = await publishModpack(
      { ...BASE_INPUT, zipPath: mrpack, cfZipPath: cfZip },
      ['modrinth', 'curseforge'],
      AUTH
    )
    expect(results.every((r) => r.ok)).toBe(true)
    const [mrCall, cfCall] = vi.mocked(httpPostMultipart).mock.calls
    expect((mrCall![1]?.fields?.file as { filename: string }).filename).toBe('pack.mrpack')
    expect((cfCall![1]?.fields?.file as { filename: string }).filename).toBe('pack-cf.zip')
  })

  it('P0-6：未提供 cfZipPath 时 CF 回退 zipPath（兼容旧调用）', async () => {
    vi.mocked(httpPostMultipart).mockResolvedValueOnce({ status: 200, data: { id: 10 } })
    vi.mocked(httpGetJson).mockResolvedValueOnce({
      status: 200,
      data: [
        { id: 4, name: 'Fabric' },
        { id: 8000, name: '1.20.1' }
      ]
    })
    const results = await publishModpack({ ...BASE_INPUT, zipPath }, ['curseforge'], AUTH)
    expect(results[0]).toMatchObject({ platform: 'curseforge', ok: true })
    const [cfCall] = vi.mocked(httpPostMultipart).mock.calls
    expect((cfCall![1]?.fields?.file as { filename: string }).filename).toBe('pack.zip')
  })
})

describe('runPublishPreflight 发布预检门（P0③）', () => {
  it('合法输入 + 合法产物 → ready，逐项全 ok', () => {
    const r = runPublishPreflight({ ...BASE_INPUT, zipPath }, ['modrinth', 'curseforge'])
    expect(r.ready).toBe(true)
    expect(r.checks.every((c) => c.ok)).toBe(true)
    // 元数据 5 项 + 两个平台产物各 1 项
    expect(r.checks.map((c) => c.id)).toEqual([
      'version',
      'title',
      'changelog',
      'mc-version',
      'loader',
      'artifact-modrinth',
      'artifact-curseforge'
    ])
  })

  it('版本号非法（空 / v1.0 / 1.0）→ 不 ready 并指明格式要求', () => {
    for (const bad of ['', 'v1.0', '1.0', '最新版']) {
      const r = runPublishPreflight({ ...BASE_INPUT, zipPath, versionNumber: bad }, ['modrinth'])
      expect(r.ready).toBe(false)
      expect(r.checks.find((c) => c.id === 'version')?.ok).toBe(false)
      expect(r.checks.find((c) => c.id === 'version')?.detail).toContain('x.y.z')
    }
    // 合法后缀形式放行
    for (const good of ['1.0.0', '1.2.3-beta.1', '1.0.0+1.20.1']) {
      const r = runPublishPreflight({ ...BASE_INPUT, zipPath, versionNumber: good }, ['modrinth'])
      expect(r.checks.find((c) => c.id === 'version')?.ok).toBe(true)
    }
  })

  it('标题/changelog 为空 → 对应项失败', () => {
    const r1 = runPublishPreflight({ ...BASE_INPUT, zipPath, title: '  ' }, ['modrinth'])
    expect(r1.ready).toBe(false)
    expect(r1.checks.find((c) => c.id === 'title')?.ok).toBe(false)

    const r2 = runPublishPreflight({ ...BASE_INPUT, zipPath, changelog: '' }, ['modrinth'])
    expect(r2.ready).toBe(false)
    expect(r2.checks.find((c) => c.id === 'changelog')?.ok).toBe(false)
  })

  it('MC 版本/加载器非法 → 对应项失败', () => {
    const r1 = runPublishPreflight({ ...BASE_INPUT, zipPath, mcVersion: '20w14a' }, ['modrinth'])
    expect(r1.checks.find((c) => c.id === 'mc-version')?.ok).toBe(false)

    const r2 = runPublishPreflight({ ...BASE_INPUT, zipPath, loader: 'rift' }, ['modrinth'])
    expect(r2.checks.find((c) => c.id === 'loader')?.ok).toBe(false)
    expect(r2.checks.find((c) => c.id === 'loader')?.detail).toContain('fabric')
  })

  it('产物缺失 / 非 zip → 对应平台产物项失败；未勾选平台的产物不检查', () => {
    const missing = join(dir, 'nope.mrpack')
    const r1 = runPublishPreflight({ ...BASE_INPUT, zipPath: missing }, ['modrinth'])
    expect(r1.ready).toBe(false)
    expect(r1.checks.find((c) => c.id === 'artifact-modrinth')?.detail).toContain('找不到产物文件')

    const bad = join(dir, 'bad.mrpack')
    writeFileSync(bad, Buffer.from('not a zip'))
    const r2 = runPublishPreflight({ ...BASE_INPUT, zipPath: bad }, ['modrinth'])
    expect(r2.checks.find((c) => c.id === 'artifact-modrinth')?.detail).toContain('PK 魔数')

    // 只发 Modrinth 时，CF 产物缺失不阻塞
    const r3 = runPublishPreflight({ ...BASE_INPUT, zipPath, cfZipPath: missing }, ['modrinth'])
    expect(r3.ready).toBe(true)
    expect(r3.checks.find((c) => c.id === 'artifact-curseforge')).toBeUndefined()
  })

  it('CF 产物按 cfZipPath 优先探测（与上传选文件逻辑对齐）', () => {
    const badCf = join(dir, 'pack-cf.zip')
    writeFileSync(badCf, Buffer.from('broken'))
    const r = runPublishPreflight({ ...BASE_INPUT, zipPath, cfZipPath: badCf }, ['curseforge'])
    expect(r.ready).toBe(false)
    expect(r.checks.find((c) => c.id === 'artifact-curseforge')?.ok).toBe(false)
    // 未给 cfZipPath 时回退 zipPath
    const r2 = runPublishPreflight({ ...BASE_INPUT, zipPath }, ['curseforge'])
    expect(r2.checks.find((c) => c.id === 'artifact-curseforge')?.ok).toBe(true)
  })
})

describe('publishModpack 预检门接线（P0③）', () => {
  const AUTH = {
    modrinth: { token: 'mrp_tok', projectId: 'my-pack' },
    curseforge: { token: 'cf_tok', projectId: '123456' }
  }

  it('预检不过 → 不触碰网络，全部勾选平台返回预检错误', async () => {
    const results = await publishModpack(
      { ...BASE_INPUT, zipPath, changelog: '' },
      ['modrinth', 'curseforge'],
      AUTH
    )
    expect(results).toHaveLength(2)
    expect(results.every((r) => !r.ok)).toBe(true)
    expect(results[0]!.error).toContain('发布预检未通过')
    expect(results[0]!.error).toContain('更新日志')
    expect(vi.mocked(httpPostMultipart)).not.toHaveBeenCalled()
    expect(vi.mocked(httpGetJson)).not.toHaveBeenCalled()
  })

  it('CF 产物损坏 → MR 也不上传（fail fast，不留半成品发布状态）', async () => {
    const badCf = join(dir, 'pack-cf.zip')
    writeFileSync(badCf, Buffer.from('broken'))
    const results = await publishModpack(
      { ...BASE_INPUT, zipPath, cfZipPath: badCf },
      ['modrinth', 'curseforge'],
      AUTH
    )
    expect(results.every((r) => !r.ok)).toBe(true)
    expect(results[0]!.error).toContain('CurseForge 产物')
    expect(vi.mocked(httpPostMultipart)).not.toHaveBeenCalled()
  })

  it('预检通过 + 平台未配置 token → 维持部分失败语义（预检不管凭证）', async () => {
    vi.mocked(httpPostMultipart).mockResolvedValueOnce({ status: 200, data: { id: 'v1' } })
    const results = await publishModpack({ ...BASE_INPUT, zipPath }, ['modrinth', 'curseforge'], {
      modrinth: AUTH.modrinth
    })
    expect(results[0]).toMatchObject({ platform: 'modrinth', ok: true })
    expect(results[1]).toMatchObject({ platform: 'curseforge', ok: false })
    expect(results[1]!.error).toContain('设置 → 发布')
  })
})
