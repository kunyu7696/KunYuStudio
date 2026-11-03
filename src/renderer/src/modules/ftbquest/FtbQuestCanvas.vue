<!--
  FTB Quests 拖拽连线画布。
  只读 props.chapter.quests 作为数据源；对 quest.x/y / quest.dependencies 的改动
  通过 emit('dirty') 通知父组件（FtbQuestView）设脏；父组件负责保存。
  节点坐标用 chapter.quests[i].x / .y 绝对定位；画布虚拟尺寸 2400×1600 可滚动。
-->
<template>
  <div
    ref="canvasEl"
    class="fq-canvas"
    @mousemove="onGlobalMouseMove"
    @mouseup="onGlobalMouseUp"
    @mouseleave="onGlobalMouseUp"
  >
    <!-- 背景网格 -->
    <svg class="fq-canvas-grid" :viewBox="`0 0 ${VIRTUAL_W} ${VIRTUAL_H}`">
      <defs>
        <pattern id="fq-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2a2d36" stroke-width="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#fq-grid)" />
    </svg>

    <!-- 连线层（在节点下面） -->
    <svg class="fq-canvas-lines" :viewBox="`0 0 ${VIRTUAL_W} ${VIRTUAL_H}`">
      <defs>
        <marker id="fq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#4ade80" />
        </marker>
      </defs>
      <!-- 已存在的连线 -->
      <g v-for="ln in links" :key="`${ln.from}→${ln.to}`">
        <path
          :d="ln.path"
          fill="none"
          stroke="#4ade80"
          stroke-width="2"
          :marker-end="'url(#fq-arrow)'"
          class="fq-line"
          @click="onDeleteLink(ln.from, ln.to)"
        />
        <!-- 可点击删除的中点圆点 -->
        <circle :cx="ln.midX" :cy="ln.midY" r="5" fill="#4ade80" class="fq-line-del" @click="onDeleteLink(ln.from, ln.to)" />
      </g>
      <!-- 正在拖的连线（实时反馈） -->
      <path
        v-if="pendingLink"
        :d="pendingLink.path"
        fill="none"
        stroke="#60a5fa"
        stroke-width="2"
        stroke-dasharray="6 4"
      />
    </svg>

    <!-- 节点层 -->
    <div
      v-for="q in quests"
      :key="q.id"
      class="fq-node"
      :class="{ 'fq-node-active': activeId === q.id, 'fq-node-has-reward': q.reward }"
      :style="nodeStyle(q)"
      @mousedown.stop="onNodeMouseDown($event, q)"
      @mouseenter="onNodeEnter(q)"
      @mouseleave="onNodeLeave"
    >
      <!-- 输出锚点（右侧，拖这里创建连线） -->
      <div
        class="fq-anchor fq-anchor-out"
        :data-id="q.id"
        @mousedown.stop="onAnchorOutMouseDown($event, q)"
      />
      <!-- 输入锚点（左侧，只作为连线终点） -->
      <div class="fq-anchor fq-anchor-in" />

      <div class="fq-node-title">{{ q.title }}</div>
      <div class="fq-node-item">{{ q.item }}</div>
      <div v-if="q.reward" class="fq-node-reward">奖励：{{ q.reward.item }} ×{{ q.reward.count }}</div>

      <!-- 依赖徽章 -->
      <div v-if="q.dependencies.length > 0" class="fq-node-deps">
        {{ q.dependencies.length }} 依赖
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="quests.length === 0" class="fq-canvas-empty">
      <p>还没有任务。用左栏的「新建任务」添加第一个节点。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { FtbQuest } from '../../../../shared/types/ftbquest'
import { FTB_QUEST_NODE_W, FTB_QUEST_NODE_H } from '../../../../shared/types/ftbquest'

const props = defineProps<{
  quests: FtbQuest[]
}>()

const emit = defineEmits<{
  (e: 'dirty'): void
}>()

const VIRTUAL_W = 2400
const VIRTUAL_H = 1600
const NODE_W = FTB_QUEST_NODE_W
const NODE_H = FTB_QUEST_NODE_H
const ANCHOR_R = 8
const ANCHOR_OFFSET = ANCHOR_R + 2 // 锚点圆心离节点边缘的距离

// 画布 DOM 引用
const canvasEl = ref<HTMLDivElement | null>(null)

// ---- 拖拽状态 ----
const dragging = reactive({
  /** 正在拖的 quest id（节点 body 拖拽） */
  questId: '' as string,
  /** 鼠标按下时相对节点左上角的偏移 */
  offsetX: 0,
  offsetY: 0
})
// ---- 连线状态 ----
const linking = reactive({
  /** 连线起点 quest id（从输出锚点拖出） */
  fromId: '' as string,
  /** 鼠标当前相对画布坐标（用于实时连线预览） */
  mouseX: 0,
  mouseY: 0
})
const hoverQuestId = ref('')
const activeId = ref('') // 当前高亮（鼠标进入或正在连线悬停到的节点）

/** 初始化/对齐坐标：任何 quest 缺失 x/y 或值为 0 时，按网格自动铺 */
function ensureCoords(): void {
  const quests = props.quests
  if (quests.length === 0) return
  const NEEDS_INIT = !quests.some((q) => typeof q.x === 'number' && typeof q.y === 'number' && (q.x > 0 || q.y > 0))
  if (!NEEDS_INIT) return
  const COLS = 4
  const COL_GAP = 260
  const ROW_GAP = 160
  const START_X = 60
  const START_Y = 60
  quests.forEach((q, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    q.x = START_X + col * COL_GAP
    q.y = START_Y + row * ROW_GAP
  })
  emit('dirty')
}

// watch quests 变化时补齐坐标（保存后重载章节也会触发）
watch(
  () => props.quests.length,
  () => {
    // 延迟一帧，等 quests 数组同步
    setTimeout(ensureCoords, 0)
  },
  { immediate: true }
)

/** 节点内联样式（定位） */
function nodeStyle(q: FtbQuest): Record<string, string> {
  return {
    position: 'absolute',
    left: `${q.x ?? 0}px`,
    top: `${q.y ?? 0}px`,
    width: `${NODE_W}px`,
    height: `${NODE_H}px`
  }
}

/** 连线数据：从依赖数组派生出 source → target */
const links = computed(() => {
  const list: Array<{
    from: string
    to: string
    x1: number
    y1: number
    x2: number
    y2: number
    path: string
    midX: number
    midY: number
  }> = []
  const byId = new Map(props.quests.map((q) => [q.id, q]))
  for (const q of props.quests) {
    for (const dep of q.dependencies) {
      const src = byId.get(dep)
      if (!src) continue
      // 连线方向：src（依赖的任务）→ q（当前任务）
      const x1 = (src.x ?? 0) + NODE_W + ANCHOR_OFFSET
      const y1 = (src.y ?? 0) + NODE_H / 2
      const x2 = (q.x ?? 0) - ANCHOR_OFFSET
      const y2 = (q.y ?? 0) + NODE_H / 2
      list.push({ from: src.id, to: q.id, x1, y1, x2, y2, path: bezierPath(x1, y1, x2, y2), midX: (x1 + x2) / 2, midY: (y1 + y2) / 2 })
    }
  }
  return list
})

function bezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

/** 正在拖的连线（实时预览） */
const pendingLink = computed(() => {
  if (!linking.fromId) return null
  const src = props.quests.find((q) => q.id === linking.fromId)
  if (!src) return null
  const x1 = (src.x ?? 0) + NODE_W + ANCHOR_OFFSET
  const y1 = (src.y ?? 0) + NODE_H / 2
  return { path: bezierPath(x1, y1, linking.mouseX, linking.mouseY) }
})

// ---- 事件：节点拖拽 ----

function onNodeMouseDown(e: MouseEvent, q: FtbQuest): void {
  if (e.button !== 0) return
  const rect = canvasEl.value!.getBoundingClientRect()
  dragging.questId = q.id
  dragging.offsetX = e.clientX - rect.left - (q.x ?? 0)
  dragging.offsetY = e.clientY - rect.top - (q.y ?? 0)
  activeId.value = q.id
}

function onAnchorOutMouseDown(e: MouseEvent, q: FtbQuest): void {
  if (e.button !== 0) return
  const rect = canvasEl.value!.getBoundingClientRect()
  linking.fromId = q.id
  linking.mouseX = e.clientX - rect.left
  linking.mouseY = e.clientY - rect.top
}

function onNodeEnter(q: FtbQuest): void {
  if (linking.fromId) hoverQuestId.value = q.id
  else activeId.value = q.id
}
function onNodeLeave(): void {
  hoverQuestId.value = ''
  if (!dragging.questId && !linking.fromId) activeId.value = ''
}

function onGlobalMouseMove(e: MouseEvent): void {
  if (!canvasEl.value) return
  const rect = canvasEl.value.getBoundingClientRect()
  if (dragging.questId) {
    const q = props.quests.find((x) => x.id === dragging.questId)
    if (q) {
      q.x = Math.max(0, Math.round(e.clientX - rect.left - dragging.offsetX))
      q.y = Math.max(0, Math.round(e.clientY - rect.top - dragging.offsetY))
    }
  } else if (linking.fromId) {
    linking.mouseX = e.clientX - rect.left
    linking.mouseY = e.clientY - rect.top
  }
}

function onGlobalMouseUp(e: MouseEvent): void {
  if (!canvasEl.value) return
  const movedQuest = dragging.questId
  const linkingFrom = linking.fromId
  dragging.questId = ''
  linking.fromId = ''

  if (movedQuest) {
    emit('dirty')
    return
  }
  if (linkingFrom) {
    // 看松手点是否落在某个节点上 → 建立依赖
    const rect = canvasEl.value.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    for (const q of props.quests) {
      const qx = q.x ?? 0
      const qy = q.y ?? 0
      if (x >= qx && x <= qx + NODE_W && y >= qy && y <= qy + NODE_H) {
        // 不能依赖自己
        if (q.id === linkingFrom) return
        // 不能重复
        if (!q.dependencies.includes(linkingFrom)) {
          q.dependencies.push(linkingFrom)
          emit('dirty')
        }
        return
      }
    }
  }
}

function onDeleteLink(from: string, to: string): void {
  const target = props.quests.find((q) => q.id === to)
  if (!target) return
  const idx = target.dependencies.indexOf(from)
  if (idx >= 0) {
    target.dependencies.splice(idx, 1)
    emit('dirty')
  }
}
</script>

<style scoped>
.fq-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
  background: #141519;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.fq-canvas-grid {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.fq-canvas-lines {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.fq-canvas-lines .fq-line {
  pointer-events: stroke;
  cursor: pointer;
}

.fq-canvas-lines .fq-line-del {
  pointer-events: all;
  cursor: pointer;
  opacity: 0.5;
}
.fq-canvas-lines .fq-line-del:hover {
  opacity: 1;
  fill: #e04a3f;
}

.fq-node {
  position: absolute;
  z-index: 2;
  background: #1f2128;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 10px 12px;
  cursor: grab;
  user-select: none;
  transition: border-color 0.12s, box-shadow 0.12s;
  font-family: -apple-system, 'Segoe UI', sans-serif;
  color: #d0d3d8;
}

.fq-node:hover {
  border-color: #4a9eff;
  box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.25);
}

.fq-node-active {
  border-color: #4a9eff !important;
  box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.35);
}

.fq-node-has-reward {
  border-left: 3px solid #f97316;
}

.fq-node-title {
  font-size: 13px;
  font-weight: 600;
  color: #f0f2f5;
  margin-bottom: 4px;
}

.fq-node-item {
  font-size: 11px;
  font-family: 'Consolas', 'Monaco', monospace;
  color: #9aa0a8;
}

.fq-node-reward {
  margin-top: 4px;
  font-size: 11px;
  color: #f97316;
}

.fq-node-deps {
  position: absolute;
  top: -8px;
  right: -8px;
  font-size: 10px;
  background: #2979ff;
  color: white;
  padding: 1px 6px;
  border-radius: 10px;
}

.fq-anchor {
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #4a9eff;
  background: #141519;
  transition: transform 0.12s, background 0.12s;
}

.fq-anchor-out {
  right: -7px;
  top: 50%;
  transform: translateY(-50%);
  cursor: crosshair;
}
.fq-anchor-out:hover {
  background: #4a9eff;
  transform: translateY(-50%) scale(1.2);
}

.fq-anchor-in {
  left: -7px;
  top: 50%;
  transform: translateY(-50%);
  border-style: dashed;
}

.fq-canvas-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #5a6068;
  font-size: 13px;
}
</style>
