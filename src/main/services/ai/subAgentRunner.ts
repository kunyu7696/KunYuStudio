/**
 * 子代理委派回路（多代理 M1）。
 *
 * 主代理经 agent_delegate 工具把「边界明确的调研类小任务」委派给子代理：
 * 子代理跑一次独立 FC 小循环（自己的消息历史、轮次与超时护栏），可用工具被
 * 收敛为只读集（见 SUB_AGENT_ALLOWED_BEHAVIOR），跑完把浓缩结论回填主代理——
 * 子代理的过程消息不进主上下文，避免烧穿主对话预算。
 *
 * 护栏（与 toolGuards 同源思路）：
 * - 深度锁死 1 层：子代理工具集由行为级目录过滤，agent_delegate 是
 *   external-effect 天然不在其内，套娃在结构上不可能；
 * - 轮次上限 SUB_AGENT_MAX_ROUNDS、总超时 SUB_AGENT_TIMEOUT_MS；
 * - 执行侧再查一次白名单（isSubAgentToolAllowed），防御定义过滤被绕；
 * - 全部软失败（ok:false + 中文原因），不阻断主流水线。
 *
 * 成本闸门：工具本身由设置 ai.subAgentEnabled 门控（toolPolicy 可见性规则
 * 'subagent'），关闭时 agent_delegate 不进入 FC 列表，本回路不会被触发。
 */
import type { AiChatRequest, AiChatResponse, ChatMessage, ToolCallItem } from '../../../shared/types/ai'
import type { ToolExecContext, ToolResult } from './toolRegistry'
import { TOOL_BEHAVIORS } from './fcTools/toolPolicy'
import { clipToolResult } from './orchestrator/toolGuards'

/** 子代理最大 FC 轮次（每轮 = 一次模型调用 + 若干工具执行） */
export const SUB_AGENT_MAX_ROUNDS = 6
/** 子代理总超时（ms） */
export const SUB_AGENT_TIMEOUT_MS = 120_000
/** 子代理回填结论的截断上限（字符） */
const SUB_AGENT_REPLY_MAX_CHARS = 3_000
/** 子代理单条工具结果截断（比主循环更紧，控制子上下文） */
const SUB_AGENT_TOOL_CLIP = 1_500

/**
 * 子代理额外放行的非 readonly 工具：web_fetch（external-effect，但属联网检索性质，
 * B1 已有协议/限量护栏）。其余 external-effect / project-write 一律不放行——
 * 子代理不写盘、不构建、不操控游戏、不再委派。
 */
const SUB_AGENT_EXTRA_ALLOWED: ReadonlySet<string> = new Set(['web_fetch'])

/** 子代理工具白名单判定（定义过滤与执行复核共用同一函数，语义唯一属主） */
export function isSubAgentToolAllowed(name: string): boolean {
  if (SUB_AGENT_EXTRA_ALLOWED.has(name)) return true
  return TOOL_BEHAVIORS[name] === 'readonly'
}

export interface SubAgentRunInput {
  /** 委派任务描述（主代理给出，要求边界明确） */
  task: string
  /** 主代理补充的上下文（可选，如已查到的线索） */
  context?: string
  /** 工具执行上下文透传（loader/mcVersion 等，与主代理同 run 一致） */
  ctx: ToolExecContext
  /** 子代理可用的工具定义（调用方已按 isSubAgentToolAllowed 过滤） */
  tools: AiChatRequest['tools']
  /** 工具执行出口（共享主注册表；执行侧再复核白名单） */
  executeTool: (name: string, args: Record<string, unknown>, ctx: ToolExecContext) => Promise<ToolResult>
  /** 模型调用出口（默认 aiService.chat，测试注入假实现） */
  chat: (req: AiChatRequest) => Promise<AiChatResponse>
  providerId: string
  model?: string
  maxRounds?: number
  timeoutMs?: number
  /**
   * M3：子代理内部工具调用事件出口（agent_delegate 注入）。
   * 每次执行子代理工具前后各回调一次，供编排层把过程嵌套进主 run 事件流；
   * 未注入时子代理静默执行（旧行为）。
   */
  onToolActivity?: (activity: {
    /** 子代理内部稳定的调用序号（r{round}-{index}），渲染层合并进行中→结果用 */
    callId: string
    tool: string
    /** 执行结果；undefined=进行中 */
    ok?: boolean
    summary: string
  }) => void
}

export interface SubAgentRunResult {
  ok: boolean
  /** 浓缩结论（回填主代理） */
  text: string
  error?: string
  /** 实际经历的 FC 轮数（诊断/测试用） */
  rounds: number
}

const SUB_AGENT_SYSTEM_PROMPT = [
  '你是 KunYuStudio 的子代理，负责完成主代理委派的一个边界明确的调研小任务。',
  '你可以使用只读检索类工具（本地知识库/模板/原版数据/项目代码检索/联网抓取等）收集证据。',
  '纪律：优先本地实证，联网仅作补充；不得编造 API、类名或标识符；无法证实的结论显式标注「未证实」。',
  '完成后用中文输出浓缩结论（要点式，附关键依据），不要输出过程流水账。'
].join('\n')

/** 跑一次子代理小循环；全部软失败。 */
export async function runSubAgent(input: SubAgentRunInput): Promise<SubAgentRunResult> {
  const maxRounds = Math.max(1, Math.min(SUB_AGENT_MAX_ROUNDS, Math.trunc(input.maxRounds ?? SUB_AGENT_MAX_ROUNDS)))
  const timeoutMs = Math.max(10_000, Math.min(SUB_AGENT_TIMEOUT_MS, input.timeoutMs ?? SUB_AGENT_TIMEOUT_MS))
  const deadline = Date.now() + timeoutMs

  const messages: ChatMessage[] = [
    { role: 'system', content: SUB_AGENT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: input.context ? `任务：${input.task}\n\n已知上下文：\n${input.context}` : `任务：${input.task}`
    }
  ]

  for (let round = 1; round <= maxRounds; round++) {
    if (Date.now() > deadline) {
      return { ok: false, text: '', error: `子代理超时（>${Math.round(timeoutMs / 1000)}s），已中止`, rounds: round - 1 }
    }
    const lastRound = round === maxRounds
    let res: AiChatResponse
    try {
      res = await input.chat({
        providerId: input.providerId,
        model: input.model,
        messages,
        tools: lastRound ? undefined : input.tools,
        // 末轮逼出最终结论，不再放行工具调用
        toolChoice: lastRound ? 'none' : 'auto'
      })
    } catch (e) {
      return { ok: false, text: '', error: `子代理模型调用失败：${(e as Error).message}`, rounds: round }
    }

    const calls = res.toolCalls ?? []
    if (lastRound || calls.length === 0) {
      const text = res.content.trim()
      if (!text) {
        return { ok: false, text: '', error: '子代理未产出结论（空响应）', rounds: round }
      }
      return {
        ok: true,
        text: text.length > SUB_AGENT_REPLY_MAX_CHARS ? `${text.slice(0, SUB_AGENT_REPLY_MAX_CHARS)}\n…（结论已截断）` : text,
        rounds: round
      }
    }

    messages.push({ role: 'assistant', content: res.content, toolCalls: calls })
    for (let callIndex = 0; callIndex < calls.length; callIndex++) {
      const call = calls[callIndex] as ToolCallItem
      const name = call.function.name
      // M3：子代理内部调用的稳定 id（渲染层据此合并进行中→结果）
      const subCallId = `r${round}-${callIndex}`
      if (!isSubAgentToolAllowed(name)) {
        input.onToolActivity?.({ callId: subCallId, tool: name, ok: false, summary: '不在子代理白名单内，已拒绝' })
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: `工具 ${name} 不在子代理白名单内（子代理仅可只读检索），已拒绝。`
        })
        continue
      }
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
      } catch {
        input.onToolActivity?.({ callId: subCallId, tool: name, ok: false, summary: '参数 JSON 解析失败' })
        messages.push({ role: 'tool', toolCallId: call.id, content: '参数 JSON 解析失败' })
        continue
      }
      const targetHint =
        typeof args['query'] === 'string' ? (args['query'] as string)
        : typeof args['relPath'] === 'string' ? (args['relPath'] as string)
        : typeof args['url'] === 'string' ? (args['url'] as string)
        : typeof args['pattern'] === 'string' ? (args['pattern'] as string)
        : ''
      input.onToolActivity?.({ callId: subCallId, tool: name, summary: targetHint })
      const r = await input.executeTool(name, args, input.ctx)
      const body = r.ok ? r.text : `工具执行失败：${r.error ?? '未知错误'}`
      const firstLine = body.split('\n').find((l) => l.trim().length > 0) ?? ''
      input.onToolActivity?.({
        callId: subCallId,
        tool: name,
        ok: r.ok,
        summary: firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine
      })
      messages.push({ role: 'tool', toolCallId: call.id, content: clipToolResult(body, SUB_AGENT_TOOL_CLIP) })
    }
  }
  // 循环理论可达（lastRound 已强制收口），兜底返回
  return { ok: false, text: '', error: '子代理轮次耗尽且未产出结论', rounds: maxRounds }
}

/* ------------------------------------------------------------------ */
/* M2 并行只读批常量：并发池实现在 fcTools/subAgentTools.ts（基于          */
/* deps.runSubAgent 单任务端口），此处仅集中维护上限，供两侧与测试引用。    */
/* ------------------------------------------------------------------ */

/** 单批任务数上限 */
export const SUB_AGENT_BATCH_MAX_TASKS = 4
/** 批内并发上限 */
export const SUB_AGENT_BATCH_CONCURRENCY = 3
