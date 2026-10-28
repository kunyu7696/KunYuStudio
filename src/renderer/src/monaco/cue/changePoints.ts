/**
 * CUE M2：修改点（change point）预测与跳转。
 *
 * 修改点来源：
 * - 最近编辑位置：onDidChangeModelContent 的变更行（用户本轮会话编辑过的行）
 * - lint 错误行：monaco.editor.getModelMarkers 中 owner 匹配且 severity=Error 的 marker
 * 两者按行合并去重（lint 信息优先，带诊断 message 作 hover）。
 *
 * 呈现：deltaDecorations 在 glyph margin 标 ⇥，当前光标命中的点加整行高亮。
 * 导航：next()/prev() 循环跳转（Alt+]/[），revealPositionInCenter 居中。
 * 接受 CUE 补全后（变更文本与最近建议匹配）自动 next()——由 jumpAfterAccept 控制。
 */
import type * as Monaco from 'monaco-editor'
import { monaco } from '../setup'

export interface ChangePoint {
  lineNumber: number
  column: number
  source: 'edit' | 'lint'
  message?: string
}

/** 最近一次 CUE 内联建议（由 inlineCompletionProvider 提供，用于接受检测） */
export interface LastSuggestion {
  text: string
  lineNumber: number
  at: number
}

export interface ChangePointTrackerOptions {
  /** 计入修改点的 marker owner（如 'kunyu-java-lint'）；空数组 = 不收集 lint 点 */
  markerOwners: readonly string[]
  /** 接受 CUE 补全后自动跳到下一修改点 */
  jumpAfterAccept: boolean
  /** 读取最近一次 CUE 建议；返回 null 时跳过接受检测 */
  getLastSuggestion: () => LastSuggestion | null
  /** 接受建议被消费后回调（清空 provider 侧记录，避免重复匹配） */
  consumeSuggestion?: () => void
  /** M3b：跳点完成后自动唤起下一补全（链式补全） */
  onAfterJump?: () => void
}

export interface ChangePointTracker {
  /** 转发 editor.onDidChangeModelContent；isExternal=true 表示磁盘重载等程序化写入 */
  notifyContentChanged(
    e: Monaco.editor.IModelContentChangedEvent,
    isExternal: boolean
  ): void
  /** 立即重新计算修改点并刷新装饰器（lint 完成后调用） */
  refresh(): void
  /** 跳到下一修改点（相对当前光标行，循环回绕） */
  next(): void
  /** 跳到上一修改点 */
  prev(): void
  /** 当前修改点数量 */
  size(): number
  dispose(): void
}

const GLYPH_CLASS = 'cue-cp-glyph'
const ACTIVE_GLYPH_CLASS = 'cue-cp-glyph is-active'
const ACTIVE_LINE_CLASS = 'cue-cp-active-line'
const LINE_DECO_CLASS = 'cue-cp-line-deco'
/** 装饰器刷新防抖（连续输入时合并） */
const REFRESH_DEBOUNCE_MS = 200
/** 建议接受匹配时间窗 */
const ACCEPT_WINDOW_MS = 30_000
/**
 * 单次变更影响超过该行数（跨行行数或插入行数）视为批量操作（全选替换、接受大段
 * 补全、格式化整文件），只记变更起始行，避免满屏 ⇥ 噪音。普通逐行编辑不受影响。
 */
const BULK_EDIT_LINE_THRESHOLD = 8

export function createChangePointTracker(
  editor: Monaco.editor.IStandaloneCodeEditor,
  initial: ChangePointTrackerOptions
): ChangePointTracker {
  let options = initial
  const modelOrNull = editor.getModel()
  if (!modelOrNull) throw new Error('CUE change-point tracker 需要已绑定 model 的编辑器')
  // 显式非空声明：hoisted function 闭包内 TS 不会保留上方的 throw 窄化，
  // 用独立 const 让声明类型本身固化为非空 ITextModel
  const model: Monaco.editor.ITextModel = modelOrNull

  /** 本轮会话编辑过的行（外部重载时清空） */
  const editLines = new Set<number>()
  let points: ChangePoint[] = []
  let decorationIds: string[] = []
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let activeLine = -1

  const ownerSet = new Set(options.markerOwners)

  /** 收集 lint 错误 marker 所在行 */
  function collectLintLines(): Map<number, ChangePoint> {
    const map = new Map<number, ChangePoint>()
    if (ownerSet.size === 0) return map
    const markers = monaco.editor.getModelMarkers({ resource: model.uri })
    for (const m of markers) {
      if (!ownerSet.has(m.owner)) continue
      if (m.severity !== monaco.MarkerSeverity.Error) continue
      // 同行多条只留第一条（信息已够导航用）
      if (!map.has(m.startLineNumber)) {
        map.set(m.startLineNumber, {
          lineNumber: m.startLineNumber,
          column: m.startColumn,
          source: 'lint',
          message: m.message
        })
      }
    }
    return map
  }

  /** 合并 edit ∪ lint（lint 覆盖同行的 edit，信息更丰富） */
  function computePoints(): ChangePoint[] {
    const merged = new Map<number, ChangePoint>()
    for (const line of editLines) {
      merged.set(line, { lineNumber: line, column: 1, source: 'edit' })
    }
    for (const [line, p] of collectLintLines()) merged.set(line, p)
    return [...merged.values()].sort((a, b) => a.lineNumber - b.lineNumber)
  }

  function render(): void {
    const lineCount = model.getLineCount()
    const decorations: Monaco.editor.IModelDeltaDecoration[] = []
    for (const p of points) {
      if (p.lineNumber < 1 || p.lineNumber > lineCount) continue
      const isActive = p.lineNumber === activeLine
      const hoverLabel =
        p.source === 'lint'
          ? `⇥ 修改点 · lint 错误${p.message ? `：${p.message}` : ''}`
          : '⇥ 修改点 · 最近编辑'
      decorations.push({
        range: new monaco.Range(p.lineNumber, 1, p.lineNumber, 1),
        options: {
          isWholeLine: true,
          glyphMarginClassName: isActive ? ACTIVE_GLYPH_CLASS : GLYPH_CLASS,
          linesDecorationsClassName: isActive ? LINE_DECO_CLASS : undefined,
          className: isActive ? ACTIVE_LINE_CLASS : undefined,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          hoverMessage: { value: hoverLabel }
        }
      })
    }
    decorationIds = model.deltaDecorations(decorationIds, decorations)
  }

  function refresh(): void {
    points = computePoints()
    // 当前 active 行已不在点集合中时清除高亮（但不自动移动光标）
    if (activeLine > 0 && !points.some((p) => p.lineNumber === activeLine)) {
      activeLine = -1
    }
    render()
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      refresh()
    }, REFRESH_DEBOUNCE_MS)
  }

  /** 变更文本是否匹配最近一次 CUE 建议（判定补全被接受） */
  function matchSuggestion(e: Monaco.editor.IModelContentChangedEvent): boolean {
    if (!options.jumpAfterAccept) return false
    const sug = options.getLastSuggestion()
    if (!sug || !sug.text || Date.now() - sug.at > ACCEPT_WINDOW_MS) return false
    const hit = e.changes.some(
      (c) =>
        c.text === sug.text &&
        c.range.startLineNumber === sug.lineNumber &&
        c.text.length >= 2
    )
    if (hit) options.consumeSuggestion?.()
    return hit
  }

  function jumpTo(lineNumber: number, column: number): void {
    activeLine = lineNumber
    editor.revealPositionInCenter({ lineNumber, column })
    editor.setPosition({ lineNumber, column })
    editor.focus()
    render()
    // M3b：跳点后自动唤起下一补全（链式补全）
    options.onAfterJump?.()
  }

  function next(): void {
    if (points.length === 0) return
    const current = editor.getPosition()?.lineNumber ?? 0
    const target =
      points.find((p) => p.lineNumber > current) ?? points[0]
    jumpTo(target.lineNumber, target.column)
  }

  function prev(): void {
    if (points.length === 0) return
    const current = editor.getPosition()?.lineNumber ?? Number.MAX_SAFE_INTEGER
    const target =
      [...points].reverse().find((p) => p.lineNumber < current) ?? points[points.length - 1]
    jumpTo(target.lineNumber, target.column)
  }

  // 光标移动：命中某修改点时更新 active 高亮（不触发跳转）
  const cursorSub = editor.onDidChangeCursorPosition((ev) => {
    const hit = points.some((p) => p.lineNumber === ev.position.lineNumber)
    const nextActive = hit ? ev.position.lineNumber : -1
    if (nextActive !== activeLine) {
      activeLine = nextActive
      render()
    }
  })

  return {
    notifyContentChanged(e, isExternal) {
      if (isExternal) {
        // 磁盘重载/程序化写入：编辑轨迹失效，等待外部重新跑诊断后填充 lint 点
        editLines.clear()
        refresh()
        return
      }
      for (const c of e.changes) {
        const start = c.range.startLineNumber
        const span = c.range.endLineNumber - start
        const insertedLines = c.text ? c.text.split('\n').length - 1 : 0
        // 批量操作（大范围替换/整文件格式化/大段补全）：只记起始行，避免满屏 ⇥
        if (span > BULK_EDIT_LINE_THRESHOLD || insertedLines > BULK_EDIT_LINE_THRESHOLD) {
          editLines.add(start)
          continue
        }
        for (let line = start; line <= c.range.endLineNumber; line++) {
          editLines.add(line)
        }
        // 纯插入场景 endLineNumber 可能未覆盖插入后的新行
        for (let k = 1; k <= insertedLines; k++) editLines.add(start + k)
      }
      const accepted = matchSuggestion(e)
      scheduleRefresh()
      if (accepted) {
        // 装饰器先落盘再跳转：等防抖 refresh 完成后定位到下一个点
        if (refreshTimer) {
          clearTimeout(refreshTimer)
          refreshTimer = null
        }
        refresh()
        // 光标此刻在刚接受文本的末尾，next() 自然跳过该行
        setTimeout(() => next(), 0)
      }
    },
    refresh,
    next,
    prev,
    size: () => points.length,
    dispose() {
      cursorSub.dispose()
      if (refreshTimer) {
        clearTimeout(refreshTimer)
        refreshTimer = null
      }
      editLines.clear()
      points = []
      decorationIds = model.deltaDecorations(decorationIds, [])
    }
  }
}
