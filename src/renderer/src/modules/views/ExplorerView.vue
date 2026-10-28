<template>
  <div class="workspace">
    <!-- 标签栏 -->
    <div class="ws-tabs" v-if="editor.tabs.length > 0">
      <div
        v-for="tab in editor.tabs"
        :key="tab.path"
        class="ws-tab"
        :class="{ active: tab.path === editor.activePath, dirty: tab.dirty }"
        @click="editor.setActive(tab.path)"
        @mousedown.middle="onMiddleClose(tab.path)"
      >
        <el-icon class="ws-tab-icon" :class="`tn-${iconClass(tab.ext)}`">
          <component :is="tabIcon(tab)" />
        </el-icon>
        <span class="ws-tab-name">{{ tab.name }}</span>
        <span v-if="tab.dirty" class="ws-dirty-dot" />
        <el-icon class="ws-tab-close" @click.stop="onClose(tab.path)">
          <Close />
        </el-icon>
      </div>
    </div>

    <!-- 编辑器区域 -->
    <div class="ws-editor-area">
      <template v-if="hasPane">
        <!-- T2：对比标签（run 前原文快照 ↔ 当前磁盘，只读） -->
        <DiffEditor
          v-if="pane.kind === 'diff'"
          :key="pane.tab.path"
          :path="pane.tab.path.slice('diff://'.length)"
          :original="pane.tab.diff?.original ?? ''"
          :modified="pane.tab.content"
          :language="pane.tab.language"
        />
        <!-- 图片标签：只读预览（缩放/像素级渲染） -->
        <ImagePreview
          v-else-if="pane.kind === 'image'"
          :key="pane.tab.path"
          :data-url="pane.tab.imageDataUrl ?? ''"
          :name="pane.tab.name"
        />
        <CodeEditor
          v-else
          :key="pane.tab.path"
          :path="pane.tab.path"
          :content="pane.tab.content"
          :language="pane.tab.language"
          @change="onContentChange"
          @diagnostics="onDiagnostics"
          ref="editorRef"
        />
      </template>
      <div v-else class="ws-empty">
        <el-icon :size="48" class="ws-empty-icon"><Document /></el-icon>
        <h2>{{ t('explorer.emptyTitle') }}</h2>
        <p>{{ t('explorer.emptySub') }}</p>
        <p v-if="!projectStore.currentProject" class="ws-hint">
          {{ t('explorer.openPrefix') }}
          <el-link type="primary" @click="goProjectManager">{{ t('explorer.openProjectManager') }}</el-link>
          {{ t('explorer.openSuffix') }}
        </p>
      </div>
    </div>

    <!-- 问题面板 -->
    <div v-if="diagnostics.length > 0" class="ws-problems">
      <div class="ws-problems-header">
        <el-icon><Warning /></el-icon>
        <span>{{ t('explorer.problems', { n: diagnostics.length }) }}</span>
        <el-button text size="small" @click="diagnostics = []">{{ t('explorer.clear') }}</el-button>
      </div>
      <div class="ws-problems-list">
        <div
          v-for="(d, i) in diagnostics"
          :key="i"
          class="ws-problem"
          :class="d.severity"
          @click="jumpTo(d)"
        >
          <el-icon class="ws-problem-icon">
            <CircleClose v-if="d.severity === 'error'" />
            <Warning v-else />
          </el-icon>
          <span class="ws-problem-msg">{{ d.message }}</span>
          <span class="ws-problem-loc">Ln {{ d.startLineNumber }}, Col {{ d.startColumn }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Close, Document, Warning, CircleClose, Picture } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import CodeEditor from '../../components/editor/CodeEditor.vue'
import DiffEditor from '../../components/editor/DiffEditor.vue'
import ImagePreview from '../../components/editor/ImagePreview.vue'
import { useEditorStore } from '../../stores/editor'
import { useUiStore } from '../../stores/ui'
import { useProjectStore } from '../../stores/project'
import { useExplorerStore } from '../../stores/explorer'
import { useI18n } from '../../i18n'
import { IpcChannels } from '../../../../shared/types/ipc'
import type { FsChangeEvent } from '../../../../shared/types/fs'
import type { LintMarker } from '../../monaco/javaLint'

const editor = useEditorStore()
const ui = useUiStore()
const projectStore = useProjectStore()
const explorerStore = useExplorerStore()
const { t } = useI18n()
const editorRef = ref<{ revealPosition: (line: number, column: number) => void } | null>(null)
const diagnostics = ref<LintMarker[]>([])

/**
 * 编辑器区视图模型（判别联合）。
 * 模板按 kind 三分支渲染 DiffEditor / ImagePreview / CodeEditor；
 * 判别联合是 vue-tsc 3.3.13 模板窄化支持最稳的形式（此前 v-else-if 直接判
 * 可选字段会被推成 never，见 EditorTab.diff / imageDataUrl 可选字段）。
 */
interface EditorPaneView {
  kind: 'diff' | 'image' | 'code'
  tab: NonNullable<typeof editor.activeTab>
}

/** 空态判定与取值分开：vue-tsc 3.3.13 起不把 template v-if 的窄化带进块内，
 *  故 hasPane 做空态分支、pane 显式断言非空供块内直接使用（与原 activeTabView 同法） */
const hasPane = computed(() => editor.activeTab != null)
const pane = computed<EditorPaneView>(() => {
  const tab = editor.activeTab as NonNullable<typeof editor.activeTab>
  if (tab.diff) return { kind: 'diff', tab }
  if (tab.imageDataUrl !== undefined) return { kind: 'image', tab }
  return { kind: 'code', tab }
})

let unsubscribeFs: (() => void) | null = null
/** 外部内容变更重载防抖：短时间连续写同一文件只按最终内容重载一次 */
const reloadTimers = new Map<string, ReturnType<typeof setTimeout>>()
const RELOAD_DEBOUNCE_MS = 250

onMounted(() => {
  unsubscribeFs = window.api.on(IpcChannels.FS_EVENT, (...args: unknown[]) => {
    const evt = args[0] as FsChangeEvent
    void handleFsChange(evt)
  })
})

onBeforeUnmount(() => {
  unsubscribeFs?.()
  for (const timer of reloadTimers.values()) clearTimeout(timer)
  reloadTimers.clear()
})

/** 已打开文件被外部修改：非脏状态自动重载；脏状态询问用户（按路径防抖） */
function scheduleExternalReload(path: string): void {
  const old = reloadTimers.get(path)
  if (old) clearTimeout(old)
  const timer = setTimeout(() => {
    reloadTimers.delete(path)
    const tab = editor.tabs.find((tab) => tab.path === path)
    if (!tab) return
    if (tab.dirty) {
      ElMessageBox.confirm(
        t('explorer.externalChangeBody', { name: tab.name }),
        t('explorer.externalChangeTitle'),
        { type: 'warning' }
      )
        .then(() => editor.reloadTab(path))
        .catch(() => {
          /* 用户保留本地修改 */
        })
    } else {
      void editor.reloadTab(path)
    }
  }, RELOAD_DEBOUNCE_MS)
  reloadTimers.set(path, timer)
}

/** 处理文件系统变更：刷新受影响的目录；若已打开文件被外部修改，提示重载 */
async function handleFsChange(evt: FsChangeEvent): Promise<void> {
  // 刷新受影响的目录
  if (evt.type === 'unlink' || evt.type === 'add') {
    const parent = evt.path.replace(/[\\/][^\\/]+$/, '')
    await explorerStore.refreshDir(parent || explorerStore.rootPath!)
  } else if (evt.type === 'unlinkDir' || evt.type === 'addDir') {
    const parent = evt.path.replace(/[\\/][^\\/]+$/, '')
    await explorerStore.refreshDir(parent || explorerStore.rootPath!)
  } else if (evt.type === 'change') {
    // 文件内容变更：已打开文件则防抖后重载（脏状态在执行时询问）
    if (editor.tabs.some((t: { path: string }) => t.path === evt.path)) {
      scheduleExternalReload(evt.path)
    }
  }
}

// 切换标签时清空诊断
watch(
  () => editor.activePath,
  () => {
    diagnostics.value = []
  }
)

function onDiagnostics(markers: LintMarker[]): void {
  diagnostics.value = markers
}

function onContentChange(content: string): void {
  if (editor.activeTab) editor.updateContent(editor.activeTab.path, content)
}

function onClose(path: string): void {
  void editor.closeTab(path)
}

function onMiddleClose(path: string): void {
  void editor.closeTab(path)
}

function jumpTo(d: LintMarker): void {
  editorRef.value?.revealPosition(d.startLineNumber, d.startColumn)
}

function goProjectManager(): void {
  ui.setActiveModule('project-manager')
}

function tabIcon(tab: { ext: string }) {
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(tab.ext)) return Picture
  return Document
}

function iconClass(ext: string): string {
  if (['java'].includes(ext)) return 'java'
  if (['json'].includes(ext)) return 'json'
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext)) return 'image'
  return 'file'
}
</script>

<style scoped>
.workspace {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-panel);
}
.ws-tabs {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  background: var(--ky-bg-sidebar);
  border-bottom: 1px solid var(--ky-border);
  flex-shrink: 0;
  min-height: 32px;
}
.ws-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  height: 32px;
  cursor: pointer;
  border-right: 1px solid var(--ky-border);
  color: var(--ky-text-sub);
  font-size: 12.5px;
  white-space: nowrap;
  position: relative;
}
.ws-tab:hover {
  background: var(--ky-bg-hover);
}
.ws-tab.active {
  background: var(--ky-bg-panel);
  color: var(--ky-text);
  border-bottom: 2px solid var(--ky-accent);
}
.ws-tab-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ws-tab-icon {
  font-size: 14px;
}
.ws-dirty-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ky-accent);
  flex-shrink: 0;
}
.ws-tab-close {
  font-size: 12px;
  opacity: 0.5;
  padding: 2px;
  border-radius: 3px;
}
.ws-tab-close:hover {
  opacity: 1;
  background: var(--ky-bg-hover);
}
.ws-editor-area {
  flex: 1;
  min-height: 0;
  position: relative;
}
.ws-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--ky-text-dim);
  gap: 8px;
}
.ws-empty-icon {
  opacity: 0.3;
  margin-bottom: 8px;
}
.ws-empty h2 {
  font-size: 16px;
  font-weight: 500;
  color: var(--ky-text-sub);
}
.ws-empty p {
  font-size: 13px;
  margin: 0;
}
.ws-hint {
  margin-top: 12px !important;
  font-size: 12px !important;
}
.ws-problems {
  border-top: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  max-height: 200px;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.ws-problems-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-text-sub);
  border-bottom: 1px solid var(--ky-border);
}
.ws-problems-header .el-button {
  margin-left: auto;
}
.ws-problems-list {
  overflow-y: auto;
  flex: 1;
}
.ws-problem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  cursor: pointer;
  font-size: 12px;
}
.ws-problem:hover {
  background: var(--ky-bg-hover);
}
.ws-problem.error .ws-problem-icon {
  color: #f38ba8;
}
.ws-problem.warning .ws-problem-icon {
  color: #f9e2af;
}
.ws-problem-msg {
  color: var(--ky-text);
}
.ws-problem-loc {
  margin-left: auto;
  color: var(--ky-text-dim);
  font-size: 11px;
}
.tn-java {
  color: #f89820;
}
.tn-json {
  color: #cbcb41;
}
.tn-image {
  color: #a37acc;
}
</style>
