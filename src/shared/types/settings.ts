/**
 * 应用设置共享类型、默认值与校验（M6 T6.1/T6.2/T6.3，设计文档 3.11）。
 * 主进程 electron-store 与渲染进程 Pinia settings store 共用同一模型，
 * mergeWithDefaults 为纯函数，保证旧版/损坏/非法配置都能收敛到安全值。
 */
import type { AiProviderConfig } from './ai'
import { ALL_TIER_IDS, type TierId } from './tiers'
import { parseMcpToolFilter, type McpToolFilter } from '../mcpToolFilter'

/** 主题模式：深色 / 经典浅白 / 跟随系统 */
export type ThemeMode = 'dark' | 'light' | 'system'

/** 界面语言偏好：简体中文 / 英文 / 跟随系统（system 非中文系统回落英文） */
export type LocalePreference = 'zh-CN' | 'en-US' | 'system'

/** 通用设置 */
export interface GeneralSettings {
  /** 界面缩放 0.8-1.5 */
  zoomLevel: number
  /** 主题模式（默认深色；system 跟随操作系统亮暗切换） */
  themeMode: ThemeMode
  /** 界面语言（默认 zh-CN：中文为源语言） */
  locale: LocalePreference
  /** 启动时恢复上次打开的项目 */
  restoreLastProject: boolean
  /** 编辑器自动保存开关 */
  autosaveEnabled: boolean
  /** 自动保存间隔（秒，1-30） */
  autosaveIntervalSec: number
  /** 启动后自动检查应用更新（仅打包版生效） */
  updateAutoCheck: boolean
  /** 国内镜像兜底前缀：GitHub 直连失败/停滞时按 releases/latest/download 稳定路径重试。
   *  前缀拼在完整 GitHub URL 前（ghproxy 风格），置空则禁用镜像兜底 */
  updateMirrorPrefix: string
}

/** 编辑器设置（均即时作用于 Monaco） */
export interface EditorSettings {
  /** CSS font-family 字符串（可为字体回退栈） */
  fontFamily: string
  /** 字号 11-24 */
  fontSize: number
  /** Tab 宽度 2/4/8 */
  tabSize: number
  /** 以空格替代制表符 */
  insertSpaces: boolean
  /** 自动换行 */
  wordWrap: boolean
  /** 显示行号 */
  lineNumbers: boolean
}

/** Java 环境设置 */
export interface JavaSettings {
  /** 全局 JDK home（bin 的父目录）；null 表示自动检测 */
  globalJdkHome: string | null
  /** Gradle 守护进程内存 MB（1024-4096） */
  gradleMemoryMb: number
  /** 应用内下载的托管 JDK 落盘根目录；null = userData/jdks */
  managedJdkDir: string | null
  /**
   * JDK 下载镜像基地址（TUNA 风格 Adoptium 镜像，如
   * https://mirrors.tuna.tsinghua.edu.cn/Adoptium）；空串 = 直接用 Adoptium API 给出的官方链接。
   * 国内网络下务必保留镜像，禁止在此硬编码锁死第三方 ID。
   */
  jdkMirror: string
}

/** 自定义 MCP 能力分类（工具路由器按任务类型分发） */
export type McpCategory = 'texture' | 'code' | 'game-control' | 'general'

/** 自定义 MCP 权限分级：read=只读检索 / interact=可写文件 / admin=可执行命令 */
export type McpPermission = 'read' | 'interact' | 'admin'

/** 自定义 MCP 服务器配置（开发者自连，第一版仅 stdio 传输） */
export interface CustomMcpServer {
  /** 内部唯一 id（v4 风格，生成时赋值） */
  id: string
  /** 用户可读名称，如 "GitHub CLI" / "filesystem" */
  name: string
  /** 传输类型：当前仅 stdio */
  transport: 'stdio'
  /** 可执行文件（npm/npx/node/python 等）；留空字符串表示用 Electron 内置 Node */
  command: string
  /** 命令参数数组 */
  args: string[]
  /** 额外环境变量（空对象表示不附加） */
  env: Record<string, string>
  /** 是否启用（开关关闭时不连） */
  enabled: boolean
  /** 连接超时毫秒（10-120s，npx 首次拉包可能较慢） */
  timeoutMs: number
  /** 能力分类（路由器按任务类型匹配）；默认 'general' */
  category: McpCategory
  /** 权限分级：read=只读检索 / interact=可写文件 / admin=可执行命令；默认 'read' */
  permission: McpPermission
  /** 工具级过滤（M19）；缺省 all 表示全部允许 */
  toolFilter: McpToolFilter
}

/** 预置社区 MCP（市场一键导入；enabled 默认 false，用户显式启用才连接）。
 *  `__PROJECT_ROOT__` 占位符：syncFromSettings 时由主进程替换为当前项目根的绝对路径。 */
export const MCP_PRESETS: Array<Omit<CustomMcpServer, 'id'>> = [
  {
    name: 'mc-texture-cli（贴图编辑）',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '-p', 'mc-texture-cli@latest', 'mctex-mcp', '--root', '__PROJECT_ROOT__'],
    env: {},
    enabled: false,
    timeoutMs: 60000,
    category: 'texture',
    permission: 'interact',
    toolFilter: { mode: 'all', tools: [] }
  },
  {
    name: '@mcdxai/minecraft-dev-mcp（代码分析）',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@mcdxai/minecraft-dev-mcp@latest'],
    env: {},
    enabled: false,
    timeoutMs: 60000,
    category: 'code',
    permission: 'read',
    toolFilter: { mode: 'all', tools: [] }
  },
  {
    // @anningui/blockbench-mcp：经 Blockbench 配套插件桥接的建模/贴图/动画 MCP
    // （MIT，npx 直跑；需 Blockbench 5.1+ 并安装其配套插件并授予网络权限）。
    // 可写当前 Blockbench 工程，故权限定级 interact；与项目目录无关，不使用 __PROJECT_ROOT__。
    // BBMCP_TOKEN 由主进程从 Blockbench 本地存储自动发现，无需用户手填。
    name: '@anningui/blockbench-mcp（Blockbench 建模/贴图/动画，Token 自动读取）',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anningui/blockbench-mcp@latest'],
    env: {},
    enabled: false,
    timeoutMs: 60000,
    category: 'general',
    permission: 'interact',
    toolFilter: { mode: 'all', tools: [] }
  },
  {
    // @modelcontextprotocol/server-filesystem：官方文件系统服务器（MIT）。
    // 允许 AI 读写项目目录文件，故权限定级 interact。
    name: '@modelcontextprotocol/server-filesystem（项目文件读写）',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem@latest', '__PROJECT_ROOT__'],
    env: {},
    enabled: false,
    timeoutMs: 60000,
    category: 'general',
    permission: 'interact',
    toolFilter: { mode: 'all', tools: [] }
  },
  {
    // @modelcontextprotocol/server-memory：官方记忆服务器（MIT）。
    // 使用本地 JSON 文件持久化记忆，不涉外部网络，权限定级 read。
    name: '@modelcontextprotocol/server-memory（本地记忆存储）',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory@latest'],
    env: {
      MEMORY_FILE_PATH: '__PROJECT_ROOT__/.kunyu/mcp-memory.json'
    },
    enabled: false,
    timeoutMs: 60000,
    category: 'general',
    permission: 'read',
    toolFilter: { mode: 'all', tools: [] }
  }
]

/** 校验 McpCategory 字符串合法 */
export function isMcpCategory(v: unknown): v is McpCategory {
  return v === 'texture' || v === 'code' || v === 'game-control' || v === 'general'
}

/** 校验 McpPermission 字符串合法 */
export function isMcpPermission(v: unknown): v is McpPermission {
  return v === 'read' || v === 'interact' || v === 'admin'
}

/** 单档模型覆盖：null 字段 = 跟随当前默认（决策：可选覆盖） */
export interface TierModelOverride {
  /** 提供商 id；null = 跟随默认提供商 */
  providerId: string | null
  /** 模型名；null = 跟随该提供商配置的 model */
  model: string | null
}

/** 人工档位锁定（TR-10.1）：null 字段 = 未锁定 */
export interface ManualLock {
  /** 锁定档位；null = 未锁定 */
  tier: TierId | null
  /** 锁定来源面板标识（如 agent-track / market） */
  source: string | null
  /** 锁定时间 ISO */
  lockedAt: string | null
}

/** CUE 代码补全设置（M1：基于 Monaco InlineCompletionsProvider） */
export interface CueSettings {
  /** 总开关；关闭后不注册 InlineCompletionsProvider */
  enabled: boolean
  /** 输入停顿多少毫秒后才发起补全请求（50-1000） */
  debounceMs: number
  /** FIM prefix 最大字符数（避免上下文超长） */
  maxPrefixChars: number
  /** FIM suffix 最大字符数 */
  maxSuffixChars: number
  /** 触发补全的语言白名单（Monaco language id） */
  languages: string[]
  /** 覆盖补全模型；空串 = 跟随默认提供商的 model */
  model: string
  /** M2：修改点导航——最近编辑行 ∪ lint 错误行标 ⇥ 装饰器并支持跳转 */
  changePointsEnabled: boolean
  /** M2：接受 CUE 补全后自动跳到下一修改点 */
  jumpAfterAccept: boolean
  /** M4：Java 智能 import——缺失类型诊断 + 灯泡快速修复 */
  javaAutoImport: boolean
  /** M4：本地索引无候选时，灯泡中提供 AI 兜底解析（需手动点击） */
  javaImportAiFallback: boolean
  /** M3：仓库级上下文补全——从项目代码/知识库/模板检索参考注入 FIM */
  repoContextEnabled: boolean
  /** M3：检索上下文预算（字符） */
  repoContextMaxChars: number
  /** M3：三源检索开关 */
  repoContextSources: { grep: boolean; kb: boolean; templates: boolean }
  /** M3b：接受补全跳点后自动唤起下一补全（链式补全） */
  chainAfterJump: boolean
}

/** AI 助手设置 */
export interface AiSettings {
  /** 提供商配置列表 */
  providers: AiProviderConfig[]
  /** 默认提供商 id；null 表示未设置 */
  defaultProviderId: string | null
  /** 每档模型覆盖（默认全 null = 跟随当前提供商与模型） */
  tierModels: Record<TierId, TierModelOverride>
  /** 人工档位锁定（默认未锁定） */
  manualLock: ManualLock
  /** mcdev-mcp 静态检索是否启用（M7：包已内置，启用后自动初始化索引） */
  mcpEnabled: boolean
  /** P1 真机视觉自审：构建+测试通过后截图送视觉模型评分并回写模型（默认开） */
  visualReviewEnabled: boolean
  /**
   * 测试阶段：观察通道离线时自动启动开发客户端（runClient）并等待探针就绪（默认开）。
   * B 方案：不做「关闭客户端再自愈重构建」的互杀处理，冲突时仅提示。
   */
  autoLaunchGameOnTest: boolean
  /**
   * kunyu-observer-agent 自动注入开关（默认开）：runClient 启动时是否在 build.gradle 里
   * 写入 -javaagent vmArg 挂载内置探针。关闭时跳过挂载——游戏启动更快，测试阶段自动降级。
   */
  observerAutoInject: boolean
  /** 开发者自定义的 MCP server（第一版仅 stdio 传输） */
  customMcpServers: CustomMcpServer[]
  /**
   * @deprecated M8 五档制后不再使用：档位替换了 Agent 勾选。
   * 仅为兼容旧持久化数据保留字段；渲染层停止读写，主进程忽略其值。
   */
  enabledAgents: string[]
  /** A3：启动时后台静默预取离线 embedding 模型；false 则完全禁用 */
  offlineModelPrefetch: boolean
  /**
   * 子代理委派开关（默认关）：开启后 AI 可把边界明确的调研类小任务委派给子代理
   * 独立小循环执行（只读工具集、轮次/超时护栏、结论浓缩回填）。关闭则 agent_delegate
   * 工具完全不进入 FC 列表——避免子代理不可控地增加算力成本。
   */
  subAgentEnabled: boolean
  /**
   * 实体自由编码模式（默认关）：开启后 AI 判定实体行为超出内置目录（与容器交互、
   * 多阶段状态机、自定义攻击/逃跑策略等）时，可直写 Java 实体类/自定义 Goal/渲染器；
   * 关闭则一律走可视化语义资产（schema），保证所有实体在编辑器里可见可微调。
   */
  entityFreeformEnabled: boolean
  /**
   * 全局自由编码模式（默认关）：开启后整个项目放开双轨硬约束——AI 可用
   * write_project_file 直写方块/物品/实体/Cube 模型的 Java 类与资源 JSON，
   * 不强制走 content_upsert 语义资产。代价是直写产物在可视化编辑器里不可见、
   * 用户无法微调。开启时实体自由编码开关失效（全局已覆盖）。
   */
  globalFreeformEnabled: boolean
  /**
   * 严格审查闸门（默认关）：开启后 Agent 运行产生的文件变更必须全部经人工
   * 保留/撤销处理完毕，才允许发起下一次 Agent 运行；撤销走快照回滚，可完整还原。
   */
  strictReview: boolean
  /** CUE 代码补全（M1） */
  cue: CueSettings
}

/** 网络设置 */
export interface NetworkSettings {
  /** 依赖镜像源：国内镜像 / 官方源（影响新建项目模板与 MC 运行时下载） */
  mirror: 'china' | 'official'
  /**
   * MC 运行时下载镜像基地址（BMCLAPI 风格，如 https://bmclapi2.bangbang93.com）。
   * 空串 = 按 mirror 模式解析（china → 内置 BMCLAPI 默认，official → 官方直连）。
   * 国内网络下可保留默认；禁止在此硬编码锁死第三方 ID，用户可改成任意镜像或清空走官方。
   */
  mcMirror: string
  /** HTTP 代理策略：不使用 / 跟随系统 / 自定义 */
  proxyMode: 'none' | 'system' | 'custom'
  /** 自定义代理主机（proxyMode=custom 时必填） */
  proxyHost: string
  /** 自定义代理端口（1-65535） */
  proxyPort: number
  /** 网络请求超时秒（10-120），AI 请求默认使用 */
  timeoutSec: number
}

/** 模组市场设置（M9） */
export interface MarketplaceSettings {
  /** CurseForge Core API Key（空串表示未配置，CurseForge 搜索将不可用） */
  curseforgeApiKey: string
  /**
   * 允许在无 Key 时使用 MCIM 社区镜像（第三方，数据可能与官方存在延迟/差异）。
   * 默认关闭：镜像回退必须用户显式开启（P1-10 下载完整性）。
   */
  allowCfMirror: boolean
}

/** 发布设置（M18）：整合包直发 Modrinth / CurseForge */
export interface PublishSettings {
  /** Modrinth API token（空串 = 未配置） */
  modrinthToken: string
  /** Modrinth 项目 ID（slug 或实际 ID，空串 = 未配置） */
  modrinthProjectId: string
  /** CurseForge API token（空串 = 未配置） */
  curseforgeToken: string
  /** CurseForge 项目 ID（空串 = 未配置） */
  curseforgeProjectId: string
  /** 默认发布类型 */
  defaultReleaseType: 'release' | 'beta' | 'alpha'
}

/** 集成设置：外部 Agent CLI + KunYu 作为 MCP server 的桥接 */
export interface IntegrationSettings {
  /** Codex CLI 可执行文件路径；空串 = 自动检测 PATH */
  codexPath: string
  /** Claude Code CLI 可执行文件路径；空串 = 自动检测 PATH */
  claudeCodePath: string
  /**
   * 外部 Agent 派发开关：关闭时仅保留检测与桌面快捷方式，
   * 「派发任务」面板整体隐藏（默认关闭，避免未配置时误触）。
   */
  externalAgentEnabled: boolean
  /** MCP 桥接开关：启用后 KunYu 作为 MCP server 监听本机回环 */
  mcpBridgeEnabled: boolean
  /** MCP 桥接端口（1024-65535，仅 127.0.0.1）；0 = 每次启动由 OS 分配随机空闲端口（P1-8 默认） */
  mcpBridgePort: number
  /** 授权策略：always=每次写操作都弹窗 / session=本会话记住已授权工具 */
  mcpAuthMode: 'always' | 'session'
}

/** 全量应用设置 */
export interface AppSettings {
  general: GeneralSettings
  editor: EditorSettings
  java: JavaSettings
  ai: AiSettings
  network: NetworkSettings
  marketplace: MarketplaceSettings
  publish: PublishSettings
  integration: IntegrationSettings
}

/** 设置分段名 */
export type SettingsSection = keyof AppSettings

/** 渲染层提交的部分更新（按分段浅合并，非法字段在主进程被丢弃） */
export type SettingsPatch = Partial<{
  [K in SettingsSection]: Partial<AppSettings[K]>
}>

/** 与 CodeEditor 原硬编码行为等价的默认值（NFR-5 向后兼容） */
export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    zoomLevel: 1,
    themeMode: 'system',
    locale: 'zh-CN',
    restoreLastProject: false,
    autosaveEnabled: false,
    autosaveIntervalSec: 2,
    updateAutoCheck: true,
    updateMirrorPrefix: 'https://ghproxy.net'
  },
  editor: {
    fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
    fontSize: 13,
    tabSize: 4,
    insertSpaces: false,
    wordWrap: true,
    lineNumbers: true
  },
  java: {
    globalJdkHome: null,
    gradleMemoryMb: 4096,
    managedJdkDir: null,
    // 国内网络硬约束：默认走清华 TUNA 的 Adoptium 镜像；用户可在设置中改成任意镜像或清空走官方
    jdkMirror: 'https://mirrors.tuna.tsinghua.edu.cn/Adoptium'
  },
  ai: {
    // 预置 DeepSeek 入口（0.1.1 起以维护者实测配置为默认）：新用户粘贴 Key 即可用；
    // apiKey 永不为默认值——密钥仅存各机 userData，随机密文不可分发也不可移植
    providers: [
      {
        id: 'preset-deepseek',
        name: 'DeepSeek',
        kind: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
        apiKeyUrl: 'https://platform.deepseek.com/api_keys',
        model: 'deepseek-reasoner',
        // 推理模型的思维链与正文共享 max_tokens：16k 容易被长思考挤掉正文，
        // 提到 32k 让 deepseek-reasoner 有足够余量输出完整回答（模型上限 64k）
        maxTokens: 32768,
        temperature: 0.7,
        enabled: true
      }
    ],
    defaultProviderId: 'preset-deepseek',
    tierModels: {
      sprinter: { providerId: 'preset-deepseek', model: null },
      artisan: { providerId: 'preset-deepseek', model: null },
      master: { providerId: 'preset-deepseek', model: null },
      bridge: { providerId: 'preset-deepseek', model: null },
      weaver: { providerId: 'preset-deepseek', model: null }
    },
    manualLock: { tier: null, source: null, lockedAt: null },
    // mcdev-mcp 已内置：默认自动连接，首次使用自动初始化索引；用户可在设置中手动关闭
    mcpEnabled: true,
    visualReviewEnabled: true,
    autoLaunchGameOnTest: true,
    observerAutoInject: true,
    // 预置社区 MCP 全家桶（维护者实测组合，0.1.1 起为默认；均 npx 直跑、按需可关）。
    // __PROJECT_ROOT__ 占位符由主进程 syncFromSettings 时替换为当前项目根。
    customMcpServers: [
      {
        id: 'preset-mcp-mctex',
        name: 'mc-texture-cli（贴图编辑）',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '-p', 'mc-texture-cli@latest', 'mctex-mcp', '--root', '__PROJECT_ROOT__'],
        env: {},
        enabled: true,
        timeoutMs: 30000,
        category: 'texture',
        permission: 'interact',
        toolFilter: { mode: 'all', tools: [] }
      },
      {
        id: 'preset-mcp-mcdxai',
        name: '@mcdxai/minecraft-dev-mcp（代码分析）',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@mcdxai/minecraft-dev-mcp@latest'],
        env: {},
        enabled: true,
        timeoutMs: 60000,
        category: 'code',
        permission: 'read',
        toolFilter: { mode: 'all', tools: [] }
      },
      {
        id: 'preset-mcp-blockbench',
        name: '@anningui/blockbench-mcp（Blockbench 建模/贴图/动画）',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@anningui/blockbench-mcp@latest'],
        env: {},
        enabled: true,
        timeoutMs: 60000,
        category: 'general',
        permission: 'interact',
        toolFilter: { mode: 'all', tools: [] }
      },
      {
        id: 'preset-mcp-mcasset',
        name: 'mc-asset — Minecraft Pixel Asset Engine',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'mc-asset', 'mcp'],
        env: {},
        enabled: true,
        timeoutMs: 60000,
        category: 'texture',
        permission: 'read',
        toolFilter: { mode: 'all', tools: [] }
      },
      {
        id: 'preset-mcp-mojang',
        name: 'minecraft-mojang-mcp',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'minecraft-mojang-mcp@latest'],
        env: {},
        enabled: true,
        timeoutMs: 60000,
        category: 'game-control',
        permission: 'read',
        toolFilter: { mode: 'all', tools: [] }
      },
      {
        id: 'preset-mcp-filesystem',
        name: '@modelcontextprotocol/server-filesystem（项目文件读写）',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem@latest', '__PROJECT_ROOT__'],
        env: {},
        enabled: true,
        timeoutMs: 60000,
        category: 'general',
        permission: 'interact',
        toolFilter: { mode: 'all', tools: [] }
      },
      {
        id: 'preset-mcp-memory',
        name: '@modelcontextprotocol/server-memory（本地记忆存储）',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory@latest'],
        env: { MEMORY_FILE_PATH: '' },
        enabled: true,
        timeoutMs: 60000,
        category: 'general',
        permission: 'read',
        toolFilter: { mode: 'all', tools: [] }
      }
    ],
    enabledAgents: [],
    offlineModelPrefetch: true,
    // 子代理委派默认关：需要时在设置页显式开启，避免算力成本不可控
    subAgentEnabled: false,
    entityFreeformEnabled: false,
    // 全局自由编码默认关：放开后编辑器不可见，风险高于实体级开关
    globalFreeformEnabled: false,
    // 严格审查闸门默认关：开启后未审完的 Agent 变更会阻塞下一次运行
    strictReview: false,
    cue: {
      enabled: true,
      debounceMs: 150,
      maxPrefixChars: 2000,
      maxSuffixChars: 1000,
      languages: ['java', 'json', 'properties'],
      model: '',
      changePointsEnabled: true,
      jumpAfterAccept: true,
      javaAutoImport: true,
      javaImportAiFallback: true,
      repoContextEnabled: true,
      repoContextMaxChars: 3000,
      repoContextSources: { grep: true, kb: false, templates: true },
      chainAfterJump: true
    }
  },
  network: {
    mirror: 'china',
    // 空串＝按 mirror 模式解析（china → 内置 BMCLAPI）；可配置，禁止锁死第三方 ID
    mcMirror: '',
    proxyMode: 'none',
    proxyHost: '',
    proxyPort: 0,
    timeoutSec: 120
  },
  marketplace: {
    curseforgeApiKey: '',
    allowCfMirror: true
  },
  publish: {
    modrinthToken: '',
    modrinthProjectId: '',
    curseforgeToken: '',
    curseforgeProjectId: '',
    defaultReleaseType: 'release'
  },
  integration: {
    codexPath: '',
    claudeCodePath: '',
    externalAgentEnabled: false,
    mcpBridgeEnabled: true,
    // P1-8：默认随机端口，避免固定端口被本机任意进程扫描定位
    mcpBridgePort: 0,
    mcpAuthMode: 'always'
  }
}

/** 缩放范围（主进程应用 zoomFactor 时同样使用） */
export const ZOOM_MIN = 0.8
export const ZOOM_MAX = 1.5

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  const clamped = Math.min(max, Math.max(min, v))
  return clamped
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}

function str(v: unknown, fallback: string, maxLen = 500): string {
  if (typeof v !== 'string') return fallback
  return v.length <= maxLen ? v : v.slice(0, maxLen)
}

function oneOf<T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback
}

/** 合并/校验单段设置；非法字段逐字段回退默认 */
export function mergeSection<K extends SettingsSection>(
  section: K,
  raw: unknown
): AppSettings[K] {
  switch (section) {
    case 'general':
      return parseGeneral(raw) as AppSettings[K]
    case 'editor':
      return parseEditor(raw) as AppSettings[K]
    case 'java':
      return parseJava(raw) as AppSettings[K]
    case 'network':
      return parseNetwork(raw) as AppSettings[K]
    case 'ai':
      return parseAi(raw) as AppSettings[K]
    case 'marketplace':
      return parseMarketplace(raw) as AppSettings[K]
    case 'publish':
      return parsePublish(raw) as AppSettings[K]
    case 'integration':
      return parseIntegration(raw) as AppSettings[K]
  }
}

function parseGeneral(raw: unknown): GeneralSettings {
  const d = DEFAULT_SETTINGS.general
  const r = isRecord(raw) ? raw : {}
  return {
    zoomLevel: Math.round(num(r['zoomLevel'], ZOOM_MIN, ZOOM_MAX, d.zoomLevel) * 100) / 100,
    themeMode: oneOf(r['themeMode'], ['dark', 'light', 'system'] as const, d.themeMode),
    locale: oneOf(r['locale'], ['zh-CN', 'en-US', 'system'] as const, d.locale),
    restoreLastProject: bool(r['restoreLastProject'], d.restoreLastProject),
    autosaveEnabled: bool(r['autosaveEnabled'], d.autosaveEnabled),
    autosaveIntervalSec: Math.round(num(r['autosaveIntervalSec'], 1, 30, d.autosaveIntervalSec)),
    updateAutoCheck: bool(r['updateAutoCheck'], d.updateAutoCheck),
    updateMirrorPrefix: str(r['updateMirrorPrefix'], d.updateMirrorPrefix, 200)
  }
}

function parseEditor(raw: unknown): EditorSettings {
  const d = DEFAULT_SETTINGS.editor
  const r = isRecord(raw) ? raw : {}
  return {
    fontFamily: str(r['fontFamily'], d.fontFamily, 200),
    fontSize: Math.round(num(r['fontSize'], 11, 24, d.fontSize)),
    tabSize: oneOf(r['tabSize'], [2, 4, 8] as const, d.tabSize),
    insertSpaces: bool(r['insertSpaces'], d.insertSpaces),
    wordWrap: bool(r['wordWrap'], d.wordWrap),
    lineNumbers: bool(r['lineNumbers'], d.lineNumbers)
  }
}

function parseJava(raw: unknown): JavaSettings {
  const d = DEFAULT_SETTINGS.java
  const r = isRecord(raw) ? raw : {}
  return {
    globalJdkHome:
      r['globalJdkHome'] === null || r['globalJdkHome'] === undefined
        ? null
        : str(r['globalJdkHome'], '', 300) || null,
    gradleMemoryMb: Math.round(num(r['gradleMemoryMb'], 1024, 4096, d.gradleMemoryMb)),
    managedJdkDir:
      r['managedJdkDir'] === null || r['managedJdkDir'] === undefined
        ? null
        : str(r['managedJdkDir'], '', 300) || null,
    jdkMirror: str(r['jdkMirror'], d.jdkMirror, 300).trim()
  }
}

function parseNetwork(raw: unknown): NetworkSettings {
  const d = DEFAULT_SETTINGS.network
  const r = isRecord(raw) ? raw : {}
  return {
    mirror: oneOf(r['mirror'], ['china', 'official'] as const, d.mirror),
    mcMirror: str(r['mcMirror'], d.mcMirror, 300).trim(),
    proxyMode: oneOf(r['proxyMode'], ['none', 'system', 'custom'] as const, d.proxyMode),
    proxyHost: str(r['proxyHost'], d.proxyHost, 200),
    proxyPort: Math.round(num(r['proxyPort'], 0, 65535, d.proxyPort)),
    timeoutSec: Math.round(num(r['timeoutSec'], 10, 120, d.timeoutSec))
  }
}

function parseAi(raw: unknown): AiSettings {
  const d = DEFAULT_SETTINGS.ai
  const r = isRecord(raw) ? raw : {}
  // 提供商数组逐项白名单重建，丢弃未知字段与非法项。
  // 字段缺省（首启/旧版无此键）→ 回退预置默认；显式空数组 = 用户删光，尊重不回灌。
  const list = Array.isArray(r['providers']) ? r['providers'] : d.providers
  const providers: AiProviderConfig[] = []
  const ids = new Set<string>()
  for (const item of list) {
    if (!isRecord(item) || typeof item['id'] !== 'string' || !item['id']) continue
    if (ids.has(item['id'])) continue
    const kind: AiProviderConfig['kind'] | null =
      item['kind'] === 'openai-compatible' || item['kind'] === 'ollama' ? item['kind'] : null
    if (!kind) continue
    ids.add(item['id'])
    const rawKeyUrl = typeof item['apiKeyUrl'] === 'string' ? item['apiKeyUrl'] : ''
    providers.push({
      id: item['id'],
      name: str(item['name'], kind === 'ollama' ? '本地 Ollama' : '未命名提供商', 100),
      kind,
      baseUrl: str(item['baseUrl'], '', 300),
      apiKey: str(item['apiKey'], '', 500),
      // 仅接受 http(s) 官网链接，非法/旧版缺字段收敛为空串
      apiKeyUrl: /^https?:\/\//.test(rawKeyUrl) ? str(item['apiKeyUrl'], '', 300) : '',
      model: str(item['model'], '', 200),
      maxTokens: Math.round(num(item['maxTokens'], 256, 128000, 16384)),
      temperature: num(item['temperature'], 0, 2, 0.7),
      enabled: bool(item['enabled'], true)
    })
  }
  // 非法/失效 id 回落默认厂商；但默认 id 也必须对合并后的 providers 列表合法——
  // 用户显式删光 providers 时不得悬挂指向已删除的预置项（语义延续）
  const defaultId =
    typeof r['defaultProviderId'] === 'string' &&
    r['defaultProviderId'] &&
    providers.some((p) => p.id === r['defaultProviderId'])
      ? (r['defaultProviderId'] as string)
      : d.defaultProviderId && providers.some((p) => p.id === d.defaultProviderId)
        ? d.defaultProviderId
        : null
  const mcpEnabled = bool(r['mcpEnabled'], d.mcpEnabled)
  const visualReviewEnabled = bool(r['visualReviewEnabled'], d.visualReviewEnabled)
  const autoLaunchGameOnTest = bool(r['autoLaunchGameOnTest'], d.autoLaunchGameOnTest)
  const observerAutoInject = bool(r['observerAutoInject'], d.observerAutoInject)
  const offlineModelPrefetch = bool(r['offlineModelPrefetch'], d.offlineModelPrefetch)
  const subAgentEnabled = bool(r['subAgentEnabled'], d.subAgentEnabled)
  const entityFreeformEnabled = bool(r['entityFreeformEnabled'], d.entityFreeformEnabled)
  const globalFreeformEnabled = bool(r['globalFreeformEnabled'], d.globalFreeformEnabled)
  const strictReview = bool(r['strictReview'], d.strictReview)
  // enabledAgents 已废弃（M8 五档制）：仅透传合法字符串，保持旧数据可读，不再有任何行为
  const rawAgents = Array.isArray(r['enabledAgents']) ? r['enabledAgents'] : []
  const enabledAgents = rawAgents.filter((v): v is string => typeof v === 'string')
  // customMcpServers：逐项白名单重建，丢弃非法项。
  // 缺省 → 回退预置默认（首启即得全家桶）；显式空数组 = 用户删光，尊重不回灌。
  const rawServers = Array.isArray(r['customMcpServers'])
    ? r['customMcpServers']
    : d.customMcpServers
  const seenServerIds = new Set<string>()
  const customMcpServers: CustomMcpServer[] = []
  for (const item of rawServers) {
    if (!isRecord(item)) continue
    const id = typeof item['id'] === 'string' && item['id'] ? item['id'] : ''
    if (!id || seenServerIds.has(id)) continue
    seenServerIds.add(id)
    const transport = item['transport'] === 'stdio' ? 'stdio' : 'stdio'
    const envRaw = item['env']
    const env: Record<string, string> = {}
    if (isRecord(envRaw)) {
      for (const [k, v] of Object.entries(envRaw)) {
        if (typeof v === 'string') env[k] = v
      }
    }
    const argsRaw = item['args']
    const args: string[] = Array.isArray(argsRaw)
      ? argsRaw.filter((v): v is string => typeof v === 'string')
      : []
    customMcpServers.push({
      id,
      name: str(item['name'], '未命名 MCP Server', 80),
      transport,
      command: str(item['command'], '', 300),
      args,
      env,
      enabled: bool(item['enabled'], true),
      timeoutMs: Math.round(num(item['timeoutMs'], 10_000, 120_000, 30_000)),
      category: isMcpCategory(item['category']) ? item['category'] : 'general',
      permission: isMcpPermission(item['permission']) ? item['permission'] : 'read',
      toolFilter: parseMcpToolFilter(item['toolFilter'])
    })
  }
  return {
    providers,
    defaultProviderId: defaultId,
    tierModels: parseTierModels(r['tierModels'], providers),
    manualLock: parseManualLock(r['manualLock']),
    mcpEnabled,
    visualReviewEnabled,
    autoLaunchGameOnTest,
    observerAutoInject,
    customMcpServers,
    enabledAgents,
    offlineModelPrefetch,
    subAgentEnabled,
    entityFreeformEnabled,
    globalFreeformEnabled,
    strictReview,
    cue: parseCue(r['cue'])
  }
}

/** CUE 白名单重建：languages 限合法字符串数组，数值字段钳制范围 */
function parseCue(raw: unknown): CueSettings {
  const d = DEFAULT_SETTINGS.ai.cue
  const r = isRecord(raw) ? raw : {}
  const rawLangs = Array.isArray(r['languages']) ? r['languages'] : []
  const langs = rawLangs.filter((v): v is string => typeof v === 'string' && v.length > 0)
  return {
    enabled: bool(r['enabled'], d.enabled),
    debounceMs: Math.round(num(r['debounceMs'], 50, 1000, d.debounceMs)),
    maxPrefixChars: Math.round(num(r['maxPrefixChars'], 200, 8000, d.maxPrefixChars)),
    maxSuffixChars: Math.round(num(r['maxSuffixChars'], 100, 4000, d.maxSuffixChars)),
    languages: langs.length > 0 ? langs : d.languages,
    model: str(r['model'], d.model, 200),
    changePointsEnabled: bool(r['changePointsEnabled'], d.changePointsEnabled),
    jumpAfterAccept: bool(r['jumpAfterAccept'], d.jumpAfterAccept),
    javaAutoImport: bool(r['javaAutoImport'], d.javaAutoImport),
    javaImportAiFallback: bool(r['javaImportAiFallback'], d.javaImportAiFallback),
    repoContextEnabled: bool(r['repoContextEnabled'], d.repoContextEnabled),
    repoContextMaxChars: Math.round(num(r['repoContextMaxChars'], 500, 16000, d.repoContextMaxChars)),
    repoContextSources: parseRepoContextSources(r['repoContextSources'], d.repoContextSources),
    chainAfterJump: bool(r['chainAfterJump'], d.chainAfterJump)
  }
}

/** M3：解析仓库上下文三源开关 */
function parseRepoContextSources(
  raw: unknown,
  fallback: { grep: boolean; kb: boolean; templates: boolean }
): { grep: boolean; kb: boolean; templates: boolean } {
  if (!isRecord(raw)) return fallback
  return {
    grep: bool(raw['grep'], fallback.grep),
    kb: bool(raw['kb'], fallback.kb),
    templates: bool(raw['templates'], fallback.templates)
  }
}

function createDefaultTierModels(): Record<TierId, TierModelOverride> {
  const result = {} as Record<TierId, TierModelOverride>
  for (const id of ALL_TIER_IDS) result[id] = { providerId: null, model: null }
  return result
}

/** 逐档白名单重建：providerId 必须存在于提供商列表；model 限长字符串。
 *  缺省（首启/旧版无此键）→ 回退预置默认（0.1.1 起指向预置 DeepSeek）；
 *  显式记录逐档重建，用户清空/降级均尊重。 */
function parseTierModels(raw: unknown, providers: AiProviderConfig[]): Record<TierId, TierModelOverride> {
  const providerIds = new Set(providers.map((p) => p.id))
  if (!isRecord(raw)) {
    const d = DEFAULT_SETTINGS.ai.tierModels
    const result = {} as Record<TierId, TierModelOverride>
    for (const id of ALL_TIER_IDS) {
      const t = d[id]
      // 预置指向同样不得悬挂（如 providers 被显式删光而 tierModels 缺省时）
      result[id] = {
        providerId: t.providerId && providerIds.has(t.providerId) ? t.providerId : null,
        model: t.model
      }
    }
    return result
  }
  const result = createDefaultTierModels()
  for (const tierId of ALL_TIER_IDS) {
    const entry = raw[tierId]
    if (!isRecord(entry)) continue
    const providerId =
      typeof entry['providerId'] === 'string' && providerIds.has(entry['providerId'])
        ? entry['providerId']
        : null
    const model =
      typeof entry['model'] === 'string' && entry['model']
        ? str(entry['model'], '', 200)
        : null
    result[tierId] = { providerId, model }
  }
  return result
}

/** 人工锁定白名单：tier 必须是合法 TierId；source/lockedAt 限长字符串 */
function parseManualLock(raw: unknown): ManualLock {
  const empty: ManualLock = { tier: null, source: null, lockedAt: null }
  if (!isRecord(raw)) return empty
  const tier =
    typeof raw['tier'] === 'string' && ALL_TIER_IDS.includes(raw['tier'] as TierId)
      ? (raw['tier'] as TierId)
      : null
  if (!tier) return empty
  return {
    tier,
    source: typeof raw['source'] === 'string' ? str(raw['source'], '', 80) : null,
    lockedAt:
      typeof raw['lockedAt'] === 'string' && !Number.isNaN(Date.parse(raw['lockedAt']))
        ? raw['lockedAt']
        : null
  }
}

function parseMarketplace(raw: unknown): MarketplaceSettings {
  const d = DEFAULT_SETTINGS.marketplace
  const r = isRecord(raw) ? raw : {}
  return {
    curseforgeApiKey: str(r['curseforgeApiKey'], d.curseforgeApiKey, 200),
    allowCfMirror: bool(r['allowCfMirror'], d.allowCfMirror)
  }
}

function parsePublish(raw: unknown): PublishSettings {
  const d = DEFAULT_SETTINGS.publish
  const r = isRecord(raw) ? raw : {}
  return {
    modrinthToken: str(r['modrinthToken'], d.modrinthToken, 500),
    modrinthProjectId: str(r['modrinthProjectId'], d.modrinthProjectId, 100),
    curseforgeToken: str(r['curseforgeToken'], d.curseforgeToken, 500),
    curseforgeProjectId: str(r['curseforgeProjectId'], d.curseforgeProjectId, 100),
    defaultReleaseType: oneOf(
      r['defaultReleaseType'],
      ['release', 'beta', 'alpha'] as const,
      d.defaultReleaseType
    )
  }
}

function parseIntegration(raw: unknown): IntegrationSettings {
  const d = DEFAULT_SETTINGS.integration
  const r = isRecord(raw) ? raw : {}
  return {
    codexPath: str(r['codexPath'], d.codexPath, 500),
    claudeCodePath: str(r['claudeCodePath'], d.claudeCodePath, 500),
    externalAgentEnabled: bool(r['externalAgentEnabled'], d.externalAgentEnabled),
    mcpBridgeEnabled: bool(r['mcpBridgeEnabled'], d.mcpBridgeEnabled),
    // 0（随机端口）合法；其余收窄到 1024-65535
    mcpBridgePort: (() => {
      const portRaw = Math.round(num(r['mcpBridgePort'], 0, 65535, d.mcpBridgePort))
      return portRaw === 0 ? 0 : Math.min(65535, Math.max(1024, portRaw))
    })(),
    mcpAuthMode: oneOf(r['mcpAuthMode'], ['always', 'session'] as const, d.mcpAuthMode)
  }
}

/**
 * 将任意持久化内容与默认值深合并为合法 AppSettings。
 * 未知顶层分段被忽略；缺失/损坏分段整段取默认。
 */
export function mergeWithDefaults(raw: unknown): AppSettings {
  const r = isRecord(raw) ? raw : {}
  return {
    general: mergeSection('general', r['general']),
    editor: mergeSection('editor', r['editor']),
    java: mergeSection('java', r['java']),
    ai: mergeSection('ai', r['ai']),
    network: mergeSection('network', r['network']),
    marketplace: mergeSection('marketplace', r['marketplace']),
    publish: mergeSection('publish', r['publish']),
    integration: mergeSection('integration', r['integration'])
  }
}

/** 深合并一次部分更新（仅识别已知分段/字段），返回合并后的新全量对象 */
export function applyPatch(current: AppSettings, patch: unknown): AppSettings {
  const p = isRecord(patch) ? patch : {}
  const parsedAi = mergeSection('ai', { ...current.ai, ...(isRecord(p['ai']) ? p['ai'] : {}) })
  // （设置层）：patch 显式携带非法 defaultProviderId 时，parseAi 会把它静默丢弃并
  // 回落默认 null——已持久化的默认厂商被无提示清空。校验失败时回退到旧值
  // （旧值对合并后的 providers 列表仍然合法才回退，避免指向已删除的 provider）。
  const patchedDefault = isRecord(p['ai']) ? p['ai']['defaultProviderId'] : undefined
  if (
    typeof patchedDefault === 'string' &&
    patchedDefault &&
    parsedAi.defaultProviderId !== patchedDefault
  ) {
    const stillValid =
      typeof current.ai.defaultProviderId === 'string' &&
      current.ai.defaultProviderId &&
      parsedAi.providers.some((pr) => pr.id === current.ai.defaultProviderId)
    if (stillValid) parsedAi.defaultProviderId = current.ai.defaultProviderId
  }
  return {
    general: mergeSection('general', { ...current.general, ...(isRecord(p['general']) ? p['general'] : {}) }),
    editor: mergeSection('editor', { ...current.editor, ...(isRecord(p['editor']) ? p['editor'] : {}) }),
    java: mergeSection('java', { ...current.java, ...(isRecord(p['java']) ? p['java'] : {}) }),
    ai: parsedAi,
    network: mergeSection('network', { ...current.network, ...(isRecord(p['network']) ? p['network'] : {}) }),
    marketplace: mergeSection('marketplace', {
      ...current.marketplace,
      ...(isRecord(p['marketplace']) ? p['marketplace'] : {})
    }),
    publish: mergeSection('publish', {
      ...current.publish,
      ...(isRecord(p['publish']) ? p['publish'] : {})
    }),
    integration: mergeSection('integration', {
      ...current.integration,
      ...(isRecord(p['integration']) ? p['integration'] : {})
    })
  }
}
