<template>
  <div class="crafting">
    <!-- shaped：3x3 grid -->
    <template v-if="mode === 'shaped'">
      <div class="cg-header">
        <span class="cg-title">{{ t('craftingGrid.shapedTitle') }}</span>
      </div>
      <div class="cg-grid">
        <div v-for="(row, ri) in rows" :key="ri" class="cg-row">
          <ItemSlot
            v-for="(ing, ci) in row"
            :key="ci"
            :item="ing?.item ?? ''"
            :count="1"
            class="cg-slot"
            @pick="openPicker(`shaped:${ri},${ci}`)"
            @clear="clearShapedSlot(ri, ci)"
          />
        </div>
      </div>
      <div class="cg-keys">
        <div
          v-for="(v, k) in keys"
          :key="k"
          class="cg-key"
        >
          <span class="cg-key-char">{{ k }}</span>
          <span class="cg-key-arrow">→</span>
          <span class="cg-key-item">{{ v.item }}</span>
        </div>
        <span v-if="Object.keys(keys).length === 0" class="cg-keys-hint">{{ t('craftingGrid.keysHint') }}</span>
      </div>
    </template>

    <!-- shapeless：可增删的物品列表 -->
    <template v-else-if="mode === 'shapeless'">
      <div class="cg-header">
        <span class="cg-title">{{ t('craftingGrid.shapelessTitle') }}</span>
        <el-button size="small" :icon="Plus" @click="addShapeless">{{ t('craftingGrid.addItem') }}</el-button>
      </div>
      <div class="cg-shapeless">
        <div v-for="(ing, idx) in ingredients" :key="idx" class="cg-shapeless-row">
          <ItemSlot
            :item="ing.item"
            class="cg-slot"
            @pick="openPicker(`shapeless:${idx}`)"
            @clear="removeShapeless(idx)"
          />
          <el-input-number
            v-model="ing.count"
            :min="1"
            :max="64"
            size="small"
            controls-position="right"
            class="cg-count"
          />
          <el-button size="small" text type="danger" @click="removeShapeless(idx)">{{ t('craftingGrid.remove') }}</el-button>
        </div>
        <p v-if="(ingredients ?? []).length === 0" class="cg-empty">{{ t('craftingGrid.emptyShapeless') }}</p>
      </div>
    </template>

    <!-- smelting：单槽输入 + 经验 + 时间 -->
    <template v-else>
      <div class="cg-header">
        <span class="cg-title">{{ t('craftingGrid.furnace') }}</span>
      </div>
      <div class="cg-smelting">
        <div class="cg-smelt-row">
          <div class="cg-smelt-label">{{ t('craftingGrid.inputItem') }}</div>
          <ItemSlot
            :item="input ?? ''"
            class="cg-slot"
            @pick="openPicker('smelting:input')"
            @clear="$emit('update:input', '')"
          />
        </div>
        <div class="cg-smelt-row">
          <div class="cg-smelt-label">{{ t('craftingGrid.expReward') }}</div>
          <el-input-number
            :model-value="experience"
            :min="0"
            :max="100"
            size="small"
            controls-position="right"
            @change="(v) => $emit('update:experience', Number(v))"
          />
        </div>
        <div class="cg-smelt-row">
          <div class="cg-smelt-label">{{ t('craftingGrid.cookTime') }}</div>
          <el-input-number
            :model-value="cookingTime"
            :min="1"
            :max="72000"
            :step="20"
            size="small"
            controls-position="right"
            @change="(v) => $emit('update:cookingTime', Number(v))"
          />
          <span class="cg-smelt-hint">{{ t('craftingGrid.cookTimeHint') }}</span>
        </div>
      </div>
    </template>

    <!-- ItemPicker 弹层 -->
    <ItemPicker v-model="pickerVisible" :namespace="props.namespace" @select="onPick" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import ItemSlot from './ItemSlot.vue'
import ItemPicker from './ItemPicker.vue'
import { t } from '../../../i18n'
import type { RecipeIngredient, RecipeType } from '../../../../../shared/types/content'

const props = defineProps<{
  mode: RecipeType
  /** shaped 模式：3×3 行的物品引用，null 表示空 */
  grid?: (RecipeIngredient | null)[][]
  /** shapeless 模式：物品列表 */
  ingredients?: RecipeIngredient[]
  /** smelting 模式输入 */
  input?: string
  experience?: number
  cookingTime?: number
  /** 模组命名空间（用于 ItemPicker 的 :xxx 前缀补全） */
  namespace?: string
}>()

const emit = defineEmits<{
  (e: 'update:grid', v: (RecipeIngredient | null)[][]): void
  (e: 'update:ingredients', v: RecipeIngredient[]): void
  (e: 'update:input', v: string): void
  (e: 'update:experience', v: number): void
  (e: 'update:cookingTime', v: number): void
}>()

/** pick 弹层当前在哪个位置操作 */
const pickTarget = ref<string | null>(null)
const pickerVisible = ref(false)

function openPicker(target: string): void {
  pickTarget.value = target
  pickerVisible.value = true
}

function onPick(itemId: string): void {
  const target = pickTarget.value
  if (!target) return
  if (target.startsWith('shaped:')) {
    const [, pos] = target.split(':')
    const [r, c] = pos.split(',').map((x) => parseInt(x, 10))
    const grid = cloneGrid(props.grid ?? emptyGrid())
    grid[r][c] = { item: itemId }
    emit('update:grid', grid)
  } else if (target.startsWith('shapeless:')) {
    const idx = parseInt(target.split(':')[1] ?? '0', 10)
    const list = [...(props.ingredients ?? [])]
    list[idx] = { ...list[idx], item: itemId }
    emit('update:ingredients', list)
  } else if (target === 'smelting:input') {
    emit('update:input', itemId)
  }
}

function emptyGrid(): (RecipeIngredient | null)[][] {
  return [
    [null, null, null],
    [null, null, null],
    [null, null, null]
  ]
}

function cloneGrid(g: (RecipeIngredient | null)[][]): (RecipeIngredient | null)[][] {
  return g.map((row) => row.map((v) => (v ? { ...v } : null)))
}

function clearShapedSlot(r: number, c: number): void {
  const grid = cloneGrid(props.grid ?? emptyGrid())
  grid[r][c] = null
  emit('update:grid', grid)
}

/** shaped 的 key 自动生成：根据物品出现顺序分配字母 key（# → A, 再出现 → B …） */
const keys = computed(() => {
  if (props.mode !== 'shaped') return {} as Record<string, RecipeIngredient>
  const grid = props.grid ?? emptyGrid()
  const result: Record<string, RecipeIngredient> = {}
  let next = 65 // 'A'
  for (const row of grid) {
    for (const cell of row) {
      if (!cell) continue
      const existingChar = Object.entries(result).find(([, v]) => v.item === cell.item)?.[0]
      if (existingChar) continue
      const ch = String.fromCharCode(next++)
      result[ch] = cell
    }
  }
  return result
})

const rows = computed(() => {
  if (props.mode !== 'shaped') return []
  return props.grid ?? emptyGrid()
})

function addShapeless(): void {
  const list = [...(props.ingredients ?? [])]
  list.push({ item: 'minecraft:iron_ingot', count: 1 })
  emit('update:ingredients', list)
}

function removeShapeless(idx: number): void {
  const list = [...(props.ingredients ?? [])]
  list.splice(idx, 1)
  emit('update:ingredients', list)
}
</script>

<style scoped>
.crafting {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cg-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ky-text-sub);
}

/* shaped grid */
.cg-grid {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px;
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.04);
  width: fit-content;
}
.cg-row {
  display: flex;
  gap: 3px;
}
.cg-keys {
  font-size: 11.5px;
  color: var(--ky-text-sub);
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
}
.cg-key-char {
  font-weight: 700;
  color: var(--ky-accent, #89b4fa);
  font-family: var(--ky-font-mono);
}
.cg-key-arrow {
  color: var(--ky-text-dim);
  margin: 0 2px;
}
.cg-key-item {
  font-family: var(--ky-font-mono);
}
.cg-keys-hint {
  font-size: 11px;
  color: var(--ky-text-dim);
}

/* shapeless list */
.cg-shapeless {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.04);
  min-height: 80px;
}
.cg-shapeless-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cg-count {
  width: 90px;
}
.cg-empty {
  font-size: 11.5px;
  color: var(--ky-text-dim);
  margin: 0;
}

/* smelting */
.cg-smelting {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.04);
}
.cg-smelt-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cg-smelt-label {
  font-size: 12px;
  color: var(--ky-text-sub);
  width: 90px;
}
.cg-smelt-hint {
  font-size: 11px;
  color: var(--ky-text-dim);
}
</style>
