<template>
  <div class="pse">
    <div v-if="snippetGroups.length > 0" class="pse-snippets">
      <div v-for="g in snippetGroups" :key="g.label" class="pse-group">
        <span class="pse-group-label">{{ g.label }}</span>
        <button
          v-for="s in g.items"
          :key="s.label"
          class="pse-chip"
          :title="s.hint ? `${s.hint}\n\n${s.text}` : s.text"
          @click="insert(s.text)"
        >
          {{ s.label }}
        </button>
      </div>
    </div>
    <div ref="hostRef" class="pse-host" />
    <p v-if="!ready" class="pse-loading">{{ t('pack.editorLoading') }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * PackSourceEditor：包编辑器的源码编辑（Monaco）。
 * 与资源管理器用的 CodeEditor 解耦：不接入 editor store（标签页/自动保存），
 * 仅负责内容双向绑定、语法高亮与片段插入；
 * Monaco 与自定义语言通过动态 import 加载，避免拖大包编辑器模块的首屏 chunk。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type * as MonacoNS from 'monaco-editor'
import { currentMonacoTheme } from '../../monaco/setup'
import type { SnippetGroup } from '../../../../shared/sourceSnippets'
import { t } from '../../i18n'

type MonacoApi = typeof import('monaco-editor')

const props = defineProps<{
  modelValue: string
  /** Monaco 语言 id（json / ini / glsl / mcfunction / plaintext） */
  language: string
  snippets?: SnippetGroup[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const hostRef = ref<HTMLDivElement>()
const ready = ref(false)
const snippetGroups = ref<SnippetGroup[]>(props.snippets ?? [])

let editor: MonacoNS.editor.IStandaloneCodeEditor | null = null
let monacoApi: MonacoApi | null = null
/** 外部写入（切换文件 / 表单同步）时置位，避免误判为用户编辑 */
let applyingExternal = false
let disposed = false

onMounted(async () => {
  const mod = await import('../../monaco/packLanguages')
  if (disposed) return
  mod.registerPackLanguages()
  if (!hostRef.value) return
  monacoApi = mod.monaco
  editor = monacoApi.editor.create(hostRef.value, {
    theme: currentMonacoTheme(),
    language: props.language,
    value: props.modelValue,
    automaticLayout: true,
    fontSize: 12,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    lineNumbers: 'on',
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'off',
    renderWhitespace: 'selection',
    fixedOverflowWidgets: true,
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 }
  })
  editor.onDidChangeModelContent(() => {
    if (applyingExternal || !editor) return
    emit('update:modelValue', editor.getValue())
  })
  ready.value = true
})

/** 在光标处插入片段（无光标时追加到末尾） */
function insert(text: string): void {
  if (!editor) {
    emit('update:modelValue', `${props.modelValue}${props.modelValue.endsWith('\n') ? '' : '\n'}${text}`)
    return
  }
  const sel = editor.getSelection()
  if (!sel) return
  editor.executeEdits('kunyu-snippet', [{ range: sel, text, forceMoveMarkers: true }])
  editor.focus()
}

defineExpose({ insert })

// 外部内容变化（切换文件、表单 → 源码同步）时刷新编辑器
watch(
  () => props.modelValue,
  (next) => {
    if (!editor) return
    if (editor.getValue() === next) return
    applyingExternal = true
    try {
      editor.setValue(next)
    } finally {
      applyingExternal = false
    }
  }
)

watch(
  () => props.language,
  (lang) => {
    const model = editor?.getModel()
    if (model && monacoApi) monacoApi.editor.setModelLanguage(model, lang)
  }
)

watch(
  () => props.snippets,
  (next) => {
    snippetGroups.value = next ?? []
  }
)

onBeforeUnmount(() => {
  disposed = true
  editor?.dispose()
  editor = null
})
</script>

<style scoped>
.pse {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
.pse-snippets {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 14px 4px;
  border-bottom: 1px solid var(--ky-border);
}
.pse-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.pse-group-label {
  font-size: 10.5px;
  color: var(--ky-text-dim);
  flex-shrink: 0;
}
.pse-chip {
  font-family: var(--ky-mono, monospace);
  font-size: 10.5px;
  line-height: 1;
  padding: 4px 7px;
  border-radius: 4px;
  border: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  color: var(--ky-text-sub);
  cursor: pointer;
}
.pse-chip:hover {
  border-color: var(--ky-accent);
  color: var(--ky-accent);
}
.pse-host {
  flex: 1;
  min-height: 0;
}
.pse-loading {
  position: absolute;
  inset: auto 14px 10px auto;
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
}
</style>