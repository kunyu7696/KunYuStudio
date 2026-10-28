/**
 * 插件库与商城（M15）：MCP 插件管理 + 公共插件市场。
 * 市场数据源：官方 MCP Registry（registry.modelcontextprotocol.io）+ 内置精选保底。
 * 主进程 marketService/pluginHandlers 与渲染层 PluginsView 共用。
 */
import type { CustomMcpServer, McpCategory, McpPermission } from './settings'

/** MCP 插件运行时状态（连接握手结果） */
export interface McpRuntimeStatus {
  /** server id */
  id: string
  /** 是否已连接（status === 'ready'） */
  connected: boolean
  /** 原始连接状态 */
  status?: 'connecting' | 'ready' | 'disconnected' | 'error'
  /** 工具数量（connected 时有效） */
  toolCount: number
  /** 工具名列表 */
  tools: string[]
  /** 错误信息（连接失败时） */
  error?: string
}

/** 市场插件要求的环境变量（安装时收集） */
export interface MarketEnvRequirement {
  /** 变量名，如 GITHUB_TOKEN */
  name: string
  /** 说明 */
  description: string
  /** 是否必填 */
  required: boolean
  /** 是否密钥（UI 用密码框） */
  secret: boolean
  /** 默认值 */
  default?: string
}

/** 市场插件条目（官方 Registry 或内置精选，统一为可安装规格） */
export interface MarketPlugin {
  /** 唯一 id（registry name 或 bundled-xxx） */
  id: string
  /** 展示名（优先 title） */
  name: string
  /** 描述 */
  description: string
  /** 版本 */
  version: string
  /** 作者/发布者（registry name 的前缀） */
  author: string
  /** 分类 */
  category: McpCategory
  /** 权限分级 */
  permission: McpPermission
  /** 图标 emoji */
  icon: string
  /** 来源：official=官方 Registry / bundled=内置精选 */
  source: 'official' | 'bundled'
  /** KunYu 官方认证白名单（核验过来源与安全性），UI 显示「官方认证」徽章；未认证第三方安装前弹安全警告 */
  certified?: boolean
  /** 主页/仓库 URL */
  homepage?: string
  /** 仓库地址 */
  repoUrl?: string
  /** 运行时：npx（npm 包）/ uvx（pypi 包） */
  runtime: 'npx' | 'uvx'
  /** 包标识符，如 @modelcontextprotocol/server-filesystem */
  identifier: string
  /** 包附带的固定位置参数（如 mc-asset 的 "mcp"） */
  packageArgs: string[]
  /** 需要的环境变量 */
  envRequirements: MarketEnvRequirement[]
  /** 安装后追加的参数（如 filesystem 的允许目录 __PROJECT_ROOT__） */
  extraArgs?: string[]
  /** 完整启动参数模板（特殊包用，如 npx -y -p pkg@latest bin；存在时忽略 packageArgs/extraArgs） */
  fullArgs?: string[]
}

/** plugin:list-mcp-servers 返回（含运行时状态） */
export interface PluginMcpListResult {
  ok: boolean
  servers: Array<CustomMcpServer & { runtime?: McpRuntimeStatus }>
}

/** plugin:toggle-mcp 返回 */
export interface PluginToggleResult {
  ok: boolean
  error?: string
}

/** plugin:test-mcp 返回 */
export interface PluginTestResult {
  ok: boolean
  toolCount: number
  tools: string[]
  error?: string
}

/** 市场查询参数 */
export interface MarketQuery {
  /** 搜索关键词（空=列表） */
  search?: string
  /** 分页游标（上一页 nextCursor） */
  cursor?: string
}

/** plugin:list-market 返回 */
export interface PluginMarketListResult {
  ok: boolean
  plugins: MarketPlugin[]
  /** 下一页游标（空串=没有更多） */
  nextCursor: string
  /** 实际数据源（registry 请求失败时为 bundled） */
  source: 'official' | 'bundled'
  /** 错误信息（source=bundled 且是因失败回退时） */
  error?: string
}

/** 安装请求（envValues 为用户填写的环境变量） */
export interface MarketInstallRequest {
  /** 市场条目 id；source=bundled 时从内置目录查找，official 时需带完整规格 */
  plugin: MarketPlugin
  /** 用户填写的环境变量值 */
  envValues: Record<string, string>
}

/** plugin:install-market 返回 */
export interface PluginInstallResult {
  ok: boolean
  error?: string
  /** 新安装的 server id（成功时） */
  serverId?: string
  /** 握手发现的工具数（enabled 立即连接时） */
  toolCount?: number
}
