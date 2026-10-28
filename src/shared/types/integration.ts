/**
 * 集成设置共享类型：外部 Agent CLI 检测结果与 KunYu MCP 桥接状态。
 * 主进程 integrationService 与渲染层 IntegrationPane 共用。
 */

/** 外部 Agent CLI 检测结果 */
export interface ExternalAgentInfo {
  /** 内部 id：codex / claude-code */
  id: 'codex' | 'claude-code'
  /** 展示名 */
  name: string
  /** 是否在本机检测到 */
  found: boolean
  /** 实际使用的可执行文件路径（自定义路径或 PATH 解析结果） */
  path: string
  /** `--version` 输出版本号；未检出为空串 */
  version: string
  /** 检测失败原因（未安装/路径无效等） */
  error?: string
}

/** 派发任务给外部 Agent 的请求（仅限当前打开的项目根，主进程会校验） */
export interface ExternalAgentRunRequest {
  /** 目标 CLI */
  agentId: 'codex' | 'claude-code'
  /** 任务描述（经 stdin 传给 CLI，避免命令行转义问题） */
  prompt: string
  /** 工作目录，必须是当前打开的项目根 */
  cwd: string
  /**
   * 是否允许外部 agent 直接改写工作区，默认 false（只读）。
   * 注意：外部 CLI 使用自己的工具链写盘，不经过 KunYu 的授权门；
   * 渲染层必须二次确认后才可置 true。
   */
  writeAccess?: boolean
}

/** 派发启动结果 */
export interface ExternalAgentRunStart {
  runId: string
  /** 实际执行的命令行（展示用） */
  command: string
  /** 只读 / 可写 */
  writeAccess: boolean
}

/** 主→渲染：外部 agent 输出片段 */
export interface ExternalAgentChunk {
  runId: string
  stream: 'stdout' | 'stderr'
  text: string
}

/** 主→渲染：外部 agent 结束 */
export interface ExternalAgentExit {
  runId: string
  /** 进程退出码（被信号终止时为 null） */
  code: number | null
  signal: string | null
  /** 耗时毫秒 */
  durationMs: number
  /** 是否正常结束（code === 0） */
  ok: boolean
  /** 启动失败等错误原因 */
  error?: string
}

/** KunYu MCP 桥接运行状态 */
export interface McpBridgeStatus {
  /** server 是否正在监听 */
  running: boolean
  /** 监听端口（仅 127.0.0.1） */
  port: number
  /** 对外暴露的工具数量 */
  toolCount: number
  /** 当前挂起等待用户授权的请求数 */
  pendingAuth: number
  /** 端点说明（渲染层直接展示） */
  endpoint: string
  /** P1-8：桥接访问令牌（仅运行中返回）；客户端须经 Bearer 头 / x-kunyu-token 头 / ?token= 携带 */
  token?: string
  /** 启动失败原因等 */
  error?: string
}

/** 主→渲染的授权请求事件负载 */
export interface McpAuthRequest {
  /** 请求唯一 id，渲染层回传决定时携带 */
  requestId: string
  /** 外部 agent 要调用的工具名 */
  tool: string
  /** 工具所属权限分组（read/interact/admin），供弹窗展示 */
  group?: string
  /** 关键参数摘要（已截断，供弹窗展示） */
  argsSummary: string
  /** 发起时间 ISO */
  at: string
}

/** 渲染层回传的授权决定 */
export interface McpAuthDecision {
  requestId: string
  /** true=放行本次调用 */
  allow: boolean
  /** true=本会话内同工具不再询问（仅 mcpAuthMode=session 时生效） */
  rememberSession: boolean
}
