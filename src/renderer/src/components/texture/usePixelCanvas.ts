/**
 * usePixelCanvas：16/32 像素画编辑纯逻辑（M12，建模器重建 P0 自 visual/cube 迁入）。
 *
 * - 工具：铅笔（写入当前颜色）、橡皮（写 ''）、吸管（取色后回铅笔）
 * - 撤销栈：委托 usePixelHistory；每次落笔（pointerdown）前压栈整幅快照
 * - 不碰 Canvas/DOM：paintAt(x,y) 直接改 model.pixels；由 PixelCanvas 转换坐标
 * - 一笔结束（strokeEnd）触发回调，用于 600ms 防抖落盘 PNG
 */
import { computed, ref, watch, type Ref } from 'vue'
import type { ModelAsset } from '../../../../shared/types/content'
import { usePixelHistory } from './usePixelHistory'

/** 画布所需最小模型契约（物品像素画复用时无需伪造完整 ModelAsset） */
export type PixelCanvasModel = Pick<ModelAsset, 'textureSize' | 'pixels'>

export type PixelTool = 'pencil' | 'eraser' | 'picker'

export interface UsePixelCanvasOptions {
  historyLimit?: number
  /** 一笔结束（含撤销/清空）后的回调（ModelForm 防抖存 PNG） */
  onStrokeEnd?: () => void
}

export function usePixelCanvas(model: Ref<PixelCanvasModel>, opts: UsePixelCanvasOptions = {}) {
  const tool = ref<PixelTool>('pencil')
  const color = ref('#c94f4f')
  let stroking = false

  const size = computed(() => model.value.textureSize)

  // === 历史栈：委托共享 composable ===
  const hist = usePixelHistory(
    () => model.value.pixels,
    (next) => {
      model.value.pixels = next
    },
    {
      limit: opts.historyLimit,
      onChanged: () => opts.onStrokeEnd?.()
    }
  )

  /** 落笔：铅笔/橡皮压栈进入笔画；吸管单次取色不入栈 */
  function strokeStart(x: number, y: number): void {
    if (!inBounds(x, y)) return
    if (tool.value === 'picker') {
      pickAt(x, y)
      return
    }
    hist.pushSnapshot()
    stroking = true
    paintAt(x, y)
  }

  /** 拖绘：同色重复写不产生额外快照（整笔一撤销） */
  function strokeMove(x: number, y: number): void {
    if (!stroking || !inBounds(x, y)) return
    paintAt(x, y)
  }

  function strokeEnd(): void {
    if (!stroking) return
    stroking = false
    opts.onStrokeEnd?.()
  }

  function paintAt(x: number, y: number): void {
    const i = y * size.value + x
    const next = tool.value === 'eraser' ? '' : color.value
    if (model.value.pixels[i] === next) return
    model.value.pixels[i] = next
  }

  function pickAt(x: number, y: number): void {
    const i = y * size.value + x
    const hex = model.value.pixels[i]
    if (hex) {
      color.value = hex
      tool.value = 'pencil'
    }
  }

  function inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < size.value && y < size.value
  }

  // 切换编辑对象（store 保存/重新加载后 model 引用替换）或画布尺寸，历史栈作废
  watch(model, () => {
    hist.reset()
    stroking = false
  })
  watch(size, () => {
    hist.reset()
    stroking = false
  })

  return {
    tool,
    color,
    size,
    canUndo: hist.canUndo,
    canRedo: hist.canRedo,
    strokeStart,
    strokeMove,
    strokeEnd,
    undo: hist.undo,
    redo: hist.redo,
    clear: () => hist.clear(size.value, size.value)
  }
}

export type PixelCanvasApi = ReturnType<typeof usePixelCanvas>
