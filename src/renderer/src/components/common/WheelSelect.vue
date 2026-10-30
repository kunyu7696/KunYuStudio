<template>
  <div ref="rootRef" class="wheel-select" :class="{ 'is-open': expanded }">
    <!-- 收起态：类似只读输入框，点击展开滚轮 -->
    <button type="button" class="ws-trigger" :title="displayLabel" @click="toggle">
      <span class="ws-value" :class="{ 'is-placeholder': !modelValue }">{{ displayLabel }}</span>
      <el-icon class="ws-caret">
        <ArrowUp v-if="expanded" />
        <ArrowDown v-else />
      </el-icon>
    </button>

    <!-- 展开态：滚轮列表（鼠标滚轮 / 点击 / 拖拽滚动选值） -->
    <div v-if="expanded" class="ws-panel" :style="{ height: `${panelHeight}px` }">
      <div ref="listRef" class="ws-list" @scroll="onScroll" @wheel="onWheel">
        <div class="ws-spacer" :style="{ height: `${spacerHeight}px` }" />
        <button
          v-for="(opt, i) in options"
          :key="opt.value"
          type="button"
          class="ws-item"
          :class="{ 'is-active': opt.value === modelValue, 'is-disabled': opt.disabled }"
          :title="opt.disabled ? (opt.disabledTip ?? t('wheelSelect.unsupported')) : undefined"
          :disabled="opt.disabled"
          @click="onPick(i)"
        >
          <span class="ws-item-label">{{ opt.label ?? opt.value }}</span>
          <span v-if="opt.badge" class="ws-item-badge" :class="`is-${opt.badgeType ?? 'info'}`">
            {{ opt.badge }}
          </span>
        </button>
        <div class="ws-spacer" :style="{ height: `${spacerHeight}px` }" />
      </div>
      <div class="ws-indicator" />
      <div class="ws-fade ws-fade-top" />
      <div class="ws-fade ws-fade-bottom" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowDown, ArrowUp } from '@element-plus/icons-vue'
import { t } from '../../i18n'

/** 滚轮单栏选项：徽标用于标注「储备 / ACTIVE / Beta」等状态 */
export interface WheelOption {
  value: string
  label?: string
  badge?: string
  badgeType?: 'success' | 'warning' | 'info' | 'danger'
  /** 禁用项灰显：点击/吸附/滚轮步进均跳过（如 NeoForge 26.3 官方 Beta） */
  disabled?: boolean
  /** 禁用项悬停提示 */
  disabledTip?: string
}

const props = defineProps<{
  modelValue: string
  options: WheelOption[]
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

/** 单项固定高度，影响滚动吸附计算；面板至多可视 6 项 */
const ITEM_HEIGHT = 32
const MAX_VISIBLE = 6

/** 面板高度随选项数自适应：选项少时不再出现大片空白 */
const visibleCount = computed(() => Math.min(MAX_VISIBLE, Math.max(props.options.length, 1)))
const panelHeight = computed(() => visibleCount.value * ITEM_HEIGHT)
/** 上下留白使任意项可滚至正中（与 .ws-indicator 中心对齐） */
const spacerHeight = computed(() => (panelHeight.value - ITEM_HEIGHT) / 2)

const rootRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const expanded = ref(false)
/** 程序化滚动期间抑制滚动回调的二次发射 */
let programmatic = false
let settleTimer: ReturnType<typeof setTimeout> | null = null

const displayLabel = computed(() => {
  const hit = props.options.find((o) => o.value === props.modelValue)
  return hit?.label ?? props.modelValue ?? props.placeholder ?? t('wheelSelect.placeholder')
})

function toggle(): void {
  if (expanded.value) {
    collapse()
  } else {
    expand()
  }
}

function expand(): void {
  expanded.value = true
  document.addEventListener('mousedown', onOutside, true)
  document.addEventListener('keydown', onKeydown, true)
  void nextTick(() => scrollToValue(props.modelValue, false))
}

function collapse(): void {
  expanded.value = false
  document.removeEventListener('mousedown', onOutside, true)
  document.removeEventListener('keydown', onKeydown, true)
}

function onOutside(e: MouseEvent): void {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) collapse()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') collapse()
}

/** 从 rawIdx 向两侧找最近的非禁用项索引（无可用项返回 -1）；dirHint 决定等距时的优先方向 */
function nearestEnabledIndex(rawIdx: number, dirHint: 1 | -1 | 0 = 0): number {
  const n = props.options.length
  const start = Math.max(0, Math.min(n - 1, rawIdx))
  if (!props.options[start]?.disabled) return start
  for (let radius = 1; radius <= n; radius++) {
    const candidates = dirHint >= 0 ? [start + radius, start - radius] : [start - radius, start + radius]
    for (const idx of candidates) {
      if (idx >= 0 && idx < n && !props.options[idx]?.disabled) return idx
    }
  }
  return -1
}

/** 滚动结束后吸附到最近项，并把结果作为选中值发射；禁用项吸附到相邻可选项 */
function onScroll(): void {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    const list = listRef.value
    if (!list) return
    const idx = Math.round(list.scrollTop / ITEM_HEIGHT)
    const target = nearestEnabledIndex(idx)
    if (target < 0) return
    const expected = target * ITEM_HEIGHT
    if (Math.abs(list.scrollTop - expected) > 1) {
      programmatic = true
      list.scrollTo({ top: expected, behavior: 'smooth' })
    }
    const opt = props.options[target]
    if (opt && opt.value !== props.modelValue) emit('update:modelValue', opt.value)
    window.setTimeout(() => {
      programmatic = false
    }, 0)
  }, 80)
}

/** 滚轮事件：在可滚动范围内按整项步进；禁用项沿滚动方向继续跳过 */
function onWheel(e: WheelEvent): void {
  const list = listRef.value
  if (!list) return
  e.preventDefault()
  const dir = e.deltaY > 0 ? 1 : -1
  const current = Math.round(list.scrollTop / ITEM_HEIGHT)
  let target = Math.max(0, Math.min(props.options.length - 1, current + dir))
  while (props.options[target]?.disabled && target > 0 && target < props.options.length - 1) {
    target = Math.max(0, Math.min(props.options.length - 1, target + dir))
  }
  if (props.options[target]?.disabled) target = nearestEnabledIndex(target, dir as 1 | -1)
  if (target < 0) return
  programmatic = true
  list.scrollTo({ top: target * ITEM_HEIGHT, behavior: 'smooth' })
  window.setTimeout(() => {
    programmatic = false
  }, 120)
}

/** 点击某项：禁用项忽略；其余立即选中、吸附并收起 */
function onPick(index: number): void {
  const opt = props.options[index]
  if (!opt || opt.disabled) return
  programmatic = true
  listRef.value?.scrollTo({ top: index * ITEM_HEIGHT, behavior: 'smooth' })
  window.setTimeout(() => {
    programmatic = false
  }, 120)
  emit('update:modelValue', opt.value)
  collapse()
}

/** 把指定值滚动到正中（展开/外部联动时调用） */
function scrollToValue(value: string, smooth: boolean): void {
  const list = listRef.value
  if (!list) return
  const idx = Math.max(0, props.options.findIndex((o) => o.value === value))
  list.scrollTo({ top: idx * ITEM_HEIGHT, behavior: smooth ? 'smooth' : 'auto' })
}

// 外部切换选中值且面板展开时，跟随滚动定位
watch(
  () => props.modelValue,
  (v) => {
    if (expanded.value && !programmatic) scrollToValue(v, true)
  }
)

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onOutside, true)
  document.removeEventListener('keydown', onKeydown, true)
  if (settleTimer) clearTimeout(settleTimer)
})
</script>

<style scoped>
.wheel-select {
  position: relative;
  width: 100%;
}

.ws-trigger {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  border: 1px solid var(--ky-border);
  border-radius: var(--ky-radius-control);
  background: var(--ky-bg-base);
  color: var(--ky-text);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.ws-trigger:hover {
  border-color: var(--ky-accent);
}

.is-open .ws-trigger {
  border-color: var(--ky-accent);
}

.ws-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-value.is-placeholder {
  color: var(--ky-text-dim);
}

.ws-caret {
  flex-shrink: 0;
  color: var(--ky-text-dim);
}

/* 面板：至多 6 项高（高度由 :style 按选项数自适应），中心项为选中位 */
.ws-panel {
  position: absolute;
  z-index: 1200;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  background: var(--ky-bg-sidebar);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.38);
  overflow: hidden;
}

.ws-list {
  height: 100%;
  overflow-y: auto;
  scrollbar-width: none;
  overscroll-behavior: contain;
}

.ws-list::-webkit-scrollbar {
  display: none;
}

.ws-spacer {
  pointer-events: none;
}

.ws-item {
  height: 32px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--ky-text-sub);
  font-size: 12.5px;
  font-family: inherit;
  cursor: pointer;
  scroll-snap-align: center;
}

.ws-item:hover {
  background: var(--ky-bg-hover);
  color: var(--ky-text);
}

.ws-item.is-active {
  color: var(--ky-accent);
  font-weight: 600;
}

.ws-item.is-disabled,
.ws-item.is-disabled:hover {
  cursor: not-allowed;
  background: transparent;
  color: var(--ky-text-dim);
  opacity: 0.45;
}

.ws-item.is-disabled .ws-item-badge {
  background: rgba(137, 180, 250, 0.14);
  color: #89b4fa;
}

.ws-item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-item-badge {
  flex-shrink: 0;
  font-size: 9.5px;
  line-height: 15px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--ky-bg-hover);
  color: var(--ky-text-dim);
}

.ws-item-badge.is-success {
  background: rgba(var(--ky-accent-rgb), 0.16);
  color: var(--ky-accent);
}

.ws-item-badge.is-warning {
  background: rgba(249, 226, 175, 0.16);
  color: #f9e2af;
}

.ws-item-badge.is-info {
  background: rgba(137, 180, 250, 0.16);
  color: #89b4fa;
}

.ws-item-badge.is-danger {
  background: rgba(243, 139, 168, 0.16);
  color: #f38ba8;
}

/* 中心选中指示条 */
.ws-indicator {
  position: absolute;
  left: 6px;
  right: 6px;
  top: 50%;
  height: 32px;
  transform: translateY(-50%);
  border: 1px solid color-mix(in srgb, var(--ky-accent) 45%, transparent);
  border-radius: 6px;
  pointer-events: none;
}

/* 上下渐隐遮罩（小面板内不超过 40%，避免盖住唯一选项） */
.ws-fade {
  position: absolute;
  left: 0;
  right: 0;
  height: min(56px, 40%);
  pointer-events: none;
}

.ws-fade-top {
  top: 0;
  background: linear-gradient(to bottom, var(--ky-bg-sidebar) 18%, transparent);
}

.ws-fade-bottom {
  bottom: 0;
  background: linear-gradient(to top, var(--ky-bg-sidebar) 18%, transparent);
}
</style>
