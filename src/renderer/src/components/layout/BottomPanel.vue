<template>
  <section
    v-if="build.panelVisible"
    class="bottom-panel"
    :class="{ 'is-collapsed': build.panelCollapsed }"
    :style="build.panelCollapsed ? undefined : { height: `${build.panelHeight}px` }"
  >
    <div v-if="!build.panelCollapsed" class="bp-resizer" @mousedown="startResize" />

    <!-- 流程步骤条（T5.4） -->
    <div v-if="build.flow && !build.panelCollapsed" class="bp-flow">
      <el-steps
        :active="build.flow.active"
        :process-status="build.flow.failed ? 'error' : 'process'"
        finish-status="success"
        align-center
        size="small"
      >
        <el-step v-for="(step, i) in build.flow.steps" :key="i" :title="step" />
      </el-steps>
    </div>

    <!-- 崩溃摘要横幅（T5.3） -->
    <el-alert
      v-if="build.crash"
      class="bp-crash"
      type="error"
      :closable="false"
      show-icon
    >
      <template #title>
        <span class="bp-crash-title">{{
          t('panel.crashTitle', { keyword: build.crash.keyword })
        }}</span>
      </template>
      <div class="bp-crash-body">
        <span>{{ build.crash.description }} —— {{ build.crash.cause }}</span>
        <el-button size="small" type="danger" plain @click="build.openCrashReport()">
          {{ t('panel.viewCrashReport') }}
        </el-button>
      </div>
    </el-alert>

    <!-- 标签 + 工具栏（瘦身后：状态/JDK/构建按钮全移到常驻 StatusBar） -->
    <header class="bp-header">
      <div class="bp-tabs">
        <button
          class="bp-tab"
          :class="{ active: build.activeTab === 'terminal' }"
          type="button"
          @click="build.openPanel('terminal')"
        >
          {{ t('panel.terminal') }}
        </button>
        <button
          class="bp-tab"
          :class="{ active: build.activeTab === 'problems' }"
          type="button"
          @click="build.openPanel('problems')"
        >
          {{ t('panel.problems') }}
          <span v-if="build.problems.length > 0" class="bp-badge" :class="badgeClass">
            {{ build.problems.length }}
          </span>
        </button>
      </div>

      <div class="bp-tools">
        <el-button size="small" text @click="build.clearConsole()">
          <el-icon><Delete /></el-icon> {{ t('panel.clear') }}
        </el-button>
        <el-button
          size="small"
          text
          class="bp-collapse"
          :title="build.panelCollapsed ? t('panel.expand') : t('panel.collapse')"
          @click="build.toggleCollapsed()"
        >
          <el-icon><ArrowUp v-if="build.panelCollapsed" /><ArrowDown v-else /></el-icon>
        </el-button>
        <el-button
          size="small"
          text
          class="bp-close"
          :title="t('panel.closePanel')"
          @click="build.panelVisible = false"
        >
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
    </header>

    <!-- 终端输出 -->
    <div
      v-if="!build.panelCollapsed"
      v-show="build.activeTab === 'terminal'"
      ref="scrollRef"
      class="bp-console"
      @scroll="onScroll"
    >
      <div v-for="line in build.lines" :key="line.id" class="bp-line" :class="`lv-${line.level}`">
        {{ line.text }}
      </div>
      <div v-if="build.lines.length === 0" class="bp-empty">{{ t('panel.emptyTerminal') }}</div>
    </div>

    <!-- 问题列表（T5.2） -->
    <div v-if="!build.panelCollapsed" v-show="build.activeTab === 'problems'" class="bp-problems">
      <div v-if="build.problems.length === 0" class="bp-empty">{{ t('panel.emptyProblems') }}</div>
      <div
        v-for="(p, i) in build.problems"
        :key="i"
        class="bp-problem"
        :class="p.severity"
        @click="build.jumpProblem(p)"
      >
        <el-icon class="bp-problem-icon">
          <CircleCloseFilled v-if="p.severity === 'error'" />
          <WarningFilled v-else />
        </el-icon>
        <span class="bp-problem-msg">{{ p.message }}</span>
        <span class="bp-problem-loc">{{ shortPath(p.file) }}<template v-if="p.line">:{{ p.line }}</template></span>
      </div>
    </div>

    <!-- 自定义任务输入（命令行交互） -->
    <div v-if="!build.panelCollapsed" class="bp-input-row">
      <span class="bp-prompt">gradlew</span>
      <input
        v-model="build.commandInput"
        class="bp-input"
        type="text"
        spellcheck="false"
        :placeholder="t('panel.commandPlaceholder')"
        :disabled="!project || build.running"
        @keydown.enter="onCustomCommand"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  CircleCloseFilled,
  Close,
  Delete,
  WarningFilled
} from '@element-plus/icons-vue'
import { useBuildStore } from '../../stores/build'
import { useProjectStore } from '../../stores/project'
import { t } from '../../i18n'

const build = useBuildStore()
const projectStore = useProjectStore()
const project = computed(() => projectStore.currentProject)

const scrollRef = ref<HTMLElement>()

const badgeClass = computed(() => (build.errorCount > 0 ? 'err' : 'warn'))

watch(
  () => build.lines.length,
  async () => {
    if (build.activeTab !== 'terminal' || !build.autoscroll) return
    await nextTick()
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  }
)

function onScroll(): void {
  const el = scrollRef.value
  if (!el) return
  // 距底部超过 40px 时暂停自动滚动
  build.autoscroll = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

function requireRoot(): string | null {
  if (!project.value) return null
  return project.value.path
}

async function onCustomCommand(): Promise<void> {
  const root = requireRoot()
  const cmd = build.commandInput
  if (!root || !cmd.trim()) return
  build.commandInput = ''
  await build.runCustom(root, cmd)
}

function shortPath(p: string | null): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/)
  return parts.length > 2 ? parts.slice(-2).join('/') : p
}

/** 顶部拖拽调整面板高度 */
function startResize(event: MouseEvent): void {
  event.preventDefault()
  const startY = event.clientY
  const startHeight = build.panelHeight
  const onMove = (e: MouseEvent): void => build.setHeight(startHeight + (startY - e.clientY))
  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'row-resize'
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}
</script>

<style scoped>
.bottom-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-sidebar);
  /* 与编辑区衔接：极细分割线，弱化「整页底部大块」的观感 */
  border-top: 1px solid color-mix(in srgb, var(--ky-border) 55%, transparent);
  position: relative;
}

.bp-resizer {
  position: absolute;
  top: -2px;
  left: 0;
  right: 0;
  height: 5px;
  cursor: row-resize;
  z-index: 10;
}

.bp-resizer:hover {
  background: var(--ky-accent);
  opacity: 0.3;
}

.bp-flow {
  padding: 8px 16px 2px;
  border-bottom: 1px solid var(--ky-border);
  background: var(--ky-bg-base);
}

.bp-flow :deep(.el-step__title) {
  font-size: 11px;
}

.bp-crash {
  padding: 4px 12px;
}

.bp-crash-body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
}

.bp-crash-title {
  font-size: 12.5px;
  font-weight: 600;
}

.bp-header {
  height: 28px;           /* 瘦身后从 34px 缩到 28px，跟 StatusBar 24px 配套 */
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  border-bottom: 1px solid var(--ky-border);
}

.bp-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
}

.bp-tab {
  border: none;
  background: transparent;
  color: var(--ky-text-sub);
  font-size: 12px;
  font-family: inherit;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.bp-tab:hover {
  color: var(--ky-text);
  background: var(--ky-bg-hover);
}

.bp-tab.active {
  color: var(--ky-text);
  background: var(--ky-bg-hover);
  font-weight: 600;
}

.bp-badge {
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 9px;
  font-size: 10px;
  line-height: 17px;
  text-align: center;
  font-weight: 700;
  color: #11111b;
}

.bp-badge.err {
  background: #f87171;
}

.bp-badge.warn {
  background: #fbbf24;
}

.bp-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.bp-close {
  padding: 3px;
}

.bp-collapse {
  padding: 3px;
}

/* 折叠态：只保留标题栏，不再占据高度 */
.bottom-panel.is-collapsed .bp-header {
  border-bottom: none;
}

.bp-console {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 12px;
  font-family: var(--ky-font-mono);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-all;
}

.bp-line {
  color: var(--ky-text-sub);
}

.bp-line.lv-info {
  color: var(--ky-text-sub);
}

.bp-line.lv-dim {
  color: var(--ky-text-dim);
}

.bp-line.lv-success {
  color: #a6e3a1;
}

.bp-line.lv-warning {
  color: #f9e2af;
}

.bp-line.lv-error {
  color: #f38ba8;
}

.bp-empty {
  color: var(--ky-text-dim);
  font-size: 12px;
  padding: 10px 0;
}

.bp-problems {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
}

.bp-problem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
}

.bp-problem:hover {
  background: var(--ky-bg-hover);
}

.bp-problem.error .bp-problem-icon {
  color: #f38ba8;
}

.bp-problem.warning .bp-problem-icon {
  color: #f9e2af;
}

.bp-problem-msg {
  color: var(--ky-text);
}

.bp-problem-loc {
  margin-left: auto;
  color: var(--ky-text-dim);
  font-family: var(--ky-font-mono);
  font-size: 11px;
  white-space: nowrap;
}

.bp-input-row {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 12px;          /* 更薄：之前 4px 12px */
  border-top: none;           /* 去掉上边框，跟终端输出直接衔接 */
  background: transparent;    /* 去掉灰色背景，跟终端输出同底 */
}

.bp-prompt {
  color: var(--ky-accent);
  font-family: var(--ky-font-mono);
  font-size: 12px;
  font-weight: 700;
}

.bp-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ky-text);
  font-family: var(--ky-font-mono);
  font-size: 12px;
}

.bp-input::placeholder {
  color: var(--ky-text-dim);
}

.bp-input:disabled {
  opacity: 0.5;
}
</style>
