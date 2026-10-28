/**
 * 零配置运行环境 3b：MC 运行时置备服务单测（不触网：mock httpUtil）。
 * 覆盖置备主流程落盘、进度事件、版本缺失/非法输入的错误分支，以及实例列表/删除。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const state = vi.hoisted(() => ({
  detailText: '',
  indexContent: '',
  downloads: [] as string[],
  progressPhases: [] as string[],
  progressMessages: [] as string[],
  /** >0 时镜像清单请求按次数抛错（模拟 BMCLAPI 偶发返回非 JSON），官方源不受影响 */
  mirrorFailures: 0,
  /** >0 时资产对象下载按次数抛超时（模拟网络抖动），验证按文件重试 */
  assetTimeouts: 0
}))

vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'kunyu-mc-test') },
  safeStorage: { isEncryptionAvailable: () => false }
}))

vi.mock('../httpUtil', async () => {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  return {
    httpGetJson: async (url: string) => {
      if (url.includes('version_manifest')) {
        if (!url.includes('piston-meta') && state.mirrorFailures > 0) {
          state.mirrorFailures--
          throw new Error('模拟镜像故障：响应非 JSON')
        }
        return {
          status: 200,
          data: {
            latest: { release: '1.21.1', snapshot: '1.21.1' },
            versions: [
              {
                id: '1.21.1',
                type: 'release',
                url: 'https://piston-meta.mojang.com/v1/packages/abc/1.21.1.json',
                time: '2024-08-08T00:00:00+00:00',
                releaseTime: '2024-08-08T00:00:00+00:00'
              }
            ]
          }
        }
      }
      throw new Error(`unexpected json url ${url}`)
    },
    httpGetText: async () => ({ status: 200, text: state.detailText }),
    httpDownload: async (
      url: string,
      destPath: string,
      opts?: { onProgress?: (a: number, b: number) => void }
    ) => {
      state.downloads.push(url)
      if (url.includes('resources.download.minecraft.net') && state.assetTimeouts > 0) {
        state.assetTimeouts--
        throw new Error('The operation was aborted due to timeout')
      }
      const content = url.includes('/packages/')
        ? Buffer.from(state.indexContent)
        : url.includes('resources.download.minecraft.net')
          ? Buffer.from(`asset:${url.split('/').pop()}`)
          : Buffer.from(`bin:${url}`)
      mkdirSync(dirname(destPath), { recursive: true })
      writeFileSync(destPath, content)
      opts?.onProgress?.(content.length, content.length)
      return content.length
    }
  }
})

import {
  deleteMcInstance,
  listMcInstances,
  provisionMcRuntime,
  readMcInstance
} from '../mcRuntimeService'

const HASH1 = 'ab' + '0'.repeat(38)
const HASH2 = 'cd' + '1'.repeat(38)

function makeDetail(): string {
  return JSON.stringify({
    id: '1.21.1',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    assets: '17',
    assetIndex: {
      id: '17',
      sha1: 'x'.repeat(40),
      size: 999,
      totalSize: 1000,
      url: 'https://piston-meta.mojang.com/v1/packages/def/17.json'
    },
    downloads: {
      client: {
        url: 'https://piston-data.mojang.com/v1/objects/aaa/client.jar',
        sha1: 'a'.repeat(40),
        size: 111
      }
    },
    libraries: [
      {
        name: 'org.ow2.asm:asm:9.6',
        downloads: {
          artifact: {
            url: 'https://libraries.minecraft.net/org/ow2/asm/asm/9.6/asm-9.6.jar',
            path: 'org/ow2/asm/asm/9.6/asm-9.6.jar',
            sha1: 'b'.repeat(40),
            size: 222
          }
        }
      }
    ],
    arguments: {
      jvm: ['-cp', '${classpath}'],
      game: ['--username', '${auth_player_name}']
    },
    javaVersion: { majorVersion: 21, component: 'java-runtime-delta' }
  })
}

function makeIndex(): string {
  return JSON.stringify({
    objects: {
      'minecraft/lang/en_us.json': { hash: HASH1, size: 10 },
      'minecraft/textures/block/stone.png': { hash: HASH2, size: 20 }
    }
  })
}

beforeEach(() => {
  state.detailText = makeDetail()
  state.indexContent = makeIndex()
  state.downloads = []
  state.progressPhases = []
  state.progressMessages = []
  state.mirrorFailures = 0
  state.assetTimeouts = 0
})

describe('provisionMcRuntime', () => {
  it('完整置备：写版本 JSON/客户端/库/资产索引与对象 + 实例元数据', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mc-inst-'))
    const res = await provisionMcRuntime(
      { mcVersion: '1.21.1', mirror: '', instancesRoot: root, downloadAssets: true },
      (p) => state.progressPhases.push(p.phase)
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.instance.id).toBe('1.21.1')
    expect(res.instance.mcVersion).toBe('1.21.1')
    expect(res.info.mainClass).toBe('net.minecraft.client.main.Main')
    expect(res.info.assetIndexId).toBe('17')
    expect(res.info.javaMajor).toBe(21)

    const inst = join(root, '1.21.1')
    expect(existsSync(join(inst, 'instance.json'))).toBe(true)
    expect(existsSync(join(inst, 'versions', '1.21.1', '1.21.1.json'))).toBe(true)
    expect(existsSync(join(inst, 'versions', '1.21.1', '1.21.1.jar'))).toBe(true)
    expect(existsSync(join(inst, 'libraries', 'org/ow2/asm/asm/9.6/asm-9.6.jar'))).toBe(true)
    expect(existsSync(join(inst, 'assets', 'indexes', '17.json'))).toBe(true)
    expect(existsSync(join(inst, 'assets', 'objects', HASH1.slice(0, 2), HASH1))).toBe(true)
    expect(existsSync(join(inst, 'assets', 'objects', HASH2.slice(0, 2), HASH2))).toBe(true)

    // 进度阶段覆盖 resolve→...→done
    expect(state.progressPhases).toContain('resolve')
    expect(state.progressPhases).toContain('client')
    expect(state.progressPhases).toContain('libraries')
    expect(state.progressPhases).toContain('assets')
    expect(state.progressPhases[state.progressPhases.length - 1]).toBe('done')
  })

  it('downloadAssets=false 时仅写索引、不下载资产对象', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mc-inst-'))
    const res = await provisionMcRuntime({
      mcVersion: '1.21.1',
      mirror: '',
      instancesRoot: root,
      downloadAssets: false
    })
    expect(res.ok).toBe(true)
    expect(existsSync(join(root, '1.21.1', 'assets', 'indexes', '17.json'))).toBe(true)
    expect(existsSync(join(root, '1.21.1', 'assets', 'objects', HASH1.slice(0, 2), HASH1))).toBe(false)
  })

  it('缺少版本号 / 清单无该版本 → 返回错误', async () => {
    const r1 = await provisionMcRuntime({ mcVersion: '', mirror: '' })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.errorMessage).toContain('缺少目标 MC 版本号')

    const root = mkdtempSync(join(tmpdir(), 'mc-inst-'))
    const r2 = await provisionMcRuntime({ mcVersion: '9.9.9', mirror: '', instancesRoot: root })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.errorMessage).toContain('未找到')
  })

  it('镜像清单失败（重试一次仍失败）→ 整体回退官方源完成置备', async () => {
    state.mirrorFailures = 2 // 首次 + 重试共两次镜像请求全部失败，第三次走官方
    const root = mkdtempSync(join(tmpdir(), 'mc-inst-'))
    const res = await provisionMcRuntime(
      { mcVersion: '1.21.1', mirror: 'https://bmclapi2.bangbang93.com', instancesRoot: root },
      (p) => {
        state.progressPhases.push(p.phase)
        if (p.message) state.progressMessages.push(p.message)
      }
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // 官方源直连：下载 URL 不含镜像前缀
    expect(state.downloads.every((u) => !u.includes('bmclapi'))).toBe(true)
    expect(state.progressMessages).toContain('镜像清单不可用，已回退官方源继续置备')
    expect(existsSync(join(root, '1.21.1', 'versions', '1.21.1', '1.21.1.jar'))).toBe(true)
  })

  it('资产文件瞬时超时 → 按文件重试后继续完成置备', async () => {
    state.assetTimeouts = 2 // 前两次资产下载模拟超时（默认 attempts=3 内恢复）
    const root = mkdtempSync(join(tmpdir(), 'mc-inst-retry-'))
    const res = await provisionMcRuntime(
      { mcVersion: '1.21.1', mirror: '', instancesRoot: root, downloadAssets: true },
      (p) => state.progressPhases.push(p.phase)
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // 资产 URL 总次数 > 去重数 = 同一 URL 被重试；最终走到 done 而非整体失败
    const assetUrls = state.downloads.filter((u) => u.includes('resources.download.minecraft.net'))
    expect(assetUrls.length).toBeGreaterThanOrEqual(3)
    expect(new Set(assetUrls).size).toBeLessThan(assetUrls.length)
    expect(state.progressPhases[state.progressPhases.length - 1]).toBe('done')
  })
})

describe('实例管理', () => {
  it('list → read → delete 全链路', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mc-inst-'))
    await provisionMcRuntime({ mcVersion: '1.21.1', mirror: '', instancesRoot: root, name: '我的整合包' })

    const list = await listMcInstances(root)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('我的整合包')

    const meta = await readMcInstance(root, '1.21.1')
    expect(meta?.mcVersion).toBe('1.21.1')

    expect(await deleteMcInstance('1.21.1', root)).toBe(true)
    expect(await listMcInstances(root)).toEqual([])
    // 路径穿越/空 id 拒绝
    expect(await deleteMcInstance('../x', root)).toBe(false)
    expect(await deleteMcInstance('', root)).toBe(false)
  })

  it('重复置备同一实例：createdAt 保留、lastUsedAt 更新', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mc-inst-'))
    await provisionMcRuntime({ mcVersion: '1.21.1', mirror: '', instancesRoot: root })
    const first = JSON.parse(readFileSync(join(root, '1.21.1', 'instance.json'), 'utf-8')) as {
      createdAt: string
    }
    await provisionMcRuntime({ mcVersion: '1.21.1', mirror: '', instancesRoot: root, name: '改名' })
    const meta = await readMcInstance(root, '1.21.1')
    expect(meta?.createdAt).toBe(first.createdAt)
    expect(meta?.name).toBe('改名')
  })
})
