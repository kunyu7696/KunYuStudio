<template>
  <aside class="side-bar" :style="{ width: `${ui.sidebarWidth}px` }">
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

      <!-- 头部操作：项目管理/统一编辑器下始终可用；项目内另有刷新按钮 -->
      <div v-if="ui.activeModuleId === 'project-manager' || ui.activeModuleId === 'unified'" class="sb-head-actions">
        <button v-if="hasProject" type="button" class="sb-head-btn" :title="t('sidebar.refreshTree')" @click="refreshTree">
          <el-icon :size="15"><Refresh /></el-icon>
        </button>
        <button
          type="button"
          class="sb-head-btn"
          :title="t('sidebar.createProject')"
          :aria-label="t('sidebar.createProject')"
          @click="ui.openWizard()"
        >
          <el-icon :size="15"><Plus /></el-icon>
        </button>
        <button
          type="button"
          class="sb-head-btn"
          :title="t('sidebar.importProject')"
          :aria-label="t('sidebar.importProject')"
          @click="onImport"
        >
          <el-icon :size="15"><Upload /></el-icon>
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

      <!-- 项目管理模块 · 无项目：紧凑项目列表（从 ProjectManagerView 迁入） -->
      <template v-else-if="ui.activeModuleId === 'project-manager'">
        <div v-if="projectStore.loading" class="sb-loading">
          <el-icon class="is-loading" :size="16"><Loading /></el-icon>
          <span>{{ t('common.loading') }}</span>
        </div>
        <div v-else-if="projectStore.projects.length === 0" class="sb-empty">
          <el-icon :size="36" class="sb-empty-icon"><Box /></el-icon>
          <p class="sb-empty-title">{{ t('sidebar.emptyTitle') }}</p>
          <p class="sb-empty-sub">{{ t('sidebar.emptySub') }}</p>
        </div>
        <div v-else class="sb-projects">
          <div
            v-for="p in projectStore.projects"
            :key="p.id"
            class="sb-proj-item"
            :class="{ active: p.id === projectStore.currentProjectId, stale: p.pathExists === false }"
            @click="openProject(p.id)"
          >
            <el-icon :size="16" class="sb-proj-icon"><component :is="typeIcon(p.type)" /></el-icon>
            <div class="sb-proj-main">
              <span class="sb-proj-name">
                {{ p.name }}
                <span v-if="p.pathExists === false" class="sb-proj-stale-badge">{{
                  t('sidebar.staleBadge')
                }}</span>
              </span>
              <span class="sb-proj-meta">
                <template v-if="p.type === 'mod'">
                  {{ p.loader }} · {{ p.mcVersion }}
                </template>
                <template v-else>
                  {{ typeLabel(p.type) }}
                </template>
                · {{ formatTime(p.lastOpenedAt) }}
              </span>
            </div>
            <el-button
              text
              size="small"
              class="sb-proj-del"
              :title="t('sidebar.delete')"
              @click.stop="onDelete(p)"
            >
              <el-icon :size="14"><Delete /></el-icon>
            </el-button>
          </div>
        </div>
      </template>

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

  <!-- 导入项目：选择老旧版本 / 新版本 -->
  <el-dialog v-model="importChoiceVisible" :title="t('sidebar.importDialogTitle')" width="420px" append-to-body>
    <div class="sb-import-choices">
      <button type="button" class="sb-import-card" @click="onImportNew">
        <span class="sb-import-card-title">{{ t('sidebar.importNewTitle') }}</span>
        <span class="sb-import-card-sub">{{ t('sidebar.importNewDesc') }}</span>
      </button>
      <button type="button" class="sb-import-card" @click="onImportLegacy">
        <span class="sb-import-card-title">{{ t('sidebar.importLegacyTitle') }}</span>
        <span class="sb-import-card-sub">{{ t('sidebar.importLegacyDesc') }}</span>
      </button>
    </div>
  </el-dialog>

  <!-- 老旧版本导入：展示第三层遗留版本供查看后导入 -->
  <LegacyImportDialog v-model="legacyImportVisible" />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, type Component } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft,
  Box,
  DataLine,
  Delete,
  Files,
  Loading,
  Picture,
  Plus,
  Refresh,
  Sunny,
  Upload
} from '@element-plus/icons-vue'
import { useUiStore } from '../../stores/ui'
import { moduleRegistry, type KunYuModule } from '../../modules'
import { useProjectStore } from '../../stores/project'
import { useExplorerStore } from '../../stores/explorer'
import { t, moduleName, moduleDescription } from '../../i18n'
import { PROJECT_TYPE_META, type Project, type ProjectType } from '../../../../shared/types/project'

const ui = useUiStore()
const projectStore = useProjectStore()
const explorerStore = useExplorerStore()

const FileTree = defineAsyncComponent(() => import('../explorer/FileTree.vue'))
const LegacyImportDialog = defineAsyncComponent(() => import('../project/LegacyImportDialog.vue'))

const importChoiceVisible = ref(false)
const legacyImportVisible = ref(false)

const sidebarCache = new Map<string, Component>()

function resolveSidebar(mod: KunYuModule | undefined): Component | undefined {
  if (!mod?.sidebarLoader) return undefined
  // project-manager 侧边栏改为内联双态，不缓存模块注册的 FileTree
  if (mod.id === 'project-manager') return undefined
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

const iconMap: Record<ProjectType, unknown> = {
  mod: Box,
  resourcepack: Picture,
  datapack: DataLine,
  shaderpack: Sunny,
  modpack: Files
}

function typeIcon(type: ProjectType): unknown {
  return iconMap[type]
}

function typeLabel(type: ProjectType): string {
  return PROJECT_TYPE_META[type].label
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = Date.now()
  const diff = now - ts
  if (diff < 60_000) return t('sidebar.justNow')
  if (diff < 3_600_000) return t('sidebar.minutesAgo', { n: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('sidebar.hoursAgo', { n: Math.floor(diff / 3_600_000) })
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 剥掉 Electron IPC 错误包装前缀（"Error invoking remote method 'xxx': ProjectError: …"） */
function prettifyIpcError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/Error invoking remote method '[^']+':\s*(?:\w+:\s*)?(.*)$/s)
  return (m?.[1] ?? msg).trim()
}

/** 路径失效：给出「重新定位 / 从列表移除」两个可执行补救动作 */
async function onStaleProject(p: Project): Promise<void> {
  try {
    const action = await ElMessageBox.confirm(
      t('sidebar.staleBody', { name: p.name, path: p.path }),
      t('sidebar.staleTitle'),
      {
        confirmButtonText: t('sidebar.relocate'),
        cancelButtonText: t('sidebar.removeFromList'),
        distinguishCancelAndClose: true,
        type: 'warning'
      }
    )
    // confirm = 重新定位：主进程弹 OS 对话框选目录后重试打开
    if (action === 'confirm') {
      try {
        const project = await projectStore.relocate(p.id)
        if (!project) return // 用户在 OS 对话框取消
        ElMessage.success(t('sidebar.relocated'))
        await projectStore.open(p.id)
      } catch (err) {
        ElMessage.error(prettifyIpcError(err))
      }
    }
  } catch (action) {
    // cancel = 从列表移除（仅删记录，不动磁盘）；close = 什么都不做
    if (action === 'cancel') {
      await projectStore.delete(p.id, false)
      ElMessage.success(t('sidebar.removedFromList'))
    }
  }
}

/** 从侧边栏列表打开项目（切项目事务在 store.open 内完成：文件树根 + 标签 + watcher） */
async function openProject(id: string): Promise<void> {
  const stale = projectStore.projects.find((p) => p.id === id)
  if (stale?.pathExists === false) {
    await onStaleProject(stale)
    return
  }
  try {
    await projectStore.open(id)
  } catch (err) {
    // 目录在列表刷新后被删除的竞态：同样给补救动作而不是裸报错
    const msg = prettifyIpcError(err)
    const p = projectStore.projects.find((x) => x.id === id)
    if (/项目路径不存在/.test(msg) && p) {
      p.pathExists = false
      await onStaleProject(p)
      return
    }
    ElMessage.error(msg)
  }
}

async function onDelete(p: Project): Promise<void> {
  try {
    const { value } = await ElMessageBox.confirm(
      t('sidebar.deleteConfirm', { name: p.name }),
      t('sidebar.deleteTitle'),
      {
        confirmButtonText: t('sidebar.deleteFiles'),
        cancelButtonText: t('sidebar.deleteRecordOnly'),
        distinguishCancelAndClose: true,
        type: 'warning'
      }
    )
    await projectStore.delete(p.id, value === 'confirm')
    ElMessage.success(t('sidebar.deleted'))
  } catch {
    // 取消
  }
}

async function refreshTree(): Promise<void> {
  if (explorerStore.rootPath) {
    await explorerStore.refreshDir(explorerStore.rootPath)
    ElMessage.success(t('sidebar.treeRefreshed'))
  }
}

function onImport(): void {
  importChoiceVisible.value = true
}

/** 新版本项目：直接选择目录导入 */
async function onImportNew(): Promise<void> {
  importChoiceVisible.value = false
  const dir = await window.api.dialog.selectDirectory()
  if (!dir) return
  try {
    const project = await projectStore.importProject(dir)
    ElMessage.success(t('sidebar.imported', { name: project.name }))
  } catch (err) {
    ElMessage.error(t('sidebar.importFailed', { error: (err as Error).message }))
  }
}

/** 老旧版本项目：展示第三层遗留版本供查看后导入 */
function onImportLegacy(): void {
  importChoiceVisible.value = false
  legacyImportVisible.value = true
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

/* 无项目：空引导 */
.sb-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  text-align: center;
  color: var(--ky-text-dim);
}
.sb-empty-icon {
  opacity: 0.45;
  color: var(--ky-accent);
}
.sb-empty-title {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ky-text-sub);
}
.sb-empty-sub {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
}

/* 项目列表（侧栏紧凑版） */
.sb-projects {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sb-proj-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--ky-text);
  transition: background 0.1s ease;
}
.sb-proj-item:hover {
  background: var(--ky-bg-hover);
}
.sb-proj-item.active {
  background: rgba(var(--ky-accent-rgb), 0.12);
  color: var(--ky-accent);
}
/* 路径失效：置灰 + 角标，点击仍给出补救对话框 */
.sb-proj-item.stale {
  opacity: 0.55;
}
.sb-proj-stale-badge {
  margin-left: 4px;
  padding: 0 4px;
  font-size: 10px;
  line-height: 14px;
  border-radius: 3px;
  color: var(--el-color-warning);
  border: 1px solid var(--el-color-warning);
  vertical-align: 1px;
}
.sb-proj-icon {
  flex-shrink: 0;
  color: var(--ky-accent);
}
.sb-proj-item.active .sb-proj-icon {
  color: var(--ky-accent);
}
.sb-proj-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.sb-proj-name {
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sb-proj-meta {
  font-size: 10.5px;
  color: var(--ky-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sb-proj-del {
  opacity: 0;
  color: var(--ky-text-dim);
  flex-shrink: 0;
}
.sb-proj-item:hover .sb-proj-del {
  opacity: 0.7;
}
.sb-proj-del:hover {
  opacity: 1 !important;
  color: var(--el-color-danger);
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

.sb-import-choices {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sb-import-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--ky-border);
  background: var(--ky-bg-panel);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.sb-import-card:hover {
  border-color: var(--ky-accent);
  background: rgba(var(--ky-accent-rgb), 0.06);
}

.sb-import-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ky-text);
}

.sb-import-card-sub {
  font-size: 12px;
  color: var(--ky-text-sub);
  line-height: 1.5;
}
</style>
