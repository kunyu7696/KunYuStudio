<!--
  活动栏「资源库」：全局资源库（userData/mod-library）
  - 不绑定项目：市场下载 / 本地导入的 jar/zip/mrpack 统一存放在这里，未打开项目也能查看
  - 打开整合包项目时可按类型一键加入 run/mods、resourcepacks 等目录；其它项目类型只做查看与文件定位
-->
<template>
  <div class="modlib-view">
    <header class="mlv-header">
      <div class="mlv-heading">
        <h2>{{ t('modlib.title') }}</h2>
        <p>{{ t('modlib.subtitle') }}</p>
        <p v-if="rootPath" class="mlv-root">
          {{ t('modlib.libLocation') }}<code>{{ rootPath }}</code>
        </p>
      </div>
      <div class="mlv-actions">
        <el-button :icon="FolderAdd" :loading="importing" @click="onImport">
          {{ t('modlib.importLocal') }}
        </el-button>
        <el-button :icon="FolderOpened" @click="openRoot">{{ t('modlib.openRoot') }}</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="reload">{{ t('modlib.refresh') }}</el-button>
      </div>
    </header>

    <div class="mlv-toolbar">
      <el-input
        v-model="query"
        class="mlv-search"
        :placeholder="t('modlib.searchPlaceholder')"
        clearable
        :prefix-icon="Search"
        @keyup.enter="reload"
        @clear="reload"
      />
      <el-select
        v-model="resourceType"
        class="mlv-select"
        :placeholder="t('modlib.allTypes')"
        clearable
        @change="reload"
      >
        <el-option v-for="rt in RESOURCE_TYPES" :key="rt" :label="typeText(rt)" :value="rt" />
      </el-select>
      <el-select
        v-model="loader"
        class="mlv-select"
        :placeholder="t('modlib.allLoaders')"
        clearable
        @change="reload"
      >
        <el-option v-for="ld in LOADERS" :key="ld" :label="LOADER_TEXT[ld]" :value="ld" />
      </el-select>
      <el-select
        v-model="mcVersion"
        class="mlv-select"
        :placeholder="t('modlib.allMcVersions')"
        clearable
        @change="reload"
      >
        <el-option v-for="v in MC_VERSIONS" :key="v" :label="v" :value="v" />
      </el-select>
      <span class="mlv-count">{{ t('modlib.entryCount', { n: entries.length }) }}</span>
      <el-button v-if="currentModpack" size="small" text @click="reload">
        {{ t('modlib.targetModpack', { name: currentProjectName }) }}
      </el-button>
    </div>

    <el-scrollbar class="mlv-scroll">
      <div v-if="entries.length" class="mlv-grid">
        <article v-for="e in entries" :key="e.fileName" class="mlv-card">
          <div class="mlv-card-head">
            <span class="mlv-icon">
              <img
                v-if="e.iconUrl && !failedIcons.has(e.fileName)"
                :src="e.iconUrl"
                :alt="e.name"
                loading="lazy"
                referrerpolicy="no-referrer"
                @error="onIconError(e.fileName)"
              />
              <span v-else class="mlv-icon-fallback">{{ initialOf(e.name) }}</span>
            </span>
            <div class="mlv-title">
              <span class="mlv-name" :title="e.name">{{ e.name }}</span>
              <span class="mlv-platform">{{ platformText(e) }}</span>
            </div>
          </div>
          <div class="mlv-tags">
            <span v-if="e.resourceType !== 'mod'" class="mlv-tag is-type">
              {{ typeText(e.resourceType) }}
            </span>
            <span v-for="ld in e.loaders.slice(0, 4)" :key="`l-${ld}`" class="mlv-tag is-loader">
              {{ LOADER_TEXT[ld] ?? ld }}
            </span>
            <span v-for="v in e.gameVersions.slice(0, 3)" :key="`v-${v}`" class="mlv-tag is-mc">
              {{ v }}
            </span>
            <span v-if="e.platform === 'local'" class="mlv-tag is-local">
              {{ t('modlib.localImportTag') }}
            </span>
          </div>
          <div class="mlv-meta">
            <span v-if="e.versionNumber">{{ e.versionNumber }} · </span>{{ formatSize(e.size) }}
            <span> · {{ formatDate(e.addedAt) }}</span>
          </div>
          <div class="mlv-file" :title="e.fileName">{{ e.fileName }}</div>
          <div class="mlv-ops">
            <el-button
              v-if="currentModpack"
              type="primary"
              size="small"
              plain
              :icon="Plus"
              :disabled="e.resourceType === 'modpack'"
              :title="e.resourceType === 'modpack' ? t('modlib.modpackImportHint') : ''"
              @click="onAddToProject(e)"
            >
              {{ t('modlib.addToCurrent') }}
            </el-button>
            <el-button size="small" text :icon="Position" @click="onReveal(e.fileName)">
              {{ t('modlib.reveal') }}
            </el-button>
            <el-button size="small" text type="danger" :icon="Delete" @click="onRemove(e)">
              {{ t('modlib.remove') }}
            </el-button>
          </div>
        </article>
      </div>

      <div v-else-if="!loading" class="mlv-empty">
        <el-icon :size="28"><FolderOpened /></el-icon>
        <p v-if="hasFilter">{{ t('modlib.emptyFiltered') }}</p>
        <template v-else>
          <p>{{ t('modlib.emptyLibrary') }}</p>
          <p class="mlv-empty-hint">{{ t('modlib.emptyHint') }}</p>
        </template>
        <el-button size="small" type="primary" plain :icon="FolderAdd" @click="onImport">
          {{ t('modlib.importLocal') }}
        </el-button>
      </div>
    </el-scrollbar>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Delete,
  FolderAdd,
  FolderOpened,
  Plus,
  Position,
  Refresh,
  Search
} from '@element-plus/icons-vue'
import { useProjectStore } from '../../stores/project'
import { useModpackStore } from '../../stores/modpack'
import { t } from '../../i18n'
import { addLibraryModToProject } from '../modpack/addLibraryMod'
import type { ModLibraryEntry, ResourceLibraryType } from '../../../../shared/types/modLibrary'

/** 版本矩阵登记的 MC 版本（与 ModLibraryPanel 保持一致） */
const MC_VERSIONS = ['1.16.5', '1.18.2', '1.19.2', '1.20.1', '1.20.4', '1.20.6', '1.21.1', '1.21.3', '1.21.4', '1.21.5']
const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt']
const LOADER_TEXT: Record<string, string> = {
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt'
}
const RESOURCE_TYPES: readonly ResourceLibraryType[] = ['mod', 'resourcepack', 'datapack', 'shader', 'modpack']

/** 资源类型展示文案：modlib.type.{type} */
function typeText(type: ResourceLibraryType): string {
  return t(`modlib.type.${type}`)
}

const projectStore = useProjectStore()
const modpackStore = useModpackStore()

const entries = ref<ModLibraryEntry[]>([])
const loading = ref(false)
const importing = ref(false)
const rootPath = ref('')
const query = ref('')
const resourceType = ref('')
const loader = ref('')
const mcVersion = ref('')
/** 图标加载失败的文件名集合：回退首字母，避免反复请求坏链 */
const failedIcons = ref<Set<string>>(new Set())

const currentModpack = computed(() => projectStore.currentProject?.type === 'modpack')
const currentProjectName = computed(
  () => projectStore.currentProject?.name ?? t('modlib.currentModpack')
)
const hasFilter = computed(() => !!(query.value.trim() || resourceType.value || loader.value || mcVersion.value))

async function reload(): Promise<void> {
  loading.value = true
  try {
    entries.value = await window.api.modlib.list({
      type: (resourceType.value || undefined) as ResourceLibraryType | undefined,
      loader: loader.value || undefined,
      mcVersion: mcVersion.value || undefined,
      query: query.value.trim() || undefined
    })
  } catch (err) {
    ElMessage.error(t('modlib.loadFailed', { error: (err as Error).message }))
  } finally {
    loading.value = false
  }
}

/** 旧版条目没有图标：静默补齐一次，有更新才刷新列表（离线时静默失败） */
async function backfillIcons(): Promise<void> {
  try {
    const changed = await window.api.modlib.enrichIcons()
    if (changed && !hasFilter.value) await reload()
  } catch {
    /* 离线或缺 API Key：保留首字母占位 */
  }
}

function onIconError(fileName: string): void {
  failedIcons.value.add(fileName)
}

function initialOf(name: string): string {
  const ch = [...name.trim()][0]
  return ch ? ch.toUpperCase() : '?'
}

async function onImport(): Promise<void> {
  importing.value = true
  try {
    const imported = await window.api.modlib.pickAndImport()
    if (imported.length) {
      ElMessage.success(t('modlib.imported', { n: imported.length }))
      // 广播变更（本视图也订阅该事件，无需再手动 reload，避免重复请求）
      notifyChanged()
    }
  } catch (err) {
    ElMessage.error(t('modlib.importFailed', { error: (err as Error).message }))
  } finally {
    importing.value = false
  }
}

async function onRemove(entry: ModLibraryEntry): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('modlib.removeConfirm', { name: entry.name }),
      t('modlib.removeTitle'),
      {
        type: 'warning',
        confirmButtonText: t('modlib.remove'),
        cancelButtonText: t('modlib.cancel')
      }
    )
  } catch {
    return
  }
  const ok = await window.api.modlib.remove(entry.fileName)
  if (ok) {
    ElMessage.success(t('modlib.removed'))
    notifyChanged()
  } else {
    ElMessage.warning(t('modlib.removeFailed'))
    await reload()
  }
}

async function onAddToProject(entry: ModLibraryEntry): Promise<void> {
  await addLibraryModToProject(
    {
      projectPath: projectStore.currentProject?.path,
      projectType: projectStore.currentProject?.type,
      store: modpackStore
    },
    entry
  )
}

async function onReveal(fileName: string): Promise<void> {
  const ok = await window.api.modlib.reveal(fileName)
  if (!ok) ElMessage.warning(t('modlib.revealFailed'))
}

async function openRoot(): Promise<void> {
  if (!rootPath.value) return
  const ok = await window.api.shell.showItemInFolder(rootPath.value)
  if (!ok) ElMessage.warning(t('modlib.rootMissing', { path: rootPath.value }))
}

/** 通知右侧 Mod 库面板等其它入口刷新 */
function notifyChanged(): void {
  window.dispatchEvent(new CustomEvent('kunyu:modlib-changed'))
}

function platformText(e: ModLibraryEntry): string {
  if (e.platform === 'local') return t('modlib.platformLocal')
  return e.platform === 'curseforge' ? 'CurseForge' : 'Modrinth'
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(+d)) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function onLibraryChanged(): Promise<void> {
  await reload()
}

onMounted(async () => {
  window.addEventListener('kunyu:modlib-changed', onLibraryChanged)
  try {
    rootPath.value = await window.api.modlib.root()
  } catch {
    rootPath.value = ''
  }
  await reload()
  void backfillIcons()
})

onUnmounted(() => {
  window.removeEventListener('kunyu:modlib-changed', onLibraryChanged)
})
</script>

<style scoped>
.modlib-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 14px 16px 0;
  box-sizing: border-box;
}

.mlv-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex: none;
}

.mlv-heading h2 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}

.mlv-heading p {
  margin: 0;
  max-width: 720px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.mlv-root {
  margin-top: 4px !important;
}

.mlv-heading code {
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--el-fill-color-light);
}

.mlv-actions {
  display: flex;
  flex: none;
}

.mlv-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.mlv-search {
  max-width: 260px;
}

.mlv-select {
  width: 140px;
}

.mlv-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-left: auto;
}

.mlv-scroll {
  flex: 1;
  min-height: 0;
  padding-top: 10px;
}

.mlv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
  padding-bottom: 16px;
}

.mlv-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-fill-color-blank);
  transition: border-color 0.15s;
}

.mlv-card:hover {
  border-color: var(--el-color-primary-light-5);
}

.mlv-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mlv-icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--el-fill-color-light);
}

.mlv-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mlv-icon-fallback {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  text-transform: uppercase;
}

.mlv-title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.mlv-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mlv-platform {
  font-size: 11px;
  line-height: 1.4;
  color: var(--el-text-color-placeholder);
}

.mlv-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.mlv-tag {
  font-size: 11px;
  line-height: 16px;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}

.mlv-tag.is-loader {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.mlv-tag.is-type {
  background: var(--el-color-success-light-9);
  color: var(--el-color-success);
}

.mlv-tag.is-local {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}

.mlv-meta {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.mlv-file {
  font-size: 11px;
  color: var(--el-text-color-placeholder);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mlv-ops {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  margin-top: 2px;
}

.mlv-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 16px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.mlv-empty p {
  margin: 0;
  font-size: 13px;
}

.mlv-empty-hint {
  font-size: 12px !important;
  color: var(--el-text-color-placeholder);
  max-width: 460px;
  line-height: 1.6;
}
</style>
