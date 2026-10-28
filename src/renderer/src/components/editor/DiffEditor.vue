<!--
  对比视图：左「run 前原文快照」右「当前磁盘内容」，双侧只读。
  由 editorStore.openDiff 打开为编辑器标签（diff:// 前缀路径），
  入口在运行详情「产物」段的文件变更行（对比按钮）。
-->
<template>
  <div class="diff-wrap">
    <div class="diff-head">
      <span class="diff-side">{{ t('diffEditor.before') }}</span>
      <span class="diff-title" :title="path">{{ path }}</span>
      <span class="diff-side">{{ t('diffEditor.after') }}</span>
    </div>
    <div ref="containerRef" class="diff-editor"></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { monaco, currentMonacoTheme } from '../../monaco/setup'
import { useSettingsStore } from '../../stores/settings'
import { t } from '../../i18n'

const props = defineProps<{
  /** 项目相对路径（标题/模型 uri 用） */
  path: string
  /** run 前原文快照（create 时为空串） */
  original: string
  /** 当前磁盘内容 */
  modified: string
  language: string
}>()

const containerRef = ref<HTMLDivElement>()
const appSettings = useSettingsStore()
let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null
let originalModel: monaco.editor.ITextModel | null = null
let modifiedModel: monaco.editor.ITextModel | null = null

onMounted(() => {
  if (!containerRef.value) return
  const es = appSettings.editor
  diffEditor = monaco.editor.createDiffEditor(containerRef.value, {
    theme: currentMonacoTheme(),
    automaticLayout: true,
    readOnly: true,
    originalEditable: false,
    renderSideBySide: true,
    fontSize: es.fontSize,
    fontFamily: es.fontFamily,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: es.lineNumbers ? 'on' : 'off',
    wordWrap: es.wordWrap ? 'on' : 'off'
  })
  // 模型 uri 必须全局唯一且不复用磁盘 file://，避免与 CodeEditor 的模型互相覆盖
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  originalModel = monaco.editor.createModel(
    props.original,
    props.language,
    monaco.Uri.parse(`inmemory://diff-original/${stamp}/${props.path}`)
  )
  modifiedModel = monaco.editor.createModel(
    props.modified,
    props.language,
    monaco.Uri.parse(`inmemory://diff-modified/${stamp}/${props.path}`)
  )
  diffEditor.setModel({ original: originalModel, modified: modifiedModel })
})

// 同一 diff 标签被重新打开（再次点对比）时刷新两侧内容
watch(
  () => [props.original, props.modified] as const,
  ([o, m]) => {
    if (originalModel && originalModel.getValue() !== o) originalModel.setValue(o)
    if (modifiedModel && modifiedModel.getValue() !== m) modifiedModel.setValue(m)
  }
)

onBeforeUnmount(() => {
  diffEditor?.dispose()
  originalModel?.dispose()
  modifiedModel?.dispose()
  diffEditor = null
  originalModel = null
  modifiedModel = null
})
</script>

<style scoped>
.diff-wrap {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}
.diff-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 12px;
  font-size: 11px;
  color: var(--ky-text-sub);
  border-bottom: 1px solid var(--ky-border);
  background: var(--ky-bg-panel);
}
.diff-title {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-family: var(--ky-font-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ky-text);
}
.diff-side {
  flex: 0 0 auto;
  opacity: 0.8;
}
.diff-editor {
  flex: 1;
  min-height: 0;
}
</style>
