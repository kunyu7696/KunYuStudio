/**
 * CUE FIM（Fill-in-the-Middle）上下文切分（M1）。
 *
 * 把当前 Monaco 文本模型在光标位置切成 prefix（光标前代码）/ suffix（光标后代码），
 * 按字符数上限截断并按行边界对齐，避免上下文超长打满模型 token。
 * 切分后的 prefix/suffix 经 IPC 发给主进程 aiService，主进程按厂商路由
 * （DeepSeek-coder 原生 FIM token，其他厂商走 chat 包装）。
 */
import type * as Monaco from 'monaco-editor'
import type { CueSettings } from '../../../../shared/types/settings'

export interface FimContext {
  prefix: string
  suffix: string
  /** Monaco language id（java/json/properties 等） */
  language: string
}

/**
 * 切分光标前/后代码。语言不在白名单时返回 null（不触发补全）。
 */
export function splitFimContext(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  settings: CueSettings
): FimContext | null {
  const languageId = model.getLanguageId()
  if (!settings.languages.includes(languageId)) return null

  const offset = model.getOffsetAt(position)
  const fullValue = model.getValue()

  const prefixRaw = fullValue.slice(0, offset)
  const suffixRaw = fullValue.slice(offset)

  const prefix = truncateToChars(prefixRaw, settings.maxPrefixChars, 'end')
  const suffix = truncateToChars(suffixRaw, settings.maxSuffixChars, 'start')

  return { prefix, suffix, language: languageId }
}

/**
 * 按 maxChars 截断文本，按行边界对齐避免切断行中间。
 * - keep='end'：取末尾 maxChars（prefix 用，保留光标前最近代码）
 * - keep='start'：取开头 maxChars（suffix 用，保留光标后紧邻代码）
 */
function truncateToChars(text: string, maxChars: number, keep: 'start' | 'end'): string {
  if (text.length <= maxChars) return text
  if (keep === 'end') {
    const sliced = text.slice(text.length - maxChars)
    const nl = sliced.indexOf('\n')
    return nl >= 0 ? sliced.slice(nl + 1) : sliced
  }
  const sliced = text.slice(0, maxChars)
  const nl = sliced.lastIndexOf('\n')
  return nl >= 0 ? sliced.slice(0, nl) : sliced
}
