<template>
  <nav
    class="activity-bar"
    :class="{ collapsed: navCollapsed }"
    :style="navCollapsed ? { width: '12px' } : undefined"
    :aria-label="t('activity.label')"
  >
    <!-- 左缘折叠条：竖向常驻，收起后仅剩此条 -->
    <button
      type="button"
      class="ab-fold"
      :title="navCollapsed ? t('activity.expand') : t('activity.collapse')"
      :aria-label="navCollapsed ? t('activity.expand') : t('activity.collapse')"
      :aria-expanded="!navCollapsed"
      @click="toggleCollapsed"
    >
      <span class="ab-fold-arrow">{{ navCollapsed ? '›' : '‹' }}</span>
    </button>

    <div v-show="!navCollapsed" class="ab-panel">
    <div class="ab-top">
      <!-- 常驻项（无分组）：项目管理等，左侧圆点标识 -->
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
        @contextmenu.prevent="openModMenu($event, mod)"
      >
        <span class="ab-mark"><span class="ab-dot" /></span>
        <span class="ab-label">{{ moduleName(mod) }}</span>
      </button>

      <!-- 分组：组头 = 折叠箭头 + 组名 + 数量 -->
      <div v-for="grp in groupedTop" :key="grp.id" class="ab-grp">
        <button
          type="button"
          class="ab-grp-h"
          :title="grp.name"
          :aria-label="grp.name"
          :aria-expanded="!collapsed.has(grp.id)"
          @click="toggleGroup(grp.id)"
        >
          <span class="ab-mark">
            <span class="ab-caret" :class="{ open: !collapsed.has(grp.id) }">&#9654;</span>
          </span>
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
            @contextmenu.prevent="openModMenu($event, mod)"
          >
            <span class="ab-mark"></span>
            <span class="ab-label">{{ moduleName(mod) }}</span>
          </button>
        </template>
      </div>
    </div>

    <div class="ab-bottom">
      <button
        type="button"
        class="ab-item"
        :class="{ active: ui.aiPanelVisible }"
        :title="t('activity.ai')"
        :aria-label="t('activity.ai')"
        :aria-current="ui.aiPanelVisible"
        @click="ui.toggleAiPanel()"
      >
        <span class="ab-mark"><span class="ab-dot" /></span>
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
        :aria-current="mod.id === ui.activeModuleId"
        @click="ui.setActiveModule(mod.id)"
        @contextmenu.prevent="openModMenu($event, mod)"
      >
        <span class="ab-mark"><span class="ab-dot" /></span>
        <span class="ab-label">{{ moduleName(mod) }}</span>
      </button>
    </div>

    </div>

    <!-- 模块右键菜单：隐藏入口（恢复在 设置→常规→活动栏模块） -->
    <Teleport to="body">
      <div v-if="modMenu" class="ab-ctx-mask" @click="modMenu = null" @contextmenu.prevent="modMenu = null">
        <div class="ab-ctx" :style="{ left: modMenu.x + 'px', top: modMenu.y + 'px' }" @click.stop>
          <button type="button" class="ab-ctx-item" @click="hideFromMenu">
            {{ t('activity.hideModule', { name: modMenu.name }) }}
          </button>
        </div>
      </div>
    </Teleport>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

/** 是否在活动栏显示：满足项目资格且未被用户隐藏（命令面板不受隐藏影响） */
function isVisible(mod: KunYuModule): boolean {
  return isEligible(mod) && !ui.hiddenModules.includes(mod.id)
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
const NAV_COLLAPSED_KEY = 'kunyu.activitybar.collapsed'

/** 活动栏整体折叠（左缘竖条点击切换；收起后仅留 12px 竖条） */
function loadNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

const navCollapsed = ref(loadNavCollapsed())

function toggleCollapsed(): void {
  navCollapsed.value = !navCollapsed.value
  try {
    localStorage.setItem(NAV_COLLAPSED_KEY, navCollapsed.value ? '1' : '0')
  } catch {
    // 存储不可用时静默降级为会话内状态
  }
}

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

// ---------- 搜索：统一走全局命令面板（Ctrl+K），不在栏内另起输入框 ----------

// ---------- 右键隐藏（仅分组内模块；恢复走 设置→常规） ----------

const modMenu = ref<{ x: number; y: number; id: string; name: string } | null>(null)

function openModMenu(e: MouseEvent, mod: KunYuModule): void {
  modMenu.value = { x: e.clientX, y: e.clientY, id: mod.id, name: moduleName(mod) }
}

function hideFromMenu(): void {
  if (!modMenu.value) return
  ui.hideModule(modMenu.value.id)
  modMenu.value = null
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
  flex-direction: row;
  background: var(--ky-bg-sidebar);
  border-right: 1px solid var(--ky-border);
  user-select: none;
  transition: width 0.16s ease;
}

/* 左缘折叠条 */
.ab-fold {
  width: 12px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-right: 1px solid var(--ky-border);
  background: transparent;
  color: var(--ky-text-dim);
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.ab-fold:hover {
  color: var(--ky-accent);
  background: var(--ky-bg-hover);
}

.ab-fold-arrow {
  font-size: 12px;
  line-height: 1;
}

.ab-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
}

/* 顶部组可滚动，底部常驻项固定；nav 自身不裁剪，保证右键菜单可伸出栏外 */
.ab-top {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 0;
  scrollbar-width: thin;
}

.ab-bottom {
  flex-shrink: 0;
  padding: 6px 0 10px;
}

/* ---------- 行（常驻项 / 分组子项统一外观） ---------- */

.ab-item {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 34px;
  padding: 0 12px 0 8px;
  border: none;
  background: transparent;
  color: var(--ky-text-sub);
  font-size: 13.5px;
  line-height: 1;
  text-align: left;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.ab-item:hover {
  color: var(--ky-text);
  background: var(--ky-bg-hover);
}

/* 选中态：左侧指示条 + 淡色底 */
.ab-item.active {
  color: var(--ky-text);
  background: var(--ky-accent-soft);
}

.ab-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: var(--ky-accent);
}

/* 行首标记槽：常驻项放圆点，子项留空保持文字对齐 */
.ab-mark {
  width: 18px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ky-accent);
  opacity: 0.85;
}

.ab-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------- 分组头 ---------- */

.ab-grp-h {
  display: flex;
  align-items: center;
  width: 100%;
  height: 34px;
  padding: 0 12px 0 8px;
  border: none;
  background: transparent;
  color: var(--ky-text-sub);
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.ab-grp-h:hover {
  color: var(--ky-text);
  background: var(--ky-bg-hover);
}

.ab-caret {
  font-size: 8px;
  color: var(--ky-text-dim);
  transition: transform 0.12s ease;
}

.ab-caret.open {
  transform: rotate(90deg);
}

.ab-grp-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ab-grp-cnt {
  flex-shrink: 0;
  margin-left: 8px;
  font-size: 12px;
  color: var(--ky-text-dim);
}

/* ---------- 右键菜单 ---------- */

.ab-ctx-mask {
  position: fixed;
  inset: 0;
  z-index: 3100;
}

.ab-ctx {
  position: fixed;
  background: var(--ky-bg-sidebar);
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  padding: 4px;
  min-width: 150px;
}

.ab-ctx-item {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--ky-text);
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

.ab-ctx-item:hover {
  background: var(--ky-bg-hover);
}
</style>
