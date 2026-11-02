/**
 * GeneralSettingsPane 面板测试。
 * 「应用更新」区：显示当前版本号；检查/下载/安装走 preload 的 update 桥；
 * 状态行随主进程推送的 UpdateState 切换（available/downloading/downloaded/error）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import type { UpdateState } from '../../../../../shared/types/update'
import GeneralSettingsPane from '../GeneralSettingsPane.vue'

/** window.api 打桩：面板经 preload 白名单桥读版本号与更新状态 */
interface ApiMock {
  app: {
    getVersion: ReturnType<typeof vi.fn>
  }
  update: {
    getState: ReturnType<typeof vi.fn>
    check: ReturnType<typeof vi.fn>
    download: ReturnType<typeof vi.fn>
    install: ReturnType<typeof vi.fn>
    onStateChanged: ReturnType<typeof vi.fn>
  }
  shell: {
    openExternal: ReturnType<typeof vi.fn>
  }
  settings: {
    getAll: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
  }
}
let api: ApiMock
/** 捕获面板注册的状态推送回调，测试中手动推状态 */
let stateListener: ((s: UpdateState) => void) | null = null

const idleState: UpdateState = { phase: 'idle', currentVersion: '0.1.2' }

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  stateListener = null
  api = {
    app: { getVersion: vi.fn().mockResolvedValue('0.1.2') },
    update: {
      getState: vi.fn().mockResolvedValue({ ...idleState }),
      check: vi.fn().mockResolvedValue({ ...idleState, phase: 'checking' }),
      download: vi.fn().mockResolvedValue({ ...idleState, phase: 'downloading', percent: 0 }),
      install: vi.fn().mockResolvedValue(undefined),
      onStateChanged: vi.fn((cb: (s: UpdateState) => void) => {
        stateListener = cb
        return () => {
          stateListener = null
        }
      })
    },
    shell: { openExternal: vi.fn().mockResolvedValue(true) },
    settings: { getAll: vi.fn(), set: vi.fn() }
  }
  ;(window as unknown as { api: ApiMock }).api = api
})

function mountPane() {
  return mount(GeneralSettingsPane, { global: { plugins: [ElementPlus] } })
}

describe('应用更新', () => {
  it('显示当前版本号', async () => {
    const w = mountPane()
    await flushPromises()
    const row = w.find('[data-setting-id="general-app-update"]')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('v0.1.2')
  })

  it('进入面板拉取状态快照并订阅推送；点击「检查更新」走 update.check', async () => {
    const w = mountPane()
    await flushPromises()
    expect(api.update.getState).toHaveBeenCalledTimes(1)
    expect(api.update.onStateChanged).toHaveBeenCalledTimes(1)
    const btn = w.findAll('button').find((b) => b.text() === '检查更新')
    expect(btn).toBeTruthy()
    await btn!.trigger('click')
    expect(api.update.check).toHaveBeenCalledTimes(1)
  })

  it('推送 available → 出现「下载更新」，点击走 update.download', async () => {
    const w = mountPane()
    await flushPromises()
    stateListener!({ phase: 'available', currentVersion: '0.1.2', latestVersion: '0.1.5' })
    await flushPromises()
    const row = w.find('[data-setting-id="general-update-available"]')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('v0.1.5')
    const btn = row.findAll('button').find((b) => b.text() === '下载更新')
    await btn!.trigger('click')
    expect(api.update.download).toHaveBeenCalledTimes(1)
  })

  it('推送 downloaded → 出现「重启安装」，点击走 update.install', async () => {
    const w = mountPane()
    await flushPromises()
    stateListener!({ phase: 'downloaded', currentVersion: '0.1.2', latestVersion: '0.1.5', percent: 100 })
    await flushPromises()
    const row = w.find('[data-setting-id="general-update-downloaded"]')
    expect(row.exists()).toBe(true)
    const btn = row.findAll('button').find((b) => b.text() === '重启安装')
    await btn!.trigger('click')
    expect(api.update.install).toHaveBeenCalledTimes(1)
  })

  it('推送 error → 显示错误与「浏览器打开发布页」兜底', async () => {
    const w = mountPane()
    await flushPromises()
    stateListener!({
      phase: 'error',
      currentVersion: '0.1.2',
      error: 'net::ERR_CONNECTION_TIMED_OUT',
      releasePageUrl: 'https://github.com/kunyu7696/KunYuStudio/releases'
    })
    await flushPromises()
    const row = w.find('[data-setting-id="general-update-error"]')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('ERR_CONNECTION_TIMED_OUT')
    const openBtn = row.findAll('button').find((b) => b.text().includes('浏览器打开'))
    await openBtn!.trigger('click')
    expect(api.shell.openExternal).toHaveBeenCalledTimes(1)
    expect(String(api.shell.openExternal.mock.calls[0]?.[0])).toContain('KunYuStudio/releases')
  })

  it('镜像兜底生效时显示「镜像通道」标记', async () => {
    const w = mountPane()
    await flushPromises()
    stateListener!({ phase: 'downloading', currentVersion: '0.1.2', latestVersion: '0.1.5', percent: 42, viaMirror: true })
    await flushPromises()
    expect(w.find('[data-setting-id="general-app-update"]').text()).toContain('镜像通道')
    expect(w.find('[data-setting-id="general-update-downloading"]').exists()).toBe(true)
  })

  it('卸载时退订状态推送', async () => {
    const w = mountPane()
    await flushPromises()
    w.unmount()
    expect(stateListener).toBeNull()
  })
})
