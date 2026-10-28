<template>
  <div class="debug-view">
    <header class="dv-header">
      <h2>{{ t('debug.title') }}</h2>
      <p>{{ t('debug.desc') }}</p>
    </header>

    <!-- 无项目 -->
    <el-empty v-if="!project" :description="t('debug.emptyDesc')">
      <el-button type="primary" @click="ui.setActiveModule('project-manager')">{{ t('debug.gotoProjectManager') }}</el-button>
    </el-empty>

    <template v-else>
      <!-- 操作卡片 -->
      <section class="dv-card">
        <h3>{{ t('debug.buildTasks') }}</h3>
        <div class="dv-actions">
          <el-button type="primary" :disabled="build.running" @click="build.build(project.path)">
            <el-icon><Tools /></el-icon> {{ t('debug.buildBtn') }}
          </el-button>
          <el-button type="success" :disabled="build.running" @click="build.buildAndRun(project.path)">
            <el-icon><VideoPlay /></el-icon> {{ t('debug.buildRunBtn') }}
          </el-button>
          <el-button :disabled="build.running" @click="build.runClient(project.path)">
            {{ t('debug.runClientOnly') }}
          </el-button>
          <el-button :disabled="build.running" @click="build.clean(project.path)">{{ t('debug.cleanBuild') }}</el-button>
          <el-button v-if="build.running" type="danger" plain @click="build.cancel()">
            <el-icon><VideoPause /></el-icon> {{ t('debug.stopTask') }}
          </el-button>
        </div>
      </section>

      <!-- 流程步骤（T5.4） -->
      <section v-if="build.flow" class="dv-card">
        <h3>{{ t('debug.progress') }}</h3>
        <el-steps
          :active="build.flow.active"
          :process-status="build.flow.failed ? 'error' : 'process'"
          finish-status="success"
          align-center
        >
          <el-step v-for="(step, i) in build.flow.steps" :key="i" :title="step" />
        </el-steps>
      </section>

      <!-- M10 游戏测试沙箱 -->
      <section class="dv-card">
        <div class="dv-card-head sb-head">
          <h3>{{ t('debug.sandboxTitle') }}</h3>
        </div>
        <div class="dv-actions">
          <el-button type="primary" plain :loading="sandbox.running" @click="startSandbox">
            <el-icon><VideoPlay /></el-icon> {{ t('debug.startTest') }}
          </el-button>
          <el-button v-if="sandbox.running" type="danger" plain @click="sandbox.cancel()">
            <el-icon><VideoPause /></el-icon> {{ t('debug.abortTest') }}
          </el-button>
        </div>

        <el-steps v-if="hasSandboxActivity" :active="sandbox.activeStage" align-center class="sb-steps">
          <el-step
            v-for="s in stageOrder"
            :key="s"
            :title="stageTitles[s]"
            :status="stageStepStatus(s)"
            :description="sandbox.stages[s]?.detail"
          />
        </el-steps>

        <el-alert
          v-if="attachHint"
          type="warning"
          :closable="false"
          show-icon
          :title="t('debug.attachTitle')"
          :description="t('debug.attachDesc')"
          class="sb-alert"
        />

        <div v-if="sandbox.probes.length > 0" class="sb-probes">
          <div v-for="(p, i) in sandbox.probes" :key="i" class="sb-probe">
            <el-tag :type="p.ok ? 'success' : 'danger'" size="small" effect="dark">
              {{ p.ok ? t('debug.probePass') : t('debug.probeFail') }}
            </el-tag>
            <span class="sb-probe-name">{{ p.name }}</span>
            <span class="sb-probe-detail">{{ p.detail }}</span>
          </div>
        </div>

        <template v-if="sandbox.report">
          <el-divider />
          <el-result
            :icon="sandbox.report.ok ? 'success' : 'error'"
            :title="sandbox.report.cancelled ? t('debug.testCancelled') : sandbox.report.ok ? t('debug.testPass') : t('debug.testIssues')"
            :sub-title="t('debug.duration', { s: (sandbox.report.durationMs / 1000).toFixed(1) })"
          />
          <el-alert
            v-if="sandbox.report.diagnosis"
            type="error"
            :closable="false"
            show-icon
            class="sb-diag"
            :title="sandbox.report.diagnosis.headline"
          >
            <template #default>
              <div v-if="sandbox.report.diagnosis.cause" class="sb-diag-line">
                <strong>{{ t('debug.causeLabel') }}</strong>{{ sandbox.report.diagnosis.cause }}
              </div>
              <div v-if="sandbox.report.diagnosis.suggestion" class="sb-diag-line">
                <strong>{{ t('debug.suggestionLabel') }}</strong>{{ sandbox.report.diagnosis.suggestion }}
              </div>
              <div v-if="sandbox.report.diagnosis.reportPath" class="sb-diag-line mono">
                {{ sandbox.report.diagnosis.reportPath }}
              </div>
            </template>
          </el-alert>

          <el-image
            v-if="sandbox.report.screenshotPath && shotUrl"
            :src="shotUrl"
            :preview-src-list="[shotUrl]"
            class="sb-shot"
            fit="contain"
          />

          <el-table
            v-if="sandbox.report.logFindings.length > 0"
            :data="sandbox.report.logFindings"
            size="small"
            class="sb-findings"
          >
            <el-table-column prop="level" :label="t('debug.colLevel')" width="90">
              <template #default="{ row }">
                <el-tag :type="row.level === 'ERROR' ? 'danger' : 'warning'" size="small">{{ row.level }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="pattern" :label="t('debug.colType')" width="160" />
            <el-table-column prop="evidence" :label="t('debug.colEvidence')" show-overflow-tooltip />
          </el-table>

          <div v-if="sandbox.report.modsManifest.length > 0" class="sb-mods">
            <span class="sb-mods-label">{{ t('debug.modsLabel', { n: sandbox.report.modsManifest.length }) }}</span>
            <el-tag v-for="m in sandbox.report.modsManifest" :key="m" size="small" class="sb-mod-tag">{{ m }}</el-tag>
          </div>
        </template>
      </section>

      <!-- JDK 环境（T5.1） -->
      <section class="dv-card">
        <div class="dv-card-head">
          <h3>{{ t('debug.jdkTitle') }}</h3>
          <el-button size="small" text :loading="jdkLoading" @click="refreshJdk">{{ t('debug.redetect') }}</el-button>
        </div>
        <el-alert
          v-if="build.jdk"
          :type="build.jdk.compatible ? 'success' : 'error'"
          :closable="false"
          show-icon
          :title="build.jdk.compatible
            ? t('debug.jdkOk', { version: build.jdk.jdk?.version ?? '', major: build.jdk.requiredMajor })
            : t('debug.jdkNoCompatible')"
          :description="build.jdk.message"
        />
        <ul v-if="build.jdk && build.jdk.candidates.length > 0" class="dv-jdks">
          <li
            v-for="(c, i) in build.jdk.candidates"
            :key="i"
            :class="{ chosen: build.jdk.jdk?.home === c.home }"
          >
            <span class="dv-jdk-ver">JDK {{ c.version }}</span>
            <el-tag :type="tagType(compatOf(c))" size="small" effect="plain">
              {{ compatLabel(compatOf(c)) }}
            </el-tag>
            <span class="dv-jdk-path">{{ c.home }}</span>
            <el-tag v-if="build.jdk.jdk?.home === c.home" size="small" type="success" effect="dark">{{ t('debug.chosen') }}</el-tag>
          </li>
        </ul>
      </section>

      <!-- 最近结果 -->
      <section v-if="build.lastResult" class="dv-card">
        <h3>{{ t('debug.lastResultTitle') }}</h3>
        <el-result
          :icon="build.lastResult.ok ? 'success' : 'error'"
          :title="resultTitle"
          :sub-title="t('debug.duration', { s: (build.lastResult.durationMs / 1000).toFixed(1) })"
        />
        <div v-if="build.lastResult.ok" class="dv-hint">
          {{ t('debug.buildOutputLead') }} <code>build/libs/</code>{{ t('debug.buildOutputTail') }}
        </div>
        <div v-if="build.errorCount > 0" class="dv-hint err">
          {{ t('debug.errorSummary', { errors: build.errorCount, warnings: build.warningCount }) }}
          <el-link type="danger" @click="build.openPanel('problems')">{{ t('debug.viewInProblems') }}</el-link>
        </div>
      </section>

      <!-- 崩溃报告摘要（T5.3） -->
      <section v-if="build.crash" class="dv-card">
        <h3>{{ t('debug.crashTitle') }}</h3>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item :label="t('debug.crashKeyword')">{{ build.crash.keyword }}</el-descriptions-item>
          <el-descriptions-item :label="t('debug.crashDesc')">{{ build.crash.description }}</el-descriptions-item>
          <el-descriptions-item :label="t('debug.crashCause')">{{ build.crash.cause }}</el-descriptions-item>
          <el-descriptions-item :label="t('debug.crashReportFile')">
            <el-link type="primary" @click="build.openCrashReport()">{{ build.crash.reportPath }}</el-link>
          </el-descriptions-item>
        </el-descriptions>
      </section>

      <p class="dv-foot-tip">{{ t('debug.footTip') }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Tools, VideoPause, VideoPlay } from '@element-plus/icons-vue'
import { useBuildStore } from '../../stores/build'
import { useProjectStore } from '../../stores/project'
import { useSandboxStore } from '../../stores/sandbox'
import { useUiStore } from '../../stores/ui'
import { useI18n } from '../../i18n'
import type { SandboxStage, SandboxStageStatus } from '../../../../shared/types/sandbox'
import {
  judgeJdkCompatibility,
  LEGACY_JDK_REQUIREMENTS,
  type JdkCompatibility,
  type JdkInfo
} from '../../../../shared/types/build'

const build = useBuildStore()
const projectStore = useProjectStore()
const sandbox = useSandboxStore()
const ui = useUiStore()
const { t } = useI18n()

const project = computed(() => projectStore.currentProject)
const jdkLoading = ref(false)

// ---- M10 沙箱 ----
const stageOrder: SandboxStage[] = ['build', 'launch', 'wait-world', 'probes', 'collect', 'shutdown']
const stageTitles = computed<Record<SandboxStage, string>>(() => ({
  build: t('debug.stageBuild'),
  launch: t('debug.stageLaunch'),
  'wait-world': t('debug.stageWaitWorld'),
  probes: t('debug.stageProbes'),
  collect: t('debug.stageCollect'),
  shutdown: t('debug.stageShutdown')
}))

const hasSandboxActivity = computed(
  () => sandbox.running || Object.keys(sandbox.stages).length > 0 || sandbox.report !== null
)
const attachHint = computed(() => sandbox.stages['wait-world']?.status === 'skipped')
const shotUrl = computed(() =>
  sandbox.report?.screenshotPath ? toFileUrl(sandbox.report.screenshotPath) : ''
)

function stageStepStatus(s: SandboxStage): 'wait' | 'process' | 'finish' | 'error' | 'success' {
  const status: SandboxStageStatus | undefined = sandbox.stages[s]?.status
  if (status === 'running') return 'process'
  if (status === 'done') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'skipped') return 'wait'
  return 'wait'
}

async function startSandbox(): Promise<void> {
  if (project.value) await sandbox.run(project.value.path)
}

/** 游戏本机绝对路径 → 可渲染 file:// URL（Windows 盘符处理） */
function toFileUrl(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${normalized}`
  if (normalized.startsWith('/')) return `file://${normalized}`
  return ''
}

const resultTitle = computed(() => {
  const r = build.lastResult
  if (!r) return ''
  if (r.cancelled) return t('debug.resCancelled')
  if (r.timedOut) return t('debug.resTimeout')
  return r.ok ? t('debug.resOk') : t('debug.resFail')
})

async function refreshJdk(): Promise<void> {
  if (!project.value) return
  jdkLoading.value = true
  try {
    await build.detectJdk(project.value.jdkPath)
  } finally {
    jdkLoading.value = false
  }
}

/** 候选 JDK 与当前项目工具链的兼容等级（徽章仅提示，灰化/禁用不做） */
function compatOf(c: JdkInfo): JdkCompatibility {
  return judgeJdkCompatibility(c.major, build.jdk?.requirements ?? LEGACY_JDK_REQUIREMENTS)
}
function compatLabel(c: JdkCompatibility): string {
  switch (c) {
    case 'recommended':
      return t('debug.compatRecommended')
    case 'compatible':
      return t('debug.compatCompatible')
    case 'too-low':
      return t('debug.compatTooLow')
    case 'too-high':
      return t('debug.compatTooHigh')
  }
}
function tagType(c: JdkCompatibility): 'success' | 'warning' | 'danger' | 'info' {
  switch (c) {
    case 'recommended':
      return 'success'
    case 'compatible':
      return 'info'
    case 'too-low':
      return 'warning'
    case 'too-high':
      return 'danger'
  }
}
</script>

<style scoped>
.debug-view {
  height: 100%;
  overflow-y: auto;
  padding: 20px 28px;
  max-width: 780px;
  margin: 0 auto;
}

.dv-header h2 {
  margin: 0 0 6px;
  font-size: 18px;
  color: var(--ky-text);
}

.dv-header p {
  margin: 0 0 16px;
  font-size: 12.5px;
  color: var(--ky-text-dim);
}

.dv-card {
  background: var(--ky-bg-sidebar);
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  padding: 14px 16px;
  margin-bottom: 14px;
}

.dv-card h3 {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--ky-text);
}

.dv-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dv-card-head h3 {
  margin: 0 0 12px;
}

.dv-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dv-jdks {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dv-jdks li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px;
  border-radius: 5px;
  background: var(--ky-bg-base);
  font-size: 12px;
}

.dv-jdks li.chosen {
  outline: 1px solid var(--ky-accent);
}

.dv-jdk-ver {
  font-family: var(--ky-font-mono);
  font-weight: 600;
  color: var(--ky-text);
  min-width: 92px;
}

.dv-jdk-path {
  color: var(--ky-text-dim);
  font-family: var(--ky-font-mono);
  font-size: 11px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dv-hint {
  font-size: 12px;
  color: var(--ky-text-sub);
  margin-top: -10px;
}

.dv-hint.err {
  color: #f38ba8;
  margin-top: 0;
}

.dv-hint code {
  font-family: var(--ky-font-mono);
  color: var(--ky-accent);
}

.dv-foot-tip {
  text-align: center;
  font-size: 11px;
  color: var(--ky-text-dim);
  margin: 18px 0 8px;
}

/* M10 沙箱 */
.sb-head {
  margin-bottom: 10px;
}

.sb-steps {
  margin: 16px 4px 4px;
}

.sb-alert {
  margin-top: 12px;
}

.sb-probes {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sb-probe {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}

.sb-probe-name {
  font-weight: 600;
  color: var(--ky-text);
  white-space: nowrap;
}

.sb-probe-detail {
  color: var(--ky-text-dim);
  font-family: var(--ky-font-mono);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-diag {
  margin: 10px 0;
}

.sb-diag-line {
  font-size: 12px;
  line-height: 1.7;
}

.mono {
  font-family: var(--ky-font-mono);
  font-size: 11px;
  word-break: break-all;
}

.sb-shot {
  display: block;
  width: 320px;
  max-width: 100%;
  border-radius: 6px;
  border: 1px solid var(--ky-border);
  margin: 10px 0;
}

.sb-findings {
  margin: 10px 0;
}

.sb-mods {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.sb-mods-label {
  font-size: 12px;
  color: var(--ky-text-dim);
}

.sb-mod-tag {
  font-family: var(--ky-font-mono);
}
</style>
