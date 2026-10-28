<template>
  <div class="sform" :class="{ 'sform-root': root }">
    <div v-if="!root" class="sform-head">
      <span class="sform-label">{{ labelText }}</span>
      <span v-if="required" class="sform-req">*</span>
    </div>
    <p v-if="schema.description" class="sform-desc">{{ schema.description }}</p>

    <!-- 枚举：下拉 -->
    <el-select
      v-if="schema.enum"
      :model-value="selectValue"
      size="small"
      class="sform-ctl"
      @update:model-value="emitUpdate"
    >
      <el-option v-for="opt in enumOptions" :key="opt.label" :label="opt.label" :value="opt.value" />
    </el-select>

    <!-- 动态键对象：键由用户输入（语言键、音效事件名、配方字母表） -->
    <div v-else-if="schema.keyValue" class="sform-kv">
      <div class="sform-kv-head">
        <span class="sform-kv-col">{{ kvTitles.key }}</span>
        <span class="sform-kv-col">{{ kvTitles.value }}</span>
        <span class="sform-kv-spacer" />
      </div>
      <div v-for="(entry, i) in kvEntries" :key="i" class="sform-kv-row">
        <el-input
          :model-value="entry.key"
          size="small"
          class="sform-kv-key"
          :placeholder="kvKeyPlaceholder"
          @update:model-value="(v: string) => renameKey(i, v)"
        />
        <SchemaForm
          v-if="kvNested"
          class="sform-kv-nested"
          :schema="kvValueSchema"
          :model-value="entry.value"
          @update:model-value="(v: unknown) => updateKvValue(i, v)"
        />
        <el-input
          v-else-if="kvScalar === 'string'"
          :model-value="entry.value == null ? '' : String(entry.value)"
          size="small"
          class="sform-kv-val"
          :placeholder="kvValuePlaceholder"
          @update:model-value="(v: string) => updateKvValue(i, v)"
        />
        <el-input-number
          v-else-if="kvScalar === 'number'"
          :model-value="Number(entry.value ?? 0)"
          size="small"
          class="sform-kv-val"
          @update:model-value="(v?: number) => updateKvValue(i, v ?? 0)"
        />
        <el-switch
          v-else
          :model-value="Boolean(entry.value)"
          @update:model-value="(v?: boolean | string | number) => updateKvValue(i, Boolean(v))"
        />
        <el-icon class="sform-kv-del" :title="t('pack.removeKey')" @click="removeKey(i)"><Delete /></el-icon>
      </div>
      <el-button size="small" class="sform-kv-add" @click="addKey">
        <el-icon><Plus /></el-icon> {{ t('pack.addKey', { title: kvTitles.key }) }}
      </el-button>
    </div>

    <!-- 对象：递归渲染属性 -->
    <div v-else-if="schema.type === 'object'" class="sform-obj">
      <SchemaForm
        v-for="(child, key) in schema.properties"
        :key="key"
        :schema="child"
        :model-value="asObject(modelValue)[key]"
        :label="child.title ?? String(key)"
        :required="isRequired(String(key))"
        @update:model-value="(v: unknown) => updateChild(String(key), v)"
      />
      <p v-if="!schema.properties || Object.keys(schema.properties).length === 0" class="sform-hint">
        {{ t('pack.emptyObjectForm') }}
      </p>
    </div>

    <!-- 数组：行内编辑 + 增删 -->
    <div v-else-if="schema.type === 'array'" class="sform-arr">
      <div v-for="(item, i) in asArray(modelValue)" :key="i" class="sform-arr-row">
        <SchemaForm
          v-if="isNestedItem"
          class="sform-arr-nested"
          :schema="itemsSchema"
          :model-value="item"
          :label="`#${i + 1}`"
          @update:model-value="(v: unknown) => updateItem(i, v)"
        />
        <template v-else>
          <el-input
            v-if="itemsSchema.type === 'string'"
            :model-value="item == null ? '' : String(item)"
            size="small"
            class="sform-arr-ctl"
            @update:model-value="(v: string) => updateItem(i, v)"
          />
          <el-input-number
            v-else-if="itemsSchema.type === 'number' || itemsSchema.type === 'integer'"
            :model-value="Number(item ?? 0)"
            size="small"
            class="sform-arr-ctl"
            :precision="itemsSchema.type === 'integer' ? 0 : undefined"
            @update:model-value="(v?: number) => updateItem(i, v ?? 0)"
          />
          <el-switch
            v-else-if="itemsSchema.type === 'boolean'"
            :model-value="Boolean(item)"
            @update:model-value="(v?: boolean | string | number) => updateItem(i, Boolean(v))"
          />
          <span v-else class="sform-arr-plain">{{ item }}</span>
        </template>
        <el-icon class="sform-arr-del" :title="t('pack.removeItem')" @click="removeItem(i)"><Delete /></el-icon>
      </div>
      <el-button size="small" class="sform-arr-add" @click="addItem">
        <el-icon><Plus /></el-icon> {{ t('pack.addItem') }}
      </el-button>
    </div>

    <!-- 数字 -->
    <el-input-number
      v-else-if="schema.type === 'number' || schema.type === 'integer'"
      :model-value="Number(modelValue ?? 0)"
      size="small"
      class="sform-ctl"
      :step="schema.type === 'integer' ? 1 : 0.1"
      :precision="schema.type === 'integer' ? 0 : undefined"
      @update:model-value="(v?: number) => emitUpdate(v ?? 0)"
    />

    <!-- 布尔 -->
    <el-switch
      v-else-if="schema.type === 'boolean'"
      :model-value="Boolean(modelValue)"
      @update:model-value="(v?: boolean | string | number) => emitUpdate(Boolean(v))"
    />

    <!-- 字符串兜底 -->
    <el-input
      v-else
      :model-value="modelValue == null ? '' : String(modelValue)"
      size="small"
      class="sform-ctl"
      @update:model-value="emitUpdate"
    />

    <p v-if="schema.hint && !schema.enum" class="sform-hint">{{ schema.hint }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * SchemaForm：JSON Schema（draft-07 子集）驱动的递归表单。
 * 支持 object / string / number / integer / boolean / array / enum / keyValue（动态键对象）；
 * 被数据包、资源包、光影包三个包编辑器共用，表单只覆盖字段子集，
 * 调用方保存时把表单值合并回原文档以保留未覆盖字段。
 */
import { computed } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import type { JsonSchema } from '../../../../shared/schemas/jsonSchema'
import { t } from '../../i18n'

defineOptions({ name: 'SchemaForm' })

const props = defineProps<{
  schema: JsonSchema
  modelValue?: unknown
  /** 覆盖 schema.title 的展示标签（object 属性键名兜底） */
  label?: string
  /** 是否必填（head 中标 *） */
  required?: boolean
  /** 根节点：不渲染自身标签（由外层容器提供标题） */
  root?: boolean
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: unknown): void }>()

const labelText = computed(() => props.label ?? props.schema.title ?? '')
/** 数组元素结构（缺省按字符串处理） */
const itemsSchema = computed<JsonSchema>(() => props.schema.items ?? { type: 'string' })
/** 数组元素是否为嵌套结构（object/array 递归渲染，其余行内控件） */
const isNestedItem = computed(
  () => itemsSchema.value.type === 'object' || itemsSchema.value.type === 'array'
)
/** 枚举选项（值收窄为 Element Plus 可接受的标量类型，标签取 enumLabels） */
const enumOptions = computed<{ value: string | number | boolean; label: string }[]>(() =>
  (props.schema.enum ?? []).map((opt, i) => ({
    value: (opt ?? '') as string | number | boolean,
    label: props.schema.enumLabels?.[i] ?? String(opt)
  }))
)
const selectValue = computed(() =>
  props.modelValue == null ? undefined : (props.modelValue as string | number | boolean)
)

// ---- 动态键对象 ----
const kvTitles = computed(() => ({
  key: props.schema.keyValue?.keyTitle ?? t('pack.key'),
  value: props.schema.keyValue?.valueTitle ?? t('pack.value')
}))
const kvValueSchema = computed<JsonSchema>(
  () => props.schema.keyValue?.valueSchema ?? { type: 'string' }
)
const kvKeyPlaceholder = computed(() => props.schema.keyValue?.keyPlaceholder ?? '')
const kvValuePlaceholder = computed(() => props.schema.keyValue?.valuePlaceholder ?? '')
const kvNested = computed(
  () => kvValueSchema.value.type === 'object' || kvValueSchema.value.type === 'array'
)
/** 标量值控件类型（string / number / boolean） */
const kvScalar = computed(() => kvValueSchema.value.type ?? 'string')
const kvEntries = computed<{ key: string; value: unknown }[]>(() =>
  Object.entries(asObject(props.modelValue)).map(([key, value]) => ({ key, value }))
)

function commitKv(entries: { key: string; value: unknown }[]): void {
  const out: Record<string, unknown> = {}
  for (const e of entries) out[e.key] = e.value
  emitUpdate(out)
}

function renameKey(i: number, key: string): void {
  const entries = [...kvEntries.value]
  entries[i] = { key, value: entries[i].value }
  commitKv(entries)
}

function updateKvValue(i: number, value: unknown): void {
  const entries = [...kvEntries.value]
  entries[i] = { key: entries[i].key, value }
  commitKv(entries)
}

function removeKey(i: number): void {
  commitKv(kvEntries.value.filter((_, idx) => idx !== i))
}

function addKey(): void {
  const entries = [...kvEntries.value]
  // 生成不与现有键冲突的占位键，用户可直接改名
  let n = entries.length + 1
  let key = `new_key_${n}`
  while (entries.some((e) => e.key === key)) {
    n += 1
    key = `new_key_${n}`
  }
  entries.push({ key, value: kvValueSchema.value.type === 'object' ? {} : '' })
  commitKv(entries)
}

function emitUpdate(v: unknown): void {
  emit('update:modelValue', v)
}

function isRequired(key: string): boolean {
  return (props.schema.required ?? []).includes(key)
}

function asObject(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function updateChild(key: string, v: unknown): void {
  emitUpdate({ ...asObject(props.modelValue), [key]: v })
}

function updateItem(i: number, v: unknown): void {
  const arr = [...asArray(props.modelValue)]
  arr[i] = v
  emitUpdate(arr)
}

function removeItem(i: number): void {
  emitUpdate(asArray(props.modelValue).filter((_, idx) => idx !== i))
}

function addItem(): void {
  const t = itemsSchema.value.type
  const blank: unknown =
    t === 'object' ? {} : t === 'boolean' ? false : t === 'number' || t === 'integer' ? 0 : ''
  emitUpdate([...asArray(props.modelValue), blank])
}
</script>

<style scoped>
.sform {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.sform-root {
  gap: 10px;
}
.sform-head {
  display: flex;
  align-items: center;
  gap: 4px;
}
.sform-label {
  font-size: 11px;
  color: var(--ky-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sform-req {
  color: #f38ba8;
  font-size: 11px;
}
.sform-desc {
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  opacity: 0.85;
  line-height: 1.5;
}
.sform-hint {
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  opacity: 0.8;
  line-height: 1.5;
}
.sform-ctl {
  max-width: 100%;
}
.sform-obj {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
/* 对象子字段缩进一档，体现层级 */
.sform-obj > .sform {
  padding-left: 10px;
  border-left: 1px solid var(--ky-border);
}
.sform-arr {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.sform-arr-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.sform-arr-nested {
  flex: 1;
  min-width: 0;
}
.sform-arr-ctl {
  flex: 1;
  min-width: 0;
}
.sform-arr-plain {
  flex: 1;
  font-size: 12px;
  color: var(--ky-text-sub);
  word-break: break-all;
}
.sform-arr-del,
.sform-kv-del {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--ky-text-dim);
  cursor: pointer;
}
.sform-arr-del:hover,
.sform-kv-del:hover {
  color: #f38ba8;
}
.sform-arr-add {
  align-self: flex-start;
}
/* 动态键对象 */
.sform-kv {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.sform-kv-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sform-kv-col {
  flex: 1;
  min-width: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
}
.sform-kv-spacer {
  width: 13px;
  flex-shrink: 0;
}
.sform-kv-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-width: 0;
}
.sform-kv-row > .el-icon {
  margin-top: 6px;
}
.sform-kv-key {
  flex: 0 0 40%;
  min-width: 0;
}
.sform-kv-val {
  flex: 1;
  min-width: 0;
}
.sform-kv-nested {
  flex: 1;
  min-width: 0;
}
.sform-kv-add {
  align-self: flex-start;
}
</style>