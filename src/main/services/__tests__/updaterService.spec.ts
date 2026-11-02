/**
 * updaterService 纯函数单测：feed 构造。
 * 主源固定 GitHub kunyu7696/KunYuStudio；镜像前缀按 ghproxy 风格拼到
 * releases/latest/download 稳定路径前（generic provider 的 `${url}/latest.yml` 恰好命中）。
 */
import { describe, expect, it, vi } from 'vitest'

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

import { buildGithubFeed, buildMirrorFeed, getUpdateState } from '../updaterService'

describe('buildGithubFeed', () => {
  it('主源固定为 kunyu7696/KunYuStudio', () => {
    expect(buildGithubFeed()).toEqual({
      provider: 'github',
      owner: 'kunyu7696',
      repo: 'KunYuStudio'
    })
  })
})

describe('buildMirrorFeed', () => {
  it('ghproxy 风格前缀拼接到 releases/latest/download 稳定路径', () => {
    expect(buildMirrorFeed('https://ghproxy.net')).toEqual({
      provider: 'generic',
      url: 'https://ghproxy.net/https://github.com/kunyu7696/KunYuStudio/releases/latest/download'
    })
  })

  it('前缀末尾斜杠归一，避免双斜杠', () => {
    expect(buildMirrorFeed('https://ghproxy.net/')).toEqual({
      provider: 'generic',
      url: 'https://ghproxy.net/https://github.com/kunyu7696/KunYuStudio/releases/latest/download'
    })
  })

  it('空白前缀（用户禁用镜像）返回 null', () => {
    expect(buildMirrorFeed('')).toBeNull()
    expect(buildMirrorFeed('   ')).toBeNull()
  })
})

describe('manualDownloadOnly（macOS 未签名仅检测）', () => {
  // darwin 上 true（UI 引导浏览器下载 dmg），其余平台 false
  it('与 process.platform 联动', () => {
    expect(getUpdateState().manualDownloadOnly).toBe(process.platform === 'darwin')
  })
})
