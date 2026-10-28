<template>
  <div class="dpt">
    <div v-for="cat in categories" :key="cat.key" class="dpt-group">
      <div class="dpt-head">
        <span class="dpt-label" :title="catHint(cat)">{{ catLabel(cat) }}</span>
        <span v-if="byCategory(cat.key).length > 0" class="dpt-count">
          {{ byCategory(cat.key).length }}
        </span>
        <el-icon class="dpt-add" :title="t('datapack.tree.create')" @click="onCreate(cat.key)"><Plus /></el-icon>
      </div>
      <template v-if="byCategory(cat.key).length > 0">
        <div
          v-for="e in byCategory(cat.key)"
          :key="e.path"
          class="dpt-item"
          :class="{ active: isActive(e) }"
          :title="e.path"
          @click="onSelect(e)"
        >
          <span class="dpt-name">{{ e.id }}</span>
          <el-icon class="dpt-del" :title="t('datapack.tree.delete')" @click.stop="onDelete(e)"><Delete /></el-icon>
        </div>
      </template>
      <p v-else class="dpt-empty">{{ t('datapack.tree.empty') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * DataPackTree：数据包分类文件树（窄栏）。
 * 按类别注册表分组展示条目，组头支持新建，条目支持选中与删除（删除由父组件确认）。
 * 通过 datapack store 与主编辑区共享状态。
 */
import { computed } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import type {
  DataPackCategory,
  DataPackCategoryInfo,
  DataPackEntry
} from '../../../../shared/schemas/datapack.schema'
import { getDataPackCategories } from '../../../../shared/schemas/datapack.schema'
import { useDataPackStore } from '../../stores/datapack'
import { t, te, locale } from '../../i18n'

const store = useDataPackStore()

/** 类别注册表随语言切换重建（冻结常量为 zh-CN） */
const categories = computed(() => getDataPackCategories(locale.value))

const entries = computed(() => store.entries)
const active = computed(() => store.active)

/** 类别文案走语言包，缺失时回落共享注册表里的中文原名（第三方/新增类别不受影响） */
function catText(cat: DataPackCategoryInfo, field: 'label' | 'hint'): string {
  const key = `datapack.category.${cat.key}.${field}`
  return te(key) ? t(key) : cat[field]
}

function catLabel(cat: DataPackCategoryInfo): string {
  return catText(cat, 'label')
}

function catHint(cat: DataPackCategoryInfo): string {
  return catText(cat, 'hint')
}

function byCategory(cat: DataPackCategory): DataPackEntry[] {
  return entries.value.filter((en) => en.category === cat)
}

function isActive(e: DataPackEntry): boolean {
  return active.value?.path === e.path
}

function onSelect(e: DataPackEntry): void {
  store.select(e)
}

function onCreate(cat: DataPackCategory): void {
  store.requestCreate(cat)
}

function onDelete(e: DataPackEntry): void {
  store.requestDelete(e)
}
</script>

<style scoped>
.dpt {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  min-height: 100%;
}
.dpt-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dpt-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
}
.dpt-label {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ky-text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dpt-count {
  font-size: 10px;
  color: var(--ky-text-dim);
}
.dpt-add {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--ky-text-dim);
  cursor: pointer;
  padding: 2px;
}
.dpt-add:hover {
  color: var(--ky-accent);
}
.dpt-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}
.dpt-item:hover {
  background: var(--ky-bg-hover);
}
.dpt-item.active {
  background: color-mix(in srgb, var(--ky-accent) 16%, transparent);
  border-color: color-mix(in srgb, var(--ky-accent) 45%, transparent);
}
.dpt-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--ky-text);
  font-family: var(--ky-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dpt-del {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--ky-text-dim);
  opacity: 0;
  cursor: pointer;
  padding: 2px;
}
.dpt-item:hover .dpt-del {
  opacity: 1;
}
.dpt-del:hover {
  color: #f38ba8;
}
.dpt-empty {
  margin: 0;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--ky-text-dim);
  opacity: 0.7;
}
</style>
