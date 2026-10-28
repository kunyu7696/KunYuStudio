<template>
  <div ref="containerRef" class="dcv-container"></div>
</template>

<script setup lang="ts">
/**
 * 反编译产物只读代码查看器。
 * 独立于 CodeEditor.vue：不挂 editorStore / 诊断 / 自动保存链路，
 * 仅做 Monaco readOnly 展示；主题由 monaco/setup 的全局 MutationObserver 联动。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { monaco, currentMonacoTheme } from '../../monaco/setup'

const props = defineProps<{
  content: string
  language: string
}>()

const containerRef = ref<HTMLDivElement>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null

onMounted(() => {
  if (!containerRef.value) return
  editor = monaco.editor.create(containerRef.value, {
    theme: currentMonacoTheme(),
    language: props.language,
    value: props.content,
    readOnly: true,
    automaticLayout: true,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    fontSize: 13,
    renderWhitespace: 'selection',
    wordWrap: 'off'
  })
})

watch(
  () => [props.content, props.language] as const,
  ([content, language]) => {
    const model = editor?.getModel()
    if (!editor || !model) return
    if (model.getValue() !== content) model.setValue(content)
    monaco.editor.setModelLanguage(model, language)
    editor.setScrollTop(0)
  }
)

onBeforeUnmount(() => {
  const model = editor?.getModel()
  editor?.dispose()
  model?.dispose()
  editor = null
})
</script>

<style scoped>
.dcv-container {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
