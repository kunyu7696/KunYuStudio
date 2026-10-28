/**
 * 档位模型解析（纯函数）：按最终档位 + 可选覆盖，解析出实际使用的 provider/model。
 *
 * 规则：
 * - 覆盖的 providerId 优先，否则用默认提供商（无默认则取第一个已配置提供商）；
 * - 覆盖的 model 优先，否则用该提供商自身配置的 model；
 * - 没有任何已配置提供商时抛可识别错误。
 */
import type { AiSettings, TierModelOverride } from '../types/settings'
import type { TierId } from '../types/tiers'

export interface ResolvedTierModel {
  providerId: string
  model: string
  /** 是否命中了覆盖配置（UI/日志用） */
  overridden: boolean
}

export type ModelResolverAi = Pick<AiSettings, 'providers' | 'defaultProviderId' | 'tierModels'>

export function resolveTierModel(tier: TierId, ai: ModelResolverAi): ResolvedTierModel {
  const override: TierModelOverride = ai.tierModels[tier] ?? { providerId: null, model: null }

  const providerId =
    override.providerId ??
    ai.defaultProviderId ??
    ai.providers.find((p) => !!p.id)?.id ??
    null

  if (!providerId) {
    throw new Error('尚未配置 AI 提供商，请在「AI 设置」中添加并选择一个提供商')
  }

  const provider = ai.providers.find((p) => p.id === providerId)
  if (!provider) {
    throw new Error(`AI 提供商 ${providerId} 不存在，请重新选择`)
  }

  return {
    providerId,
    model: override.model || provider.model,
    overridden: override.providerId !== null || override.model !== null
  }
}
