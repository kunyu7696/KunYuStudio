<template>
  <section class="dep-card">
    <div class="dep-card-title">
      {{ t('modpack.depGraphTitle') }}
      <span class="dep-count">
        {{ t('modpack.depGraphCount', { m: displayCount, n: graph.edges.length }) }}
      </span>
      <span class="dep-stats">
        <span v-if="stats.missingRequired > 0" class="dep-tag tone-err">
          {{ t('modpack.depGraphStatReq', { n: stats.missingRequired }) }}
        </span>
        <span v-if="stats.conflict > 0" class="dep-tag tone-err">
          {{ t('modpack.depGraphStatConflict', { n: stats.conflict }) }}
        </span>
        <span v-if="stats.missingOptional > 0" class="dep-tag tone-warn">
          {{ t('modpack.depGraphStatOpt', { n: stats.missingOptional }) }}
        </span>
      </span>
    </div>

    <div v-if="graph.edges.length === 0" class="dep-note">{{ t('modpack.depGraphEmpty') }}</div>

    <template v-else>
      <svg class="dep-svg" viewBox="0 0 900 460" role="img">
        <path
          v-for="e in laidEdges"
          :key="e.key"
          :d="e.d"
          fill="none"
          class="dep-edge"
          :class="[e.cls, edgeHl(e)]"
        />
        <g
          v-for="n in laidNodes"
          :key="n.id"
          class="dep-node"
          :class="nodeHl(n.id)"
          @mouseenter="hoverId = n.id"
          @mouseleave="hoverId = ''"
        >
          <circle :cx="n.x" :cy="n.y" :r="n.ghost ? 5 : 6" class="dep-dot" :class="n.colorCls" />
          <text :x="n.lx" :y="n.ly" :text-anchor="n.anchor" class="dep-label">{{ n.label }}</text>
          <title>{{ n.tip }}</title>
        </g>
      </svg>

      <div class="dep-legend">
        <span class="dep-legend-item"><i class="dep-line satisfied" />{{ t('modpack.depGraphLegendSatisfied') }}</span>
        <span class="dep-legend-item"><i class="dep-line miss-req" />{{ t('modpack.depGraphLegendMissingReq') }}</span>
        <span class="dep-legend-item"><i class="dep-line miss-opt" />{{ t('modpack.depGraphLegendMissingOpt') }}</span>
        <span class="dep-legend-item"><i class="dep-line conflict" />{{ t('modpack.depGraphLegendConflict') }}</span>
        <span class="dep-legend-item"><i class="dep-sample tone-cf" />CurseForge</span>
        <span class="dep-legend-item"><i class="dep-sample tone-mr" />Modrinth</span>
        <span class="dep-legend-item"><i class="dep-sample tone-local" />{{ t('modpack.platform.local') }}</span>
        <span class="dep-legend-item"><i class="dep-sample ghost" />{{ t('modpack.depGraphGhost') }}</span>
      </div>

      <div v-if="isolatedCount > 0" class="dep-sub">
        {{ t('modpack.depGraphIsolated', { n: isolatedCount }) }}
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '../../i18n'
import type {
  DependencyGraph,
  DepGraphEdge,
  ModSourcePlatform
} from '../../../../shared/types/modpack'

const props = defineProps<{ graph: DependencyGraph }>()

const hoverId = ref('')

// 椭圆环布局（纯计算、确定性，不引物理引擎）：参与依赖的节点排在环上，边为过中心的二次曲线弦
const CX = 450
const CY = 230
const RX = 265
const RY = 160

/** 参与至少一条边的节点 id 集合（孤立 jar 不进图，计数提示） */
const activeIds = computed(() => {
  const s = new Set<string>()
  for (const e of props.graph.edges) {
    s.add(e.from)
    s.add(e.to)
  }
  return s
})

const displayCount = computed(() => activeIds.value.size)

/** 无依赖声明的在场 jar 数（虚影节点必在图中，不计入） */
const isolatedCount = computed(
  () => props.graph.nodes.filter((n) => !n.ghost && !activeIds.value.has(n.id)).length
)

const stats = computed(() => {
  let missingRequired = 0
  let missingOptional = 0
  let conflict = 0
  for (const e of props.graph.edges) {
    if (e.state === 'conflict') conflict++
    else if (e.state === 'missing' && e.kind === 'required') missingRequired++
    else if (e.state === 'missing') missingOptional++
  }
  return { missingRequired, missingOptional, conflict }
})

function platformCls(p: ModSourcePlatform | null): string {
  if (p === 'curseforge') return 'tone-cf'
  if (p === 'modrinth') return 'tone-mr'
  return 'tone-local'
}

interface LaidNode {
  id: string
  x: number
  y: number
  lx: number
  ly: number
  anchor: 'start' | 'end'
  label: string
  tip: string
  ghost: boolean
  colorCls: string
}

const laidNodes = computed<LaidNode[]>(() => {
  const nodes = props.graph.nodes.filter((n) => activeIds.value.has(n.id))
  // 虚影节点按最严重入边着色：有缺必需 → 红，否则黄
  const ghostSev = new Map<string, 'req' | 'opt'>()
  for (const e of props.graph.edges) {
    if (e.state !== 'missing') continue
    if (e.kind === 'required') ghostSev.set(e.to, 'req')
    else if (!ghostSev.has(e.to)) ghostSev.set(e.to, 'opt')
  }
  return nodes.map((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    return {
      id: n.id,
      x: CX + RX * cos,
      y: CY + RY * sin,
      lx: CX + (RX + 14) * cos,
      ly: CY + (RY + 14) * sin + 3,
      anchor: cos >= 0 ? 'start' : 'end',
      label: n.name.length > 16 ? n.name.slice(0, 15) + '…' : n.name,
      tip: n.ghost ? `${n.name}（${t('modpack.depGraphGhost')}）` : `${n.name} · ${n.fileName ?? ''}`,
      ghost: n.ghost,
      colorCls: n.ghost ? (ghostSev.get(n.id) === 'req' ? 'ghost-req' : 'ghost-opt') : platformCls(n.platform)
    }
  })
})

function edgeCls(e: DepGraphEdge): string {
  if (e.state === 'conflict') return 'is-conflict'
  if (e.state === 'missing') return e.kind === 'required' ? 'is-miss-req' : 'is-miss-opt'
  return 'is-satisfied'
}

const laidEdges = computed(() => {
  const pos = new Map(laidNodes.value.map((n) => [n.id, { x: n.x, y: n.y }]))
  const out: Array<{ key: string; d: string; cls: string; from: string; to: string }> = []
  props.graph.edges.forEach((e, i) => {
    const p1 = pos.get(e.from)
    const p2 = pos.get(e.to)
    if (!p1 || !p2) return
    out.push({
      key: `${e.from}->${e.to}#${i}`,
      d: `M ${p1.x} ${p1.y} Q ${CX} ${CY} ${p2.x} ${p2.y}`,
      cls: edgeCls(e),
      from: e.from,
      to: e.to
    })
  })
  return out
})

/** 悬停节点时：相关边/节点高亮，其余淡出 */
const hoverNeighbors = computed(() => {
  if (!hoverId.value) return null
  const s = new Set<string>([hoverId.value])
  for (const e of props.graph.edges) {
    if (e.from === hoverId.value) s.add(e.to)
    if (e.to === hoverId.value) s.add(e.from)
  }
  return s
})

function edgeHl(e: { from: string; to: string }): string {
  if (!hoverNeighbors.value) return ''
  return e.from === hoverId.value || e.to === hoverId.value ? 'hl' : 'dim'
}

function nodeHl(id: string): string {
  if (!hoverNeighbors.value) return ''
  return hoverNeighbors.value.has(id) ? 'hl' : 'dim'
}
</script>

<style scoped>
.dep-card {
  background: var(--ky-bg-panel);
  border: 1px solid var(--ky-border);
  border-radius: var(--ky-radius-panel);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dep-card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
  flex-wrap: wrap;
}
.dep-count {
  font-size: 11px;
  font-weight: 400;
  color: var(--ky-text-dim);
}
.dep-stats {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.dep-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  white-space: nowrap;
}
.tone-err {
  color: var(--ky-red);
  background: rgba(243, 139, 168, 0.14);
}
.tone-warn {
  color: var(--ky-yellow);
  background: rgba(249, 226, 175, 0.14);
}
.dep-note {
  font-size: 12px;
  color: var(--ky-text-sub);
  line-height: 1.6;
}
.dep-sub {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.dep-svg {
  width: 100%;
  height: auto;
  display: block;
}
.dep-edge {
  stroke: var(--ky-text-dim);
  stroke-width: 1;
  opacity: 0.35;
  transition: opacity 0.12s ease;
}
.dep-edge.is-miss-req {
  stroke: var(--ky-red);
  stroke-dasharray: 4 3;
  opacity: 0.8;
}
.dep-edge.is-miss-opt {
  stroke: var(--ky-yellow);
  stroke-dasharray: 4 3;
  opacity: 0.8;
}
.dep-edge.is-conflict {
  stroke: var(--ky-red);
  stroke-width: 2;
  opacity: 0.9;
}
.dep-edge.dim {
  opacity: 0.06;
}
.dep-edge.hl {
  opacity: 1;
}
.dep-edge.is-satisfied.hl {
  stroke: var(--ky-text);
}
.dep-node {
  cursor: default;
  transition: opacity 0.12s ease;
}
.dep-node.dim {
  opacity: 0.15;
}
.dep-dot.tone-cf {
  fill: #f59e0b;
}
.dep-dot.tone-mr {
  fill: var(--ky-accent);
}
.dep-dot.tone-local {
  fill: var(--ky-blue);
}
.dep-dot.ghost-req {
  fill: transparent;
  stroke: var(--ky-red);
  stroke-width: 1.5;
  stroke-dasharray: 2 2;
}
.dep-dot.ghost-opt {
  fill: transparent;
  stroke: var(--ky-yellow);
  stroke-width: 1.5;
  stroke-dasharray: 2 2;
}
.dep-label {
  font-size: 10.5px;
  fill: var(--ky-text-sub);
}
.dep-legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--ky-text-dim);
}
.dep-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.dep-line {
  display: inline-block;
  width: 18px;
  height: 0;
  border-top: 2px solid var(--ky-text-dim);
  opacity: 0.6;
}
.dep-line.miss-req {
  border-top: 2px dashed var(--ky-red);
  opacity: 1;
}
.dep-line.miss-opt {
  border-top: 2px dashed var(--ky-yellow);
  opacity: 1;
}
.dep-line.conflict {
  border-top: 3px solid var(--ky-red);
  opacity: 1;
}
.dep-sample {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dep-sample.tone-cf {
  background: #f59e0b;
}
.dep-sample.tone-mr {
  background: var(--ky-accent);
}
.dep-sample.tone-local {
  background: var(--ky-blue);
}
.dep-sample.ghost {
  background: transparent;
  border: 1.5px dashed var(--ky-red);
}
</style>
