<!--
  贴图工坊 · AI 重绘弹窗（A3）
  - 整图重绘 / mask 局部重绘（红色涂抹区域才交给 AI）
  - 一次出 n 个候选（默认 4），画廊点选即时换 3D 预览
  - 只有点「采用此候选」才把像素写回父组件；取消不落盘
  - Key/额度全部来自用户在设置里配置的图像供应商，工作台不内置云端
-->
<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('unified.repaint.title')"
    width="720px"
    append-to-body
    class="rp-dialog"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @open="onOpen"
  >
    <div class="rp-body">
      <!-- 左栏：需求 + 蒙版 -->
      <section class="rp-left">
        <el-input
          v-model="prompt"
          type="textarea"
          :rows="3"
          maxlength="400"
          show-word-limit
          :placeholder="t('unified.repaint.promptPlaceholder')"
        />
        <div class="rp-row">
          <span class="rp-label">{{ t('unified.repaint.candidateCount') }}</span>
          <el-radio-group v-model="candidateCount" size="small">
            <el-radio-button :value="1">{{ t('unified.repaint.option1') }}</el-radio-button>
            <el-radio-button :value="2">{{ t('unified.repaint.option2') }}</el-radio-button>
            <el-radio-button :value="4">{{ t('unified.repaint.option4') }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="rp-row">
          <span class="rp-label">{{ t('unified.repaint.maskMode') }}</span>
          <el-switch
            v-model="maskMode"
            inline-prompt
            :active-text="t('unified.repaint.maskOn')"
            :inactive-text="t('unified.repaint.maskOff')"
          />
        </div>

        <div v-if="maskMode" class="rp-mask-wrap">
          <div class="rp-mask-stage" :style="stageStyle">
            <!-- 底图：当前贴图 -->
            <canvas ref="baseCanvasRef" class="rp-mask-canvas" :style="canvasStyle" />
            <!-- 蒙版：红色半透明 -->
            <canvas ref="maskCanvasRef" class="rp-mask-canvas" :style="canvasStyle" />
            <!-- 事件层：透明接手势 -->
            <canvas
              class="rp-mask-canvas rp-mask-input"
              :style="canvasStyle"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointerleave="onPointerUp"
            />
          </div>
          <div class="rp-mask-actions">
            <el-button size="small" @click="fillMask">{{ t('unified.repaint.selectAll') }}</el-button>
            <el-button size="small" @click="clearMask">{{ t('unified.repaint.clear') }}</el-button>
          </div>
          <p class="rp-tip">{{ t('unified.repaint.maskTip') }}</p>
        </div>

        <div class="rp-post">
          <div class="rp-post-title">
            {{ t(repixelizing ? 'unified.repaint.postBusy' : 'unified.repaint.postTitle') }}
          </div>
          <div class="rp-row">
            <span class="rp-label">{{ t('unified.repaint.colors') }}</span>
            <el-input-number
              v-model="maxColors"
              :min="2"
              :max="64"
              :step="4"
              size="small"
              controls-position="right"
              class="rp-num"
              @change="scheduleRepixelize"
            />
            <span class="rp-label">{{ t('unified.repaint.dither') }}</span>
            <el-switch
              v-model="ditherOn"
              size="small"
              inline-prompt
              :active-text="t('unified.repaint.on')"
              :inactive-text="t('unified.repaint.off')"
              @change="scheduleRepixelize"
            />
          </div>
          <div class="rp-row">
            <span class="rp-label">{{ t('unified.repaint.outline') }}</span>
            <el-switch v-model="outline" size="small" @change="scheduleRepixelize" />
            <el-slider
              v-if="outline"
              v-model="outlineFactor"
              :min="0"
              :max="1"
              :step="0.1"
              :show-tooltip="false"
              class="rp-slider"
              @change="scheduleRepixelize"
            />
          </div>
          <div class="rp-row">
            <span class="rp-label">{{ t('unified.repaint.downsample') }}</span>
            <el-radio-group v-model="downsample" size="small" @change="scheduleRepixelize">
              <el-radio-button value="area">{{ t('unified.repaint.average') }}</el-radio-button>
              <el-radio-button value="nearest">{{ t('unified.repaint.nearest') }}</el-radio-button>
            </el-radio-group>
          </div>
          <div class="rp-row">
            <span class="rp-label">{{ t('unified.repaint.projectPalette') }}</span>
            <el-switch
              v-model="lockPalette"
              size="small"
              :disabled="projectPalette.length === 0"
              @change="onPaletteLockChange"
            />
            <el-button
              size="small"
              text
              type="primary"
              :disabled="!projectRoot"
              @click="savePaletteFromTexture"
            >
              {{ t('unified.repaint.savePalette') }}
            </el-button>
          </div>
          <div v-if="projectPalette.length > 0" class="rp-palette">
            <span
              v-for="c in projectPalette"
              :key="c"
              class="rp-swatch"
              :style="{ background: c }"
            />
            <span class="rp-palette-n">{{ t('unified.repaint.paletteCount', { n: projectPalette.length }) }}</span>
          </div>
          <p class="rp-tip rp-post-tip">
            {{
              lockPalette && projectPalette.length > 0
                ? t('unified.repaint.paletteLockedTip')
                : t('unified.repaint.paletteUnlockedTip')
            }}
          </p>
        </div>

        <el-button
          type="primary"
          :loading="loading"
          class="rp-generate"
          @click="onGenerate"
        >
          {{ loading ? t('unified.repaint.generating') : t('unified.repaint.generate') }}
        </el-button>
        <p v-if="errorText" class="rp-error">{{ errorText }}</p>
        <p v-for="(w, i) in warnings" :key="i" class="rp-warn">⚠ {{ w }}</p>
      </section>

      <!-- 右栏：画廊 + 即时 3D -->
      <section class="rp-right">
        <div v-if="variants.length === 0" class="rp-empty">
          <el-icon :size="28"><PictureFilled /></el-icon>
          <span>{{ t('unified.repaint.emptyHint', { n: candidateCount }) }}</span>
        </div>
        <template v-else>
          <div class="rp-gallery" :class="`rp-gallery-${variantCols}`">
            <button
              v-for="(v, i) in variants"
              :key="i"
              type="button"
              class="rp-thumb"
              :class="{ 'rp-thumb-active': i === selected }"
              @click="selected = i"
            >
              <img :src="v.dataUrl" :alt="t('unified.repaint.candidateAlt', { n: i + 1 })" draggable="false" />
              <span class="rp-thumb-no">{{ i + 1 }}</span>
            </button>
          </div>
          <ModelPreview
            :pixels="selectedVariant ? selectedVariant.pixels : pixels"
            :shape="shape"
          />
          <details class="rp-ascii">
            <summary>{{ t('unified.repaint.asciiSummary', { n: selected + 1 }) }}</summary>
            <pre>{{ selectedVariant ? selectedVariant.ascii : '' }}</pre>
          </details>
        </template>
      </section>
    </div>

    <template #footer>
      <el-button @click="close">{{ t('common.cancel') }}</el-button>
      <el-button
        type="primary"
        :disabled="!selectedVariant"
        @click="onApply"
      >
        {{ t('unified.repaint.apply', { n: selectedVariant ? selected + 1 : '' }) }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { PictureFilled } from '@element-plus/icons-vue'
import ModelPreview from '../modeler/preview/ModelPreview.vue'
import { useProjectStore } from '../../stores/project'
import type {
  GalleryAssetKind,
  TexturePaletteDto,
  TexturePixelizeOptions,
  TextureRepaintVariantDto
} from '../../../../shared/types/ipc'
import { t } from '../../i18n'

const props = defineProps<{
  modelValue: boolean
  size: 16 | 32
  pixels: string[]
  /** 3D 预览形态：方块/模型用 cube，物品/实体用 plane */
  shape: 'cube' | 'plane'
  /** 指定项目根：画廊跨项目复用时指向该画所属项目；缺省用当前打开的项目 */
  root?: string
  /** 本次出图的目标资产类型（工坊里带当前对象打开时传入）；缺省 free = 未绑定 */
  assetKind?: GalleryAssetKind
  /** 本次出图的目标资产 id（缺省 '' = 未绑定） */
  assetId?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 用户确认采用某个候选：size*size 项语义像素 */
  applied: [pixels: string[]]
}>()

const MASK_DISPLAY = 192

const prompt = ref('')
const candidateCount = ref(4)
const maskMode = ref(false)
const loading = ref(false)
const errorText = ref('')
const warnings = ref<string[]>([])
const variants = ref<TextureRepaintVariantDto[]>([])
const selected = ref(0)
/** 蒙版像素：true=重绘 */
const mask = ref<boolean[]>([])

const baseCanvasRef = ref<HTMLCanvasElement | null>(null)
const maskCanvasRef = ref<HTMLCanvasElement | null>(null)

const projectStore = useProjectStore()
const projectRoot = computed(() => props.root ?? projectStore.currentProject?.path ?? null)

/* 像素化后处理参数：改这些参数只本地重跑像素化（复用候选的 AI 大图），不消耗 AI 额度 */
const maxColors = ref(32)
const ditherOn = ref(true)
const outline = ref(true)
const outlineFactor = ref(0.5)
const downsample = ref<'area' | 'nearest'>('area')
/** 项目级色板（.kunyu/texture-palette.json，同项目贴图共用取色） */
const projectPalette = ref<string[]>([])
const lockPalette = ref(false)
const repixelizing = ref(false)
/** 每个候选最近一次本地重跑所用的参数签名：签名一致就跳过重算 */
const repixelSig = ref<string[]>([])
/** sourceToken 已失效的候选下标，不再尝试重跑 */
const expiredIdx = ref<number[]>([])

const selectedVariant = computed<TextureRepaintVariantDto | null>(
  () => variants.value[selected.value] ?? null
)
const variantCols = computed(() => (candidateCount.value === 1 ? 1 : 2))
const stageStyle = computed(() => ({
  width: `${MASK_DISPLAY}px`,
  height: `${MASK_DISPLAY}px`
}))
const canvasStyle = computed(() => ({
  width: `${MASK_DISPLAY}px`,
  height: `${MASK_DISPLAY}px`,
  imageRendering: 'pixelated' as const
}))

function onOpen(): void {
  prompt.value = ''
  candidateCount.value = 4
  maskMode.value = false
  loading.value = false
  errorText.value = ''
  warnings.value = []
  variants.value = []
  selected.value = 0
  mask.value = new Array(props.size * props.size).fill(false)
  repixelSig.value = []
  expiredIdx.value = []
  repixelizing.value = false
  void loadProjectPalette()
  void nextTick(() => drawBase())
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      mask.value = new Array(props.size * props.size).fill(false)
      void nextTick(() => drawBase())
    }
  }
)

watch(maskMode, (on) => {
  if (on) void nextTick(() => drawAll())
})

watch(
  () => props.size,
  () => {
    mask.value = new Array(props.size * props.size).fill(false)
    void nextTick(() => drawAll())
  }
)

function close(): void {
  emit('update:modelValue', false)
}

/* ---------------- 蒙版绘制 ---------------- */

function drawBase(): void {
  const canvas = baseCanvasRef.value
  if (!canvas) return
  canvas.width = props.size
  canvas.height = props.size
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, props.size, props.size)
  for (let i = 0; i < props.pixels.length; i++) {
    const hex = props.pixels[i]
    if (!hex) continue
    ctx.fillStyle = hex
    ctx.fillRect(i % props.size, Math.floor(i / props.size), 1, 1)
  }
}

function drawMask(): void {
  const canvas = maskCanvasRef.value
  if (!canvas) return
  canvas.width = props.size
  canvas.height = props.size
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, props.size, props.size)
  ctx.fillStyle = 'rgba(255, 64, 64, 0.55)'
  for (let i = 0; i < mask.value.length; i++) {
    if (!mask.value[i]) continue
    ctx.fillRect(i % props.size, Math.floor(i / props.size), 1, 1)
  }
}

function drawAll(): void {
  drawBase()
  drawMask()
}

function clearMask(): void {
  mask.value = new Array(props.size * props.size).fill(false)
  drawMask()
}

function fillMask(): void {
  mask.value = new Array(props.size * props.size).fill(true)
  drawMask()
}

/** 一次拖动内的笔刷模式：按下时该格有蒙版=擦除，无=涂抹 */
let dragPaint = true
let dragging = false

function eventIndex(e: PointerEvent): number | null {
  const target = e.currentTarget as HTMLCanvasElement
  const rect = target.getBoundingClientRect()
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * props.size)
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * props.size)
  if (x < 0 || y < 0 || x >= props.size || y >= props.size) return null
  return y * props.size + x
}

function onPointerDown(e: PointerEvent): void {
  const idx = eventIndex(e)
  if (idx === null) return
  ;(e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId)
  dragging = true
  dragPaint = !mask.value[idx]
  mask.value[idx] = dragPaint
  drawMask()
}

function onPointerMove(e: PointerEvent): void {
  if (!dragging) return
  const idx = eventIndex(e)
  if (idx === null || mask.value[idx] === dragPaint) return
  mask.value[idx] = dragPaint
  drawMask()
}

function onPointerUp(): void {
  dragging = false
}

/* ---------------- 像素化后处理 + 项目色板 ---------------- */

/** 当前后处理参数（锁定项目色板时把色板一并带上） */
function buildOptions(): TexturePixelizeOptions {
  return {
    maxColors: maxColors.value,
    dither: ditherOn.value ? 'floyd' : 'none',
    outline: outline.value,
    outlineFactor: outlineFactor.value,
    downsample: downsample.value,
    ...(lockPalette.value && projectPalette.value.length > 0
      ? { palette: [...projectPalette.value] }
      : {})
  }
}

function currentSig(): string {
  return JSON.stringify(buildOptions())
}

let repixelTimer: ReturnType<typeof setTimeout> | null = null

/** 参数连续拖动时防抖：停手 300ms 后再本地重跑一次 */
function scheduleRepixelize(): void {
  if (repixelTimer !== null) clearTimeout(repixelTimer)
  repixelTimer = setTimeout(() => {
    repixelTimer = null
    void repixelizeSelected()
  }, 300)
}

/** 用当前选中候选的 sourceToken 回到 AI 大图重新像素化，原地替换该候选产物 */
async function repixelizeSelected(): Promise<void> {
  const idx = selected.value
  const v = variants.value[idx]
  if (!v || !v.sourceToken) return
  if (expiredIdx.value.includes(idx)) return
  const sig = currentSig()
  if (repixelSig.value[idx] === sig) return
  repixelizing.value = true
  try {
    const res = await window.api.content.texturePixelize({
      sourceToken: v.sourceToken,
      size: props.size,
      options: buildOptions()
    })
    if (!res.ok) {
      if (!expiredIdx.value.includes(idx)) expiredIdx.value.push(idx)
      ElMessage.warning(res.errorMessage)
      return
    }
    variants.value[idx] = {
      ...v,
      pixels: res.variant.pixels,
      dataUrl: res.variant.dataUrl,
      palette: res.variant.palette,
      ascii: res.variant.ascii
    }
    repixelSig.value[idx] = sig
  } catch (err) {
    ElMessage.warning(t('unified.repaint.localRepixelFailed', { error: (err as Error).message }))
  } finally {
    repixelizing.value = false
  }
}

watch(selected, () => void repixelizeSelected())

/** 读取项目级色板与像素化偏好；无项目/读取失败一律按默认值 */
async function loadProjectPalette(): Promise<void> {
  const root = projectRoot.value
  if (!root) {
    projectPalette.value = []
    lockPalette.value = false
    return
  }
  try {
    const p: TexturePaletteDto = await window.api.content.texturePaletteGet(root)
    maxColors.value = p.maxColors
    ditherOn.value = p.dither === 'floyd'
    outline.value = p.outline
    outlineFactor.value = p.outlineFactor
    downsample.value = p.downsample
    projectPalette.value = p.palette
    // 已存过色板即默认锁定，保证同项目贴图取色一致
    lockPalette.value = p.palette.length > 0
  } catch {
    projectPalette.value = []
    lockPalette.value = false
  }
}

/** 把当前贴图的不重复颜色存为项目色板，并连同当前参数一起落盘 */
async function savePaletteFromTexture(): Promise<void> {
  const root = projectRoot.value
  if (!root) return
  const colors: string[] = []
  const seen = new Set<string>()
  for (const hex of props.pixels) {
    if (!hex || seen.has(hex)) continue
    seen.add(hex)
    colors.push(hex)
    if (colors.length >= 64) break
  }
  if (colors.length === 0) {
    ElMessage.warning(t('unified.repaint.noColor'))
    return
  }
  try {
    const p = await window.api.content.texturePaletteSet(root, {
      palette: colors,
      maxColors: maxColors.value,
      dither: ditherOn.value ? 'floyd' : 'none',
      outline: outline.value,
      outlineFactor: outlineFactor.value,
      downsample: downsample.value
    })
    projectPalette.value = p.palette
    lockPalette.value = p.palette.length > 0
    void repixelizeSelected()
    ElMessage.success(t('unified.repaint.paletteSaved', { n: p.palette.length }))
  } catch (err) {
    ElMessage.warning(t('unified.repaint.paletteSaveFailed', { error: (err as Error).message }))
  }
}

function onPaletteLockChange(): void {
  void repixelizeSelected()
}

onBeforeUnmount(() => {
  if (repixelTimer !== null) clearTimeout(repixelTimer)
})

/* ---------------- 生成与采用 ---------------- */

async function onGenerate(): Promise<void> {
  if (!prompt.value.trim()) {
    ElMessage.warning(t('unified.repaint.promptRequired'))
    return
  }
  let flags: boolean[] | undefined
  if (maskMode.value) {
    flags = mask.value
    if (!flags.some(Boolean)) {
      ElMessage.warning(t('unified.repaint.maskRequired'))
      return
    }
  }
  loading.value = true
  errorText.value = ''
  warnings.value = []
  try {
    const res = await window.api.content.textureRepaint({
      size: props.size,
      // 永远以打开弹窗前的贴图为底稿，避免反复生成造成漂移
      pixels: props.pixels,
      prompt: prompt.value.trim(),
      n: candidateCount.value,
      pixelize: buildOptions(),
      ...(flags ? { maskFlags: flags } : {})
    })
    if (!res.ok) {
      errorText.value = res.errorMessage
      variants.value = []
      return
    }
    if (res.variants.length === 0) {
      errorText.value = t('unified.repaint.noVariants')
      return
    }
    variants.value = res.variants
    warnings.value = res.warnings
    selected.value = 0
    // 首批候选已按当前参数像素化，签名打齐避免立即重复本地重跑
    const sig = currentSig()
    repixelSig.value = res.variants.map(() => sig)
    expiredIdx.value = []
    // 全部候选入库画廊：AI 产出的每张都是资产，关掉弹窗也不会丢，之后可零额度复用
    void saveToGallery(res.variants)
  } catch (err) {
    errorText.value = t('unified.repaint.callFailed', { error: (err as Error).message })
    variants.value = []
  } finally {
    loading.value = false
  }
}

/**
 * 把本次 AI 候选全部入库项目画廊（.kunyu/gallery/）。
 * 工坊里带当前对象打开弹窗时（assetKind/assetId 已传入），入库即标注目标资产；
 * 画廊里二次编辑（未传）按「未绑定资产」存档，开发者可在画廊里手动选目标写回。
 * 均为零 AI 额度消耗，入库失败不影响出图本身。
 */
async function saveToGallery(list: TextureRepaintVariantDto[]): Promise<void> {
  const root = projectRoot.value
  if (!root || list.length === 0) return
  try {
    await window.api.content.gallerySave(
      root,
      list.map((v) => ({
        assetKind: props.assetKind ?? 'free',
        assetId: props.assetKind && props.assetKind !== 'free' ? (props.assetId ?? '') : '',
        size: props.size,
        prompt: prompt.value.trim(),
        origin: 'workshop' as const,
        palette: v.palette,
        pixels: v.pixels
      }))
    )
  } catch {
    // 静默：画廊入库失败不应打断出图流程
  }
}

function onApply(): void {
  const v = selectedVariant.value
  if (!v) return
  emit('applied', v.pixels)
  close()
}
</script>

<style scoped>
.rp-body {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 18px;
  min-height: 420px;
}
.rp-left {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.rp-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rp-label {
  font-size: 12px;
  color: var(--ky-text-dim);
  white-space: nowrap;
}
.rp-mask-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.rp-mask-stage {
  position: relative;
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  background-color: #1a1c20;
  background-image:
    linear-gradient(45deg, #383b41 25%, transparent 25%),
    linear-gradient(-45deg, #383b41 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #383b41 75%),
    linear-gradient(-45deg, transparent 75%, #383b41 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.rp-mask-canvas {
  position: absolute;
  inset: 0;
  display: block;
}
.rp-mask-input {
  z-index: 2;
  cursor: crosshair;
  touch-action: none;
}
.rp-mask-actions {
  display: flex;
  gap: 6px;
}
.rp-post {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--ky-border);
  border-radius: 6px;
}
.rp-post-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--ky-text-dim);
}
.rp-post .rp-row {
  gap: 8px;
}
.rp-num {
  width: 84px;
}
.rp-slider {
  flex: 1;
  min-width: 70px;
}
.rp-palette {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
}
.rp-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid var(--ky-border);
}
.rp-palette-n {
  margin-left: 2px;
  font-size: 11px;
  color: var(--ky-text-dim);
}
.rp-post-tip {
  margin: 0;
  text-align: left;
}
.rp-generate {
  margin-top: 2px;
}
.rp-tip {
  margin: 0;
  font-size: 11px;
  color: var(--ky-text-dim);
  text-align: center;
  line-height: 1.5;
}
.rp-error {
  margin: 0;
  font-size: 12px;
  color: #f38ba8;
  line-height: 1.5;
}
.rp-warn {
  margin: 0;
  font-size: 11px;
  color: #f9e2af;
  line-height: 1.5;
}
.rp-right {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.rp-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ky-text-dim);
  font-size: 12px;
  text-align: center;
  padding: 0 24px;
}
.rp-gallery {
  display: grid;
  gap: 8px;
  width: 100%;
  max-width: 360px;
}
.rp-gallery-1 {
  grid-template-columns: 1fr;
  max-width: 180px;
}
.rp-gallery-2 {
  grid-template-columns: 1fr 1fr;
}
.rp-thumb {
  position: relative;
  padding: 0;
  border: 2px solid var(--ky-border);
  border-radius: 6px;
  background: #1a1c20;
  cursor: pointer;
  overflow: hidden;
  aspect-ratio: 1;
}
.rp-thumb:hover {
  border-color: var(--ky-text-dim);
}
.rp-thumb-active {
  border-color: #89b4fa;
  box-shadow: 0 0 0 2px rgba(137, 180, 250, 0.35);
}
.rp-thumb img {
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  display: block;
}
.rp-thumb-no {
  position: absolute;
  left: 4px;
  top: 2px;
  font-size: 10px;
  font-family: var(--ky-mono, monospace);
  color: var(--ky-text);
  background: rgba(0, 0, 0, 0.55);
  border-radius: 3px;
  padding: 0 4px;
}
.rp-ascii {
  width: 100%;
  max-width: 360px;
  font-size: 11px;
}
.rp-ascii pre {
  margin: 4px 0 0;
  font-family: var(--ky-mono, monospace);
  font-size: 10px;
  line-height: 1.25;
  color: var(--ky-text-dim);
  white-space: pre;
  overflow-x: auto;
}
</style>
