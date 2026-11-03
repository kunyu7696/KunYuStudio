<!--
  FancyMenu 画布——模拟 MC 标题界面（默认 1280x720），四种元素拖拽编辑。
  - 锚点定位：元素 anchor + x/y 相对屏幕锚点参考点
  - 画布只读 props.elements；直接改元素引用对象（与 FtbQuestCanvas 同模式）
  - emit('dirty') 通知父组件保存；emit('select', id) 通知选中元素（属性面板联动）
-->
<template>
  <div class="fm-wrap">
    <!-- 屏幕模拟区：居中显示，外带虚线边框 -->
    <div class="fm-stage-frame">
      <div
        ref="stageEl"
        class="fm-stage"
        :style="{ width: screenW + 'px', height: screenH + 'px' }"
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
            <div class="fm-image-placeholder">
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

    <!-- 分辨率切换 -->
    <div class="fm-res-bar">
      <span class="fm-res-label">屏幕模拟：</span>
      <el-radio-group :model-value="resKey" size="small" @update:model-value="onResChange">
        <el-radio-button value="16x9">16:9 (1280×720)</el-radio-button>
        <el-radio-button value="16x10">16:10 (1280×800)</el-radio-button>
        <el-radio-button value="4x3">4:3 (1024×768)</el-radio-button>
        <el-radio-button value="full">宽 (1920×1080)</el-radio-button>
      </el-radio-group>
      <span class="fm-res-dim">{{ screenW }} × {{ screenH }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { FmAnchor, FmElement } from '../../../../shared/types/fancymenu'

const props = defineProps<{
  elements: FmElement[]
  activeId?: string
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

function onResChange(v: string | number | boolean): void {
  if (typeof v === 'string') resKey.value = v as typeof resKey.value
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

// ---- 拖拽 ----
const stageEl = ref<HTMLDivElement | null>(null)
const dragging = reactive({
  id: '' as string,
  offsetX: 0,
  offsetY: 0
})

function onElementMouseDown(e: MouseEvent, el: FmElement): void {
  if (e.button !== 0) return
  emit('select', el.id)
  const stageRect = stageEl.value!.getBoundingClientRect()
  const ap = anchorPoint(el.anchor)
  // 锚点参考点在 stage 内的实际像素
  const apX = ap.x
  const apY = ap.y
  // 鼠标相对 stage 的位置
  const mx = e.clientX - stageRect.left
  const my = e.clientY - stageRect.top
  // 目标 x/y = 鼠标位置 - 锚点参考点
  dragging.id = el.id
  dragging.offsetX = mx - apX - el.x
  dragging.offsetY = my - apY - el.y
}

function onStageMouseMove(e: MouseEvent): void {
  if (!dragging.id || !stageEl.value) return
  const el = props.elements.find((x) => x.id === dragging.id)
  if (!el) return
  const stageRect = stageEl.value.getBoundingClientRect()
  const ap = anchorPoint(el.anchor)
  const mx = e.clientX - stageRect.left
  const my = e.clientY - stageRect.top
  // 约束到 stage 内
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
}

.fm-stage-frame {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: #0c0d10;
  padding: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
}

.fm-stage {
  position: relative;
  flex-shrink: 0;
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
  box-shadow: 0 0 0 2px #4a9eff, 0 0 12px rgba(74, 158, 255, 0.35);
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

.fm-el-bounds {
  position: absolute;
  border: 1px solid #4a9eff;
  box-sizing: border-box;
  pointer-events: none;
}

.fm-res-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #8b919a;
}
.fm-res-label { color: #6b7280; }
.fm-res-dim { margin-left: auto; color: #4a9eff; font-family: 'Consolas', monospace; }
</style>
