/**
 * usePixelHistory：像素画编辑器共享的历史栈（undo/redo/clear）。
 *
 * 底层数据结构：调用方自己维护 pixels 数组（通常嵌在更复杂的 model 里），
 * 本 composable 只负责「快照 → 压栈 → 回滚」三件事。
 *
 * 被两处调用：
 *   - usePixelCanvas          （工坊 UnifiedEditorView 物品像素画；pixels = model.value.pixels）
 *   - useTextureEditor        （资源包材质 PNG 编辑；pixels = tex.value.pixels，tex 是 PixelCanvasDoc ref）
 *
 * 之所以抽出来：之前两个 composable 的 snapshot/pushHistory/undo/redo/clear
 * 五段代码完全重复，只是变量名和回调名略有差异；历史栈是纯数据逻辑，
 * 不关心上层工具（pencil/eraser/fill/shape）和画布尺寸（固定 16 vs 可配 16-256）。
 */
import { computed, ref } from 'vue'
import type { ComputedRef } from 'vue'

export interface UsePixelHistoryOptions {
  /** 历史栈上限；默认 30 步（单图层 16-256px 画布成本可控） */
  limit?: number
  /** 任何落到 pixels 的修改后回调（undo/redo/clear 都会触发） */
  onChanged?: () => void
}

export interface PixelHistoryApi {
  /** 当前历史栈（对外暴露便于调试；shape 工具等上层可能需要 peek 末项） */
  history: ReturnType<typeof ref<string[][]>>
  /** 前进栈（redo 用） */
  future: ReturnType<typeof ref<string[][]>>
  canUndo: ComputedRef<boolean>
  canRedo: ComputedRef<boolean>

  /** 压栈当前 pixels；同时清空 future（新操作打断 redo） */
  pushSnapshot: () => void
  /** 回滚到上一快照 */
  undo: () => void
  /** 重做 */
  redo: () => void
  /** 清空画布（空检测 → 压栈 → 清零） */
  clear: (w: number, h: number) => void
  /** 丢弃最近一次压栈（shape 工具空拖拽时回滚占位快照） */
  dropLast: () => void
  /** 切换编辑对象/尺寸时重置历史 */
  reset: () => void
}

/**
 * @param getPixels 读取当前 pixels 的函数（每次调用都拿到最新引用）
 * @param setPixels 写入 pixels 的函数
 */
export function usePixelHistory(
  getPixels: () => string[],
  setPixels: (next: string[]) => void,
  opts: UsePixelHistoryOptions = {}
): PixelHistoryApi {
  const limit = opts.limit ?? 30
  const history = ref<string[][]>([])
  const future = ref<string[][]>([])

  const canUndo = computed(() => history.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  function snapshot(): string[] {
    return getPixels().slice()
  }

  function pushSnapshot(): void {
    history.value.push(snapshot())
    if (history.value.length > limit) history.value.shift()
    future.value = []
  }

  function apply(next: string[]): void {
    setPixels(next)
    opts.onChanged?.()
  }

  function undo(): void {
    const prev = history.value.pop()
    if (!prev) return
    future.value.push(snapshot())
    apply(prev)
  }

  function redo(): void {
    const next = future.value.pop()
    if (!next) return
    history.value.push(snapshot())
    apply(next)
  }

  function clear(w: number, h: number): void {
    if (!getPixels().some(Boolean)) return
    pushSnapshot()
    apply(new Array(w * h).fill(''))
  }

  function reset(): void {
    history.value = []
    future.value = []
  }

  function dropLast(): void {
    history.value.pop()
  }

  return {
    history,
    future,
    canUndo,
    canRedo,
    pushSnapshot,
    undo,
    redo,
    clear,
    dropLast,
    reset
  }
}
