import { describe, expect, it } from 'vitest'
import {
  AGENT_CONTEXT_FALLBACK_CAP,
  AGENT_CONTEXT_TOKEN_CAP,
  CHAT_CONTEXT_FALLBACK_CAP,
  CHAT_CONTEXT_TOKEN_CAP,
  CONTEXT_BUDGET_WINDOW_RATIO,
  resolveContextBudget
} from '../ai'

describe('resolveContextBudget：历史预算随模型窗口缩放', () => {
  it('窗口未标注（undefined/0/负数/NaN）时回退固定上限', () => {
    expect(resolveContextBudget(undefined, 48_000)).toBe(48_000)
    expect(resolveContextBudget(0, 64_000)).toBe(64_000)
    expect(resolveContextBudget(-100, 48_000)).toBe(48_000)
    expect(resolveContextBudget(Number.NaN, 48_000)).toBe(48_000)
  })

  it('窗口的一半低于固定上限时按比例收缩', () => {
    // 32k 窗口 × 0.5 = 16k，低于 48k 上限 → 收缩到 16k
    expect(resolveContextBudget(32_768, 48_000)).toBe(Math.floor(32_768 * CONTEXT_BUDGET_WINDOW_RATIO))
    expect(resolveContextBudget(32_768, 48_000)).toBe(16_384)
  })

  it('窗口的一半高于固定上限时绝不超过上限', () => {
    // 128k 窗口 × 0.5 = 64k > 48k → 仍取 48k
    expect(resolveContextBudget(131_072, 48_000)).toBe(48_000)
    expect(resolveContextBudget(1_000_000, 64_000)).toBe(64_000)
  })

  it('非整数结果向下取整', () => {
    // 65535 × 0.5 = 32767.5 → 32767
    expect(resolveContextBudget(65_535, 64_000)).toBe(32_767)
  })

  it('未标注窗口时按独立回退值，而非放宽后的上限', () => {
    expect(resolveContextBudget(undefined, CHAT_CONTEXT_TOKEN_CAP, CHAT_CONTEXT_FALLBACK_CAP)).toBe(48_000)
    expect(resolveContextBudget(0, AGENT_CONTEXT_TOKEN_CAP, AGENT_CONTEXT_FALLBACK_CAP)).toBe(64_000)
  })

  it('大窗口模型（1M）可放宽到聊天 128k / Agent 192k', () => {
    expect(resolveContextBudget(1_000_000, CHAT_CONTEXT_TOKEN_CAP, CHAT_CONTEXT_FALLBACK_CAP)).toBe(128_000)
    expect(resolveContextBudget(1_000_000, AGENT_CONTEXT_TOKEN_CAP, AGENT_CONTEXT_FALLBACK_CAP)).toBe(192_000)
  })

  it('放大上限后，中等窗口模型仍按窗口一半收缩', () => {
    // 128k 窗口 × 0.5 = 64k，低于 128k 上限
    expect(resolveContextBudget(131_072, CHAT_CONTEXT_TOKEN_CAP, CHAT_CONTEXT_FALLBACK_CAP)).toBe(65_536)
  })
})
