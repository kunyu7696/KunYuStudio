<template>
  <div class="pn-sec">
    <!-- 操作入口：缩进与分组子项对齐 -->
    <button type="button" class="pn-row" @click="ui.openWizard()">
      <span class="pn-mark" />
      <span class="pn-label">{{ t('sidebar.createProject') }}</span>
    </button>
    <button type="button" class="pn-row" @click="importChoiceVisible = true">
      <span class="pn-mark" />
      <span class="pn-label">{{ t('sidebar.importProject') }}</span>
    </button>

    <!-- 项目列表（自侧边栏迁入活动栏分组） -->
    <div v-if="projectStore.loading" class="pn-hint">{{ t('common.loading') }}</div>
    <div v-else-if="projectStore.projects.length === 0" class="pn-hint">
      {{ t('sidebar.emptyTitle') }}
    </div>
    <template v-else>
      <div class="pn-divider" />
      <button
        v-for="p in projectStore.projects"
        :key="p.id"
        type="button"
        class="pn-proj"
        :class="{ active: p.id === projectStore.currentProjectId, stale: p.pathExists === false }"
        :title="p.path"
        @click="openProject(p.id)"
      >
        <el-icon :size="14" class="pn-proj-icon"><component :is="typeIcon(p.type)" /></el-icon>
        <span class="pn-proj-main">
          <span class="pn-proj-name">
            {{ p.name }}
            <span v-if="p.pathExists === false" class="pn-stale">{{ t('sidebar.staleBadge') }}</span>
          </span>
          <span class="pn-proj-meta">{{ metaOf(p) }}</span>
        </span>
        <span class="pn-proj-del" :title="t('sidebar.delete')" @click.stop="onDelete(p)">
          <el-icon :size="13"><Delete /></el-icon>
        </span>
      </button>
    </template>

    <!-- 导入项目：选择老旧版本 / 新版本 -->
    <el-dialog
      v-model="importChoiceVisible"
      :title="t('sidebar.importDialogTitle')"
      width="420px"
      append-to-body
    >
      <div class="pn-import-choices">
        <button type="button" class="pn-import-card" @click="onImportNew">
          <span class="pn-import-card-title">{{ t('sidebar.importNewTitle') }}</span>
          <span class="pn-import-card-sub">{{ t('sidebar.importNewDesc') }}</span>
        </button>
        <button type="button" class="pn-import-card" @click="onImportLegacy">
          <span class="pn-import-card-title">{{ t('sidebar.importLegacyTitle') }}</span>
          <span class="pn-import-card-sub">{{ t('sidebar.importLegacyDesc') }}</span>
        </button>
      </div>
    </el-dialog>

    <!-- 老旧版本导入：展示第三层遗留版本供查看后导入 -->
    <LegacyImportDialog v-model="legacyImportVisible" />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Box, DataLine, Delete, Files, Picture, Sunny } from '@element-plus/icons-vue'
import { useUiStore } from '../../stores/ui'
import { useProjectStore } from '../../stores/project'
import { t } from '../../i18n'
import { PROJECT_TYPE_META, type Project, type ProjectType } from '../../../../shared/types/project'

/**
 * 活动栏「项目管理」分组内容（创建/导入 + 项目列表）。
 * 从 SideBar 迁入：项目管理模块无项目时不再占侧边栏，列表改由活动栏承载。
 */

const ui = useUiStore()
const projectStore = useProjectStore()

const LegacyImportDialog = defineAsyncComponent(() => import('../project/LegacyImportDialog.vue'))

const importChoiceVisible = ref(false)
const legacyImportVisible = ref(false)

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

function metaOf(p: Project): string {
  const kind = p.type === 'mod' ? `${p.loader} · ${p.mcVersion}` : PROJECT_TYPE_META[p.type].label
  return `${kind} · ${formatTime(p.lastOpenedAt)}`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const diff = Date.now() - ts
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

/** 从列表打开项目（切项目事务在 store.open 内完成：文件树根 + 标签 + watcher） */
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
</script>

<style scoped>
.pn-sec {
  padding-bottom: 4px;
}

/* 行外观与活动栏子项一致：13.5px，左侧留 26px 缩进（18px 标记槽 + 8px） */
.pn-row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 30px;
  padding: 0 10px 0 26px;
  border: none;
  background: transparent;
  color: var(--ky-text-sub);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.pn-row:hover {
  color: var(--ky-text);
  background: var(--ky-bg-hover);
}

.pn-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pn-divider {
  height: 1px;
  margin: 4px 10px 4px 26px;
  background: var(--ky-border);
}

.pn-hint {
  padding: 4px 10px 6px 26px;
  font-size: 12px;
  color: var(--ky-text-dim);
}

/* 项目条目：两行（名称 + 类型/时间），悬停浮现删除 */
.pn-proj {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px 4px 26px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.pn-proj:hover {
  background: var(--ky-bg-hover);
}

.pn-proj.active {
  background: var(--ky-accent-soft);
}

.pn-proj-icon {
  flex-shrink: 0;
  color: var(--ky-text-dim);
}

.pn-proj.active .pn-proj-icon {
  color: var(--ky-accent);
}

.pn-proj-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pn-proj-name {
  font-size: 12.5px;
  line-height: 1.3;
  color: var(--ky-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pn-proj.stale .pn-proj-name {
  color: var(--ky-text-dim);
}

.pn-proj-meta {
  font-size: 11px;
  line-height: 1.3;
  color: var(--ky-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pn-stale {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--ky-danger-soft, rgba(220, 80, 80, 0.15));
  color: var(--ky-danger, #d05050);
  font-size: 10px;
}

.pn-proj-del {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  color: var(--ky-text-dim);
  opacity: 0;
  transition:
    opacity 0.15s ease,
    color 0.15s ease;
}

.pn-proj:hover .pn-proj-del {
  opacity: 1;
}

.pn-proj-del:hover {
  color: var(--ky-danger, #d05050);
  background: var(--ky-bg-panel);
}

/* 导入方式选择卡片 */
.pn-import-choices {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pn-import-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  background: var(--ky-bg-panel);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.pn-import-card:hover {
  border-color: var(--ky-accent);
}

.pn-import-card-title {
  font-size: 13px;
  color: var(--ky-text);
}

.pn-import-card-sub {
  font-size: 11.5px;
  color: var(--ky-text-dim);
}
</style>
