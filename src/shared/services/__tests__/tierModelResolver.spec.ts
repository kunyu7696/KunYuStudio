/**
 * TR-8.1：档位模型可选覆盖解析。
 * - 大师档覆盖：解析出指定 provider/model
 * - 匠造档跟随：解析出默认 provider 与其 model
 * - 无提供商 / 覆盖提供商不存在时抛错
 */
import { describe, expect, it } from 'vitest'
import { resolveTierModel, type ModelResolverAi } from '../tierModelResolver'
import type { AiProviderConfig } from '../../types/ai'
import type { TierModelOverride } from '../../types/settings'

function provider(id: string, model: string): AiProviderConfig {
  return {
    id,
    name: id,
    kind: 'openai-compatible',
    baseUrl: '',
    apiKey: '',
    apiKeyUrl: '',
    model,
    maxTokens: 4096,
    temperature: 0.7,
    enabled: true
  }
}

function overrides(entries: Partial<Record<string, TierModelOverride>>): ModelResolverAi['tierModels'] {
  const base = {
    sprinter: { providerId: null, model: null },
    artisan: { providerId: null, model: null },
    master: { providerId: null, model: null },
    bridge: { providerId: null, model: null },
    weaver: { providerId: null, model: null }
  } as ModelResolverAi['tierModels']
  for (const [k, v] of Object.entries(entries)) {
    ;(base as Record<string, TierModelOverride>)[k] = v as TierModelOverride
  }
  return base
}

describe('resolveTierModel', () => {
  const ai: ModelResolverAi = {
    providers: [provider('p1', 'model-a'), provider('p2', 'model-b')],
    defaultProviderId: 'p1',
    tierModels: overrides({
      master: { providerId: 'p2', model: 'big-model' },
      sprinter: { providerId: null, model: 'fast-model' }
    })
  }

  it('大师档完整覆盖：指定 provider + model', () => {
    const r = resolveTierModel('master', ai)
    expect(r.providerId).toBe('p2')
    expect(r.model).toBe('big-model')
    expect(r.overridden).toBe(true)
  })

  it('匠造档无覆盖：跟随默认 provider 与其 model', () => {
    const r = resolveTierModel('artisan', ai)
    expect(r.providerId).toBe('p1')
    expect(r.model).toBe('model-a')
    expect(r.overridden).toBe(false)
  })

  it('只覆盖 model：provider 跟随默认，model 用覆盖值', () => {
    const r = resolveTierModel('sprinter', ai)
    expect(r.providerId).toBe('p1')
    expect(r.model).toBe('fast-model')
  })

  it('只覆盖 provider：model 跟随该提供商自身配置', () => {
    const local: ModelResolverAi = {
      ...ai,
      tierModels: overrides({ bridge: { providerId: 'p2', model: null } })
    }
    const r = resolveTierModel('bridge', local)
    expect(r.providerId).toBe('p2')
    expect(r.model).toBe('model-b')
  })

  it('无默认提供商时回退到第一个已配置提供商', () => {
    const local: ModelResolverAi = { ...ai, defaultProviderId: null }
    const r = resolveTierModel('artisan', local)
    expect(r.providerId).toBe('p1')
    expect(r.model).toBe('model-a')
  })

  it('没有任何提供商时抛可识别错误', () => {
    const local: ModelResolverAi = {
      providers: [],
      defaultProviderId: null,
      tierModels: overrides({})
    }
    expect(() => resolveTierModel('master', local)).toThrow(/尚未配置/)
  })
})
