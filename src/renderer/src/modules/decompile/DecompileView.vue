<!--
  活动栏「反编译」：jar 反编译工作区（Vineflower）
  - 工具链按需下载到 userData/tools（Maven Central / 阿里云镜像），不打进安装包
  - 产物落 userData/decompiled/<jar>-<hash>/，自管安全根，与项目文件树隔离
  - 浏览：工作区列表 + 懒加载文件树 + 类名搜索 + Monaco java 只读查看
-->
<template>
  <div class="decompile-view">
    <header class="dv-header">
      <div class="dv-heading">
        <h2>{{ t('decompile.title') }}</h2>
        <p>{{ t('decompile.subtitle') }}</p>
      </div>
      <div class="dv-actions">
        <el-tag v-if="tool?.installed" type="success" effect="plain">
          {{ t('decompile.toolReady', { version: tool.version }) }}
        </el-tag>
        <el-tag
          v-if="tool?.installed && tool.integrity === 'unverified'"
          type="warning"
          effect="plain"
          :title="t('decompile.integrityUnverifiedTip')"
        >
          {{ t('decompile.integrityUnverified') }}
        </el-tag>
        <el-tag v-if="!tool?.installed" type="info" effect="plain">{{ t('decompile.toolMissing') }}</el-tag>
        <el-button
          v-if="toolReady === false"
          :icon="Download"
          :loading="downloadingTool"
          @click="onEnsureTool"
        >
          {{ t('decompile.downloadTool') }}
        </el-button>
        <el-button type="primary" :icon="FolderOpened" :loading="running" @click="onPickJar">
          {{ t('decompile.pickJar') }}
        </el-button>
        <el-button :icon="Refresh" :loading="loadingList" @click="reloadWorkspaces">{{ t('decompile.refresh') }}</el-button>
      </div>
    </header>

    <div v-if="running || phaseText" class="dv-progress">
      <div class="dv-progress-line">
        <el-icon v-if="running" class="is-loading"><Loading /></el-icon>
        <span class="dv-phase">{{ phaseText }}</span>
        <span v-if="lastLog" class="dv-log" :title="lastLog">{{ lastLog }}</span>
      </div>
    </div>

    <div class="dv-body">
      <aside class="dv-aside">
        <div class="dv-ws-head">
          <span class="dv-ws-title">{{ t('decompile.workspaces', { n: workspaces.length }) }}</span>
        </div>
        <el-scrollbar class="dv-ws-scroll">
          <div
            v-for="ws in workspaces"
            :key="ws.root"
            class="dv-ws-item"
            :class="{ active: ws.root === activeRoot }"
            @click="selectWorkspace(ws.root)"
          >
            <span class="dv-ws-name" :title="ws.root">{{ ws.name }}</span>
            <el-button
              class="dv-ws-del"
              text
              size="small"
              :icon="Delete"
              @click.stop="onDeleteWorkspace(ws.root)"
            />
          </div>
          <el-empty v-if="workspaces.length === 0" :description="t('decompile.noWorkspaces')" :image-size="60" />
        </el-scrollbar>

        <div v-if="activeRoot" class="dv-tree-pane">
          <el-input
            v-model="query"
            size="small"
            :placeholder="t('decompile.searchPlaceholder')"
            clearable
            :prefix-icon="Search"
            @input="onSearchInput"
            @clear="searchResults = []"
          />
          <el-scrollbar class="dv-tree-scroll">
            <div v-if="searchResults.length > 0" class="dv-search-results">
              <div
                v-for="hit in searchResults"
                :key="hit.path"
                class="dv-search-hit"
                :title="hit.path"
                @click="openFile(hit.path)"
              >
                <el-icon><Document /></el-icon>
                <span>{{ relOf(hit.path) }}</span>
              </div>
            </div>
            <el-tree
              v-else
              ref="treeRef"
              class="dv-tree"
              :props="treeProps"
              :load="loadTreeNode"
              lazy
              node-key="path"
              highlight-current
              :expand-on-click-node="false"
              @node-click="onNodeClick"
            />
          </el-scrollbar>
        </div>
      </aside>

      <main class="dv-main">
        <template v-if="activeFile">
          <div class="dv-file-bar">
            <span class="dv-file-path" :title="activeFile">{{ relOf(activeFile) }}</span>
            <el-tag size="small" effect="plain" type="info">{{ t('decompile.readonly') }}</el-tag>
            <el-button
              size="small"
              text
              :icon="FolderOpened"
              @click="revealFile"
            >
              {{ t('decompile.revealInFolder') }}
            </el-button>
          </div>
          <div class="dv-editor">
            <DecompileCodeViewer :content="activeContent" language="java" />
          </div>
        </template>
        <el-empty v-else class="dv-empty" :description="t('decompile.emptyFile')" />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Delete,
  Document,
  Download,
  FolderOpened,
  Loading,
  Refresh,
  Search
} from '@element-plus/icons-vue'
import type Node from 'element-plus/es/components/tree/src/model/node'
import { IpcChannels } from '../../../../shared/types/ipc'
import type {
  DecompileEvent,
  DecompileToolStatus,
  DecompileWorkspaceInfo
} from '../../../../shared/types/decompile'
import type { FileNode } from '../../../../shared/types/fs'
import { t } from '../../i18n'
import DecompileCodeViewer from './DecompileCodeViewer.vue'

const tool = ref<DecompileToolStatus | null>(null)
const toolReady = computed(() => tool.value?.installed === true)
const downloadingTool = ref(false)
const running = ref(false)
const phaseText = ref('')
const lastLog = ref('')
const loadingList = ref(false)

const workspaces = ref<DecompileWorkspaceInfo[]>([])
const activeRoot = ref('')
const activeFile = ref('')
const activeContent = ref('')
const query = ref('')
const searchResults = ref<FileNode[]>([])
const treeRef = ref()

const treeProps = {
  label: 'name',
  // TreeOptionProps.isLeaf 要求宽类型签名；FileNode.kind 在运行时由主进程保证
  isLeaf: (data: { kind?: string }): boolean => data.kind === 'file'
}

/** 绝对路径 → 工作区内相对路径（展示用） */
function relOf(absPath: string): string {
  const root = activeRoot.value
  if (root && absPath.startsWith(root)) return absPath.slice(root.length + 1)
  return absPath
}

async function loadToolStatus(): Promise<void> {
  tool.value = await window.api.decompile.status()
}

async function reloadWorkspaces(): Promise<void> {
  loadingList.value = true
  try {
    workspaces.value = await window.api.decompile.listWorkspaces()
    if (activeRoot.value && !workspaces.value.some((w) => w.root === activeRoot.value)) {
      activeRoot.value = ''
      activeFile.value = ''
    }
  } finally {
    loadingList.value = false
  }
}

async function onEnsureTool(): Promise<void> {
  downloadingTool.value = true
  try {
    tool.value = await window.api.decompile.ensureTool()
    ElMessage.success(t('decompile.toolReady', { version: tool.value.version }))
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    downloadingTool.value = false
  }
}

async function onPickJar(): Promise<void> {
  const jarPath = await window.api.dialog.selectFile({
    title: t('decompile.selectJarTitle'),
    extensions: ['jar']
  })
  if (!jarPath) return
  running.value = true
  phaseText.value = t('decompile.preparing')
  lastLog.value = ''
  try {
    const result = await window.api.decompile.start(jarPath)
    ElMessage.success(t('decompile.done', { n: result.fileCount }))
    await reloadWorkspaces()
    selectWorkspace(result.outDir)
  } catch (err) {
    ElMessage.error(t('decompile.failed', { error: (err as Error).message }))
  } finally {
    running.value = false
  }
}

function selectWorkspace(root: string): void {
  activeRoot.value = root
  activeFile.value = ''
  activeContent.value = ''
  query.value = ''
  searchResults.value = []
  // el-tree lazy 模式换根后需要整树重载
  treeRef.value?.store?.setData?.([])
}

async function loadTreeNode(
  node: Node,
  resolve: (nodes: FileNode[]) => void
): Promise<void> {
  const root = activeRoot.value
  if (!root) return resolve([])
  const rel = node.level === 0 ? '' : relOf((node.data as FileNode).path)
  try {
    resolve(await window.api.decompile.readDir(root, rel))
  } catch {
    resolve([])
  }
}

async function onNodeClick(data: FileNode): Promise<void> {
  if (data.kind !== 'file') return
  await openFile(data.path)
}

async function openFile(absPath: string): Promise<void> {
  const root = activeRoot.value
  if (!root) return
  try {
    const res = await window.api.decompile.readFile(root, relOf(absPath))
    activeFile.value = res.path
    activeContent.value = res.truncated
      ? `${res.content}\n// ${t('decompile.truncated')}`
      : res.content
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput(): void {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    const q = query.value.trim()
    if (!q || !activeRoot.value) {
      searchResults.value = []
      return
    }
    try {
      searchResults.value = await window.api.decompile.search(activeRoot.value, q)
    } catch {
      searchResults.value = []
    }
  }, 250)
}

async function onDeleteWorkspace(root: string): Promise<void> {
  try {
    await ElMessageBox.confirm(t('decompile.deleteConfirm'), t('decompile.deleteTitle'), {
      type: 'warning',
      confirmButtonText: t('decompile.deleteBtn'),
      cancelButtonText: t('common.cancel')
    })
  } catch {
    return
  }
  await window.api.decompile.deleteWorkspace(root)
  if (activeRoot.value === root) {
    activeRoot.value = ''
    activeFile.value = ''
  }
  await reloadWorkspaces()
}

async function revealFile(): Promise<void> {
  if (activeFile.value) await window.api.shell.showItemInFolder(activeFile.value)
}

const PHASE_KEY: Record<DecompileEvent['phase'], string> = {
  'tool-download': 'decompile.phase.toolDownload',
  running: 'decompile.phase.running',
  done: 'decompile.phase.done',
  error: 'decompile.phase.error'
}

let offEvent: (() => void) | null = null

onMounted(async () => {
  await Promise.all([loadToolStatus(), reloadWorkspaces()])
  offEvent = window.api.on(IpcChannels.DECOMPILE_EVENT, (...args: unknown[]) => {
    const ev = args[0] as DecompileEvent
    const key = PHASE_KEY[ev.phase]
    phaseText.value = key ? t(key) : ev.phase
    if (ev.message) lastLog.value = ev.message
  })
})

onBeforeUnmount(() => {
  offEvent?.()
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<style scoped>
.decompile-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 16px 20px;
  gap: 12px;
}

.dv-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.dv-heading h2 {
  margin: 0 0 6px;
  font-size: 18px;
}

.dv-heading p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  max-width: 640px;
}

.dv-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.dv-progress {
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
}

.dv-progress-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.dv-phase {
  font-weight: 600;
  flex-shrink: 0;
}

.dv-log {
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dv-body {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
}

.dv-aside {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  overflow: hidden;
}

.dv-ws-head {
  padding: 8px 12px;
  border-bottom: 1px solid var(--el-border-color);
}

.dv-ws-title {
  font-size: 13px;
  font-weight: 600;
}

.dv-ws-scroll {
  max-height: 180px;
}

.dv-ws-item {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}

.dv-ws-item:hover {
  background: var(--el-fill-color-light);
}

.dv-ws-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.dv-ws-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dv-ws-del {
  flex-shrink: 0;
}

.dv-tree-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--el-border-color);
  padding: 8px;
  gap: 8px;
}

.dv-tree-scroll {
  flex: 1;
  min-height: 0;
}

.dv-tree {
  --el-tree-node-content-height: 26px;
  font-size: 13px;
  background: transparent;
}

.dv-search-hit {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  cursor: pointer;
  font-size: 13px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dv-search-hit:hover {
  background: var(--el-fill-color-light);
}

.dv-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  overflow: hidden;
}

.dv-file-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--el-border-color);
  font-size: 13px;
}

.dv-file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-secondary);
}

.dv-editor {
  flex: 1;
  min-height: 0;
}

.dv-empty {
  flex: 1;
}
</style>
