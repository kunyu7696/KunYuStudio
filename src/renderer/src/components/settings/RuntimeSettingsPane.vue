<template>
  <div class="pane">
    <header class="pane-head">
      <h2>{{ t('settings.runtime.title') }}</h2>
      <p>{{ t('settings.runtime.desc') }}</p>
    </header>

    <el-alert
      v-if="firstRun"
      class="rt-firstrun"
      type="info"
      :closable="false"
      show-icon
      :title="t('settings.runtime.firstRunTitle')"
    >
      <template #default>
        <p>{{ t('settings.runtime.firstRunBody') }}</p>
      </template>
    </el-alert>

    <SettingsSection :title="t('settings.runtime.prepare')">
      <SettingsRow
        :label="t('settings.runtime.targetVersion')"
        :desc="t('settings.runtime.targetVersionDesc')"
        data-setting-id="runtime-target-version"
      >
        <el-select
          v-model="mcVersion"
          size="small"
          class="rt-version-select"
          filterable
          allow-create
          default-first-option
          :loading="versionsLoading"
          :placeholder="t('settings.runtime.versionPh')"
          @change="onVersionChange"
        >
          <el-option
            v-for="v in releaseVersions"
            :key="v.id"
            :label="v.id"
            :value="v.id"
          />
        </el-select>
      </SettingsRow>
      <SettingsRow
        :label="t('settings.runtime.jdkLabel')"
        :desc="t('settings.runtime.jdkDesc')"
        data-setting-id="runtime-jdk-status"
      >
        <div class="rt-jdk">
          <el-select
            v-if="jdkOptions.length > 0"
            :model-value="globalJdkValue"
            size="small"
            class="rt-jdk-select"
            @change="onJdkSelect"
          >
            <el-option :label="autoOptionLabel" :value="JDK_AUTO" />
            <el-option
              v-for="c in jdkOptions"
              :key="c.home"
              :label="`JDK ${c.version}（${sourceLabel(c.source)}）`"
              :value="c.home"
            />
          </el-select>
          <el-tag v-else size="small" type="warning" effect="plain">{{ t('settings.runtime.jdkNone') }}</el-tag>
          <span v-if="detect" class="rt-need">{{ t('settings.runtime.jdkNeed', { major: detect.requiredMajor }) }}</span>
        </div>
      </SettingsRow>
      <SettingsRow
        :label="t('settings.runtime.jdkMirror')"
        :desc="t('settings.runtime.jdkMirrorDesc')"
        data-setting-id="java-jdk-mirror"
      >
        <div class="jd-mirror">
          <el-input
            :model-value="settings.java.jdkMirror"
            size="small"
            class="jd-mirror-input"
            placeholder="https://mirrors.tuna.tsinghua.edu.cn/Adoptium"
            @change="onMirror"
          />
          <el-button size="small" text type="primary" @click="openAdoptium">{{ t('settings.runtime.jdkMirrorOfficial') }}</el-button>
        </div>
      </SettingsRow>
      <SettingsRow
        :label="t('settings.runtime.prepareBtn')"
        :desc="t('settings.runtime.prepareDesc')"
        data-setting-id="runtime-prepare"
      >
        <div class="rt-prepare">
          <el-button type="primary" size="small" :loading="preparing" @click="prepare">
            {{ t('settings.runtime.prepareBtn') }}
          </el-button>
          <el-progress
            v-if="preparing || jdkPct > 0"
            :percentage="jdkPct"
            :stroke-width="12"
            :format="() => `JDK ${jdkPct}%`"
            class="rt-progress"
          />
          <el-progress
            v-if="preparing || mcPct > 0"
            :percentage="mcPct"
            :stroke-width="12"
            :format="() => `MC ${mcPct}%`"
            class="rt-progress"
          />
        </div>
        <p v-if="status" class="rt-status">{{ status }}</p>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection :title="t('settings.runtime.javaSection')">
      <p class="rt-java-hint">{{ t('settings.runtime.javaHint') }}</p>
      <div class="jd-current" v-loading="refreshing">
        <template v-if="detect">
          <!-- 全局 JDK 与目标不兼容被自动跳过时，如实说明回退原因（选择策略见 jdkService） -->
          <el-alert
            v-if="globalSkipped && globalCandidate"
            class="jd-skip-alert"
            type="warning"
            :closable="false"
            show-icon
            :title="globalSkippedTitle"
          />
          <div v-if="detect.jdk" class="jd-current-card" :class="compatClass(currentCompat)">
            <div class="jd-current-main">
              <span class="jd-version">JDK {{ detect.jdk.version }}</span>
              <el-tag :type="tagType(currentCompat)" size="small" effect="dark">
                {{ compatLabel(currentCompat) }}
              </el-tag>
              <el-tag v-if="usingGlobal" size="small" type="primary" effect="plain">{{ t('settings.runtime.globalActive') }}</el-tag>
            </div>
            <div class="jd-current-meta">
              <span>{{ detect.jdk.home }}</span>
              <span class="jd-src">{{ t('settings.runtime.sourcePrefix', { source: sourceLabel(detect.jdk.source) }) }}</span>
            </div>
            <p class="jd-message">{{ detect.message }}</p>
          </div>
          <el-alert v-else type="warning" :closable="false" show-icon :title="detect.message">
            <template #default>
              <p>{{ t('settings.runtime.noJdkHint', { major: req.requiredMajor }) }}</p>
            </template>
          </el-alert>
        </template>
      </div>
    </SettingsSection>

    <SettingsSection :title="t('settings.runtime.gradleMemory')">
      <SettingsRow
        :label="t('settings.runtime.maxHeap')"
        :desc="t('settings.runtime.maxHeapDesc')"
        data-setting-id="java-gradle-memory"
      >
        <div class="jd-memory">
          <el-slider
            v-model="settings.java.gradleMemoryMb"
            :min="1024"
            :max="4096"
            :step="512"
            @change="onMemory"
          />
          <span class="jd-memory-value">{{ settings.java.gradleMemoryMb }} MB</span>
        </div>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection :title="t('settings.runtime.instances')">
      <div class="rt-list" data-setting-id="runtime-instances">
        <div class="rt-actions">
          <el-button plain size="small" :disabled="!settings.java.globalJdkHome" @click="clearGlobal">
            {{ t('settings.runtime.clearGlobal') }}
          </el-button>
          <el-button size="small" :loading="refreshing" @click="refresh">{{ t('settings.runtime.refresh') }}</el-button>
        </div>
        <el-table v-if="instances.length > 0" :data="instances" size="small" class="rt-table">
          <el-table-column :label="t('settings.runtime.colName')" min-width="140">
            <template #default="{ row }">{{ (row as McInstance).name }}</template>
          </el-table-column>
          <el-table-column :label="t('settings.runtime.colVersion')" width="110">
            <template #default="{ row }">{{ (row as McInstance).mcVersion }}</template>
          </el-table-column>
          <el-table-column :label="t('settings.runtime.colLastUsed')" width="170">
            <template #default="{ row }">{{ fmtTime((row as McInstance).lastUsedAt) }}</template>
          </el-table-column>
          <el-table-column :label="t('settings.runtime.colActions')" width="150" align="right">
            <template #default="{ row }">
              <el-button size="small" text type="primary" @click="launch(row as McInstance)">{{ t('settings.runtime.launch') }}</el-button>
              <el-button size="small" text type="danger" @click="remove(row as McInstance)">{{ t('settings.runtime.delete') }}</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-else-if="!refreshing" class="rt-empty">
          <p>{{ t('settings.runtime.emptyTitle') }}</p>
          <p class="rt-empty-hint">{{ t('settings.runtime.emptyHint') }}</p>
        </div>
      </div>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSettingsStore } from '../../stores/settings'
import { useProjectStore } from '../../stores/project'
import { IpcChannels } from '../../../../shared/types/ipc'
import {
  judgeJdkCompatibility,
  LEGACY_JDK_REQUIREMENTS,
  type JdkCompatibility,
  type JdkDetectResult,
  type JdkInfo,
  type JdkProvisionProgress,
  type JdkRequirements
} from '../../../../shared/types/build'
import type {
  McInstance,
  McProvisionProgress,
  McVersionSummary
} from '../../../../shared/types/mcRuntime'
import SettingsSection from './SettingsSection.vue'
import SettingsRow from './SettingsRow.vue'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const settings = useSettingsStore()
const projectStore = useProjectStore()

const detect = ref<JdkDetectResult | null>(null)
const instances = ref<McInstance[]>([])
const refreshing = ref(false)
const preparing = ref(false)
const jdkPct = ref(0)
const mcPct = ref(0)
const status = ref('')
const mcVersion = ref(defaultVersion())
const versions = ref<McVersionSummary[]>([])
const versionsLoading = ref(false)
let offJdk: (() => void) | null = null
let offMc: (() => void) | null = null

/** 首次使用（无 JDK 且无已下载实例）时给出引导横幅 */
const firstRun = computed(() => !detect.value?.jdk && instances.value.length === 0 && !refreshing.value)

/** 正式版清单（按发布时间倒序，最新在前）；支持 filterable 搜索与 allow-create 手输 */
const releaseVersions = computed(() =>
  versions.value
    .filter((v) => v.type === 'release')
    .sort((a, b) => b.releaseTime.localeCompare(a.releaseTime))
)

/** 版本要求以主进程按 (loader, mcVersion) 推导的结果为准；
 *  检测未返回前的展示兜底用 1.20.1 时代默认 */
const req = computed<JdkRequirements>(() => detect.value?.requirements ?? LEGACY_JDK_REQUIREMENTS)

const currentCompat = computed(() =>
  detect.value?.jdk ? compatOf(detect.value.jdk) : ('compatible' as JdkCompatibility)
)
/** 全局设置是否正被检测选中（且来源就是 global） */
const usingGlobal = computed(() => detect.value?.jdk?.source === 'global')

/** 全局 JDK 候选（主进程已按 settings.java.globalJdkHome 探测并标记 source=global） */
const globalCandidate = computed<JdkInfo | null>(
  () => detect.value?.candidates.find((c) => c.source === 'global') ?? null
)

/** 已设置全局 JDK 但本次检测未选中它（被兼容性策略跳过） */
const globalSkipped = computed(
  () => !!settings.java.globalJdkHome && !!detect.value?.jdk && detect.value.jdk.source !== 'global'
)

/** JDK 下拉的「自动检测」哨兵值（选中即清除全局设置，恢复主进程自动挑选） */
const JDK_AUTO = '__auto__'

/** 检测到的候选 JDK（按 home 去重，供下拉直接选择全局 JDK） */
const jdkOptions = computed<JdkInfo[]>(() => {
  const seen = new Set<string>()
  return (detect.value?.candidates ?? []).filter((c) => {
    const k = c.home.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
})

/** 自动检测选项文案：生效来源非全局时附带当前版本提示 */
const autoOptionLabel = computed(() => {
  const j = detect.value?.jdk
  return j && j.source !== 'global'
    ? t('settings.runtime.jdkAutoCurrent', { version: j.version })
    : t('settings.runtime.jdkAuto')
})

/** 全局 JDK 与目标不兼容被自动跳过时的告警标题 */
const globalSkippedTitle = computed(() => {
  const g = globalCandidate.value
  if (!g) return ''
  return t('settings.runtime.globalSkipped', {
    version: g.version,
    compat: compatLabel(compatOf(g)),
    major: req.value.requiredMajor
  })
})

/** 下拉当前值：跟随持久化的全局 JDK 设置，未设置则为自动检测 */
const globalJdkValue = computed(() => settings.java.globalJdkHome || JDK_AUTO)

function defaultVersion(): string {
  return projectStore.currentProject?.mcVersion ?? '1.21.1'
}

function sourceLabel(s: JdkInfo['source']): string {
  switch (s) {
    case 'configured':
      return t('settings.runtime.srcConfigured')
    case 'global':
      return t('settings.runtime.srcGlobal')
    case 'java-home':
      return 'JAVA_HOME'
    case 'scanned':
      return t('settings.runtime.srcScanned')
    case 'path':
      return t('settings.runtime.srcPath')
    case 'managed':
      return t('settings.runtime.srcManaged')
  }
}

function compatOf(jdk: JdkInfo): JdkCompatibility {
  return judgeJdkCompatibility(jdk.major, req.value)
}
function compatClass(c: JdkCompatibility): string {
  return `jd-${c}`
}
function compatLabel(c: JdkCompatibility): string {
  switch (c) {
    case 'recommended': return t('settings.runtime.compatRecommended')
    case 'compatible': return t('settings.runtime.compatCompatible')
    case 'too-low': return t('settings.runtime.compatTooLow')
    case 'too-high': return t('settings.runtime.compatTooHigh')
  }
}
function tagType(c: JdkCompatibility): 'success' | 'warning' | 'danger' | 'info' {
  switch (c) {
    case 'recommended': return 'success'
    case 'compatible': return 'info'
    case 'too-low': return 'warning'
    case 'too-high': return 'danger'
  }
}
function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** 项目切换/就绪时同步目标版本并联动重测（项目信息可能晚于本页挂载到达，
 *  只改下拉不重测会让 Java 环境卡片停留在旧版本需求上） */
watch(
  () => projectStore.currentProject?.mcVersion,
  (v) => {
    if (v && v !== mcVersion.value) {
      mcVersion.value = v
      void refresh()
    }
  }
)

async function refresh(): Promise<void> {
  refreshing.value = true
  try {
    const cp = projectStore.currentProject
    // 始终携带目标 MC 版本：无项目时主进程按纯 MC 版本推导（26.3 → JDK 25），
    // 不落 1.20.1 时代默认
    const context = { loader: cp?.loader ?? null, mcVersion: mcVersion.value }
    const [d, list] = await Promise.all([
      window.api.jdk.detect(null, context),
      window.api.mc.listInstances()
    ])
    detect.value = d
    instances.value = list
  } finally {
    refreshing.value = false
  }
}

/** 拉取版本清单供下拉选择；失败时静默（下拉为空仍可手动输入版本号） */
async function loadVersions(): Promise<void> {
  versionsLoading.value = true
  try {
    versions.value = await window.api.mc.listVersions()
  } catch {
    versions.value = []
  } finally {
    versionsLoading.value = false
  }
}

/** 目标版本变化 → JDK 需求联动重测 */
function onVersionChange(): void {
  void refresh()
}

onMounted(() => {
  void refresh()
  void loadVersions()
})

onUnmounted(() => {
  offJdk?.()
  offMc?.()
  offJdk = null
  offMc = null
})

function cleanup(): void {
  offJdk?.()
  offMc?.()
  offJdk = null
  offMc = null
}

/** 一键准备运行环境：检测/安装 JDK → 下载 MC 运行时资产 */
async function prepare(): Promise<void> {
  if (preparing.value) return
  const target = mcVersion.value.trim()
  if (!target) {
    ElMessage.error(t('settings.runtime.errNoVersion'))
    return
  }
  preparing.value = true
  jdkPct.value = 0
  mcPct.value = 0
  status.value = t('settings.runtime.statusDetectingJdk')
  offJdk = window.api.on(IpcChannels.JDK_PROVISION_EVENT, (...args: unknown[]) => {
    const ev = args[0] as JdkProvisionProgress | undefined
    if (!ev) return
    if (typeof ev.progress === 'number') jdkPct.value = ev.progress
    if (ev.message) status.value = ev.message
  })
  offMc = window.api.on(IpcChannels.MC_PROVISION_EVENT, (...args: unknown[]) => {
    const ev = args[0] as McProvisionProgress | undefined
    if (!ev) return
    if (typeof ev.progress === 'number') mcPct.value = ev.progress
    if (ev.message) status.value = ev.message
  })
  try {
    const cp = projectStore.currentProject
    const d = await window.api.jdk.detect(null, {
      loader: cp?.loader ?? null,
      mcVersion: target
    })
    if (!d.compatible || !d.jdk) {
      status.value = t('settings.runtime.statusInstallingJdk', { major: d.requiredMajor })
      const res = await window.api.jdk.provision({ major: d.requiredMajor })
      if (!res.ok) {
        ElMessage.error(res.errorMessage)
        status.value = res.errorMessage
        return
      }
      jdkPct.value = 100
    } else {
      jdkPct.value = 100
    }

    status.value = t('settings.runtime.statusProvisioningMc', { version: target })
    const mirror = settings.network?.mcMirror?.trim()
    const mc = await window.api.mc.provision({
      mcVersion: target,
      name: target,
      mirror: mirror ? mirror : undefined
    })
    if (!mc.ok) {
      ElMessage.error(mc.errorMessage)
      status.value = mc.errorMessage
      return
    }
    mcPct.value = 100
    status.value = t('settings.runtime.statusReady', { version: target })
    ElMessage.success(t('settings.runtime.statusReady', { version: target }))
    await refresh()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ElMessage.error(msg)
    status.value = msg
  } finally {
    cleanup()
    preparing.value = false
  }
}

async function launch(inst: McInstance): Promise<void> {
  const res = await window.api.mc.launchInstance({ instanceId: inst.id })
  if (res.ok) {
    ElMessage.success(t('settings.runtime.launched', { name: inst.name, version: res.mcVersion }))
    await refresh()
  } else {
    ElMessage.error(res.errorMessage)
  }
}

async function remove(inst: McInstance): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('settings.runtime.deleteConfirm', { name: inst.name }),
      t('settings.runtime.deleteTitle'),
      { type: 'warning', confirmButtonText: t('settings.runtime.delete'), cancelButtonText: t('common.cancel') }
    )
  } catch {
    return
  }
  const ok = await window.api.mc.deleteInstance(inst.id)
  if (ok) {
    ElMessage.success(t('settings.runtime.deleted', { name: inst.name }))
    await refresh()
  } else {
    ElMessage.error(t('settings.runtime.deleteFailed'))
  }
}

function onMirror(v: string): void {
  void settings.patchSection('java', { jdkMirror: v.trim() })
}

/** 下拉选择全局 JDK：选「自动检测」即清除全局设置 */
async function onJdkSelect(v: string): Promise<void> {
  if (v === JDK_AUTO) {
    await clearGlobal()
    return
  }
  await settings.patchSection('java', { globalJdkHome: v })
  ElMessage.success(t('settings.runtime.globalUpdated'))
  await refresh()
}

async function clearGlobal(): Promise<void> {
  await settings.patchSection('java', { globalJdkHome: null })
  ElMessage.success(t('settings.runtime.globalCleared'))
  await refresh()
}

/** JDK 镜像行：跳转 Adoptium 官方下载站（系统默认浏览器打开） */
function openAdoptium(): void {
  void window.api.shell.openExternal('https://adoptium.net/temurin/releases/')
}

function onMemory(): void {
  void settings.patchSection('java', { gradleMemoryMb: settings.java.gradleMemoryMb })
}
</script>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  max-width: 760px;
}
.pane-head h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.pane-head p {
  margin: 4px 0 16px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ky-text-dim);
}
.rt-firstrun {
  margin-bottom: 14px;
}
.rt-version-select {
  width: 200px;
}
.rt-jdk-select {
  width: 200px;
}
.jd-mirror {
  display: flex;
  align-items: center;
  gap: 6px;
}
.jd-mirror-input {
  width: 240px;
}
.jd-skip-alert {
  margin-bottom: 10px;
}
.rt-jdk {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.rt-need {
  font-size: 12px;
  color: var(--ky-text-dim);
}
.rt-prepare {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.rt-progress {
  width: 150px;
}
.rt-status {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--ky-text-dim);
}
.rt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 0;
}
.rt-table {
  width: 100%;
}
.rt-empty {
  border: 1px dashed var(--ky-border);
  border-radius: var(--ky-radius-control);
  padding: 22px;
  text-align: center;
  color: var(--ky-text-sub);
  font-size: 13px;
}
.rt-empty p {
  margin: 0 0 4px;
}
.rt-empty-hint {
  font-size: 12px;
  color: var(--ky-text-dim);
}
.rt-java-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--ky-text-dim);
}
.jd-current {
  min-height: 84px;
}
.jd-current-card {
  border-left: 3px solid var(--ky-text-dim);
  padding: 8px 0 8px 12px;
}
.jd-current-card.jd-recommended {
  border-left-color: var(--ky-accent);
}
.jd-current-card.jd-too-low,
.jd-current-card.jd-too-high {
  border-left-color: var(--el-color-danger);
}
.jd-current-main {
  display: flex;
  align-items: center;
  gap: 10px;
}
.jd-version {
  font-size: 15px;
  font-weight: 600;
  color: var(--ky-text);
}
.jd-current-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--ky-text-sub);
  font-family: var(--ky-font-mono);
}
.jd-src {
  color: var(--ky-text-dim);
  font-family: inherit;
}
.jd-message {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--ky-text-dim);
}
.jd-memory {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 340px;
}
.jd-memory .el-slider {
  flex: 1;
}
.jd-memory-value {
  width: 72px;
  text-align: right;
  font-size: 12.5px;
  color: var(--ky-text-sub);
  font-family: var(--ky-font-mono);
}
</style>
