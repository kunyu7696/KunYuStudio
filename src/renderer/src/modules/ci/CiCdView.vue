<template>
  <div class="ci-view">
    <header class="ci-header">
      <h2>{{ t('ci.title') }}</h2>
      <p>{{ t('ci.subtitle') }}</p>
    </header>

    <section v-if="!project" class="ci-card">
      <div class="ci-empty">{{ t('ci.needProject') }}</div>
    </section>

    <template v-else>
      <!-- 工作流开关 -->
      <section class="ci-card">
        <div class="ci-card-title">{{ t('ci.workflowToggles') }}</div>
        <div class="ci-toggles">
          <label class="ci-toggle">
            <input type="checkbox" v-model="config.workflows.build" @change="onConfigChange" />
            <span class="ci-toggle-label">build.yml</span>
            <span class="ci-toggle-desc">{{ t('ci.buildDesc') }}</span>
          </label>
          <label class="ci-toggle">
            <input type="checkbox" v-model="config.workflows.release" @change="onConfigChange" />
            <span class="ci-toggle-label">release.yml</span>
            <span class="ci-toggle-desc">{{ t('ci.releaseDesc') }}</span>
          </label>
          <label class="ci-toggle">
            <input type="checkbox" v-model="config.workflows.gametest" @change="onConfigChange" />
            <span class="ci-toggle-label">gametest.yml</span>
            <span class="ci-toggle-desc">{{ t('ci.gametestDesc') }}</span>
          </label>
        </div>
      </section>

      <!-- 矩阵加载器 -->
      <section v-if="config.workflows.build" class="ci-card">
        <div class="ci-card-title">
          {{ t('ci.matrixTitle') }}
          <span class="ci-count">{{ t('ci.loaderCount', { n: config.matrix.loaders.length }) }}</span>
        </div>
        <div class="ci-toggles">
          <label v-for="ld in ALL_LOADERS" :key="ld" class="ci-toggle">
            <input
              type="checkbox"
              :checked="config.matrix.loaders.includes(ld)"
              @change="toggleLoader(ld)"
            />
            <span class="ci-toggle-label">{{ LOADER_LABELS[ld] }}</span>
          </label>
        </div>
        <p class="ci-hint">{{ t('ci.matrixHint') }}</p>
      </section>

      <!-- 发布平台 -->
      <section v-if="config.workflows.release" class="ci-card">
        <div class="ci-card-title">
          {{ t('ci.publishTitle') }}
          <span class="ci-count">{{ t('ci.publishNote') }}</span>
        </div>
        <div class="ci-toggles">
          <label class="ci-toggle">
            <input type="checkbox" v-model="config.publish.githubRelease" @change="onConfigChange" />
            <span class="ci-toggle-label">GitHub Release</span>
            <span class="ci-toggle-desc">{{ t('ci.ghDesc') }}</span>
          </label>
          <label class="ci-toggle">
            <input type="checkbox" v-model="config.publish.modrinth" @change="onConfigChange" />
            <span class="ci-toggle-label">Modrinth</span>
            <span class="ci-toggle-desc">{{ t('ci.modrinthDesc') }}</span>
          </label>
          <label class="ci-toggle">
            <input type="checkbox" v-model="config.publish.curseforge" @change="onConfigChange" />
            <span class="ci-toggle-label">CurseForge</span>
            <span class="ci-toggle-desc">{{ t('ci.curseforgeDesc') }}</span>
          </label>
        </div>
        <div v-if="config.publish.modrinth || config.publish.curseforge" class="ci-secrets">
          <div class="ci-secret-row">
            <label>{{ t('ci.modrinthSecret') }}</label>
            <input
              v-model="config.secrets.modrinth"
              class="ci-input"
              placeholder="MODRINTH_TOKEN"
              @change="onConfigChange"
            />
          </div>
          <div class="ci-secret-row">
            <label>{{ t('ci.curseforgeSecret') }}</label>
            <input
              v-model="config.secrets.curseforge"
              class="ci-input"
              placeholder="CURSEFORGE_TOKEN"
              @change="onConfigChange"
            />
          </div>
          <p class="ci-hint">{{ t('ci.secretHint') }}</p>
        </div>
      </section>

      <!-- YAML 预览 -->
      <section class="ci-card">
        <div class="ci-card-title">
          {{ t('ci.yamlPreview') }}
          <span v-if="previewDirty" class="ci-dirty">{{ t('ci.previewStale') }}</span>
        </div>
        <el-tabs v-model="activeTab" class="ci-tabs">
          <el-tab-pane
            v-for="kind in availableTabs"
            :key="kind"
            :label="`${kind}.yml`"
            :name="kind"
          >
            <pre class="ci-yaml">{{ preview[kind] ?? t('ci.previewPlaceholder') }}</pre>
          </el-tab-pane>
          <el-tab-pane v-if="availableTabs.length === 0" :label="t('ci.noneTab')" name="none">
            <pre class="ci-yaml">{{ t('ci.noWorkflow') }}</pre>
          </el-tab-pane>
        </el-tabs>
        <div class="ci-actions">
          <el-button size="small" :loading="previewing" @click="refreshPreview">{{ t('ci.refreshPreview') }}</el-button>
          <el-button size="small" :loading="saving" @click="saveConfig">{{ t('ci.saveConfig') }}</el-button>
          <el-button
            type="primary"
            size="small"
            :loading="exporting"
            :disabled="!project.modId"
            @click="exportWorkflows"
          >
            {{ t('ci.exportWorkflows') }}
          </el-button>
        </div>
        <div v-if="exportResult" class="ci-export-result" :class="{ 'ci-ok': exportResult.ok, 'ci-fail': !exportResult.ok }">
          <template v-if="exportResult.ok">
            {{ t('ci.exportOk', { workflows: exportResult.workflows.length, scripts: exportResult.buildScripts.length }) }}
            <span v-if="exportResult.workflows.length > 0">{{ t('ci.exportOkList', { list: exportResult.workflows.join(', ') }) }}</span>
          </template>
          <template v-else>{{ t('ci.exportFailed', { error: exportResult.error ?? '' }) }}</template>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue'
import { useProjectStore } from '../../stores/project'
import { createDefaultCiConfig, type CiConfig, type CiExportResult, type CiWorkflowKind } from '../../../../shared/types/ci'
import type { ModLoader } from '../../../../shared/types/project'
import { t } from '../../i18n'

const projectStore = useProjectStore()
const project = computed(() => projectStore.currentProject)

const ALL_LOADERS: ModLoader[] = ['fabric', 'forge', 'neoforge']
const LOADER_LABELS: Record<ModLoader, string> = {
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

const config = ref<CiConfig>(createDefaultCiConfig('fabric'))
const preview = ref<Partial<Record<CiWorkflowKind, string>>>({})
const activeTab = ref<string>('build')
const previewDirty = ref(true)
const previewing = ref(false)
const saving = ref(false)
const exporting = ref(false)
const exportResult = ref<CiExportResult | null>(null)

const availableTabs = computed<CiWorkflowKind[]>(() => {
  const tabs: CiWorkflowKind[] = []
  if (config.value.workflows.build) tabs.push('build')
  if (config.value.workflows.release) tabs.push('release')
  if (config.value.workflows.gametest) tabs.push('gametest')
  return tabs
})

function toggleLoader(ld: ModLoader): void {
  const idx = config.value.matrix.loaders.indexOf(ld)
  if (idx >= 0) {
    config.value.matrix.loaders.splice(idx, 1)
  } else {
    config.value.matrix.loaders.push(ld)
  }
  onConfigChange()
}

function onConfigChange(): void {
  previewDirty.value = true
}

async function loadConfig(): Promise<void> {
  if (!project.value) return
  const loaded = await window.api.ci.getConfig(project.value.path)
  if (loaded) {
    config.value = loaded
  } else {
    config.value = createDefaultCiConfig(project.value.loader ?? 'fabric')
  }
  await refreshPreview()
}

async function refreshPreview(): Promise<void> {
  if (!project.value) return
  previewing.value = true
  try {
    preview.value = await window.api.ci.preview(project.value.path, structuredClone(toRaw(config.value)))
    // 切到第一个可用 tab
    if (availableTabs.value.length > 0 && !availableTabs.value.includes(activeTab.value as CiWorkflowKind)) {
      activeTab.value = availableTabs.value[0]
    }
    previewDirty.value = false
  } finally {
    previewing.value = false
  }
}

async function saveConfig(): Promise<void> {
  if (!project.value) return
  saving.value = true
  try {
    await window.api.ci.setConfig(project.value.path, structuredClone(toRaw(config.value)))
    await refreshPreview()
  } finally {
    saving.value = false
  }
}

async function exportWorkflows(): Promise<void> {
  if (!project.value) return
  exporting.value = true
  try {
    // 先保存配置再导出（toRaw 解包 Pinia 响应式代理，避免 IPC structured clone 失败）
    const plainConfig = structuredClone(toRaw(config.value))
    await window.api.ci.setConfig(project.value.path, plainConfig)
    const result = await window.api.ci.export(project.value.path, plainConfig)
    exportResult.value = result
    await refreshPreview()
  } finally {
    exporting.value = false
  }
}

onMounted(loadConfig)
</script>

<style scoped>
.ci-view {
  height: 100%;
  overflow-y: auto;
  padding: 16px 20px;
  background: var(--ky-bg-base);
  color: var(--ky-text, #cdd6f4);
}

.ci-header {
  margin-bottom: 16px;
}
.ci-header h2 {
  margin: 0 0 4px;
  font-size: 16px;
  font-weight: 600;
}
.ci-header p {
  margin: 0;
  font-size: 12px;
  color: var(--ky-text-sub, #a6adc8);
  line-height: 1.5;
}

.ci-card {
  background: var(--ky-bg-panel);
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.ci-card-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ci-count {
  font-size: 11px;
  font-weight: 400;
  color: var(--ky-text-sub, #a6adc8);
}

.ci-toggles {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ci-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
}
.ci-toggle input[type='checkbox'] {
  width: 14px;
  height: 14px;
  accent-color: var(--ky-accent);
  cursor: pointer;
}
.ci-toggle-label {
  font-weight: 600;
  min-width: 120px;
}
.ci-toggle-desc {
  color: var(--ky-text-sub, #a6adc8);
  font-size: 11px;
}

.ci-hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--ky-text-sub, #a6adc8);
  line-height: 1.5;
}
.ci-hint code {
  background: var(--ky-bg-sidebar);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.ci-secrets {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--ky-border);
}
.ci-secret-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.ci-secret-row label {
  font-size: 11px;
  min-width: 160px;
  color: var(--ky-text-sub, #a6adc8);
}
.ci-input {
  flex: 1;
  background: var(--ky-bg-sidebar);
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  padding: 4px 8px;
  color: var(--ky-text, #cdd6f4);
  font-size: 12px;
  font-family: monospace;
}

.ci-tabs {
  margin-top: 4px;
}
.ci-yaml {
  background: var(--ky-bg-sidebar);
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  padding: 10px 12px;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.5;
  overflow-x: auto;
  max-height: 400px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--ky-text, #cdd6f4);
  margin: 0;
}

.ci-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.ci-actions .el-button--primary {
  background: var(--ky-accent) !important;
  color: #11111b !important;
  border-color: var(--ky-accent) !important;
}
.ci-actions .el-button--primary:hover {
  background: var(--ky-accent-active) !important;
  border-color: var(--ky-accent-active) !important;
}

.ci-dirty {
  color: #f9e2af;
  font-size: 11px;
  font-weight: 400;
}

.ci-export-result {
  margin-top: 8px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.5;
}
.ci-export-result.ci-ok {
  background: rgba(74, 222, 128, 0.1);
  color: #a6e3a1;
}
.ci-export-result.ci-fail {
  background: rgba(243, 139, 168, 0.1);
  color: #f38ba8;
}

.ci-empty {
  text-align: center;
  padding: 40px;
  color: var(--ky-text-sub, #a6adc8);
  font-size: 13px;
}
</style>
