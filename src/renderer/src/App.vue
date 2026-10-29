<template>
  <el-config-provider :locale="elLocale">
  <div class="app-shell">
    <TopBar />
    <!-- 写盘自检失败横幅：EDR/只读盘会表现为"保存无反应"，必须显式告知 -->
    <div v-if="writeProbeError" class="write-probe-banner">
      <span class="wpb-text">
        {{ t('app.writeProbe', { path: writeProbeError.path, error: writeProbeError.error ?? '' }) }}
      </span>
      <button class="wpb-close" :title="t('app.close')" @click="writeProbeError = null">✕</button>
    </div>
    <!-- 密钥加密降级横幅：safeStorage 不可用（无钥匙串的 Linux）时密钥明文落盘，必须显式告知 -->
    <div v-if="cryptoPlaintext" class="write-probe-banner">
      <span class="wpb-text">{{ t('app.cryptoPlaintext') }}</span>
      <button class="wpb-close" :title="t('app.close')" @click="cryptoPlaintext = false">✕</button>
    </div>
    <!-- 首启运行环境自动置备进度（不跳设置页：后台下载，可稍后隐藏） -->
    <div v-if="bootstrapVisible" class="runtime-bootstrap-banner">
      <span class="rbb-text">{{ bootstrapMessage }}</span>
      <span v-if="bootstrapBusy" class="rbb-pct">
        <template v-if="bootstrapJdkPct > 0 || bootstrapPhase === 'jdk'">
          JDK {{ bootstrapJdkPct }}%
        </template>
        <template v-if="bootstrapMcPct > 0 || bootstrapPhase === 'mc'">
          · MC {{ bootstrapMcPct }}%
        </template>
      </span>
      <template v-if="bootstrapPhase === 'error'">
        <button class="rbb-btn" @click="retryBootstrap()">{{ t('app.bootstrapRetry') }}</button>
        <button class="rbb-btn" @click="openRuntimeSettings">{{ t('app.bootstrapOpenSettings') }}</button>
      </template>
      <button
        v-if="bootstrapBusy || bootstrapPhase === 'error'"
        class="rbb-close"
        :title="t('app.bootstrapLater')"
        @click="dismissBootstrap()"
      >
        {{ t('app.bootstrapDismiss') }}
      </button>
    </div>
    <div class="app-body">
      <ActivityBar />
      <SideBar v-if="showSideBar && !ui.sidebarCollapsed" />
      <!-- 侧边栏收起态：细竖条常驻原位置，点击展开（折叠按钮在侧边栏左缘） -->
      <button
        v-else-if="showSideBar"
        type="button"
        class="sidebar-reopen"
        :title="t('sidebar.expand')"
        :aria-label="t('sidebar.expand')"
        @click="ui.toggleSidebarCollapsed()"
      >
        <span class="sidebar-reopen-arrow">›</span>
      </button>
      <!-- 中间编辑列：底部终端只占编辑区宽度（不横贯到 AI 助手），可折叠 -->
      <div class="app-main">
        <!-- 编辑区：标签页、内容、终端 -->
        <ContentArea class="app-main-content" />
        <BottomPanel />
      </div>
      <!-- Mod 库面板：仅整合包项目，位于 AI 助手左侧 -->
      <ModLibraryPanel v-if="showModLibrary" />
      <!-- 收起态把手：整合包项目常驻入口，点击重新展开（修复收起后无展开入口导致面板永久消失） -->
      <button
        v-else-if="projectStore.currentProject?.type === 'modpack'"
        type="button"
        class="modlib-reopen"
        :title="t('app.modlibReopen')"
        @click="ui.toggleModLibrary()"
      >
        <span class="modlib-reopen-arrow">&#171;</span>
        <span class="modlib-reopen-text">{{ t('app.modlibTitle') }}</span>
      </button>
      <AiAssistantPanel v-show="ui.aiPanelVisible" />
      <!-- AI 助手收起态：右缘细竖条，点击展开（活动栏底部不再放 AI 入口） -->
      <button
        v-if="!ui.aiPanelVisible"
        type="button"
        class="ai-reopen"
        :title="t('app.aiReopen')"
        :aria-label="t('app.aiReopen')"
        @click="ui.toggleAiPanel()"
      >
        <span class="ai-reopen-arrow">&#8249;</span>
        <span class="ai-reopen-text">{{ t('activity.ai') }}</span>
      </button>
    </div>

    <!-- 常驻状态栏（参考 VS Code） -->
    <StatusBar />

    <!-- 全局创建项目弹窗（侧边栏 + 号触发） -->
    <NewProjectWizard
      :model-value="ui.wizardOpen"
      @update:model-value="onWizardVisible"
      @created="onWizardCreated"
    />
    <!-- 命令面板（Ctrl+K） -->
    <CommandPalette />
    <!-- 首次启动引导 -->
    <OnboardingDialog />
    <!-- 首启 DSH 适配提醒（只提示不安装，dsh-pet 第三方插件按需用户显式获取） -->
    <DshFirstRunHint />
    <!-- 全局 MCP 桥接授权弹窗（外部 agent 写操作手动确认） -->
    <AuthRequestDialog />
  </div>
  </el-config-provider>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import TopBar from './components/layout/TopBar.vue'
import ActivityBar from './components/layout/ActivityBar.vue'
import SideBar from './components/layout/SideBar.vue'
import ContentArea from './components/layout/ContentArea.vue'
import AiAssistantPanel from './components/ai/AiAssistantPanel.vue'
import BottomPanel from './components/layout/BottomPanel.vue'
import StatusBar from './components/layout/StatusBar.vue'
import NewProjectWizard from './components/project/NewProjectWizard.vue'
import CommandPalette from './components/layout/CommandPalette.vue'
import OnboardingDialog from './components/layout/OnboardingDialog.vue'
import DshFirstRunHint from './components/layout/DshFirstRunHint.vue'
import ModLibraryPanel from './components/modpack/ModLibraryPanel.vue'
import AuthRequestDialog from './components/integration/AuthRequestDialog.vue'
import { useUiStore } from './stores/ui'
import { useProjectStore, readLastProjectId } from './stores/project'
import type { Project } from '../../shared/types/project'
import { useBuildStore } from './stores/build'
import { useSettingsStore } from './stores/settings'
import { useAiAgentsStore } from './stores/aiAgents'
import { useAiChatStore } from './stores/aiChat'
import { useEditorStore } from './stores/editor'
import { moduleRegistry } from './modules'
import { setThemeMode } from './utils/theme'
import { t, locale, setLocale } from './i18n'
import { useRuntimeBootstrap, DEFAULT_MC_VERSION } from './composables/useRuntimeBootstrap'

const ui = useUiStore()
const projectStore = useProjectStore()
const aiAgents = useAiAgentsStore()
const build = useBuildStore()
const settings = useSettingsStore()
const editorStore = useEditorStore()

/** Element Plus 内置文案随界面语言联动（日期选择、分页、空数据等） */
const elLocale = computed(() => (locale.value === 'en-US' ? en : zhCn))
const {
  visible: bootstrapVisible,
  message: bootstrapMessage,
  jdkPct: bootstrapJdkPct,
  mcPct: bootstrapMcPct,
  phase: bootstrapPhase,
  busy: bootstrapBusy,
  autoStart: autoStartRuntimeBootstrap,
  retry: retryBootstrap,
  dismiss: dismissBootstrap
} = useRuntimeBootstrap()

/** 首启向导只自动弹出一次的标记（本机未准备运行环境时） */
const RUNTIME_WIZARD_SHOWN_KEY = 'kunyu-runtime-wizard-shown'

/** 写盘自检结果（null = 通过或未检出问题）；失败时顶部横幅常驻直到手动关闭 */
const writeProbeError = ref<{ path: string; error?: string } | null>(null)

/** 密钥加密降级（safeStorage 不可用）：true 时顶部横幅提示明文落盘风险 */
const cryptoPlaintext = ref(false)

/** 项目管理与统一编辑器固定显示文件树；注册了 sidebarLoader 的模块显示侧边栏 */
const showSideBar = computed(() => {
  if (ui.activeModuleId === 'settings') return false
  // 项目管理无打开项目时：项目列表在活动栏，侧边栏让位给内容区
  if (ui.activeModuleId === 'project-manager') return Boolean(projectStore.currentProject)
  if (ui.activeModuleId === 'unified') return true
  return Boolean(moduleRegistry.get(ui.activeModuleId)?.sidebarLoader)
})

/** Mod 库面板：仅当前项目为整合包且面板开关开启时显示 */
const showModLibrary = computed(
  () => projectStore.currentProject?.type === 'modpack' && ui.modLibraryVisible
)

onMounted(async () => {
  // 设置先于模块激活加载（缩放/自动保存等初始值影响各组件）
  await settings.hydrate()
  // hydrate 后按设置的 themeMode 校正主题（main.ts 先用缓存防首帧闪烁）
  setThemeMode(settings.general.themeMode)
  // 语言同样在 hydrate 后生效：首帧固定源语言中文，避免闪烁
  setLocale(settings.general.locale)
  ui.activateInitialModule()
  build.initEvents()
  window.addEventListener('keydown', onGlobalKeyDown)
  // T-1 幽灵任务接管：渲染层刷新后主进程可能仍有运行中的 Agent 任务，
  // 启动时查询互斥状态并重新接管事件流（内部自守卫，无任务时空转）
  void aiAgents.syncBackgroundRun()
  // 写盘自检：失败时顶部横幅提示，避免"保存无反应"被当成产品 bug
  try {
    const probe = await window.api.app.writeProbe()
    if (!probe.ok) writeProbeError.value = { path: probe.path, error: probe.error }
  } catch {
    /* 探针本身失败（通道异常）不阻塞启动 */
  }
  // 密钥加密可用性：safeStorage 不可用（无钥匙串的 Linux）时降级为明文落盘，横幅明示
  try {
    const crypto = await window.api.settings.cryptoStatus()
    if (!crypto.encrypted) cryptoPlaintext.value = true
  } catch {
    /* 通道异常不阻塞启动 */
  }
  // 启动恢复：静默打开上次项目；记录失效/目录已删除时忽略
  if (settings.general.restoreLastProject) {
    try {
      await projectStore.refresh()
      const lastId = readLastProjectId()
      const alive = projectStore.projects.filter((p) => p.pathExists !== false)
      const targetId =
        (lastId && alive.some((p) => p.id === lastId) ? lastId : alive[0]?.id) ?? null
      if (targetId) {
        // 打开后停留在项目管理模块，由主页切换为工作区（按持久化的模式显示）
        await projectStore.open(targetId)
      }
    } catch {
      /* 失效项目静默回退项目管理 */
    }
  }
  // 首启零配置运行环境：本机未准备运行环境时，后台直接开始下载 JDK 与目标版本运行时，
  // 顶部细条呈现进度——不再把首次使用者强行导航到设置页（多一步、且要求他自己找回来）。
  // 仅自动尝试一次；不想等的人点「稍后」隐藏进度条，下载照常在后台进行。
  if (!localStorage.getItem(RUNTIME_WIZARD_SHOWN_KEY)) {
    localStorage.setItem(RUNTIME_WIZARD_SHOWN_KEY, '1')
    void autoStartRuntimeBootstrap({
      mcVersion: projectStore.currentProject?.mcVersion ?? DEFAULT_MC_VERSION,
      mirror: settings.network?.mcMirror ?? null
    })
  }
})

/** 主题模式变更即时生效（含 system 跟随系统切换，由 theme 模块内部监听） */
watch(
  () => settings.general.themeMode,
  (mode) => setThemeMode(mode)
)

/** 界面语言变更即时生效（Element Plus 内置文案由 elLocale 同步） */
watch(
  () => settings.general.locale,
  (pref) => setLocale(pref)
)

/**
 * AI 助手不常驻、随项目开关：打开项目主动展开面板并把会话绑到该项目
 * （历史任务按项目过滤、在跑的旧项目任务先取消）；关闭/删除当前项目时
 * 收起面板并清空运行与会话状态，避免跨项目混用任务、运行详情串项目。
 * 对话内容同样按项目隔离：切换作用域后只看得到该项目的会话。
 */
watch(
  () => projectStore.currentProjectId,
  (id, prev) => {
    useAiChatStore().switchScope(id ?? null)
    if (id) aiAgents.openForProject(id)
    else if (prev) aiAgents.closeForProject()
  }
)

/** 全局创建项目弹窗开关同步 */
function onWizardVisible(open: boolean): void {
  if (open) ui.openWizard()
  else ui.closeWizard()
}

/** 首启自动置备失败时的退路：进设置页的运行环境分类手工处理 */
function openRuntimeSettings(): void {
  ui.setSettingsCategory('runtime')
  ui.setActiveModule('settings', { rememberForSettings: true })
}

/** 项目创建成功后自动打开 */
function onWizardCreated(project: Project): void {
  // 创建后自动打开项目（独立包会自动进入对应编辑器）
  void projectStore.open(project.id)
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeyDown)
})

/** 全局快捷键：Ctrl+B 构建、F5 构建并运行、Ctrl+` 切换底部终端、Ctrl+K 命令面板、Ctrl+S 保存 */
function onGlobalKeyDown(e: KeyboardEvent): void {
  // 输入框/编辑器内不拦截 F5 以外的编辑键；Ctrl 组合键全局生效
  const key = e.key.toLowerCase()
  if ((e.ctrlKey || e.metaKey) && key === 'k') {
    e.preventDefault()
    ui.toggleCommandPalette()
    return
  }
  if ((e.ctrlKey || e.metaKey) && key === 's') {
    e.preventDefault()
    void editorStore.saveActive()
    return
  }
  if ((e.ctrlKey || e.metaKey) && key === 'b') {
    e.preventDefault()
    const root = projectStore.currentProject?.path
    if (root) void build.build(root)
    return
  }
  if ((e.ctrlKey || e.metaKey) && key === '`') {
    e.preventDefault()
    build.togglePanel()
    return
  }
  if (e.key === 'F5') {
    e.preventDefault()
    const root = projectStore.currentProject?.path
    if (root) void build.buildAndRun(root)
  }
}
</script>

<style scoped>
.write-probe-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background: rgba(239, 68, 68, 0.12);
  border-bottom: 1px solid rgba(239, 68, 68, 0.45);
  color: var(--ky-text);
  font-size: 12px;
}

.write-probe-banner .wpb-text {
  flex: 1;
  line-height: 1.5;
}

.write-probe-banner .wpb-close {
  border: none;
  background: transparent;
  color: var(--ky-text-dim);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
}

.write-probe-banner .wpb-close:hover {
  color: var(--ky-text);
}

/* 首启运行环境自动置备：细条进度，不阻塞任何操作 */
.runtime-bootstrap-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  background: rgba(59, 130, 246, 0.12);
  border-bottom: 1px solid rgba(59, 130, 246, 0.4);
  color: var(--ky-text);
  font-size: 12px;
}

.runtime-bootstrap-banner .rbb-text {
  flex: 1;
  line-height: 1.5;
}

.runtime-bootstrap-banner .rbb-pct {
  color: var(--ky-text-dim);
  font-variant-numeric: tabular-nums;
}

.runtime-bootstrap-banner .rbb-btn {
  border: 1px solid rgba(59, 130, 246, 0.5);
  background: transparent;
  color: var(--ky-text);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
}

.runtime-bootstrap-banner .rbb-btn:hover {
  background: rgba(59, 130, 246, 0.18);
}

.runtime-bootstrap-banner .rbb-close {
  border: none;
  background: transparent;
  color: var(--ky-text-dim);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
}

.runtime-bootstrap-banner .rbb-close:hover {
  color: var(--ky-text);
}

.app-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-base);
  color: var(--ky-text);
  overflow: hidden;
}

.app-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* 中间编辑列：内容区撑满，底部终端在列内上下分割 */
.app-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.app-main-content {
  flex: 1;
  min-height: 0;
}

/* 侧边栏收起态把手：细竖条常驻原位置，点击展开 */
.sidebar-reopen {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-right: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  color: var(--ky-text-dim);
  cursor: pointer;
  font-size: 13px;
}

.sidebar-reopen:hover {
  background: var(--ky-bg-hover);
  color: var(--ky-accent);
}

/* Mod 库收起态把手：细竖条常驻右栏位置，点击展开 */
.modlib-reopen {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  width: 24px;
  border: none;
  border-left: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  color: var(--ky-text-secondary, var(--el-text-color-secondary));
  cursor: pointer;
  font-size: 12px;
}

.modlib-reopen:hover {
  background: var(--ky-bg-hover);
  color: var(--el-text-color-primary);
}

.modlib-reopen-text {
  writing-mode: vertical-rl;
  letter-spacing: 2px;
}

/* AI 助手收起态：右缘细竖条（与 Mod 库把手同款，贴在窗口右边框） */
.ai-reopen {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  width: 22px;
  flex-shrink: 0;
  border: none;
  border-left: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  color: var(--ky-text-secondary, var(--el-text-color-secondary));
  cursor: pointer;
  font-size: 12px;
}

.ai-reopen:hover {
  background: var(--ky-bg-hover);
  color: var(--el-text-color-primary);
}

.ai-reopen-text {
  writing-mode: vertical-rl;
  letter-spacing: 2px;
}

.ai-reopen-arrow {
  font-size: 11px;
  line-height: 1;
}
</style>

<style>
/* 模块占位页通用样式（懒加载视图共享） */
.placeholder-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  padding: 24px;
}

.placeholder-view .pv-icon {
  color: var(--ky-accent);
  opacity: 0.85;
}

.placeholder-view h2 {
  margin: 6px 0 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--ky-text);
}

.placeholder-view p {
  margin: 0;
  font-size: 12px;
  color: var(--ky-text-dim);
}
</style>
