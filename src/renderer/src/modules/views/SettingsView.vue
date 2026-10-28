<template>
  <div class="settings-view">
    <aside class="sv-nav">
      <button v-if="ui.settingsReturnTo" class="sv-back" :title="t('settings.back')" @click="ui.backFromSettings()">
        <el-icon :size="16"><ArrowLeft /></el-icon>
        <span>{{ t('settings.back') }}</span>
      </button>
      <h1 class="sv-title">{{ t('settings.title') }}</h1>
      <div class="sv-search">
        <el-input
          v-model="searchQuery"
          size="small"
          clearable
          :placeholder="t('settings.searchPh')"
          :prefix-icon="Search"
          @keydown.esc="searchQuery = ''"
          @keydown.enter="onSearchEnter"
        />
        <div v-if="searchQuery.trim()" class="sv-search-pop">
          <template v-if="searchResults.length">
            <button
              v-for="r in searchResults"
              :key="r.id"
              class="sv-search-item"
              @click="jumpTo(r)"
            >
              <span class="ssi-label">{{ t(r.labelKey) }}</span>
              <span class="ssi-path">{{ categoryLabel(r.category) }} / {{ t(r.sectionKey) }}</span>
            </button>
          </template>
          <div v-else class="sv-search-empty">{{ t('settings.searchEmpty') }}</div>
        </div>
      </div>
      <button
        v-for="c in categories"
        :key="c.id"
        class="sv-nav-item"
        :class="{ active: activeCategory === c.id }"
        @click="selectCategory(c.id)"
      >
        <el-icon :size="16"><component :is="c.icon" /></el-icon>
        <span>{{ t(c.labelKey) }}</span>
      </button>
    </aside>

    <main class="sv-content">
      <GeneralSettingsPane v-if="activeCategory === 'general'" />
      <EditorSettingsPane v-else-if="activeCategory === 'editor'" />
      <RuntimeSettingsPane v-else-if="activeCategory === 'runtime'" />
      <AiSettingsPane v-else-if="activeCategory === 'ai'" />
      <NetworkSettingsPane v-else-if="activeCategory === 'network'" />
      <MarketplaceSettingsPane v-else-if="activeCategory === 'marketplace'" />
      <IntegrationPane v-else-if="activeCategory === 'integration'" />
      <PublishSettingsPane v-else-if="activeCategory === 'publish'" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  ArrowLeft,
  Setting,
  EditPen,
  Monitor,
  MagicStick,
  Connection,
  Goods,
  Link,
  Upload,
  Search
} from '@element-plus/icons-vue'
import GeneralSettingsPane from '../../components/settings/GeneralSettingsPane.vue'
import EditorSettingsPane from '../../components/settings/EditorSettingsPane.vue'
import RuntimeSettingsPane from '../../components/settings/RuntimeSettingsPane.vue'
import AiSettingsPane from '../../components/settings/AiSettingsPane.vue'
import NetworkSettingsPane from '../../components/settings/NetworkSettingsPane.vue'
import MarketplaceSettingsPane from '../../components/settings/MarketplaceSettingsPane.vue'
import IntegrationPane from '../../components/settings/IntegrationPane.vue'
import PublishSettingsPane from '../../components/settings/PublishSettingsPane.vue'
import type { SettingsCategory } from '../../components/settings/category'
import { SETTINGS_INDEX, type SettingIndexEntry } from '../../components/settings/searchIndex'
import { useUiStore } from '../../stores/ui'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const ui = useUiStore()

const categories: { id: SettingsCategory; labelKey: string; icon: unknown }[] = [
  { id: 'general', labelKey: 'settings.generalTitle', icon: Setting },
  { id: 'editor', labelKey: 'settings.editor.title', icon: EditPen },
  { id: 'runtime', labelKey: 'settings.runtime.title', icon: Monitor },
  { id: 'ai', labelKey: 'settings.ai.title', icon: MagicStick },
  { id: 'network', labelKey: 'settings.network.title', icon: Connection },
  { id: 'marketplace', labelKey: 'settings.marketplace.title', icon: Goods },
  { id: 'integration', labelKey: 'settings.integration.title', icon: Link },
  { id: 'publish', labelKey: 'settings.publish.title', icon: Upload }
]

// 分类状态由 ui store 持有，支持从 AI 面板等位置深链定位
const activeCategory = computed<SettingsCategory>({
  get: () => ui.settingsCategory,
  set: (v) => ui.setSettingsCategory(v)
})

function selectCategory(id: SettingsCategory): void {
  ui.setSettingsCategory(id)
}

/* ---------- 设置项级搜索：命中后切分类 + 滚动定位 + 高亮闪烁 ---------- */
const searchQuery = ref('')

function categoryLabel(id: string): string {
  const c = categories.find((x) => x.id === id)
  return c ? t(c.labelKey) : id
}

const searchResults = computed<SettingIndexEntry[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return []
  return SETTINGS_INDEX.filter((e) => {
    if (t(e.labelKey).toLowerCase().includes(q)) return true
    if (t(e.sectionKey).toLowerCase().includes(q)) return true
    if (categoryLabel(e.category).toLowerCase().includes(q)) return true
    return e.keywords.some((k) => k.toLowerCase().includes(q))
  }).slice(0, 20)
})

function onSearchEnter(): void {
  const first = searchResults.value[0]
  if (first) void jumpTo(first)
}

async function jumpTo(entry: SettingIndexEntry): Promise<void> {
  searchQuery.value = ''
  ui.setSettingsCategory(entry.category as SettingsCategory)
  // 等待目标 pane 完成 v-if 切换渲染后再定位
  await nextTick()
  const el = document.querySelector(`[data-setting-id="${entry.id}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('setting-flash')
  window.setTimeout(() => el.classList.remove('setting-flash'), 1700)
}
</script>

<style scoped>
.settings-view {
  height: 100%;
  display: flex;
  overflow: hidden;
}
.sv-nav {
  width: 176px;
  flex-shrink: 0;
  background: var(--ky-bg-sidebar);
  border-right: 1px solid var(--ky-border);
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sv-back {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  margin-bottom: 4px;
  border: none;
  border-radius: var(--ky-radius-control);
  background: rgba(var(--ky-accent-rgb), 0.1);
  color: var(--ky-accent);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 0.15s;
}
.sv-back:hover {
  background: rgba(var(--ky-accent-rgb), 0.2);
}
.sv-title {
  margin: 2px 10px 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ky-text-sub);
  letter-spacing: 0.5px;
}
.sv-search {
  position: relative;
  margin: 0 2px 12px;
}
.sv-search-pop {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  background: var(--ky-bg-panel);
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
}
.sv-search-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  border-radius: var(--ky-radius-control);
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}
.sv-search-item:hover {
  background: var(--ky-bg-hover);
}
.ssi-label {
  font-size: 12.5px;
  color: var(--ky-text);
}
.ssi-path {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.sv-search-empty {
  padding: 12px 9px;
  font-size: 12px;
  color: var(--ky-text-dim);
  text-align: center;
}
.sv-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border: none;
  border-radius: var(--ky-radius-control);
  background: transparent;
  color: var(--ky-text-sub);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.sv-nav-item:hover {
  background: var(--ky-bg-hover);
  color: var(--ky-text);
}
.sv-nav-item.active {
  background: rgba(var(--ky-accent-rgb), 0.12);
  color: var(--ky-accent);
}
.sv-content {
  flex: 1;
  overflow-y: auto;
  padding: 28px 32px;
}
</style>
