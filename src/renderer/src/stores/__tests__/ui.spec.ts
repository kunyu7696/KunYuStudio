/**
 * UI 状态 store 组件级测试。
 * 覆盖模块切换/设置页深链返回/AI 面板宽度夹取/持久化键读写。
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUiStore } from '../ui'
import { registerBuiltinModules } from '../../modules'

beforeAll(() => {
  // 应用入口在启动时注册；store 测试需手动触发一次（重复注册会抛错，跳过）
  try {
    registerBuiltinModules()
  } catch { /* 已注册 */ }
})

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('模块持久化', () => {
  it('无记录时回落 project-manager', () => {
    expect(useUiStore().activeModuleId).toBe('project-manager')
  })

  it('持久化了非法模块 id 时回落默认', () => {
    localStorage.setItem('kunyu:active-module', 'no-such-module')
    expect(useUiStore().activeModuleId).toBe('project-manager')
  })

  it('setActiveModule 切换并持久化；同 id 重复激活 no-op', () => {
    const ui = useUiStore()
    ui.setActiveModule('market')
    expect(ui.activeModuleId).toBe('market')
    expect(localStorage.getItem('kunyu:active-module')).toBe('market')
    const before = ui.activeModuleId
    ui.setActiveModule('market')
    expect(ui.activeModuleId).toBe(before)
  })

  it('setActiveModule 对不存在的模块 no-op', () => {
    const ui = useUiStore()
    ui.setActiveModule('no-such-module')
    expect(ui.activeModuleId).toBe('project-manager')
  })
})

describe('设置页深链', () => {
  it('rememberForSettings 记录来源模块，backFromSettings 返回并清空', () => {
    const ui = useUiStore()
    ui.setActiveModule('market')
    ui.setActiveModule('settings', { rememberForSettings: true })
    expect(ui.settingsCategory).toBe('general')
    expect(ui.settingsReturnTo).toBe('market')
    ui.setSettingsCategory('ai')
    expect(ui.settingsCategory).toBe('ai')
    ui.backFromSettings()
    expect(ui.activeModuleId).toBe('market')
    expect(ui.settingsReturnTo).toBeNull()
  })

  it('无来源记录时 backFromSettings 回落 project-manager', () => {
    const ui = useUiStore()
    ui.setActiveModule('settings')
    ui.backFromSettings()
    expect(ui.activeModuleId).toBe('project-manager')
  })
})

describe('面板开关与宽度', () => {
  it('AI 面板宽度夹取到 [280, 560] 并持久化', () => {
    const ui = useUiStore()
    ui.setAiPanelWidth(100)
    expect(ui.aiPanelWidth).toBe(280)
    ui.setAiPanelWidth(9999)
    expect(ui.aiPanelWidth).toBe(560)
    ui.setAiPanelWidth(400.6)
    expect(ui.aiPanelWidth).toBe(401)
    expect(localStorage.getItem('kunyu:ai-panel-width')).toBe('401')
  })

  it('AI 助手面板不常驻：默认收起，show/hide/toggle 显隐且不持久化', () => {
    const ui = useUiStore()
    // 不常驻：初始为收起，且不读 localStorage 的旧状态
    expect(ui.aiPanelVisible).toBe(false)
    localStorage.setItem('kunyu:ai-panel-visible', '1')
    expect(useUiStore().aiPanelVisible).toBe(false)

    ui.showAiPanel()
    expect(ui.aiPanelVisible).toBe(true)
    ui.hideAiPanel()
    expect(ui.aiPanelVisible).toBe(false)
    ui.toggleAiPanel()
    expect(ui.aiPanelVisible).toBe(true)
  })

  it('toggleModLibrary 开关并持久化', () => {
    const ui = useUiStore()
    const v = ui.modLibraryVisible
    ui.toggleModLibrary()
    expect(ui.modLibraryVisible).toBe(!v)
    expect(localStorage.getItem('kunyu:mod-library-visible')).toBe(
      ui.modLibraryVisible ? '1' : '0'
    )
  })

  it('持久化了越界 AI 面板宽度时回落默认 400', () => {
    localStorage.setItem('kunyu:ai-panel-width', '100')
    expect(useUiStore().aiPanelWidth).toBe(400)
  })
})

describe('浮层状态', () => {
  it('向导/命令面板开关', () => {
    const ui = useUiStore()
    ui.openWizard()
    expect(ui.wizardOpen).toBe(true)
    ui.closeWizard()
    expect(ui.wizardOpen).toBe(false)
    ui.toggleCommandPalette()
    expect(ui.commandPaletteOpen).toBe(true)
    ui.closeCommandPalette()
    expect(ui.commandPaletteOpen).toBe(false)
  })
})
