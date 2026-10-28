/**
 * CUE InlineCompletionsProvider 实现（M1）。
 *
 * Monaco 原生 InlineCompletionsProvider：用户输入停顿后调用 provideInlineCompletions，
 * 返回 InlineCompletion[]，Monaco 渲染灰色 ghost text，Tab 接受。
 *
 * 关键机制（借鉴 Continue.dev 补全管线，但不集成其代码）：
 * - debounce：输入停顿 settings.debounceMs 后才发起请求（避免连敲产生多次请求）
 * - reqId 自增丢弃：用户继续输入时，旧请求 await 后校验仍是 current 才返回
 * - 真取消：丢弃时调 window.api.ai.chatStop(streamId) 真正断流（非流式 chat 走
 *   IPC invoke，取消靠 reqId 丢弃；此处预留 streamId 仅用于将来切流式）
 * - 白名单：语言不在 settings.languages 时直接返回空
 */
import type * as Monaco from 'monaco-editor'
import { monaco } from '../setup'
import { splitFimContext } from './fimPrompt'
import type { CueSettings } from '../../../../shared/types/settings'
import type { AiChatRequest, AiChatResponse, AiResult } from '../../../../shared/types/ai'

export interface CueProviderOptions {
  settings: CueSettings
  /** 默认提供商 id（settings.ai.defaultProviderId） */
  defaultProviderId: string | null
  /** 补全模型覆盖；空串=跟随提供商默认 model */
  modelOverride: string
  /** M3：当前项目 id（null 表示无项目，跳过仓库上下文检索） */
  projectId?: string | null
  /** M3：当前文件的项目相对路径（正斜杠）；供主进程排除当前文件自身。空则退化为 model.uri.path */
  relPath?: string | null
}

export interface CueProviderHandle {
  /** 设置变化时更新（无需重新注册 provider） */
  update(options: CueProviderOptions): void
  /** 编辑器卸载时调用，取消进行中的请求 */
  dispose(): void
  /**
   * M2：读取最近一次返回给 Monaco 的内联建议（用于 change-point tracker 检测
   * 用户是否接受补全）；无建议或已消费时返回 null。
   */
  getLastSuggestion(): { text: string; lineNumber: number; at: number } | null
  /** 建议被识别为已接受后消费（避免同一条建议被重复匹配） */
  consumeSuggestion(): void
}

interface CueProviderInternal {
  provider: Monaco.languages.InlineCompletionsProvider
  handle: CueProviderHandle
}

export function createCueInlineProvider(
  initialOptions: CueProviderOptions
): CueProviderInternal {
  let currentReqId = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let currentOptions = initialOptions
  /** M2：最近一次成功返回的建议；被消费后置 null */
  let lastSuggestion: { text: string; lineNumber: number; at: number } | null = null
  /** M3：缓存最近一次仓库上下文（query 签名 → context），避免连续补全重复检索 */
  let contextCache: { querySig: string; context: string } | null = null

  const provider: Monaco.languages.InlineCompletionsProvider = {
    provideInlineCompletions: async (model, position, _ctx, _token) => {
      const opts = currentOptions
      // 无默认提供商时不触发（用户未配置 AI 供应商）
      if (!opts.defaultProviderId) return { items: [] }
      // 总开关关闭或语言不在白名单时不触发
      if (!opts.settings.enabled) return { items: [] }

      const fim = splitFimContext(model, position, opts.settings)
      if (!fim) return { items: [] }
      // 空文件或光标在文件起始且无后续内容，不触发（无上下文）
      if (!fim.prefix.trim() && !fim.suffix.trim()) return { items: [] }

      // debounce：等 settings.debounceMs 才发请求
      const reqId = ++currentReqId
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      await new Promise<void>((resolve) => {
        debounceTimer = setTimeout(() => {
          debounceTimer = null
          resolve()
        }, opts.settings.debounceMs)
      })
      // 过期请求（用户已继续输入）：丢弃
      if (reqId !== currentReqId) return { items: [] }

      // M3：仓库上下文检索（不阻塞主链路；超时/失败降级为裸 FIM）
      let context: string | undefined
      if (opts.settings.repoContextEnabled && opts.projectId) {
        const query = extractQueryFromPosition(model, position)
        if (query) {
          const querySig = query
          if (contextCache?.querySig === querySig) {
            context = contextCache.context
          } else {
            try {
              // 注意：settings 来自 Pinia 响应式对象，sources 必须展开为普通对象，
              // 否则 IPC structuredClone 抛 DataCloneError（An object could not be cloned）
              const result = await window.api.ai.cueContext({
                projectId: opts.projectId,
                relPath: opts.relPath ?? model.uri.path.replace(/^\//, ''),
                language: fim.language,
                query,
                maxChars: opts.settings.repoContextMaxChars,
                sources: { ...opts.settings.repoContextSources }
              })
              // 过期请求：丢弃
              if (reqId !== currentReqId) return { items: [] }
              if (result.ok && result.data.text) {
                context = result.data.text
                contextCache = { querySig: query, context }
              }
            } catch {
              // 静默降级为裸 FIM
            }
          }
        }
      }

      const req: AiChatRequest = {
        providerId: opts.defaultProviderId,
        mode: 'complete',
        fim: context ? { ...fim, context } : fim,
        ...(opts.modelOverride ? { model: opts.modelOverride } : {}),
        maxTokens: 128,
        temperature: 0.2
      }

      try {
        const result = (await window.api.ai.chat(req)) as AiResult<AiChatResponse>
        // 过期请求：丢弃结果
        if (reqId !== currentReqId) return { items: [] }
        if (!result.ok) return { items: [] }
        const text = result.data.content
        if (!text) return { items: [] }
        // M2：记录最近建议，供 change-point tracker 检测接受行为
        lastSuggestion = { text, lineNumber: position.lineNumber, at: Date.now() }
        return {
          items: [
            {
              insertText: text,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
              )
            }
          ]
        }
      } catch {
        return { items: [] }
      }
    },
    disposeInlineCompletions: () => {
      // Monaco 在补全列表不再需要时调用；无需手动释放（不持有外部资源）
    }
  }

  const handle: CueProviderHandle = {
    update(next) {
      currentOptions = next
    },
    getLastSuggestion: () => lastSuggestion,
    consumeSuggestion: () => {
      lastSuggestion = null
    },
    dispose() {
      // 让所有进行中的请求过期（await 后校验失败即丢弃）
      currentReqId++
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
      }
      lastSuggestion = null
      contextCache = null
    }
  }

  return { provider, handle }
}

/**
 * M3：从当前光标位置提取高信息量 query（光标行 + 上一行非空代码）。
 * 返回空字符串表示无高信息量 token，不发检索请求。
 */
export function extractQueryFromPosition(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position
): string {
  const lines: string[] = []
  // 光标行
  const currentLine = model.getLineContent(position.lineNumber)
  if (currentLine.trim()) lines.push(currentLine.trim())
  // 上一行非空代码（最多向上找 3 行）
  for (let i = 1; i <= 3; i++) {
    const ln = position.lineNumber - i
    if (ln < 1) break
    const line = model.getLineContent(ln).trim()
    if (line) {
      lines.push(line)
      break
    }
  }
  if (lines.length === 0) return ''
  // 提取编程标识符
  const text = lines.join(' ')
  const tokens = text.match(/[A-Za-z_$][\w$]{2,}/g) ?? []
  const stopwords = new Set([
    'class', 'return', 'public', 'private', 'protected', 'static', 'final',
    'abstract', 'void', 'int', 'long', 'float', 'double', 'boolean', 'char',
    'byte', 'short', 'new', 'this', 'super', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'default', 'break', 'continue', 'try', 'catch',
    'finally', 'throw', 'throws', 'import', 'package', 'extends', 'implements',
    'interface', 'enum', 'record', 'var', 'null', 'true', 'false', 'String',
    'get', 'set', 'is', 'has', 'can', 'the', 'and', 'or', 'not', 'but'
  ])
  const filtered = tokens.filter((t) => !stopwords.has(t))
  // 取最长的两个作为检索关键词（稀罕度代理）
  const byLength = [...filtered].sort((a, b) => b.length - a.length)
  const selected = byLength.slice(0, 2)
  return selected.join(' ')
}
