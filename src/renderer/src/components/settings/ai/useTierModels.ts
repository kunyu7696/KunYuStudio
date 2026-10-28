import { useSettingsStore } from '../../../stores/settings'
import type { TierModelOverride } from '../../../../../shared/types/settings'
import type { TierId } from '../../../../../shared/types/tiers'

// ---------- 档位模型可选覆盖 ----------
export function useTierModels() {
  const settings = useSettingsStore()

  async function patchTierModel(tier: TierId, next: Partial<TierModelOverride>): Promise<void> {
    const current = settings.ai.tierModels[tier] ?? { providerId: null, model: null }
    const tierModels: Record<TierId, TierModelOverride> = {
      ...settings.ai.tierModels,
      [tier]: { ...current, ...next }
    }
    await settings.patchSection('ai', { tierModels })
  }

  function onTierProviderChange(tier: TierId, providerId: string | null): void {
    void patchTierModel(tier, { providerId })
  }

  function onTierModelChange(tier: TierId, model: string | null): void {
    void patchTierModel(tier, { model })
  }

  return {
    onTierProviderChange,
    onTierModelChange
  }
}
