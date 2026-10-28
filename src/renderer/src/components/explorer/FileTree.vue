<template>
  <div class="file-tree" @click.self="explorer.select('')">
    <div v-if="!explorer.rootNode" class="ft-empty">
      <p>{{ t('fileTree.emptyProject') }}</p>
    </div>

    <div v-else class="ft-toolbar">
      <el-input
        v-model="searchQuery"
        size="small"
        clearable
        :placeholder="t('fileTree.searchPlaceholder')"
        :prefix-icon="Search"
        class="ft-search"
      />
      <el-button-group size="small">
        <el-button :icon="Plus" :title="t('fileTree.newFile')" @click="onNewFile(null)" />
        <el-button :icon="FolderAdd" :title="t('fileTree.newFolder')" @click="onNewFolder(null)" />
        <el-button :icon="Refresh" :title="t('fileTree.refresh')" @click="onRefresh" />
      </el-button-group>
    </div>

    <!-- 搜索结果：平铺列表（大小写不敏感子串匹配，上限 200 条） -->
    <div v-if="searchQuery.trim()" class="ft-root">
      <div v-if="searching" class="ft-search-hint">{{ t('fileTree.searching') }}</div>
      <template v-else>
        <div
          v-for="hit in searchResults"
          :key="hit.path"
          class="ft-search-item"
          @click="onOpenFile(hit)"
          @contextmenu="(e) => onContext(hit, e)"
        >
          <el-icon class="ft-search-icon"><Document /></el-icon>
          <div class="ft-search-text">
            <div class="ft-search-name">{{ hit.name }}</div>
            <div class="ft-search-path">{{ relativeToRoot(hit.path) }}</div>
          </div>
        </div>
        <div v-if="searchResults.length === 0" class="ft-search-hint">{{ t('fileTree.noMatch') }}</div>
      </template>
    </div>

    <div v-else-if="explorer.rootNode" class="ft-root">
      <TreeNode
        :node="explorer.rootNode"
        :depth="0"
        @open-file="onOpenFile"
        @context="onContext"
        @move="onMove"
      />
    </div>

    <!-- 上下文菜单 -->
    <teleport to="body">
      <ul
        v-if="ctxMenu.visible"
        class="ctx-menu"
        :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
        @click.stop
      >
        <li @click="onNewFile(ctxMenu.node)">
          <el-icon><DocumentAdd /></el-icon>{{ t('fileTree.newFile') }}
        </li>
        <li @click="onNewFolder(ctxMenu.node)">
          <el-icon><FolderAdd /></el-icon>{{ t('fileTree.newFolder') }}
        </li>
        <li v-if="ctxMenu.node" class="ctx-sep" />
        <li v-if="ctxMenu.node" @click="onCut"><el-icon><Scissor /></el-icon>{{ t('fileTree.cut') }}</li>
        <li v-if="clipboard" @click="onPaste(ctxMenu.node)">
          <el-icon><DocumentCopy /></el-icon
          >{{ t('fileTree.pasteWithName', { name: clipboard.name }) }}
        </li>
        <li v-if="ctxMenu.node" class="ctx-sep" />
        <li v-if="ctxMenu.node" @click="onRename">
          <el-icon><Edit /></el-icon>{{ t('fileTree.rename') }}
        </li>
        <li v-if="ctxMenu.node" @click="onDelete"><el-icon><Delete /></el-icon>{{ t('fileTree.delete') }}</li>
        <li v-if="ctxMenu.node" @click="onCopy">
          <el-icon><CopyDocument /></el-icon>{{ t('fileTree.copy') }}
        </li>
        <li v-if="ctxMenu.node" class="ctx-sep" />
        <li v-if="ctxMenu.node" @click="onReveal">
          <el-icon><FolderOpened /></el-icon>{{ t('fileTree.reveal') }}
        </li>
      </ul>
    </teleport>

    <!-- 新建/重命名输入弹窗 -->
    <el-dialog
      v-model="inputDialog.visible"
      :title="inputTitle"
      width="360px"
      :close-on-click-modal="false"
      @keyup.enter="confirmInput"
    >
      <el-input v-model="inputDialog.value" ref="inputRef" :placeholder="t('fileTree.namePlaceholder')" />
      <template #footer>
        <el-button @click="inputDialog.visible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="confirmInput">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CopyDocument,
  Delete,
  Document,
  DocumentAdd,
  DocumentCopy,
  Edit,
  FolderAdd,
  FolderOpened,
  Plus,
  Refresh,
  Scissor,
  Search
} from '@element-plus/icons-vue'
import TreeNode from './TreeNode.vue'
import { useExplorerStore } from '../../stores/explorer'
import { useEditorStore } from '../../stores/editor'
import { useUiStore } from '../../stores/ui'
import { t } from '../../i18n'
import type { FileNode } from '../../../../shared/types/fs'

const explorer = useExplorerStore()
const editor = useEditorStore()
const ui = useUiStore()

interface CtxState {
  visible: boolean
  x: number
  y: number
  node: FileNode | null
}
const ctxMenu = reactive<CtxState>({ visible: false, x: 0, y: 0, node: null })

/** 剪切板（仅剪切语义；粘贴 = move 到目标目录后清空） */
const clipboard = ref<FileNode | null>(null)

/** 文件名搜索（防抖 200ms；有查询时平铺展示结果替代树） */
const searchQuery = ref('')
const searchResults = ref<FileNode[]>([])
const searching = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchSeq = 0

watch(searchQuery, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  const query = q.trim()
  if (!query) {
    searchResults.value = []
    searching.value = false
    return
  }
  searching.value = true
  searchTimer = setTimeout(() => {
    const seq = ++searchSeq
    void window.api.fs
      .search(explorer.rootPath!, query)
      .then((hits) => {
        if (seq !== searchSeq) return // 已有更新的查询
        searchResults.value = hits
        searching.value = false
      })
      .catch(() => {
        if (seq !== searchSeq) return
        searchResults.value = []
        searching.value = false
      })
  }, 200)
})

/** 显示相对项目根的路径 */
function relativeToRoot(abs: string): string {
  const root = (explorer.rootPath ?? '').replace(/\\/g, '/')
  const norm = abs.replace(/\\/g, '/')
  return norm.startsWith(root) ? norm.slice(root.length).replace(/^\//, '') : norm
}

interface InputState {
  visible: boolean
  value: string
  mode: 'newFile' | 'newFolder' | 'rename' | 'copy'
  node: FileNode | null
}
const inputDialog = reactive<InputState>({
  visible: false,
  value: '',
  mode: 'newFile',
  node: null
})
const inputRef = ref()

/** 弹窗标题随模式与当前语言变化 */
const inputTitle = computed(() => {
  switch (inputDialog.mode) {
    case 'newFile':
      return t('fileTree.newFile')
    case 'newFolder':
      return t('fileTree.newFolder')
    case 'rename':
      return t('fileTree.rename')
    default:
      return t('fileTree.copyAs')
  }
})

function onOpenFile(node: FileNode): void {
  if (node.kind === 'file') {
    explorer.select(node.path)
    void editor.openFile(node)
    // 文件树同时挂在统一编辑器侧边栏：切到项目管理模块，右侧才会呈现标签
    ui.setActiveModule('project-manager')
  }
}

function onContext(node: FileNode | null, e: MouseEvent): void {
  e.preventDefault()
  e.stopPropagation()
  ctxMenu.node = node
  ctxMenu.x = e.clientX
  ctxMenu.y = e.clientY
  ctxMenu.visible = true
}

function closeCtx(): void {
  ctxMenu.visible = false
}

// 点击空白处关闭上下文菜单
if (typeof window !== 'undefined') {
  window.addEventListener('click', closeCtx)
}

function onNewFile(node: FileNode | null): void {
  closeCtx()
  inputDialog.mode = 'newFile'
  inputDialog.value = ''
  inputDialog.node = node
  inputDialog.visible = true
  nextTick(() => inputRef.value?.focus())
}

function onNewFolder(node: FileNode | null): void {
  closeCtx()
  inputDialog.mode = 'newFolder'
  inputDialog.value = ''
  inputDialog.node = node
  inputDialog.visible = true
  nextTick(() => inputRef.value?.focus())
}

function onRename(): void {
  if (!ctxMenu.node) return
  closeCtx()
  inputDialog.mode = 'rename'
  inputDialog.value = ctxMenu.node.name
  inputDialog.node = ctxMenu.node
  inputDialog.visible = true
  nextTick(() => inputRef.value?.select())
}

function onCopy(): void {
  if (!ctxMenu.node) return
  closeCtx()
  inputDialog.mode = 'copy'
  inputDialog.value = `${ctxMenu.node.name} (copy)`
  inputDialog.node = ctxMenu.node
  inputDialog.visible = true
}

function onCut(): void {
  if (!ctxMenu.node) return
  clipboard.value = ctxMenu.node
  closeCtx()
}

/** 粘贴目标目录：目录节点→其内部；文件节点→其父目录；空白→项目根 */
function pasteTargetDir(node: FileNode | null): string {
  if (!node) return explorer.rootPath!
  if (node.kind === 'directory') return node.path
  return node.path.replace(/[\\/][^\\/]+$/, '')
}

async function onPaste(node: FileNode | null): Promise<void> {
  const src = clipboard.value
  closeCtx()
  if (!src) return
  const destDir = pasteTargetDir(node)
  try {
    const newPath = await window.api.fs.move(src.path, destDir)
    clipboard.value = null
    ElMessage.success(t('fileTree.movedName', { name: src.name }))
    await afterMove(src.path, newPath, destDir)
  } catch (err) {
    ElMessage.error(String(err instanceof Error ? err.message : err))
  }
}

/** 拖拽移动（TreeNode move 事件） */
async function onMove(src: string, destDir: string): Promise<void> {
  try {
    const newPath = await window.api.fs.move(src, destDir)
    ElMessage.success(t('fileTree.moved'))
    await afterMove(src, newPath, destDir)
  } catch (err) {
    ElMessage.error(String(err instanceof Error ? err.message : err))
  }
}

/** 移动成功后的收尾：同步打开的 tab 路径 + 刷新源父目录与目标目录 */
async function afterMove(oldPath: string, newPath: string, destDir: string): Promise<void> {
  await handlePathChange(oldPath, newPath)
  const srcParent = oldPath.replace(/[\\/][^\\/]+$/, '')
  await explorer.refreshDir(srcParent || explorer.rootPath!)
  if (destDir !== srcParent) await explorer.refreshDir(destDir)
}

/** 在系统文件管理器中定位并选中该文件/文件夹 */
async function onReveal(): Promise<void> {
  if (!ctxMenu.node) return
  const target = ctxMenu.node
  closeCtx()
  const ok = await window.api.shell.showItemInFolder(target.path)
  if (!ok) ElMessage.warning(t('fileTree.revealFailed'))
}

async function onDelete(): Promise<void> {
  if (!ctxMenu.node) return
  const target = ctxMenu.node
  closeCtx()
  try {
    await ElMessageBox.confirm(
      t('fileTree.deleteConfirmBody', { name: target.name }),
      t('fileTree.deleteConfirmTitle'),
      { type: 'warning' }
    )
    await window.api.fs.delete(target.path)
    ElMessage.success(t('fileTree.deleted'))
    await refreshParent(target.path)
  } catch {
    /* 用户取消 */
  }
}

async function confirmInput(): Promise<void> {
  const name = inputDialog.value.trim()
  if (!name) {
    ElMessage.warning(t('fileTree.nameRequired'))
    return
  }
  try {
    if (inputDialog.mode === 'rename' && inputDialog.node) {
      const newPath = await window.api.fs.rename({
        oldPath: inputDialog.node.path,
        newName: name
      })
      // 更新已打开的标签页路径
      await handlePathChange(inputDialog.node.path, newPath)
      await refreshParent(inputDialog.node.path)
    } else if (inputDialog.mode === 'copy' && inputDialog.node) {
      const dest = `${inputDialog.node.path.replace(/[^\\/]+$/, '')}${name}`
      await window.api.fs.copy({ src: inputDialog.node.path, dest })
      await refreshParent(inputDialog.node.path)
    } else {
      // 新建文件/文件夹
      const parentPath =
        inputDialog.node?.kind === 'directory'
          ? inputDialog.node.path
          : explorer.rootPath!
      const kind = inputDialog.mode === 'newFolder' ? 'directory' : 'file'
      await window.api.fs.create({ parentPath, name, kind })
      if (inputDialog.node?.kind === 'directory') {
        await explorer.refreshDir(inputDialog.node.path)
      } else {
        await explorer.refreshAll()
      }
    }
    inputDialog.visible = false
  } catch (err) {
    ElMessage.error(String(err))
  }
}

/** 重命名后刷新父目录 */
async function refreshParent(childPath: string): Promise<void> {
  const parent = childPath.replace(/[\\/][^\\/]+$/, '')
  await explorer.refreshDir(parent || explorer.rootPath!)
}

/** 路径变更时同步编辑器标签 */
async function handlePathChange(oldPath: string, newPath: string): Promise<void> {
  const tab = editor.tabs.find((t: { path: string }) => t.path === oldPath)
  if (tab) {
    const node = await window.api.fs.stat(newPath)
    if (node) {
      await editor.closeTab(oldPath)
      await editor.openFile(node)
    }
  }
}

function onRefresh(): void {
  void explorer.refreshAll()
}
</script>

<style scoped>
.file-tree {
  height: 100%;
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.ft-empty {
  padding: 16px;
  color: var(--ky-text-dim);
  font-size: 12px;
}
.ft-toolbar {
  padding: 6px 8px;
  border-bottom: 1px solid var(--ky-border);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.ft-search {
  flex: 1;
  min-width: 0;
}
.ft-toolbar :deep(.el-button) {
  padding: 4px 8px;
}
.ft-search-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  cursor: pointer;
  color: var(--ky-text);
}
.ft-search-item:hover {
  background: var(--ky-bg-hover);
}
.ft-search-icon {
  flex-shrink: 0;
  color: var(--ky-text-dim);
}
.ft-search-text {
  min-width: 0;
}
.ft-search-name {
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ft-search-path {
  font-size: 11px;
  color: var(--ky-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ft-search-hint {
  padding: 16px;
  text-align: center;
  color: var(--ky-text-dim);
  font-size: 12px;
}
.ft-root {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
}
.ctx-menu {
  position: fixed;
  z-index: 9999;
  list-style: none;
  margin: 0;
  padding: 4px 0;
  background: var(--ky-bg-panel);
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
  min-width: 140px;
}
.ctx-menu li {
  padding: 7px 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ky-text);
  font-size: 13px;
}
.ctx-menu li:hover {
  background: var(--ky-accent);
  color: #fff;
}
.ctx-sep {
  height: 1px;
  padding: 0 !important;
  margin: 4px 0;
  background: var(--ky-border);
  cursor: default !important;
}
.ctx-sep:hover {
  background: var(--ky-border) !important;
}
</style>
