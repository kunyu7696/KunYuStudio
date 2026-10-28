import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { IntegrationSettings } from '../../shared/types/settings'
import type {
  ExternalAgentInfo,
  McpAuthDecision,
  McpAuthRequest,
  McpBridgeStatus
} from '../../shared/types/integration'
import type { ToolRegistry } from './ai/toolRegistry'
import type { LoaderId } from '../../shared/types/aiReference'
import { getMcpToolPermission } from '../../shared/mcpToolPermission'
import { appendMcpAudit, type McpAuditLogDeps } from './mcpAuditLog'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertCmdSafe } from '../utils/cmdSafe'

const nodeRequire = createRequire(import.meta.url)

/**
 * 默认审计路径（P1-8）：打包态落 userData（进程 cwd 可能在 Program Files
 * 下不可写）；纯 Node 环境（vitest）无 electron，回退 cwd。
 */
function defaultAuditPath(): string {
  try {
    const electron = nodeRequire('electron') as { app?: { getPath?: (name: string) => string } }
    const userData = electron?.app?.getPath?.('userData')
    if (userData) return join(userData, 'mcp-audit.jsonl')
  } catch {
    /* 纯 Node 环境无 electron */
  }
  return join(process.cwd(), 'mcp-audit.jsonl')
}

const defaultAuditLog: McpAuditLogDeps = {
  getPath: defaultAuditPath,
  appendFile: (path: string, line: string) => {
    try {
      appendFileSync(path, line, 'utf8')
    } catch {
      /* 日志写失败不能影响主流程 */
    }
  }
}

/**
 * 集成服务（设置页「集成」分区）：
 *
 * 1. 外部 Agent CLI 检测：探测本机 Codex / Claude Code（自定义路径优先，回退 PATH），
 *    供 KunYu 把任务派发给它们执行。
 * 2. MCP 桥接：KunYu 作为 MCP server（Streamable HTTP，仅 127.0.0.1），
 *    把 ToolRegistry 的全部可用工具暴露给外部 agent 连接当前项目。
 *
 * 授权模型（TR #4 组级授权）：
 * - read 组（检索查询类）直接放行；
 * - interact / admin 组执行前推送 integration:auth-request 事件给渲染层弹窗，
 *   挂起等待 respondAuth 决定；
 * - mcpAuthMode=session 时「本会话允许」记住同组工具不再询问；60s 无响应视为拒绝。
 */

/** 授权弹窗等待超时：超时视为拒绝 */
const AUTH_TIMEOUT_MS = 60_000

export interface ExternalAgentSpec {
  id: ExternalAgentInfo['id']
  name: string
  /** PATH 上的可执行名 */
  bin: string
  /** 设置里自定义路径字段 */
  configuredPath: (s: IntegrationSettings) => string
}

export const EXTERNAL_AGENTS: ExternalAgentSpec[] = [
  { id: 'codex', name: 'Codex CLI', bin: 'codex', configuredPath: (s) => s.codexPath },
  { id: 'claude-code', name: 'Claude Code', bin: 'claude', configuredPath: (s) => s.claudeCodePath }
]

interface PendingAuth {
  tool: string
  resolve: (decision: McpAuthDecision) => void
  timer: NodeJS.Timeout
}

export interface IntegrationServiceDeps {
  /** MCP 桥接要暴露的工具注册表（orchestrator.getRegistry） */
  getRegistry: () => ToolRegistry
  /** 推送授权请求到渲染层（webContents.send 封装；测试注入假实现） */
  sendAuthRequest: (req: McpAuthRequest) => void
  /** 读取集成设置（实时，pane 改端口/开关后下次启动生效） */
  settings: () => IntegrationSettings
  /** 当前项目执行上下文（loader/mcVersion）；无打开项目时返回 null → 写工具被拒绝 */
  projectContext: () => { loader: LoaderId; mcVersion: string } | null
  /** 命令执行 seam（测试注入假实现） */
  exec?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
  now?: () => Date
  /** 审计日志 seam（测试注入假实现；缺省走默认 userData 落盘） */
  auditLog?: McpAuditLogDeps
}

export interface IntegrationService {
  detectAgents(): Promise<ExternalAgentInfo[]>
  startBridge(): Promise<McpBridgeStatus>
  stopBridge(): Promise<McpBridgeStatus>
  getBridgeStatus(): McpBridgeStatus
  /** 渲染层授权决定回传（INTEGRATION_AUTH_RESPOND） */
  respondAuth(decision: McpAuthDecision): void
}

export function createIntegrationService(deps: IntegrationServiceDeps): IntegrationService {
  const now = deps.now ?? (() => new Date())
  const exec = deps.exec ?? defaultExec

  let httpServer: Server | null = null
  let startError: string | undefined
  /** P1-8：桥接令牌，每次 startBridge 重新生成；请求必须携带（头或查询参数） */
  let bridgeToken = ''
  /** 实际绑定端口（配置 0 = 随机空闲端口，listen 后回读真实值） */
  let boundPort = 0
  /** 挂起等待用户决定的授权请求 */
  const pending = new Map<string, PendingAuth>()
  /** mcpAuthMode=session 时「本会话允许」记住的组名（stop 时清空） */
  const sessionAllowedGroups = new Set<string>()

  // ------------------------------------------------------------------ 审计日志

  function audit(entry: {
    tool: string
    group: string
    argsSummary: string
    decision: 'allow' | 'deny'
    result: 'success' | 'error' | 'denied'
  }): void {
    appendMcpAudit(
      {
        ts: now().toISOString(),
        tool: entry.tool,
        group: entry.group,
        argsSummary: entry.argsSummary,
        decision: entry.decision,
        result: entry.result
      },
      deps.auditLog ?? defaultAuditLog
    )
  }

  // ------------------------------------------------------------------ CLI 检测

  async function detectOne(spec: ExternalAgentSpec): Promise<ExternalAgentInfo> {
    const configured = spec.configuredPath(deps.settings()).trim()
    const cmd = configured || spec.bin
    try {
      const { stdout, stderr } = await exec(cmd, ['--version'])
      const version = (stdout || stderr).trim().split(/\r?\n/)[0]?.slice(0, 100) ?? ''
      return { id: spec.id, name: spec.name, found: true, path: cmd, version }
    } catch (err) {
      return {
        id: spec.id,
        name: spec.name,
        found: false,
        path: cmd,
        version: '',
        error: configured
          ? `自定义路径无法执行：${(err as Error).message.slice(0, 120)}`
          : `未在 PATH 检测到 ${spec.bin}`
      }
    }
  }

  // ------------------------------------------------------------------ 授权门

  async function requestAuth(tool: string, args: Record<string, unknown>): Promise<void> {
    const group = getMcpToolPermission(tool)
    if (group === 'read') return
    const mode = deps.settings().mcpAuthMode
    const argsSummary = summarizeArgs(args)
    if (mode === 'session' && sessionAllowedGroups.has(group)) {
      // 本会话已授权同组：放行但按任务要求仍记录审计
      audit({ tool, group, argsSummary, decision: 'allow', result: 'success' })
      return
    }

    const requestId = randomUUID()
    const req: McpAuthRequest = { requestId, tool, group, argsSummary, at: now().toISOString() }

    const decision = await new Promise<McpAuthDecision>((resolvePromise) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        resolvePromise({ requestId, allow: false, rememberSession: false })
      }, AUTH_TIMEOUT_MS)
      pending.set(requestId, { tool, resolve: resolvePromise, timer })
      deps.sendAuthRequest(req)
    })

    if (!decision.allow) {
      audit({ tool, group, argsSummary, decision: 'deny', result: 'denied' })
      throw new Error(`用户拒绝授权外部 agent 调用「${tool}」（${group} 组）`)
    }
    if (decision.rememberSession && mode === 'session') sessionAllowedGroups.add(group)
    audit({ tool, group, argsSummary, decision: 'allow', result: 'success' })
  }

  function respondAuth(decision: McpAuthDecision): void {
    const entry = pending.get(decision.requestId)
    if (!entry) return
    pending.delete(decision.requestId)
    clearTimeout(entry.timer)
    entry.resolve(decision)
  }

  // ------------------------------------------------------------------ MCP server

  function buildMcpServer(): McpServer {
    const server = new McpServer(
      { name: 'kunyu-ecosystem', version: '1.0.0' },
      { capabilities: { tools: {} } }
    )

    server.setRequestHandler(ListToolsRequestSchema, () => {
      const defs = deps.getRegistry().getToolDefinitions()
      return {
        tools: defs.map((d) => ({
          name: d.function.name,
          description: d.function.description ?? '',
          inputSchema: (d.function.parameters as Record<string, unknown>) ?? {
            type: 'object',
            properties: {}
          }
        }))
      }
    })

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const name = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, unknown>
      const registry = deps.getRegistry()
      if (!registry.has(name)) {
        return { content: [{ type: 'text', text: `未知工具：${name}` }], isError: true }
      }
      const ctx = deps.projectContext()
      if (!ctx) {
        return {
          content: [{ type: 'text', text: 'KunYu 当前没有打开的项目，无法执行工具' }],
          isError: true
        }
      }
      try {
        await requestAuth(name, args)
      } catch (err) {
        return { content: [{ type: 'text', text: (err as Error).message }], isError: true }
      }
      try {
        const result = await registry.executeTool(name, args, ctx)
        return {
          content: [{ type: 'text', text: result.ok ? result.text : `错误：${result.error ?? '执行失败'}` }],
          isError: !result.ok
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `工具执行异常：${(err as Error).message}` }],
          isError: true
        }
      }
    })

    return server
  }

  /**
   * SDK 1.30 无状态模式强制「每请求一个新 transport」（复用会抛
   * "Stateless transport cannot be reused across requests"），
   * 因此每个 HTTP 请求新建 McpServer+transport 对，响应结束后关闭。
   * 跨请求状态（pending/sessionAllowedGroups）在闭包中，与 server 实例解耦。
   */
  async function serveOneRequest(req: IncomingMessage, res: ServerResponse, body?: unknown): Promise<void> {
    const server = buildMcpServer()
    const oneShot = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void oneShot.close().catch(() => {})
      void server.close().catch(() => {})
    })
    await server.connect(oneShot)
    await oneShot.handleRequest(req, res, body)
  }

  /**
   * 传输层安全门（P1-8）：
   * 1. Host 白名单：仅本机回环名（防 DNS rebinding —— 浏览器页把恶意域名解析到
   *    127.0.0.1 后，Host 头是攻击域名而非回环名，可据此拒绝）；
   * 2. Origin 白名单：CLI 客户端通常不带 Origin 直接放行；浏览器发起的跨源请求
   *    必须来自本端点自身（127.0.0.1/localhost + 实际端口），否则 403；
   * 3. 随机令牌：Authorization: Bearer / x-kunyu-token 头 / ?token= 查询参数
   *    三选一必须匹配，否则 401。返回 null 表示放行。
   */
  function secureCheck(req: IncomingMessage, url: URL): { status: number; error: string } | null {
    const host = (req.headers.host ?? '').toLowerCase()
    const hostName = host.split(':')[0]
    if (hostName !== '127.0.0.1' && hostName !== 'localhost' && hostName !== '[::1]') {
      return { status: 403, error: 'forbidden host' }
    }
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin.length > 0) {
      try {
        const o = new URL(origin)
        const ok =
          (o.hostname === '127.0.0.1' || o.hostname === 'localhost' || o.hostname === '[::1]') &&
          o.port === String(boundPort)
        if (!ok) return { status: 403, error: 'forbidden origin' }
      } catch {
        return { status: 403, error: 'forbidden origin' }
      }
    }
    const presented =
      req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7).trim()
        : typeof req.headers['x-kunyu-token'] === 'string'
          ? (req.headers['x-kunyu-token'] as string).trim()
          : (url.searchParams.get('token') ?? '').trim()
    if (!bridgeToken || presented !== bridgeToken) {
      return { status: 401, error: 'unauthorized: missing or invalid token' }
    }
    return null
  }

  /** 只接受 /mcp 路径；其余 404。POST 解析 JSON body 后交给 transport。 */
  function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    const denied = secureCheck(req, url)
    if (denied) {
      res.writeHead(denied.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: denied.error }))
      return
    }
    if (req.method === 'POST') {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        let body: unknown
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'invalid JSON' }))
          return
        }
        void serveOneRequest(req, res, body).catch(() => {
          if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
          if (!res.writableEnded) res.end(JSON.stringify({ error: 'internal error' }))
        })
      })
      return
    }
    // GET（SSE 流）/ DELETE 直接转交
    void serveOneRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
      if (!res.writableEnded) res.end(JSON.stringify({ error: 'internal error' }))
    })
  }

  async function startBridge(): Promise<McpBridgeStatus> {
    if (httpServer) return getBridgeStatus()
    startError = undefined
    // P1-8：令牌每次启动重新生成；配置端口 0 = 由 OS 分配随机空闲端口
    bridgeToken = randomBytes(24).toString('base64url')
    const configuredPort = deps.settings().mcpBridgePort
    const port = configuredPort > 0 ? configuredPort : 0
    try {
      httpServer = createServer(handleHttp)
      await new Promise<void>((resolveListen, rejectListen) => {
        httpServer!.once('error', rejectListen)
        // 安全约束：仅监听本机回环，外部网卡不可达
        httpServer!.listen(port, '127.0.0.1', () => {
          const addr = httpServer!.address()
          boundPort = typeof addr === 'object' && addr ? addr.port : port
          resolveListen()
        })
      })
    } catch (err) {
      startError = (err as Error).message
      await closeServer()
    }
    return getBridgeStatus()
  }

  async function closeServer(): Promise<void> {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.resolve({ requestId: '', allow: false, rememberSession: false })
    }
    pending.clear()
    sessionAllowedGroups.clear()
    if (httpServer) {
      const srv = httpServer
      httpServer = null
      await new Promise<void>((resolveClose) => srv.close(() => resolveClose()))
    }
  }

  async function stopBridge(): Promise<McpBridgeStatus> {
    await closeServer()
    return getBridgeStatus()
  }

  function getBridgeStatus(): McpBridgeStatus {
    const addr = httpServer?.address()
    const port = typeof addr === 'object' && addr ? addr.port : deps.settings().mcpBridgePort
    let toolCount = 0
    try {
      toolCount = httpServer ? deps.getRegistry().getToolDefinitions().length : 0
    } catch {
      /* registry 未就绪 */
    }
    return {
      running: httpServer !== null,
      port,
      toolCount,
      pendingAuth: pending.size,
      endpoint: `http://127.0.0.1:${port}/mcp`,
      token: httpServer ? bridgeToken : undefined,
      error: startError
    }
  }

  return {
    detectAgents: () => Promise.all(EXTERNAL_AGENTS.map(detectOne)),
    startBridge,
    stopBridge,
    getBridgeStatus,
    respondAuth
  }
}

/** 默认命令执行：Windows 经 cmd /c 解析 .cmd 垫片（npm 全局安装的 CLI 多为 .cmd） */
async function defaultExec(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  if (process.platform === 'win32') {
    // S-01：cmd /c 下二次解析，拒绝 cmd 元字符（& | ^ % 等），防命令注入。
    assertCmdSafe('外部代理命令', cmd)
    for (const a of args) assertCmdSafe('外部代理参数', a)
    return execFileAsync('cmd', ['/c', cmd, ...args], { timeout: 8000, windowsHide: true })
  }
  return execFileAsync(cmd, args, { timeout: 8000 })
}

/** 参数摘要：弹窗展示用，值截断 80 字符、整体截断 400 字符 */
function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).map(([k, v]) => {
    const raw = typeof v === 'string' ? v : JSON.stringify(v)
    const clipped = raw.length > 80 ? `${raw.slice(0, 80)}…` : raw
    return `${k}: ${clipped}`
  })
  const joined = entries.join('\n')
  return joined.length > 400 ? `${joined.slice(0, 400)}…` : joined
}

// ---------------------------------------------------------------------- 单例

let instance: IntegrationService | null = null

export function initIntegrationService(deps: IntegrationServiceDeps): IntegrationService {
  if (!instance) instance = createIntegrationService(deps)
  return instance
}

export function getIntegrationService(): IntegrationService | null {
  return instance
}

/** 测试用：重置单例 */
export function resetIntegrationServiceForTest(): void {
  instance = null
}
