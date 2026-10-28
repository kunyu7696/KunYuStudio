<template>
  <div class="market-view">
    <!-- 外层：三个子页切换 -->
    <el-tabs v-model="activeTab" class="mv-root-tabs">
      <el-tab-pane :label="t('market.tabMarket', { type: typeLabel })" name="market">
        <!-- 内容类型切换：模组/数据包/资源包/光影包/整合包 -->
        <div class="mv-toolbar mv-typebar">
          <el-radio-group v-model="projectType" size="default" @change="onTypeChange">
            <el-radio-button v-for="pt in PROJECT_TYPE_ORDER" :key="pt" :value="pt">
              {{ typeLabelOf(pt) }}
            </el-radio-button>
          </el-radio-group>

          <el-tooltip :content="t('market.translateTip')" placement="bottom">
            <span class="mv-trans-toggle">
              <el-switch
                :model-value="market.autoTranslate"
                inline-prompt
                :active-text="t('market.translateOn')"
                :inactive-text="t('market.translateOff')"
                @change="market.setAutoTranslate($event as boolean)"
              />
              {{ t('market.autoTranslate') }}
              <span v-if="market.translating" class="mv-translating">{{ t('market.translating') }}</span>
            </span>
          </el-tooltip>
        </div>

        <!-- 顶部：平台切换 + 搜索 + 筛选 -->
        <div class="mv-toolbar">
          <el-radio-group v-model="platform" size="default" @change="onPlatformChange">
            <el-radio-button value="modrinth">Modrinth</el-radio-button>
            <el-radio-button value="curseforge">CurseForge</el-radio-button>
          </el-radio-group>

          <el-input
            v-model="query"
            class="mv-search"
            :placeholder="t('market.searchPlaceholder', { type: typeLabel })"
            clearable
            :prefix-icon="Search"
            @keyup.enter="doSearch"
          />

          <el-select
            v-model="filterLoader"
            :placeholder="t('market.loaderFilter')"
            clearable
            class="mv-filter"
            :disabled="projectType !== 'mod'"
            :title="projectType !== 'mod' ? t('market.loaderFilterModOnly') : ''"
          >
            <el-option label="Fabric" value="fabric" />
            <el-option label="Forge" value="forge" />
            <el-option label="NeoForge" value="neoforge" />
            <el-option label="Quilt" value="quilt" />
          </el-select>

          <el-select v-model="filterGameVersion" :placeholder="t('market.mcVersionFilter')" clearable class="mv-filter">
            <el-option v-for="v in mcVersions" :key="v" :label="v" :value="v" />
          </el-select>

          <el-button type="primary" :icon="Search" :loading="loading" @click="doSearch">{{ t('market.search') }}</el-button>
        </div>

        <el-alert
          v-if="platform === 'curseforge' && projectType === 'datapack'"
          type="info"
          :closable="false"
          show-icon
          class="mv-alert"
        >
          {{ t('market.cfDatapackHint') }}
        </el-alert>

        <el-alert
          v-if="platform === 'curseforge' && !curseforgeConfigured"
          type="info"
          :closable="false"
          show-icon
          class="mv-alert"
        >
          {{ t('market.cfNoKeyLead') }}<el-link type="primary" @click="goSettings">{{ t('market.cfNoKeyLink') }}</el-link>{{ t('market.cfNoKeyTail') }}
        </el-alert>

        <el-alert
          v-if="market.translatedTerms.length"
          type="info"
          :closable="false"
          show-icon
          class="mv-alert"
        >
          {{ t('market.translatedLead') }}
          <el-tag
            v-for="term in market.translatedTerms"
            :key="term.zh"
            size="small"
            :type="term.kind === 'alias' ? 'success' : 'info'"
            class="mv-trans-tag"
          >
            {{ term.zh }} → {{ term.en }}
          </el-tag>
        </el-alert>

        <el-alert
          v-if="market.untranslatedZh.length"
          type="warning"
          :closable="false"
          show-icon
          class="mv-alert"
        >
          {{ t('market.untranslatedLead') }}
          <el-tag
            v-for="w in market.untranslatedZh"
            :key="w"
            size="small"
            type="warning"
            class="mv-trans-tag"
          >{{ w }}</el-tag>
          {{ t('market.untranslatedHint') }}
          <el-link type="primary" :underline="false" @click="searchMcmod">{{ t('market.untranslatedLink') }}</el-link>
          。
        </el-alert>

        <!-- 精选模组：合规直达（仅元数据+外链，点击走平台实时拉取，不内置任何文件） -->
        <div v-if="projectType === 'mod'" class="mv-curated">
          <div class="mv-curated-head">{{ t('market.curatedHead') }}</div>
          <div class="mv-curated-row">
            <div
              v-for="p in curatedPresets"
              :key="`${p.platform}-${p.slug}`"
              class="mv-curated-card"
              :class="{ 'is-fabric-incompat': p.fabricIncompatible }"
              @click="openCurated(p)"
            >
              <div class="mv-curated-title">
                {{ p.name }}
                <el-tag
                  v-if="p.fabricIncompatible"
                  size="small"
                  type="danger"
                  effect="dark"
                >{{ t('market.fabricIncompat') }}</el-tag>
              </div>
              <div class="mv-curated-summary">{{ p.summary }}</div>
              <div class="mv-curated-meta">
                <el-tag v-for="l in p.loaders" :key="l" size="small" type="warning">{{ l }}</el-tag>
                <el-tag v-for="v in p.gameVersions" :key="v" size="small" type="success">{{ v }}</el-tag>
                <el-tag size="small" type="info">{{ p.license }}</el-tag>
              </div>
              <div class="mv-curated-note">{{ p.note }}</div>
            </div>
          </div>
        </div>

        <div v-if="error" class="mv-error">{{ error }}</div>

        <!-- 结果卡片网格 -->
        <div v-loading="loading" class="mv-grid">
          <div
            v-for="item in items"
            :key="`${item.platform}-${item.id}`"
            class="mv-card"
            @click="openDetail(item)"
          >
            <img v-if="item.iconUrl" :src="item.iconUrl" class="mv-card-icon" />
            <div v-else class="mv-card-icon mv-card-icon-placeholder">?</div>
            <div class="mv-card-body">
              <div class="mv-card-title">
                {{ item.name }}
                <span v-if="item.nameZh && item.nameZh !== item.name" class="mv-card-title-zh">{{ item.nameZh }}</span>
              </div>
              <div class="mv-card-summary">{{ item.summaryZh || item.summary }}</div>
              <div class="mv-card-meta">
                <el-tag size="small" type="info">{{ t('market.downloads', { n: formatDownloads(item.downloads) }) }}</el-tag>
                <el-tag v-for="l in item.loaders.slice(0, 3)" :key="l" size="small" class="mv-tag">{{ l }}</el-tag>
              </div>
            </div>
          </div>
          <el-empty v-if="!loading && items.length === 0" :description="t('market.emptyResults')" />
        </div>

        <!-- 底部分页栏 -->
        <div v-if="total != null && totalPages > 1" class="mv-pager">
          <el-pagination
            background
            layout="prev, pager, next"
            :current-page="currentPage + 1"
            :page-size="pageSize"
            :total="total"
            @current-change="onPageChange"
          />
          <span class="mv-pager-info">{{ t('market.pagerInfo', { total, pages: totalPages }) }}</span>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="t('market.tabCommunity')" name="community">
        <CommunityViewInner />
      </el-tab-pane>
    </el-tabs>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailVisible" :title="t('market.detailTitle', { type: typeLabel })" size="480px" direction="rtl">
      <div v-loading="detailLoading" class="mv-detail-wrap">
      <div v-if="activeDetail" class="mv-detail">
        <div class="mv-detail-head">
          <img v-if="activeDetail.iconUrl" :src="activeDetail.iconUrl" class="mv-detail-icon" />
          <div>
            <h3>
              {{ activeDetail.name }}
              <span v-if="activeDetail.nameZh && activeDetail.nameZh !== activeDetail.name" class="mv-detail-name-zh">{{ activeDetail.nameZh }}</span>
            </h3>
            <div class="mv-detail-authors">{{ activeDetail.authors.join(', ') || '—' }}</div>
          </div>
        </div>
        <p class="mv-detail-summary">{{ activeDetail.summaryZh || activeDetail.summary }}</p>
        <el-button :icon="Link" @click="openExternal(activeDetail.url)">{{ t('market.openOn', { platform: platformLabel }) }}</el-button>

        <el-divider>{{ downloadToLibrary ? t('market.versionsDividerDownload') : t('market.versionsDividerInstall') }}</el-divider>
        <!-- 加载器 / MC 版本筛选：默认跟随市场工具栏的筛选条件 -->
        <div class="mv-detail-filters">
          <el-select
            v-model="detailLoader"
            :placeholder="t('market.allLoaders')"
            clearable
            size="small"
            :disabled="projectType !== 'mod'"
          >
            <el-option v-for="l in detailLoaders" :key="l" :label="cap(l)" :value="l" />
          </el-select>
          <el-select v-model="detailGameVersion" :placeholder="t('market.allMcVersions')" clearable size="small">
            <el-option v-for="v in detailGameVersions" :key="v" :label="v" :value="v" />
          </el-select>
          <span class="mv-detail-count">{{ t('market.versionCount', { n: filteredFiles.length }) }}</span>
        </div>
        <div class="mv-versions">
          <div
            v-for="f in filteredFiles.slice(0, 30)"
            :key="f.id"
            class="mv-version"
          >
            <div class="mv-version-info">
              <div class="mv-version-name">{{ f.name }}</div>
              <div class="mv-version-meta">
                <span>{{ formatSize(f.size) }}</span>
                <el-tag v-for="l in f.loaders" :key="l" size="small" class="mv-tag">{{ l }}</el-tag>
                <el-tag v-for="v in f.gameVersions.slice(0, 2)" :key="v" size="small" type="success">{{ v }}</el-tag>
              </div>
            </div>
            <el-button
              size="small"
              type="primary"
              :loading="isInstalling(f.id)"
              :disabled="!currentProject && !downloadToLibrary"
              @click="installVersion(f.id, f.fileName)"
            >
              {{ currentProject ? (downloadToLibrary ? t('market.actionDownload') : t('market.actionInstall')) : downloadToLibrary ? t('market.actionDownload') : t('market.needProject') }}
            </el-button>
          </div>
          <el-empty
            v-if="filteredFiles.length === 0"
            :description="activeDetail.files.length === 0 ? t('market.emptyNoFiles') : t('market.emptyFiltered')"
          />
        </div>
      </div>
      </div>
    </el-drawer>

    <!-- 安装结果 toast -->
    <el-message
      v-if="lastInstall"
      :type="lastInstall.ok ? 'success' : 'error'"
      :message="installMessage"
      show-close
      @close="clearLastInstall"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Link, Search } from '@element-plus/icons-vue'
import { useMarketStore } from '../../stores/market'
import { useProjectStore } from '../../stores/project'
import { useSettingsStore } from '../../stores/settings'
import { useUiStore } from '../../stores/ui'
import { useI18n } from '../../i18n'
import {
  CURATED_MOD_PRESETS,
  PROJECT_TYPE_META,
  PROJECT_TYPE_ORDER,
  type CuratedModPreset,
  type MarketProjectType,
  type ModPlatform
} from '../../../../shared/types/market'

/** 内嵌子视图：懒加载避免提前拉取 */
const CommunityViewInner = defineAsyncComponent(() => import('./CommunityView.vue'))

const market = useMarketStore()
const projectStore = useProjectStore()
const settings = useSettingsStore()
const { t, te } = useI18n()

const activeTab = ref<'market' | 'community'>('market')

const platform = ref<ModPlatform>(market.platform)
const projectType = ref<MarketProjectType>(market.projectType)
const query = ref(market.query)
const filterLoader = ref<string>('')
const filterGameVersion = ref<string>('')
const detailVisible = ref(false)
/** 详情抽屉内的加载器/版本筛选（打开时跟随市场工具栏筛选） */
const detailLoader = ref<string>('')
const detailGameVersion = ref<string>('')
/** 当前页码（0-based，和后端 page 参数对齐） */
const currentPage = ref(0)
const pageSize = 20

const mcVersions = ['1.21.1', '1.21', '1.20.4', '1.20.1', '1.19.2', '1.18.2', '1.16.5']

const items = computed(() => market.items)
const loading = computed(() => market.loading)
const error = computed(() => market.error)
const activeDetail = computed(() => market.activeDetail)
const detailLoading = computed(() => market.detailLoading)

/** 详情内可选的加载器/MC 版本集合（由文件列表推导，保持首次出现顺序） */
const detailLoaders = computed(() => {
  const set = new Set<string>()
  for (const f of activeDetail.value?.files ?? []) for (const l of f.loaders) set.add(l)
  return [...set]
})
const detailGameVersions = computed(() => {
  const set = new Set<string>()
  for (const f of activeDetail.value?.files ?? []) for (const v of f.gameVersions) set.add(v)
  return [...set]
})
/** 按抽屉内筛选条件过滤版本列表 */
const filteredFiles = computed(() => {
  const files = activeDetail.value?.files ?? []
  return files.filter((f) => {
    if (detailLoader.value && !f.loaders.map((l) => l.toLowerCase()).includes(detailLoader.value.toLowerCase())) {
      return false
    }
    if (detailGameVersion.value && !f.gameVersions.includes(detailGameVersion.value)) return false
    return true
  })
})

/** 加载器标签首字母大写（fabric → Fabric） */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const lastInstall = computed(() => market.lastInstall)
// lastInstall 是只读 computed，模板不能直接赋值清除（vue-tsc 3.3.13 起报 TS2540），
// 故经 store action 侧置空
function clearLastInstall(): void {
  market.lastInstall = null
}
const currentProject = computed(() => projectStore.currentProject)
/** 整合包项目 + 模组内容：动作是「下载到 Mod 库」，由开发者拖入组装区，不直接写 run/mods */
const isModpackMod = computed(
  () => currentProject.value?.type === 'modpack' && projectType.value === 'mod'
)
/**
 * 下载落点是否为全局 Mod 库：
 * - 整合包项目里的模组 → Mod 库（再由组装区拖入 run/mods）
 * - 未打开任何项目时的模组 → Mod 库（主页也能先把 jar 备好，不必先建项目）
 */
const downloadToLibrary = computed(
  () => projectType.value === 'mod' && (isModpackMod.value || !currentProject.value)
)
/** Mod 库下载中标记（versionId 维度） */
const downloading = ref(new Set<string>())
const total = computed(() => market.total)
/** 总页数，page=0-based，传给 el-pagination 时加 1 */
const totalPages = computed(() => {
  if (total.value == null) return 0
  return Math.max(1, Math.ceil(total.value / pageSize))
})

const curseforgeConfigured = computed(() => !!settings.marketplace.curseforgeApiKey)
const platformLabel = computed(() => (platform.value === 'curseforge' ? 'CurseForge' : 'Modrinth'))
/** 内容类型标签：渲染层按 market.type.* 翻译，共享层中文原名兜底 */
function typeLabelOf(type: MarketProjectType): string {
  const key = `market.type.${type}`
  return te(key) ? t(key) : PROJECT_TYPE_META[type].label
}
const typeLabel = computed(() => typeLabelOf(projectType.value))

/** 精选合规直达预设（仅元数据+外链，点击走平台实时检索） */
const curatedPresets = CURATED_MOD_PRESETS

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return bytes + ' B'
}

const installMessage = computed(() => {
  const r = lastInstall.value
  if (!r) return ''
  if (r.ok) {
    const where = r.installedDir ? t('market.installOkWhere', { dir: r.installedDir }) : ''
    const deps = r.dependenciesInstalled?.length ? t('market.installOkDeps', { n: r.dependenciesInstalled.length }) : ''
    return t('market.installOkBase', { name: r.fileName ?? '' }) + where + deps + (r.note ? t('market.installOkNote', { note: r.note }) : '')
  }
  if (r.conflict) return t('market.conflictExists', { file: r.conflict.existingFile })
  return t('market.installFail', { error: r.error ?? '' })
})

function onPlatformChange(): void {
  market.platform = platform.value
  doSearch()
}

/** 切换内容类型：同步 store、清空不适用的加载器筛选、回第一页重搜 */
function onTypeChange(): void {
  market.setProjectType(projectType.value)
  if (projectType.value !== 'mod') filterLoader.value = ''
  currentPage.value = 0
  doSearch()
}

async function doSearch(): Promise<void> {
  market.query = query.value
  await market.search({
    platform: platform.value,
    projectType: projectType.value,
    query: query.value,
    loader: filterLoader.value || undefined,
    gameVersion: filterGameVersion.value || undefined,
    page: currentPage.value,
    pageSize
  })
}

/**
 * 精选预设「合规直达」：切换平台与检索词（清空会误伤的过滤器），
 * 走正常市场检索；结果中存在 slug 精确匹配时自动打开详情抽屉。
 * 不下载/内置任何第三方文件。
 */
async function openCurated(p: CuratedModPreset): Promise<void> {
  platform.value = p.platform
  projectType.value = 'mod'
  market.setProjectType('mod')
  query.value = p.slug
  filterLoader.value = ''
  filterGameVersion.value = ''
  currentPage.value = 0
  if (p.fabricIncompatible && currentProject.value?.loader === 'fabric') {
    ElMessage.warning(t('market.fabricIncompatWarn', { name: p.name }))
  }
  await market.search({ platform: p.platform, projectType: 'mod', query: p.slug, page: 0, pageSize })
  const hit = market.items.find((it) => it.slug.toLowerCase() === p.slug.toLowerCase())
  if (hit) await openDetail(hit)
}

/** 翻页：el-pagination 给的是 1-based，转成 0-based 存 */
function onPageChange(p1based: number): void {
  currentPage.value = p1based - 1
  void doSearch()
}

/** 搜索条件变更 → 回第一页再搜 */
watch([query, platform, filterLoader, filterGameVersion], () => {
  currentPage.value = 0
})

async function openDetail(item: { id: string }): Promise<void> {
  // 单击立即打开抽屉（内部转加载态），不再等网络拉完才有反馈
  detailVisible.value = true
  detailLoader.value = projectType.value === 'mod' ? filterLoader.value : ''
  detailGameVersion.value = filterGameVersion.value
  await market.loadDetail(item.id)
}

function isInstalling(versionId: string): boolean {
  if (!activeDetail.value) return false
  if (downloading.value.has(versionId)) return true
  return market.installing.has(`${platform.value}:${activeDetail.value.id}:${versionId}`)
}

async function installVersion(versionId: string, _fileName: string): Promise<void> {
  if (!activeDetail.value) return
  // 无项目时模组仍可下载进全局 Mod 库；其余内容类型必须先有项目
  if (!currentProject.value && !downloadToLibrary.value) return
  // 市场版本列表单击即触发写入，加二次确认防误触（下载到 Mod 库同理）
  const action = downloadToLibrary.value ? t('market.actionToLibrary') : t('market.actionToProject')
  try {
    await ElMessageBox.confirm(
      t('market.confirmAction', { name: activeDetail.value.name, action }),
      t('market.confirmTitle'),
      { type: 'info', confirmButtonText: t('common.confirm'), cancelButtonText: t('common.cancel') }
    )
  } catch {
    return
  }
  // 整合包项目（或未打开项目）：模组只下载进 Mod 库（全局存储），由开发者拖入组装区组装
  if (downloadToLibrary.value) {
    const next = new Set(downloading.value)
    next.add(versionId)
    downloading.value = next
    try {
      const result = await window.api.modlib.download({
        platform: platform.value,
        projectId: activeDetail.value.id,
        versionId,
        projectType: projectType.value
      })
      if (result.ok) {
        ElMessage.success(
          currentProject.value
            ? t('market.downloadedToLibraryProject', { name: result.fileName })
            : t('market.downloadedToLibraryHome', { name: result.fileName })
        )
        // 通知 Mod 库面板刷新列表
        window.dispatchEvent(new CustomEvent('kunyu:modlib-changed'))
      } else {
        ElMessage.error(result.error ?? t('market.downloadFailed'))
      }
    } catch (err) {
      ElMessage.error(t('market.downloadFailedWithError', { error: (err as Error).message }))
    } finally {
      const rest = new Set(downloading.value)
      rest.delete(versionId)
      downloading.value = rest
    }
    return
  }
  const projectPath = currentProject.value?.path
  if (!projectPath) return
  const result = await market.install({
    platform: platform.value,
    projectType: projectType.value,
    modId: activeDetail.value.id,
    versionId,
    projectPath,
    includeDependencies: projectType.value === 'mod'
  })
  if (result.conflict) {
    ElMessage.warning(t('market.conflictOverwrite'))
  }
}

function openExternal(url: string): void {
  void window.api.shell.openExternal(url)
}

/** 英文平台搜不到的中文词，一键带去社区桥接内做 MC百科中文检索（应用内浏览） */
function searchMcmod(): void {
  market.requestCommunitySearch((market.query || '').trim())
  activeTab.value = 'community'
}

function goSettings(): void {
  useUiStore().setActiveModule('settings')
}

watch(detailVisible, (v) => {
  if (!v) market.clearDetail()
})
</script>

<style scoped>
.market-view { padding: 12px 16px; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; overflow: hidden; }
.mv-root-tabs { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.mv-root-tabs :deep(.el-tabs__content) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.mv-root-tabs :deep(.el-tab-pane) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* tab-pane 内部子页 flex 布局：toolbar/alert/error 固定高度，grid 吃剩余空间并滚 */
.mv-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; flex-shrink: 0; }
.mv-typebar { margin-bottom: 8px; }
.mv-trans-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ky-text-dim); }
.mv-translating { color: #fbbf24; }
.mv-card-title-zh { font-size: 12px; font-weight: 400; color: #7f9f87; margin-left: 6px; }
.mv-detail-name-zh { font-size: 13px; font-weight: 400; color: #7f9f87; margin-left: 8px; }
.mv-search { flex: 1; min-width: 200px; }
.mv-filter { width: 120px; flex-shrink: 0; }
.mv-alert { margin-bottom: 8px; flex-shrink: 0; }
.mv-trans-tag { margin-left: 6px; }
.mv-curated { margin-bottom: 12px; flex-shrink: 0; }
.mv-curated-head { font-size: 12px; color: var(--ky-text-dim); margin-bottom: 6px; }
.mv-curated-row { display: flex; gap: 10px; flex-wrap: wrap; }
.mv-curated-card {
  width: 300px;
  max-width: 100%;
  padding: 10px 12px;
  background: var(--ky-bg-panel);
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color .2s;
}
.mv-curated-card:hover { border-color: var(--ky-accent); }
.mv-curated-card.is-fabric-incompat { border-color: #7f2d2d; }
.mv-curated-card.is-fabric-incompat:hover { border-color: #f87171; }
.mv-curated-title { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--ky-text); }
.mv-curated-summary { font-size: 12px; color: var(--ky-text-sub); margin: 4px 0; }
.mv-curated-meta { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px; }
.mv-curated-note { font-size: 11px; color: var(--ky-text-sub); line-height: 1.4; }
.mv-error { color: #f87171; margin-bottom: 8px; flex-shrink: 0; }
.mv-grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  overflow-y: auto;
  align-content: start;
}
.mv-card { display: flex; gap: 12px; padding: 12px; background: var(--ky-bg-panel); border: 1px solid var(--ky-border); border-radius: 6px; cursor: pointer; transition: border-color .2s; }
.mv-card:hover { border-color: var(--ky-accent); }
.mv-card-icon { width: 48px; height: 48px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
.mv-card-icon-placeholder { background: var(--ky-bg-hover); color: var(--ky-text-dim); display: flex; align-items: center; justify-content: center; font-size: 20px; }
.mv-card-body { flex: 1; min-width: 0; }
.mv-card-title { font-weight: 600; color: var(--ky-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mv-card-summary { font-size: 12px; color: var(--ky-text-sub); margin: 4px 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mv-card-meta { display: flex; gap: 4px; flex-wrap: wrap; }
.mv-tag { text-transform: capitalize; }
.mv-detail-head { display: flex; gap: 12px; align-items: center; }
.mv-detail-wrap { min-height: 240px; }
.mv-detail-filters { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.mv-detail-filters .el-select { flex: 1; }
.mv-detail-count { font-size: 11px; color: var(--ky-text-dim); flex-shrink: 0; }
.mv-detail-icon { width: 64px; height: 64px; border-radius: 8px; object-fit: cover; }
.mv-detail-authors { color: var(--ky-text-sub); font-size: 12px; }
.mv-detail-summary { color: var(--ky-text); margin: 12px 0; }
.mv-versions { display: flex; flex-direction: column; gap: 8px; max-height: 50vh; overflow-y: auto; }
.mv-version { display: flex; justify-content: space-between; align-items: center; padding: 10px; background: var(--ky-bg-sidebar); border-radius: 6px; gap: 8px; }
.mv-version-info { flex: 1; min-width: 0; }
.mv-version-name { font-weight: 500; color: var(--ky-text); }
.mv-version-meta { display: flex; gap: 4px; align-items: center; font-size: 12px; color: var(--ky-text-sub); margin-top: 4px; flex-wrap: wrap; }
.mv-pager {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 8px 0 4px;
  border-top: 1px solid var(--ky-border);
}
.mv-pager-info { font-size: 11px; color: var(--ky-text-dim); }
</style>
