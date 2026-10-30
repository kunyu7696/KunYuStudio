<template>
  <nav class="activity-bar" :aria-label="t('activity.label')">
    <div class="ab-group ab-top">
      <button
        v-for="mod in topModules"
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
    </div>

    <div class="ab-group ab-bottom">
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
  </nav>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { moduleRegistry, type KunYuModule } from '../../modules'
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
  width: var(--ky-activitybar-w);
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-sidebar);
  border-right: 1px solid var(--ky-border);
}

.ab-group {
  display: flex;
  flex-direction: column;
}

/* 顶部模块区可上下滑动：窗口过矮或模块增多时不挤压底部固定项 */
.ab-top {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.ab-top::-webkit-scrollbar {
  width: 8px;
}

.ab-top::-webkit-scrollbar-thumb {
  background: var(--ky-border);
  border-radius: 4px;
}

.ab-bottom {
  flex-shrink: 0;
}

.ab-item {
  position: relative;
  width: var(--ky-activitybar-w);
  height: 44px;
  min-height: 0;
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
</style>
