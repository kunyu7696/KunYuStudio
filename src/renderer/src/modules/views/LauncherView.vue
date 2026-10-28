<template>
  <div class="launcher-view">
    <!-- 顶部工具栏：刷新 / 添加 -->
    <div class="lv-toolbar">
      <div class="lv-title">
        <h2>{{ t('launcher.title') }}</h2>
        <span class="lv-subtitle">{{ t('launcher.subtitle') }}</span>
      </div>
      <div class="lv-actions">
        <el-button
          :icon="MagicStick"
          type="success"
          plain
          :loading="store.integrating"
          @click="openAutoDialog"
        >
          {{ t('launcher.autoIntegrate') }}
        </el-button>
        <el-button :icon="Refresh" :loading="store.detecting" @click="store.detect()">
          {{ t('launcher.redetect') }}
        </el-button>
        <el-button :icon="Plus" type="primary" @click="addDialogVisible = true">{{ t('launcher.addLauncher') }}</el-button>
      </div>
    </div>

    <el-alert
      v-if="store.error"
      type="warning"
      :title="store.error"
      :closable="false"
      show-icon
      class="lv-alert"
    />

    <!-- 三栏：左启动器 / 中实例+导入 / 右闭环+历史 -->
    <el-row :gutter="12" class="lv-body">
      <!-- 左：启动器列表 -->
      <el-col :span="7">
        <div class="lv-panel" v-loading="store.detecting">
          <div class="lv-panel-title">
            <el-icon><Monitor /></el-icon>
            <span>{{ t('launcher.detectedTitle') }}</span>
            <el-tag size="small" type="info">{{ store.launchers.length }}</el-tag>
          </div>
          <div class="lv-launcher-list">
            <div
              v-for="l in store.launchers"
              :key="l.id"
              class="lv-launcher-item"
              :class="{ active: l.id === store.selectedLauncherId }"
              @click="store.selectLauncher(l.id)"
            >
              <div class="lv-launcher-head">
                <span class="lv-launcher-name">{{ l.name }}</span>
                <el-tag v-if="l.autoDetected" size="small" type="success">{{ t('launcher.tagAuto') }}</el-tag>
                <el-tag v-else size="small" type="warning">{{ t('launcher.tagManual') }}</el-tag>
              </div>
              <div class="lv-launcher-kind">{{ kindLabel(l.kind) }}</div>
              <div class="lv-launcher-path" :title="l.exePath">{{ l.exePath }}</div>
            </div>
            <el-empty v-if="!store.detecting && store.launchers.length === 0" :description="t('launcher.emptyLaunchers')" />
          </div>
        </div>
      </el-col>

      <!-- 中：实例列表 + 导入区 -->
      <el-col :span="10">
        <div class="lv-panel">
          <div class="lv-panel-title">
            <el-icon><Cpu /></el-icon>
            <span>{{ t('launcher.instancesTitle') }}</span>
            <el-tag v-if="store.selectedLauncher" size="small" type="info">
              {{ store.selectedLauncher.name }}
            </el-tag>
          </div>

          <!-- 实例列表 -->
          <div class="lv-instance-list" v-loading="store.detecting">
            <div
              v-for="i in store.instances"
              :key="i.id"
              class="lv-instance-item"
              :class="{ active: i.id === store.activeInstanceId }"
            >
              <div class="lv-instance-main" @click="store.setActive(i.id)">
                <div class="lv-instance-name">{{ i.name }}</div>
                <div class="lv-instance-meta">
                  <el-tag size="small">MC {{ i.mcVersion }}</el-tag>
                  <el-tag v-if="i.loader" size="small" type="success">{{ i.loader }}</el-tag>
                  <el-tag v-if="i.loaderVersion" size="small" type="info">{{ i.loaderVersion }}</el-tag>
                </div>
                <div class="lv-instance-path" :title="i.gamePath">{{ i.gamePath }}</div>
              </div>
              <div class="lv-instance-actions">
                <el-tooltip :content="t('launcher.importTooltip')" placement="top">
                  <el-button
                    size="small"
                    :icon="Download"
                    :disabled="!artifactPath || store.importing"
                    :loading="store.importing && importingFor === i.id"
                    @click="doImport(i.id)"
                  />
                </el-tooltip>
                <el-tooltip :content="t('launcher.activateTooltip')" placement="top">
                  <el-button
                    size="small"
                    :icon="i.id === store.activeInstanceId ? StarFilled : Star"
                    :type="i.id === store.activeInstanceId ? 'primary' : 'default'"
                    @click="store.setActive(i.id)"
                  />
                </el-tooltip>
              </div>
            </div>
            <el-empty
              v-if="store.selectedLauncher && store.instances.length === 0"
              :description="t('launcher.emptyInstances')"
            />
            <el-empty
              v-if="!store.selectedLauncher"
              :description="t('launcher.emptyNoLauncher')"
            />
          </div>

          <!-- 导入区 -->
          <el-divider content-position="left">{{ t('launcher.importSection') }}</el-divider>
          <div class="lv-import">
            <el-input
              v-model="artifactPath"
              :placeholder="t('launcher.artifactPlaceholder')"
              clearable
            >
              <template #prefix>
                <el-icon><Document /></el-icon>
              </template>
            </el-input>
            <div class="lv-import-row">
              <el-checkbox v-model="overwrite">{{ t('launcher.overwrite') }}</el-checkbox>
              <el-button
                :icon="Download"
                type="primary"
                :disabled="!artifactPath || !store.activeInstanceId || store.importing"
                :loading="store.importing"
                @click="store.activeInstanceId && doImport(store.activeInstanceId)"
              >
                {{ t('launcher.importToActive') }}
              </el-button>
            </div>
          </div>
          <div class="lv-hint">
            {{ t('launcher.modsHint') }}
          </div>
        </div>
      </el-col>

      <!-- 右：生态闭环 + 启动 + 历史 -->
      <el-col :span="7">
        <div class="lv-panel">
          <div class="lv-panel-title">
            <el-icon><Connection /></el-icon>
            <span>{{ t('launcher.loopTitle') }}</span>
          </div>

          <!-- 闭环流程 -->
          <div class="lv-loop">
            <div
              v-for="(s, idx) in loopSteps"
              :key="s.key"
              class="lv-loop-step"
              :class="s.tone"
            >
              <div class="lv-loop-icon">
                <el-icon><component :is="s.icon" /></el-icon>
              </div>
              <div class="lv-loop-text">
                <div class="lv-loop-name">{{ s.name }}</div>
                <div class="lv-loop-desc">{{ s.desc }}</div>
              </div>
              <el-icon v-if="idx < loopSteps.length - 1" class="lv-loop-arrow"><ArrowDown /></el-icon>
            </div>
          </div>

          <!-- 启动按钮 -->
          <el-button
            class="lv-launch-btn"
            type="success"
            size="large"
            :icon="VideoPlay"
            :disabled="!store.activeInstanceId || store.launching"
            :loading="store.launching"
            @click="store.launch()"
          >
            {{ store.activeInstance ? t('launcher.launchInstance', { name: store.activeInstance.name }) : t('launcher.launchNeedActive') }}
          </el-button>

          <!-- 自动集成候选（按匹配度降序，点击可切换激活） -->
          <template v-if="store.candidates.length">
            <el-divider content-position="left">{{ t('launcher.candidatesTitle') }}</el-divider>
            <div class="lv-auto-reason" v-if="store.integrateReason">
              {{ t('launcher.hitReason', { reason: store.integrateReason }) }}
            </div>
            <div class="lv-candidates">
              <div
                v-for="c in store.candidates.slice(0, 5)"
                :key="c.instanceId"
                class="lv-candidate"
                @click="pickCandidate(c)"
              >
                <div class="lv-candidate-main">
                  <div class="lv-candidate-name">{{ c.launcherName }} · {{ c.instanceName }}</div>
                  <div class="lv-candidate-reason">{{ c.reason }}</div>
                </div>
                <el-tag size="small" :type="c.score > 0 ? 'success' : 'info'">{{ c.score }}</el-tag>
              </div>
            </div>
          </template>

          <el-divider content-position="left">{{ t('launcher.historyTitle') }}</el-divider>
          <div class="lv-records">
            <div v-for="r in [...store.records].reverse()" :key="r.id" class="lv-record">
              <el-icon><Document /></el-icon>
              <div class="lv-record-main">
                <div class="lv-record-name">{{ r.fileName }}</div>
                <div class="lv-record-meta">
                  {{ formatTime(r.importedAt) }} · {{ instanceName(r.instanceId) }}
                </div>
              </div>
            </div>
            <el-empty v-if="store.records.length === 0" :description="t('launcher.emptyRecords')" :image-size="40" />
          </div>
        </div>
      </el-col>
    </el-row>

    <!-- 自动集成对话框 -->
    <el-dialog v-model="autoDialogVisible" :title="t('launcher.autoDialogTitle')" width="460px">
      <div class="lv-auto-desc">
        {{ t('launcher.autoDialogDesc') }}
      </div>
      <el-form :model="autoForm" label-width="100px">
        <el-form-item :label="t('launcher.targetVersion')">
          <el-input v-model="autoForm.mcVersion" :placeholder="t('launcher.targetVersionPlaceholder')" clearable />
        </el-form-item>
        <el-form-item :label="t('launcher.targetLoader')">
          <el-select v-model="autoForm.loader" :placeholder="t('launcher.targetLoaderPlaceholder')" clearable>
            <el-option v-for="l in loaderOptions" :key="l.value" :label="l.label" :value="l.value" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="autoDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="store.integrating" @click="onAutoIntegrate">
          {{ t('launcher.startScan') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 添加启动器对话框 -->
    <el-dialog v-model="addDialogVisible" :title="t('launcher.addDialogTitle')" width="480px">
      <el-form :model="addForm" label-width="100px">
        <el-form-item :label="t('launcher.fieldKind')">
          <el-select v-model="addForm.kind">
            <el-option v-for="k in launcherKinds" :key="k.value" :label="k.label" :value="k.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('launcher.fieldName')">
          <el-input v-model="addForm.name" :placeholder="t('launcher.namePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('launcher.fieldExe')">
          <el-input v-model="addForm.exePath" :placeholder="t('launcher.exePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('launcher.fieldDataDir')">
          <el-input v-model="addForm.dataDir" :placeholder="t('launcher.dataDirPlaceholder')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="onAdd">{{ t('launcher.add') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ArrowDown,
  Connection,
  Cpu,
  Document,
  Download,
  Edit,
  MagicStick,
  Monitor,
  Plus,
  Refresh,
  Star,
  StarFilled,
  VideoPlay
} from '@element-plus/icons-vue'
import { useLauncherStore } from '../../stores/launcher'
import { useProjectStore } from '../../stores/project'
import { useI18n } from '../../i18n'
import type {
  AutoIntegrateCandidate,
  LauncherKind,
  LauncherLoader
} from '../../../../shared/types/launcher'

const store = useLauncherStore()
const projectStore = useProjectStore()
const { t } = useI18n()

// ─── 导入交互 ───
const artifactPath = ref('')
const overwrite = ref(false)
const importingFor = ref<string | null>(null)

async function doImport(instanceId: string): Promise<void> {
  if (!artifactPath.value) {
    ElMessage.warning(t('launcher.warnNoArtifact'))
    return
  }
  importingFor.value = instanceId
  const result = await store.import(artifactPath.value, instanceId, overwrite.value)
  importingFor.value = null
  if (result?.ok) {
    ElMessage.success(t('launcher.imported', { name: result.record?.fileName ?? '' }))
  } else if (result?.conflict) {
    ElMessage.error(t('launcher.conflict', { name: result.conflict.existingFileName }))
  } else if (result?.error) {
    ElMessage.error(result.error)
  }
}

// ─── 启动器类型标签 ───
const launcherKinds: { value: LauncherKind; label: string }[] = [
  { value: 'pcl2', label: 'PCL2' },
  { value: 'hmcl', label: 'HMCL' },
  { value: 'bakaxl', label: 'BakaXL' },
  { value: 'prism', label: 'Prism Launcher' },
  { value: 'multimc', label: 'MultiMC' },
  { value: 'official', label: 'Minecraft Launcher' }
]

function kindLabel(k: LauncherKind): string {
  return launcherKinds.find((x) => x.value === k)?.label ?? k
}

// ─── 添加启动器 ───
const addDialogVisible = ref(false)
const addForm = reactive<{ kind: LauncherKind; name: string; exePath: string; dataDir: string }>({
  kind: 'pcl2',
  name: '',
  exePath: '',
  dataDir: ''
})

async function onAdd(): Promise<void> {
  if (!addForm.name || !addForm.exePath) {
    ElMessage.warning(t('launcher.warnNameExe'))
    return
  }
  await store.add({
    kind: addForm.kind,
    name: addForm.name,
    exePath: addForm.exePath,
    dataDir: addForm.dataDir || undefined
  })
  if (!store.error) {
    ElMessage.success(t('launcher.added'))
    addDialogVisible.value = false
    addForm.name = ''
    addForm.exePath = ''
    addForm.dataDir = ''
  }
}

// ─── 自动集成 ───
const autoDialogVisible = ref(false)
const autoForm = reactive<{ mcVersion: string; loader: LauncherLoader | '' }>({
  mcVersion: '',
  loader: ''
})
const loaderOptions = computed<{ value: LauncherLoader; label: string }[]>(() => [
  { value: 'fabric', label: 'Fabric' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'vanilla', label: t('launcher.loaderVanilla') }
])

/** 打开自动集成：用当前项目的版本/加载器预填目标条件 */
function openAutoDialog(): void {
  const project = projectStore.currentProject
  if (project) {
    if (!autoForm.mcVersion) autoForm.mcVersion = project.mcVersion
    if (!autoForm.loader && project.loader) autoForm.loader = project.loader
  }
  autoDialogVisible.value = true
}

async function onAutoIntegrate(): Promise<void> {
  const result = await store.autoIntegrate({
    mcVersion: autoForm.mcVersion.trim() || undefined,
    loader: autoForm.loader || undefined,
    projectId: projectStore.currentProjectId ?? undefined
  })
  if (result?.ok) {
    ElMessage.success(
      result.instance
        ? t('launcher.integrated', {
            launcher: result.launcher?.name ?? '',
            instance: result.instance.name
          })
        : t('launcher.integrateDone')
    )
    autoDialogVisible.value = false
  } else if (result?.error) {
    ElMessage.warning(result.error)
  }
}

/** 从候选中改选：切到对应启动器并设为激活 */
async function pickCandidate(c: AutoIntegrateCandidate): Promise<void> {
  await store.selectLauncher(c.launcherId)
  await store.setActive(c.instanceId)
}

// ─── 闭环流程 ───
const loopSteps = computed(() => [
  { key: 'dev', name: t('launcher.loopDev'), desc: t('launcher.loopDevDesc'), icon: Edit, tone: 'dev' },
  { key: 'build', name: t('launcher.loopBuild'), desc: t('launcher.loopBuildDesc'), icon: Cpu, tone: 'build' },
  { key: 'test', name: t('launcher.loopTest'), desc: t('launcher.loopTestDesc'), icon: Monitor, tone: 'test' },
  { key: 'import', name: t('launcher.loopImport'), desc: t('launcher.loopImportDesc'), icon: Download, tone: 'import' },
  { key: 'launch', name: t('launcher.loopLaunch'), desc: t('launcher.loopLaunchDesc'), icon: VideoPlay, tone: 'launch' }
])

// ─── 辅助 ───
function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function instanceName(instanceId: string): string {
  return store.instances.find((i) => i.id === instanceId)?.name ?? instanceId
}

onMounted(() => {
  void store.detect()
})
</script>

<style scoped>
.launcher-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 12px;
  gap: 10px;
  overflow: auto;
}

.lv-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.lv-title h2 {
  margin: 0;
  font-size: 16px;
  color: var(--ky-text);
}
.lv-subtitle {
  font-size: 12px;
  color: var(--ky-text-dim);
  margin-left: 8px;
}

.lv-actions {
  display: flex;
  gap: 8px;
}

.lv-alert {
  flex-shrink: 0;
}

.lv-body {
  flex: 1;
  min-height: 0;
}

.lv-panel {
  height: 100%;
  background: var(--ky-bg-panel);
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.lv-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--ky-border);
  margin-bottom: 8px;
}
.lv-panel-title .el-tag {
  margin-left: auto;
}

/* 启动器列表 */
.lv-launcher-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lv-launcher-item {
  padding: 8px;
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.lv-launcher-item:hover {
  border-color: var(--ky-accent);
}
.lv-launcher-item.active {
  border-color: var(--ky-accent);
  background: var(--ky-accent-soft, rgba(137, 180, 250, 0.12));
}
.lv-launcher-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.lv-launcher-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--ky-text);
}
.lv-launcher-kind {
  font-size: 11px;
  color: var(--ky-text-dim);
  margin-top: 2px;
}
.lv-launcher-path {
  font-size: 10px;
  color: var(--ky-text-dim);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--ky-mono, monospace);
}

/* 实例列表 */
.lv-instance-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}
.lv-instance-item {
  display: flex;
  align-items: center;
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  padding: 6px 8px;
}
.lv-instance-item.active {
  border-color: var(--ky-accent);
  background: var(--ky-accent-soft, rgba(137, 180, 250, 0.12));
}
.lv-instance-main {
  flex: 1;
  cursor: pointer;
  min-width: 0;
}
.lv-instance-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
}
.lv-instance-meta {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  flex-wrap: wrap;
}
.lv-instance-path {
  font-size: 10px;
  color: var(--ky-text-dim);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--ky-mono, monospace);
}
.lv-instance-actions {
  display: flex;
  gap: 4px;
}

/* 导入区：上下两行（输入框整行 / 复选框+按钮一行），窄栏不挤压 */
.lv-import {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.lv-import .el-input {
  width: 100%;
}
.lv-import .el-input .el-input__inner {
  padding-left: 30px;
}
.lv-import .el-input .el-input__prefix .el-icon {
  color: var(--ky-text-dim);
}
.lv-import-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.lv-hint {
  font-size: 11px;
  color: var(--ky-text-dim);
  margin-top: 6px;
  line-height: 1.4;
}

/* 闭环流程 */
.lv-loop {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.lv-loop-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  position: relative;
}
.lv-loop-step.dev { background: rgba(203, 166, 247, 0.08); }
.lv-loop-step.build { background: rgba(249, 226, 175, 0.08); }
.lv-loop-step.test { background: rgba(166, 227, 161, 0.08); }
.lv-loop-step.import { background: rgba(137, 220, 235, 0.08); }
.lv-loop-step.launch { background: rgba(245, 194, 231, 0.08); }
.lv-loop-icon {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--ky-bg-sidebar);
  color: var(--ky-accent);
  flex-shrink: 0;
}
.lv-loop-text {
  flex: 1;
  min-width: 0;
}
.lv-loop-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-text);
}
.lv-loop-desc {
  font-size: 10px;
  color: var(--ky-text-dim);
}
.lv-loop-arrow {
  position: absolute;
  left: 19px;
  bottom: -10px;
  color: var(--ky-text-dim);
  font-size: 12px;
}

.lv-launch-btn {
  width: 100%;
  margin-bottom: 8px;
}

/* 自动集成候选 */
.lv-auto-desc {
  font-size: 12px;
  color: var(--ky-text-dim);
  line-height: 1.5;
  margin-bottom: 12px;
}
.lv-auto-reason {
  font-size: 11px;
  color: var(--ky-text-dim);
  margin-bottom: 6px;
}
.lv-candidates {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}
.lv-candidate {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.lv-candidate:hover {
  border-color: var(--ky-accent);
}
.lv-candidate-main {
  flex: 1;
  min-width: 0;
}
.lv-candidate-name {
  font-size: 12px;
  color: var(--ky-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lv-candidate-reason {
  font-size: 10px;
  color: var(--ky-text-dim);
  margin-top: 2px;
}

/* 导入历史 */
.lv-records {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lv-record {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 4px;
  background: var(--ky-bg-sidebar);
}
.lv-record-main {
  flex: 1;
  min-width: 0;
}
.lv-record-name {
  font-size: 12px;
  color: var(--ky-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lv-record-meta {
  font-size: 10px;
  color: var(--ky-text-dim);
}
</style>
