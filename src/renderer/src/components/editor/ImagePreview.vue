<template>
  <div class="image-preview">
    <div class="ip-toolbar">
      <span class="ip-info">{{ name }}</span>
      <span v-if="naturalWidth" class="ip-dim">{{ naturalWidth }} × {{ naturalHeight }}</span>
      <div class="ip-actions">
        <el-button-group size="small">
          <el-button :icon="ZoomOut" @click="zoomOut" :title="t('imagePreview.zoomOut')" />
          <el-button @click="zoomReset" :title="t('imagePreview.actualSize')">{{ Math.round(scale * 100) }}%</el-button>
          <el-button :icon="ZoomIn" @click="zoomIn" :title="t('imagePreview.zoomIn')" />
          <el-button :icon="FullScreen" @click="zoomFit" :title="t('imagePreview.fitWindow')" />
        </el-button-group>
        <el-checkbox
          v-model="pixelated"
          size="small"
          class="ip-pixelated"
          :title="t('imagePreview.pixelatedTip')"
          >{{ t('imagePreview.pixelated') }}</el-checkbox
        >
      </div>
    </div>
    <div ref="stageRef" class="ip-stage" @wheel.ctrl.prevent="onWheel">
      <img
        :src="dataUrl"
        class="ip-img"
        :class="{ pixelated }"
        :style="{ width: displayWidth + 'px' }"
        @load="onLoad"
        alt=""
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { FullScreen, ZoomIn, ZoomOut } from '@element-plus/icons-vue'
import { t } from '../../i18n'

const props = defineProps<{
  /** 图片 data URL */
  dataUrl: string
  /** 文件名（工具栏展示） */
  name: string
}>()

const stageRef = ref<HTMLElement | null>(null)
const naturalWidth = ref(0)
const naturalHeight = ref(0)
/** 用户显式缩放比例；null = 适应窗口 */
const manualScale = ref<number | null>(null)
const stageSize = ref({ w: 0, h: 0 })
/** 像素级渲染（image-rendering: pixelated），默认开——MC 贴图都是像素画 */
const pixelated = ref(true)

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (stageRef.value) {
    stageSize.value = { w: stageRef.value.clientWidth, h: stageRef.value.clientHeight }
    resizeObserver = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) stageSize.value = { w: r.width, h: r.height }
    })
    resizeObserver.observe(stageRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
})

const fitScale = computed(() => {
  if (!naturalWidth.value || !naturalHeight.value) return 1
  const pad = 32
  const sw = (stageSize.value.w - pad) / naturalWidth.value
  const sh = (stageSize.value.h - pad) / naturalHeight.value
  if (sw <= 0 || sh <= 0) return 1
  // 小图（贴图）适应窗口时允许放大，上限 8 倍防止 16×16 糊满屏
  return Math.min(sw, sh, 8)
})

const scale = computed(() => manualScale.value ?? fitScale.value)
const displayWidth = computed(() => Math.max(1, Math.round(naturalWidth.value * scale.value)))

function onLoad(e: Event): void {
  const img = e.target as HTMLImageElement
  naturalWidth.value = img.naturalWidth
  naturalHeight.value = img.naturalHeight
}

function zoomIn(): void {
  manualScale.value = Math.min(scale.value * 1.25, 32)
}
function zoomOut(): void {
  manualScale.value = Math.max(scale.value / 1.25, 0.02)
}
function zoomReset(): void {
  manualScale.value = 1
}
function zoomFit(): void {
  manualScale.value = null
}
function onWheel(e: WheelEvent): void {
  if (e.deltaY < 0) zoomIn()
  else zoomOut()
}

void props
</script>

<style scoped>
.image-preview {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-panel);
}
.ip-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--ky-border);
  flex-shrink: 0;
}
.ip-info {
  font-size: 12.5px;
  color: var(--ky-text);
  font-weight: 500;
}
.ip-dim {
  font-size: 12px;
  color: var(--ky-text-dim);
}
.ip-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
}
.ip-pixelated {
  margin-left: 4px;
}
.ip-stage {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 棋盘格背景：透明 PNG 可见 */
  background-image:
    linear-gradient(45deg, #3a3a3a 25%, transparent 25%),
    linear-gradient(-45deg, #3a3a3a 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #3a3a3a 75%),
    linear-gradient(-45deg, transparent 75%, #3a3a3a 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-color: #2d2d2d;
}
.ip-img {
  image-rendering: auto;
  flex-shrink: 0;
}
.ip-img.pixelated {
  image-rendering: pixelated;
}
</style>
