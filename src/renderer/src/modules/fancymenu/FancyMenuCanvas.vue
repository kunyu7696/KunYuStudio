<!--
  FancyMenu 画布——模拟 MC 标题界面（默认 1280x720），四种元素拖拽编辑。
  - 锚点定位：元素 anchor + x/y 相对屏幕锚点参考点
  - 画布只读 props.elements；直接改元素引用对象（与 FtbQuestCanvas 同模式）
  - emit('dirty') 通知父组件保存；emit('select', id) 通知选中元素（属性面板联动）
  - 缩放：Ctrl+滚轮精调、工具栏预设按钮（25%/50%/75%/100%/150%/200%）
-->
<template>
  <div class="fm-wrap">
    <!-- 屏幕模拟区 + 缩放容器 -->
    <div
      ref="frameEl"
      class="fm-stage-frame"
      :class="{ 'is-fit': autoFit }"
      @wheel.prevent="onFrameWheel"
    >
      <!-- 缩放外层：布局尺寸 = 缩放后的视觉尺寸，避免溢出占位把画布裁掉 -->
      <div
        ref="zoomEl"
        class="fm-stage-zoom"
        :style="{ width: screenW * scale + 'px', height: screenH * scale + 'px' }"
      >
        <div
          ref="stageEl"
          class="fm-stage"
          :style="{
            width: screenW + 'px',
            height: screenH + 'px',
            transform: `scale(${scale})`,
            transformOrigin: 'top left'
          }"
          @mousemove="onStageMouseMove"
          @mouseup="onStageMouseUp"
          @mouseleave="onStageMouseUp"
          @mousedown.self="onStageClickEmpty"
        >
          <!-- 背景（深色渐变 + 网格） -->
          <div class="fm-stage-bg" />

          <!-- 元素按 z 排序渲染 -->
          <template v-for="el in sorted" :key="el.id">
            <!-- rect 色块 -->
            <div
              v-if="el.type === 'rect'"
              class="fm-el fm-el-rect"
              :class="{ 'fm-el-active': activeId === el.id }"
              :style="elStyle(el)"
              @mousedown.stop="onElementMouseDown($event, el)"
            />
            <!-- image 贴图 -->
            <div
              v-else-if="el.type === 'image'"
              class="fm-el fm-el-image"
              :class="{ 'fm-el-active': activeId === el.id }"
              :style="elStyle(el)"
              @mousedown.stop="onElementMouseDown($event, el)"
            >
              <img v-if="resolveImage(el.url)" class="fm-el-img" :src="resolveImage(el.url)" alt="" />
              <div v-else class="fm-image-placeholder">
                <span>{{ el.url || '未设贴图' }}</span>
              </div>
            </div>
            <!-- text 静态文字 -->
            <div
              v-else-if="el.type === 'text'"
              class="fm-el fm-el-text"
              :class="{ 'fm-el-active': activeId === el.id }"
              :style="elStyle(el)"
              @mousedown.stop="onElementMouseDown($event, el)"
            >
              {{ el.text }}
            </div>
            <!-- button 按钮 -->
            <div
              v-else-if="el.type === 'button'"
              class="fm-el fm-el-button"
              :class="{ 'fm-el-active': activeId === el.id }"
              :style="elStyle(el)"
              @mousedown.stop="onElementMouseDown($event, el)"
            >
              {{ el.text }}
            </div>
            <!-- slides 轮播背景 -->
            <div
              v-else-if="el.type === 'slides'"
              class="fm-el fm-el-slides"
              :class="{ 'fm-el-active': activeId === el.id }"
              :style="elStyle(el)"
              @mousedown.stop="onElementMouseDown($event, el)"
            >
              <img
                v-if="slideSrc(el)"
                class="fm-slides-img"
                :style="{ objectFit: slideFit(el.fitType) }"
                :src="slideSrc(el)"
                alt=""
              />
              <div v-else class="fm-slides-current">
                <span class="fm-slides-badge">{{ t('fancymenu.slidesBadge', { n: slideIndex(el) + 1, total: el.slides.length || 1 }) }}</span>
                <span class="fm-slides-path">{{ currentSlidePath(el) || t('fancymenu.noSlideImage') }}</span>
              </div>
              <div class="fm-slides-dots">
                <span
                  v-for="(_, i) in el.slides"
                  :key="i"
                  class="fm-slides-dot"
                  :class="{ on: i === slideIndex(el) }"
                />
              </div>
            </div>
            <!-- particles 粒子动效 -->
            <div
              v-else-if="el.type === 'particles'"
              class="fm-el fm-el-particles"
              :class="{ 'fm-el-active': activeId === el.id }"
              :style="elStyle(el)"
              @mousedown.stop="onElementMouseDown($event, el)"
            >
              <span class="fm-particles-badge">{{ el.particleId }} ×{{ el.amount }}</span>
              <span
                v-for="n in Math.min(el.amount, 12)"
                :key="n"
                class="fm-particle"
                :style="particleDotStyle(el, n)"
              />
            </div>
          </template>

          <!-- 选中元素的调试点（显示 9 个锚点参考点 + 元素边界） -->
          <template v-if="activeEl">
            <div
              class="fm-el-bounds"
              :style="{
                left: anchorPoint(activeEl.anchor).x + activeEl.x + 'px',
                top: anchorPoint(activeEl.anchor).y + activeEl.y + 'px',
                width: activeEl.width + 'px',
                height: activeEl.height + 'px'
              }"
            />
          </template>
        </div>
      </div>
    </div>

    <!-- 底栏：分辨率 + 缩放 -->
    <div class="fm-res-bar">
      <span class="fm-res-label">{{ t('fancymenu.canvasScreen') }}</span>
      <el-radio-group :model-value="resKey" size="small" @update:model-value="onResChange">
        <el-radio-button value="16x9">16:9 (1280×720)</el-radio-button>
        <el-radio-button value="16x10">16:10 (1280×800)</el-radio-button>
        <el-radio-button value="4x3">4:3 (1024×768)</el-radio-button>
        <el-radio-button value="full">{{ t('fancymenu.canvasWide') }}</el-radio-button>
      </el-radio-group>
      <span class="fm-res-dim">{{ screenW }} × {{ screenH }}</span>

      <span class="fm-zoom-sep" />

      <span class="fm-res-label">{{ t('fancymenu.canvasZoom') }}</span>
      <el-radio-group :model-value="scaleStr" size="small" @update:model-value="onScaleChange">
        <el-radio-button value="0.25">25%</el-radio-button>
        <el-radio-button value="0.5">50%</el-radio-button>
        <el-radio-button value="0.75">75%</el-radio-button>
        <el-radio-button value="1">100%</el-radio-button>
        <el-radio-button value="1.5">150%</el-radio-button>
        <el-radio-button value="2">200%</el-radio-button>
      </el-radio-group>
      <el-button
        size="small"
        text
        :type="autoFit ? 'primary' : 'default'"
        @click="onFit"
      >{{ t('fancymenu.fitWindow') }}</el-button>
      <span class="fm-zoom-tip">{{ t('fancymenu.canvasZoomTip') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type {
  FmAnchor,
  FmElement,
  FmParticles,
  FmSlides
} from '../../../../shared/types/fancymenu'
import { t } from '../../i18n'

const props = defineProps<{
  elements: FmElement[]
  activeId?: string
  /** config/fancymenu 绝对目录，用于解析 local 图片做真实预览 */
  assetRoot?: string
}>()

const emit = defineEmits<{
  (e: 'dirty'): void
  (e: 'select', id: string): void
}>()

// ---- 屏幕分辨率 ----
const RES_MAP: Record<string, { w: number; h: number }> = {
  '16x9': { w: 1280, h: 720 },
  '16x10': { w: 1280, h: 800 },
  '4x3': { w: 1024, h: 768 },
  full: { w: 1920, h: 1080 }
}
const resKey = ref<'16x9' | '16x10' | '4x3' | 'full'>('16x9')
const screenW = computed(() => RES_MAP[resKey.value].w)
const screenH = computed(() => RES_MAP[resKey.value].h)

function onResChange(v: string | number | boolean | undefined): void {
  if (typeof v === 'string') resKey.value = v as typeof resKey.value
}

// ---- 缩放 ----
/** 手动缩放值（autoFit 关闭时生效） */
const manualScale = ref(0.75)
/** 是否自动适应画布容器（默认开启，避免元素被容器裁掉） */
const autoFit = ref(true)
/** 由容器尺寸算出的适配比例 */
const fitScale = ref(1)
const MIN_SCALE = 0.1
const MAX_SCALE = 3.0

/** 实际生效缩放：自动适配优先，手动选择后改为手动值 */
const scale = computed(() => (autoFit.value ? fitScale.value : manualScale.value))
/** 屏幕缩放按钮的匹配值（两位小数字符串） */
const scaleStr = computed(() => String(Math.round(scale.value * 100) / 100))

const frameEl = ref<HTMLDivElement | null>(null)
let fitObserver: ResizeObserver | undefined

/** 按容器内容区宽高算适配比例（扣除 padding 与滚动条，尽量铺满） */
function updateFit(): void {
  const el = frameEl.value
  if (!el) return
  const cs = getComputedStyle(el)
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
  // clientWidth/Height 已排除滚动条，再扣 padding 即是可用内容区
  const aw = el.clientWidth - padX - 8
  const ah = el.clientHeight - padY - 8
  if (aw <= 0 || ah <= 0) return
  const w = aw / screenW.value
  const h = ah / screenH.value
  fitScale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(w, h)))
}

function onFit(): void {
  autoFit.value = true
  updateFit()
}

function onScaleChange(v: string | number | boolean | undefined): void {
  const n = typeof v === 'string' ? parseFloat(v) : (typeof v === 'number' ? v : 1)
  manualScale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, n))
  autoFit.value = false
}

function onFrameWheel(e: WheelEvent): void {
  if (e.ctrlKey || e.metaKey) {
    // Ctrl + 滚轮 → 缩放（同时退出自动适配）
    const dir = e.deltaY < 0 ? 1 : -1
    const step = 0.05
    manualScale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale.value + dir * step))
    autoFit.value = false
  }
  // 非 Ctrl 滚轮让 frame 自己滚动（overflow: auto 自带）
}

// ---- 锚点 → 屏幕参考点坐标 ----
function anchorPoint(anchor: FmAnchor): { x: number; y: number } {
  const W = screenW.value
  const H = screenH.value
  const map: Record<FmAnchor, { x: number; y: number }> = {
    top_left: { x: 0, y: 0 },
    top_center: { x: W / 2, y: 0 },
    top_right: { x: W, y: 0 },
    middle_left: { x: 0, y: H / 2 },
    center: { x: W / 2, y: H / 2 },
    middle_right: { x: W, y: H / 2 },
    bottom_left: { x: 0, y: H },
    bottom_center: { x: W / 2, y: H },
    bottom_right: { x: W, y: H }
  }
  return map[anchor] ?? map.top_left
}

/** 元素最终 left/top（绝对定位到 stage 内） */
function elStyle(el: FmElement): Record<string, string> {
  const ap = anchorPoint(el.anchor)
  return {
    left: ap.x + el.x + 'px',
    top: ap.y + el.y + 'px',
    width: el.width + 'px',
    height: el.height + 'px',
    zIndex: String(el.z ?? 0)
  }
}

// ---- 排序（z 升序） ----
const sorted = computed(() =>
  [...props.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
)

const activeEl = computed(() =>
  props.elements.find((e) => e.id === props.activeId) ?? null
)

// ---- 轮播预览时钟（每 500ms 推进一格） ----
const tick = ref(0)
let tickTimer: number | undefined

// ---- 本地图片预览（slides/image 引用的 config/fancymenu 下资源） ----
/** 绝对路径 → dataURL 缓存 */
const localImages = reactive<Record<string, string>>({})
const loadingImages = new Set<string>()

/** 相对 config/fancymenu 的路径 → 绝对路径 */
function relToAbs(rel: string): string {
  const base = props.assetRoot
  if (!base || !rel) return ''
  const clean = rel.replace(/^local:/, '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!clean) return ''
  return `${base.replace(/\\/g, '/')}/${clean}`
}

/** 读取本地图片并缓存 dataURL；读失败也记空值，避免反复重试 */
async function ensureLocalImage(abs: string): Promise<void> {
  if (!abs || localImages[abs] !== undefined || loadingImages.has(abs)) return
  loadingImages.add(abs)
  try {
    const bin = await window.api.fs.readBinary(abs)
    localImages[abs] = `data:${bin.mime};base64,${bin.dataBase64}`
  } catch {
    localImages[abs] = ''
  } finally {
    loadingImages.delete(abs)
  }
}

/** image 元素：资源包路径（含命名空间）不预览；local: 前缀或普通相对路径走本地预览 */
function resolveImage(url: string): string {
  if (!url) return ''
  const isResourcePath = /^[a-z0-9_.-]+:/i.test(url) && !url.startsWith('local:')
  if (isResourcePath) return ''
  const abs = relToAbs(url)
  return abs ? localImages[abs] ?? '' : ''
}

/** slides 当前帧的图片 dataURL */
function slideSrc(el: FmSlides): string {
  const item = el.slides[slideIndex(el)]
  const abs = item ? relToAbs(item.path) : ''
  return abs ? localImages[abs] ?? '' : ''
}

/** fitType → object-fit：stretch 拉伸 / crop 裁剪铺满 / fill 完整显示 */
function slideFit(fit?: FmSlides['fitType']): 'fill' | 'cover' | 'contain' {
  if (fit === 'crop') return 'cover'
  if (fit === 'fill') return 'contain'
  return 'fill'
}

/** 所有被引用的本地路径（只在路径变化时重算，拖拽坐标不触发） */
const localPaths = computed(() => {
  const list: string[] = []
  for (const el of props.elements) {
    if (el.type === 'image') list.push(el.url)
    else if (el.type === 'slides') for (const s of el.slides) list.push(s.path)
  }
  return list.filter((p) => !!relToAbs(p)).join('\n')
})

function scanLocalImages(): void {
  for (const rel of localPaths.value.split('\n')) {
    const abs = relToAbs(rel)
    if (abs) void ensureLocalImage(abs)
  }
}

watch([localPaths, tick], scanLocalImages, { immediate: true })

onMounted(() => {
  tickTimer = window.setInterval(() => {
    tick.value++
  }, 500)
  updateFit()
  if (frameEl.value) {
    fitObserver = new ResizeObserver(() => updateFit())
    fitObserver.observe(frameEl.value)
  }
})
onBeforeUnmount(() => {
  if (tickTimer !== undefined) window.clearInterval(tickTimer)
  fitObserver?.disconnect()
})

// 分辨率切换后重新计算适配比例
watch([screenW, screenH], () => updateFit())

/** 暴露当前屏幕尺寸，供模板按实际分辨率生成全屏元素 */
defineExpose({
  getScreenSize: (): { w: number; h: number } => ({ w: screenW.value, h: screenH.value })
})

/** 当前展示第几张（按 duration 换算成 tick 步数） */
function slideIndex(el: FmSlides): number {
  const n = el.slides.length
  if (!n) return 0
  const step = Math.max(1, Math.round(el.duration / 500))
  return Math.floor(tick.value / step) % n
}

function currentSlidePath(el: FmSlides): string {
  return el.slides[slideIndex(el)]?.path ?? ''
}

/** 粒子示意点位（确定性伪随机，保证每次渲染一致） */
function particleDotStyle(el: FmParticles, n: number): Record<string, string> {
  const rand = (seed: number): number => {
    const x = Math.sin(seed * 12.9898) * 43758.5453
    return x - Math.floor(x)
  }
  const cx = el.originX * 100
  const cy = el.originY * 100
  const dx = (rand(n) - 0.5) * el.spreadX * 30
  const dy = (rand(n + 7) - 0.5) * el.spreadY * 30
  const size = 3 + Math.round(rand(n + 13) * (el.size ?? 1) * 3)
  return {
    left: `${(cx + dx).toFixed(2)}%`,
    top: `${(cy + dy).toFixed(2)}%`,
    width: `${size}px`,
    height: `${size}px`,
    animationDelay: `${(rand(n + 19) * 2).toFixed(2)}s`,
    animationDuration: `${(1.2 + rand(n + 23) * 0.8).toFixed(2)}s`
  }
}

// ---- DOM refs ----
const stageEl = ref<HTMLDivElement | null>(null)

// ---- 拖拽 ----
const dragging = reactive({
  id: '' as string,
  offsetX: 0,
  offsetY: 0
})

function onElementMouseDown(e: MouseEvent, el: FmElement): void {
  if (e.button !== 0 || !stageEl.value) return
  emit('select', el.id)
  const stageRect = stageEl.value.getBoundingClientRect()
  const ap = anchorPoint(el.anchor)
  // 鼠标相对 stage 的位置，除以 scale 得到 stage 内实际像素坐标
  const mx = (e.clientX - stageRect.left) / scale.value
  const my = (e.clientY - stageRect.top) / scale.value
  dragging.id = el.id
  dragging.offsetX = mx - ap.x - el.x
  dragging.offsetY = my - ap.y - el.y
}

function onStageMouseMove(e: MouseEvent): void {
  if (!dragging.id || !stageEl.value) return
  const el = props.elements.find((x) => x.id === dragging.id)
  if (!el) return
  const stageRect = stageEl.value.getBoundingClientRect()
  const ap = anchorPoint(el.anchor)
  // 同样：缩放后的 clientX - 缩放后的 stageRect 起点 = 缩放后的偏移，除以 scale 还原
  const mx = (e.clientX - stageRect.left) / scale.value
  const my = (e.clientY - stageRect.top) / scale.value
  const nx = Math.round(mx - ap.x - dragging.offsetX)
  const ny = Math.round(my - ap.y - dragging.offsetY)
  el.x = nx
  el.y = ny
}

function onStageMouseUp(): void {
  if (dragging.id) {
    dragging.id = ''
    emit('dirty')
  }
}

function onStageClickEmpty(): void {
  emit('select', '')
}
</script>

<style scoped>
.fm-wrap {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  width: 100%;
  min-width: 0;
}

.fm-stage-frame {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px dashed var(--ky-border-strong, rgba(255, 255, 255, 0.15));
  border-radius: 6px;
  background: var(--ky-code-bg, #0c0d10);
  padding: 16px;
  display: flex;
  /* 自动适配时纵横都居中；手动放大可能溢出，此时退回左上起点保证可滚动 */
  justify-content: flex-start;
  align-items: flex-start;
}
.fm-stage-frame.is-fit {
  align-items: center;
}

.fm-stage-zoom {
  flex-shrink: 0;
  margin: auto; /* 空间足够时居中；超出时自动退化为可滚动，不会裁掉左上角 */
}

.fm-stage {
  position: relative;
  flex-shrink: 0;
  transform-origin: top left;
  will-change: transform;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08) inset, 0 12px 40px rgba(0, 0, 0, 0.5);
}

.fm-stage-bg {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(135deg, #1a1d26 0%, #0f1118 60%, #08090d 100%);
  background-image:
    linear-gradient(135deg, #1a1d26 0%, #0f1118 60%, #08090d 100%),
    repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 40px),
    repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 40px);
  pointer-events: none;
}

.fm-el {
  position: absolute;
  box-sizing: border-box;
  cursor: grab;
  user-select: none;
  transition: box-shadow 0.12s, border-color 0.12s;
}
.fm-el:active { cursor: grabbing; }

.fm-el-active {
  box-shadow: 0 0 0 2px var(--ky-accent), 0 0 12px color-mix(in srgb, var(--ky-accent) 35%, transparent);
}

.fm-el-rect {
  border: 1px solid rgba(255,255,255,0.15);
}

.fm-el-image {
  border: 1px dashed rgba(255,255,255,0.18);
}
.fm-image-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.04);
  color: #6b7280;
  font-size: 10px;
  font-family: 'Consolas', monospace;
  text-align: center;
  overflow: hidden;
  padding: 2px;
  box-sizing: border-box;
}

.fm-el-text {
  font-size: 14px;
  color: #e8ecf2;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: pre-wrap;
  line-height: 1.3;
  text-shadow: 0 1px 2px rgba(0,0,0,0.7);
  font-family: -apple-system, 'Segoe UI', sans-serif;
}

.fm-el-button {
  border: 2px solid #5a5f6b;
  background: linear-gradient(180deg, #3a3f4a 0%, #262a33 100%);
  border-radius: 4px;
  color: #e8ecf2;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-shadow: 0 1px 1px rgba(0,0,0,0.6);
}
.fm-el-button:hover { border-color: #7a808e; }

/* slides 轮播背景 */
.fm-el-slides {
  border: 1px dashed rgba(122, 199, 255, 0.35);
  background: linear-gradient(135deg, #20283a 0%, #161b26 100%);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}
.fm-slides-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}
.fm-el-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.fm-slides-current {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  text-align: center;
  overflow: hidden;
}
.fm-slides-badge {
  font-size: 10px;
  color: #7ac7ff;
  font-family: 'Consolas', monospace;
  background: rgba(122, 199, 255, 0.12);
  padding: 1px 6px;
  border-radius: 3px;
}
.fm-slides-path {
  font-size: 10px;
  color: #9aa1ae;
  font-family: 'Consolas', monospace;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fm-slides-dots {
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  z-index: 2;
}
.fm-slides-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.18);
  transition: background 0.2s;
}
.fm-slides-dot.on { background: #7ac7ff; }

/* particles 粒子动效 */
.fm-el-particles {
  border: 1px dashed rgba(255, 176, 122, 0.35);
  background: rgba(255, 176, 122, 0.03);
  overflow: hidden;
}
.fm-particles-badge {
  position: absolute;
  left: 4px;
  bottom: 3px;
  font-size: 9px;
  color: #ffb07a;
  font-family: 'Consolas', monospace;
  z-index: 2;
  pointer-events: none;
}
.fm-particle {
  position: absolute;
  border-radius: 50%;
  background: radial-gradient(circle, #ffcf9a 0%, rgba(255, 176, 122, 0.2) 75%);
  transform: translate(-50%, -50%);
  animation-name: fm-particle-float;
  animation-iteration-count: infinite;
  animation-timing-function: ease-in-out;
  pointer-events: none;
}
@keyframes fm-particle-float {
  0%, 100% { opacity: 0.25; transform: translate(-50%, -50%) scale(0.85); }
  50% { opacity: 0.95; transform: translate(-50%, -80%) scale(1.1); }
}

.fm-el-bounds {
  position: absolute;
  border: 1px solid var(--ky-accent);
  box-sizing: border-box;
  pointer-events: none;
}

.fm-res-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--ky-text-dim);
  flex-wrap: wrap;
}
.fm-res-label { color: var(--ky-text-dim); }
.fm-res-dim { color: var(--ky-accent); font-family: 'Consolas', monospace; }
.fm-zoom-sep { width: 1px; height: 16px; background: var(--ky-border); margin: 0 2px; }
.fm-zoom-tip { color: var(--ky-text-dim); font-size: 11px; opacity: 0.8; }
</style>
