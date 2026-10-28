<template>
  <div class="tc-wrap" @wheel.prevent="onWheel">
    <canvas
      ref="canvasRef"
      class="tc-canvas"
      :style="{ width: cssW + 'px', height: cssH + 'px' }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointerleave="onLeave"
    />
    <!-- 叠加层（绝对定位于画布区域，如 UV 选区高亮）；百分比坐标与画布像素一一对应 -->
    <slot name="overlay" />
    <span v-if="hover" class="tc-coords">{{ hover.x }}, {{ hover.y }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * TextureCanvas：共享像素画布（原生 Canvas 2D）。
 * 职责：棋盘格背景 + 像素 + 网格 + 形状草稿预览的渲染，坐标转换与鼠标事件转发。
 * 编辑状态与历史由各自的 composable 持有（资源包 useTextureEditor / 工坊 usePixelCanvas）；
 * 本组件不持有像素数据。叠加层（如 UV 高亮）走 overlay 插槽。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ellipsePoints, linePoints, rectOutlinePoints } from './pixelAlgorithms'

/** 形状拖拽草稿（画布坐标）；与各编辑器 composable 的同名结构兼容 */
interface ShapeDraft {
  x0: number
  y0: number
  x1: number
  y1: number
}

const props = defineProps<{
  width: number
  height: number
  pixels: string[]
  zoom: number
  showGrid: boolean
  draft: ShapeDraft | null
  tool: string
  color: string
}>()

const emit = defineEmits<{
  (e: 'start', x: number, y: number): void
  (e: 'move', x: number, y: number): void
  (e: 'end'): void
  (e: 'hover', pos: { x: number; y: number } | null): void
  (e: 'zoom', delta: number): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const hover = ref<{ x: number; y: number } | null>(null)
let dragging = false

const cssW = computed(() => props.width * props.zoom)
const cssH = computed(() => props.height * props.zoom)

/** 棋盘格双灰（8×8 屏幕块固定，随缩放稳定） */
const CHECK_A = '#2a2a3c'
const CHECK_B = '#383b41'
const GRID_COLOR = 'rgba(205, 214, 244, 0.10)'
const GRID_MAJOR_COLOR = 'rgba(205, 214, 244, 0.22)'
const DRAFT_ALPHA = 0.55

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const w = cssW.value
  const h = cssH.value
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  const z = props.zoom

  // 1) 棋盘格背景（透明可视化）
  const checkSize = Math.max(4, Math.min(8, z))
  for (let y = 0; y < h; y += checkSize) {
    for (let x = 0; x < w; x += checkSize) {
      ctx.fillStyle = ((x / checkSize + y / checkSize) | 0) % 2 === 0 ? CHECK_A : CHECK_B
      ctx.fillRect(x, y, checkSize, checkSize)
    }
  }

  // 2) 像素
  for (let py = 0; py < props.height; py++) {
    for (let px = 0; px < props.width; px++) {
      const hex = props.pixels[py * props.width + px]
      if (!hex) continue
      ctx.fillStyle = hex
      ctx.fillRect(px * z, py * z, z, z)
    }
  }

  // 3) 形状草稿预览（半透明当前色）
  const d = props.draft
  if (d) {
    const pts =
      props.tool === 'line'
        ? linePoints(d.x0, d.y0, d.x1, d.y1)
        : props.tool === 'rect'
          ? rectOutlinePoints(d.x0, d.y0, d.x1, d.y1)
          : ellipsePoints(d.x0, d.y0, d.x1, d.y1)
    ctx.globalAlpha = DRAFT_ALPHA
    ctx.fillStyle = props.color
    for (const p of pts) ctx.fillRect(p.x * z, p.y * z, z, z)
    ctx.globalAlpha = 1
  }

  // 4) 网格线（每像素浅色，每 8 像素加粗）
  if (props.showGrid && z >= 6) {
    ctx.lineWidth = 1
    for (let x = 0; x <= props.width; x++) {
      ctx.strokeStyle = x % 8 === 0 ? GRID_MAJOR_COLOR : GRID_COLOR
      ctx.beginPath()
      ctx.moveTo(x * z + 0.5, 0)
      ctx.lineTo(x * z + 0.5, h)
      ctx.stroke()
    }
    for (let y = 0; y <= props.height; y++) {
      ctx.strokeStyle = y % 8 === 0 ? GRID_MAJOR_COLOR : GRID_COLOR
      ctx.beginPath()
      ctx.moveTo(0, y * z + 0.5)
      ctx.lineTo(w, y * z + 0.5)
      ctx.stroke()
    }
  }
}

/** 鼠标事件 → 画布像素坐标 */
function toPixel(e: PointerEvent): { x: number; y: number } {
  const canvas = canvasRef.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * props.width)
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * props.height)
  return {
    x: Math.max(0, Math.min(x, props.width - 1)),
    y: Math.max(0, Math.min(y, props.height - 1))
  }
}

function onDown(e: PointerEvent): void {
  if (e.button !== 0) return
  const p = toPixel(e)
  dragging = true
  canvasRef.value?.setPointerCapture(e.pointerId)
  emit('start', p.x, p.y)
}

function onMove(e: PointerEvent): void {
  const p = toPixel(e)
  hover.value = p
  emit('hover', p)
  if (dragging) emit('move', p.x, p.y)
}

function onUp(): void {
  if (!dragging) return
  dragging = false
  emit('end')
}

function onLeave(): void {
  hover.value = null
  emit('hover', null)
}

function onWheel(e: WheelEvent): void {
  emit('zoom', e.deltaY < 0 ? 1 : -1)
}

onMounted(draw)
watch(
  () => [props.pixels, props.width, props.height, props.zoom, props.showGrid, props.draft, props.color, props.tool],
  draw,
  { deep: false }
)
</script>

<style scoped>
.tc-wrap {
  position: relative;
  display: inline-block;
  line-height: 0;
  border: 1px solid var(--ky-border);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
}
.tc-canvas {
  display: block;
  image-rendering: pixelated;
  cursor: crosshair;
  touch-action: none;
}
.tc-coords {
  position: absolute;
  right: 6px;
  bottom: 4px;
  font-size: 10px;
  font-family: var(--ky-mono, monospace);
  color: var(--ky-text-sub);
  background: rgba(17, 17, 27, 0.8);
  border-radius: 3px;
  padding: 1px 6px;
  pointer-events: none;
  line-height: 1.5;
}
</style>
