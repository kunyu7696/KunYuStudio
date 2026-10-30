<template>
  <header class="top-bar" :class="{ 'is-darwin': isDarwin }">
    <!-- 最左侧大 Logo -->
    <div
      class="tb-logo-outer"
      role="button"
      tabindex="0"
      @click="goProjectManager"
      @keyup.enter="goProjectManager"
    >
      <img class="tb-logo-mark" src="../../assets/app-icon.png" :alt="t('topbar.logoAlt')" />
    </div>

    <!-- 左：文字 + 菜单栏 -->
    <div class="tb-left">
      <span class="tb-logo-text">KunYu Studio</span>
      <nav class="tb-menu">
        <el-dropdown
          v-for="menu in menus"
          :key="menu.label"
          trigger="click"
          placement="bottom-start"
          @command="(cmd: string) => runMenuCommand(cmd)"
        >
          <button class="tb-menu-item" type="button">{{ menu.label }}</button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="item in menu.items"
                :key="item.command"
                :command="item.command"
                :disabled="item.disabled"
              >
                {{ item.label }}
                <span v-if="item.shortcut" class="tb-menu-shortcut">{{ item.shortcut }}</span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </nav>
    </div>

    <!-- 中：项目名 + 状态点 -->
    <div class="tb-project">
      <span class="tb-status-dot" :class="{ open: !!projectName }" />
      <span class="tb-project-name">{{ projectName || t('topbar.noProject') }}</span>
    </div>

    <!-- 右：模式切换 + 操作按钮 -->
    <div class="tb-right">
      <!-- 双模式切换：工作台（IDE）/ 灵感台（全屏创意空间） -->
      <div class="tb-mode" role="group" :aria-label="t('topbar.modeSwitch')">
        <button
          type="button"
          class="tb-mode-opt"
          :class="{ 'is-active': ui.appMode === 'ide' }"
          :aria-pressed="ui.appMode === 'ide'"
          @click="ui.setAppMode('ide')"
        >{{ t('topbar.modeIde') }}</button>
        <button
          type="button"
          class="tb-mode-opt"
          :class="{ 'is-active': ui.appMode === 'inspire' }"
          :aria-pressed="ui.appMode === 'inspire'"
          @click="ui.setAppMode('inspire')"
        >{{ t('topbar.modeInspire') }}</button>
      </div>

      <!-- 工作台专属操作：灵感台模式下隐藏（保存/构建/运行依赖项目上下文） -->
      <template v-if="ui.appMode === 'ide'">
      <el-button size="small" text :disabled="!projectName" @click="onSave">{{
        t('common.save')
      }}</el-button>
      <el-button
        size="small"
        :disabled="!projectName || build.running"
        :loading="build.phase === 'building'"
        @click="onBuild"
      >
        {{ t('topbar.build') }}
      </el-button>
      <el-button
        size="small"
        type="primary"
        class="btn-run"
        :disabled="!projectName || build.running"
        :loading="build.running"
        @click="onBuildAndRun"
      >
        <el-icon v-if="!build.running" class="el-icon--left"><VideoPlay /></el-icon>
        {{ build.phase === 'game' ? t('topbar.runningGame') : t('topbar.runGame') }}
      </el-button>

      <!-- 编辑导航：后退 / 前进 / 终端开关（从编辑区顶部挪来的） -->
      <div class="tb-edit-nav">
        <button
          type="button"
          class="tb-nav-btn"
          :title="t('topbar.backTooltip')"
          :aria-label="t('topbar.back')"
          :disabled="!editorStore.canGoBack"
          @click="editorStore.goBack()"
        >
          <el-icon :size="15"><ArrowLeftBold /></el-icon>
        </button>
        <button
          type="button"
          class="tb-nav-btn"
          :title="t('topbar.forward')"
          :aria-label="t('topbar.forward')"
          :disabled="!editorStore.canGoForward"
          @click="editorStore.goForward()"
        >
          <el-icon :size="15"><ArrowRightBold /></el-icon>
        </button>
        <span class="tb-nav-sep" />
        <button
          type="button"
          class="tb-nav-btn"
          :class="{ 'is-on': build.panelVisible }"
          :title="t('topbar.terminalTooltip')"
          :aria-label="t('topbar.terminal')"
          :aria-pressed="build.panelVisible"
          @click="build.togglePanel()"
        >
          <el-icon :size="16"><Monitor /></el-icon>
        </button>
      </div>
      </template>

      <!-- 无边框窗口控制：最小化 / 最大化(还原) / 关闭（macOS 用系统红绿灯，不渲染自定义按钮） -->
      <div v-if="!isDarwin" class="tb-win-controls">
        <button type="button" class="tb-win-btn" :title="t('topbar.minimize')" @click="onMinimize">
          <el-icon :size="14"><Minus /></el-icon>
        </button>
        <button
          type="button"
          class="tb-win-btn"
          :title="isMaximized ? t('topbar.restore') : t('topbar.maximize')"
          @click="onToggleMaximize"
        >
          <el-icon :size="13"><Crop v-if="isMaximized" /><FullScreen v-else /></el-icon>
        </button>
        <button type="button" class="tb-win-btn tb-win-close" :title="t('topbar.close')" @click="onClose">
          <el-icon :size="14"><Close /></el-icon>
        </button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import { Close, Crop, FullScreen, Minus, VideoPlay, ArrowLeftBold, ArrowRightBold, Monitor } from '@element-plus/icons-vue'
import { IpcChannels } from '../../../../shared/types/ipc'
import { useUiStore } from '../../stores/ui'
import { useProjectStore } from '../../stores/project'
import { useEditorStore } from '../../stores/editor'
import { useExplorerStore } from '../../stores/explorer'
import { useBuildStore } from '../../stores/build'
import { t } from '../../i18n'

const ui = useUiStore()
const projectStore = useProjectStore()
const editorStore = useEditorStore()
const explorerStore = useExplorerStore()
const build = useBuildStore()

const projectName = computed(() => projectStore.currentProject?.name ?? null)
const hasProject = computed(() => Boolean(projectStore.currentProject))

interface MenuItem { label: string; command: string; disabled?: boolean; shortcut?: string }
interface MenuGroup { label: string; items: MenuItem[] }

const menus = computed<MenuGroup[]>(() => [
  {
    label: t('topbar.menuFile'),
    items: [
      { label: t('topbar.menuFileNew'), command: 'file:new-project' },
      { label: t('topbar.menuFileImport'), command: 'file:import-project' },
      { label: t('topbar.menuFileSave'), command: 'file:save', disabled: !hasProject.value, shortcut: 'Ctrl+S' },
      { label: t('topbar.menuFileClose'), command: 'file:close-project', disabled: !hasProject.value }
    ]
  },
  {
    label: t('topbar.menuView'),
    items: [
      { label: t('topbar.menuViewPalette'), command: 'view:command-palette', shortcut: 'Ctrl+K' },
      { label: t('topbar.menuViewRefreshTree'), command: 'view:refresh-tree', disabled: !explorerStore.rootPath },
      {
        label: ui.aiPanelVisible ? t('topbar.menuViewHideAi') : t('topbar.menuViewShowAi'),
        command: 'view:toggle-ai'
      },
      { label: t('topbar.menuViewTogglePanel'), command: 'view:toggle-panel', shortcut: 'Ctrl+`' }
    ]
  },
  {
    label: t('topbar.menuBuild'),
    items: [
      {
        label: t('topbar.menuBuildBuild'),
        command: 'build:build',
        disabled: !hasProject.value || build.running,
        shortcut: 'Ctrl+B'
      },
      {
        label: t('topbar.menuBuildRun'),
        command: 'build:run',
        disabled: !hasProject.value || build.running,
        shortcut: 'F5'
      },
      { label: t('topbar.menuBuildStop'), command: 'build:stop', disabled: !build.running }
    ]
  },
  {
    label: t('topbar.menuHelp'),
    items: [
      { label: t('topbar.menuHelpOnboarding'), command: 'help:onboarding' },
      { label: t('topbar.menuHelpDsh'), command: 'help:dsh' },
      { label: t('topbar.menuHelpAbout'), command: 'help:about' }
    ]
  }
])

/** 应用版本（关于对话框用），启动时取一次 */
const appVersion = ref('')

/** macOS：hiddenInset 标题栏下红绿灯在左上角，需让出安全区并隐藏自定义窗口按钮 */
const isDarwin = ref(false)

/** 顶栏菜单命令分发：原先 5 个 disabled 死菜单改为真实命令 */
function runMenuCommand(cmd: string): void {
  const root = projectStore.currentProject?.path
  switch (cmd) {
    case 'file:new-project':
      ui.openWizard()
      break
    case 'file:import-project':
      // 导入入口在侧边栏项目列表头部；切到项目管理模块即达
      ui.setActiveModule('project-manager')
      break
    case 'file:save':
      void editorStore.saveActive()
      break
    case 'file:close-project':
      projectStore.closeCurrent()
      break
    case 'view:command-palette':
      ui.toggleCommandPalette()
      break
    case 'view:refresh-tree':
      void explorerStore.refreshAll()
      break
    case 'view:toggle-ai':
      ui.toggleAiPanel()
      break
    case 'view:toggle-panel':
      build.togglePanel()
      break
    case 'build:build':
      if (root) void build.build(root)
      break
    case 'build:run':
      if (root) void build.buildAndRun(root)
      break
    case 'build:stop':
      build.cancel()
      break
    case 'help:onboarding':
      ui.onboardingOpen = true
      break
    case 'help:dsh':
      // 首启 DSH 提醒关闭后的再发现入口：直接落到 DSH 页（安装仍需用户在页内显式触发）
      ui.setActiveModule('dsh-plugins')
      break
    case 'help:about':
      ElMessageBox.alert(
        t('topbar.aboutBody', { version: appVersion.value || '…' }),
        'KunYu Studio',
        { confirmButtonText: t('topbar.aboutConfirm') }
      )
      break
  }
}

/* ---- 无边框窗口控制 ---- */
const isMaximized = ref(false)
let offMaxChanged: (() => void) | null = null

function onMinimize(): void {
  void window.api.win.minimize()
}

function onToggleMaximize(): void {
  void window.api.win.toggleMaximize()
}

function onClose(): void {
  void window.api.win.close()
}

onMounted(async () => {
  isMaximized.value = await window.api.win.isMaximized()
  offMaxChanged = window.api.on(IpcChannels.WIN_MAXIMIZED_CHANGED, (v) => {
    isMaximized.value = Boolean(v)
  })
  try {
    appVersion.value = await window.api.app.getVersion()
  } catch {
    /* 版本获取失败不阻塞 */
  }
  try {
    isDarwin.value = (await window.api.app.getPlatform()) === 'darwin'
  } catch {
    /* preload 不可用（纯 web 预览）时按非 mac 渲染 */
  }
})

onBeforeUnmount(() => {
  offMaxChanged?.()
})

function goProjectManager(): void {
  // Logo 点击始终回工作台模式的项目管理（灵感台下的"回主页"出口）
  ui.setAppMode('ide')
  ui.setActiveModule('project-manager')
}

function onSave(): void {
  void editorStore.saveActive()
}

function onBuild(): void {
  const root = projectStore.currentProject?.path
  if (root) void build.build(root)
}

function onBuildAndRun(): void {
  const root = projectStore.currentProject?.path
  if (root) void build.buildAndRun(root)
}
</script>

<style scoped>
.top-bar {
  height: 48px; /* 收窄到常规顶栏高度 */
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 0;
  background: var(--ky-bg-sidebar);
  border-bottom: 1px solid var(--ky-border);
  -webkit-app-region: drag;
}

.top-bar :where(button, .el-button) {
  -webkit-app-region: no-drag;
}

/* macOS hiddenInset：左上角红绿灯（约 80px 宽）不遮挡 Logo/菜单 */
.top-bar.is-darwin {
  padding-left: 84px;
}

/* 最左侧 Logo 容器：高度跟随顶栏 48px，图标保持 40px（不收小） */
.tb-logo-outer {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 48px;
  width: 48px;
  flex-shrink: 0;
  cursor: pointer;
  transition: background 0.15s ease;
}

.tb-logo-outer:hover {
  background: var(--ky-bg-hover);
}

.tb-logo-mark {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  object-fit: contain;
  display: block;
}

.tb-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.tb-logo-text {
  font-weight: 700;
  font-size: 15px;
  /* 深蓝灰：呼应 Logo 图标的蓝调 */
  color: #3a4a6a;
  white-space: nowrap;
  letter-spacing: 0.2px;
}

.tb-menu {
  display: flex;
  align-items: center;
  gap: 2px;
}

.tb-menu-item {
  border: none;
  background: transparent;
  color: var(--ky-text-sub);
  font-size: 12px;
  padding: 3px 6px;
  border-radius: var(--ky-radius-control);
  cursor: pointer;
  font-family: inherit;
}

.tb-menu-item:hover {
  background: var(--ky-bg-hover);
  color: var(--ky-text);
}

.tb-menu-shortcut {
  margin-left: 18px;
  color: var(--ky-text-dim);
  font-size: 11px;
}

.tb-project {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
}

.tb-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ky-text-dim);
}

.tb-status-dot.open {
  background: var(--ky-accent);
  box-shadow: 0 0 6px color-mix(in srgb, var(--ky-accent) 60%, transparent);
}

.tb-project-name {
  font-size: 12px;
  color: var(--ky-text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tb-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.btn-run {
  font-weight: 600;
}

/* ---- 双模式切换（工作台 / 灵感台） ---- */
.tb-mode {
  display: inline-flex;
  border: 1px solid var(--ky-border);
  border-radius: 999px;
  overflow: hidden;
  margin-right: 4px;
}

.tb-mode-opt {
  border: none;
  background: transparent;
  color: var(--ky-text-sub);
  font-size: 12px;
  padding: 3px 12px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}

.tb-mode-opt.is-active {
  background: var(--ky-accent);
  color: #fff;
}

/* ---- 编辑导航：后退 / 前进 / 终端开关 ---- */
.tb-edit-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-left: 8px;
  margin-left: 2px;
  border-left: 1px solid var(--ky-border);
}

.tb-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: var(--ky-radius-control);
  background: transparent;
  color: var(--ky-text-sub);
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.tb-nav-btn:hover:not(:disabled) {
  background: var(--ky-bg-hover);
  color: var(--ky-text);
}

.tb-nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.tb-nav-btn.is-on {
  color: var(--ky-accent);
}

.tb-nav-sep {
  width: 1px;
  height: 14px;
  margin: 0 4px;
  background: var(--ky-border);
}

/* ---- 无边框窗口控制按钮 ---- */
.tb-win-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: 8px;
  padding-left: 8px;
  border-left: 1px solid var(--ky-border);
}

.tb-win-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 24px;
  border-radius: var(--ky-radius-control);
  color: var(--ky-text-sub);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.tb-win-btn:hover {
  background: var(--ky-bg-hover);
  color: var(--ky-text);
}

.tb-win-close:hover {
  background: #e81123;
  color: #fff;
}
</style>
