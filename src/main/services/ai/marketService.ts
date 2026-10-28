/**
 * 插件市场服务。
 * 数据源：
 *  1. 官方 MCP Registry：https://registry.modelcontextprotocol.io/v0.1/servers
 *     - 列表 /v0.1/servers?limit=N&cursor=name:version
 *     - 搜索 /v0.1/servers?search=kw&limit=N
 *     - 同一 server 多版本，仅取 _meta.isLatest
 *  2. 内置精选保底目录（网络不可用时仍可安装：Minecraft 专用 + MCP 官方常用包）
 *
 * 本轮仅安装 stdio 传输（npx / uvx 真实下载运行）；streamable-http 远程条目过滤。
 */
import type { McpCategory, McpPermission } from '../../../shared/types/settings'
import { isCertifiedIdentifier } from '../../../shared/mcpTrust'
import type {
  MarketEnvRequirement,
  MarketPlugin,
  PluginMarketListResult
} from '../../../shared/types/plugin'

const REGISTRY_BASE = 'https://registry.modelcontextprotocol.io/v0.1/servers'
const PAGE_SIZE = 30
const FETCH_TIMEOUT_MS = 15000
const FETCH_RETRIES = 3

// 官方认证白名单定义在 shared/mcpTrust.ts，主进程市场映射与渲染层徽章共用同一事实源。
export { isCertifiedIdentifier }

// ---------- Registry 原始 JSON 形态（仅取需要的字段） ----------

interface RegistryEnvVar {
  name: string
  description?: string
  isRequired?: boolean
  isSecret?: boolean
  default?: string
}

interface RegistryPackage {
  registryType: string // npm | pypi | ...
  identifier: string
  version?: string
  runtimeHint?: string // npx | uvx
  transport?: { type?: string }
  packageArguments?: Array<{ value?: string; type?: string }>
  environmentVariables?: RegistryEnvVar[]
}

interface RegistryServer {
  name: string
  title?: string
  description?: string
  version?: string
  websiteUrl?: string
  repository?: { url?: string }
  packages?: RegistryPackage[]
}

interface RegistryEntry {
  server: RegistryServer
  _meta?: Record<string, { isLatest?: boolean } | undefined>
}

interface RegistryResponse {
  servers: RegistryEntry[]
  metadata?: { nextCursor?: string; count?: number }
}

// ---------- 内置精选目录（全部为已验证存在的真实公共包） ----------

interface BundledEntry {
  plugin: Omit<MarketPlugin, 'id' | 'source' | 'author'>
  keywords: string[]
}

const BUNDLED_CATALOG: BundledEntry[] = [
  {
    keywords: ['minecraft', 'mc', 'texture', 'pixel', 'asset', '贴图', '像素'],
    plugin: {
      name: 'mc-asset 像素资产引擎',
      description: '确定性 Minecraft 像素画引擎：贴图、动画精灵表、资源包校验（官方 Registry 收录）',
      version: 'latest',
      category: 'texture',
      permission: 'interact',
      icon: '🎨',
      homepage: 'https://github.com/smile-minecraft/mc-asset',
      repoUrl: 'https://github.com/smile-minecraft/mc-asset',
      runtime: 'npx',
      identifier: 'mc-asset',
      packageArgs: ['mcp'],
      envRequirements: []
    }
  },
  {
    keywords: ['minecraft', 'texture', 'paint', '贴图'],
    plugin: {
      name: 'mc-texture-cli 贴图编辑',
      description: 'Minecraft 贴图生成与编辑：pixelArtGenerator / texture_paint，限定项目目录',
      version: 'latest',
      category: 'texture',
      permission: 'interact',
      icon: '🖌️',
      runtime: 'npx',
      identifier: 'mc-texture-cli',
      packageArgs: [],
      // 特殊启动形式：npx -y -p mc-texture-cli@latest mctex-mcp --root <项目根>
      fullArgs: ['-y', '-p', 'mc-texture-cli@latest', 'mctex-mcp', '--root', '__PROJECT_ROOT__'],
      envRequirements: []
    }
  },
  {
    keywords: ['minecraft', 'java', 'code', 'yarn', '代码'],
    plugin: {
      name: 'minecraft-dev-mcp 代码分析',
      description: 'Minecraft Java 代码静态分析、反编译、Yarn 映射查询',
      version: 'latest',
      category: 'code',
      permission: 'read',
      icon: '📊',
      runtime: 'npx',
      identifier: '@mcdxai/minecraft-dev-mcp',
      packageArgs: [],
      envRequirements: []
    }
  },
  {
    keywords: ['minecraft', 'blockbench', 'model', '建模', '动画'],
    plugin: {
      name: 'Blockbench MCP 建模/贴图/动画',
      description: 'Blockbench 5.1+ 建模、贴图绘制、动画编辑（需安装配套插件与 Token）',
      version: 'latest',
      category: 'general',
      permission: 'interact',
      icon: '🧊',
      runtime: 'npx',
      identifier: '@anningui/blockbench-mcp',
      packageArgs: [],
      envRequirements: []
    }
  },
  {
    keywords: ['filesystem', 'fs', 'file', '文件'],
    plugin: {
      name: 'Filesystem 文件系统',
      description: '官方 MCP：读写文件、目录管理、文件搜索（限制在当前项目目录内）',
      version: 'latest',
      category: 'code',
      permission: 'interact',
      icon: '📁',
      homepage: 'https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem',
      runtime: 'npx',
      identifier: '@modelcontextprotocol/server-filesystem',
      packageArgs: [],
      extraArgs: ['__PROJECT_ROOT__'],
      envRequirements: []
    }
  },
  {
    keywords: ['memory', 'knowledge', '记忆'],
    plugin: {
      name: 'Memory 知识图谱记忆',
      description: '官方 MCP：本地知识图谱持久化记忆，跨会话保存事实与关系',
      version: 'latest',
      category: 'general',
      permission: 'interact',
      icon: '🧠',
      homepage: 'https://www.npmjs.com/package/@modelcontextprotocol/server-memory',
      runtime: 'npx',
      identifier: '@modelcontextprotocol/server-memory',
      packageArgs: [],
      envRequirements: []
    }
  },
  {
    keywords: ['thinking', 'reason', '思考', '推理'],
    plugin: {
      name: 'Sequential Thinking 顺序思考',
      description: '官方 MCP：结构化分步推理，辅助复杂问题拆解与方案规划',
      version: 'latest',
      category: 'general',
      permission: 'read',
      icon: '🔗',
      homepage: 'https://www.npmjs.com/package/@modelcontextprotocol/server-sequential-thinking',
      runtime: 'npx',
      identifier: '@modelcontextprotocol/server-sequential-thinking',
      packageArgs: [],
      envRequirements: []
    }
  },
  {
    keywords: ['github', 'git', '仓库'],
    plugin: {
      name: 'GitHub 仓库操作',
      description: '官方 MCP：GitHub API 操作仓库/Issue/PR（可选 Token，无 Token 时限流访问公开数据）',
      version: 'latest',
      category: 'code',
      permission: 'interact',
      icon: '🐙',
      homepage: 'https://www.npmjs.com/package/@modelcontextprotocol/server-github',
      runtime: 'npx',
      identifier: '@modelcontextprotocol/server-github',
      packageArgs: [],
      envRequirements: [
        {
          name: 'GITHUB_PERSONAL_ACCESS_TOKEN',
          description: 'GitHub 个人访问令牌（可选，用于私有仓库与提高限流）',
          required: false,
          secret: true
        }
      ]
    }
  },
  {
    keywords: ['browser', 'puppeteer', 'web', '浏览器'],
    plugin: {
      name: 'Puppeteer 浏览器自动化',
      description: '官方 MCP：无头浏览器导航、截图、点击与表单操作（首次运行会下载 Chromium）',
      version: 'latest',
      category: 'general',
      permission: 'interact',
      icon: '🌐',
      homepage: 'https://www.npmjs.com/package/@modelcontextprotocol/server-puppeteer',
      runtime: 'npx',
      identifier: '@modelcontextprotocol/server-puppeteer',
      packageArgs: [],
      envRequirements: []
    }
  }
]

// ---------- 对外 API ----------

/** 查询市场：优先官方 Registry，失败回退内置精选 */
export async function queryMarket(query: { search?: string; cursor?: string }): Promise<PluginMarketListResult> {
  try {
    const plugins = await fetchRegistry(query)
    return plugins
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ok: true,
      plugins: filterBundled(query.search),
      nextCursor: '',
      source: 'bundled',
      error: `官方插件库连接失败，已切换内置精选：${msg}`
    }
  }
}

/** 内置目录（无搜索词时全部返回） */
export function getBundledCatalog(search?: string): MarketPlugin[] {
  return filterBundled(search)
}

// ---------- Registry 抓取 ----------

async function fetchWithRetry(url: string): Promise<RegistryResponse> {
  let lastErr: unknown
  for (let i = 0; i < FETCH_RETRIES; i++) {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: 'application/json' }
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return (await r.json()) as RegistryResponse
    } catch (err) {
      lastErr = err
      if (i < FETCH_RETRIES - 1) await sleep(800 * (i + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Registry 请求失败')
}

async function fetchRegistry(query: { search?: string; cursor?: string }): Promise<PluginMarketListResult> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (query.search) params.set('search', query.search)
  if (query.cursor) params.set('cursor', query.cursor)
  const data = await fetchWithRetry(`${REGISTRY_BASE}?${params.toString()}`)

  // 同 name 多版本 → 优先 isLatest，否则保留最后出现的版本（registry 按版本升序）
  const byName = new Map<string, { entry: RegistryEntry; latest: boolean }>()
  for (const entry of data.servers ?? []) {
    const latest = readIsLatest(entry._meta)
    const prev = byName.get(entry.server.name)
    if (!prev) {
      byName.set(entry.server.name, { entry, latest: latest === true })
    } else if (latest === true || !prev.latest) {
      // 当前标记最新 → 覆盖；前一个非最新时，用后出现的覆盖
      byName.set(entry.server.name, { entry, latest: latest === true })
    }
  }

  const plugins: MarketPlugin[] = []
  for (const { entry } of byName.values()) {
    const plugin = mapRegistryEntry(entry.server)
    if (plugin) plugins.push(plugin)
  }

  return {
    ok: true,
    plugins,
    nextCursor: data.metadata?.nextCursor ?? '',
    source: 'official'
  }
}

/** 读取 _meta 任意发布者命名空间下的 isLatest（官方键：io.modelcontextprotocol.registry/official） */
function readIsLatest(meta: RegistryEntry['_meta']): boolean | null {
  if (!meta) return null
  let saw = false
  for (const key of Object.keys(meta)) {
    const v = meta[key]
    if (v && typeof v.isLatest === 'boolean') {
      saw = true
      if (v.isLatest) return true
    }
  }
  return saw ? false : null
}

/** 将 registry server 映射为可安装市场条目；不支持的传输（http）或无包返回 null */
function mapRegistryEntry(server: RegistryServer): MarketPlugin | null {
  // 取第一个 stdio 包
  const pkg = (server.packages ?? []).find(
    (p) => p.transport?.type === 'stdio' && (p.registryType === 'npm' || p.registryType === 'pypi')
  )
  if (!pkg || !pkg.identifier) return null

  const runtime: 'npx' | 'uvx' =
    pkg.runtimeHint === 'uvx' || pkg.registryType === 'pypi' ? 'uvx' : 'npx'
  const packageArgs = (pkg.packageArguments ?? []).map((a) => a.value ?? '').filter(Boolean)
  const envRequirements: MarketEnvRequirement[] = (pkg.environmentVariables ?? []).map((e) => ({
    name: e.name,
    description: e.description ?? '',
    required: Boolean(e.isRequired),
    secret: Boolean(e.isSecret),
    default: e.default
  }))

  const text = `${server.title ?? ''} ${server.name} ${server.description ?? ''}`.toLowerCase()
  const author = server.name.split('/').slice(0, -1).join('/') || server.name

  return {
    id: server.name,
    name: server.title || pkg.identifier,
    description: server.description ?? '',
    version: pkg.version || server.version || 'latest',
    author,
    category: guessCategory(text),
    permission: guessPermission(text, envRequirements.length > 0),
    icon: guessIcon(text),
    source: 'official',
    certified: isCertifiedIdentifier(pkg.identifier),
    homepage: server.websiteUrl,
    repoUrl: server.repository?.url,
    runtime,
    identifier: pkg.identifier,
    packageArgs,
    envRequirements
  }
}

// ---------- 内置目录 ----------

function filterBundled(search?: string): MarketPlugin[] {
  const kw = search?.trim().toLowerCase()
  return BUNDLED_CATALOG.filter((entry) => {
    const hay = `${entry.plugin.name} ${entry.plugin.description} ${entry.plugin.identifier} ${entry.keywords.join(' ')}`.toLowerCase()
    if (!kw) return true
    return kw.split(/\s+/).every((w) => hay.includes(w))
  }).map((entry, i) => ({
    ...entry.plugin,
    id: `bundled-${i}-${entry.plugin.identifier.replace(/[^a-z0-9]+/gi, '-')}`,
    source: 'bundled' as const,
    certified: entry.plugin.certified === true || isCertifiedIdentifier(entry.plugin.identifier),
    author: 'KunYu 精选'
  }))
}

// ---------- 分类/权限/图标启发式 ----------

function guessCategory(text: string): McpCategory {
  if (/minecraft|mc-|blockbench|pixel|texture|sprite|datapack|resourcepack/.test(text)) {
    if (/texture|pixel|sprite|paint|asset/.test(text)) return 'texture'
    if (/game|server|player|entity/.test(text)) return 'game-control'
    return 'code'
  }
  if (/code|git|github|gitlab|filesystem|file system|compile|java|sql|database|postgres/.test(text)) {
    return 'code'
  }
  return 'general'
}

function guessPermission(text: string, hasSecretEnv: boolean): McpPermission {
  if (/write|delete|filesystem|file system|exec|automation|browser|puppeteer|deploy/.test(text)) {
    return 'interact'
  }
  // 需要密钥的写类服务保守处理
  if (hasSecretEnv && /github|gitlab|slack/.test(text)) return 'interact'
  return 'read'
}

function guessIcon(text: string): string {
  if (/minecraft|mc-/.test(text)) return '🟩'
  if (/texture|pixel|image|paint|asset/.test(text)) return '🎨'
  if (/git|github|gitlab/.test(text)) return '🐙'
  if (/file|filesystem/.test(text)) return '📁'
  if (/browser|puppeteer|web/.test(text)) return '🌐'
  if (/memory|note/.test(text)) return '🧠'
  if (/database|sql|postgres|sqlite/.test(text)) return '🗄️'
  if (/search/.test(text)) return '🔍'
  return '🧩'
}

// ---------- 安装规格转换 ----------

/**
 * 将市场条目 + 用户填写的环境变量转换为可写入 settings 的自定义 MCP server。
 * command/args：
 *  npx -y <identifier> [packageArgs...] [extraArgs...]
 *  uvx <identifier> [packageArgs...]
 * Windows 的 cmd /c 包装由 mcpClient.resolveStdioSpawn 统一处理。
 */
export function toCustomServerInit(
  plugin: MarketPlugin,
  envValues: Record<string, string>
): {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  category: McpCategory
  permission: McpPermission
  timeoutMs: number
} {
  const args = plugin.fullArgs
    ? [...plugin.fullArgs]
    : plugin.runtime === 'npx'
      ? ['-y', plugin.identifier, ...plugin.packageArgs, ...(plugin.extraArgs ?? [])]
      : [plugin.identifier, ...plugin.packageArgs]

  // identifier 直接拼进 npx/uvx args，若以 '-' 开头会被解释为 CLI 选项
  // （如 --registry=http://evil/ 切换 npm 源）。包名不得以 '-' 开头；
  // cmd 元字符已由 mcpClient.resolveStdioSpawn 的 assertCmdSafe 兜底。
  if (!plugin.identifier || /^-/.test(plugin.identifier)) {
    throw new Error('插件包名非法：包名不得以 "-" 开头')
  }

  const env: Record<string, string> = {}
  for (const req of plugin.envRequirements) {
    const v = envValues[req.name] ?? req.default ?? ''
    if (v.trim()) env[req.name] = v.trim()
  }

  return {
    name: plugin.name,
    command: plugin.runtime,
    args,
    env,
    category: plugin.category,
    permission: plugin.permission,
    // npx 首次拉包可能较慢
    timeoutMs: 60000
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
