import { randomUUID } from 'node:crypto'
import { app, ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import { getSection, setSettings, subscribeSettings } from '../../services/settingsService'
import {
  getCustomMcpManager,
  initCustomMcpManager,
  testCustomMcpServer
} from '../../services/ai/mcpClient'
import { resolveMcpCwd } from '../../services/ai/mcpSandbox'
import { queryMarket, toCustomServerInit } from '../../services/ai/marketService'
import { listRendererPlugins } from '../../services/plugins/rendererPluginService'
import { isCertifiedIdentifier } from '../../../shared/mcpTrust'
import type { IpcContext } from '../context'
import type { CustomMcpServer } from '../../../shared/types/settings'
import type { MarketInstallRequest, MarketPlugin, MarketQuery, McpRuntimeStatus } from '../../../shared/types/plugin'

/** 执行层 runtime 白名单：MCP 插件只允许 npx（npm 包）/ uvx（pypi 包）。
 *  主进程安装 handler 不读 certified、不校验 runtime ⇒
 *  "未认证 + 任意包名 + runtime:'powershell'" 可安装成功并以 powershell 为 command 落库。
 *  TypeScript 编译期类型不防 IPC 运行期注入，必须在执行层硬校验。 */
const ALLOWED_MCP_RUNTIMES = new Set(['npx', 'uvx'])

/** 主进程不信任渲染层传来的 plugin 对象——
 *  1) runtime 必须在白名单（拒绝 powershell/cmd 等任意命令注入）
 *  2) identifier 服务端重新判定 certified（客户端 certified 字段不可信）
 *  3) identifier 须为合法包名（不以 '-' 开头，toCustomServerInit 内也有兜底） */
function assertTrustedPlugin(plugin: MarketPlugin): { certified: boolean } {
  if (!plugin?.identifier || typeof plugin.identifier !== 'string') {
    throw new Error('插件包名非法：缺少 identifier')
  }
  if (/^-/.test(plugin.identifier)) {
    throw new Error('插件包名非法：包名不得以 "-" 开头')
  }
  if (!ALLOWED_MCP_RUNTIMES.has(plugin.runtime)) {
    throw new Error(`不支持的插件运行时：${plugin.runtime}（仅允许 npx / uvx）`)
  }
  // 服务端重新判定认证状态，不采信客户端的 plugin.certified
  return { certified: isCertifiedIdentifier(plugin.identifier) }
}

/** 插件库与商城（M15）：MCP 管理 + 公共插件市场 */
export function registerPluginHandlers(ctx: IpcContext): void {
  // 工具权限「保存即生效」——customMcpServers 变更（含 toolFilter）时
  // 热刷新主进程 MCP 管理器内存配置，无需重启服务。
  // setSettings 的订阅者同步触发，syncFromSettings 内部对已有连接跳过、只处理禁用/新增。
  subscribeSettings((patch, next) => {
    const p = patch as { ai?: { customMcpServers?: unknown } } | null
    if (p && typeof p === 'object' && p.ai && Array.isArray(p.ai.customMcpServers)) {
      void syncWithProjectRoot(next.ai.customMcpServers, ctx)
    }
  })
  // 列出全部自定义 MCP server（含运行时状态）
  ipcMain.handle(IpcChannels.PLUGIN_LIST_MCP_SERVERS, () => {
    const servers = getSection('ai').customMcpServers
    const mgr = getCustomMcpManager()
    const runtimeList = mgr ? mgr.list() : []
    return {
      ok: true,
      servers: servers.map((s) => {
        const rt = runtimeList.find((r) => r.id === s.id)
        const runtime: McpRuntimeStatus | undefined = rt
          ? {
              id: rt.id,
              connected: rt.status === 'ready',
              status: rt.status,
              toolCount: rt.tools.length,
              tools: rt.tools,
              ...(rt.error ? { error: rt.error } : {})
            }
          : undefined
        return { ...s, runtime }
      })
    }
  })

  // 启用/禁用 MCP server（写 settings + 重连）
  ipcMain.handle(IpcChannels.PLUGIN_TOGGLE_MCP, async (_e, id: string, enabled: boolean) => {
    try {
      const ai = getSection('ai')
      const list = ai.customMcpServers.map((s) => (s.id === id ? { ...s, enabled } : s))
      setSettings({ ai: { customMcpServers: list } })
      await syncWithProjectRoot(list, ctx)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 测试 MCP server 连接
  ipcMain.handle(IpcChannels.PLUGIN_TEST_MCP, async (_e, cfg: CustomMcpServer) => {
    const resolved = resolvePlaceholders(cfg, ctx.activeProject.current)
    const result = await testCustomMcpServer({
      command: resolved.command,
      args: resolved.args,
      env: resolved.env,
      timeoutMs: cfg.timeoutMs,
      cwd: resolved.cwd
    })
    return {
      ok: result.ok,
      toolCount: result.tools.length,
      tools: result.tools,
      error: result.error
    }
  })

  // 查询插件市场（官方 Registry；失败回退内置精选）
  ipcMain.handle(IpcChannels.PLUGIN_LIST_MARKET, async (_e, query: MarketQuery = {}) => {
    return await queryMarket({ search: query?.search, cursor: query?.cursor })
  })

  // 从市场安装插件：写 settings（默认启用）→ 重连 → 短连接握手返回工具数
  ipcMain.handle(IpcChannels.PLUGIN_INSTALL_MARKET, async (_e, req: MarketInstallRequest) => {
    try {
      const plugin = req?.plugin
      if (!plugin?.identifier) return { ok: false, error: '无效的插件信息' }

      // 执行层信任门——runtime 白名单 + identifier 服务端重判 certified
      try {
        assertTrustedPlugin(plugin)
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }

      const ai = getSection('ai')
      const init = toCustomServerInit(plugin, req.envValues ?? {})

      // 重复安装检测（同一 command + args 签名）
      const signature = `${init.command} ${init.args.join(' ')}`
      const duplicated = ai.customMcpServers.find(
        (s) => `${s.command} ${s.args.join(' ')}` === signature
      )
      if (duplicated) {
        return { ok: false, error: `已安装过同名插件：${duplicated.name}` }
      }

      const serverId = `mcp-${Date.now()}-${randomUUID().slice(0, 8)}`
      const newServer: CustomMcpServer = {
        id: serverId,
        name: init.name,
        transport: 'stdio',
        command: init.command,
        args: init.args,
        env: init.env,
        enabled: true,
        timeoutMs: init.timeoutMs,
        category: init.category,
        permission: init.permission,
        // P2-K 安全收紧：市场一键安装默认不暴露任何工具（allowlist 空表 = 全禁），
        // 由用户在插件页「工具权限」分区逐项勾选放行；认证/预置插件缺省仍见 MCP_PRESETS。
        toolFilter: { mode: 'allowlist', tools: [] }
      }
      const list = [...ai.customMcpServers, newServer]
      setSettings({ ai: { customMcpServers: list } })
      await syncWithProjectRoot(list, ctx)

      // 短连接握手确认可用（占位符已替换）；握手失败不回滚安装，配置保留供稍后重试
      let toolCount: number | undefined
      const projectRoot = ctx.activeProject.current
      const cwd = resolveMcpCwd(projectRoot, app.getPath('userData'))
      try {
        const test = await testCustomMcpServer({
          command: init.command,
          args: projectRoot ? resolveArgList(init.args, projectRoot) : init.args,
          env: { ...init.env },
          timeoutMs: init.timeoutMs,
          cwd
        })
        if (test.ok) toolCount = test.tools.length
      } catch {
        // 首次 npx 拉包超时等情况：忽略，运行时管理器会继续尝试
      }

      return { ok: true, serverId, toolCount }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 渲染层声明式插件（语言着色贡献点）：扫描内置示例 + userData/plugins。
  // 纯 JSON 零代码执行，无需信任门；坏插件不拖垮整体（结果内逐个带 error）。
  ipcMain.handle(IpcChannels.PLUGIN_LIST_RENDERER, async () => {
    try {
      return await listRendererPlugins()
    } catch (err) {
      return {
        ok: false,
        plugins: [],
        userPluginsDir: '',
        errors: [{ pluginDir: '-', error: err instanceof Error ? err.message : String(err) }]
      }
    }
  })
}

// ---------- 工具函数 ----------

/** 将 settings 中的占位符替换为项目根后同步给 MCP 管理器 */
async function syncWithProjectRoot(list: CustomMcpServer[], ctx: IpcContext): Promise<void> {
  const mgr = initCustomMcpManager()
  const projectRoot = ctx.activeProject.current
  await mgr.syncFromSettings(list.map((s) => resolveServerConfig(s, projectRoot)))
}

function resolveServerConfig(s: CustomMcpServer, projectRoot: string | null): CustomMcpServer & { cwd: string } {
  const cwd = resolveMcpCwd(projectRoot, app.getPath('userData'))
  return {
    ...s,
    args: projectRoot ? resolveArgList(s.args, projectRoot) : s.args,
    env: Object.fromEntries(
      Object.entries(s.env).map(([k, v]) => [k, projectRoot ? resolveStr(v, projectRoot) : v])
    ),
    cwd
  }
}

function resolvePlaceholders(
  cfg: { command: string; args: string[]; env: Record<string, string> },
  projectRoot: string | null
) {
  const cwd = resolveMcpCwd(projectRoot, app.getPath('userData'))
  return {
    command: cfg.command,
    args: projectRoot ? resolveArgList(cfg.args, projectRoot) : cfg.args,
    env: Object.fromEntries(
      Object.entries(cfg.env).map(([k, v]) => [k, projectRoot ? resolveStr(v, projectRoot) : v])
    ),
    cwd
  }
}

function resolveArgList(args: string[], projectRoot: string): string[] {
  return args.map((a) => resolveStr(a, projectRoot))
}

function resolveStr(v: string, projectRoot: string): string {
  return v.split('__PROJECT_ROOT__').join(projectRoot)
}
