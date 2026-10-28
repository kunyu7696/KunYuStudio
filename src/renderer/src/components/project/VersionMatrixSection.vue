<template>
  <el-collapse v-model="active" class="vms-collapse">
    <el-collapse-item name="matrix">
      <template #title>
        <span class="vms-title">{{ t('matrix.title') }}</span>
      </template>

      <div class="vms-body">
        <!-- 图例 -->
        <div class="vms-legend">
          <span v-for="item in legendItems" :key="item.key" class="vms-legend-item">
            <span class="vms-dot" :class="`is-${item.key}`" />
            {{ item.label }}
          </span>
        </div>

        <!-- 全部组合按加载器分组（M13：储备组合也可选中用于创建项目） -->
        <div v-for="group in displayGroups" :key="group.loader" class="vms-group">
          <p class="vms-group-title">{{ group.label }}</p>
          <div class="vms-grid">
            <el-tooltip
              v-for="cell in group.cells"
              :key="cell.id"
              :disabled="cell.active && !isDeprecated(cell) && !isLegacy(cell) && !isBeta(cell)"
              :content="tooltipOf(cell)"
              placement="top"
            >
              <button
                type="button"
                class="vms-cell"
                :class="{
                  'is-selected': isSelected(cell),
                  'is-deprecated': isDeprecated(cell),
                  'is-legacy': isLegacy(cell),
                  'is-beta': isBeta(cell)
                }"
                @click="onCellClick(cell)"
              >
                <span class="vms-cell-top">
                  <span class="vms-dot" :class="`is-${cell.health}`" />
                  <span class="vms-mc">{{ cell.mcVersion }}</span>
                  <span v-if="isDeprecated(cell)" class="vms-badge is-deprecated">{{ t('matrix.deprecated') }}</span>
                  <span v-else-if="isBeta(cell)" class="vms-badge is-beta">Beta</span>
                  <span v-else-if="isLegacy(cell)" class="vms-badge is-legacy">{{ t('matrix.legacy') }}</span>
                </span>
                <span v-if="isPackMode" class="vms-loader">{{ tierLabel(cell) }}</span>
                <span v-else class="vms-loader">{{ cell.loaderVersion }}</span>
                <span class="vms-cell-meta">
                  <template v-if="isBeta(cell)">{{ t('matrix.betaMeta') }}</template>
                  <template v-else-if="isPackMode && cell.id.startsWith('pack-')">{{ t('matrix.unregistered') }}</template>
                  <template v-else-if="cell.active">{{ t('matrix.activeMeta', { n: cell.templateCount }) }}</template>
                  <template v-else>{{ t('matrix.reserveMeta', { n: cell.templateCount }) }}</template>
                </span>
              </button>
            </el-tooltip>
          </div>
        </div>

        <!-- 上游检查 -->
        <div class="vms-actions">
          <el-button size="small" type="primary" plain :loading="monitor.checking" @click="monitor.checkNow()">
            {{ t('matrix.checkNow') }}
          </el-button>
          <span v-if="monitor.monitor?.lastCheckAt" class="vms-last">
            {{ t('matrix.lastCheck', { time: formatTime(monitor.monitor.lastCheckAt) }) }}
          </span>
        </div>
        <p v-if="monitor.monitor?.lastCheckError" class="vms-error">
          {{ monitor.monitor.lastCheckError }}
        </p>

        <!-- 漂移事件 -->
        <div class="vms-events">
          <p class="vms-events-title">{{ t('matrix.eventsTitle') }}</p>
          <ul v-if="monitor.recentDrift.length" class="vms-event-list">
            <li v-for="ev in monitor.recentDrift" :key="ev.id" class="vms-event">
              <span class="vms-event-kind" :class="`is-${ev.kind}`">{{ kindLabel(ev.kind) }}</span>
              <span class="vms-event-text">{{ ev.message }}</span>
              <span class="vms-event-time">{{ formatTime(ev.at) }}</span>
            </li>
          </ul>
          <p v-else class="vms-events-empty">
            {{ t('matrix.eventsEmpty') }}
          </p>
        </div>
      </div>
    </el-collapse-item>
  </el-collapse>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAiMonitorStore } from '../../stores/aiMonitor'
import { t } from '../../i18n'
import type { ComboHealth, ComboMatrixCell, DriftEventKind } from '../../../../shared/types/monitor'

const props = defineProps<{
  /** 当前选中的组合 id（矩阵格高亮用；包类模式下忽略） */
  selectedCellId?: string
  /** 是否隐藏 legacy（遗产）层：新建向导中不展示，仅导入老旧项目时展示 */
  hideLegacy?: boolean
  /**
   * 包类项目模式（资源包/数据包/光影包）：传入可选 MC 版本白名单后，
   * 矩阵退化为按 MC 版本单维展示（每版取代表格，优先 Fabric ACTIVE），
   * 选中高亮改用 selectedMcVersion，点击仍经 select 抛出代表格。
   */
  packMcVersions?: string[]
  /** 包类模式下当前选中的 MC 版本（高亮用） */
  selectedMcVersion?: string
}>()

const emit = defineEmits<{
  (e: 'select', cell: ComboMatrixCell): void
  /** legacy/deprecated 组合被点击：交由父组件弹迁移引导，而非直接选中 */
  (e: 'migrate', cell: ComboMatrixCell): void
}>()

const monitor = useAiMonitorStore()
const active = ref<string[]>([])

const isPackMode = computed(() => !!props.packMcVersions?.length)

/** 包类模式：每个可选 MC 版本取一个代表格（优先 Fabric ACTIVE），缺失时给「未登记」占位格 */
const packCells = computed<ComboMatrixCell[]>(() => {
  const all = monitor.monitor?.cells ?? []
  return (props.packMcVersions ?? []).map((mc): ComboMatrixCell => {
    const matches = all.filter((c) => c.mcVersion === mc)
    const rep =
      matches.find((c) => c.loader === 'fabric' && c.active) ??
      matches.find((c) => c.loader === 'fabric') ??
      matches[0]
    if (rep) return rep
    return {
      id: `pack-${mc}`,
      loader: 'fabric',
      mcVersion: mc,
      loaderVersion: '',
      mapping: 'yarn',
      jdk: 17,
      health: 'unknown',
      driftRisk: 'low',
      active: false,
      templateCount: 0,
      verifiedAt: null,
      note: t('matrix.packNotRegistered')
    }
  })
})

/** 展示分组：包类模式单组单维；否则按加载器分组，hideLegacy 时过滤遗产层 */
const displayGroups = computed(() => {
  if (isPackMode.value) {
    const cells = props.hideLegacy ? packCells.value.filter((c) => c.tier !== 'legacy') : packCells.value
    return [{ loader: 'pack', label: t('matrix.packGroupLabel'), cells }]
  }
  return monitor.groups.map((g) => ({
    ...g,
    cells: props.hideLegacy ? g.cells.filter((c) => c.tier !== 'legacy') : g.cells
  }))
})

function isSelected(cell: ComboMatrixCell): boolean {
  return isPackMode.value ? cell.mcVersion === props.selectedMcVersion : cell.id === props.selectedCellId
}

const TIER_LABEL: Record<string, string> = { core: 'core', extended: 'extended', legacy: 'legacy' }
function tierLabel(cell: ComboMatrixCell): string {
  const key = cell.tier && TIER_LABEL[cell.tier]
  return key ? t(`matrix.tier.${key}`) : t('matrix.tier.unregistered')
}

const legendItems = computed<Array<{ key: ComboHealth; label: string }>>(() => [
  { key: 'green', label: t('matrix.legendGreen') },
  { key: 'yellow', label: t('matrix.legendYellow') },
  { key: 'red', label: t('matrix.legendRed') },
  { key: 'unknown', label: t('matrix.legendUnknown') },
  { key: 'beta', label: t('matrix.legendBeta') },
  { key: 'deprecated', label: t('matrix.legendDeprecated') }
])

function isDeprecated(cell: ComboMatrixCell): boolean {
  return cell.health === 'deprecated'
}

function isBeta(cell: ComboMatrixCell): boolean {
  return cell.health === 'beta'
}

function isLegacy(cell: ComboMatrixCell): boolean {
  return !isDeprecated(cell) && !isBeta(cell) && cell.tier === 'legacy'
}

function tooltipOf(cell: ComboMatrixCell): string {
  if (isPackMode.value && cell.id.startsWith('pack-')) {
    return cell.note || t('matrix.packNotRegistered')
  }
  if (isDeprecated(cell)) {
    // 废弃组合：优先用 manifest note（含具体原因），否则给通用迁移建议
    return cell.note || t('matrix.deprecatedTip', { id: cell.id })
  }
  if (isBeta(cell)) {
    return cell.note || t('matrix.betaTip', { mc: cell.mcVersion })
  }
  if (isLegacy(cell)) {
    return t('matrix.legacyTip', { mc: cell.mcVersion })
  }
  return t('matrix.reserveTip')
}

function onCellClick(cell: ComboMatrixCell): void {
  // legacy/deprecated 不直接选中，弹迁移引导
  if (isDeprecated(cell) || isLegacy(cell)) {
    emit('migrate', cell)
    return
  }
  // beta：禁用，不抛 select（父组件 onMatrixSelect 亦有兜底）
  if (isBeta(cell)) return
  emit('select', cell)
}

function kindLabel(kind: DriftEventKind): string {
  return t(`matrix.drift.${kind === 'loader-new' ? 'loaderNew' : kind === 'mc-new' ? 'mcNew' : kind === 'build-pass' ? 'buildPass' : 'buildFail'}`)
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<style scoped>
.vms-collapse {
  margin-top: 10px;
  border-top: 1px dashed var(--ky-border);
}

.vms-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-text-sub);
}

.vms-body {
  padding: 2px 4px 8px;
}

.vms-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 6px;
}

.vms-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  color: var(--ky-text-dim);
}

.vms-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.vms-dot.is-green {
  background: #a6e3a1;
  box-shadow: 0 0 6px rgba(166, 227, 161, 0.7);
}

.vms-dot.is-yellow {
  background: #f9e2af;
  box-shadow: 0 0 6px rgba(249, 226, 175, 0.7);
}

.vms-dot.is-red {
  background: #f38ba8;
  box-shadow: 0 0 6px rgba(243, 139, 168, 0.7);
}

.vms-dot.is-unknown {
  background: #6c7086;
}

.vms-dot.is-deprecated {
  background: #45494f;
  box-shadow: none;
}

.vms-dot.is-beta {
  background: #89b4fa;
  box-shadow: 0 0 6px rgba(137, 180, 250, 0.7);
}

.vms-badge {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 9px;
  line-height: 14px;
  font-weight: 600;
}

.vms-badge.is-deprecated {
  background: rgba(243, 139, 168, 0.18);
  color: #f38ba8;
}

.vms-badge.is-legacy {
  background: rgba(249, 226, 175, 0.18);
  color: #f9e2af;
}

.vms-badge.is-beta {
  background: rgba(137, 180, 250, 0.18);
  color: #89b4fa;
}

.vms-cell.is-deprecated {
  opacity: 0.6;
  border-style: dashed;
}

.vms-cell.is-legacy {
  border-style: dashed;
}

.vms-cell.is-beta,
.vms-cell.is-beta:hover {
  opacity: 0.55;
  border-style: dashed;
  border-color: rgba(137, 180, 250, 0.5);
  cursor: not-allowed;
}

.vms-group {
  margin-top: 6px;
}

.vms-group-title {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ky-text-sub);
}

.vms-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.vms-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid var(--ky-border);
  background: var(--ky-bg-panel);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.vms-cell:hover {
  border-color: var(--ky-accent);
}

.vms-cell.is-selected {
  border-color: var(--ky-accent);
  box-shadow: inset 0 0 0 1px var(--ky-accent);
}

.vms-cell-top {
  display: flex;
  align-items: center;
  gap: 5px;
}

.vms-mc {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ky-text);
}

.vms-loader {
  font-size: 10.5px;
  color: var(--ky-text-sub);
}

.vms-cell-meta {
  font-size: 9.5px;
  color: var(--ky-text-dim);
}

.vms-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.vms-last {
  font-size: 10.5px;
  color: var(--ky-text-dim);
}

.vms-error {
  margin: 4px 0 0;
  font-size: 10.5px;
  color: #f9e2af;
}

.vms-events {
  margin-top: 8px;
}

.vms-events-title {
  margin: 0 0 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ky-text-sub);
}

.vms-event-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 132px;
  overflow-y: auto;
}

.vms-event {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 10.5px;
}

.vms-event-kind {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 16px;
  background: rgba(147, 153, 178, 0.15);
  color: var(--ky-text-sub);
}

.vms-event-kind.is-build-pass {
  background: rgba(166, 227, 161, 0.18);
  color: #a6e3a1;
}

.vms-event-kind.is-build-fail {
  background: rgba(243, 139, 168, 0.18);
  color: #f38ba8;
}

.vms-event-kind.is-loader-new,
.vms-event-kind.is-mc-new {
  background: rgba(249, 226, 175, 0.18);
  color: #f9e2af;
}

.vms-event-text {
  flex: 1;
  color: var(--ky-text-sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vms-event-time {
  color: var(--ky-text-dim);
  flex-shrink: 0;
}

.vms-events-empty {
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  line-height: 1.6;
}
</style>
