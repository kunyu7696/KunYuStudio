import { defineStore } from 'pinia'
import { moduleRegistry } from '../modules'
import type { SettingsCategory } from '../components/settings/category'

/** 应用双模式：ide = 工作台（现有布局）；inspire = 灵感台（全屏创意空间） */
export type AppMode = 'ide' | 'inspire'

const APP_MODE_KEY = 'kunyu:app-mode'
const ACTIVE_MODULE_KEY = 'kunyu:active-module'
const SIDEBAR_WIDTH_KEY = 'kunyu:sidebar-width'
const AI_PANEL_WIDTH_KEY = 'kunyu:ai-panel-width'
const MOD_LIBRARY_VISIBLE_KEY = 'kunyu:mod-library-visible'

const DEFAULT_MODULE = 'project-manager'
const DEFAULT_SIDEBAR_WIDTH = 280   // 从 240 加宽：文件树需要完整显示长路径
const DEFAULT_AI_PANEL_WIDTH = 400  // 从 340 加宽：AI 助手内容更透气
const AI_PANEL_MIN = 280
const AI_PANEL_MAX = 560

/** 读取持久化的应用模式：仅接受合法值，其余回退工作台 */
function readAppMode(): AppMode {
  return localStorage.getItem(APP_MODE_KEY) === 'inspire' ? 'inspire' : 'ide'
}

function readStoredModule(): string {
  const id = localStorage.getItem(ACTIVE_MODULE_KEY)
  return id && moduleRegistry.has(id) ? id : DEFAULT_MODULE
}

function readStoredSidebarWidth(): number {
  const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY))
  if (Number.isNaN(raw) || raw <= 0) return DEFAULT_SIDEBAR_WIDTH
  return raw
}

function readAiPanelWidth(): number {
  const raw = Number(localStorage.getItem(AI_PANEL_WIDTH_KEY))
  if (Number.isNaN(raw) || raw < AI_PANEL_MIN || raw > AI_PANEL_MAX) return DEFAULT_AI_PANEL_WIDTH
  return raw
}

/** Mod 库面板默认展开（仅整合包项目显示） */
function readModLibraryVisible(): boolean {
  const raw = localStorage.getItem(MOD_LIBRARY_VISIBLE_KEY)
  return raw === null ? true : raw === '1'
}

/**
 * 界面级状态：当前活动模块、侧边栏宽度、右侧 AI 助手面板开关/宽度、设置页分类。
 * 除 AI 助手面板开关外均持久化到 localStorage，重启后恢复。
 * AI 助手不常驻：由「打开项目」主动展开（见 App.vue 的 currentProjectId 侦听），
 * 关闭项目时收起，故不做持久化——避免无项目时面板自己冒出来。
 */
export const useUiStore = defineStore('ui', {
  state: () => ({
    /** 应用模式：工作台 / 灵感台（持久化，重启恢复） */
    appMode: readAppMode() as AppMode,
    activeModuleId: readStoredModule(),
    sidebarWidth: readStoredSidebarWidth(),
    aiPanelVisible: false,
    aiPanelWidth: readAiPanelWidth(),
    /** Mod 库面板开关（仅整合包项目可见） */
    modLibraryVisible: readModLibraryVisible(),
    /** 创建项目弹窗（全局唯一，由侧边栏 + 号触发） */
    wizardOpen: false,
    /** 命令面板：全局浮层，Ctrl+K 触发 */
    commandPaletteOpen: false,
    /** 新手引导对话框：首次启动自动弹出，帮助菜单可再次打开 */
    onboardingOpen: false,
    settingsCategory: 'general' as SettingsCategory,
    /** 进入设置前的模块 ID，用于「返回」按钮 */
    settingsReturnTo: null as string | null
  }),

  getters: {
    activeModule: (state) => moduleRegistry.get(state.activeModuleId)
  },

  actions: {
    /** 切换应用模式（工作台 ↔ 灵感台） */
    setAppMode(mode: AppMode): void {
      if (this.appMode === mode) return
      this.appMode = mode
      localStorage.setItem(APP_MODE_KEY, mode)
    },

    setActiveModule(id: string, options?: { rememberForSettings?: boolean }): void {
      const target = moduleRegistry.get(id)
      if (!target || id === this.activeModuleId) return

      // 如果目标是 settings 且请求记住来源，记录当前模块
      if (id === 'settings' && options?.rememberForSettings) {
        this.settingsReturnTo = this.activeModuleId
      }

      moduleRegistry.get(this.activeModuleId)?.onDeactivate?.()
      this.activeModuleId = id
      localStorage.setItem(ACTIVE_MODULE_KEY, id)
      target.onActivate?.()
    },

    /** 从设置页返回上一个模块 */
    backFromSettings(): void {
      const target = this.settingsReturnTo ?? 'project-manager'
      this.settingsReturnTo = null
      this.setActiveModule(target)
    },

    /** 应用启动时调用，触发初始模块的 onActivate 生命周期 */
    activateInitialModule(): void {
      moduleRegistry.get(this.activeModuleId)?.onActivate?.()
    },

    setSidebarWidth(width: number): void {
      const min = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('--ky-sidebar-min'))
      const max = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('--ky-sidebar-max'))
      const clamped = Math.min(max, Math.max(min, Math.round(width)))
      this.sidebarWidth = clamped
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped))
    },

    /** 打开项目时主动展开 AI 助手面板（不常驻：仅项目会话内可见） */
    showAiPanel(): void {
      this.aiPanelVisible = true
    },

    /** 关闭项目时收起 AI 助手面板 */
    hideAiPanel(): void {
      this.aiPanelVisible = false
    },

    toggleAiPanel(): void {
      this.aiPanelVisible = !this.aiPanelVisible
    },

    setAiPanelWidth(width: number): void {
      this.aiPanelWidth = Math.min(AI_PANEL_MAX, Math.max(AI_PANEL_MIN, Math.round(width)))
      localStorage.setItem(AI_PANEL_WIDTH_KEY, String(this.aiPanelWidth))
    },

    toggleModLibrary(): void {
      this.modLibraryVisible = !this.modLibraryVisible
      localStorage.setItem(MOD_LIBRARY_VISIBLE_KEY, this.modLibraryVisible ? '1' : '0')
    },

    openWizard(): void {
      this.wizardOpen = true
    },

    closeWizard(): void {
      this.wizardOpen = false
    },

    /** 命令面板开关 */
    toggleCommandPalette(): void {
      this.commandPaletteOpen = !this.commandPaletteOpen
    },

    closeCommandPalette(): void {
      this.commandPaletteOpen = false
    },

    /** 从应用其他位置跳转设置页时定位具体分类 */
    setSettingsCategory(category: SettingsCategory): void {
      this.settingsCategory = category
    }
  }
})
