<template>
  <div class="rtp">
    <header class="rtp-head">
      <code class="rtp-path">{{ displayPath }}</code>
      <span v-if="dirty" class="rtp-dirty" :title="t('resourcepack.unsaved')" />
      <div class="rtp-actions">
        <el-button size="small" :disabled="!dirty" @click="onDiscard">{{ t('resourcepack.discard') }}</el-button>
        <el-button
          size="small"
          type="primary"
          :disabled="!canSave"
          :loading="saving"
          @click="onSave"
        >
          <el-icon><Check /></el-icon> {{ t('resourcepack.save') }}
        </el-button>
      </div>
    </header>

    <!-- 新建参数 -->
    <div v-if="!file" class="rtp-new">
      <template v-if="subDirs.length > 0">
        <label class="rtp-label">{{ t('resourcepack.subDir') }}</label>
        <el-select v-model="sub" size="small" class="rtp-sub">
          <el-option value="" :label="t('resourcepack.noSubDir')" />
          <el-option v-for="s in subDirs" :key="s" :value="s" :label="s" />
        </el-select>
      </template>
      <label class="rtp-label">{{ t('resourcepack.fileName') }}</label>
      <el-input v-model="name" size="small" class="rtp-name" :placeholder="t('resourcepack.texture.namePlaceholder')" />
      <span class="rtp-hint">{{ t('resourcepack.texture.nameRule') }}</span>
    </div>

    <!-- 工具条 -->
    <div class="rtp-toolbar">
      <el-radio-group
        :model-value="ed.tool.value"
        size="small"
        class="rtp-tools"
        @update:model-value="onToolChange"
      >
        <el-radio-button v-for="opt in TOOL_OPTIONS" :key="opt" :value="opt">
          {{ toolLabel(opt) }}
        </el-radio-button>
      </el-radio-group>

      <el-tooltip :content="t('resourcepack.texture.undo')" placement="bottom">
        <el-button size="small" :disabled="!ed.canUndo.value" @click="ed.undo()">
          <el-icon><RefreshLeft /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip :content="t('resourcepack.texture.redo')" placement="bottom">
        <el-button size="small" :disabled="!ed.canRedo.value" @click="ed.redo()">
          <el-icon><RefreshRight /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip :content="t('resourcepack.texture.clear')" placement="bottom">
        <el-button size="small" @click="onClear">
          <el-icon><Delete /></el-icon>
        </el-button>
      </el-tooltip>

      <div class="rtp-spacer" />

      <el-tooltip :content="t('resourcepack.texture.grid')" placement="bottom">
        <el-button
          size="small"
          :class="{ 'is-on': ed.showGrid.value }"
          @click="ed.showGrid.value = !ed.showGrid.value"
        >
          <el-icon><Grid /></el-icon>
        </el-button>
      </el-tooltip>
      <div class="rtp-zoom">
        <el-button size="small" :title="t('resourcepack.texture.zoomOut')" @click="zoomBy(-1)">
          <el-icon><ZoomOut /></el-icon>
        </el-button>
        <span class="rtp-zoom-value" :title="t('resourcepack.texture.fitWindow')" @click="onResetZoom">
          {{ ed.zoom.value * 100 }}%
        </span>
        <el-button size="small" :title="t('resourcepack.texture.zoomIn')" @click="zoomBy(1)">
          <el-icon><ZoomIn /></el-icon>
        </el-button>
      </div>
    </div>

    <div class="rtp-body">
      <div ref="canvasAreaRef" class="rtp-canvas-area">
        <TextureCanvas
          :width="ed.width.value"
          :height="ed.height.value"
          :pixels="doc.pixels"
          :zoom="ed.zoom.value"
          :show-grid="ed.showGrid.value"
          :draft="ed.draft.value"
          :tool="ed.tool.value"
          :color="ed.color.value"
          @start="ed.strokeStart"
          @move="ed.strokeMove"
          @end="ed.strokeEnd"
          @zoom="onWheelZoom"
        />
      </div>

      <aside class="rtp-side">
        <section class="rtp-section">
          <h4 class="rtp-title">{{ t('resourcepack.texture.canvasSize') }}</h4>
          <el-radio-group
            :model-value="sizeKey"
            size="small"
            class="rtp-sizes"
            @update:model-value="onSizeChange"
          >
            <el-radio-button v-if="customSize" :value="customSize">{{ customSize }}</el-radio-button>
            <el-radio-button v-for="s in TEXTURE_SIZE_OPTIONS" :key="s.label" :value="s.label">
              {{ s.label }}
            </el-radio-button>
          </el-radio-group>
          <p class="rtp-tip">{{ t('resourcepack.texture.resizeTip') }}</p>
        </section>

        <section class="rtp-section">
          <h4 class="rtp-title">{{ t('resourcepack.texture.preview') }}</h4>
          <div class="rtp-preview-box">
            <canvas
              ref="previewRef"
              class="rtp-preview-canvas"
              :width="ed.width.value"
              :height="ed.height.value"
            />
          </div>
          <p class="rtp-tip">{{ t('resourcepack.texture.previewTip', { w: ed.width.value, h: ed.height.value }) }}</p>
        </section>
      </aside>
    </div>

    <!-- 调色板：常驻画布下方，窄窗口（右侧栏被隐藏时）同样可见 -->
    <footer class="rtp-palette">
      <el-color-picker v-model="ed.color.value" size="small" show-alpha />
      <div class="rtp-swatches">
        <button
          v-for="c in PALETTE"
          :key="c"
          class="rtp-swatch"
          :class="{ 'is-current': sameColor(ed.color.value, c) }"
          :style="{ background: c }"
          :title="c"
          @click="ed.color.value = c"
        />
      </div>
      <template v-if="ed.recentColors.value.length > 0">
        <span class="rtp-palette-sep" />
        <div class="rtp-swatches">
          <button
            v-for="c in ed.recentColors.value"
            :key="`recent-${c}`"
            class="rtp-swatch"
            :style="{ background: c }"
            :title="t('resourcepack.texture.recentColor', { color: c })"
            @click="ed.color.value = c"
          />
        </div>
      </template>
      <code class="rtp-color-hex">{{ ed.color.value }}</code>
    </footer>
  </div>
</template>

<script setup lang="ts">
/**
 * ResourceTexturePanel：资源包编辑器中的材质（PNG）像素画编辑器。
 * 承接原小白模式「新建材质」能力：新建/打开 assets/<ns>/textures/**\/*.png，
 * 直接以原尺寸解码为像素画编辑，保存即写回 PNG 二进制。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Check,
  Delete,
  Grid,
  RefreshLeft,
  RefreshRight,
  ZoomIn,
  ZoomOut
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ResourcePackFile } from '../../../../shared/schemas/resourcepack.schema'
import { resourceCategoryInfo } from '../../../../shared/schemas/resourcepack.schema'
import { TEXTURE_SIZE_OPTIONS, resizePixels } from '../../../../shared/schemas/texture.schema'
import type { PackLayoutMode } from '../../../../shared/types/ipc'
import TextureCanvas from '../../components/texture/TextureCanvas.vue'
import { useTextureEditor, type PixelCanvasDoc, type TextureTool } from './texture/useTextureEditor'
import { t } from '../../i18n'

const props = defineProps<{
  root: string
  mode: PackLayoutMode
  namespace: string
  /** 包内路径展示前缀（embedded 为 resourcepacks/<id>/，standalone 为空） */
  pathPrefix: string
  /** 已有贴图文件；新建时为 null */
  file: ResourcePackFile | null
  subDirs: string[]
}>()

const emit = defineEmits<{
  (e: 'saved', file: ResourcePackFile): void
  (e: 'dirty', value: boolean): void
}>()

const DEFAULT_SIZE = 16

/** 常驻调色板：Minecraft 常用色系（灰阶 / 肤色棕 / 暖红 / 草木绿 / 青蓝 / 紫粉） */
const PALETTE = [
  '#ffffff', '#d9d9d9', '#a6a6a6', '#737373', '#404040', '#1a1a1a',
  '#f2d6c9', '#e0b090', '#c08457', '#8c5a3c', '#5a3a28', '#2b1a12',
  '#d94f4f', '#f27b5a', '#f2a65a', '#f2d15a', '#a8c85a', '#5aa85a',
  '#3e8e5a', '#2b6e6e', '#2e5a8c', '#3e6ed9', '#6a8cf2', '#9db8f2',
  '#6a3d9a', '#9a5ac0', '#d67ad6', '#f2a6d6', '#f2c6e0', '#e0d6f2'
]

/** 色值比较：忽略 alpha 段与大小写（取色器可能返回 #RRGGBBAA） */
function sameColor(a: string, b: string): boolean {
  if (!a || !b) return false
  const norm = (v: string): string =>
    v.startsWith('#') ? v.slice(0, 7).toLowerCase() : v.toLowerCase()
  return norm(a) === norm(b)
}

const sub = ref('')
const name = ref('')
const saving = ref(false)
const dirty = ref(false)
const doc = ref<PixelCanvasDoc>({
  id: 'new_texture',
  width: DEFAULT_SIZE,
  height: DEFAULT_SIZE,
  pixels: new Array(DEFAULT_SIZE * DEFAULT_SIZE).fill('')
})

const ed = useTextureEditor(doc, { onChanged: () => (dirty.value = true) })

watch(dirty, (v) => emit('dirty', v))

const displayPath = computed(() => {
  if (props.file) return `${props.pathPrefix}${props.file.relPath}`
  const stem = name.value.trim()
  if (!stem) return `${props.pathPrefix}assets/${props.namespace}/textures/${sub.value || '…'}/…`
  return `${props.pathPrefix}${newRelPath() ?? t('resourcepack.texture.invalidNamePath')}`
})

/** 新建文件的包内相对路径；文件名/子目录不合法返回 null */
function newRelPath(): string | null {
  const info = resourceCategoryInfo('texture')
  if (!info) return null
  const stem = name.value.trim().replace(/\.png$/i, '')
  if (!/^[a-z0-9_]+$/.test(stem)) return null
  const segs = ['assets', props.namespace, info.dir]
  if (sub.value) segs.push(sub.value)
  segs.push(`${stem}${info.defaultExt}`)
  return segs.filter(Boolean).join('/')
}

const canSave = computed(() => (props.file ? true : newRelPath() !== null))

/* -------- 打开已有 PNG / 新建空白画布 -------- */
function blankDoc(size: number): PixelCanvasDoc {
  return {
    id: props.file?.relPath ?? 'new_texture',
    width: size,
    height: size,
    pixels: new Array(size * size).fill('')
  }
}

const canvasAreaRef = ref<HTMLElement | null>(null)
/** 适配模式：用户未手动缩放时，画布随容器尺寸自动铺满可用空间 */
let autoFit = true
let areaObs: ResizeObserver | null = null

/**
 * 按可用区域计算像素级缩放（社区成熟编辑器同类做法：画布占满工作区、整格像素对齐）。
 * 上限 32×，避免 16×16 贴图在宽屏下出现过小或半像素拉伸。
 */
function applyFit(): void {
  const area = canvasAreaRef.value
  if (!area) return
  const availW = Math.max(64, area.clientWidth - 48)
  const availH = Math.max(64, area.clientHeight - 48)
  const w = Math.max(1, doc.value.width)
  const h = Math.max(1, doc.value.height)
  ed.zoom.value = Math.max(1, Math.min(32, Math.floor(Math.min(availW / w, availH / h))))
}

/** 进入适配模式（切换贴图/改尺寸/容器变化后重新铺满） */
function scheduleFit(): void {
  autoFit = true
  void nextTick(() => applyFit())
}

function zoomBy(delta: number): void {
  autoFit = false
  if (delta > 0) ed.zoomIn()
  else ed.zoomOut()
}

/** 点击缩放百分比：回到适配窗口 */
function onResetZoom(): void {
  autoFit = true
  applyFit()
}

async function loadExisting(relPath: string): Promise<void> {
  try {
    const dataUrl = await window.api.resourcepack.readTexture(props.root, relPath, props.mode)
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(t('resourcepack.texture.pngDecodeFailed')))
      img.src = dataUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(t('resourcepack.texture.canvasFailed'))
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const pixels: string[] = new Array(canvas.width * canvas.height).fill('')
    for (let i = 0; i < pixels.length; i++) {
      if (data[i * 4 + 3] === 0) continue
      const rgb = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]
      pixels[i] = `#${rgb.toString(16).padStart(6, '0')}`
    }
    doc.value = { id: relPath, width: canvas.width, height: canvas.height, pixels }
    scheduleFit()
    dirty.value = false
  } catch (err) {
    ElMessage.error(t('resourcepack.texture.readFailed', { error: (err as Error).message }))
  }
}

async function reset(): Promise<void> {
  name.value = ''
  sub.value = props.subDirs[0] ?? ''
  if (props.file) {
    await loadExisting(props.file.relPath)
    return
  }
  doc.value = blankDoc(DEFAULT_SIZE)
  scheduleFit()
  dirty.value = false
}

watch(
  () => props.file?.relPath,
  () => void reset(),
  { immediate: true }
)

/* -------- 尺寸 / 工具 / 快捷键 -------- */
const sizeKey = computed(() => {
  const hit = TEXTURE_SIZE_OPTIONS.find(
    (s) => s.width === doc.value.width && s.height === doc.value.height
  )
  return hit?.label ?? `${doc.value.width}×${doc.value.height}`
})
const customSize = computed(() =>
  TEXTURE_SIZE_OPTIONS.some((s) => s.label === sizeKey.value) ? '' : sizeKey.value
)

function onSizeChange(v: string | number | boolean | undefined): void {
  const hit = TEXTURE_SIZE_OPTIONS.find((s) => s.label === v)
  if (!hit || (hit.width === doc.value.width && hit.height === doc.value.height)) return
  ElMessageBox.confirm(
    t('resourcepack.texture.resizeConfirm', { size: hit.label }),
    t('resourcepack.texture.resizeTitle'),
    {
      type: 'warning',
      confirmButtonText: t('resourcepack.texture.resizeConfirmBtn'),
      cancelButtonText: t('common.cancel')
    }
  )
    .then(() => {
      doc.value.pixels = resizePixels(doc.value.pixels, doc.value, hit)
      doc.value.width = hit.width
      doc.value.height = hit.height
      dirty.value = true
    })
    .catch(() => undefined)
}

const TOOL_OPTIONS: TextureTool[] = [
  'pencil',
  'eraser',
  'fill',
  'picker',
  'line',
  'rect',
  'ellipse'
]

/** 工具名走语言包（键为固定七种工具，无需回退） */
function toolLabel(tool: TextureTool): string {
  return t(`resourcepack.texture.tool.${tool}`)
}

function onToolChange(v: string | number | boolean | undefined): void {
  if (v === undefined) return
  ed.tool.value = v as TextureTool
}

function onWheelZoom(delta: number): void {
  zoomBy(delta)
}

function onClear(): void {
  ElMessageBox.confirm(
    t('resourcepack.texture.clearConfirm'),
    t('resourcepack.texture.clearTitle'),
    {
      type: 'warning',
      confirmButtonText: t('resourcepack.texture.clearConfirmBtn'),
      cancelButtonText: t('common.cancel')
    }
  )
    .then(() => ed.clear())
    .catch(() => undefined)
}

const KEY_TO_TOOL: Record<string, TextureTool> = {
  b: 'pencil',
  e: 'eraser',
  g: 'fill',
  i: 'picker',
  l: 'line',
  r: 'rect',
  o: 'ellipse'
}

function isTypingTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

function onKeydown(e: KeyboardEvent): void {
  if (isTypingTarget(e)) return
  const key = e.key.toLowerCase()
  if ((e.ctrlKey || e.metaKey) && key === 'z') {
    e.preventDefault()
    if (e.shiftKey) ed.redo()
    else ed.undo()
    return
  }
  const tool = KEY_TO_TOOL[key]
  if (tool && !e.ctrlKey && !e.metaKey && !e.altKey) ed.tool.value = tool
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

// 画布工作区尺寸变化（窗口/侧栏/终端开合）：适配模式下重新铺满
onMounted(() => {
  const area = canvasAreaRef.value
  if (!area) return
  areaObs = new ResizeObserver(() => {
    if (autoFit) applyFit()
  })
  areaObs.observe(area)
  scheduleFit()
})
onBeforeUnmount(() => {
  areaObs?.disconnect()
  areaObs = null
})

// 调整画布尺寸后回到适配
watch(
  () => [doc.value.width, doc.value.height],
  () => scheduleFit()
)

/* -------- 保存 / 放弃 -------- */
async function onSave(): Promise<void> {
  const relPath = props.file ? props.file.relPath : newRelPath()
  if (!relPath) {
    ElMessage.warning(t('resourcepack.texture.invalidName'))
    return
  }
  saving.value = true
  try {
    const file = await window.api.resourcepack.writeTexture(
      props.root,
      relPath,
      // 展开为普通数组：ref 深层响应式包装的代理无法通过 IPC 结构化克隆
      [...doc.value.pixels],
      doc.value.width,
      doc.value.height,
      props.mode
    )
    dirty.value = false
    ElMessage.success(t('resourcepack.texture.saved', { path: file.relPath }))
    emit('saved', file)
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    saving.value = false
  }
}

function onDiscard(): void {
  void reset()
}

/* -------- 预览小画布 -------- */
const previewRef = ref<HTMLCanvasElement | null>(null)
function drawPreview(): void {
  const canvas = previewRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const d = doc.value
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const hex = d.pixels[y * d.width + x]
      if (!hex) continue
      ctx.fillStyle = hex
      ctx.fillRect(x, y, 1, 1)
    }
  }
}
watch(() => [doc.value.pixels, doc.value.width, doc.value.height], drawPreview)
onMounted(drawPreview)
</script>

<style scoped>
.rtp {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-panel);
  container-type: inline-size;
}
.rtp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  flex-shrink: 0;
}
.rtp-path {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: var(--ky-text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rtp-dirty {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ky-accent);
  flex-shrink: 0;
}
.rtp-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.rtp-new {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px 0;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.rtp-label {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.rtp-sub {
  width: 120px;
}
.rtp-name {
  width: 200px;
}
.rtp-hint {
  font-size: 10.5px;
  color: var(--ky-text-dim);
}
.rtp-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.rtp-tools :deep(.el-radio-button__inner) {
  font-size: 12px;
  padding: 5px 10px;
}
.rtp-tools :deep(.el-radio-button__original-radio:checked + .el-radio-button__inner) {
  background: var(--ky-accent);
  color: #11111b;
  font-weight: 600;
  box-shadow: none;
}
.rtp-spacer {
  flex: 1;
}
.rtp-zoom {
  display: flex;
  align-items: center;
  gap: 4px;
}
.rtp-zoom-value {
  font-size: 11px;
  color: var(--ky-text-sub);
  font-family: var(--ky-mono, monospace);
  min-width: 44px;
  text-align: center;
  cursor: pointer;
}
.rtp-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.rtp-canvas-area {
  flex: 1;
  min-width: 0;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  /* 工作区底纹：与画布区分开，避免整片空白 */
  background-color: var(--ky-bg-base);
  background-image: radial-gradient(rgba(205, 214, 244, 0.055) 1px, transparent 1px);
  background-size: 16px 16px;
}
.rtp-canvas-area :deep(.tc-wrap) {
  /* 画布小于工作区时自动居中；大于时退化为左上对齐并可滚动，不被裁掉 */
  margin: auto;
}
.rtp-side {
  width: 220px;
  flex-shrink: 0;
  border-left: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rtp-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rtp-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-accent);
}
.rtp-sizes :deep(.el-radio-button__inner) {
  font-size: 11px;
  padding: 4px 8px;
}
.rtp-tip {
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  line-height: 1.6;
}
.rtp-color-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rtp-color-hex {
  font-size: 11px;
  color: var(--ky-text-sub);
  font-family: var(--ky-mono, monospace);
  flex-shrink: 0;
}
/* 常驻调色板：画布下方一条，横向可滚动，窄窗口不被右侧栏隐藏 */
.rtp-palette {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  border-top: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  overflow-x: auto;
}
.rtp-swatches {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.rtp-palette-sep {
  width: 1px;
  height: 16px;
  background: var(--ky-border);
  flex-shrink: 0;
}
.rtp-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1px solid rgba(0, 0, 0, 0.4);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.rtp-swatch:hover {
  outline: 1px solid var(--ky-accent);
}
.rtp-swatch.is-current {
  outline: 2px solid var(--ky-accent);
  outline-offset: 1px;
}
.rtp-preview-box {
  align-self: flex-start;
  border: 1px solid var(--ky-border);
  background: var(--ky-bg-panel);
  padding: 4px;
  line-height: 0;
}
.rtp-preview-canvas {
  image-rendering: pixelated;
  width: 140px;
  height: auto;
}
.is-on {
  color: var(--ky-accent);
  border-color: color-mix(in srgb, var(--ky-accent) 45%, transparent);
}
/* 窄容器隐藏右侧面板 */
@container (max-width: 860px) {
  .rtp-side {
    display: none;
  }
}
</style>