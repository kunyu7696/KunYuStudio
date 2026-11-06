/**
 * updaterService 纯函数单测：镜像前缀校验、镜像地址拼接、安装包自检。
 * 信任模型：latest.yml 只从 GitHub 读；镜像只承载安装包；sha512 来自可信清单。
 */
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getVersion: () => '0.1.4', isPackaged: true },
  BrowserWindow: class {}
}))
// updaterService 走 default 导入（CJS 包 + ESM 主进程的具名导入互操作问题），
// 工厂需同时提供 default 与具名键，兼容两种消费方式
vi.mock('electron-updater', () => {
  const autoUpdater = { on: vi.fn(), setFeedURL: vi.fn() }
  return { default: { autoUpdater }, autoUpdater }
})
vi.mock('builder-util-runtime', () => ({
  CancellationToken: class {
    cancel(): void {}
  }
}))
vi.mock('../settingsService', () => ({
  getSection: vi.fn(() => ({ updateAutoCheck: true, updateMirrorPrefix: 'https://ghproxy.net' }))
}))

import {
  buildGithubFeed,
  buildMirrorInstallerBase,
  MIN_INSTALLER_BYTES,
  normalizeMirrorPrefix,
  verifyInstallerFile,
  getUpdateState
} from '../updaterService'

describe('buildGithubFeed', () => {
  it('主源固定为 kunyu7696/KunYuStudio', () => {
    expect(buildGithubFeed()).toEqual({
      provider: 'github',
      owner: 'kunyu7696',
      repo: 'KunYuStudio'
    })
  })
})

describe('normalizeMirrorPrefix', () => {
  it('https 前缀通过并归一化末尾斜杠', () => {
    expect(normalizeMirrorPrefix('https://ghproxy.net')).toBe('https://ghproxy.net')
    expect(normalizeMirrorPrefix('  https://ghproxy.net///  ')).toBe('https://ghproxy.net')
  })

  it('拒绝非 https 协议', () => {
    expect(normalizeMirrorPrefix('http://ghproxy.net')).toBeNull()
    expect(normalizeMirrorPrefix('file:///tmp/proxy')).toBeNull()
  })

  it('拒绝含 ? # @ 的前缀（可截断/改写拼接出的下载地址或夹带凭证）', () => {
    expect(normalizeMirrorPrefix('https://ghproxy.net?foo=1')).toBeNull()
    expect(normalizeMirrorPrefix('https://ghproxy.net/#frag')).toBeNull()
    expect(normalizeMirrorPrefix('https://user:pass@ghproxy.net')).toBeNull()
  })

  it('空白或非法 URL 返回 null（用户禁用镜像）', () => {
    expect(normalizeMirrorPrefix('')).toBeNull()
    expect(normalizeMirrorPrefix('   ')).toBeNull()
    expect(normalizeMirrorPrefix('not-a-url')).toBeNull()
  })
})

describe('buildMirrorInstallerBase', () => {
  it('前缀 + 固定版本号拼到 releases/download/v<version>', () => {
    expect(buildMirrorInstallerBase('https://ghproxy.net/', '0.1.8')).toBe(
      'https://ghproxy.net/https://github.com/kunyu7696/KunYuStudio/releases/download/v0.1.8'
    )
  })

  it('前缀非法或版本号含路径分隔符时返回 null', () => {
    expect(buildMirrorInstallerBase('http://ghproxy.net', '0.1.8')).toBeNull()
    expect(buildMirrorInstallerBase('https://ghproxy.net', '../0.1.8')).toBeNull()
    expect(buildMirrorInstallerBase('', '0.1.8')).toBeNull()
  })
})

describe('安装包自检', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'kunyu-update-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('体积下限常量为 10 MB', () => {
    expect(MIN_INSTALLER_BYTES).toBe(10 * 1024 * 1024)
  })

  it('sha512 一致且体积达标时通过', async () => {
    const bytes = Buffer.from('kunyu-installer-bytes')
    const file = join(dir, 'ok.exe')
    await writeFile(file, bytes)
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    await expect(verifyInstallerFile(file, sha512, bytes.length)).resolves.toBeUndefined()
  })

  it('低于体积下限时拒绝（即便 sha512 匹配）', async () => {
    const bytes = Buffer.from('too-small')
    const file = join(dir, 'small.exe')
    await writeFile(file, bytes)
    const sha512 = createHash('sha512').update(bytes).digest('base64')
    await expect(verifyInstallerFile(file, sha512, bytes.length + 1)).rejects.toThrow(/体积异常/)
  })

  it('sha512 不一致时拒绝（镜像篡改安装包）', async () => {
    const file = join(dir, 'tampered.exe')
    await writeFile(file, 'tampered-payload')
    const trusted = createHash('sha512').update('trusted-payload').digest('base64')
    await expect(verifyInstallerFile(file, trusted, 1)).rejects.toThrow(/sha512/)
  })

  it('可信清单缺少 sha512 时拒绝', async () => {
    const file = join(dir, 'no-sha.exe')
    await writeFile(file, 'payload')
    await expect(verifyInstallerFile(file, null, 1)).rejects.toThrow(/缺少 sha512/)
  })
})

describe('manualDownloadOnly（macOS 未签名仅检测）', () => {
  // darwin 上 true（UI 引导浏览器下载 dmg），其余平台 false
  it('与 process.platform 联动', () => {
    expect(getUpdateState().manualDownloadOnly).toBe(process.platform === 'darwin')
  })
})
