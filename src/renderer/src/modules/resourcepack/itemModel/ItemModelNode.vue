<template>
  <div class="imn" :class="{ 'imn-deep': (depth ?? 0) > 0 }">
    <div class="imn-head">
      <el-select
        v-if="known"
        :model-value="type"
        size="small"
        class="imn-type"
        @update:model-value="changeType"
      >
        <el-option
          v-for="ty in ITEM_MODEL_TYPES"
          :key="ty"
          :value="ty"
          :label="typeLabel(ty)"
        />
      </el-select>
      <template v-else>
        <el-tag size="small" type="warning" effect="plain">{{ type }}</el-tag>
        <span class="imn-unknown">{{ t('resourcepack.itemModel.unknownType') }}</span>
      </template>
    </div>

    <template v-if="known && !tooDeep">
      <!-- model：模型引用 -->
      <div v-if="type === 'minecraft:model'" class="imn-row">
        <label class="imn-label">{{ t('resourcepack.itemModel.modelPath') }} <span class="imn-req">*</span></label>
        <el-input
          :model-value="str(node.model)"
          size="small"
          :placeholder="t('resourcepack.itemModel.modelPlaceholder')"
          @update:model-value="(v: string) => patch('model', v)"
        />
      </div>

      <!-- condition：property + on_true / on_false -->
      <template v-else-if="type === 'minecraft:condition'">
        <div class="imn-row">
          <label class="imn-label">{{ t('resourcepack.itemModel.conditionProperty') }} <span class="imn-req">*</span></label>
          <el-select
            :model-value="str(node.property)"
            size="small"
            filterable
            allow-create
            default-first-option
            :placeholder="t('resourcepack.itemModel.conditionPlaceholder')"
            @update:model-value="(v: string) => patch('property', v)"
          >
            <el-option v-for="p in CONDITION_PROPERTIES" :key="p" :value="p" :label="p" />
          </el-select>
        </div>
        <div class="imn-child">
          <p class="imn-child-label">{{ t('resourcepack.itemModel.onTrue') }}</p>
          <ItemModelNode :model-value="child(node.on_true)" :depth="(depth ?? 0) + 1" @update:model-value="(v) => patch('on_true', v)" />
        </div>
        <div class="imn-child">
          <p class="imn-child-label">{{ t('resourcepack.itemModel.onFalse') }}</p>
          <ItemModelNode :model-value="child(node.on_false)" :depth="(depth ?? 0) + 1" @update:model-value="(v) => patch('on_false', v)" />
        </div>
      </template>

      <!-- select：property + cases + fallback -->
      <template v-else-if="type === 'minecraft:select'">
        <div class="imn-row">
          <label class="imn-label">{{ t('resourcepack.itemModel.selectProperty') }} <span class="imn-req">*</span></label>
          <el-select
            :model-value="str(node.property)"
            size="small"
            filterable
            allow-create
            default-first-option
            :placeholder="t('resourcepack.itemModel.selectPlaceholder')"
            @update:model-value="(v: string) => patch('property', v)"
          >
            <el-option v-for="p in SELECT_PROPERTIES" :key="p" :value="p" :label="p" />
          </el-select>
        </div>
        <div v-for="(c, i) in cases" :key="i" class="imn-case">
          <div class="imn-case-head">
            <span class="imn-child-label">{{ t('resourcepack.itemModel.branch', { index: i + 1 }) }}</span>
            <el-icon class="imn-del" :title="t('resourcepack.itemModel.deleteBranch')" @click="removeCase(i)"><Delete /></el-icon>
          </div>
          <el-input
            :model-value="whenText(c)"
            size="small"
            :placeholder="t('resourcepack.itemModel.whenPlaceholder')"
            @update:model-value="(v: string) => patchWhen(i, v)"
          />
          <ItemModelNode :model-value="child(c.model)" :depth="(depth ?? 0) + 1" @update:model-value="(v) => patchCaseModel(i, v)" />
        </div>
        <el-button size="small" class="imn-add" @click="addCase">
          <el-icon><Plus /></el-icon> {{ t('resourcepack.itemModel.addBranch') }}
        </el-button>
        <div class="imn-child">
          <div class="imn-case-head">
            <p class="imn-child-label">{{ t('resourcepack.itemModel.fallback') }}</p>
            <el-button v-if="node.fallback === undefined" size="small" text @click="patch('fallback', createItemModelDefinition('minecraft:model'))">{{ t('resourcepack.itemModel.enableFallback') }}</el-button>
            <el-icon v-else class="imn-del" :title="t('resourcepack.itemModel.removeFallback')" @click="patch('fallback', undefined)"><Delete /></el-icon>
          </div>
          <ItemModelNode v-if="node.fallback !== undefined" :model-value="child(node.fallback)" :depth="(depth ?? 0) + 1" @update:model-value="(v) => patch('fallback', v)" />
        </div>
      </template>

      <!-- range_dispatch：property + scale + entries + fallback -->
      <template v-else-if="type === 'minecraft:range_dispatch'">
        <div class="imn-row">
          <label class="imn-label">{{ t('resourcepack.itemModel.rangeProperty') }} <span class="imn-req">*</span></label>
          <el-select
            :model-value="str(node.property)"
            size="small"
            filterable
            allow-create
            default-first-option
            :placeholder="t('resourcepack.itemModel.rangePlaceholder')"
            @update:model-value="(v: string) => patch('property', v)"
          >
            <el-option v-for="p in RANGE_DISPATCH_PROPERTIES" :key="p" :value="p" :label="p" />
          </el-select>
        </div>
        <div class="imn-row">
          <label class="imn-label">{{ t('resourcepack.itemModel.scale') }}</label>
          <el-input-number
            :model-value="num(node.scale, 1)"
            size="small"
            :step="0.1"
            @update:model-value="(v?: number) => patch('scale', v ?? 1)"
          />
        </div>
        <div v-for="(e, i) in entries" :key="i" class="imn-case">
          <div class="imn-case-head">
            <span class="imn-child-label">{{ t('resourcepack.itemModel.tier', { index: i + 1 }) }}</span>
            <el-icon class="imn-del" :title="t('resourcepack.itemModel.deleteTier')" @click="removeEntry(i)"><Delete /></el-icon>
          </div>
          <div class="imn-row">
            <label class="imn-label">{{ t('resourcepack.itemModel.threshold') }}</label>
            <el-input-number
              :model-value="num(e.threshold, 0)"
              size="small"
              :step="0.05"
              @update:model-value="(v?: number) => patchEntryThreshold(i, v ?? 0)"
            />
          </div>
          <ItemModelNode :model-value="child(e.model)" :depth="(depth ?? 0) + 1" @update:model-value="(v) => patchEntryModel(i, v)" />
        </div>
        <el-button size="small" class="imn-add" @click="addEntry">
          <el-icon><Plus /></el-icon> {{ t('resourcepack.itemModel.addTier') }}
        </el-button>
        <div class="imn-child">
          <div class="imn-case-head">
            <p class="imn-child-label">{{ t('resourcepack.itemModel.fallback') }}</p>
            <el-button v-if="node.fallback === undefined" size="small" text @click="patch('fallback', createItemModelDefinition('minecraft:model'))">{{ t('resourcepack.itemModel.enableFallback') }}</el-button>
            <el-icon v-else class="imn-del" :title="t('resourcepack.itemModel.removeFallback')" @click="patch('fallback', undefined)"><Delete /></el-icon>
          </div>
          <ItemModelNode v-if="node.fallback !== undefined" :model-value="child(node.fallback)" :depth="(depth ?? 0) + 1" @update:model-value="(v) => patch('fallback', v)" />
        </div>
      </template>

      <!-- composite：models 数组（靠后垫底） -->
      <template v-else-if="type === 'minecraft:composite'">
        <p class="imn-hint">{{ t('resourcepack.itemModel.compositeHint') }}</p>
        <div v-for="(m, i) in layers" :key="i" class="imn-case">
          <div class="imn-case-head">
            <span class="imn-child-label">{{ t('resourcepack.itemModel.layer', { index: i + 1 }) }}{{ i === 0 ? t('resourcepack.itemModel.topLayer') : '' }}</span>
            <el-icon class="imn-del" :title="t('resourcepack.itemModel.deleteLayer')" @click="removeLayer(i)"><Delete /></el-icon>
          </div>
          <ItemModelNode :model-value="child(m)" :depth="(depth ?? 0) + 1" @update:model-value="(v) => patchLayer(i, v)" />
        </div>
        <el-button size="small" class="imn-add" @click="addLayer">
          <el-icon><Plus /></el-icon> {{ t('resourcepack.itemModel.addLayer') }}
        </el-button>
      </template>

      <!-- empty：无字段 -->
      <p v-else class="imn-hint">{{ t('resourcepack.itemModel.emptyHint') }}</p>
    </template>

    <p v-else-if="known && tooDeep" class="imn-hint">
      {{ t('resourcepack.itemModel.tooDeep', { max: MAX_DEPTH }) }}
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * ItemModelNode：物品模型定义树的单个节点（递归自引用）。
 * 五种核心类型控件化编辑；未知类型只读保留；子节点变更全程不可变更新，
 * 未触碰字段（tints / transformation / 各 property 附加参数）原样保留。
 */
import { computed } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import type { ItemModelDefinition } from '../../../../../shared/schemas/resourcepack/itemModel'
import {
  CONDITION_PROPERTIES,
  getItemModelTypeLabels,
  ITEM_MODEL_TYPES,
  RANGE_DISPATCH_PROPERTIES,
  SELECT_PROPERTIES,
  createItemModelDefinition,
  isItemModelDefinition,
  isKnownItemModelType,
  itemModelTypeOf
} from '../../../../../shared/schemas/resourcepack/itemModel'
import { locale, t, te } from '../../../i18n'

defineOptions({ name: 'ItemModelNode' })

const props = defineProps<{
  modelValue: ItemModelDefinition
  depth?: number
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: ItemModelDefinition): void }>()

const MAX_DEPTH = 8

const node = computed(() => props.modelValue)
const type = computed(() => itemModelTypeOf(node.value))
const known = computed(() => isKnownItemModelType(type.value))
const tooDeep = computed(() => (props.depth ?? 0) >= MAX_DEPTH)

/** 类型名走语言包，缺失时回落共享注册表标签（随语言切换重算；新增类型不受影响） */
function typeLabel(typeId: string): string {
  const key = `resourcepack.itemModel.type.${typeId.replace('minecraft:', '')}`
  return te(key) ? t(key) : (getItemModelTypeLabels(locale.value)[typeId] ?? typeId)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function child(v: unknown): ItemModelDefinition {
  return isItemModelDefinition(v) ? v : createItemModelDefinition('minecraft:model')
}

/** 不可变更新单字段；value 为 undefined 时删除该键（用于可选 fallback） */
function patch(key: string, value: unknown): void {
  const next: ItemModelDefinition = { ...node.value }
  if (value === undefined) delete next[key]
  else next[key] = value
  emit('update:modelValue', next)
}

/** 切换类型：以新骨架为基础，尽量沿用旧节点的同名字段 */
function changeType(v: string | number | boolean | undefined): void {
  const t = String(v)
  const skeleton = createItemModelDefinition(t)
  const old = node.value
  for (const key of ['property', 'model', 'fallback', 'scale']) {
    if (old[key] !== undefined && key in skeleton) skeleton[key] = old[key]
  }
  emit('update:modelValue', skeleton)
}

// ---- select cases ----
interface SelectCase {
  when?: unknown
  model?: unknown
}
const cases = computed<SelectCase[]>(() =>
  Array.isArray(node.value.cases) ? (node.value.cases as SelectCase[]) : []
)

function commitCases(next: SelectCase[]): void {
  patch('cases', next)
}

/** when 可能是 string / string[] / 其他（component 匹配对象等）；数组按逗号文本编辑 */
function whenText(c: SelectCase): string {
  if (Array.isArray(c.when)) return c.when.map((w) => String(w)).join(', ')
  if (typeof c.when === 'string') return c.when
  return ''
}

function patchWhen(i: number, text: string): void {
  const next = [...cases.value]
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean)
  next[i] = { ...next[i], when: parts.length <= 1 ? (parts[0] ?? '') : parts }
  commitCases(next)
}

function patchCaseModel(i: number, v: ItemModelDefinition): void {
  const next = [...cases.value]
  next[i] = { ...next[i], model: v }
  commitCases(next)
}

function addCase(): void {
  commitCases([
    ...cases.value,
    { when: ['新分支'], model: createItemModelDefinition('minecraft:model') }
  ])
}

function removeCase(i: number): void {
  commitCases(cases.value.filter((_, idx) => idx !== i))
}

// ---- range_dispatch entries ----
interface RangeEntry {
  threshold?: unknown
  model?: unknown
}
const entries = computed<RangeEntry[]>(() =>
  Array.isArray(node.value.entries) ? (node.value.entries as RangeEntry[]) : []
)

function commitEntries(next: RangeEntry[]): void {
  patch('entries', next)
}

function patchEntryThreshold(i: number, v: number): void {
  const next = [...entries.value]
  next[i] = { ...next[i], threshold: v }
  commitEntries(next)
}

function patchEntryModel(i: number, v: ItemModelDefinition): void {
  const next = [...entries.value]
  next[i] = { ...next[i], model: v }
  commitEntries(next)
}

function addEntry(): void {
  const last = entries.value[entries.value.length - 1]
  const base = num(last?.threshold, 0)
  commitEntries([
    ...entries.value,
    { threshold: Math.round((base + 0.1) * 100) / 100, model: createItemModelDefinition('minecraft:model') }
  ])
}

function removeEntry(i: number): void {
  commitEntries(entries.value.filter((_, idx) => idx !== i))
}

// ---- composite layers ----
const layers = computed<unknown[]>(() => (Array.isArray(node.value.models) ? node.value.models : []))

function patchLayer(i: number, v: ItemModelDefinition): void {
  const next = [...layers.value]
  next[i] = v
  patch('models', next)
}

function addLayer(): void {
  patch('models', [...layers.value, createItemModelDefinition('minecraft:model')])
}

function removeLayer(i: number): void {
  patch('models', layers.value.filter((_, idx) => idx !== i))
}
</script>

<style scoped>
.imn {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.imn-deep {
  padding-left: 10px;
  border-left: 1px solid var(--ky-border);
}
.imn-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.imn-type {
  width: 220px;
}
.imn-unknown {
  font-size: 10.5px;
  color: var(--ky-text-dim);
  line-height: 1.5;
}
.imn-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.imn-label {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.imn-req {
  color: #f38ba8;
}
.imn-child {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.imn-child-label {
  margin: 0;
  font-size: 11px;
  color: var(--ky-text-dim);
}
.imn-case {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--ky-border);
  border-radius: 6px;
}
.imn-case-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.imn-del {
  font-size: 13px;
  color: var(--ky-text-dim);
  cursor: pointer;
}
.imn-del:hover {
  color: #f38ba8;
}
.imn-add {
  align-self: flex-start;
}
.imn-hint {
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  opacity: 0.85;
  line-height: 1.5;
}
</style>
