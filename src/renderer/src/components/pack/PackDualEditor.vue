<template>
  <div class="pde">
    <div class="pde-bar">
      <el-radio-group
        v-if="form"
        :key="modeEpoch"
        :model-value="mode"
        size="small"
        class="pde-mode"
        @change="onModeChange"
      >
        <el-radio-button value="form">{{ t('pack.form') }}</el-radio-button>
        <el-radio-button value="source">{{ t('pack.source') }}</el-radio-button>
      </el-radio-group>
      <el-tag v-else size="small" type="info" effect="plain" class="pde-tag">{{ t('pack.sourceOnly') }}</el-tag>
      <span class="pde-hint">{{ activeHint }}</span>
    </div>
    <div class="pde-body">
      <div v-if="showForm" class="pde-form">
        <component
          :is="formRenderer"
          v-if="formRenderer"
          :model-value="formValue"
          @update:model-value="onFormUpdate"
        />
        <SchemaForm
          v-else
          :schema="formSchema"
          :model-value="formValue"
          root
          @update:model-value="onFormUpdate"
        />
      </div>
      <PackSourceEditor
        v-else
        :model-value="sourceText"
        :language="language"
        :snippets="snippets"
        @update:model-value="onSourceUpdate"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * PackDualEditor：包编辑器「表单 / 源码」双模式编辑区。
 *
 * 表单模式渲染数据驱动的 SchemaForm，源码模式使用 Monaco；
 * 模式切换时双向同步内容：
 * - 表单 → 源码：按当前表单值重新生成文本（含原文档未覆盖字段）
 * - 源码 → 表单：解析文本为表单值，解析失败则保留源码模式并提示
 * 保存文本由调用方按当前模式生成（表单模式走 form.serialize），保证两种模式落盘内容一致。
 */
import { computed, ref, type Component } from 'vue'
import { ElMessage } from 'element-plus'
import type { JsonSchema } from '../../../../shared/schemas/jsonSchema'
import type { CategoryForm } from '../../../../shared/schemas/forms'
import type { SnippetGroup } from '../../../../shared/sourceSnippets'
import SchemaForm from './SchemaForm.vue'
import PackSourceEditor from './PackSourceEditor.vue'
import { t } from '../../i18n'

const props = defineProps<{
  /** 类别表单定义；null 表示该内容仅支持源码模式 */
  form: CategoryForm | null
  mode: 'form' | 'source'
  sourceText: string
  formValue: Record<string, unknown>
  /** 原文档上下文（由调用方保管，模式切换时透传） */
  formContext: unknown
  /** 源码模式语言（Monaco 语言 id） */
  language: string
  /**
   * 自定义表单渲染器（可选）：递归/树形等 JsonSchema 表达不了的内容
   * 由此组件接管表单模式；契约同 SchemaForm（modelValue + update:modelValue）
   */
  formRenderer?: Component
  snippets?: SnippetGroup[]
  /** 表单不可用时的源码提示（覆盖 form.sourceHint） */
  sourceHint?: string
}>()

const emit = defineEmits<{
  (e: 'update:mode', v: 'form' | 'source'): void
  (e: 'update:sourceText', v: string): void
  (e: 'update:formValue', v: Record<string, unknown>): void
  (e: 'update:formContext', v: unknown): void
  /** 用户产生了修改（用于未保存标记） */
  (e: 'change'): void
}>()

/** 切换开关的重挂载计数：解析失败时不切换模式，用于复位开关显示 */
const modeEpoch = ref(0)

const showForm = computed(() => props.form !== null && props.mode === 'form')
const formSchema = computed<JsonSchema>(() => props.form?.schema ?? { type: 'object' })
const activeHint = computed(() => {
  if (showForm.value) return props.form?.formHint ?? ''
  // 有表单但当前在源码模式时用表单自带的源码提示；仅源码类别才用调用方的提示
  if (props.form) return props.form.sourceHint
  return props.sourceHint || ''
})

function onModeChange(v: string | number | boolean | undefined): void {
  const next = v === 'source' ? 'source' : 'form'
  const form = props.form
  modeEpoch.value += 1
  if (!form || next === props.mode) return
  if (next === 'source') {
    emit('update:sourceText', form.serialize(props.formValue, props.formContext))
    emit('update:mode', 'source')
    return
  }
  const doc = form.parse(props.sourceText)
  if (!doc) {
    ElMessage.warning(t('pack.sourceParseFailed'))
    return
  }
  emit('update:formValue', doc.value)
  emit('update:formContext', doc.context)
  emit('update:mode', 'form')
  emit('change')
}

function onFormUpdate(v: unknown): void {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    emit('update:formValue', v as Record<string, unknown>)
    emit('change')
  }
}

function onSourceUpdate(v: string): void {
  emit('update:sourceText', v)
  emit('change')
}
</script>

<style scoped>
.pde {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.pde-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ky-border);
}
.pde-mode {
  flex-shrink: 0;
}
.pde-mode :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: var(--ky-accent);
  border-color: var(--ky-accent);
  color: #11111b;
  font-weight: 600;
  box-shadow: none;
}
.pde-tag {
  flex-shrink: 0;
}
.pde-hint {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  line-height: 1.5;
}
.pde-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.pde-form {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  max-width: 660px;
}
</style>