<template>
  <div class="perf-view">
    <header class="pv-header">
      <h2>{{ t('performance.title') }}</h2>
      <p>{{ t('performance.subtitle') }}</p>
    </header>

    <!-- 工具栏 -->
    <section class="pv-card">
      <div class="pv-toolbar">
        <div class="pv-filters">
          <el-select
            :model-value="store.filter.loader ?? ''"
            :placeholder="t('performance.filterLoader')"
            clearable
            size="small"
            class="pv-select"
            @update:model-value="(v: string) => store.setFilter({ loader: v || null })"
          >
            <el-option v-for="l in store.loaders" :key="l" :label="l" :value="l" />
          </el-select>
          <el-select
            :model-value="store.filter.mcVersion ?? ''"
            :placeholder="t('performance.filterMcVersion')"
            clearable
            size="small"
            class="pv-select"
            @update:model-value="(v: string) => store.setFilter({ mcVersion: v || null })"
          >
            <el-option v-for="m in store.mcVersions" :key="m" :label="m" :value="m" />
          </el-select>
          <el-select
            :model-value="store.filter.severity ?? ''"
            :placeholder="t('performance.filterSeverity')"
            clearable
            size="small"
            class="pv-select pv-select-sev"
            @update:model-value="(v: ProfileSeverity) => store.setFilter({ severity: v || null })"
          >
            <el-option :label="t('performance.severity.good') + ' good'" value="good" />
            <el-option :label="t('performance.severity.warn') + ' warn'" value="warn" />
            <el-option :label="t('performance.severity.bad') + ' bad'" value="bad" />
          </el-select>
          <el-button size="small" text @click="store.resetFilter()">{{ t('performance.resetFilter') }}</el-button>
        </div>
        <div class="pv-actions">
          <el-button size="small" @click="analyzeMods">{{ t('performance.analyzeMods') }}</el-button>
          <el-dropdown trigger="click" @command="manualImport">
            <el-button size="small">
              {{ t('performance.manualImport') }}<el-icon class="pv-caret"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="jar">{{ t('performance.importJar') }}</el-dropdown-item>
                <el-dropdown-item command="jfr">{{ t('performance.importJfr') }}</el-dropdown-item>
                <el-dropdown-item command="spark">{{ t('performance.importSpark') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button type="primary" size="small" :loading="store.loading" @click="store.load()">
            <el-icon><Refresh /></el-icon>&nbsp;{{ t('performance.refresh') }}
          </el-button>
        </div>
      </div>

      <!-- 排序维度 -->
      <div class="pv-order">
        <span class="pv-order-label">{{ t('performance.orderBy') }}</span>
        <button
          v-for="col in ORDER_COLUMNS"
          :key="col"
          type="button"
          class="pv-order-chip"
          :class="{ active: store.orderBy === col }"
          @click="store.setOrderBy(col)"
        >
          {{ orderLabel(col) }}
        </button>
      </div>
    </section>

    <!-- 排行榜 -->
    <section class="pv-card">
      <el-table
        :data="store.rows"
        size="small"
        class="pv-table"
        :empty-text="store.loading ? t('performance.emptyLoading') : t('performance.emptyNoProfile')"
        @row-click="(row: LeaderboardEntry) => store.openDetail(row)"
      >
        <el-table-column width="42" align="center">
          <template #default="{ row }">
            <el-checkbox
              :model-value="store.isComparing(row as ProfileKey)"
              @change="store.toggleCompare(row as ProfileKey)"
              @click.stop
            />
          </template>
        </el-table-column>
        <el-table-column :label="t('performance.colMod')" min-width="180">
          <template #default="{ row }">
            <div class="pv-modname">{{ (row as LeaderboardEntry).modName }}</div>
            <div class="pv-modid">{{ (row as LeaderboardEntry).modId }} · v{{ (row as LeaderboardEntry).version }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="loader" :label="t('performance.colLoader')" width="80" />
        <el-table-column prop="mcVersion" :label="t('performance.colMc')" width="72" />
        <el-table-column :label="t('performance.colSeverity')" width="76" align="center">
          <template #default="{ row }">
            <span class="pv-sev" :class="(row as LeaderboardEntry).severity">
              {{ severityText((row as LeaderboardEntry).severity) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column
          v-for="col in ORDER_COLUMNS"
          :key="col"
          :label="orderShort(col)"
          width="66"
          align="center"
        >
          <template #default="{ row }">
            <span class="pv-score" :class="scoreTone((row as LeaderboardEntry).scores[col])">
              {{ (row as LeaderboardEntry).scores[col] }}
            </span>
          </template>
        </el-table-column>
        <el-table-column :label="t('performance.colAdvice')" width="56" align="center">
          <template #default="{ row }">
            <span class="pv-advice-count">{{ (row as LeaderboardEntry).adviceCount }}</span>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 模组对比 -->
    <section v-if="store.comparison.length >= 2" class="pv-card">
      <div class="pv-compare-head">
        <h3>{{ t('performance.comparison', { n: store.comparison.length }) }}</h3>
        <el-button size="small" text @click="store.clearComparison()">{{ t('performance.clear') }}</el-button>
      </div>
      <div v-for="col in ORDER_COLUMNS" :key="col" class="pv-cmp-row">
        <div class="pv-cmp-label">{{ orderLabel(col) }}</div>
        <div class="pv-cmp-bars">
          <div v-for="item in store.comparison" :key="keyText(item)" class="pv-cmp-item">
            <div class="pv-cmp-track">
              <div
                class="pv-cmp-fill"
                :class="scoreTone(item.scores[col])"
                :style="{ width: item.scores[col] + '%' }"
              />
            </div>
            <span class="pv-cmp-name">{{ item.modName }}</span>
            <span class="pv-cmp-val">{{ item.scores[col] }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 画像详情抽屉 -->
    <el-drawer
      :model-value="store.detail !== null"
      :title="t('performance.detailTitle')"
      direction="rtl"
      size="46%"
      @update:model-value="(v: boolean) => !v && store.closeDetail()"
    >
      <div v-if="store.detail" class="pv-detail">
        <div class="pv-d-title">
          <h3>{{ store.detail.identity.modName }}</h3>
          <span class="pv-sev" :class="store.detail.score.severity">
            {{ severityText(store.detail.score.severity) }} · {{ store.detail.score.scores.overall }}
          </span>
          <el-button
            type="primary"
            size="small"
            class="pv-opt-btn"
            @click.stop="wizardOpen = true"
          >
            {{ t('performance.optimizeThis') }}
          </el-button>
        </div>
        <p class="pv-d-meta">
          {{ store.detail.identity.modId }} · {{ store.detail.identity.version }} ·
          {{ store.detail.identity.loader }} · MC {{ store.detail.identity.mcVersion }}
        </p>

        <!-- 静态特征 -->
        <div class="pv-d-grid">
          <div class="pv-stat"><b>{{ store.detail.staticFeatures.classCount }}</b><span>{{ t('performance.statClasses') }}</span></div>
          <div class="pv-stat"><b>{{ store.detail.staticFeatures.mixinCount }}</b><span>{{ t('performance.statMixin') }}</span></div>
          <div class="pv-stat">
            <b>{{ store.detail.staticFeatures.dependencies.hardDeps.length }}</b><span>{{ t('performance.statHardDeps') }}</span>
          </div>
          <div class="pv-stat">
            <b>{{ store.detail.staticFeatures.bytecode.mainThreadBlockingCalls }}</b><span>{{ t('performance.statBlocking') }}</span>
          </div>
        </div>

        <el-table
          :data="fiveDimRows"
          size="small"
          class="pv-d-scores"
        >
          <el-table-column prop="label" :label="t('performance.colDimension')" />
          <el-table-column :label="t('performance.colScore')" width="80" align="center">
            <template #default="{ row }">
              <span class="pv-score" :class="scoreTone(row.value)">{{ row.value }}</span>
            </template>
          </el-table-column>
        </el-table>

        <!-- 建议 -->
        <h4 class="pv-d-h">{{ t('performance.adviceTitle', { n: store.detail.advice.length }) }}</h4>
        <el-empty
          v-if="store.detail.advice.length === 0"
          :description="t('performance.noAdvice')"
          :image-size="60"
        />
        <el-collapse v-else class="pv-advice">
          <el-collapse-item
            v-for="a in store.detail.advice"
            :key="a.id"
            :name="a.id"
          >
            <template #title>
              <span class="pv-adv-sev" :class="a.severity">{{ a.severity }}</span>
              <span class="pv-adv-rule">{{ a.ruleId }}</span>
              <el-tooltip :content="sourceTip(a.source)" placement="top">
                <el-tag
                  size="small"
                  effect="plain"
                  :type="SOURCE_TAG_TYPE[a.source]"
                  class="pv-adv-source"
                >
                  {{ sourceText(a.source) }}
                </el-tag>
              </el-tooltip>
              <span class="pv-adv-msg">{{ a.message }}</span>
            </template>
            <div class="pv-adv-body">
              <div><span class="pv-adv-k">{{ t('performance.evidence') }}</span>{{ a.evidence }}</div>
              <div>
                <span class="pv-adv-k">{{ t('performance.suggestion') }}</span>
                <el-tag size="small" effect="plain">{{ actionText(a.action) }}</el-tag>
                {{ a.actionDetail }}
              </div>
            </div>
          </el-collapse-item>
        </el-collapse>
      </div>
    </el-drawer>

    <OptimizeWizard
      v-model:open="wizardOpen"
      :profile="store.detail"
      :roots="roots"
      @applied="store.load()"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowDown, Refresh } from '@element-plus/icons-vue'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import { usePerformanceStore } from '../../stores/performance'
import { useProjectStore } from '../../stores/project'
import { runtimeRoots } from './optimizePlan'
import OptimizeWizard from './OptimizeWizard.vue'
import type {
  AdviceSource,
  LeaderboardEntry,
  ProfileKey,
  ProfileSeverity,
  ScoreOrderKey
} from '../../../../shared/schemas/performance/profile'
import { profileKeyText } from '../../../../shared/schemas/performance/profile'
import { t } from '../../i18n'

const store = usePerformanceStore()
const { detail } = storeToRefs(store)
const project = useProjectStore()
const wizardOpen = ref(false)
const roots = computed(() =>
  runtimeRoots(project.currentProject ? project.currentProject.path : '')
)

const ctx = computed(() => {
  const p = project.currentProject
  return {
    loader: p ? p.loader : '',
    mcVersion: p ? p.mcVersion : ''
  }
})

/** 半自动：一键分析 run/mods 全部 jar 入榜 */
async function analyzeMods(): Promise<void> {
  if (!ctx.value.loader || !ctx.value.mcVersion) {
    ElMessage.warning(t('performance.msg.needContext'))
    return
  }
  const result = await window.api.profile.analyzeDirectory({
    dir: roots.value.modsRoot,
    loader: ctx.value.loader,
    mcVersion: ctx.value.mcVersion
  })
  await store.load()
  if (result.succeeded > 0) {
    ElMessage.success(t('performance.msg.analyzed', { ok: result.succeeded, total: result.total }))
  } else {
    ElMessage.warning(t('performance.msg.nothingAnalyzed'))
  }
}

/** 人工：文件选择 → 按类型导入 */
async function manualImport(kind: 'jar' | 'jfr' | 'spark'): Promise<void> {
  if (kind === 'jar') {
    const jarPath = await window.api.dialog.selectFile({
      title: t('performance.msg.jarTitle'),
      extensions: ['jar']
    })
    if (!jarPath) return
    if (!ctx.value.loader || !ctx.value.mcVersion) {
      ElMessage.warning(t('performance.msg.needContextShort'))
      return
    }
    const r = await window.api.profile.importJar({
      jarPath,
      loader: ctx.value.loader,
      mcVersion: ctx.value.mcVersion
    })
    await store.load()
    if (r.ok) {
      ElMessage.success(t('performance.msg.jarAdded', { name: r.modId ?? r.fileName }))
    } else {
      ElMessage.error(r.error ?? t('performance.msg.jarFailed'))
    }
    return
  }

  if (kind === 'jfr') {
    const jfrPath = await window.api.dialog.selectFile({
      title: t('performance.msg.jfrTitle'),
      extensions: ['jfr']
    })
    if (!jfrPath) return
    const r = await window.api.profile.importJfr({
      jfrPath,
      loader: ctx.value.loader || undefined,
      mcVersion: ctx.value.mcVersion || undefined
    })
    await store.load()
    if (r.ok) {
      ElMessage.success(t('performance.msg.jfrAttributed', { n: r.profilesUpdated }))
    } else {
      ElMessage.error(r.error ?? t('performance.msg.jfrFailed'))
    }
    return
  }

  const filePath = await window.api.dialog.selectFile({
    title: t('performance.msg.sparkTitle'),
    extensions: ['txt', 'json', 'log']
  })
  if (!filePath) return
  const r = await window.api.profile.importSpark({
    filePath,
    loader: ctx.value.loader || undefined,
    mcVersion: ctx.value.mcVersion || undefined
  })
  await store.load()
  if (r.ok) {
    ElMessage.success(t('performance.msg.sparkAttributed', { n: r.profilesUpdated }))
  } else {
    ElMessage.error(r.error ?? t('performance.msg.sparkFailed'))
  }
}

/** 评级文案 */
function severityText(s: ProfileSeverity): string {
  return t(`performance.severity.${s}`)
}

/** 排序维度全称 / 简称 */
function orderLabel(key: ScoreOrderKey): string {
  return t(`performance.order.${key}`)
}
function orderShort(key: ScoreOrderKey): string {
  return t(`performance.orderShort.${key}`)
}

/** 结论来源标签：文案 / 颜色 / 含义说明 */
function sourceText(s: AdviceSource): string {
  return t(`performance.source.${s}`)
}
const SOURCE_TAG_TYPE: Record<AdviceSource, 'info' | 'success' | 'warning'> = {
  static: 'info',
  runtime: 'success',
  heuristic: 'warning'
}
function sourceTip(s: AdviceSource): string {
  return t(`performance.sourceTip.${s}`)
}

const ORDER_COLUMNS: ScoreOrderKey[] = [
  'overall',
  'cpuEfficiency',
  'memoryEfficiency',
  'tickImpact',
  'compatibility'
]

type FiveDimRow = { label: string; value: number }
const fiveDimRows = computed<FiveDimRow[]>(() => {
  if (!detail.value) return []
  const s = detail.value.score.scores
  return ORDER_COLUMNS.map((key) => ({ label: orderLabel(key), value: s[key] }))
})

function scoreTone(v: number): 'good' | 'warn' | 'bad' {
  if (v >= 80) return 'good'
  if (v >= 50) return 'warn'
  return 'bad'
}

function keyText(k: ProfileKey): string {
  return profileKeyText(k)
}

function actionText(a: string): string {
  const known = ['disable', 'remove', 'config', 'manual']
  return known.includes(a) ? t(`performance.action.${a}`) : a
}

onMounted(() => {
  if (store.entries.length === 0) void store.load()
})
</script>

<style scoped>
.perf-view {
  /* 根元素必须自成滚动区：内容超高时在视图内滚动（外层 ContentArea overflow:hidden 会裁掉） */
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 20px 24px 40px;
  color: var(--ky-text);
  display: flex;
  flex-direction: column;
  gap: var(--ky-gap-card);
}
.pv-header h2 {
  margin: 0 0 4px;
  font-size: 20px;
}
.pv-header p {
  margin: 0;
  color: var(--ky-text-sub);
  font-size: 13px;
}
.pv-card {
  background: var(--ky-bg-panel);
  border: 1px solid var(--ky-border);
  border-radius: var(--ky-radius-panel);
  padding: 14px 16px;
}
.pv-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.pv-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pv-select {
  width: 120px;
}
.pv-select-sev {
  width: 110px;
}
.pv-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pv-caret {
  margin-left: 4px;
  font-size: 12px;
}
.pv-order {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.pv-order-label {
  color: var(--ky-text-dim);
  font-size: 12px;
}
.pv-order-chip {
  background: transparent;
  border: 1px solid var(--ky-border);
  color: var(--ky-text-sub);
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 12px;
  cursor: pointer;
}
.pv-order-chip:hover {
  border-color: var(--ky-border-strong);
  color: var(--ky-text);
}
.pv-order-chip.active {
  background: var(--ky-accent);
  border-color: var(--ky-accent);
  color: #11111b;
  font-weight: 600;
}
.pv-modname {
  font-weight: 600;
}
.pv-modid {
  font-family: var(--ky-font-mono);
  font-size: 11px;
  color: var(--ky-text-dim);
}
.pv-sev {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
}
.pv-sev.good {
  color: var(--ky-accent);
  background: rgba(var(--ky-accent-rgb), 0.12);
}
.pv-sev.warn {
  color: var(--ky-yellow);
  background: rgba(251, 191, 36, 0.12);
}
.pv-sev.bad {
  color: var(--ky-red);
  background: rgba(248, 113, 113, 0.14);
}
.pv-score {
  font-family: var(--ky-font-mono);
  font-weight: 600;
}
.pv-score.good {
  color: var(--ky-accent);
}
.pv-score.warn {
  color: var(--ky-yellow);
}
.pv-score.bad {
  color: var(--ky-red);
}
.pv-advice-count {
  font-family: var(--ky-font-mono);
  color: var(--ky-yellow);
}
.pv-table :deep(.el-table__row) {
  cursor: pointer;
}
.pv-compare-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pv-compare-head h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.pv-cmp-row {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
}
.pv-cmp-label {
  width: 72px;
  color: var(--ky-text-sub);
  font-size: 12px;
  flex-shrink: 0;
}
.pv-cmp-bars {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.pv-cmp-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pv-cmp-track {
  flex: 1;
  height: 8px;
  background: var(--ky-bg-hover);
  border-radius: 4px;
  overflow: hidden;
  max-width: 320px;
}
.pv-cmp-fill {
  height: 100%;
}
.pv-cmp-fill.good {
  background: var(--ky-accent);
}
.pv-cmp-fill.warn {
  background: var(--ky-yellow);
}
.pv-cmp-fill.bad {
  background: var(--ky-red);
}
.pv-cmp-name {
  font-size: 12px;
  color: var(--ky-text-sub);
  width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pv-cmp-val {
  font-family: var(--ky-font-mono);
  font-size: 12px;
  width: 30px;
}
.pv-detail {
  padding: 0 20px 20px;
}
.pv-d-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pv-d-title h3 {
  margin: 0;
}
.pv-opt-btn {
  margin-left: auto;
}
.pv-d-meta {
  color: var(--ky-text-dim);
  font-family: var(--ky-font-mono);
  font-size: 12px;
  margin: 6px 0 14px;
}
.pv-d-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.pv-stat {
  background: var(--ky-bg-hover);
  border-radius: var(--ky-radius-control);
  padding: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.pv-stat b {
  font-size: 18px;
  font-family: var(--ky-font-mono);
}
.pv-stat span {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.pv-d-scores {
  margin-bottom: 14px;
}
.pv-d-h {
  margin: 16px 0 8px;
  font-size: 14px;
}
.pv-adv-sev {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  width: 56px;
}
.pv-adv-sev.low {
  color: var(--ky-blue);
}
.pv-adv-sev.medium {
  color: var(--ky-yellow);
}
.pv-adv-sev.high {
  color: var(--ky-red);
}
.pv-adv-sev.critical {
  color: var(--ky-red);
  background: rgba(248, 113, 113, 0.18);
  border-radius: 4px;
}
.pv-adv-rule {
  font-family: var(--ky-font-mono);
  font-size: 11px;
  color: var(--ky-text-dim);
  width: 44px;
}
.pv-adv-source {
  flex-shrink: 0;
}
.pv-adv-msg {
  font-size: 13px;
}
.pv-adv-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--ky-text-sub);
  padding-left: 100px;
}
.pv-adv-k {
  color: var(--ky-text-dim);
}
</style>
