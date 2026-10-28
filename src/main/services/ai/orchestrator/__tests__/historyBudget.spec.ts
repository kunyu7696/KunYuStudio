/**
 * P2 分层压缩测试：token 估算 + 预算感知的历史压缩。
 *
 * 修复前（clipToolHistory）：只按「保留最近 3 轮 + 单条 tool 结果截断」硬裁，
 * 被裁掉的旧轮次信息直接丢失，且对小历史无谓地丢上下文。
 *
 * 修复后：预算内保留完整历史；超预算先微压缩（截断超长 tool 结果），
 * 仍超预算且存在超出 keepRounds 的旧轮次 → 交由上层用 LLM 摘要（信息不丢）。
 */
import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../../../shared/types/ai'
import {
  composeCompacted,
  estimateMessagesTokens,
  estimateTokens,
  HISTORY_SUMMARY_PREFIX,
  planHistoryCompaction
} from '../historyBudget'

function sys(): ChatMessage {
  return { role: 'system', content: 'system' }
}
function user(c: string): ChatMessage {
  return { role: 'user', content: c }
}
function assistant(c: string, toolCalls?: Array<{ id: string }>): ChatMessage {
  return {
    role: 'assistant',
    content: c,
    toolCalls: toolCalls?.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: 'tool', arguments: '{}' }
    }))
  }
}
function tool(callId: string, c: string): ChatMessage {
  return { role: 'tool', toolCallId: callId, content: c }
}

/** 构造 N 轮历史：system + user 初始 + N × (assistant + 2 tool) */
function buildNRounds(n: number): ChatMessage[] {
  const msgs: ChatMessage[] = [sys(), user('目标')]
  for (let i = 0; i < n; i++) {
    msgs.push(assistant(`round-${i}`, [{ id: `c${i}a` }, { id: `c${i}b` }]))
    msgs.push(tool(`c${i}a`, `result-${i}a`))
    msgs.push(tool(`c${i}b`, `result-${i}b`))
  }
  return msgs
}

describe('estimateTokens：粗略 token 估算', () => {
  it('ASCII/代码按 1 token/4 字符', () => {
    expect(estimateTokens('abcdefgh')).toBe(2)
    expect(estimateTokens('abc')).toBe(1)
  })

  it('CJK 按 1 token/字', () => {
    expect(estimateTokens('方块')).toBe(2)
    expect(estimateTokens('生成一个方块')).toBe(6)
  })

  it('空串为 0', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('估算消息总量：含逐条结构开销与 toolCalls 参数', () => {
    const msgs = [sys(), user('目标')]
    // 每条消息 +6 结构开销；内容各按上面规则估算
    expect(estimateMessagesTokens(msgs)).toBe(6 + estimateTokens('system') + 6 + estimateTokens('目标'))
    const withCall = estimateMessagesTokens([assistant('x', [{ id: 'c1' }])])
    expect(withCall).toBeGreaterThan(6 + estimateTokens('x'))
  })
})

describe('planHistoryCompaction：预算内外的分层决策', () => {
  it('消息 ≤ 2 条 → 原样返回（无法压缩）', () => {
    const msgs = [sys(), user('目标')]
    const plan = planHistoryCompaction(msgs, { budgetTokens: 1, keepRounds: 3 })
    expect(plan.changed).toBe(false)
    expect(plan.needsSummary).toBe(false)
    expect(plan.messages).toBe(msgs)
  })

  it('预算内 → 保留完整历史（不再无脑只留 N 轮）', () => {
    const msgs = buildNRounds(6)
    const plan = planHistoryCompaction(msgs, { budgetTokens: 1_000_000, keepRounds: 3 })
    expect(plan.changed).toBe(false)
    expect(plan.needsSummary).toBe(false)
    expect(plan.messages).toBe(msgs)
    expect(plan.messages).toHaveLength(msgs.length)
  })

  it('超预算且轮次 > keepRounds → 需要摘要旧轮次，保留 head + 最近 keepRounds 轮', () => {
    const msgs = buildNRounds(5)
    const plan = planHistoryCompaction(msgs, { budgetTokens: 10, keepRounds: 2, maxToolChars: 8000 })
    expect(plan.needsSummary).toBe(true)
    expect(plan.oldRounds.length).toBeGreaterThan(0)
    // system + user + 2 轮 × 3 条 = 8
    expect(plan.messages).toHaveLength(8)
    expect(plan.messages[0]).toBe(msgs[0])
    expect(plan.messages[1]).toBe(msgs[1])
    // 最近 2 轮是 round-3 与 round-4
    expect(plan.messages[2]).toEqual(msgs[msgs.length - 6])
  })

  it('压缩后无孤立 tool 消息（assistant + tool 成对）', () => {
    const msgs = buildNRounds(5)
    const plan = planHistoryCompaction(msgs, { budgetTokens: 10, keepRounds: 2, maxToolChars: 8000 })
    const rebuilt = composeCompacted(plan.head, '摘要文本', plan.recent)
    for (let i = 0; i < rebuilt.length; i++) {
      if (rebuilt[i].role === 'tool') {
        const callId = rebuilt[i].toolCallId!
        let found = false
        for (let j = i - 1; j >= 0; j--) {
          if (rebuilt[j].role === 'assistant') {
            found = rebuilt[j].toolCalls?.some((tc) => tc.id === callId) ?? false
            break
          }
        }
        expect(found).toBe(true)
      }
    }
  })

  it('超预算但轮次 ≤ keepRounds → 仅微压缩，无摘要；无内容变化则 changed=false', () => {
    const msgs = buildNRounds(2)
    const plan = planHistoryCompaction(msgs, { budgetTokens: 10, keepRounds: 5, maxToolChars: 8000 })
    expect(plan.needsSummary).toBe(false)
    // tool 内容都很短，未触发截断 → 无变化
    expect(plan.changed).toBe(false)
    expect(plan.messages).toBe(msgs)
  })

  it('微压缩：超长 tool 结果被截断并追加原始长度提示（changed=true）', () => {
    const big = 'y'.repeat(20000)
    const msgs: ChatMessage[] = [sys(), user('目标'), assistant('r0', [{ id: 'c0' }]), tool('c0', big)]
    const plan = planHistoryCompaction(msgs, { budgetTokens: 10, keepRounds: 5, maxToolChars: 1000 })
    expect(plan.needsSummary).toBe(false)
    expect(plan.changed).toBe(true)
    const t = plan.messages.find((m) => m.role === 'tool')!
    expect(t.content.length).toBeLessThan(20000)
    expect(t.content.startsWith('y'.repeat(1000))).toBe(true)
    expect(t.content).toContain('原始 20000 字符')
  })

  it('微压缩只裁 tool 消息，assistant 超长内容不受影响', () => {
    const bigAssistant = 'z'.repeat(50000)
    const msgs: ChatMessage[] = [sys(), user('目标'), assistant(bigAssistant, [{ id: 'c0' }]), tool('c0', 'r')]
    const plan = planHistoryCompaction(msgs, { budgetTokens: 10, keepRounds: 5, maxToolChars: 1000 })
    const a = plan.messages.find((m) => m.role === 'assistant')!
    expect(a.content).toBe(bigAssistant)
  })
})

describe('composeCompacted：摘要消息插入位置', () => {
  it('摘要作为 user 消息插在 head 之后、recent 之前', () => {
    const head = [sys(), user('目标')]
    const recent = [assistant('r1', [{ id: 'c1' }]), tool('c1', 'r1')]
    const rebuilt = composeCompacted(head, '要点一\n要点二', recent)
    expect(rebuilt).toHaveLength(5)
    expect(rebuilt[0]).toBe(head[0])
    expect(rebuilt[1]).toBe(head[1])
    expect(rebuilt[2].role).toBe('user')
    expect(rebuilt[2].content.startsWith(HISTORY_SUMMARY_PREFIX)).toBe(true)
    expect(rebuilt[2].content).toContain('要点一')
    expect(rebuilt[3]).toBe(recent[0])
    expect(rebuilt[4]).toBe(recent[1])
  })
})
