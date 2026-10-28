import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useSettingsStore } from '../../../stores/settings'
import { useAiMonitorStore } from '../../../stores/aiMonitor'
import { t } from '../../../i18n'
import type { McpStatusKind } from '../../../../../shared/types/monitor'

// ---------- M7：mcdev-mcp ----------
/** 状态文案按当前语言即时求值（computed 内调用 t 随语言切换重算） */
function mcpKindText(kind: McpStatusKind): string {
  switch (kind) {
    case 'disabled':
      return t('settings.ai.mcp.kindDisabled')
    case 'node-missing':
      return t('settings.ai.mcp.kindNodeMissing')
    case 'package-unavailable':
      return t('settings.ai.mcp.kindPackageUnavailable')
    case 'not-initialized':
      return t('settings.ai.mcp.kindNotInitialized')
    case 'initializing':
      return t('settings.ai.mcp.kindInitializing')
    case 'connecting':
      return t('settings.ai.mcp.kindConnecting')
    case 'ready':
      return t('settings.ai.mcp.kindReady')
    case 'error':
      return t('settings.ai.mcp.kindError')
  }
}

export function useMcpMonitor() {
  const settings = useSettingsStore()
  const monitor = useAiMonitorStore()

  const mcpKindLabel = computed(() =>
    monitor.mcp ? mcpKindText(monitor.mcp.kind) : t('settings.ai.mcp.kindUnknown')
  )
  const mcpBusy = computed(
    () => monitor.mcp?.kind === 'connecting' || monitor.mcp?.kind === 'initializing'
  )
  const mcpDotClass = computed(() => {
    switch (monitor.mcp?.kind) {
      case 'ready':
        return 'is-ok'
      case 'connecting':
      case 'initializing':
      case 'not-initialized':
        return 'is-busy'
      case 'disabled':
        return 'is-idle'
      default:
        return 'is-fail'
    }
  })

  async function toggleMcp(enabled: boolean): Promise<void> {
    try {
      await monitor.setMcpEnabled(enabled)
      ElMessage.success(enabled ? t('settings.ai.mcp.enabledMsg') : t('settings.ai.mcp.disabledMsg'))
    } catch (e) {
      ElMessage.error(t('settings.ai.mcp.toggleFail', { msg: e instanceof Error ? e.message : String(e) }))
    }
  }

  async function refreshMcp(): Promise<void> {
    await monitor.refreshMcp()
  }

  /** 一键重试：已启用则重启初始化/连接流水线，未启用则直接开启 */
  async function retryMcpInit(): Promise<void> {
    if (settings.ai.mcpEnabled) await monitor.refreshMcp()
    else await monitor.setMcpEnabled(true)
  }

  async function copyInit(): Promise<void> {
    const cmd = monitor.mcp?.initCommand
    if (!cmd) return
    try {
      await navigator.clipboard.writeText(cmd)
      ElMessage.success(t('settings.ai.mcp.copied'))
    } catch {
      ElMessage.warning(t('settings.ai.mcp.copyFail'))
    }
  }

  return {
    mcpKindLabel,
    mcpBusy,
    mcpDotClass,
    toggleMcp,
    refreshMcp,
    retryMcpInit,
    copyInit
  }
}
