<template>
  <div class="mp-view">
    <header class="mp-header">
      <h2>{{ t('modpack.title') }}</h2>
      <p>{{ t('modpack.subtitlePrefix') }} <code>run/mods</code>{{ t('modpack.subtitleSuffix') }}</p>
    </header>

    <!-- 概览 + 动作 -->
    <section class="mp-card">
      <div class="mp-card-title">{{ t('modpack.overview') }}</div>
      <div class="mp-grid">
        <div class="mp-cell">
          <span class="mp-k">{{ t('modpack.project') }}</span>
          <span class="mp-v">{{ projectName }}</span>
        </div>
        <div class="mp-cell">
          <span class="mp-k">{{ t('modpack.mcVersion') }}</span>
          <span class="mp-v" :class="{ 'mp-bad': !mcVersion }">{{ mcVersion || t('modpack.notSet') }}</span>
        </div>
        <div class="mp-cell">
          <span class="mp-k">{{ t('modpack.loader') }}</span>
          <span class="mp-v" :class="{ 'mp-bad': !loaderText }">{{ loaderText || t('modpack.notSet') }}</span>
        </div>
        <div class="mp-cell">
          <span class="mp-k">{{ t('modpack.packableMods') }}</span>
          <span class="mp-v">{{ store.jars.length }}</span>
        </div>
        <div class="mp-cell">
          <span class="mp-k">{{ t('modpack.manifestCount') }}</span>
          <span class="mp-v">{{ store.manifestCount }}</span>
        </div>
        <div class="mp-cell">
          <span class="mp-k">{{ t('modpack.bundledCount') }}</span>
          <span class="mp-v">{{ store.bundledCount }}</span>
        </div>
        <div class="mp-cell">
          <span class="mp-k">{{ t('modpack.excludedCount') }}</span>
          <span class="mp-v">{{ store.exclusions.length }}</span>
        </div>
        <div class="mp-cell">
          <span class="mp-k">{{ t('modpack.sourceCount') }}</span>
          <span class="mp-v">{{ store.sources.length }}</span>
        </div>
        <div class="mp-cell">
          <span class="mp-k">{{ t('modpack.contentPackCount') }}</span>
          <span class="mp-v">{{ t('modpack.enabledOf', { enabled: store.enabledPackCount, total: store.packs.length }) }}</span>
        </div>
      </div>

      <div class="mp-actions">
        <el-button size="small" :loading="store.loading" @click="reload">{{ t('modpack.rescan') }}</el-button>
        <el-button
          type="primary"
          size="small"
          :loading="store.assembling"
          :disabled="!store.ready"
          @click="assemble"
        >
          {{ t('modpack.assembleExport') }}
        </el-button>
        <el-button v-if="store.lastZipPath" size="small" @click="openZip">{{ t('modpack.openOutput') }}</el-button>
        <el-button
          v-if="store.lastZipPath"
          type="success"
          size="small"
          @click="publishVisible = true"
        >
          {{ t('modpack.publish') }}
        </el-button>
      </div>

      <div v-if="store.error" class="mp-note mp-note-err">{{ store.error }}</div>
      <div v-if="store.lastZipPath" class="mp-note mp-note-ok">
        {{ t('modpack.exportedEntries', { n: store.lastEntryCount ?? 0 }) }}
        <div class="mp-paths">
          <div><span class="mp-path-label">{{ t('modpack.pathLabelModrinth') }}</span>{{ store.lastZipPath }}</div>
          <div v-if="store.lastCfZipPath"><span class="mp-path-label">{{ t('modpack.pathLabelCurseforge') }}</span>{{ store.lastCfZipPath }}</div>
        </div>
      </div>
      <div v-else-if="store.plan" class="mp-note">
        {{ t('modpack.planPrefix', { n: store.plan.zipEntries.length }) }}
        <code>dist/&lt;{{ t('modpack.projectNameSlot') }}&gt;-modpack.mrpack</code> {{ t('modpack.planJoin') }} <code>dist/&lt;{{ t('modpack.projectNameSlot') }}&gt;-modpack-cf.zip</code>{{ t('modpack.planSuffix') }}
      </div>
    </section>

    <!-- 组装计划（Mod 库拖放目标） -->
    <section
      v-loading="addingJar"
      class="mp-card mp-dropzone"
      :class="{ 'is-dragover': dragOver }"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div class="mp-card-title">
        {{ t('modpack.assemblePlan') }}
        <span class="mp-count">{{ t('modpack.modCount', { n: store.jars.length }) }}</span>
      </div>
      <el-table
        :data="store.jars"
        size="small"
        class="mp-table"
        :empty-text="store.loading ? t('modpack.scanning') : t('modpack.noJars')"
      >
        <el-table-column :label="t('modpack.colModFile')" min-width="220">
          <template #default="{ row }">
            <div class="mp-file">{{ (row as ModJarPlan).fileName }}</div>
            <div class="mp-sub">{{ formatSize((row as ModJarPlan).size) }}</div>
          </template>
        </el-table-column>
        <el-table-column :label="t('modpack.colDisposition')" width="132">
          <template #default="{ row }">
            <span class="mp-tag" :class="dispositionTone((row as ModJarPlan).disposition)">
              {{ dispositionText((row as ModJarPlan).disposition) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('modpack.colBundled')" width="64" align="center">
          <template #default="{ row }">
            <span :class="(row as ModJarPlan).bundledInOverrides ? 'mp-yes' : 'mp-no'">
              {{ (row as ModJarPlan).bundledInOverrides ? t('modpack.yes') : t('modpack.no') }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('modpack.colReason')" min-width="260">
          <template #default="{ row }">
            <span class="mp-reason">{{ (row as ModJarPlan).reason }}</span>
          </template>
        </el-table-column>
      </el-table>

      <!-- 拖放提示 -->
      <div class="mp-drop-hint">
        <el-icon :size="14"><FolderAdd /></el-icon>
        <span>{{ t('modpack.dropHint') }}</span>
      </div>
    </section>

    <!-- 依赖关系图（P3-2 只读：jar 内嵌元数据解析，随预览刷新） -->
    <DepGraphCard v-if="depGraph" :graph="depGraph" />

    <!-- 跨平台联动（P3-3：CF↔MR 映射 + 版本滞后/重复/缺失预警，手动触发） -->
    <CrossLinkCard />

    <!-- 内容包模块 -->
    <section class="mp-card">
      <div class="mp-card-title">
        {{ t('modpack.contentPacks') }}
        <span class="mp-count">
          {{ t('modpack.packsEnabled', { enabled: store.enabledPackCount, total: store.packs.length }) }}
        </span>
        <el-button size="small" class="mp-pack-new" @click="createVisible = true">{{ t('modpack.newPack') }}</el-button>
      </div>
      <el-table
        :data="store.packs"
        size="small"
        class="mp-table"
        :empty-text="t('modpack.noPacks')"
      >
        <el-table-column :label="t('modpack.colPack')" min-width="200">
          <template #default="{ row }">
            <div class="mp-file">
              {{ (row as ContentPackSummary).name }}
              <span v-if="!(row as ContentPackSummary).valid" class="mp-tag tone-err">{{ t('modpack.invalidManifest') }}</span>
            </div>
            <div class="mp-sub">
              {{ (row as ContentPackSummary).packId }}
              <template v-if="(row as ContentPackSummary).version"> · v{{ (row as ContentPackSummary).version }}</template>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="t('modpack.colCategory')" width="90">
          <template #default="{ row }">
            <span class="mp-tag" :class="categoryTone((row as ContentPackSummary).category)">
              {{ categoryText((row as ContentPackSummary).category) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('modpack.colEnabled')" width="70" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="(row as ContentPackSummary).enabled"
              :disabled="!(row as ContentPackSummary).valid"
              size="small"
              @change="(v: string | number | boolean) => onTogglePack(row as ContentPackSummary, v)"
            />
          </template>
        </el-table-column>
        <el-table-column :label="t('modpack.colDescription')" min-width="220">
          <template #default="{ row }">
            <span v-if="(row as ContentPackSummary).valid" class="mp-sub">
              {{ (row as ContentPackSummary).description || '—' }}
            </span>
            <span v-else class="mp-warn">{{ (row as ContentPackSummary).warnings[0] }}</span>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 排除项 -->
    <section v-if="store.exclusions.length > 0" class="mp-card">
      <div class="mp-card-title">
        {{ t('modpack.excluded') }}
        <span class="mp-count">{{ t('modpack.fileCount', { n: store.exclusions.length }) }}</span>
      </div>
      <ul class="mp-list">
        <li v-for="item in store.exclusions" :key="item.fileName">
          <span class="mp-file">{{ item.fileName }}</span>
          <span class="mp-reason">{{ item.reason }}</span>
        </li>
      </ul>
    </section>

    <!-- 告警 -->
    <section v-if="store.warnings.length > 0" class="mp-card">
      <div class="mp-card-title">
        {{ t('modpack.warningsTitle') }}
        <span class="mp-count">{{ t('modpack.warningCount', { n: store.warnings.length }) }}</span>
      </div>
      <ul class="mp-list">
        <li v-for="(text, i) in store.warnings" :key="i">
          <span class="mp-warn">{{ text }}</span>
        </li>
      </ul>
    </section>

    <!-- 来源记录 -->
    <section class="mp-card">
      <div class="mp-card-title">
        {{ t('modpack.sourcesTitle') }}
        <span class="mp-count">{{ t('modpack.sourceCountUnit', { n: store.sources.length }) }}</span>
      </div>
      <el-table
        :data="store.sources"
        size="small"
        class="mp-table"
        :empty-text="t('modpack.noSources')"
      >
        <el-table-column :label="t('modpack.colSource')" width="108">
          <template #default="{ row }">
            <span class="mp-tag" :class="platformTone((row as ModSourceEntry).platform)">
              {{ platformText((row as ModSourceEntry).platform) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="fileName" :label="t('modpack.colFile')" min-width="220" />
        <el-table-column :label="t('modpack.colName')" min-width="180">
          <template #default="{ row }">
            <span class="mp-sub">
              {{ (row as ModSourceEntry).name }} · {{ (row as ModSourceEntry).versionNumber }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('modpack.colCoord')" min-width="180">
          <template #default="{ row }">
            <span class="mp-mono">
              {{ (row as ModSourceEntry).modId || '—' }}/{{ (row as ModSourceEntry).versionId || '—' }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 启动测试 -->
    <section class="mp-card">
      <div class="mp-card-title">
        {{ t('modpack.launchTest') }}
        <span class="mp-count">{{ t('modpack.launchTestHint') }}</span>
      </div>

      <div class="mp-actions">
        <el-select
          :model-value="launcherStore.selectedLauncherId"
          size="small"
          class="mp-select"
          :placeholder="t('modpack.selectLauncher')"
          @change="onLauncherChange"
        >
          <el-option v-for="l in launcherStore.launchers" :key="l.id" :label="l.name" :value="l.id" />
        </el-select>
        <el-select
          :model-value="launcherStore.activeInstanceId ?? ''"
          size="small"
          class="mp-select"
          :placeholder="t('modpack.selectInstance')"
          @change="onInstanceChange"
        >
          <el-option v-for="i in launcherStore.instances" :key="i.id" :label="i.name" :value="i.id" />
        </el-select>
        <el-button size="small" :loading="launcherStore.detecting" @click="detectLaunchers">
          {{ t('modpack.redetect') }}
        </el-button>
        <el-button
          type="primary"
          size="small"
          :loading="store.testing"
          :disabled="!canTest"
          @click="startTest"
        >
          {{ t('modpack.importAndLaunch') }}
        </el-button>
      </div>

      <div v-if="launcherStore.error" class="mp-note mp-note-err">{{ launcherStore.error }}</div>
      <div v-else-if="launcherStore.launchers.length === 0" class="mp-note">
        {{ t('modpack.noLaunchers') }}
      </div>

      <template v-if="testResult">
        <div class="mp-actions">
          <span class="mp-tag" :class="verdictTone(testResult.verdict)">
            {{ verdictText(testResult.verdict) }}
          </span>
          <span class="mp-note">{{ testResult.summary }}</span>
        </div>
        <div v-if="testResult.error" class="mp-note mp-note-err">{{ testResult.error }}</div>

        <div class="mp-grid">
          <div class="mp-cell">
            <span class="mp-k">{{ t('modpack.plannedImports') }}</span>
            <span class="mp-v">{{ t('modpack.plannedImportsUnit', { n: testResult.planned?.length ?? 0 }) }}</span>
          </div>
          <div class="mp-cell">
            <span class="mp-k">{{ t('modpack.verifiedDirs') }}</span>
            <span class="mp-v mp-ok">{{ t('modpack.plannedImportsUnit', { n: testResult.verifiedInInstance?.length ?? 0 }) }}</span>
          </div>
          <div class="mp-cell">
            <span class="mp-k">{{ t('modpack.missingInInstance') }}</span>
            <span class="mp-v" :class="{ 'mp-bad': (testResult.missing?.length ?? 0) > 0 }">
              {{ t('modpack.plannedImportsUnit', { n: testResult.missing?.length ?? 0 }) }}
            </span>
          </div>
        </div>

        <ul v-if="testResult.missing?.length" class="mp-list">
          <li v-for="name in testResult.missing" :key="name">
            <span class="mp-file">{{ name }}</span>
            <span class="mp-reason">{{ t('modpack.missingReason') }}</span>
          </li>
        </ul>

        <!-- P1③ 场景断言链：逐项三态，真 join 证据可视化 -->
        <ul v-if="testResult.assertions?.length" class="mp-file-list">
          <li v-for="a in testResult.assertions" :key="a.id">
            <span class="mp-file">
              {{ a.state === 'verified' ? '✅' : a.state === 'failed' ? '❌' : '⚪' }} {{ a.label }}
            </span>
            <span class="mp-reason">{{ a.evidence }}</span>
          </li>
        </ul>

        <div v-if="testResult.logSignals?.length" class="mp-logs">
          <span class="mp-k">{{ t('modpack.logSignals') }}</span>
          <pre v-for="(line, i) in testResult.logSignals" :key="i">{{ line }}</pre>
        </div>
      </template>
    </section>

    <!-- 新建内容包对话框 -->
    <el-dialog v-model="createVisible" :title="t('modpack.newPackTitle')" width="460px">
      <div class="mp-form">
        <div class="mp-field">
          <span class="mp-k">{{ t('modpack.packId') }}</span>
          <el-input v-model="createForm.id" size="small" :placeholder="t('modpack.packIdPlaceholder')" />
        </div>
        <div class="mp-field">
          <span class="mp-k">{{ t('modpack.nameLabel') }}</span>
          <el-input v-model="createForm.name" size="small" :placeholder="t('modpack.namePlaceholder')" />
        </div>
        <div class="mp-field">
          <span class="mp-k">{{ t('modpack.categoryLabel') }}</span>
          <el-select v-model="createForm.category" size="small" class="mp-select">
            <el-option
              v-for="key in CATEGORY_KEYS"
              :key="key"
              :label="categoryText(key)"
              :value="key"
            />
          </el-select>
        </div>
        <div class="mp-field">
          <span class="mp-k">{{ t('modpack.descriptionOptional') }}</span>
          <el-input v-model="createForm.description" size="small" type="textarea" :rows="2" />
        </div>
        <div class="mp-sub">
          {{ t('modpack.createPackHint') }}
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="createVisible = false">{{ t('modpack.cancel') }}</el-button>
        <el-button type="primary" size="small" :loading="creating" @click="submitCreate">{{ t('modpack.create') }}</el-button>
      </template>
    </el-dialog>

    <PublishDialog
      v-model="publishVisible"
      :zip-path="store.lastZipPath ?? ''"
      :cf-zip-path="store.lastCfZipPath ?? ''"
      :mc-version="mcVersion"
      :loader="projectStore.currentProject?.loader ?? ''"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { FolderAdd } from '@element-plus/icons-vue'
import { useModpackStore } from '../../stores/modpack'
import { useProjectStore } from '../../stores/project'
import { useLauncherStore } from '../../stores/launcher'
import PublishDialog from './PublishDialog.vue'
import DepGraphCard from './DepGraphCard.vue'
import CrossLinkCard from './CrossLinkCard.vue'
import { addLibraryModToProject as addLibraryMod } from './addLibraryMod'
import { t } from '../../i18n'
import { MODLIB_MIME, type ModlibDragPayload } from '../../../../shared/modlibDnd'
import type {
  LaunchTestVerdict,
  ModJarDisposition,
  ModJarPlan,
  ModSourceEntry,
  ModSourcePlatform
} from '../../../../shared/types/modpack'
import type {
  ContentPackCategory,
  ContentPackSummary,
  CreatePackInput
} from '../../../../shared/types/contentPack'

const store = useModpackStore()
const projectStore = useProjectStore()
const launcherStore = useLauncherStore()

const projectName = computed(() => projectStore.currentProject?.name ?? '—')
const mcVersion = computed(() => projectStore.currentProject?.mcVersion ?? '')
/** 依赖关系图（随组装计划预览产出，无计划时不显示） */
const depGraph = computed(() => store.plan?.depGraph ?? null)

const LOADER_TEXT: Record<string, string> = {
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

const loaderText = computed(() => {
  const p = projectStore.currentProject
  if (!p?.loader) return ''
  const base = LOADER_TEXT[p.loader] ?? p.loader
  return p.loaderVersion ? `${base} ${p.loaderVersion}` : `${base}${t('modpack.loaderVersionUnknown')}`
})

function dispositionText(d: ModJarDisposition): string {
  return t(`modpack.disposition.${d}`)
}

function platformText(p: ModSourcePlatform): string {
  return t(`modpack.platform.${p}`)
}

function dispositionTone(d: ModJarDisposition): string {
  if (d === 'curseforge-files') return 'tone-cf'
  if (d === 'modrinth-files') return 'tone-mr'
  return 'tone-local'
}

function platformTone(p: ModSourcePlatform): string {
  return p === 'curseforge' ? 'tone-cf' : p === 'modrinth' ? 'tone-mr' : 'tone-local'
}

// ---------------- 内容包模块 ----------------

const CATEGORY_KEYS: readonly ContentPackCategory[] = ['tech', 'adventure', 'quest', 'library', 'other']

function categoryText(c: ContentPackCategory): string {
  return t(`modpack.category.${c}`)
}

function categoryTone(c: ContentPackCategory): string {
  if (c === 'tech') return 'tone-cf'
  if (c === 'quest') return 'tone-mr'
  if (c === 'adventure') return 'tone-warn'
  return 'tone-local'
}

async function onTogglePack(pack: ContentPackSummary, v: string | number | boolean): Promise<void> {
  const path = projectStore.currentProject?.path
  if (!path) return
  const err = await store.togglePack(path, pack.packId, v === true)
  if (err) ElMessage.error(err)
  else
    ElMessage.success(
      v === true
        ? t('modpack.packEnabledMsg', { name: pack.name })
        : t('modpack.packDisabledMsg', { name: pack.name })
    )
}

const createVisible = ref(false)
const publishVisible = ref(false)
const creating = ref(false)
const createForm = reactive<{ id: string; name: string; category: ContentPackCategory; description: string }>({
  id: '',
  name: '',
  category: 'tech',
  description: ''
})

async function submitCreate(): Promise<void> {
  const path = projectStore.currentProject?.path
  if (!path) return
  if (!createForm.id.trim()) {
    ElMessage.warning(t('modpack.packIdRequired'))
    return
  }
  creating.value = true
  try {
    const input: CreatePackInput = {
      id: createForm.id,
      name: createForm.name,
      category: createForm.category,
      description: createForm.description
    }
    const err = await store.createPack(path, input)
    if (err) {
      ElMessage.error(err)
    } else {
      ElMessage.success(
        t('modpack.packCreated', { name: createForm.name || createForm.id })
      )
      createVisible.value = false
    }
  } finally {
    creating.value = false
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

// ---------------- Mod 库拖放目标 ----------------

const dragOver = ref(false)
const addingJar = ref(false)
/** enter/leave 在子元素间冒泡会造成闪烁，用深度计数器收敛 */
let dragDepth = 0

function hasModlibPayload(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes(MODLIB_MIME)
}

function onDragEnter(e: DragEvent): void {
  if (!hasModlibPayload(e)) return
  dragDepth += 1
  dragOver.value = true
}

function onDragOver(e: DragEvent): void {
  if (!e.dataTransfer) return
  // 仅 Mod 库载荷允许放置，其余显示禁止光标
  e.preventDefault()
  e.dataTransfer.dropEffect = hasModlibPayload(e) ? 'copy' : 'none'
}

function onDragLeave(e: DragEvent): void {
  if (!hasModlibPayload(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragOver.value = false
}

async function onDrop(e: DragEvent): Promise<void> {
  dragDepth = 0
  dragOver.value = false
  const path = projectStore.currentProject?.path
  const raw = e.dataTransfer?.getData(MODLIB_MIME)
  if (!path || !raw) return
  e.preventDefault()

  let payload: ModlibDragPayload
  try {
    payload = JSON.parse(raw) as ModlibDragPayload
  } catch {
    return
  }

  await addLibraryModToProject(payload)
}

/**
 * 把 Mod 库里的 jar 加入当前整合包的 run/mods（拖放入口）。
 * 真机反馈 P2-9：拖放是组装的唯一入口，触屏/远程桌面/键盘用户无替代路径。
 * 与 ModLibraryPanel 卡片按钮共用 addLibraryMod（项目类型校验/覆盖确认/刷新/异常兜底）。
 */
async function addLibraryModToProject(payload: ModlibDragPayload): Promise<void> {
  addingJar.value = true
  try {
    await addLibraryMod(
      {
        projectPath: projectStore.currentProject?.path,
        projectType: projectStore.currentProject?.type,
        store
      },
      payload
    )
  } finally {
    addingJar.value = false
  }
}

function reload(): void {
  const path = projectStore.currentProject?.path
  if (!path) return
  store.lastZipPath = null
  store.lastCfZipPath = null
  store.lastEntryCount = null
  void store.refresh(path)
}

async function assemble(): Promise<void> {
  const path = projectStore.currentProject?.path
  if (!path) return
  const result = await store.assemble(path)
  if (result.ok && result.zipPath) {
    ElMessage.success(t('modpack.assembleSuccess', { n: result.entryCount ?? 0 }))
  } else {
    ElMessage.error(result.error ?? t('modpack.assembleFailed'))
  }
}

function openZip(): void {
  if (store.lastZipPath) void window.api.shell.showItemInFolder(store.lastZipPath)
}

// ---------------- 启动测试 ----------------

const testResult = computed(() => store.launchResult)

/** 判定标签文案：六态一一对应，避免把「已启动」误读为「模组已加载」 */
function verdictText(v: LaunchTestVerdict): string {
  return t(`modpack.verdict.${v}`)
}

function verdictTone(v: LaunchTestVerdict): string {
  if (v === 'world-joined' || v === 'mods-visible') return 'tone-mr'
  if (v === 'launched-only' || v === 'timeout') return 'tone-warn'
  return 'tone-err'
}

const canTest = computed(
  () =>
    Boolean(projectStore.currentProject?.path) &&
    Boolean(launcherStore.selectedLauncherId) &&
    Boolean(launcherStore.activeInstanceId) &&
    !store.testing
)

function onLauncherChange(v: string | number | boolean | undefined): void {
  if (typeof v === 'string') void launcherStore.selectLauncher(v)
}

function onInstanceChange(v: string | number | boolean | undefined): void {
  if (typeof v === 'string') void launcherStore.setActive(v)
}

function detectLaunchers(): void {
  void launcherStore.detect()
}

async function startTest(): Promise<void> {
  const path = projectStore.currentProject?.path
  const instanceId = launcherStore.activeInstanceId
  if (!path || !launcherStore.selectedLauncherId || !instanceId) return
  const result = await store.launchTest({
    projectPath: path,
    launcherId: launcherStore.selectedLauncherId,
    instanceId
  })
  if (result.ok) ElMessage.success(t('modpack.launchTestPass'))
  else ElMessage.warning(result.error ?? t('modpack.launchTestFail'))
}

onMounted(() => {
  if (launcherStore.launchers.length === 0) void launcherStore.detect()
})

// 项目切换（含首次挂载）即重新扫描；无项目时清空
watch(
  () => projectStore.currentProject?.path,
  (path) => {
    if (path) void store.refresh(path)
    else store.reset()
  },
  { immediate: true }
)
</script>

<style scoped>
.mp-view {
  padding: 20px 24px 40px;
  color: var(--ky-text);
  display: flex;
  flex-direction: column;
  gap: var(--ky-gap-card);
}
.mp-header h2 {
  margin: 0 0 4px;
  font-size: 20px;
}
.mp-header p {
  margin: 0;
  color: var(--ky-text-sub);
  font-size: 13px;
  line-height: 1.7;
}
.mp-header code {
  font-family: var(--ky-font-mono);
  color: var(--ky-blue);
}
.mp-card {
  background: var(--ky-bg-panel);
  border: 1px solid var(--ky-border);
  border-radius: var(--ky-radius-panel);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mp-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
}
.mp-count {
  font-size: 11px;
  font-weight: 400;
  color: var(--ky-text-dim);
}

/* 拖放目标 */
.mp-dropzone {
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.mp-dropzone.is-dragover {
  border-color: var(--ky-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ky-accent) 35%, transparent);
}

.mp-drop-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 9px 10px;
  border: 1px dashed var(--ky-border);
  border-radius: 8px;
  color: var(--ky-text-dim);
  font-size: 11.5px;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.mp-dropzone.is-dragover .mp-drop-hint {
  border-color: var(--ky-accent);
  color: var(--ky-accent);
}

.mp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px 16px;
}
.mp-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mp-k {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.mp-v {
  font-size: 13px;
  color: var(--ky-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mp-bad {
  color: var(--ky-red);
}
.mp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.mp-note {
  font-size: 12px;
  color: var(--ky-text-sub);
  line-height: 1.6;
  word-break: break-all;
}
.mp-note code {
  font-family: var(--ky-font-mono);
  color: var(--ky-blue);
}
.mp-note-ok {
  color: var(--ky-accent);
}
.mp-note-err {
  color: var(--ky-red);
}
.mp-paths {
  margin-top: 4px;
  font-size: 11.5px;
  word-break: break-all;
}
.mp-path-label {
  font-weight: 600;
  color: var(--ky-text-sub);
}
.mp-table {
  width: 100%;
}
.mp-file {
  font-size: 12.5px;
  color: var(--ky-text);
  word-break: break-all;
}
.mp-sub {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.mp-mono {
  font-family: var(--ky-font-mono);
  font-size: 11.5px;
  color: var(--ky-text-sub);
}
.mp-reason {
  font-size: 12px;
  color: var(--ky-text-sub);
  line-height: 1.6;
}
.mp-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  white-space: nowrap;
}
.tone-cf {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.14);
}
.tone-mr {
  color: var(--ky-accent);
  background: rgba(var(--ky-accent-rgb), 0.14);
}
.tone-local {
  color: var(--ky-blue);
  background: rgba(56, 189, 248, 0.14);
}
.mp-yes {
  color: var(--ky-yellow);
  font-size: 12px;
}
.mp-no {
  color: var(--ky-text-dim);
  font-size: 12px;
}
.mp-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mp-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mp-warn {
  font-size: 12px;
  color: var(--ky-yellow);
  line-height: 1.6;
}
.mp-select {
  width: 200px;
}
.mp-ok {
  color: var(--ky-accent);
}
.tone-warn {
  color: var(--ky-yellow);
  background: rgba(249, 226, 175, 0.14);
}
.tone-err {
  color: var(--ky-red);
  background: rgba(243, 139, 168, 0.14);
}
.mp-logs {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.mp-logs pre {
  margin: 0;
  font-family: var(--ky-font-mono);
  font-size: 11.5px;
  color: var(--ky-text-sub);
  white-space: pre-wrap;
  word-break: break-all;
}
.mp-pack-new {
  margin-left: auto;
}
.mp-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mp-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>