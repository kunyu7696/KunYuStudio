<template>
  <aside class="modlib-panel">
    <!-- 头部 -->
    <header class="ml-head">
      <div class="ml-title">
        <el-icon :size="14" class="ml-title-icon"><Box /></el-icon>
        <span>{{ t('modlib.title') }}</span>
      </div>
      <div class="ml-head-actions">
        <el-button size="small" text :title="t('modlib.importTitle')" @click="onPickImport">
          <el-icon><FolderAdd /></el-icon>
        </el-button>
        <el-button size="small" text :title="t('modlib.collapse')" @click="ui.toggleModLibrary()">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
    </header>

    <!-- 版本 / 加载器 / 类型选择（既是库过滤，也是市场搜索条件） -->
    <div class="ml-filters">
      <el-select v-model="mcFilter" size="small" class="ml-select" @change="reloadLibrary">
        <el-option :label="t('modlib.allMcVersions')" value="" />
        <el-option v-for="v in MC_VERSIONS" :key="v" :label="v" :value="v" />
      </el-select>
      <el-select v-model="loaderFilter" size="small" class="ml-select" @change="reloadLibrary">
        <el-option :label="t('modlib.allLoaders')" value="" />
        <el-option v-for="ld in LOADERS" :key="ld" :label="LOADER_TEXT[ld]" :value="ld" />
      </el-select>
      <el-select v-model="typeFilter" size="small" class="ml-select" @change="reloadLibrary">
        <el-option :label="t('modlib.allTypes')" value="" />
        <el-option v-for="rt in RESOURCE_TYPES" :key="rt" :label="typeText(rt)" :value="rt" />
      </el-select>
    </div>

    <!-- 我的库 / 社区市场 -->
    <div class="ml-tabs">
      <button
        type="button"
        class="ml-tab"
        :class="{ 'is-active': tab === 'library' }"
        @click="tab = 'library'"
      >
        {{ t('modlib.myLibrary') }}<span class="ml-tab-count">{{ entries.length }}</span>
      </button>
      <button
        type="button"
        class="ml-tab"
        :class="{ 'is-active': tab === 'market' }"
        @click="tab = 'market'"
      >
        {{ t('modlib.communityMarket') }}
      </button>
    </div>

    <!-- ============ 我的库：可拖拽模组列表 ============ -->
    <div v-if="tab === 'library'" class="ml-list">
      <div
        v-for="e in entries"
        :key="e.fileName"
        class="ml-card"
        draggable="true"
        :title="t('modlib.dragToAssemble', { file: e.fileName })"
        @dragstart="onDragStart($event, e)"
        @dragend="onDragEnd"
      >
        <div class="ml-card-head">
          <span class="ml-card-icon">
            <img
              v-if="e.iconUrl && !failedIcons.has(e.fileName)"
              :src="e.iconUrl"
              :alt="e.name"
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="onIconError(e.fileName)"
            />
            <span v-else class="ml-card-icon-fallback">{{ initialOf(e.name) }}</span>
          </span>
          <span class="ml-card-name">{{ e.name }}</span>
          <button
            type="button"
            class="ml-card-del"
            :title="t('modlib.removeFromLibrary')"
            @click.stop="onRemove(e.fileName)"
          >
            <el-icon :size="12"><Close /></el-icon>
          </button>
        </div>
        <div class="ml-card-tags">
          <span v-if="e.resourceType !== 'mod'" class="ml-tag is-type">
            {{ typeText(e.resourceType) }}
          </span>
          <span v-for="ld in displayLoaders(e)" :key="`l-${ld}`" class="ml-tag is-loader">
            {{ LOADER_TEXT[ld] ?? ld }}
          </span>
          <span v-for="v in displayMcVersions(e)" :key="`v-${v}`" class="ml-tag is-mc">{{ v }}</span>
          <span v-if="e.platform === 'local'" class="ml-tag is-local">
            {{ t('modlib.localImportTag') }}
          </span>
        </div>
        <div class="ml-card-meta">
          <span v-if="e.versionNumber">{{ e.versionNumber }} · </span>{{ formatSize(e.size) }}
        </div>
        <div class="ml-card-ops">
          <el-button
            size="small"
            type="primary"
            plain
            :disabled="e.resourceType === 'modpack'"
            :title="e.resourceType === 'modpack' ? t('modlib.modpackImportHint') : t('modlib.addToAssembleTitle')"
            @click.stop="onAddToProject(e)"
          >
            <el-icon :size="12"><Plus /></el-icon>
            {{ t('modlib.addToAssemble') }}
          </el-button>
        </div>
      </div>

      <div v-if="!entries.length && !loading" class="ml-empty">
        <el-icon :size="26" class="ml-empty-icon"><Files /></el-icon>
        <p>{{ t('modlib.emptyFilteredShort') }}</p>
        <el-button size="small" type="primary" plain @click="tab = 'market'">
          {{ t('modlib.goMarket') }}
        </el-button>
      </div>
    </div>

    <!-- ============ 社区市场：搜索 → 选版本 → 下载入库 ============ -->
    <div v-else class="ml-market">
      <div class="ml-search">
        <el-input
          v-model="searchQuery"
          size="small"
          :placeholder="t('modlib.searchMarketPlaceholder')"
          clearable
          @keyup.enter="onSearch"
        />
        <el-button size="small" type="primary" :loading="searching" @click="onSearch">
          {{ t('modlib.search') }}
        </el-button>
      </div>

      <div class="ml-list">
        <div v-for="m in searchResults" :key="`${m.platform}-${m.id}`" class="ml-market-item">
          <button type="button" class="ml-market-main" @click="toggleDetail(m)">
            <img v-if="m.iconUrl" :src="m.iconUrl" class="ml-market-icon" referrerpolicy="no-referrer" />
            <div v-else class="ml-market-icon is-fallback">
              <el-icon><Box /></el-icon>
            </div>
            <div class="ml-market-info">
              <span class="ml-market-name">{{ m.nameZh || m.name }}</span>
              <span class="ml-market-sub">
                {{ m.loaders.slice(0, 3).join(' / ') || t('modlib.unknownLoader') }}
              </span>
            </div>
            <el-icon class="ml-market-caret">
              <component :is="expandedId === `${m.platform}:${m.id}` ? ArrowUp : ArrowDown" />
            </el-icon>
          </button>

          <!-- 版本文件列表 -->
          <div v-if="expandedId === `${m.platform}:${m.id}`" class="ml-files">
            <div v-if="loadingDetail" class="ml-files-msg">{{ t('modlib.loadingVersions') }}</div>
            <div v-else-if="!detailFiles.length" class="ml-files-msg">
              {{ t('modlib.noVersions') }}
            </div>
            <div
              v-for="f in detailFiles.slice(0, 8)"
              :key="f.id"
              class="ml-file-row"
            >
              <div class="ml-file-info">
                <span class="ml-file-ver">{{ f.versionNumber }}</span>
                <span class="ml-file-tags">
                  {{ f.loaders.join('/') || '?' }} · {{ f.gameVersions.slice(0, 2).join('/') }}
                </span>
              </div>
              <el-button
                size="small"
                type="success"
                plain
                :loading="downloadingId === f.id"
                @click="onDownload(m, f)"
              >
                {{ t('modlib.downloadToLibrary') }}
              </el-button>
            </div>
            <div v-if="detailFiles.length > 8" class="ml-files-msg">
              {{ t('modlib.onlyRecent') }}
            </div>
          </div>
        </div>

        <div v-if="!searchResults.length && !searching" class="ml-empty">
          <p>{{ t('modlib.searchHint') }}</p>
          <p class="ml-empty-hint">{{ t('modlib.searchHintSub') }}</p>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, ArrowUp, Box, Close, Files, FolderAdd, Plus } from '@element-plus/icons-vue'
import { useUiStore } from '../../stores/ui'
import { useProjectStore } from '../../stores/project'
import { useModpackStore } from '../../stores/modpack'
import { t } from '../../i18n'
import { addLibraryModToProject } from '../../modules/modpack/addLibraryMod'
import { MODLIB_MIME } from '../../../../shared/modlibDnd'
import type { ModLibraryEntry, ResourceLibraryType } from '../../../../shared/types/modLibrary'
import type { MarketModFile, MarketModSummary, ModPlatform } from '../../../../shared/types/market'

/** 版本矩阵登记的 MC 版本（与 loaderVersionMatrix.allMatrixMcVersions 对齐） */
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

const ui = useUiStore()
const projectStore = useProjectStore()
const modpackStore = useModpackStore()

const tab = ref<'library' | 'market'>('library')
const loading = ref(false)
const entries = ref<ModLibraryEntry[]>([])
/** 图标加载失败的文件名：回退首字母占位 */
const failedIcons = ref<Set<string>>(new Set())

// 筛选默认跟随当前整合包项目
const mcFilter = ref('')
const loaderFilter = ref('')
const typeFilter = ref('')

// ---------------- 我的库 ----------------

async function reloadLibrary(): Promise<void> {
  loading.value = true
  try {
    entries.value = await window.api.modlib.list({
      mcVersion: mcFilter.value || undefined,
      loader: loaderFilter.value || undefined,
      type: (typeFilter.value || undefined) as ResourceLibraryType | undefined
    })
  } catch (err) {
    ElMessage.error(t('modlib.loadFailed', { error: (err as Error).message }))
  } finally {
    loading.value = false
  }
}

function onIconError(fileName: string): void {
  failedIcons.value.add(fileName)
}

function initialOf(name: string): string {
  const ch = [...name.trim()][0]
  return ch ? ch.toUpperCase() : '?'
}

async function onRemove(fileName: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('modlib.removeConfirmShort', { name: fileName }),
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
  const ok = await window.api.modlib.remove(fileName)
  if (ok) {
    ElMessage.success(t('modlib.removed'))
    await reloadLibrary()
  }
}

async function onPickImport(): Promise<void> {
  const imported = await window.api.modlib.pickAndImport()
  if (imported.length) {
    ElMessage.success(t('modlib.imported', { n: imported.length }))
    await reloadLibrary()
  }
}

// ---------------- 拖拽源 + 卡片按钮 ----------------

function onDragStart(event: DragEvent, entry: ModLibraryEntry): void {
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'copy'
  event.dataTransfer.setData(
    MODLIB_MIME,
    JSON.stringify({ fileName: entry.fileName, name: entry.name, resourceType: entry.resourceType })
  )
}

function onDragEnd(): void {
  /* 拖放结果由目标侧处理；这里无需动作 */
}

/**
 * 卡片「加入组装」按钮（真机反馈 P2-9：拖放是唯一入口，触屏/键盘/远程桌面无替代路径）。
 * 与 ModpackView 拖放共用 addLibraryModToProject。
 */
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

/** 卡片上最多展示 3 个加载器 / 2 个 MC 版本，避免标签撑爆窄栏 */
function displayLoaders(e: ModLibraryEntry): string[] {
  return e.loaders.slice(0, 3)
}
function displayMcVersions(e: ModLibraryEntry): string[] {
  return e.gameVersions.slice(0, 2)
}

// ---------------- 社区市场 ----------------

const searchQuery = ref('')
const searching = ref(false)
const searchResults = ref<MarketModSummary[]>([])
const expandedId = ref<string | null>(null)
const loadingDetail = ref(false)
const detailFiles = ref<MarketModFile[]>([])
const downloadingId = ref<string | null>(null)

async function onSearch(): Promise<void> {
  if (!searchQuery.value.trim()) return
  searching.value = true
  expandedId.value = null
  detailFiles.value = []
  try {
    // Modrinth 免 Key 先查；结果为空时再试 CurseForge（MCIM 镜像）
    const [mr, cf] = await Promise.all([
      window.api.market.search({
        platform: 'modrinth',
        query: searchQuery.value,
        projectType: 'mod',
        loader: loaderFilter.value || undefined,
        gameVersion: mcFilter.value || undefined,
        pageSize: 20
      }),
      window.api.market.search({
        platform: 'curseforge',
        query: searchQuery.value,
        projectType: 'mod',
        loader: loaderFilter.value || undefined,
        gameVersion: mcFilter.value || undefined,
        pageSize: 20
      })
    ])
    searchResults.value = [...mr.items, ...cf.items]
  } catch (err) {
    ElMessage.error(t('modlib.searchFailed', { error: (err as Error).message }))
    searchResults.value = []
  } finally {
    searching.value = false
  }
}

async function toggleDetail(m: MarketModSummary): Promise<void> {
  const id = `${m.platform}:${m.id}`
  if (expandedId.value === id) {
    expandedId.value = null
    return
  }
  expandedId.value = id
  loadingDetail.value = true
  detailFiles.value = []
  try {
    const detail = await window.api.market.getDetail(m.platform as ModPlatform, m.id, 'mod')
    detailFiles.value = detail.files
  } catch (err) {
    ElMessage.error(t('modlib.detailFailed', { error: (err as Error).message }))
  } finally {
    loadingDetail.value = false
  }
}

async function onDownload(m: MarketModSummary, file: MarketModFile): Promise<void> {
  downloadingId.value = file.id
  try {
    const result = await window.api.modlib.download({
      platform: m.platform,
      projectId: m.id,
      versionId: file.id,
      projectType: m.projectType ?? 'mod'
    })
    if (result.ok) {
      ElMessage.success(t('modlib.downloaded', { name: file.versionNumber || file.fileName }))
      await reloadLibrary()
    } else {
      ElMessage.error(result.error ?? t('modlib.downloadFailed'))
    }
  } catch (err) {
    ElMessage.error(t('modlib.downloadFailedDetail', { error: (err as Error).message }))
  } finally {
    downloadingId.value = null
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const currentProject = computed(() => projectStore.currentProject)

watch(
  currentProject,
  (p) => {
    mcFilter.value = p?.mcVersion ?? ''
    loaderFilter.value = p?.loader ?? ''
    void reloadLibrary()
  },
  { immediate: false }
)

onMounted(() => {
  mcFilter.value = currentProject.value?.mcVersion ?? ''
  loaderFilter.value = currentProject.value?.loader ?? ''
  void reloadLibrary()
  // 旧版条目缺图标：静默补齐一次（离线静默失败，保留首字母占位）
  void (async () => {
    try {
      if (await window.api.modlib.enrichIcons()) await reloadLibrary()
    } catch {
      /* ignore */
    }
  })()
  // 市场详情抽屉「下载到 Mod 库」等外部入库动作后自动刷新
  window.addEventListener('kunyu:modlib-changed', onLibraryChanged)
})

onUnmounted(() => {
  window.removeEventListener('kunyu:modlib-changed', onLibraryChanged)
})

function onLibraryChanged(): void {
  void reloadLibrary()
}
</script>

<style scoped>
.modlib-panel {
  position: relative;
  flex-shrink: 0;
  width: 248px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-sidebar);
  border-left: 1px solid var(--ky-border);
  min-height: 0;
}

.ml-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 8px;
  flex-shrink: 0;
}

.ml-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
}

.ml-title-icon {
  color: var(--ky-accent);
}

.ml-head-actions {
  display: flex;
  align-items: center;
}

/* 筛选器 */
.ml-filters {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 10px 8px;
  flex-shrink: 0;
}

.ml-select {
  width: 100%;
}

/* Tabs */
.ml-tabs {
  display: flex;
  gap: 4px;
  padding: 0 10px 8px;
  flex-shrink: 0;
}

.ml-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px 0;
  border: 1px solid var(--ky-border);
  border-radius: var(--ky-radius-control);
  background: transparent;
  color: var(--ky-text-sub);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ml-tab.is-active {
  color: var(--ky-accent);
  border-color: color-mix(in srgb, var(--ky-accent) 55%, var(--ky-border));
  background: rgba(var(--ky-accent-rgb), 0.08);
}

.ml-tab-count {
  font-size: 10.5px;
  color: var(--ky-text-dim);
}

/* 列表容器 */
.ml-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.ml-list::-webkit-scrollbar {
  width: 6px;
}

.ml-list::-webkit-scrollbar-thumb {
  background: var(--ky-bg-hover);
  border-radius: 3px;
}

/* 库模组卡片（拖拽源） */
.ml-card {
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  background: var(--ky-bg-panel);
  padding: 8px 9px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  cursor: grab;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.ml-card:hover {
  border-color: color-mix(in srgb, var(--ky-accent) 45%, var(--ky-border));
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
}

.ml-card:active {
  cursor: grabbing;
}

.ml-card-head {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.ml-card-icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  overflow: hidden;
  background: var(--el-fill-color-light);
}

.ml-card-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ml-card-icon-fallback {
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-text-dim);
  text-transform: uppercase;
}

.ml-card-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ky-text);
  line-height: 1.35;
  word-break: break-word;
}

.ml-card-del {
  margin-left: auto;
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--ky-text-dim);
  cursor: pointer;
  padding: 1px;
  border-radius: 4px;
  opacity: 0.6;
}

.ml-card-del:hover {
  opacity: 1;
  color: var(--ky-red);
}

.ml-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.ml-tag {
  font-size: 9.5px;
  line-height: 15px;
  padding: 0 5px;
  border-radius: 4px;
  white-space: nowrap;
}

.ml-tag.is-loader {
  background: rgba(var(--ky-accent-rgb), 0.13);
  color: var(--ky-accent);
}

.ml-tag.is-type {
  background: rgba(52, 211, 153, 0.15);
  color: var(--ky-green, #34d399);
}

.ml-tag.is-mc {
  background: rgba(56, 189, 248, 0.13);
  color: var(--ky-blue);
}

.ml-tag.is-local {
  background: var(--ky-bg-hover);
  color: var(--ky-text-dim);
}

.ml-card-meta {
  font-size: 10.5px;
  color: var(--ky-text-dim);
}

.ml-card-ops {
  margin-top: 6px;
  display: flex;
  justify-content: flex-end;
}

.ml-card-ops .el-button {
  padding: 3px 8px;
  font-size: 11px;
  height: auto;
}

/* 空状态 */
.ml-empty {
  margin-top: 30px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--ky-text-dim);
  font-size: 12px;
  text-align: center;
}

.ml-empty-icon {
  opacity: 0.5;
}

.ml-empty-hint {
  font-size: 10.5px;
  opacity: 0.7;
}

/* 社区市场 */
.ml-market {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ml-search {
  display: flex;
  gap: 6px;
  padding: 0 10px 8px;
  flex-shrink: 0;
}

.ml-market-item {
  display: flex;
  flex-direction: column;
}

.ml-market-main {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 7px;
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  background: var(--ky-bg-panel);
  color: var(--ky-text);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}

.ml-market-main:hover {
  border-color: color-mix(in srgb, var(--ky-accent) 40%, var(--ky-border));
}

.ml-market-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
}

.ml-market-icon.is-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ky-bg-hover);
  color: var(--ky-text-dim);
}

.ml-market-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ml-market-name {
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-market-sub {
  font-size: 10px;
  color: var(--ky-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-market-caret {
  flex-shrink: 0;
  color: var(--ky-text-dim);
}

/* 版本文件展开 */
.ml-files {
  margin: 4px 0 6px 12px;
  padding-left: 8px;
  border-left: 2px solid var(--ky-border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ml-files-msg {
  font-size: 10.5px;
  color: var(--ky-text-dim);
  padding: 4px 0;
}

.ml-file-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 6px;
}

.ml-file-row:hover {
  background: var(--ky-bg-hover);
}

.ml-file-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.ml-file-ver {
  font-size: 11px;
  color: var(--ky-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ml-file-tags {
  font-size: 9.5px;
  color: var(--ky-text-dim);
}
</style>
