/**
 * useTextureEditor：材质编辑器画布编辑纯逻辑（P0）。
 *
 * - 工具：铅笔 B / 橡皮 E / 填充 G / 取色 I / 直线 L / 矩形 R / 椭圆 O
 * - 撤销：委托 usePixelHistory（上限 30 步）
 * - 形状工具（直线/矩形/椭圆）拖拽期间维护 draft 供画布预览，pointerup 提交
 * - 不碰 DOM：坐标转换由 TextureCanvas 完成；onChanged 回调供脏标记/防抖保存
 */
import { computed, ref, watch, type Ref } from 'vue'
import {
  applyPoints,
  ellipsePoints,
  floodFill,
  linePoints,
  rectOutlinePoints
} from '../../../components/texture/pixelAlgorithms'
import { usePixelHistory } from '../../../components/texture/usePixelHistory'

/** 编辑目标最小接口：像素画编辑器只认画布，不关心文档来自语义资产还是资源包 PNG */
export interface PixelCanvasDoc {
  id: string
  width: number
  height: number
  /** 行优先像素，'' = 透明，#rrggbb = 不透明 */
  pixels: string[]
}

export type TextureTool = 'pencil' | 'eraser' | 'fill' | 'picker' | 'line' | 'rect' | 'ellipse'

/** 形状拖拽草稿（画布坐标） */
export interface ShapeDraft {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface UseTextureEditorOptions {
  historyLimit?: number
  /** 任何落到像素数据的修改后回调（脏标记 / 预览刷新） */
  onChanged?: () => void
  /** 取色成功回调 */
  onPicked?: (color: string) => void
}

const DEFAULT_COLOR = '#2979FF'
const RECENT_LIMIT = 10

export function useTextureEditor(tex: Ref<PixelCanvasDoc>, opts: UseTextureEditorOptions = {}) {
  const tool = ref<TextureTool>('pencil')
  const color = ref(DEFAULT_COLOR)
  const recentColors = ref<string[]>([])
  const zoom = ref(12)
  const showGrid = ref(true)
  const draft = ref<ShapeDraft | null>(null)
  let stroking = false
  let last: PixelPos | null = null

  // === 历史栈：委托共享 composable ===
  const hist = usePixelHistory(
    () => tex.value.pixels,
    (next) => {
      tex.value.pixels = next
    },
    { limit: opts.historyLimit, onChanged: () => opts.onChanged?.() }
  )

  interface PixelPos {
    x: number
    y: number
  }

  const width = computed(() => tex.value.width)
  const height = computed(() => tex.value.height)

  /** 形状点集 → 写入色（橡皮在形状场景等同透明写入） */
  function shapeColor(): string {
    return tool.value === 'eraser' ? '' : color.value
  }

  function shapePoints(d: ShapeDraft) {
    if (tool.value === 'line') return linePoints(d.x0, d.y0, d.x1, d.y1)
    if (tool.value === 'rect') return rectOutlinePoints(d.x0, d.y0, d.x1, d.y1)
    if (tool.value === 'ellipse') return ellipsePoints(d.x0, d.y0, d.x1, d.y1)
    return []
  }

  /** pointerdown：像素工具立即生效；形状工具开始草稿 */
  function strokeStart(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= width.value || y >= height.value) return
    if (tool.value === 'picker') {
      const hex = tex.value.pixels[y * width.value + x]
      if (hex) {
        color.value = hex
        opts.onPicked?.(hex)
        tool.value = 'pencil'
      }
      return
    }
    if (tool.value === 'fill') {
      const next = tex.value.pixels.slice()
      const changed = floodFill(next, width.value, height.value, x, y, color.value)
      if (changed > 0) {
        hist.pushSnapshot()
        tex.value.pixels = next
        opts.onChanged?.()
        pushRecent(color.value)
      }
      return
    }
    hist.pushSnapshot()
    stroking = true
    last = { x, y }
    if (tool.value === 'pencil' || tool.value === 'eraser') {
      const next = tex.value.pixels.slice()
      const pts = [{ x, y }]
      tex.value.pixels = applyPoints(next, width.value, height.value, pts, shapeColor())
      opts.onChanged?.()
    } else {
      draft.value = { x0: x, y0: y, x1: x, y1: y }
    }
  }

  /** pointermove：像素工具连续画线补隙；形状工具更新草稿终点 */
  function strokeMove(x: number, y: number): void {
    const inBounds = x >= 0 && y >= 0 && x < width.value && y < height.value
    if (!stroking) return
    if (tool.value === 'pencil' || tool.value === 'eraser') {
      if (!inBounds || !last) return
      const from = last
      last = { x, y }
      if (from.x === x && from.y === y) return
      const next = applyPoints(
        tex.value.pixels,
        width.value,
        height.value,
        linePoints(from.x, from.y, x, y),
        shapeColor()
      )
      tex.value.pixels = next
      opts.onChanged?.()
      return
    }
    if (draft.value) {
      draft.value = { ...draft.value, x1: Math.max(0, Math.min(x, width.value - 1)), y1: Math.max(0, Math.min(y, height.value - 1)) }
    }
  }

  /** pointerup：形状工具提交草稿 */
  function strokeEnd(): void {
    if (!stroking) return
    stroking = false
    last = null
    const d = draft.value
    if (d) {
      draft.value = null
      const pts = shapePoints(d)
      if (pts.length > 0) {
        tex.value.pixels = applyPoints(tex.value.pixels, width.value, height.value, pts, shapeColor())
        opts.onChanged?.()
        pushRecent(color.value)
      } else {
        // 空拖拽：回滚占位快照
        hist.dropLast()
      }
    } else {
      pushRecent(color.value)
    }
    opts.onChanged?.()
  }

  function pushRecent(hex: string): void {
    if (!hex) return
    const list = recentColors.value.filter((c) => c !== hex)
    list.unshift(hex)
    recentColors.value = list.slice(0, RECENT_LIMIT)
  }

  function zoomIn(): void {
    zoom.value = Math.min(32, zoom.value + 1)
  }

  function zoomOut(): void {
    zoom.value = Math.max(1, zoom.value - 1)
  }

  function resetZoom(): void {
    zoom.value = 12
  }

  // 切换编辑对象或尺寸变化：历史作废、草稿清理
  watch(
    () => tex.value.id,
    () => {
      hist.reset()
      draft.value = null
      stroking = false
    }
  )
  watch(
    () => [tex.value.width, tex.value.height],
    () => {
      hist.reset()
      draft.value = null
      stroking = false
    }
  )

  return {
    tool,
    color,
    recentColors,
    zoom,
    showGrid,
    draft,
    width,
    height,
    canUndo: hist.canUndo,
    canRedo: hist.canRedo,
    strokeStart,
    strokeMove,
    strokeEnd,
    undo: hist.undo,
    redo: hist.redo,
    clear: () => hist.clear(width.value, height.value),
    zoomIn,
    zoomOut,
    resetZoom
  }
}

export type TextureEditorApi = ReturnType<typeof useTextureEditor>
