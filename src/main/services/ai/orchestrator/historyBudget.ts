/**
 * FC 工具循环历史的 token 估算与分层压缩（P2）。
 *
 * 背景：旧的 clipToolHistory 只按「保留最近 N 轮 + 单条 tool 结果截断」做确定性裁剪，
 * 被裁掉的旧轮次信息直接丢失。P2 改为 token 感知的分层压缩：
 *
 *   Layer 0（预算内）：估算 token 未超预算 → 原样保留（不再无脑只留 3 轮）。
 *   Layer 1（微压缩）：超预算 → 先按字符预算截断各条 tool 结果（确定性、零成本，不丢结构）。
 *   Layer 2（摘要）：微压缩后仍超预算且存在「超出最近 keepRounds 轮」的旧轮次 →
 *                   把这些旧轮次交由上层用 LLM 摘要成一段文本（信息以摘要形式保留，而非丢失）。
 *
 * 纯函数、零依赖，便于 vitest 直接验证；LLM 摘要调用由调用方（generatePipeline）发起。
 */
import type { ChatMessage } from '../../../../shared/types/ai'

/**
 * 默认 FC 历史 token 预算（估算）：超过即触发分层压缩。
 * 原 40k 对多轮 agent 任务偏紧（读几个大文件就要压缩，旧结论很快被摘要掉），
 * 提到 64k 以适配主流 128k 上下文模型；预算内仍原样保留完整历史。
 */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 64_000

/** 每条消息的角色/结构开销（估算 token） */
const MESSAGE_OVERHEAD = 6
/** 每张图片的固定估算开销（图片以 data URL 存在，按字符数估算会严重偏高） */
const IMAGE_TOKEN_COST = 1500

/** CJK（中日韩）字符：按 1 字 ≈ 1 token 估算 */
const CJK_RE = /[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g

/**
 * 粗略 token 估算：CJK 字符按 1 token/字，其余（ASCII/代码）按 1 token/4 字符。
 * 只用于决定是否压缩，不追求与具体厂商 tokenizer 对齐。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = text.match(CJK_RE)?.length ?? 0
  const rest = text.length - cjk
  return cjk + Math.ceil(rest / 4)
}

/** 估算一组消息的 token 总量（含 toolCalls 参数与图片固定开销）。 */
export function estimateMessagesTokens(messages: ChatMessage[]): number {
  let total = 0
  for (const m of messages) {
    total += MESSAGE_OVERHEAD
    total += estimateTokens(m.content ?? '')
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        total += estimateTokens(tc.function.name) + estimateTokens(tc.function.arguments)
      }
    }
    if (m.images) total += IMAGE_TOKEN_COST * m.images.length
  }
  return total
}

export interface CompactionOptions {
  /** token 预算；估算未超过则不压缩 */
  budgetTokens: number
  /** 摘要后保留的最近轮次数（超出部分作为旧轮次被摘要） */
  keepRounds: number
  /** 微压缩：单条 tool 结果字符上限（省略则不裁内容） */
  maxToolChars?: number
}

export interface HistoryCompaction {
  /**
   * 压缩后的消息：
   * - needsSummary=false → 最终消息，可直接替换；
   * - needsSummary=true  → 兜底消息（已丢弃旧轮次），摘要成功时改用 composeCompacted。
   */
  messages: ChatMessage[]
  /** messages 相对入参是否有变化（无变化时调用方无需替换） */
  changed: boolean
  /** 是否需要上层发起 LLM 摘要（true 时 oldRounds 非空） */
  needsSummary: boolean
  /** 供摘要的旧轮次（needsSummary=true 时非空） */
  oldRounds: ChatMessage[]
  /** system + user 初始头部（摘要消息插入其之后） */
  head: ChatMessage[]
  /** 保留的最近轮次 */
  recent: ChatMessage[]
  /** 压缩前估算 token */
  tokensBefore: number
  /** 微压缩后估算 token */
  tokensAfterMicro: number
}

/** 单条 tool 结果按字符预算截断（保持与旧 clipToolHistory 一致的提示文案）。 */
function clipToolMessage(m: ChatMessage, maxToolChars: number): ChatMessage {
  if (m.role !== 'tool' || m.content.length <= maxToolChars) return m
  const total = m.content.length
  return { ...m, content: `${m.content.slice(0, maxToolChars)}\n\n[…内容已裁剪，原始 ${total} 字符]` }
}

/** 按 assistant 分组为轮次（每遇到 assistant 开启新组；非 assistant 归入当前组）。 */
function groupRounds(body: ChatMessage[]): ChatMessage[][] {
  const rounds: ChatMessage[][] = []
  let current: ChatMessage[] = []
  for (const m of body) {
    if (m.role === 'assistant' && current.length > 0) {
      rounds.push(current)
      current = []
    }
    current.push(m)
  }
  if (current.length > 0) rounds.push(current)
  return rounds
}

/**
 * 规划一次历史压缩（纯函数，不做 LLM 调用）。
 *
 * 返回 needsSummary=true 时，调用方应把 oldRounds 交给模型摘要，
 * 再用 composeCompacted(head, summary, recent) 重建消息数组。
 */
export function planHistoryCompaction(
  messages: ChatMessage[],
  opts: CompactionOptions
): HistoryCompaction {
  const { budgetTokens, keepRounds, maxToolChars } = opts
  const tokensBefore = estimateMessagesTokens(messages)

  const passthrough = (): HistoryCompaction => ({
    messages,
    changed: false,
    needsSummary: false,
    oldRounds: [],
    head: [...messages],
    recent: [],
    tokensBefore,
    tokensAfterMicro: tokensBefore
  })

  if (messages.length <= 2 || keepRounds <= 0) return passthrough()
  // 预算内：保留完整历史（不再无脑只留 N 轮）
  if (tokensBefore <= budgetTokens) return passthrough()

  // head = 开头连续的 system 消息（主 system + 项目事实注入行）+ user 初始
  let headEnd = 0
  while (messages[headEnd]?.role === 'system') headEnd += 1
  if (messages[headEnd]?.role === 'user') headEnd += 1
  const head = messages.slice(0, headEnd)
  const rounds = groupRounds(messages.slice(headEnd))

  // Layer 1：微压缩——按字符预算截断各条 tool 结果（确定性、零成本）
  let clipped = rounds
  let clippedAny = false
  if (maxToolChars && maxToolChars > 0) {
    clipped = rounds.map((r) =>
      r.map((m) => {
        const next = clipToolMessage(m, maxToolChars)
        if (next !== m) clippedAny = true
        return next
      })
    )
  }
  const flat = clipped.flat()
  const tokensAfterMicro = estimateMessagesTokens([...head, ...flat])

  // Layer 2：仍超预算且存在超出最近 keepRounds 轮的旧轮次 → 交给上层摘要
  if (clipped.length > keepRounds) {
    const oldRounds = clipped.slice(0, clipped.length - keepRounds).flat()
    const recent = clipped.slice(clipped.length - keepRounds).flat()
    return {
      messages: [...head, ...recent],
      changed: true,
      needsSummary: true,
      oldRounds,
      head,
      recent,
      tokensBefore,
      tokensAfterMicro
    }
  }

  // 超预算但轮次不超 keepRounds：只做微压缩（无可摘要的旧轮次）
  return {
    messages: clippedAny ? [...head, ...flat] : messages,
    changed: clippedAny,
    needsSummary: false,
    oldRounds: [],
    head,
    recent: flat,
    tokensBefore,
    tokensAfterMicro
  }
}

/** 摘要消息前缀（用于把 LLM 摘要插回历史时明确标注其性质）。 */
export const HISTORY_SUMMARY_PREFIX = '【上下文压缩摘要】以下为被压缩的早期工具交互摘要，供你继续任务时参考：'

/** 摘要生成用的系统提示词（独立导出便于测试与集中维护）。
 *  领域保留项：模组项目的关键事实（加载器/版本/注册 ID/构建失败原因）
 *  一旦被摘要噪声化，续跑就会做错方向的修复——这里显式要求保留。 */
export const HISTORY_SUMMARY_PROMPT =
  '你是工具调用历史压缩器。请把下面这段「早期工具交互历史」压缩为要点摘要，' +
  '只保留对继续当前任务有用的信息：已读取/确认过的关键文件与结论、已经做出的写入或决定、' +
  '尚未完成的待办与已知问题。删除过程性噪声（重复检索、参数回显、无结论的日志）。\n' +
  '以下领域事实若在历史中出现，必须原样保留（它们决定修复方向，不可被压缩掉）：\n' +
  '- 目标加载器与 Minecraft 版本（如 NeoForge 1.21、Fabric 1.20.1）\n' +
  '- 已注册/已确认使用的内容 ID 与命名空间\n' +
  '- 最近一次构建/游戏测试失败的原因与报错要点\n' +
  '- 用户明确纠正过的偏好或约束\n' +
  '输出纯文本要点（可使用短横线列表），不要复述原文，不超过 400 字。'

/** 用摘要重建消息数组：头部 + 摘要消息 + 最近轮次。 */
export function composeCompacted(
  head: ChatMessage[],
  summary: string,
  recent: ChatMessage[]
): ChatMessage[] {
  return [...head, { role: 'user', content: `${HISTORY_SUMMARY_PREFIX}\n${summary}` }, ...recent]
}
