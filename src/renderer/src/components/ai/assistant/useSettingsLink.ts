import { computed } from 'vue'
import { useSettingsStore } from '../../../stores/settings'
import { useUiStore } from '../../../stores/ui'

export function useSettingsLink() {
  const settings = useSettingsStore()
  const ui = useUiStore()

  const enabledProviders = computed(() => settings.ai.providers.filter((p) => p.enabled))
  const hasProvider = computed(
    () => enabledProviders.value.length > 0 && Boolean(settings.ai.defaultProviderId)
  )
  const currentProviderName = computed(() => {
    const id = settings.ai.defaultProviderId
    const p = id ? settings.ai.providers.find((x) => x.id === id) : undefined
    return p ? p.name : ''
  })

  async function onProviderChange(v: string | number | boolean | undefined): Promise<void> {
    if (typeof v === 'string' && v) {
      await settings.patchSection('ai', { defaultProviderId: v })
    }
  }

  function openAiSettings(): void {
    ui.setSettingsCategory('ai')
    ui.setActiveModule('settings', { rememberForSettings: true })
  }

  return {
    settings,
    enabledProviders,
    hasProvider,
    currentProviderName,
    onProviderChange,
    openAiSettings
  }
}
