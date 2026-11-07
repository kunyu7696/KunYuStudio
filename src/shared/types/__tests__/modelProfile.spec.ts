/**
 * 模型档案单一数据源守门：
 * - 目录快照必须可追溯（来源 URL + 抓取时间），价格非负，id 唯一
 * - 精确 id / 短名 + 厂商提示 / 版本后缀 / 免费零价 / 本地 Ollama / 未收录
 * - 成本估算：未识别不编造（null），零价返回 0
 */
import { describe, expect, it } from 'vitest'
import type { AiProviderConfig } from '../../types/ai'
import {
  MODEL_CATALOG,
  estimateCallCostUsd,
  findCatalogEntry,
  resolveModelProfile
} from '../modelProfile'

function provider(patch: Partial<AiProviderConfig> = {}): AiProviderConfig {
  return {
    id: 'p1',
    name: 'p1',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    apiKeyUrl: '',
    model: 'gpt-4o-mini',
    maxTokens: 4096,
    temperature: 0.7,
    enabled: true,
    ...patch
  }
}

describe('模型目录快照守门', () => {
  it('有来源与抓取时间，模型非空', () => {
    expect(MODEL_CATALOG.source).toContain('openrouter.ai')
    expect(Number.isNaN(Date.parse(MODEL_CATALOG.fetchedAt))).toBe(false)
    expect(MODEL_CATALOG.models.length).toBeGreaterThan(50)
  })

  it('id 唯一，价格非负且至少有一个非空', () => {
    const ids = new Set<string>()
    for (const m of MODEL_CATALOG.models) {
      expect(ids.has(m.id)).toBe(false)
      ids.add(m.id)
      expect(m.prompt).toBeGreaterThanOrEqual(0)
      expect(m.completion).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(m.prompt) && Number.isFinite(m.completion)).toBe(true)
      expect(m.context).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('findCatalogEntry', () => {
  it('精确 id 命中', () => {
    expect(findCatalogEntry('openai/gpt-4o-mini')?.id).toBe('openai/gpt-4o-mini')
  })

  it('短名 + baseUrl 厂商提示消歧', () => {
    const hit = findCatalogEntry('gpt-4o-mini', 'https://api.openai.com/v1')
    expect(hit?.id).toBe('openai/gpt-4o-mini')
  })

  it('未收录模型不猜价', () => {
    expect(findCatalogEntry('kunyu-private-model-x')).toBeNull()
  })
})

describe('resolveModelProfile', () => {
  it('目录命中 → metered，价格/上下文/能力取自目录', () => {
    const p = resolveModelProfile(provider(), 'gpt-4o-mini')
    expect(p.billing).toBe('metered')
    expect(p.source).toBe('catalog')
    expect(p.pricing).toEqual({ inputPerMTok: 0.15, outputPerMTok: 0.6 })
    expect(p.contextWindow).toBe(128000)
    expect(p.capabilities.vision).toBe(true)
    expect(p.capabilities.tools).toBe(true)
    expect(p.catalogFetchedAt).toBe(MODEL_CATALOG.fetchedAt)
  })

  it('目录内零价模型 → unlimited（不设成本上限）', () => {
    const p = resolveModelProfile(provider({ baseUrl: '' }), 'cohere/north-mini-code:free')
    expect(p.billing).toBe('unlimited')
    expect(p.pricing).toEqual({ inputPerMTok: 0, outputPerMTok: 0 })
  })

  it('Ollama 本地 → unlimited + local，不查目录', () => {
    const p = resolveModelProfile(
      provider({ kind: 'ollama', baseUrl: 'http://localhost:11434', contextWindow: 8192 }),
      'qwen2.5:7b'
    )
    expect(p.billing).toBe('unlimited')
    expect(p.source).toBe('local')
    expect(p.contextWindow).toBe(8192)
    expect(p.pricing).toEqual({ inputPerMTok: 0, outputPerMTok: 0 })
  })

  it('未收录 → unknown + pricing=null，沿用用户标注上下文', () => {
    const p = resolveModelProfile(
      provider({ baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', contextWindow: 32000 }),
      'doubao-private-xyz'
    )
    expect(p.billing).toBe('unknown')
    expect(p.source).toBe('unknown')
    expect(p.pricing).toBeNull()
    expect(p.contextWindow).toBe(32000)
  })
})

describe('estimateCallCostUsd', () => {
  it('unknown 返回 null（拒绝编造）', () => {
    expect(
      estimateCallCostUsd({ billing: 'unknown', pricing: null }, 10_000, 2_000)
    ).toBeNull()
  })

  it('unlimited 返回 0', () => {
    expect(
      estimateCallCostUsd(
        { billing: 'unlimited', pricing: { inputPerMTok: 0, outputPerMTok: 0 } },
        10_000,
        2_000
      )
    ).toBe(0)
  })

  it('metered 按百万 token 单价计算', () => {
    // 10k 输入 × $3/M + 2k 输出 × $15/M = 0.03 + 0.03
    const cost = estimateCallCostUsd(
      { billing: 'metered', pricing: { inputPerMTok: 3, outputPerMTok: 15 } },
      10_000,
      2_000
    )
    expect(cost).toBeCloseTo(0.06, 6)
  })
})
