<template>
  <div>
    <div
      class="tree-node"
      :class="{
        selected: explorer.selectedPath === node.path,
        directory: node.kind === 'directory',
        'drop-target': dropHover
      }"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      draggable="true"
      @click="onClick"
      @contextmenu="(e) => $emit('context', node, e)"
      @dblclick="onDblClick"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="dropHover = false"
      @drop="onDrop"
    >
      <el-icon class="tn-caret" v-if="node.kind === 'directory'">
        <component :is="expanded ? ArrowDown : ArrowRight" />
      </el-icon>
      <span v-else class="tn-caret-placeholder" />
      <el-icon class="tn-icon" :class="`tn-${iconKey}`">
        <component :is="iconComp" />
      </el-icon>
      <span class="tn-name">{{ node.name }}</span>
    </div>

    <div v-if="node.kind === 'directory' && expanded && node.children" class="tn-children">
      <TreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        @open-file="$emit('open-file', $event)"
        @context="(n, e) => $emit('context', n, e)"
        @move="(src, destDir) => $emit('move', src, destDir)"
      />
    </div>

    <div v-else-if="node.kind === 'directory' && expanded" class="tn-loading">
      <span class="tn-empty">{{ t('fileTree.emptyDir') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowDown,
  ArrowRight,
  Document,
  Folder,
  FolderOpened,
  Picture
} from '@element-plus/icons-vue'
import { useExplorerStore } from '../../stores/explorer'
import { t } from '../../i18n'
import type { FileNode } from '../../../../shared/types/fs'

const props = defineProps<{ node: FileNode; depth: number }>()
const emit = defineEmits<{
  (e: 'open-file', node: FileNode): void
  (e: 'context', node: FileNode, event: MouseEvent): void
  (e: 'move', src: string, destDir: string): void
}>()

const explorer = useExplorerStore()

const expanded = computed(() => explorer.expandedPaths.has(props.node.path))
/** 拖拽悬停高亮（仅目录节点接受 drop） */
const dropHover = ref(false)

/** 拖拽自定义 MIME：避免与外部文件拖入混淆（外部拖入是 Files 类型） */
const DND_MIME = 'application/x-kunyu-filemove'

function onClick(): void {
  explorer.select(props.node.path)
  if (props.node.kind === 'directory') {
    explorer.toggle(props.node.path, props.node.kind)
  } else {
    // 单击文件直接打开到 CodeEditor（不再需要双击）
    emit('open-file', props.node)
  }
}

function onDblClick(): void {
  // 双击文件也是打开（单击已做，这里做幂等安全）
  if (props.node.kind === 'file') emit('open-file', props.node)
}

function onDragStart(e: DragEvent): void {
  if (!e.dataTransfer) return
  e.dataTransfer.setData(DND_MIME, props.node.path)
  e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(e: DragEvent): void {
  if (props.node.kind !== 'directory') return
  if (!e.dataTransfer?.types.includes(DND_MIME)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  dropHover.value = true
}

function onDrop(e: DragEvent): void {
  dropHover.value = false
  if (props.node.kind !== 'directory') return
  const src = e.dataTransfer?.getData(DND_MIME)
  if (!src) return
  e.preventDefault()
  e.stopPropagation()
  if (src === props.node.path) return
  // 目录拖到自身子目录的非法情况由主进程 moveEntry 兜底拒绝
  emit('move', src, props.node.path)
}

/** 文件类型图标映射 */
const iconKey = computed(() => {
  if (props.node.kind === 'directory') return expanded.value ? 'folder-open' : 'folder'
  const ext = props.node.ext
  if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(ext)) return 'image'
  if (['java', 'kt', 'class', 'jar'].includes(ext)) return 'java'
  if (['json'].includes(ext)) return 'json'
  if (['gradle', 'properties', 'toml'].includes(ext)) return 'config'
  if (['md'].includes(ext)) return 'md'
  return 'file'
})

const iconComp = computed(() => {
  if (props.node.kind === 'directory') return expanded.value ? FolderOpened : Folder
  if (iconKey.value === 'image') return Picture
  return Document
})
</script>

<style scoped>
.tree-node {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding-right: 8px;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  color: var(--ky-text);
  border-radius: 3px;
}
.tree-node:hover {
  background: var(--ky-bg-hover);
}
.tree-node.drop-target {
  background: var(--ky-accent-soft);
  outline: 1px dashed var(--ky-accent);
  outline-offset: -1px;
}
.tree-node.selected {
  background: var(--ky-accent-soft);
  color: var(--ky-text);
}
.tn-caret {
  font-size: 11px;
  color: var(--ky-text-dim);
  flex-shrink: 0;
}
.tn-caret-placeholder {
  width: 11px;
  flex-shrink: 0;
}
.tn-icon {
  font-size: 14px;
  flex-shrink: 0;
}
.tn-folder,
.tn-folder-open {
  color: #f5c26b;
}
.tn-java {
  color: #f89820;
}
.tn-json {
  color: #cbcb41;
}
.tn-config {
  color: #859900;
}
.tn-image {
  color: #a37acc;
}
.tn-md {
  color: #519aba;
}
.tn-name {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12.5px;
}
.tn-children {
  min-height: 0;
}
.tn-loading {
  padding-left: 24px;
  color: var(--ky-text-dim);
  font-size: 12px;
  font-style: italic;
}
.tn-empty {
  color: var(--ky-text-dim);
}
</style>
