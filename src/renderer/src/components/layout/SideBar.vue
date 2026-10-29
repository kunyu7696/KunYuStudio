<template>
  <aside class="side-bar" :style="{ width: `${ui.sidebarWidth}px` }">
    <!-- 左缘折叠按钮：悬停侧边栏时浮现，点击收起（收起后由 App 的细竖条恢复） -->
    <button
      type="button"
      class="sb-fold"
      :title="t('sidebar.collapse')"
      :aria-label="t('sidebar.collapse')"
      @click="ui.toggleSidebarCollapsed()"
    >
      <span class="sb-fold-arrow">‹</span>
    </button>
    <header class="sb-header">
      <!-- 返回按钮：只有打开项目时才显示，退出当前项目回到卡片列表 -->
      <button
        v-if="hasProject"
        type="button"
        class="sb-back"
        :title="t('sidebar.backToProjects')"
        :aria-label="t('sidebar.backToProjects')"
        @click="projectStore.closeCurrent()"
      >
        <el-icon :size="14"><ArrowLeft /></el-icon>
      </button>
      <template v-else>
        <el-icon :size="15"><component :is="ui.activeModule?.icon" /></el-icon>
      </template>

      <span class="sb-title">
        <template v-if="hasProject">{{ projectStore.currentProject!.name }}</template>
        <template v-else>{{ ui.activeModule ? moduleName(ui.activeModule) : t('sidebar.title') }}</template>
      </span>

      <!-- 头部操作：项目管理/统一编辑器下可用；创建/导入入口在活动栏「项目管理」分组 -->
      <div v-if="ui.activeModuleId === 'project-manager' || ui.activeModuleId === 'unified'" class="sb-head-actions">
        <button v-if="hasProject" type="button" class="sb-head-btn" :title="t('sidebar.refreshTree')" @click="refreshTree">
          <el-icon :size="15"><Refresh /></el-icon>
        </button>
      </div>
    </header>

    <div class="sb-body">
      <!-- 项目管理 / 统一编辑器 · 有项目：文件树 -->
      <Suspense v-if="showFileTree">
        <template #default>
          <FileTree />
        </template>
        <template #fallback>
          <div class="sb-loading">
            <el-icon class="is-loading" :size="16"><Loading /></el-icon>
          </div>
        </template>
      </Suspense>

      <!-- 其他模块：沿用注册的 sidebarLoader（若有） -->
      <Suspense v-else-if="sidebarComponent">
        <template #default>
          <component :is="sidebarComponent" />
        </template>
        <template #fallback>
          <div class="sb-loading">
            <el-icon class="is-loading" :size="16"><Loading /></el-icon>
          </div>
        </template>
      </Suspense>
      <template v-else>
        <p class="sb-placeholder">{{ ui.activeModule ? moduleDescription(ui.activeModule) : '' }}</p>
      </template>
    </div>

    <div
      class="sb-resizer"
      role="separator"
      aria-orientation="vertical"
      :title="t('sidebar.resizerTitle')"
      @mousedown="startResize"
    />
  </aside>

</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, type Component } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Loading, Refresh } from '@element-plus/icons-vue'
import { useUiStore } from '../../stores/ui'
import { moduleRegistry, type KunYuModule } from '../../modules'
import { useProjectStore } from '../../stores/project'
import { useExplorerStore } from '../../stores/explorer'
import { t, moduleName, moduleDescription } from '../../i18n'

const ui = useUiStore()
const projectStore = useProjectStore()
const explorerStore = useExplorerStore()

const FileTree = defineAsyncComponent(() => import('../explorer/FileTree.vue'))

const sidebarCache = new Map<string, Component>()

function resolveSidebar(mod: KunYuModule | undefined): Component | undefined {
  if (!mod?.sidebarLoader) return undefined
  const cached = sidebarCache.get(mod.id)
  if (cached) return cached
  const asyncComp = defineAsyncComponent(mod.sidebarLoader)
  sidebarCache.set(mod.id, asyncComp)
  return asyncComp
}

/** 其他模块沿用模块注册的 sidebarLoader */
const sidebarComponent = computed(() => resolveSidebar(moduleRegistry.get(ui.activeModuleId)))

const hasProject = computed(() => Boolean(projectStore.currentProject))

/** 项目管理与统一编辑器：侧栏固定显示项目文件树 */
const showFileTree = computed(
  () =>
    hasProject.value &&
    (ui.activeModuleId === 'project-manager' || ui.activeModuleId === 'unified')
)

async function refreshTree(): Promise<void> {
  if (explorerStore.rootPath) {
    await explorerStore.refreshDir(explorerStore.rootPath)
    ElMessage.success(t('sidebar.treeRefreshed'))
  }
}

function startResize(event: MouseEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = ui.sidebarWidth
  document.body.style.cursor = 'col-resize'
  const onMouseMove = (moveEvent: MouseEvent) => {
    ui.setSidebarWidth(startWidth + moveEvent.clientX - startX)
  }
  const onMouseUp = (): void => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
  }
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

onMounted(() => {
  void projectStore.refresh()
})
</script>

<style scoped>
.side-bar {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-sidebar);
  border-right: 1px solid var(--ky-border);
  min-width: 0;
}

/* 左缘折叠按钮：默认隐藏，悬停侧边栏时浮现 */
.sb-fold {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 11;
  width: 10px;
  height: 46px;
  padding: 0;
  border: none;
  border-radius: 0 4px 4px 0;
  background: transparent;
  color: var(--ky-text-dim);
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 0.15s ease,
    color 0.15s ease,
    background 0.15s ease;
}

.side-bar:hover .sb-fold,
.sb-fold:focus-visible {
  opacity: 1;
}

.sb-fold:hover {
  background: var(--ky-bg-hover);
  color: var(--ky-accent);
}

.sb-header {
  height: 35px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px 0 12px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ky-text-sub);
  border-bottom: 1px solid var(--ky-border);
}

.sb-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: none;
  letter-spacing: 0;
  font-size: 11.5px;
}

.sb-back {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--ky-radius-control);
  background: transparent;
  color: var(--ky-text-sub);
  cursor: pointer;
}

.sb-back:hover {
  color: var(--ky-accent);
  background: var(--ky-bg-hover);
}

.sb-head-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

.sb-head-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--ky-radius-control);
  background: transparent;
  color: var(--ky-text-sub);
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.sb-head-btn:hover {
  color: var(--ky-accent);
  background: var(--ky-bg-hover);
}

.sb-body {
  flex: 1;
  overflow-y: auto;
}
.sb-body :deep(.file-tree) {
  height: 100%;
}

.sb-loading {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--ky-text-dim);
  font-size: 12px;
}

.sb-placeholder {
  margin: 0;
  padding: 12px 12px 0;
  font-size: 12px;
  color: var(--ky-text);
}

.sb-resizer {
  position: absolute;
  top: 0;
  right: -2px;
  width: 5px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
}
.sb-resizer:hover,
.sb-resizer:active {
  background: var(--ky-accent);
  opacity: 0.25;
}
</style>
