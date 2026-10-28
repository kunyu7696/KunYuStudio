import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { IpcChannels } from '../../../shared/types/ipc'
import { asAiResult, chat, chatStream, listModels, testProvider } from '../../services/aiService'
import { getReferenceService } from '../../services/ai/referencePackageService'
import { collectCueContext } from '../../services/ai/cueContextService'
import { notifyPetAgentEvent } from '../../services/dsh/petService'
import { createToolRegistry } from '../../services/ai/toolRegistry'
import { createModelListCache } from '../../services/ai/modelListCache'
import {
  composeCompacted,
  HISTORY_SUMMARY_PROMPT,
  planHistoryCompaction
} from '../../services/ai/orchestrator/historyBudget'
import { appendMemoryEntry } from '../../services/ai/fcTools/memoryTools'
import { getSection } from '../../services/settingsService'
import {
  AGENT_CONTEXT_TOKEN_CAP,
  CHAT_CONTEXT_FALLBACK_CAP,
  resolveContextBudget
} from '../../../shared/types/ai'
import type {
  AiChatRequest,
  AiChatResponse,
  AiResult,
  AiStreamEvent,
  ChatMessage,
  ModelListInfo
} from '../../../shared/types/ai'
import type { AgentEvent, AgentPhaseState } from '../../../shared/types/agent'
import type { IpcContext } from '../context'

/** AI 助手工具循环上限（防止 tool 死循环；普通聊天放宽，联网检索多轮不焦虑） */
const MAX_TOOL_ROUNDS = 16

/** 聊天历史压缩：微压缩后仍超预算时摘要旧轮次，保留最近轮次数（与编排器同参） */
const HISTORY_KEEP_ROUNDS = 3
/** 微压缩：单条 tool 结果字符上限（与编排器同参） */
const HISTORY_TOOL_RESULT_CHARS = 8000
/** 摘要输入：单条消息字符上限 */
const HISTORY_SUMMARY_MSG_CHARS = 2000
/** 摘要输入：总量字符上限 */
const HISTORY_SUMMARY_INPUT_CHARS = 24_000

/** 把待摘要的旧轮次拼成摘要输入文本（逐条截断 + 总量封顶，防摘要请求本身爆预算） */
function buildSummaryInput(rounds: ChatMessage[]): string {
  const parts: string[] = []
  let total = 0
  for (const m of rounds) {
    const body = (m.content ?? '').slice(0, HISTORY_SUMMARY_MSG_CHARS)
    const line = `[${m.role}] ${body}`
    if (total + line.length > HISTORY_SUMMARY_INPUT_CHARS) break
    parts.push(line)
    total += line.length
  }
  return parts.join('\n\n')
}

/**
 * 上下文压缩（聊天链路）：超预算时先微压缩 tool 结果，仍超则摘要旧轮次，
 * 并把摘要写入项目持久记忆（.kunyu/agent-memory.md）做跨会话交接。
 * 全程对用户可见：压缩发生后在正文流中插入一行通知。
 *
 * 同步路径设计：预算内/仅微压缩时本函数**不产生任何 await**（保持首个 chatStream
 * 调用同步发出，abort 时序不被打乱）；仅确需 LLM 摘要时才返回 Promise。
 */
function compactChatHistoryIfNeeded(
  req: AiChatRequest,
  messages: ChatMessage[],
  projectRoot: string | null,
  notify: (text: string) => void
): Promise<void> | null {
  let plan: ReturnType<typeof planHistoryCompaction>
  try {
    const providerWindow = getSection('ai').providers.find((p) => p.id === req.providerId)
      ?.contextWindow
    plan = planHistoryCompaction(messages, {
      budgetTokens: resolveContextBudget(
        providerWindow,
        AGENT_CONTEXT_TOKEN_CAP,
        CHAT_CONTEXT_FALLBACK_CAP
      ),
      keepRounds: HISTORY_KEEP_ROUNDS,
      maxToolChars: HISTORY_TOOL_RESULT_CHARS
    })
  } catch {
    // 压缩是增强不是关键路径：设置读取/估算异常时静默跳过，绝不影响聊天主流程
    return null
  }
  if (!plan.changed && !plan.needsSummary) return null

  if (!plan.needsSummary) {
    messages.length = 0
    messages.push(...plan.messages)
    return null
  }

  // 确需摘要：返回 Promise 由调用方 await
  return (async () => {
    let summary = ''
    try {
      const r = await chat({
        ...req,
        tools: [],
        toolChoice: undefined,
        messages: [
          { role: 'system', content: HISTORY_SUMMARY_PROMPT },
          { role: 'user', content: buildSummaryInput(plan.oldRounds) }
        ]
      })
      summary = (r?.content ?? '').trim()
    } catch {
      // 摘要失败回退为直接裁剪旧轮次（聊天链路无预算熔断概念，不向上抛）
    }
    messages.length = 0
    messages.push(...(summary ? composeCompacted(plan.head, summary, plan.recent) : plan.messages))

    if (summary && projectRoot) {
      // 跨会话交接：摘要进项目记忆（单条 500 字上限，超出部分截断——完整摘要仍在当前会话消息里）
      appendMemoryEntry(projectRoot, `[上下文交接] 会话压缩摘要：${summary.slice(0, 380)}`)
    }
    notify(
      summary
        ? `\n\n—— 上下文已自动压缩：早期 ${plan.oldRounds.length} 条消息已摘要（压缩前约 ${plan.tokensBefore} tokens），摘要已交接进项目记忆 ——\n\n`
        : `\n\n—— 上下文已自动压缩：裁剪了 ${plan.oldRounds.length} 条早期消息（压缩前约 ${plan.tokensBefore} tokens） ——\n\n`
    )
  })()
}

/** 懒创建的工具注册表（chat 链路专用，无 deps） */
let _chatRegistry: ReturnType<typeof createToolRegistry> | null = null
function chatRegistry() {
  if (!_chatRegistry) {
    _chatRegistry = createToolRegistry({})
  }
  return _chatRegistry
}

/** 如果调用方没传 tools，自动注入 chat 类工具（让 AI 助手能用 web_fetch 联网等） */
function withChatTools(req: AiChatRequest): AiChatRequest {
  if (req.tools && req.tools.length > 0) return req
  const defs = chatRegistry().getToolDefinitions()
  if (defs.length === 0) return req
  return { ...req, tools: defs }
}

/** 全流式 tool loop：每轮 chatStream 实时流出 content/reasoning；
 *  流末若带 tool_calls 则执行工具并继续下一轮，直到模型不再调工具为止。
 *  用户可见完整过程：思考流 → 正文流 → 🔧 工具执行 → 继续正文流。 */
async function chatStreamWithTools(
  req: AiChatRequest,
  handlers: {
    signal?: AbortSignal
    onDelta: (delta: string) => void
    onReasoning?: (delta: string) => void
    /** tool 开始执行（给渲染层显示中间态：🔧 正在联网...） */
    onToolStart?: (name: string, args: Record<string, unknown>) => void
    /** tool 执行完毕（给渲染层显示结果：✅ web_fetch 完成） */
    onToolEnd?: (name: string, ok: boolean, summary: string) => void
  },
  projectRoot: string | null = null
) {
  const reg = chatRegistry()
  const currentReq = withChatTools(req)
  const messages = [...(currentReq.messages ?? [])]
  let totalContent = ''
  let totalReasoning = ''
  let lastModel: string | undefined
  let lastUsage: AiChatResponse['usage']
  let rounds = 0

  while (true) {
    // 每轮请求前检查历史预算：超了先压缩（微压缩→摘要→记忆交接），再往厂商发。
    // 预算内返回 null 不产生 await，保证首个 chatStream 调用同步发出（abort 时序不变）。
    const pendingCompaction = compactChatHistoryIfNeeded(currentReq, messages, projectRoot, (t) => {
      totalContent += t
      handlers.onDelta(t)
    })
    if (pendingCompaction) await pendingCompaction
    const res = await chatStream(
      { ...currentReq, messages },
      {
        signal: handlers.signal,
        onDelta: (d) => {
          totalContent += d
          handlers.onDelta(d)
        },
        onReasoning: (d) => {
          totalReasoning += d
          handlers.onReasoning?.(d)
        }
      }
    )
    if (res.model) lastModel = res.model
    if (res.usage) lastUsage = res.usage

    // 无 tool_calls → 本轮即最终答复，结束
    if (!res.toolCalls || res.toolCalls.length === 0) {
      return {
        content: totalContent,
        reasoning: totalReasoning || undefined,
        model: lastModel ?? '',
        usage: lastUsage
      }
    }

    rounds++
    if (rounds >= MAX_TOOL_ROUNDS) {
      // 达到上限：提示并返回已累积内容
      const warn = '\n\n（工具调用轮次较多，已自动收尾；如需继续可追问一句）'
      handlers.onDelta(warn)
      totalContent += warn
      return {
        content: totalContent,
        reasoning: totalReasoning || undefined,
        model: lastModel ?? '',
        usage: lastUsage
      }
    }

    // 回传 assistant 的 tool_calls（camelCase 字段，serializeOpenAiMessages 才能识别）
    messages.push({
      role: 'assistant',
      content: res.content ?? '',
      toolCalls: res.toolCalls
    })
    // 顺序执行工具并回填 tool 消息
    for (const tc of res.toolCalls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function.arguments || '{}')
      } catch {
        args = {}
      }
      handlers.onToolStart?.(tc.function.name, args)
      // chat 链路无项目上下文：loader/mcVersion 给占位值，chat 类工具不消费这两字段
      const result = await reg.executeTool(tc.function.name, args, {
        loader: 'fabric',
        mcVersion: '',
        scheduling: false
      })
      const summary = result.ok
        ? result.data && typeof result.data === 'object' && 'chars' in result.data
          ? `完成，约 ${(result.data.chars as number).toLocaleString()} 字符`
          : '完成'
        : (result.error ?? '执行失败')
      handlers.onToolEnd?.(tc.function.name, result.ok, summary)
      messages.push({
        role: 'tool',
        toolCallId: tc.id,
        content: result.ok ? result.text : `工具执行失败：${result.error}`
      })
    }
  }
}

/**
 * 普通问答（非 Agent 模式）本来不经过 Agent 事件流，桌宠无法跟进。
 * 这里在流生命周期上合成 `chat:<streamId>` 事件喂给桌宠：
 * 开始→running，成功→done，失败→error，用户中断→skipped（回空闲）。
 * 桌宠未启动时 notifyPetAgentEvent 静默丢弃，零负担。
 */
function feedChatPetEvent(streamId: string, phase: AgentPhaseState, seq: number): void {
  const event: AgentEvent = {
    type: 'phase',
    phase,
    runId: `chat:${streamId}`,
    seq,
    stage: 'understand',
    at: new Date().toISOString()
  }
  notifyPetAgentEvent(event)
}

/** 模型列表缓存：惰性创建，路径取自 userData；测试环境无 app 时退化为不缓存 */
let modelListCache: ReturnType<typeof createModelListCache> | null | undefined

function getModelListCache(): ReturnType<typeof createModelListCache> | null {
  if (modelListCache === undefined) {
    const base = typeof app?.getPath === 'function' ? app.getPath('userData') : ''
    modelListCache = base
      ? createModelListCache({ path: join(base, 'ai', 'model-list-cache.json') })
      : null
  }
  return modelListCache
}

/** AI 助手对话（M6）：渲染进程无直接网络权限，全部经主进程代理 */
export function registerAiChatHandlers(ctx: IpcContext): void {
  // force=true 跳过 24h 缓存；默认命中缓存直接返回，避免每次进设置页都打厂商端口
  ipcMain.handle(
    IpcChannels.AI_LIST_MODELS,
    async (_event, providerId: string, force?: boolean): Promise<AiResult<ModelListInfo>> => {
      const cache = getModelListCache()
      if (!force) {
        const hit = cache?.read(providerId) ?? null
        if (hit) {
          return { ok: true, data: { models: hit.models, fetchedAt: hit.fetchedAt, fromCache: true } }
        }
      }
      const res = await asAiResult(listModels(providerId))
      if (!res.ok) return res
      const entry = cache?.write(providerId, res.data) ?? {
        models: res.data,
        fetchedAt: Date.now()
      }
      return {
        ok: true,
        data: { models: entry.models, fetchedAt: entry.fetchedAt, fromCache: false }
      }
    }
  )
  ipcMain.handle(IpcChannels.AI_TEST, (_event, providerId: string) => testProvider(providerId))
  // 非流式问答：同样过历史预算（压缩通知并入正文前缀，保持用户可见）
  ipcMain.handle(IpcChannels.AI_CHAT, async (_event, req: AiChatRequest) => {
    const r = withChatTools(req)
    const messages = [...(r.messages ?? [])]
    let notice = ''
    const pending = compactChatHistoryIfNeeded(
      r,
      messages,
      ctx.activeProject?.current ?? null,
      (t) => { notice += t }
    )
    if (pending) await pending
    const res = await asAiResult(chat({ ...r, messages }))
    if (res.ok && notice) return { ...res, data: { ...res.data, content: notice + res.data.content } }
    return res
  })
  // KunYuStudio 应用能力清单（AI 助手自我认知）：渲染层 chat 链路的系统提示词在前端组装，
  // 清单由 main 从参考包读取经 IPC 下发；参考包缺失时返回 null，前端静默缺省
  ipcMain.handle(IpcChannels.AI_KUNYU_CAPABILITIES, () =>
    getReferenceService().getKunyuCapabilities()
  )

  // t71s 流式对话：每路一个 AbortController，delta/done/error 经 webContents 推回渲染层
  const activeStreams = new Map<string, AbortController>()
  ipcMain.handle(
    IpcChannels.AI_CHAT_STREAM,
    async (_event, streamId: string, req: AiChatRequest) => {
      const controller = new AbortController()
      activeStreams.set(streamId, controller)
      const emit = (ev: AiStreamEvent): void => {
        if (!ctx.win.isDestroyed()) ctx.win.webContents.send(IpcChannels.AI_STREAM_EVENT, ev)
      }
      try {
        feedChatPetEvent(streamId, 'running', 0)
        // chatStreamWithTools 自动注入 FC tools（web_fetch 等）并执行 tool loop
        const response = await chatStreamWithTools(req, {
          signal: controller.signal,
          onDelta: (delta) => emit({ streamId, type: 'delta', delta }),
          onReasoning: (delta) => emit({ streamId, type: 'reasoning', delta }),
          onToolStart: (name, args) => emit({ streamId, type: 'tool-start', name, args }),
          onToolEnd: (name, ok, summary) => emit({ streamId, type: 'tool-end', name, ok, summary })
        }, ctx.activeProject?.current ?? null)
        emit({ streamId, type: 'done', response })
        feedChatPetEvent(streamId, 'done', 1)
        return { ok: true as const, data: response }
      } catch (err) {
        // 用户主动中断：STOP 通道已发 skipped，不补发 error 覆盖回空闲态
        if (!controller.signal.aborted) feedChatPetEvent(streamId, 'error', 1)
        const wrapped = await asAiResult(Promise.reject(err))
        if (!wrapped.ok) {
          emit({
            streamId,
            type: 'error',
            errorKind: wrapped.errorKind,
            errorMessage: wrapped.errorMessage
          })
        }
        return wrapped
      } finally {
        activeStreams.delete(streamId)
      }
    }
  )
  ipcMain.handle(IpcChannels.AI_CHAT_STOP, (_event, streamId: string) => {
    const controller = activeStreams.get(streamId)
    if (controller) {
      controller.abort()
      feedChatPetEvent(streamId, 'skipped', 1)
    }
  })

  // M3：仓库级上下文检索（供 CUE 补全注入参考）
  ipcMain.handle(IpcChannels.AI_CUE_CONTEXT, async (_event, input) => {
    try {
      const result = await collectCueContext(input)
      return { ok: true as const, data: result }
    } catch (e) {
      return { ok: false as const, error: (e as Error).message }
    }
  })
}
