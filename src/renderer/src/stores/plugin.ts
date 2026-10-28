import { defineStore } from 'pinia'
import type { CustomMcpServer } from '../../../shared/types/settings'
import { identifierFromArgs } from '../../../shared/mcpTrust'
import type {
  MarketPlugin,
  McpRuntimeStatus,
  PluginInstallResult
} from '../../../shared/types/plugin'

interface ServerWithRuntime extends CustomMcpServer {
  runtime?: McpRuntimeStatus
}

export const usePluginStore = defineStore('plugin', {
  state: () => ({
    /** 已配置的 MCP server 列表 */
    mcpServers: [] as ServerWithRuntime[],
    /** 插件市场条目（当前页累积） */
    marketEntries: [] as MarketPlugin[],
    /** 市场下一页游标（空串=没有更多） */
    marketNextCursor: '',
    /** 市场数据源 */
    marketSource: 'official' as 'official' | 'bundled',
    /** 市场提示（如回退内置精选原因） */
    marketNotice: '',
    /** 当前搜索词 */
    marketSearch: '',
    /** 市场初始加载 */
    marketLoading: false,
    /** 加载更多中 */
    marketLoadingMore: false,
    /** 正在安装的插件 id 集合 */
    installingIds: new Set<string>(),
    /** 加载状态 */
    loading: false,
    /** 错误信息 */
    error: ''
  }),

  getters: {
    /** 市场是否还有下一页 */
    hasMoreMarket: (s) => s.marketSource === 'official' && Boolean(s.marketNextCursor),

    /** 已安装 server 的命令签名集合（command + args） */
    installedSignatures(s): Set<string> {
      return new Set(s.mcpServers.map((srv) => `${srv.command} ${srv.args.join(' ')}`))
    },

    /** 已安装 server id 集合（按 identifier 粗匹配，用于市场卡片状态） */
    installedIdentifiers(s): Set<string> {
      return new Set(
        s.mcpServers
          .map((srv) => identifierFromArgs(srv.args))
          .filter(Boolean)
      )
    }
  },

  actions: {
    /** 加载 MCP server 列表（含运行时状态） */
    async loadMcpServers(): Promise<void> {
      this.loading = true
      try {
        const result = await window.api.plugin.listMcpServers()
        if (result.ok) {
          this.mcpServers = result.servers
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      } finally {
        this.loading = false
      }
    },

    /** 启用/禁用 MCP server */
    async toggleMcp(id: string, enabled: boolean): Promise<boolean> {
      const result = await window.api.plugin.toggleMcp(id, enabled)
      if (result.ok) {
        // 乐观更新本地状态
        const server = this.mcpServers.find((s) => s.id === id)
        if (server) server.enabled = enabled
        // 延迟刷新运行时状态（等重连完成）
        setTimeout(() => void this.loadMcpServers(), 2000)
        return true
      }
      this.error = result.error ?? '切换失败'
      return false
    },

    /** 测试 MCP server */
    async testMcp(cfg: CustomMcpServer): Promise<{ ok: boolean; toolCount: number; error?: string }> {
      return await window.api.plugin.testMcp(cfg)
    },

    /** 搜索/刷新市场（重置分页） */
    async searchMarket(keyword: string): Promise<void> {
      this.marketSearch = keyword
      this.marketLoading = true
      this.marketNotice = ''
      this.error = ''
      try {
        const result = await window.api.plugin.listMarket(
          keyword.trim() ? { search: keyword.trim() } : {}
        )
        if (result.ok) {
          this.marketEntries = dedupePlugins(result.plugins)
          this.marketNextCursor = result.nextCursor
          this.marketSource = result.source
          this.marketNotice = result.error ?? ''
        } else {
          this.marketEntries = []
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
        this.marketEntries = []
      } finally {
        this.marketLoading = false
      }
    },

    /** 加载下一页（追加） */
    async loadMoreMarket(): Promise<void> {
      if (!this.marketNextCursor || this.marketLoadingMore) return
      this.marketLoadingMore = true
      try {
        const query: { search?: string; cursor: string } = { cursor: this.marketNextCursor }
        if (this.marketSearch.trim()) query.search = this.marketSearch.trim()
        const result = await window.api.plugin.listMarket(query)
        if (result.ok) {
          this.marketEntries = dedupePlugins([...this.marketEntries, ...result.plugins])
          this.marketNextCursor = result.nextCursor
        }
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      } finally {
        this.marketLoadingMore = false
      }
    },

    /** 从市场安装插件（envValues 为用户在弹窗中填写的环境变量） */
    async installFromMarket(
      plugin: MarketPlugin,
      envValues: Record<string, string>
    ): Promise<PluginInstallResult> {
      this.installingIds.add(plugin.id)
      try {
        // Pinia state 中的对象是 reactive Proxy，无法被 IPC 结构化克隆，需先转为普通对象
        const plainPlugin = JSON.parse(JSON.stringify(plugin)) as MarketPlugin
        const plainEnv: Record<string, string> = { ...envValues }
        const result = await window.api.plugin.installMarket({
          plugin: plainPlugin,
          envValues: plainEnv
        })
        if (result.ok) await this.loadMcpServers()
        return result
      } finally {
        this.installingIds.delete(plugin.id)
      }
    },

    /** 判断插件是否已安装（identifier 粗匹配） */
    isInstalled(plugin: MarketPlugin): boolean {
      return this.installedIdentifiers.has(plugin.identifier)
    },

    /** 刷新全部 */
    async refresh(): Promise<void> {
      await Promise.all([this.loadMcpServers(), this.searchMarket(this.marketSearch)])
    }
  }
})

/** 按 id 去重（分页边界可能重复） */
function dedupePlugins(plugins: MarketPlugin[]): MarketPlugin[] {
  const seen = new Set<string>()
  const out: MarketPlugin[] = []
  for (const p of plugins) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    out.push(p)
  }
  return out
}
