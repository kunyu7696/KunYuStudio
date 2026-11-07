/**
 * 预算推导：价格真正影响预算，而不是五档硬编码常量。
 * - 便宜模型：成本不成为约束，按档位深度封顶
 * - 贵模型：调用次数被成本上限压到最小闭环，并给出明确说明
 * - 零价/本地：unlimited，不设成本上限
 * - 未收录：回退固定上限，标注 unknown（不猜价）
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_RUN_COST_USD,
  FALLBACK_TIER_RUN_BUDGETS,
  MIN_MODEL_CALLS,
  TIER_COST_SHARES,
  resolveRunBudget,
  tierCallCeiling
} from '../runBudget'
import type { ModelProfile } from '../../types/modelProfile'
import { TIER_CONFIGS, type TierId } from '../../types/tiers'

function profile(inputPerMTok: number, outputPerMTok: number): ModelProfile {
  const free = inputPerMTok === 0 && outputPerMTok === 0
  return {
    key: `p:${inputPerMTok}/${outputPerMTok}`,
    providerId: 'p',
    model: 'm',
    displayName: '测试模型',
    contextWindow: 128000,
    maxOutputTokens: 8192,
    pricing: { inputPerMTok, outputPerMTok },
    billing: free ? 'unlimited' : 'metered',
    capabilities: { vision: false, tools: true },
    source: 'catalog',
    catalogFetchedAt: '2026-11-07T00:00:00.000Z'
  }
}

const CHEAP = profile(0.15, 0.6)
const EXPENSIVE = profile(75, 150)

describe('resolveRunBudget：价格联动', () => {
  it('便宜的计费模型按档位深度封顶（成本不成为约束）', () => {
    const b = resolveRunBudget('sprinter', CHEAP, { maxRunCostUsd: DEFAULT_MAX_RUN_COST_USD })
    expect(b.source).toBe('pricing')
    expect(b.maxModelCalls).toBe(tierCallCeiling('sprinter'))
    expect(b.maxCostUsd).toBeCloseTo(DEFAULT_MAX_RUN_COST_USD * TIER_COST_SHARES.sprinter, 6)
    expect(b.estimatedCostPerCallUsd).toBeGreaterThan(0)
  })

  it('贵模型调用次数被成本上限压到最小闭环，并说明原因', () => {
    const b = resolveRunBudget('sprinter', EXPENSIVE, { maxRunCostUsd: DEFAULT_MAX_RUN_COST_USD })
    expect(b.maxModelCalls).toBe(MIN_MODEL_CALLS)
    expect(b.notes.join('\n')).toContain('最小闭环')
  })

  it('同一档位下贵模型预算严格小于便宜模型（旧硬编码做不到）', () => {
    for (const tier of Object.keys(TIER_CONFIGS) as TierId[]) {
      const cheap = resolveRunBudget(tier, CHEAP, { maxRunCostUsd: DEFAULT_MAX_RUN_COST_USD })
      const expensive = resolveRunBudget(tier, EXPENSIVE, { maxRunCostUsd: DEFAULT_MAX_RUN_COST_USD })
      expect(expensive.maxModelCalls).toBeLessThan(cheap.maxModelCalls)
      expect(expensive.estimatedCostPerCallUsd!).toBeGreaterThan(cheap.estimatedCostPerCallUsd!)
    }
  })

  it('零价/本地模型：unlimited，不设成本上限', () => {
    const b = resolveRunBudget('master', profile(0, 0), { maxRunCostUsd: 1 })
    expect(b.source).toBe('unlimited')
    expect(b.maxCostUsd).toBeNull()
    expect(b.estimatedCostPerCallUsd).toBe(0)
    expect(b.maxModelCalls).toBe(tierCallCeiling('master'))
  })

  it('成本上限设为 0 = 不限，但仍受档位深度封顶', () => {
    const b = resolveRunBudget('artisan', EXPENSIVE, { maxRunCostUsd: 0 })
    expect(b.maxCostUsd).toBeNull()
    expect(b.maxModelCalls).toBe(tierCallCeiling('artisan'))
    expect(b.notes.join('\n')).toContain('不限')
  })

  it('未收录模型：回退固定上限并标注 unknown', () => {
    const b = resolveRunBudget('bridge', null, { maxRunCostUsd: 1 })
    expect(b.source).toBe('unknown')
    expect(b.maxModelCalls).toBe(FALLBACK_TIER_RUN_BUDGETS.bridge.maxModelCalls)
    expect(b.estimatedCostPerCallUsd).toBeNull()
    expect(b.maxCostUsd).toBeNull()
    expect(b.notes.join('\n')).toContain('价格目录')
  })

  it('Gradle 构建上限由档位修复轮次推导', () => {
    for (const tier of Object.keys(TIER_CONFIGS) as TierId[]) {
      const b = resolveRunBudget(tier, CHEAP, { maxRunCostUsd: 1 })
      expect(b.maxGradleBuilds).toBe(TIER_CONFIGS[tier].maxBuildRounds + 4)
    }
  })
})
