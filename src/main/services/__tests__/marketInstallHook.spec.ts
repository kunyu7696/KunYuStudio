/**
 * TR-17.1：market install 成功后自动静态分析入榜。
 * - hook 收到全部已安装文件，结果 analyzed 回传
 * - hook 抛错不阻断安装（ok 仍为 true，仅告警）
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../httpUtil', () => ({
  httpGetJson: vi.fn(),
  httpDownload: vi.fn()
}))

import { httpDownload, httpGetJson } from '../httpUtil'
import { installMod } from '../marketService'

function zipBuffer(): Buffer {
  // 最小合法 store-only zip（与 marketService.spec 一致）
  const name = Buffer.from('x.txt', 'utf8')
  const data = Buffer.from('hi')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(name.length, 28)
  central.writeUInt32LE(data.length, 20)
  central.writeUInt32LE(data.length, 24)
  central.writeUInt32LE(0, 42)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(46 + name.length, 12)
  eocd.writeUInt32LE(30 + name.length + data.length, 16)
  return Buffer.concat([local, name, data, central, name, eocd])
}

function mockDetail(): void {
  vi.mocked(httpGetJson)
    .mockResolvedValueOnce({
      status: 200,
      data: {
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
    })
    .mockResolvedValueOnce({
      status: 200,
      data: [
        {
          id: 'v1',
          name: '0.5',
          version_number: '0.5.0',
          date_published: '',
          loaders: ['fabric'],
          game_versions: ['1.20.1'],
          dependencies: [],
          files: [
            {
              url: 'https://cdn/new.jar',
              filename: 'sodium-0.5.0.jar',
              size: 200,
              primary: true
            }
          ]
        }
      ]
    })
}

describe('installMod 安装钩子', () => {
  it('安装成功后 hook 被调用并回传 analyzed', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'kunyu-hook-'))
    const projectPath = join(tmp, 'proj')
    mockDetail()
    vi.mocked(httpDownload).mockImplementation(async (_url, dest) => {
      await writeFile(dest, zipBuffer())
      return zipBuffer().length
    })

    const hookCalls: string[] = []
    const hook = (files: string[], loader: string): { analyzed: number; warnings: string[] } => {
      hookCalls.push(loader, files[0] ?? '')
      return { analyzed: 1, warnings: [] }
    }
    const result = await installMod(
      {
        platform: 'modrinth',
        modId: 'AANobbMI',
        versionId: 'v1',
        projectPath,
        includeDependencies: false,
        loader: 'fabric',
        mcVersion: '1.20.1'
      },
      '',
      hook
    )

    expect(result.ok).toBe(true)
    expect(hookCalls).toContain('fabric')
    expect(result.analyzed).toBe(1)
    expect(result.analysisWarnings).toEqual([])
  })

  it('hook 抛错不阻断安装，仅告警', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'kunyu-hook2-'))
    const projectPath = join(tmp, 'proj')
    mockDetail()
    vi.mocked(httpDownload).mockImplementation(async (_url, dest) => {
      await writeFile(dest, zipBuffer())
      return zipBuffer().length
    })

    const hook = vi.fn(() => {
      throw new Error('javap crashed')
    })
    const result = await installMod(
      {
        platform: 'modrinth',
        modId: 'AANobbMI',
        versionId: 'v1',
        projectPath,
        includeDependencies: false,
        loader: 'fabric',
        mcVersion: '1.20.1'
      },
      '',
      hook
    )

    expect(result.ok).toBe(true)
    expect(result.analysisWarnings).toEqual(['javap crashed'])
  })
})
