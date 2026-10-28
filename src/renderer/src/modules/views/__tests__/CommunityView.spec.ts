/**
 * CommunityView 视图测试（#20 自验证）。
 * 核心契约：常驻「外部社区入口」诚实标注——本页只是第三方站点内嵌浏览入口，
 * 非应用内社区；另覆盖平台 tab 数量与中文化按钮的站点显隐。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import CommunityView from '../CommunityView.vue'

const openExternalMock = vi.fn()
const toZhMock = vi.fn()

function stubApi(): void {
  ;(window as unknown as { api: unknown }).api = {
    shell: { openExternal: openExternalMock },
    translate: { toZh: toZhMock }
  }
}

function mountView() {
  return mount(CommunityView, { global: { plugins: [ElementPlus] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  localStorage.clear()
  stubApi()
})

describe('外部社区入口诚实标注', () => {
  it('工具条常驻「外部社区入口」标注', () => {
    const w = mountView()
    const tag = w.find('.cv-ext-tag')
    expect(tag.exists()).toBe(true)
    expect(tag.text()).toBe('外部社区入口')
  })
})

describe('平台与工具条', () => {
  it('渲染 10 个外部平台 tab 与内嵌 webview 舞台', () => {
    const w = mountView()
    expect(w.findAll('.el-tabs__item')).toHaveLength(10)
    expect(w.find('webview.cv-webview').exists()).toBe(true)
  })

  it('平台清单含 LittleSkin / NameMC / BBSMC / SodaMC / MineBBS，不含 Planet Minecraft', () => {
    const w = mountView()
    const labels = w.findAll('.el-tabs__item').map((t) => t.text())
    expect(labels.join('|')).toContain('LittleSkin')
    expect(labels.join('|')).toContain('NameMC')
    expect(labels.join('|')).toContain('BBSMC')
    expect(labels.join('|')).toContain('SodaMC')
    expect(labels.join('|')).toContain('MineBBS')
    expect(labels.join('|')).not.toContain('Planet Minecraft')
  })

  it('默认 MC百科（中文站点）不显示页内中文化按钮', () => {
    const w = mountView()
    const btns = w.findAll('.cv-actions button').map((b) => b.text())
    expect(btns.join('|')).not.toContain('中文化')
  })

  it('在系统浏览器打开按钮走 shell.openExternal', async () => {
    const w = mountView()
    const openBtn = w
      .findAll('.cv-actions button')
      .find((b) => b.attributes('title')?.includes('系统浏览器'))
    expect(openBtn).toBeTruthy()
    await openBtn!.trigger('click')
    expect(openExternalMock).toHaveBeenCalledTimes(1)
    expect(String(openExternalMock.mock.calls[0]?.[0])).toMatch(/^https:\/\//)
  })
})

describe('人机验证：应用不代过、不阻断，由开发者在页内自助完成', () => {
  it('挑战页标题出现时仅显示非阻断提示条，webview 保持可交互', async () => {
    const w = mountView()
    const wv = w.find('webview.cv-webview')
    await wv.trigger('page-title-updated', { title: 'Just a moment...' })
    const tip = w.find('.cv-challenge-tip')
    expect(tip.exists()).toBe(true)
    expect(tip.text()).toContain('人机验证')
    // 非阻断：不出现全屏遮罩，webview 仍在
    expect(w.find('.cv-overlay').exists()).toBe(false)
    expect(w.find('webview.cv-webview').exists()).toBe(true)
  })

  it('提示条提供「系统浏览器打开」兜底与手动关闭', async () => {
    const w = mountView()
    const wv = w.find('webview.cv-webview')
    await wv.trigger('page-title-updated', { title: 'Attention Required! | Cloudflare' })
    const btns = w.find('.cv-challenge-tip').findAll('button')
    const openBtn = btns.find((b) => b.text().includes('系统浏览器'))
    const dismissBtn = btns.find((b) => b.text().includes('知道了'))
    expect(openBtn).toBeTruthy()
    expect(dismissBtn).toBeTruthy()
    await openBtn!.trigger('click')
    expect(openExternalMock).toHaveBeenCalledTimes(1)
    await dismissBtn!.trigger('click')
    expect(w.find('.cv-challenge-tip').exists()).toBe(false)
  })

  it('验证通过标题恢复正常后提示条自动消失', async () => {
    const w = mountView()
    const wv = w.find('webview.cv-webview')
    await wv.trigger('page-title-updated', { title: 'Just a moment...' })
    expect(w.find('.cv-challenge-tip').exists()).toBe(true)
    await wv.trigger('page-title-updated', { title: 'BBSMC - 我的世界资源社区' })
    expect(w.find('.cv-challenge-tip').exists()).toBe(false)
  })

  it('空标题不误撤提示（挑战页重载间隙的标题空窗）', async () => {
    const w = mountView()
    const wv = w.find('webview.cv-webview')
    await wv.trigger('page-title-updated', { title: 'Just a moment...' })
    await wv.trigger('page-title-updated', { title: '' })
    expect(w.find('.cv-challenge-tip').exists()).toBe(true)
  })

  it('挑战 45 秒未通过 → 信誉保护：写入 24h 冷却、挑战页被导航走、冷却占位接管', async () => {
    vi.useFakeTimers()
    try {
      const w = mountView()
      const wv = w.find('webview.cv-webview')
      await wv.trigger('did-stop-loading')
      await wv.trigger('page-title-updated', { title: 'Just a moment...' })
      expect(w.find('.cv-challenge-tip').exists()).toBe(true)
      await vi.advanceTimersByTimeAsync(45_000)
      // 提示条撤下，冷却占位接管（不再让 Turnstile 自动重试刷失败挑战）
      expect(w.find('.cv-challenge-tip').exists()).toBe(false)
      const overlay = w.find('.cv-overlay-error')
      expect(overlay.exists()).toBe(true)
      expect(overlay.text()).toContain('连续未通过')
      expect(overlay.text()).toContain('指纹')
      expect(overlay.text()).toContain('系统浏览器')
      // 该站 host 已写入 24h 冷却（viewUrl 默认 MC百科首页）
      const all = JSON.parse(localStorage.getItem('ky-community-challenge-cooldown') ?? '{}')
      expect(all['www.mcmod.cn']).toBeGreaterThan(Date.now())
    } finally {
      vi.useRealTimers()
    }
  })

  it('冷却占位下点「仍要尝试」：清除冷却并放行重新导航', async () => {
    vi.useFakeTimers()
    try {
      const w = mountView()
      const wv = w.find('webview.cv-webview')
      await wv.trigger('did-stop-loading')
      await wv.trigger('page-title-updated', { title: 'Just a moment...' })
      await vi.advanceTimersByTimeAsync(45_000)
      expect(w.find('.cv-overlay-error').exists()).toBe(true)
      const retryBtn = w
        .find('.cv-cooldown-actions')
        .findAll('button')
        .find((b) => b.text().includes('仍要尝试'))
      expect(retryBtn).toBeTruthy()
      await retryBtn!.trigger('click')
      const all = JSON.parse(localStorage.getItem('ky-community-challenge-cooldown') ?? '{}')
      expect(all['www.mcmod.cn']).toBeUndefined()
      // 占位撤下，恢复常规加载视图
      expect(w.find('.cv-overlay-error').exists()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('挑战信誉保护冷却（防反复刷挑战打穿指纹信誉）', () => {
  it('冷却期内导航到该站不再加载挑战页，直接展示冷却占位', async () => {
    localStorage.setItem(
      'ky-community-challenge-cooldown',
      JSON.stringify({ 'klpbbs.com': Date.now() + 3_600_000 })
    )
    const w = mountView()
    const before = w.find('webview.cv-webview').attributes('src')
    await w.findAll('.el-tabs__item')[1].trigger('click')
    expect(w.find('webview.cv-webview').attributes('src')).toBe(before)
    const overlay = w.find('.cv-overlay-error')
    expect(overlay.exists()).toBe(true)
    expect(overlay.text()).toContain('klpbbs.com')
    expect(overlay.text()).toContain('连续未通过')
  })

  it('挑战通过标题恢复正常 → 解除该站冷却', async () => {
    localStorage.setItem(
      'ky-community-challenge-cooldown',
      JSON.stringify({ 'www.mcmod.cn': Date.now() + 3_600_000 })
    )
    const w = mountView()
    const wv = w.find('webview.cv-webview')
    await wv.trigger('page-title-updated', { title: 'Just a moment...' })
    await wv.trigger('page-title-updated', { title: 'MC百科 - 我的世界中文论坛' })
    const all = JSON.parse(localStorage.getItem('ky-community-challenge-cooldown') ?? '{}')
    expect(all['www.mcmod.cn']).toBeUndefined()
  })
})

describe('Cloudflare 挑战 URL 不回写 :src（防强制重载死循环）', () => {
  it('did-navigate 带 __cf_chl_ 参数时不回写 src，落到干净地址后正常回写', async () => {
    const w = mountView()
    const before = w.find('webview.cv-webview').attributes('src')
    const wv = w.find('webview.cv-webview')
    await wv.trigger('did-navigate', {
      url: 'https://www.planetminecraft.com/?__cf_chl_rt_tk=expired-token'
    })
    expect(w.find('webview.cv-webview').attributes('src')).toBe(before)
    await wv.trigger('did-navigate', { url: 'https://www.planetminecraft.com/mods/' })
    expect(w.find('webview.cv-webview').attributes('src')).toBe(
      'https://www.planetminecraft.com/mods/'
    )
  })

  it('did-navigate-in-page 挑战 tk replaceState 不回写 src，普通页内导航仍回写', async () => {
    const w = mountView()
    const before = w.find('webview.cv-webview').attributes('src')
    const wv = w.find('webview.cv-webview')
    await wv.trigger('did-navigate-in-page', {
      url: 'https://www.planetminecraft.com/?__cf_chl_rt_tk=another-token'
    })
    expect(w.find('webview.cv-webview').attributes('src')).toBe(before)
    await wv.trigger('did-navigate-in-page', { url: 'https://www.mcmod.cn/class/1.html' })
    expect(w.find('webview.cv-webview').attributes('src')).toBe('https://www.mcmod.cn/class/1.html')
  })
})
