import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSettingsStore } from '../../../stores/settings'
import { t } from '../../../i18n'
import type { CustomMcpRuntime } from '../../../../../shared/types/monitor'
import type { CustomMcpServer, McpCategory, McpPermission } from '../../../../../shared/types/settings'
import type { McpServerDraft } from './types'

/* ============================================================
   A3：开发者自定义 MCP server 管理（stdio）
   ============================================================ */
export function useCustomMcp() {
  const settings = useSettingsStore()

  const customMcpServers = computed(() => settings.ai.customMcpServers)
  const mcpDraftVisible = ref(false)
  const mcpDraft = ref<McpServerDraft | null>(null)
  const mcpTestState = ref<Record<string, { ok?: boolean; loading: boolean; tools?: number; error?: string }>>({})

  function newMcpId(): string {
    return `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  /* ---------- MCP 推荐市场 ---------- */

  function mcpCategoryLabel(c: McpCategory): string {
    return c === 'texture'
      ? t('settings.ai.customMcp.catTexture')
      : c === 'code'
        ? t('settings.ai.customMcp.catCode')
        : c === 'game-control'
          ? t('settings.ai.customMcp.catGameControl')
          : t('settings.ai.customMcp.catGeneral')
  }

  function mcpCategoryTagType(c: McpCategory): 'primary' | 'success' | 'warning' | 'info' {
    return c === 'texture' ? 'success' : c === 'code' ? 'primary' : c === 'game-control' ? 'warning' : 'info'
  }

  function mcpPermissionLabel(p: McpPermission): string {
    return p === 'read'
      ? t('settings.ai.customMcp.permRead')
      : p === 'interact'
        ? t('settings.ai.customMcp.permInteract')
        : t('settings.ai.customMcp.permAdmin')
  }

  function mcpPermissionTagType(p: McpPermission): 'info' | 'warning' | 'danger' {
    return p === 'read' ? 'info' : p === 'interact' ? 'warning' : 'danger'
  }

  function mcpPresetDescription(preset: Omit<CustomMcpServer, 'id'>): string {
    if (preset.category === 'texture') {
      return t('settings.ai.customMcp.presetDescTexture')
    }
    if (preset.category === 'code') {
      return t('settings.ai.customMcp.presetDescCode')
    }
    return t('settings.ai.customMcp.presetDescGeneral')
  }

  function isPresetImported(preset: Omit<CustomMcpServer, 'id'>): boolean {
    // 按 name + args 主干匹配（避免重复导入）
    const sig = `${preset.command} ${preset.args.join(' ')}`
    return customMcpServers.value.some((s) => `${s.command} ${s.args.join(' ')}` === sig)
  }

  async function importPreset(preset: Omit<CustomMcpServer, 'id'>): Promise<void> {
    const server: CustomMcpServer = {
      id: newMcpId(),
      name: preset.name,
      transport: preset.transport,
      command: preset.command,
      args: [...preset.args],
      env: { ...preset.env },
      enabled: preset.enabled,
      timeoutMs: preset.timeoutMs,
      category: preset.category,
      permission: preset.permission,
      toolFilter: { mode: preset.toolFilter.mode, tools: [...preset.toolFilter.tools] }
    }
    const list = [...customMcpServers.value, server]
    await settings.update({ ai: { customMcpServers: list } })
    ElMessage.success(t('settings.ai.customMcp.importedMsg', { name: preset.name }))
  }

  function parseArgs(line: string): string[] {
    // 简单分词：空格分隔，支持双引号包裹带空格的参数
    const result: string[] = []
    let cur = ''
    let inQ = false
    for (const ch of line) {
      if (ch === '"') {
        inQ = !inQ
      } else if (ch === ' ' && !inQ) {
        if (cur) {
          result.push(cur)
          cur = ''
        }
      } else {
        cur += ch
      }
    }
    if (cur) result.push(cur)
    return result
  }

  function parseEnv(line: string): Record<string, string> {
    const env: Record<string, string> = {}
    for (const pair of line.split(',')) {
      const trimmed = pair.trim()
      if (!trimmed) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const k = trimmed.slice(0, eq).trim()
      const v = trimmed.slice(eq + 1).trim()
      if (k) env[k] = v
    }
    return env
  }

  function formatEnv(env: Record<string, string>): string {
    return Object.entries(env).map(([k, v]) => `${k}=${v}`).join(', ')
  }

  function openMcpAdd(): void {
    mcpDraft.value = {
      id: newMcpId(),
      name: '',
      command: 'npx',
      argsLine: '-y @modelcontextprotocol/server-filesystem C:\\',
      envLine: '',
      enabled: true,
      timeoutMs: 15_000
    }
    mcpDraftVisible.value = true
  }

  function openMcpEdit(server: CustomMcpServer): void {
    mcpDraft.value = {
      id: server.id,
      name: server.name,
      command: server.command,
      argsLine: server.args.join(' '),
      envLine: formatEnv(server.env),
      enabled: server.enabled,
      timeoutMs: server.timeoutMs
    }
    mcpDraftVisible.value = true
  }

  function closeMcpDraft(): void {
    mcpDraftVisible.value = false
    mcpDraft.value = null
  }

  async function saveMcpDraft(): Promise<void> {
    const d = mcpDraft.value
    if (!d) return
    const name = d.name.trim()
    const command = d.command.trim()
    if (!name) {
      ElMessage.error(t('settings.ai.errNameRequired'))
      return
    }
    if (!command) {
      ElMessage.error(t('settings.ai.customMcp.errCommandRequired'))
      return
    }
    const server: CustomMcpServer = {
      id: d.id,
      name,
      transport: 'stdio',
      command,
      args: parseArgs(d.argsLine),
      env: parseEnv(d.envLine),
      enabled: d.enabled,
      timeoutMs: Math.min(60_000, Math.max(5_000, d.timeoutMs || 30_000)),
      // 手动新增/编辑不暴露 category/permission/toolFilter 字段；编辑时保留原值，新增时默认
      category: (() => {
        const existing = customMcpServers.value.find((s) => s.id === d.id)
        return existing?.category ?? 'general'
      })(),
      permission: (() => {
        const existing = customMcpServers.value.find((s) => s.id === d.id)
        return existing?.permission ?? 'read'
      })(),
      toolFilter: (() => {
        const existing = customMcpServers.value.find((s) => s.id === d.id)
        return existing?.toolFilter ?? { mode: 'all', tools: [] }
      })()
    }
    const list = [...customMcpServers.value]
    const idx = list.findIndex((s) => s.id === server.id)
    if (idx >= 0) list[idx] = server
    else list.push(server)
    await settings.update({ ai: { customMcpServers: list } })
    closeMcpDraft()
    ElMessage.success(t('settings.ai.customMcp.saved'))
  }

  async function toggleMcpEnabled(server: CustomMcpServer, enabled: boolean): Promise<void> {
    const list = customMcpServers.value.map((s) => (s.id === server.id ? { ...s, enabled } : s))
    await settings.update({ ai: { customMcpServers: list } })
  }

  async function deleteMcp(server: CustomMcpServer): Promise<void> {
    try {
      await ElMessageBox.confirm(
        t('settings.ai.customMcp.deleteConfirm', { name: server.name }),
        t('settings.ai.customMcp.deleteTitle'),
        { type: 'warning', confirmButtonText: t('settings.ai.delete'), cancelButtonText: t('common.cancel') }
      )
    } catch {
      return
    }
    const list = customMcpServers.value.filter((s) => s.id !== server.id)
    await settings.update({ ai: { customMcpServers: list } })
    ElMessage.success(t('settings.ai.customMcp.deleted'))
  }

  async function testMcp(server: CustomMcpServer): Promise<void> {
    mcpTestState.value[server.id] = { loading: true }
    try {
      const res = await window.api.mcp.testServer(JSON.parse(JSON.stringify(server)))
      if (res.ok) {
        mcpTestState.value[server.id] = { ok: true, loading: false, tools: res.tools.length }
        ElMessage.success(t('settings.ai.customMcp.testOkMsg', { n: res.tools.length }))
      } else {
        mcpTestState.value[server.id] = { ok: false, loading: false, error: res.error }
        ElMessage.error(res.error || t('settings.ai.customMcp.testFailMsg'))
      }
    } catch (err) {
      mcpTestState.value[server.id] = { ok: false, loading: false, error: (err as Error).message }
      ElMessage.error((err as Error).message)
    }
  }

  /* ---------- 自定义 MCP 持久连接状态 ---------- */

  const customMcpRuntime = ref<CustomMcpRuntime[]>([])

  async function refreshCustomMcpStatus(): Promise<void> {
    try {
      customMcpRuntime.value = await window.api.mcp.listCustomTools()
    } catch {
      /* ignore */
    }
  }

  async function syncCustomMcpServers(): Promise<void> {
    try {
      await window.api.mcp.syncCustom(JSON.parse(JSON.stringify(customMcpServers.value)))
      await refreshCustomMcpStatus()
    } catch {
      /* ignore */
    }
  }

  /** 查某个 server 的运行时状态 */
  function getCustomRuntime(id: string): CustomMcpRuntime | undefined {
    return customMcpRuntime.value.find((r) => r.id === id)
  }

  /** 状态指示灯 class（复用样式表已有的 is-* 类：is-ok/is-fail/is-busy/is-idle） */
  function customRuntimeDotClass(id: string): Record<string, boolean> {
    const rt = getCustomRuntime(id)
    if (!rt) return { 'ext-dot': true, 'is-idle': true }
    return {
      'ext-dot': true,
      'is-ok': rt.status === 'ready',
      'is-busy': rt.status === 'connecting',
      'is-fail': rt.status === 'error',
      'is-idle': rt.status === 'disconnected'
    }
  }

  function customRuntimeStatusLabel(id: string): string {
    const rt = getCustomRuntime(id)
    if (!rt) return t('settings.ai.customMcp.rtDisconnected')
    switch (rt.status) {
      case 'ready':
        return t('settings.ai.customMcp.rtReady', { n: rt.tools.length })
      case 'connecting':
        return t('settings.ai.customMcp.rtConnecting')
      case 'error':
        return rt.error
          ? t('settings.ai.customMcp.rtError', { msg: rt.error.slice(0, 30) })
          : t('settings.ai.customMcp.rtErrorShort')
      default:
        return t('settings.ai.customMcp.rtDisconnected')
    }
  }

  // servers 列表变化时同步到主进程（增删连接）
  watch(
    customMcpServers,
    () => {
      void syncCustomMcpServers()
    },
    { deep: true }
  )

  return {
    customMcpServers,
    mcpDraftVisible,
    mcpDraft,
    mcpTestState,
    mcpCategoryLabel,
    mcpCategoryTagType,
    mcpPermissionLabel,
    mcpPermissionTagType,
    mcpPresetDescription,
    isPresetImported,
    importPreset,
    openMcpAdd,
    openMcpEdit,
    closeMcpDraft,
    saveMcpDraft,
    toggleMcpEnabled,
    deleteMcp,
    testMcp,
    refreshCustomMcpStatus,
    syncCustomMcpServers,
    customRuntimeDotClass,
    customRuntimeStatusLabel
  }
}
