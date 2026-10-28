<template>
  <div class="uo-block">
    <h3 class="uo-title">{{ t('unified.products.title') }}</h3>
    <div class="uo-products">
      <div class="uo-product-col">
        <h4>{{ t('unified.products.java') }}</h4>
        <ul v-if="actualJavaFiles.length">
          <li
            v-for="f in actualJavaFiles"
            :key="f.path"
            class="uo-product-link"
            :title="t('unified.products.openFile', { path: f.path })"
            @click="openProduct(f.path)"
          >
            {{ shortPath(f.path) }}
          </li>
        </ul>
        <ul v-else>
          <li>{{ active.java.packageName.replace(/\./g, '/') }}/{{ active.java.className }}.java</li>
          <li v-if="active.type === 'block'">{{ t('unified.products.javaClass.block') }}</li>
          <li v-if="active.type === 'item'">{{ t('unified.products.javaClass.item') }}</li>
          <li v-if="active.type === 'entity'">{{ t('unified.products.javaClass.entity') }}</li>
        </ul>
      </div>
      <div class="uo-product-col">
        <h4>{{ t('unified.products.assets') }}</h4>
        <ul>
          <li v-if="active.type === 'block'">assets/{{ ns }}/textures/block/{{ active.id }}.png</li>
          <li v-if="active.type === 'block'">assets/{{ ns }}/models/block/{{ active.id }}.json</li>
          <li v-if="active.type === 'item'">assets/{{ ns }}/textures/item/{{ active.id }}.png</li>
          <li v-if="active.type === 'item'">assets/{{ ns }}/models/item/{{ active.id }}.json</li>
          <li v-if="active.type === 'entity'">assets/{{ ns }}/textures/entity/{{ active.id }}.png</li>
          <li>assets/{{ ns }}/lang/zh_cn.json</li>
        </ul>
      </div>
      <div class="uo-product-col">
        <h4>{{ t('unified.products.data') }}</h4>
        <ul>
          <li v-for="r in recipes" :key="r.id">data/{{ ns }}/{{ recipeDir }}/{{ r.id }}.json</li>
          <li v-if="loot">data/{{ ns }}/{{ lootTableDir }}/{{ lootSubDir }}/{{ active.id }}.json</li>
          <li v-if="!recipes.length && !loot" class="uo-product-empty">{{ t('unified.products.empty') }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ProductsPreview：三端产物预览（从 UnifiedEditorView 抽出，逻辑零改动）。
 * 直接读取 unified store，无 props/emits。
 */
import { computed } from 'vue'
import { useProjectStore } from '../../../stores/project'
import { useUnifiedStore } from '../../../stores/unified'
import { useEditorStore } from '../../../stores/editor'
import type { GeneratedFile } from '../../../../../shared/types/content'
import { dataPath } from '../../../../../shared/dataPath'
import { t } from '../../../i18n'

const projectStore = useProjectStore()
const store = useUnifiedStore()
const editor = useEditorStore()

const ns = computed(() => projectStore.currentProject?.namespace || 'mymod')
const root = computed(() => projectStore.currentProject?.path || '')
// 数据包产物目录随版本单数化（1.21+ recipe/loot_table），预览须与磁盘事实一致
const mcVersion = computed(() => projectStore.currentProject?.mcVersion ?? '')
const recipeDir = computed(() => dataPath('recipe', mcVersion.value))
const lootTableDir = computed(() => dataPath('loot_table', mcVersion.value))
// 战利品表子目录按对象类型区分（生成器实际落点；旧预览漏了这一层）
const lootSubDir = computed(() =>
  store.active?.type === 'entity' ? 'entities' : store.active?.type === 'item' ? 'items' : 'blocks'
)

/* ---- 实际生成的 Java 产物 ---- */
const actualJavaFiles = computed<GeneratedFile[]>(() =>
  store.generatedJavaFor(store.active)
)
const recipes = computed(() => store.active?.data.recipes ?? [])
const loot = computed(() => store.active?.data.lootTable ?? null)

/** 本组件仅在存在活动对象时渲染（父级 v-if/v-else 保证），模板内直接取值 */
const active = computed(() => store.active!)

/** 产物相对路径 → 绝对路径并在代码编辑器打开 */
function openProduct(relPath: string): void {
  const abs = `${root.value.replace(/[\\/]$/, '')}/${relPath}`
  void editor.openByPath(abs)
}

/** 产物列表只显示路径末两段，避免过长 */
function shortPath(p: string): string {
  const parts = p.split('/')
  return parts.slice(-2).join('/')
}
</script>

<style scoped>
/* 操作区分块（与父级一致，保证 scoped 命中） */
.uo-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ky-border);
}
.uo-block:first-child {
  padding-top: 2px;
}
.uo-block:last-child {
  border-bottom: none;
}
.uo-title {
  margin: 0 0 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-accent);
  display: flex;
  align-items: center;
  gap: 6px;
}
/* 产物预览（窄栏单列紧凑） */
.uo-products {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.uo-product-col h4 {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--ky-text-sub);
}
.uo-product-col ul {
  margin: 0;
  padding-left: 16px;
  font-size: 10.5px;
  color: var(--ky-text);
  font-family: var(--ky-mono, monospace);
  line-height: 1.7;
}
.uo-product-empty {
  color: var(--ky-text-dim);
  font-style: italic;
  list-style: none;
  margin-left: -16px;
}
.uo-product-link {
  cursor: pointer;
  color: var(--ky-accent);
  list-style: none;
  margin-left: -16px;
}
.uo-product-link:hover { text-decoration: underline; }
</style>
