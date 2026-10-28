/**
 * SettingsView 视图测试。
 * 分类状态由 ui store 持有（支持深链定位）——验证 nav 渲染、分类切换与返回按钮。
 * 8 个设置面板以 stub 替换，仅测视图自身的编排逻辑。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SettingsView from '../SettingsView.vue'
import { useUiStore } from '../../../stores/ui'
import { registerBuiltinModules } from '../../../modules'

vi.mock('../../../components/settings/GeneralSettingsPane.vue', () => ({
  default: { name: 'GeneralSettingsPane', template: '<div class="pane-stub" data-pane="general" />' }
}))
vi.mock('../../../components/settings/EditorSettingsPane.vue', () => ({
  default: { name: 'EditorSettingsPane', template: '<div class="pane-stub" data-pane="editor" />' }
}))
vi.mock('../../../components/settings/RuntimeSettingsPane.vue', () => ({
  default: { name: 'RuntimeSettingsPane', template: '<div class="pane-stub" data-pane="runtime" />' }
}))
vi.mock('../../../components/settings/AiSettingsPane.vue', () => ({
  default: { name: 'AiSettingsPane', template: '<div class="pane-stub" data-pane="ai" />' }
}))
vi.mock('../../../components/settings/NetworkSettingsPane.vue', () => ({
  default: { name: 'NetworkSettingsPane', template: '<div class="pane-stub" data-pane="network" />' }
}))
vi.mock('../../../components/settings/MarketplaceSettingsPane.vue', () => ({
  default: { name: 'MarketplaceSettingsPane', template: '<div class="pane-stub" data-pane="marketplace" />' }
}))
vi.mock('../../../components/settings/IntegrationPane.vue', () => ({
  default: { name: 'IntegrationPane', template: '<div class="pane-stub" data-pane="integration" />' }
}))
vi.mock('../../../components/settings/PublishSettingsPane.vue', () => ({
  default: { name: 'PublishSettingsPane', template: '<div class="pane-stub" data-pane="publish" />' }
}))

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  try {
    registerBuiltinModules()
  } catch { /* 已注册 */ }
})

function mountView() {
  return mount(SettingsView, { global: { plugins: [ElementPlus] } })
}

describe('分类导航', () => {
  it('渲染标题与 8 个分类项，默认显示通用面板', () => {
    const w = mountView()
    expect(w.find('.sv-title').text()).toBe('设置')
    expect(w.findAll('.sv-nav-item')).toHaveLength(8)
    expect(w.find('.pane-stub').attributes('data-pane')).toBe('general')
  })

  it('点击分类切换面板并同步 ui store', async () => {
    const w = mountView()
    const ui = useUiStore()
    const aiItem = w.findAll('.sv-nav-item').find((i) => i.text() === 'AI 助手')
    expect(aiItem).toBeTruthy()
    await aiItem!.trigger('click')
    expect(ui.settingsCategory).toBe('ai')
    expect(w.find('.pane-stub').attributes('data-pane')).toBe('ai')
    expect(aiItem!.classes()).toContain('active')
  })
})

describe('返回按钮', () => {
  it('无来源记录时不渲染返回按钮', () => {
    const w = mountView()
    expect(w.find('.sv-back').exists()).toBe(false)
  })

  it('有来源记录时渲染，点击返回上一模块并清除记录', async () => {
    const ui = useUiStore()
    ui.activeModuleId = 'market'
    ui.settingsReturnTo = 'market'
    const w = mountView()
    expect(w.find('.sv-back').exists()).toBe(true)
    await w.find('.sv-back').trigger('click')
    expect(ui.settingsReturnTo).toBeNull()
    expect(ui.activeModuleId).toBe('market')
  })
})
