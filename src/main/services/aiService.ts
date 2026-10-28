/**
 * AI 提供商统一抽象：OpenAI 兼容 + 本地 Ollama。
 * - 渲染进程不直接 fetch AI 端点，一律经本服务（主进程）发起请求
 * - 超时：普通请求取 settings.network.timeoutSec；对话请求另设生成下限（AI_CHAT_MIN_TIMEOUT_MS）
 * - 错误归类为 AiErrorKind，面向用户的文案由 UI 层组装
 */
import { request } from 'undici'
import { getSection } from './settingsService'
import { networkTimeoutMs, resolveDispatcher } from './httpUtil'
import { StreamLineFramer } from './ai/streamFramer'
import { resolveMaxTokens } from './ai/reasoningBudget'
import type {
  AiChatRequest,
  AiChatResponse,
  AiErrorKind,
  AiProviderConfig,
  AiResult,
  AiTestResult,
  AiUsage,
  ChatMessage,
  ToolCallItem
} from '../../shared/types/ai'

/** 携带归类信息的 AI 错误 */
export class AiServiceError extends Error {
  readonly kind: AiErrorKind
  constructor(kind: AiErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

/** 将任意 Promise 包装为 AiResult：AiServiceError 按归类返回，其余归为 server */
export async function asAiResult<T>(p: Promise<T>): Promise<AiResult<T>> {
  try {
    return { ok: true, data: await p }
  } catch (err) {
    if (err instanceof AiServiceError) {
      return { ok: false, errorKind: err.kind, errorMessage: err.message }
    }
    return {
      ok: false,
      errorKind: 'server',
      errorMessage: err instanceof Error ? err.message : String(err)
    }
  }
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

/**
 * 从响应 JSON 提取 token 用量（usage 落库；token/成本可查）。
 * - OpenAI 兼容：顶层 usage.prompt_tokens / completion_tokens / total_tokens
 * - Ollama：顶层 prompt_eval_count（prompt）/ eval_count（completion）
 * 厂商未返回或字段非数字时整体返回 undefined，调用方按无用量处理。
 */
export function extractUsage(kind: 'openai' | 'ollama', data: unknown): AiUsage | undefined {
  if (!data || typeof data !== 'object') return undefined
  const d = data as Record<string, unknown>
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
  if (kind === 'openai') {
    const usage = d['usage']
    if (!usage || typeof usage !== 'object') return undefined
    const u = usage as Record<string, unknown>
    const promptTokens = num(u['prompt_tokens'])
    const completionTokens = num(u['completion_tokens'])
    const totalTokens = num(u['total_tokens'])
    if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
      return undefined
    }
    return { promptTokens, completionTokens, totalTokens }
  }
  const promptTokens = num(d['prompt_eval_count'])
  const completionTokens = num(d['eval_count'])
  if (promptTokens === undefined && completionTokens === undefined) return undefined
  return { promptTokens, completionTokens }
}

/**
 * 对话生成的最短超时预算。
 * 大模型生成整段回答通常远慢于普通网络请求，用户设置的「网络请求超时」偏小时
 * （默认 30s）极易在生成中途被掐断，这里给出一个更宽的下限。
 * 思考型模型（deepseek-reasoner 等）长思维链单轮可达数分钟（真机：放开输出预算后
 * 大师档工具循环单轮约 5-8 分钟），180s 会误杀，下限放宽到 10 分钟；
 * 用户仍可随时用「停止」中断，不受此下限影响。
 */
const AI_CHAT_MIN_TIMEOUT_MS = 600_000

/** 对话请求超时（毫秒）：用户设置与生成下限取较大值 */
function chatTimeoutMs(): number {
  return Math.max(networkTimeoutMs(), AI_CHAT_MIN_TIMEOUT_MS)
}

/** 归类底层请求异常：中断/超时 → timeout，其余 → network */
function toTransportError(err: unknown, timeoutMs: number): AiServiceError {
  const e = err as Error & { code?: string; cause?: { code?: string } }
  const code = e.code ?? e.cause?.code ?? ''
  const aborted =
    e.name === 'TimeoutError' || e.name === 'AbortError' || code === 'ABORT_ERR' || e.message === 'timeout'
  if (aborted) {
    return new AiServiceError('timeout', `请求超时（超过 ${Math.round(timeoutMs / 1000)}s 未完成）`)
  }
  return new AiServiceError('network', `无法连接服务器：${e.message}`)
}

/**
 * 统一请求封装：JSON 收发 + 错误归类（dispatcher/超时复用 httpUtil）。
 * 响应体读取同样纳入超时判定：非流式对话在收到响应头之后才开始吐正文，
 * 一旦生成耗时超出预算，中断发生在 `res.body.text()`，
 * 不在此处兜住会漏出底层的英文 DOMException（"The operation was aborted due to timeout"）。
 *
 * 非流式 requestJson 与流式 chatStream 共用同一重试范式（此前仅流式有 429 退避，
 * 非流式 chat/FIM 补全 429/503 一次即失败）：命中 Retry-After 用之（封顶 30s），
 * 否则第 1 次重试前等 2s、第 2 次等 5s。最多 3 次尝试。
 */
const HTTP_RETRY_MAX_ATTEMPTS = 3

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503
}

function retryWaitMs(attempt: number, retryAfterHeader: unknown): number {
  const retryAfter = Number(retryAfterHeader)
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter, 30) * 1000
    : attempt === 1
      ? 2000
      : 5000
}

async function requestJson(
  url: string,
  init: {
    method: 'GET' | 'POST'
    headers?: Record<string, string>
    body?: string
  },
  timeoutMs: number = networkTimeoutMs()
): Promise<unknown> {
  // 429/503 退避重试——每次尝试独立超时，命中限流/维护窗口按共用层等待后重发
  let res: Awaited<ReturnType<typeof request>>
  let text = ''
  for (let attempt = 1; attempt <= HTTP_RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      res = await request(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        dispatcher: await resolveDispatcher(url),
        signal: AbortSignal.timeout(timeoutMs)
      })
      text = await res.body.text()
    } catch (err) {
      throw toTransportError(err, timeoutMs)
    }
    if (isRetryableStatus(res.statusCode) && attempt < HTTP_RETRY_MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, retryWaitMs(attempt, res.headers['retry-after'])))
      continue
    }
    break
  }
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }
  // 2xx 但非 JSON 响应体（网关 HTML 等）不得静默当空回复
  if (res!.statusCode >= 200 && res!.statusCode < 300) {
    if (text && parsed === null) {
      throw new AiServiceError('server', `响应体非 JSON（HTTP ${res!.statusCode}）：${text.slice(0, 200)}`)
    }
    return parsed
  }
  throw classifyHttpError(res!.statusCode, text)
}

function classifyHttpError(status: number, bodyText: string): AiServiceError {
  if (status === 401 || status === 403) {
    return new AiServiceError('auth', `认证失败（HTTP ${status}）：请检查 API Key`)
  }
  if (status === 429) {
    // 429 归 rateLimit（之前误归 server，且无退避重试）
    return new AiServiceError('rateLimit', `触发速率限制（HTTP 429）：请稍后重试`)
  }
  if (status === 404) {
    // 404 + model 关键词视为模型不存在；其余归为端点配置错误（限流等含 model 字样的错误不受影响）
    if (/model/i.test(bodyText.slice(0, 300))) {
      return new AiServiceError('model', `模型不存在（HTTP 404）：请检查模型名称`)
    }
    return new AiServiceError('config', `端点不存在（HTTP 404）：请检查 Base URL 是否正确`)
  }
  const body = bodyText.slice(0, 300)
  if (status >= 500) {
    return new AiServiceError('server', `服务端错误（HTTP ${status}）`)
  }
  return new AiServiceError('server', `请求失败（HTTP ${status}）：${body}`)
}

/**
 * 已知推理（思考型）模型按 baseUrl 索引。
 * 部分厂商 /models 端点不返回思考型模型（DeepSeek reasoner、Qwen thinking/qwq 等），
 * 这里在拉取结果后补齐，确保设置页下拉始终可选到推理模型，触发思考块展示。
 */
const REASONING_MODELS_BY_BASE: Record<string, string[]> = {
  'https://api.deepseek.com/v1': ['deepseek-reasoner'],
  'https://dashscope.aliyuncs.com/compatible-mode/v1': ['qwen3-thinking', 'qwq-32b', 'deepseek-r1'],
  'https://open.bigmodel.cn/api/paas/v4': ['glm-z1-flash', 'glm-z1-plus'],
  'https://api.moonshot.cn/v1': ['kimi-k1.5'],
  'https://api.openai.com/v1': ['o3-mini']
}

/** 拉取提供商可用模型列表 */
export async function listModels(providerId: string): Promise<string[]> {
  const provider = findProvider(providerId)
  assertProvider(provider)
  const base = normalizeBase(provider!.baseUrl)
  let fetched: string[]
  if (provider!.kind === 'ollama') {
    const data = (await requestJson(`${base}/api/tags`, { method: 'GET' })) as {
      models?: Array<{ name?: string }>
    } | null
    fetched = (data?.models ?? []).map((m) => m.name ?? '').filter(Boolean)
  } else {
    const headers: Record<string, string> = {}
    if (provider!.apiKey) headers['Authorization'] = `Bearer ${provider!.apiKey}`
    const data = (await requestJson(`${base}/models`, { method: 'GET', headers })) as {
      data?: Array<{ id?: string }>
    } | null
    fetched = (data?.data ?? []).map((m) => m.id ?? '').filter(Boolean)
  }
  // 部分厂商 /models 不列思考型模型，按 baseUrl 补齐已知推理模型，确保下拉可选
  const extra = REASONING_MODELS_BY_BASE[base.toLowerCase()] ?? []
  const seen = new Set(fetched)
  const merged = [...fetched]
  for (const m of extra) {
    if (m && !seen.has(m)) {
      seen.add(m)
      merged.push(m)
    }
  }
  return merged
}

/** 连接测试：探测模型列表端点并计时 */
export async function testProvider(providerId: string): Promise<AiTestResult> {
  const provider = findProvider(providerId)
  if (!provider) {
    return { ok: false, errorKind: 'config', errorMessage: '提供商不存在或已被删除' }
  }
  if (!provider.baseUrl) {
    return { ok: false, errorKind: 'config', errorMessage: 'Base URL 未配置' }
  }
  const started = Date.now()
  try {
    await listModels(providerId)
    return { ok: true, latencyMs: Date.now() - started }
  } catch (err) {
    if (err instanceof AiServiceError) {
      return { ok: false, errorKind: err.kind, errorMessage: err.message }
    }
    return {
      ok: false,
      errorKind: 'network',
      errorMessage: err instanceof Error ? err.message : String(err)
    }
  }
}

/** 发送对话请求（非流式），返回统一 content 与可选工具调用 */
export async function chat(req: AiChatRequest): Promise<AiChatResponse> {
  const provider = findProvider(req.providerId)
  assertProvider(provider)
  const p = provider!
  if (!p.enabled) throw new AiServiceError('config', '提供商已被停用，请先启用或另设默认')
  const model = req.model || p.model
  if (!model) throw new AiServiceError('config', '未指定模型')
  const base = normalizeBase(p.baseUrl)

  // CUE 补全模式：mode='complete' 走 FIM 协议，按厂商/模型路由
  if (req.mode === 'complete' && req.fim) {
    return runFimCompletion(req, p, model, base)
  }

  if (p.kind === 'ollama') {
    const data = (await requestJson(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: serializeOllamaMessages(req.messages),
        ...(req.tools ? { tools: req.tools } : {}),
        stream: false,
        options: {
          temperature: req.temperature ?? p.temperature,
          num_predict: req.maxTokens ?? p.maxTokens
        }
      })
    }, chatTimeoutMs())) as {
      message?: {
        content?: string
        tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>
      }
      model?: string
    } | null
    const content = data?.message?.content ?? ''
    const toolCalls: ToolCallItem[] = (data?.message?.tool_calls ?? [])
      .map((tc, i): ToolCallItem | null => {
        const name = tc.function?.name
        if (!name) return null
        // ollama 的 arguments 是对象，统一收敛为 JSON 字符串
        const args =
          typeof tc.function?.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments ?? {})
        return { id: `call_${i}`, type: 'function', function: { name, arguments: args } }
      })
      .filter((tc): tc is ToolCallItem => tc !== null)
    return {
      content,
      model: data?.model ?? model,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: extractUsage('ollama', data),
      raw: data ?? undefined
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (p.apiKey) headers['Authorization'] = `Bearer ${p.apiKey}`
  const maxTokens = resolveMaxTokens(req.maxTokens, p.maxTokens, model, base)
  const data = (await requestJson(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: serializeOpenAiMessages(req.messages),
      ...(req.tools ? { tools: req.tools } : {}),
      ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
      max_tokens: maxTokens,
      temperature: req.temperature ?? p.temperature
    })
  }, chatTimeoutMs())) as {
    choices?: Array<{
      message?: {
        content?: string | null
        reasoning_content?: string | null
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
      }
    }>
    model?: string
  } | null
  const message = data?.choices?.[0]?.message
  const content = message?.content ?? ''
  const reasoning = message?.reasoning_content ?? ''
  const toolCalls: ToolCallItem[] = (message?.tool_calls ?? [])
    .map(
      (tc, i): ToolCallItem | null =>
        tc.function?.name
          ? {
              id: tc.id ?? `call_${i}`,
              type: 'function',
              function: { name: tc.function.name, arguments: tc.function.arguments ?? '{}' }
            }
          : null
    )
    .filter((tc): tc is ToolCallItem => tc !== null)
  return {
    content,
    reasoning: reasoning || undefined,
    model: data?.model ?? model,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: extractUsage('openai', data),
    raw: data ?? undefined
  }
}

/**
 * CUE FIM 补全：按厂商/模型路由补全协议。
 *
 * - DeepSeek-coder：原生 FIM token（<｜fim_begin｜>prefix<｜fim_hole｜>suffix<｜fim_end｜>）
 *   + POST /completions（FIM 专用端点，响应 choices[].text）
 * - 其他厂商（含 Ollama）：用 system prompt 包装 prefix/suffix，走 chat 端点
 *   （OpenAI 兼容 /chat/completions 或 Ollama /api/chat），复用 chat() 主分支
 *
 * 渲染层只发 { mode:'complete', fim:{prefix,suffix,language,context?} }，协议适配在主进程层完成。
 * fim.context 为仓库级上下文（项目代码/知识库/模板检索结果），注入 FIM prompt 作为只读参考。
 */
async function runFimCompletion(
  req: AiChatRequest,
  p: AiProviderConfig,
  model: string,
  base: string
): Promise<AiChatResponse> {
  const fim = req.fim!
  const prefix = fim.prefix
  const suffix = fim.suffix
  const context = fim.context

  // DeepSeek-coder 走原生 FIM token + /completions 端点
  if (p.kind === 'openai-compatible' && /api\.deepseek\.com/i.test(p.baseUrl) && /^deepseek-coder/i.test(model)) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (p.apiKey) headers['Authorization'] = `Bearer ${p.apiKey}`
    // context 作为「只读仓库参考」置于 prefix 最前
    const prompt = context
      ? `<｜fim_begin｜>// === 仓库参考代码（仅供理解，勿原样重复输出）===\n${context}\n// === 当前文件（待补全位置在 <｜fim_hole｜>）===\n${prefix}<｜fim_hole｜>${suffix}<｜fim_end｜>`
      : `<｜fim_begin｜>${prefix}<｜fim_hole｜>${suffix}<｜fim_end｜>`
    const data = (await requestJson(`${base}/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        prompt,
        max_tokens: req.maxTokens ?? Math.min(p.maxTokens, 512),
        temperature: req.temperature ?? Math.min(p.temperature, 0.2),
        stream: false,
        stop: ['\n\n\n', '```']
      })
    }, chatTimeoutMs())) as {
      choices?: Array<{ text?: string | null }>
      model?: string
    } | null
    const content = data?.choices?.[0]?.text ?? ''
    return {
      content,
      model: data?.model ?? model,
      raw: data ?? undefined
    }
  }

  // 其他厂商走 chat 包装：system 约束只输出补全文本，user 给出 prefix/suffix 代码块
  const systemContent =
    `You are a code completion engine. Complete the code at the cursor position. ` +
    `Output ONLY the code to insert at cursor—no markdown fences, no explanation, no surrounding text. ` +
    `Language: ${fim.language}.` +
    (context
      ? `\nPrefer APIs/patterns shown in the reference context; never repeat unrelated code verbatim.`
      : '')

  const userContent = context
    ? `Related repository context (read-only reference):\n\`\`\`\n${context}\n\`\`\`\n\n` +
      `Code before cursor:\n\`\`\`\n${prefix}\n\`\`\`\n\n` +
      `Code after cursor:\n\`\`\`\n${suffix}\n\`\`\`\n\n` +
      `Output the code to insert at cursor:`
    : `Code before cursor:\n\`\`\`\n${prefix}\n\`\`\`\n\n` +
      `Code after cursor:\n\`\`\`\n${suffix}\n\`\`\`\n\n` +
      `Output the code to insert at cursor:`

  const wrappedReq: AiChatRequest = {
    providerId: req.providerId,
    model: req.model,
    maxTokens: req.maxTokens ?? Math.min(p.maxTokens, 256),
    temperature: req.temperature ?? Math.min(p.temperature, 0.2),
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent }
    ]
  }
  const resp = await chat(wrappedReq)
  // chat 包装可能被模型用 ``` 包裹，做一次轻清洗
  const cleaned = stripCodeFences(resp.content)
  return {
    content: cleaned,
    model: resp.model,
    reasoning: resp.reasoning,
    raw: resp.raw
  }
}

/** 去除模型可能加的 markdown 代码围栏（仅当整体被 ``` 包裹时） */
function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const fenceMatch = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/)
  if (fenceMatch) return fenceMatch[1]
  return trimmed
}

/** 流式对话回调与中断信号（t71s） */
export interface ChatStreamHandlers {
  onDelta: (delta: string) => void
  /** 推理过程增量（reasoning_content），用于前端「思考」折叠块实时展示 */
  onReasoning?: (delta: string) => void
  /** 渲染层点「停止」时 abort；与主进程内部超时信号取或 */
  signal?: AbortSignal
}

/** 流式 tool_calls 分片（OpenAI：delta.tool_calls 按 index 多次到达；Ollama：message.tool_calls 一次给全） */
export interface ToolCallDelta {
  index: number
  id?: string
  name?: string
  argumentsChunk?: string
  /** Ollama：arguments 直接是对象（一次性完整给出） */
  argumentsObject?: Record<string, unknown>
}

/** 从一帧 JSON 中安全提取增量文本（OpenAI delta / Ollama message 两种形态） */
function extractDelta(
  line: string,
  shape: 'openai' | 'ollama'
): { content?: string; reasoning?: string; model?: string; usage?: AiUsage; toolCallDeltas?: ToolCallDelta[] } {
  let j: unknown
  try {
    j = JSON.parse(line)
  } catch {
    return {}
  }
  if (typeof j !== 'object' || j === null) return {}
  const o = j as Record<string, unknown>
  const model = typeof o.model === 'string' ? o.model : undefined
  // usage 采集：厂商主动携带才收——OpenAI 兼容流式默认不发 usage
  //（需 stream_options.include_usage，部分兼容网关不认该选项，主动加会 4xx）；
  // Ollama 流式 chunk 顶层自带 prompt_eval_count / eval_count，天然可收。
  const usage = extractUsage(shape, o)
  if (shape === 'ollama') {
    const msg = o.message
    const content =
      msg && typeof msg === 'object'
        ? (msg as Record<string, unknown>).content
        : undefined
    // Ollama 流式 tool_calls：message.tool_calls 一次性完整给出，arguments 是对象
    const rawCalls =
      msg && typeof msg === 'object'
        ? (msg as Record<string, unknown>).tool_calls
        : undefined
    const toolCallDeltas: ToolCallDelta[] | undefined = Array.isArray(rawCalls)
      ? rawCalls.map((tc, i) => {
          const t = tc as { function?: { name?: string; arguments?: Record<string, unknown> } }
          return {
            index: i,
            name: t.function?.name,
            argumentsObject: t.function?.arguments ?? {}
          }
        })
      : undefined
    return {
      model,
      content: typeof content === 'string' ? content : undefined,
      usage,
      toolCallDeltas
    }
  }
  const choices = o.choices
  const first = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined
  const delta = first?.delta
  if (!delta || typeof delta !== 'object') return { model, usage }
  const d = delta as Record<string, unknown>
  const content = typeof d.content === 'string' ? d.content : undefined
  const reasoning = typeof d.reasoning_content === 'string' ? d.reasoning_content : undefined
  // OpenAI 兼容流式 tool_calls 分片：同 index 的 id/name/arguments 跨 chunk 到达
  const rawDeltas = d.tool_calls
  const toolCallDeltas: ToolCallDelta[] | undefined = Array.isArray(rawDeltas)
    ? rawDeltas.map((tc, i) => {
        const t = tc as {
          index?: number
          id?: string
          function?: { name?: string; arguments?: string }
        }
        return {
          index: typeof t.index === 'number' ? t.index : i,
          id: t.id,
          name: t.function?.name,
          argumentsChunk: typeof t.function?.arguments === 'string' ? t.function.arguments : undefined
        }
      })
    : undefined
  return { model, content, reasoning, usage, toolCallDeltas }
}

/** 发送对话请求（流式 SSE/NDJSON），增量经 handlers.onDelta 回调，最终返回完整响应 */
export async function chatStream(
  req: AiChatRequest,
  handlers: ChatStreamHandlers
): Promise<AiChatResponse> {
  const provider = findProvider(req.providerId)
  assertProvider(provider)
  const p = provider
  if (!p.enabled) throw new AiServiceError('config', '提供商已被停用，请先启用或另设默认')
  const model = req.model || p.model
  if (!model) throw new AiServiceError('config', '未指定模型')
  const base = normalizeBase(p.baseUrl)

  // 内部超时与外部停止任一触发即 abort 上游连接
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), chatTimeoutMs())
  const onExternalAbort = (): void => controller.abort(new Error('canceled'))
  if (handlers.signal?.aborted) controller.abort(new Error('canceled'))
  handlers.signal?.addEventListener('abort', onExternalAbort, { once: true })
  const streamMaxTokens = resolveMaxTokens(req.maxTokens, p.maxTokens, model, base)

  try {
    const url = p.kind === 'ollama' ? `${base}/api/chat` : `${base}/chat/completions`
    const reqBody =
      p.kind === 'ollama'
        ? JSON.stringify({
            model,
            messages: serializeOllamaMessages(req.messages),
            stream: true,
            ...(req.tools?.length ? { tools: req.tools } : {}),
            options: {
              temperature: req.temperature ?? p.temperature,
              num_predict: req.maxTokens ?? p.maxTokens
            }
          })
        : JSON.stringify({
            model,
            messages: serializeOpenAiMessages(req.messages),
            stream: true,
            max_tokens: streamMaxTokens,
            temperature: req.temperature ?? p.temperature,
            ...(req.tools?.length ? { tools: req.tools } : {})
          })
    const reqHeaders =
      p.kind === 'ollama'
        ? { 'Content-Type': 'application/json' }
        : {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {})
          }

    // 429 限流重试（抄 httpUtil.ts Retry-After 范式）。
    // 之前 429 直接归 server 且 requestCount=1 无退避，实测 8ms 即失败。
    let res: Awaited<ReturnType<typeof request>>
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        res = await request(url, {
          method: 'POST',
          headers: reqHeaders,
          body: reqBody,
          dispatcher: await resolveDispatcher(url),
          signal: controller.signal
        })
      } catch (err) {
        if (handlers.signal?.aborted || (err as Error).message === 'canceled') {
          throw new AiServiceError('server', '已停止生成')
        }
        throw toTransportError(err, chatTimeoutMs())
      }

      if (res.statusCode === 429 && attempt < maxAttempts) {
        // 消费响应体避免连接泄漏，再按 Retry-After 退避重试
        await res.body.text().catch(() => {})
        await new Promise((r) => setTimeout(r, retryWaitMs(attempt, res.headers['retry-after'])))
        continue
      }
      break
    }

    if (res!.statusCode < 200 || res!.statusCode >= 300) {
      throw classifyHttpError(res!.statusCode, await res!.body.text())
    }

    const framer = new StreamLineFramer(p.kind !== 'ollama')
    // A5：跨 TCP 分包的中文逐 chunk toString 会出 U+FFFD；用流式 TextDecoder 累积解码
    const utf8 = new TextDecoder('utf-8')
    let content = ''
    let reasoning = ''
    let respModel: string | undefined
    let streamUsage: AiUsage | undefined
    // 流式 tool_calls 累积：OpenAI 按 index 分片到达（id/name 先到，arguments 字符串续传）；
    // Ollama 一次性给全（arguments 是对象）。最终合并为 ToolCallItem[]。
    const toolCallAcc = new Map<number, { id: string; name: string; arguments: string; argumentsObject?: Record<string, unknown> }>()
    const consumeLine = (line: string): void => {
      if (p.kind !== 'ollama' && line === '[DONE]') return
      const piece = extractDelta(line, p.kind === 'ollama' ? 'ollama' : 'openai')
      if (piece.model && !respModel) respModel = piece.model
      if (piece.content) {
        content += piece.content
        handlers.onDelta(piece.content)
      }
      if (piece.reasoning) {
        reasoning += piece.reasoning
        handlers.onReasoning?.(piece.reasoning)
      }
      if (piece.toolCallDeltas) {
        for (const d of piece.toolCallDeltas) {
          const acc = toolCallAcc.get(d.index) ?? { id: '', name: '', arguments: '' }
          if (d.id) acc.id = d.id
          if (d.name) acc.name = d.name
          if (d.argumentsChunk) acc.arguments += d.argumentsChunk
          if (d.argumentsObject) acc.argumentsObject = d.argumentsObject
          toolCallAcc.set(d.index, acc)
        }
      }
      // 流式 usage：厂商 chunk 主动携带才收（OpenAI 默认不发，见 extractDelta 注释）
      if (piece.usage) streamUsage = piece.usage
    }
    // 流式读取途中超时/中断同样归类，避免底层异常（含英文 DOMException）直接冒到 UI
    try {
      for await (const chunk of res!.body as AsyncIterable<Buffer>) {
        for (const line of framer.push(utf8.decode(chunk, { stream: true }))) consumeLine(line)
      }
      for (const line of framer.flush()) consumeLine(line)
    } catch (err) {
      if (handlers.signal?.aborted || (err as Error).message === 'canceled') {
        throw new AiServiceError('server', '已停止生成')
      }
      throw toTransportError(err, chatTimeoutMs())
    }

    // 合并流式 tool_calls 分片（按 index 排序，id 缺省时生成占位）
    const toolCalls: ToolCallItem[] | undefined =
      toolCallAcc.size > 0
        ? [...toolCallAcc.entries()]
            .sort(([a], [b]) => a - b)
            .map(([i, acc]) => ({
              id: acc.id || `call_stream_${i}`,
              type: 'function' as const,
              function: {
                name: acc.name,
                arguments: acc.argumentsObject
                  ? JSON.stringify(acc.argumentsObject)
                  : acc.arguments || '{}'
              }
            }))
        : undefined

    return {
      content,
      reasoning: reasoning || undefined,
      model: respModel ?? model,
      usage: streamUsage,
      toolCalls
    }
  } finally {
    clearTimeout(timer)
    handlers.signal?.removeEventListener('abort', onExternalAbort)
  }
}

/** 内部消息 -> OpenAI 兼容格式（tool 角色带 tool_call_id，assistant 带回传 tool_calls） */
function serializeOpenAiMessages(messages: ChatMessage[] | undefined): unknown[] {
  const list = messages ?? []
  return list.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content }
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return { role: 'assistant', content: m.content, tool_calls: m.toolCalls }
    }
    // 用户图片：转 OpenAI vision 多模态 content parts
    if (m.role === 'user' && m.images && m.images.length > 0) {
      return {
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          ...m.images.map((url) => ({ type: 'image_url', image_url: { url } }))
        ]
      }
    }
    return { role: m.role, content: m.content }
  })
}

/** Ollama 图片字段要求纯 base64（去掉 data URL 的 mime 前缀） */
function toOllamaImage(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 && dataUrl.startsWith('data:') ? dataUrl.slice(comma + 1) : dataUrl
}

/** 内部消息 -> Ollama /api/chat 格式（arguments 需为对象，tool 角色带 tool_name） */
function serializeOllamaMessages(messages: ChatMessage[] | undefined): unknown[] {
  const list = messages ?? []
  return list.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content }
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((tc) => ({
          function: {
            name: tc.function.name,
            arguments: safeParseArgs(tc.function.arguments)
          }
        }))
      }
    }
    // 用户图片：Ollama 协议 images 为纯 base64 数组
    if (m.role === 'user' && m.images && m.images.length > 0) {
      return { role: 'user', content: m.content, images: m.images.map(toOllamaImage) }
    }
    return { role: m.role, content: m.content }
  })
}

function safeParseArgs(args: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(args)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function findProvider(id: string): AiProviderConfig | undefined {
  return getSection('ai').providers.find((p) => p.id === id)
}

function assertProvider(p: AiProviderConfig | undefined): asserts p is AiProviderConfig {
  if (!p) throw new AiServiceError('config', '提供商不存在或已被删除')
  if (!p.baseUrl) throw new AiServiceError('config', 'Base URL 未配置')
}
