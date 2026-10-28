<template>
  <nav class="activity-bar" :aria-label="t('activity.label')">
    <div class="ab-group ab-top">
      <!-- 搜索入口：窄栏放不下输入框，点击展开右侧浮层 -->
      <button
        type="button"
        class="ab-item"
        :class="{ active: searchOpen }"
        :title="t('activity.search')"
        :aria-label="t('activity.search')"
        @click="toggleSearch"
      >
        <el-icon :size="19"><SearchIcon /></el-icon>
        <span class="ab-label">{{ t('activity.search') }}</span>
      </button>

      <!-- 不分组常驻项（项目管理）保持在最前 -->
      <button
        v-for="mod in ungroupedTop"
        :key="mod.id"
        type="button"
        class="ab-item"
        :class="{ active: mod.id === ui.activeModuleId }"
        :title="moduleName(mod)"
        :aria-label="moduleName(mod)"
        :aria-current="mod.id === ui.activeModuleId"
        @click="ui.setActiveModule(mod.id)"
      >
        <el-icon :size="19"><component :is="mod.icon" /></el-icon>
        <span class="ab-label">{{ moduleName(mod) }}</span>
      </button>

      <!-- 分组：组头可折叠，折叠状态持久化 -->
      <div v-for="grp in groupedTop" :key="grp.id" class="ab-grp">
        <button
          type="button"
          class="ab-grp-h"
          :title="grp.name"
          :aria-label="grp.name"
          :aria-expanded="!collapsed.has(grp.id)"
          @click="toggleGroup(grp.id)"
        >
          <span class="ab-grp-arrow" :class="{ open: !collapsed.has(grp.id) }">&#9654;</span>
          <span class="ab-grp-name">{{ grp.name }}</span>
          <span class="ab-grp-cnt">{{ grp.items.length }}</span>
        </button>
        <template v-if="!collapsed.has(grp.id)">
          <button
            v-for="mod in grp.items"
            :key="mod.id"
            type="button"
            class="ab-item"
            :class="{ active: mod.id === ui.activeModuleId }"
            :title="moduleName(mod)"
            :aria-label="moduleName(mod)"
            :aria-current="mod.id === ui.activeModuleId"
            @click="ui.setActiveModule(mod.id)"
          >
            <el-icon :size="19"><component :is="mod.icon" /></el-icon>
            <span class="ab-label">{{ moduleName(mod) }}</span>
          </button>
        </template>
      </div>
    </div>

    <div class="ab-group ab-bottom">
      <button
        type="button"
        class="ab-item"
        :class="{ active: ui.aiPanelVisible }"
        :title="t('activity.ai')"
        :aria-label="t('activity.ai')"
        :aria-current="ui.aiPanelVisible"
        @click="ui.toggleAiPanel()"
      >
        <el-icon :size="19"><ChatLineRound /></el-icon>
        <span class="ab-label">{{ t('activity.ai') }}</span>
      </button>
      <button
        v-for="mod in bottomModules"
        :key="mod.id"
        type="button"
        class="ab-item"
        :class="{ active: mod.id === ui.activeModuleId }"
        :title="moduleName(mod)"
        :aria-label="moduleName(mod)"
        @click="ui.setActiveModule(mod.id)"
      >
        <el-icon :size="19"><component :is="mod.icon" /></el-icon>
        <span class="ab-label">{{ moduleName(mod) }}</span>
      </button>
    </div>

    <!-- 搜索浮层：输入过滤全部可见模块，回车/点击激活并关闭 -->
    <div v-if="searchOpen" class="ab-search" role="dialog" :aria-label="t('activity.search')">
      <input
        ref="searchInput"
        v-model="query"
        class="ab-search-input"
        type="text"
        :placeholder="t('activity.searchPlaceholder')"
        @keydown.esc="closeSearch"
        @keydown.enter="activateFirst"
      />
      <div class="ab-search-list">
        <button
          v-for="mod in searchResults"
          :key="mod.id"
          type="button"
          class="ab-search-item"
          @click="activateFromSearch(mod.id)"
        >
          <el-icon :size="15"><component :is="mod.icon" /></el-icon>
          <span>{{ moduleName(mod) }}</span>
        </button>
        <div v-if="query && searchResults.length === 0" class="ab-search-empty">
          {{ t('activity.searchEmpty') }}
        </div>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChatLineRound, Search as SearchIcon } from '@element-plus/icons-vue'
import { moduleRegistry, type KunYuModule, type ModuleGroupId } from '../../modules'
import { t, moduleName } from '../../i18n'
import { useUiStore } from '../../stores/ui'
import { useProjectStore } from '../../stores/project'

const ui = useUiStore()
const projectStore = useProjectStore()

/**
 * 模块是否满足当前项目状态（requireProject / homeOnly / projectTypes）
 * - requireProject：必须已打开项目
 * - homeOnly：必须未打开项目（主页活动栏专用入口）
 * - projectTypes：已打开项目时限定项目类型；未打开项目时由 requireProject 决定，
 *   这样带 projectTypes 但不带 requireProject 的模块（如模组与市场）主页活动栏也可见
 */
function isEligible(mod: KunYuModule): boolean {
  const type = projectStore.currentProject?.type
  if (mod.requireProject && !type) return false
  if (mod.homeOnly && type) return false
  if (mod.projectTypes && type && !mod.projectTypes.includes(type)) return false
  return true
}

/** 是否在活动栏显示：满足项目资格即可 */
function isVisible(mod: KunYuModule): boolean {
  return isEligible(mod)
}

const topModules = computed(() => moduleRegistry.list('top').filter(isVisible))
const bottomModules = computed(() => moduleRegistry.list('bottom').filter(isVisible))

// ---------- 分组（纯渲染层，默认只展开创作工坊，折叠状态持久化） ----------

const GROUP_ORDER: ModuleGroupId[] = ['create', 'content', 'ai-debug', 'release', 'ext']
/** i18n 键名映射：ai-debug → aiDebug */
const GROUP_I18N: Record<ModuleGroupId, string> = {
  create: 'create',
  content: 'content',
  'ai-debug': 'aiDebug',
  release: 'release',
  ext: 'ext'
}
const COLLAPSED_KEY = 'kunyu.activitybar.collapsedGroups'

function loadCollapsed(): Set<ModuleGroupId> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    if (raw) return new Set(JSON.parse(raw) as ModuleGroupId[])
  } catch {
    // 持久化损坏时回落默认态
  }
  // 默认：仅创作工坊展开
  return new Set(GROUP_ORDER.filter((g) => g !== 'create'))
}

const collapsed = ref<Set<ModuleGroupId>>(loadCollapsed())

function persistCollapsed(): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed.value]))
  } catch {
    // 存储不可用时静默降级为会话内状态
  }
}

function toggleGroup(id: ModuleGroupId): void {
  const next = new Set(collapsed.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  collapsed.value = next
  persistCollapsed()
}

const ungroupedTop = computed(() => topModules.value.filter((m) => !m.group))
const groupedTop = computed(() =>
  GROUP_ORDER.map((id) => ({
    id,
    name: t(`activity.groups.${GROUP_I18N[id]}`),
    items: topModules.value.filter((m) => m.group === id)
  })).filter((g) => g.items.length > 0)
)

// 活动模块落在折叠组里时自动展开，保证选中项始终可见
watch(
  () => ui.activeModuleId,
  (id) => {
    const mod = moduleRegistry.get(id)
    if (mod?.group && collapsed.value.has(mod.group)) {
      const next = new Set(collapsed.value)
      next.delete(mod.group)
      collapsed.value = next
      persistCollapsed()
    }
  }
)

// ---------- 搜索 ----------

const searchOpen = ref(false)
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

const allVisible = computed(() => [...topModules.value, ...bottomModules.value])
const searchResults = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return allVisible.value
  return allVisible.value.filter((m) => moduleName(m).toLowerCase().includes(q))
})

function toggleSearch(): void {
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) {
    query.value = ''
    nextTick(() => searchInput.value?.focus())
  }
}

function closeSearch(): void {
  searchOpen.value = false
}

function activateFromSearch(id: string): void {
  ui.setActiveModule(id)
  closeSearch()
}

function activateFirst(): void {
  const first = searchResults.value[0]
  if (first) activateFromSearch(first.id)
}

// 项目切换后，当前活动模块若不再满足项目资格（如关闭项目、切换到不支持的项目类型），
// 回退到项目管理。
watch(
  () => projectStore.currentProject?.type,
  () => {
    const current = moduleRegistry.get(ui.activeModuleId)
    if (current && !isEligible(current)) {
      ui.setActiveModule('project-manager')
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.activity-bar {
  position: relative;
  width: var(--ky-activitybar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: var(--ky-bg-sidebar);
  border-right: 1px solid var(--ky-border);
}

.ab-group {
  display: flex;
  flex-direction: column;
}

/* 顶部组可滚动，底部 AI/设置固定；nav 自身不裁剪，保证搜索浮层可伸出栏外 */
.ab-top {
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: thin;
}

.ab-item {
  position: relative;
  width: var(--ky-activitybar-w);
  height: 44px;
  min-height: 0;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--ky-text-dim);
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

/* 模块名隐藏，hover 靠原生 title tooltip 显示 */
.ab-label {
  display: none;
}

.ab-item:hover {
  color: var(--ky-text);
  background: var(--ky-bg-hover);
}

.ab-item.active {
  color: var(--ky-accent);
  background: color-mix(in srgb, var(--ky-accent) 10%, transparent);
}

/* 选中态左侧指示条 */
.ab-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 2px;
  border-radius: 0 2px 2px 0;
  background: var(--ky-accent);
}

/* ---------- 分组头 ---------- */

.ab-grp {
  border-top: 1px solid var(--ky-border);
}

.ab-grp-h {
  width: 100%;
  height: 26px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border: none;
  background: transparent;
  color: var(--ky-text-dim);
  cursor: pointer;
  font-size: 10px;
  letter-spacing: 0.02em;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.ab-grp-h:hover {
  color: var(--ky-text);
  background: var(--ky-bg-hover);
}

.ab-grp-arrow {
  font-size: 8px;
  width: 10px;
  flex-shrink: 0;
  transition: transform 0.12s ease;
}

.ab-grp-arrow.open {
  transform: rotate(90deg);
}

.ab-grp-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ab-grp-cnt {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 9px;
  opacity: 0.7;
}

/* ---------- 搜索浮层 ---------- */

.ab-search {
  position: absolute;
  left: calc(100% + 4px);
  top: 0;
  width: 220px;
  z-index: 100;
  background: var(--ky-bg-sidebar);
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  padding: 8px;
}

.ab-search-input {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  background: var(--ky-bg);
  color: var(--ky-text);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}

.ab-search-input:focus {
  border-color: var(--ky-accent);
}

.ab-search-list {
  margin-top: 6px;
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.ab-search-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ky-text);
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.ab-search-item:hover {
  background: var(--ky-bg-hover);
}

.ab-search-empty {
  padding: 12px 10px;
  font-size: 12px;
  color: var(--ky-text-dim);
  text-align: center;
}
</style>
