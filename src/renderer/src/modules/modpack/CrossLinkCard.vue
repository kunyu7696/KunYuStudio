<template>
  <section class="cl-card">
    <div class="cl-card-title">
      {{ t('modpack.crossLinkTitle') }}
      <span v-if="report?.ok && report.generatedAt" class="cl-count">
        {{ t('modpack.crossLinkGeneratedAt', { time: fmtTime(report.generatedAt) }) }}
      </span>
      <span v-if="report?.ok" class="cl-stats">
        <span class="cl-tag tone-mr">
          {{ t('modpack.crossLinkStatMatched', { m: report.matchedCount, n: report.items.length }) }}
        </span>
        <span v-if="report.updateCount > 0" class="cl-tag tone-warn">
          {{ t('modpack.crossLinkStatUpdate', { n: report.updateCount }) }}
        </span>
        <span v-if="report.duplicates.length > 0" class="cl-tag tone-err">
          {{ t('modpack.crossLinkStatDup', { n: report.duplicates.length }) }}
        </span>
        <span v-if="report.missingDeps.length > 0" class="cl-tag tone-err">
          {{ t('modpack.crossLinkStatMissing', { n: report.missingDeps.length }) }}
        </span>
      </span>
      <el-button
        size="small"
        class="cl-run"
        :loading="store.crossLinkLoading"
        :disabled="!projectPath"
        @click="run"
      >
        {{ report ? t('modpack.crossLinkRefresh') : t('modpack.crossLinkRun') }}
      </el-button>
    </div>

    <div v-if="!report && !store.crossLinkLoading" class="cl-note">
      {{ t('modpack.crossLinkHint') }}
    </div>
    <div v-if="report && !report.ok" class="cl-note cl-err">{{ report.error }}</div>

    <template v-if="report?.ok">
      <div v-if="report.cfUnavailable" class="cl-note cl-warn-text">
        {{ t('modpack.crossLinkCfUnavailable') }}
      </div>
      <div v-if="report.items.length === 0" class="cl-note">{{ t('modpack.crossLinkNone') }}</div>

      <template v-else>
        <!-- 可更新 / 对侧超前 -->
        <ul v-if="updateRows.length > 0" class="cl-list">
          <li v-for="it in updateRows" :key="it.fileName">
            <span class="cl-file">{{ it.name }}</span>
            <span class="cl-ver">
              {{ it.versionNumber }} → {{ it.latest?.versionNumber ?? '—' }}
            </span>
            <span class="cl-tag" :class="platformTone(it.platform)">
              {{ platformText(it.platform) }}
            </span>
            <template v-if="it.counterpart">
              <span class="cl-sub">⇄</span>
              <span class="cl-tag" :class="platformTone(it.counterpart.platform)">
                {{ it.counterpart.name }}
              </span>
              <span v-if="it.counterpartAhead" class="cl-tag tone-warn">
                {{ t('modpack.crossLinkAheadTag') }}
              </span>
            </template>
          </li>
        </ul>
        <div v-else class="cl-note">{{ t('modpack.crossLinkUpToDate') }}</div>

        <!-- 跨平台重复安装 -->
        <template v-if="report.duplicates.length > 0">
          <div class="cl-sub-title">{{ t('modpack.crossLinkDupTitle') }}</div>
          <ul class="cl-list">
            <li v-for="d in report.duplicates" :key="d.cfFileName + d.mrFileName">
              <span class="cl-warn-text">
                {{ t('modpack.crossLinkDupRow', { name: d.name, cfFile: d.cfFileName, mrFile: d.mrFileName }) }}
              </span>
            </li>
          </ul>
        </template>

        <!-- 缺失前置 -->
        <template v-if="report.missingDeps.length > 0">
          <div class="cl-sub-title">{{ t('modpack.crossLinkMissingTitle') }}</div>
          <ul class="cl-list">
            <li v-for="m in report.missingDeps" :key="m.depPlatform + ':' + m.depModId">
              <span class="cl-warn-text">
                {{ t('modpack.crossLinkMissingRow', { name: m.name, platform: platformText(m.depPlatform), depId: m.depModId }) }}
              </span>
            </li>
          </ul>
        </template>

        <!-- 映射明细（折叠） -->
        <details v-if="mappedRows.length > 0" class="cl-details">
          <summary>{{ t('modpack.crossLinkMappingTitle', { n: mappedRows.length }) }}</summary>
          <ul class="cl-list">
            <li v-for="row in mappedRows" :key="row.item.fileName">
              <span class="cl-file">{{ row.item.name }}</span>
              <span class="cl-tag" :class="platformTone(row.item.platform)">
                {{ platformText(row.item.platform) }}
              </span>
              <span class="cl-sub">⇄</span>
              <span class="cl-sub">{{ row.cp.name }}</span>
              <span class="cl-tag" :class="platformTone(row.cp.platform)">
                {{ platformText(row.cp.platform) }}
              </span>
            </li>
          </ul>
        </details>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useModpackStore } from '../../stores/modpack'
import { useProjectStore } from '../../stores/project'
import { t } from '../../i18n'
import type { ModPlatform } from '../../../../shared/types/market'

const store = useModpackStore()
const projectStore = useProjectStore()

const report = computed(() => store.crossLink)
const projectPath = computed(() => projectStore.currentProject?.path ?? '')

/** 需要用户关注的条目：本侧可更新或对侧更新超前 */
const updateRows = computed(() => {
  const r = report.value
  if (!r?.ok) return []
  return r.items.filter((i) => i.updateAvailable || i.counterpartAhead)
})

/** 成功映射到对侧的条目（映射明细折叠列表；预收窄 counterpart 非空） */
const mappedRows = computed(() => {
  const r = report.value
  if (!r?.ok) return []
  return r.items.flatMap((item) => (item.counterpart ? [{ item, cp: item.counterpart }] : []))
})

function platformText(p: ModPlatform): string {
  return t(`modpack.platform.${p}`)
}

function platformTone(p: ModPlatform): string {
  return p === 'curseforge' ? 'tone-cf' : 'tone-mr'
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(+d) ? iso : d.toLocaleString()
}

function run(): void {
  if (!projectPath.value) return
  void store.refreshCrossLink(projectPath.value)
}
</script>

<style scoped>
.cl-card {
  background: var(--ky-bg-panel);
  border: 1px solid var(--ky-border);
  border-radius: var(--ky-radius-panel);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cl-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
  flex-wrap: wrap;
}
.cl-count {
  font-size: 11px;
  font-weight: 400;
  color: var(--ky-text-dim);
}
.cl-stats {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.cl-run {
  margin-left: auto;
}
.cl-tag {
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
.tone-warn {
  color: var(--ky-yellow);
  background: rgba(249, 226, 175, 0.14);
}
.tone-err {
  color: var(--ky-red);
  background: rgba(243, 139, 168, 0.14);
}
.cl-note {
  font-size: 12px;
  color: var(--ky-text-sub);
  line-height: 1.6;
}
.cl-err {
  color: var(--ky-red);
}
.cl-warn-text {
  font-size: 12px;
  color: var(--ky-yellow);
  line-height: 1.6;
  word-break: break-all;
}
.cl-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cl-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cl-file {
  font-size: 12.5px;
  color: var(--ky-text);
  word-break: break-all;
}
.cl-ver {
  font-family: var(--ky-font-mono);
  font-size: 11.5px;
  color: var(--ky-yellow);
}
.cl-sub {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.cl-sub-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-text-sub);
}
.cl-details summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--ky-text-sub);
  user-select: none;
}
.cl-details[open] summary {
  margin-bottom: 8px;
}
</style>
