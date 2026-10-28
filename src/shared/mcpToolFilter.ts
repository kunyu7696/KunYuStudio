/**
 * MCP 工具级过滤（M19）：按 server 维度控制哪些工具暴露给 Agent / 允许被调用。
 * 单一事实源：渲染层（PluginsView 工具权限分区）、主进程（mcpClient 过滤）
 * 与设置解析（settings.ts parseAi）都从这里取类型与纯函数。
 *
 * 三态语义：
 * - all：全部允许（等价于未配置，缺省值）
 * - allowlist：仅允许 tools 列表中的工具
 * - blocklist：允许除 tools 列表外的全部工具
 */

export type McpToolFilterMode = 'all' | 'allowlist' | 'blocklist'

export interface McpToolFilter {
  mode: McpToolFilterMode
  /** 工具名列表（allowlist=白名单 / blocklist=黑名单；mode=all 时忽略内容） */
  tools: string[]
}

/** 缺省过滤器：全部允许 */
export const DEFAULT_TOOL_FILTER: McpToolFilter = { mode: 'all', tools: [] }

/** 校验 mode 字符串合法 */
export function isMcpToolFilterMode(v: unknown): v is McpToolFilterMode {
  return v === 'all' || v === 'allowlist' || v === 'blocklist'
}

/**
 * 从持久化数据白名单重建过滤器（非法输入收敛到缺省 all）。
 * tools 去重、去空串、单项限长 128。
 */
export function parseMcpToolFilter(raw: unknown): McpToolFilter {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TOOL_FILTER }
  const r = raw as Record<string, unknown>
  const mode = isMcpToolFilterMode(r['mode']) ? r['mode'] : 'all'
  const rawTools = Array.isArray(r['tools']) ? r['tools'] : []
  const seen = new Set<string>()
  const tools: string[] = []
  for (const t of rawTools) {
    if (typeof t !== 'string') continue
    const name = t.slice(0, 128)
    if (!name || seen.has(name)) continue
    seen.add(name)
    tools.push(name)
  }
  return { mode, tools }
}

/** 判断单个工具是否被过滤器允许 */
export function isToolAllowed(toolName: string, filter: McpToolFilter | undefined | null): boolean {
  if (!filter || filter.mode === 'all') return true
  const listed = filter.tools.includes(toolName)
  if (filter.mode === 'allowlist') return listed
  return !listed // blocklist
}

/** 按过滤器过滤工具列表（保持原顺序，泛型透传 schema 对象） */
export function applyToolFilter<T extends { name: string }>(
  tools: T[],
  filter: McpToolFilter | undefined | null
): T[] {
  if (!filter || filter.mode === 'all') return tools
  return tools.filter((t) => isToolAllowed(t.name, filter))
}
