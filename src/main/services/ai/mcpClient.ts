import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, join, sep } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpStatus, McpStatusKind } from '../../../shared/types/monitor'
import type { McpCategory, McpPermission } from '../../../shared/types/settings'
import { applyToolFilter, isToolAllowed, type McpToolFilter } from '../../../shared/mcpToolFilter'
import { enrichBlockbenchEnv } from './blockbenchToken'
import { buildSandboxEnv } from './mcpSandbox'
import { assertCmdSafe } from '../../utils/cmdSafe'

/**
 * mcdev-mcp 静态层 MCP 客户端（FR-11/FR-12，NFR-1 安全约束）。
 *
 * 内置化：
 * - mcdev-mcp 已作为生产依赖随应用安装，用户无需自行 npm/npx 安装；
 * - 用 Electron 自带的 Node（process.execPath + ELECTRON_RUN_AS_NODE=1）
 *   经 resources/mcdev-runner.mjs 启动器执行包内 dist/cli.js（修正 commander 在
 *   ELECTRON_RUN_AS_NODE 下的 Electron argv 误切片），不依赖系统 Node.js / npx；
 * - 启用开关后若 1.20.1 索引不存在，自动后台执行
 *   `cli.js init -v 1.20.1 --skip-callgraph`（约 2GB，仅一次），
 *   进度实时进入 McpStatus.detail，完成后自动 serve 连接；
 * - 仅暴露 8 个只读静态工具，运行时工具走 kunyu-observer 探针通道，不在此白名单；
 * - 一切不可用都软失败（ok:false 让上层回退参考包），不阻塞对话。
 */

/** mcdev-mcp 暴露的 8 个只读静态工具（官方 README 2.2.1） */
export const READONLY_STATIC_TOOLS = [
  'mc_search',
  'mc_get_class',
  'mc_get_method',
  'mc_list_classes',
  'mc_list_packages',
  'mc_find_hierarchy',
  'mc_find_refs',
  'mc_version'
] as const

export type ReadonlyStaticTool = (typeof READONLY_STATIC_TOOLS)[number]

const INIT_VERSION = '1.20.1'
/** 手动兜底引导命令（自动初始化失败时展示） */
const INIT_COMMAND = `npx mcdev-mcp init -v ${INIT_VERSION}`
const PACKAGE_CLI_ENTRY = 'mcdev-mcp/dist/cli.js'
/** 握手窗口：索引就绪后仅启动 stdio 服务，给 30s */
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000

export interface McpQueryResult {
  ok: boolean
  /** content 文本拼接（供 Retriever 注入上下文） */
  text: string
  error?: string
}

export interface McpClient {
  getStatus(): McpStatus
  isEnabled(): boolean
  /**
   * 启用并后台初始化/连接（自动初始化约 2GB，可能耗时很久）。
   * 立即返回当前状态（initializing/connecting）；需要等待可用 whenIdle()。
   */
  enable(): Promise<McpStatus>
  /** 禁用：断开服务、中止初始化子进程 */
  disable(): Promise<void>
  /** 等待后台初始化/连接流水线结束 */
  whenIdle(): Promise<McpStatus>
  /** 重新检测环境并在启用状态下重连 */
  refresh(): Promise<McpStatus>
  /** 调用只读静态工具；工具不在线/未初始化/被拒时返回 ok:false（不抛错，供回退参考包） */
  callStaticTool(
    name: ReadonlyStaticTool,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<McpQueryResult>
}

interface Deps {
  /** serve 启动命令（测试注入假 stdio server）；生产为 Electron 可执行文件 */
  command?: string
  /** serve 参数；生产为 [runnerPath, 'serve'] */
  args?: string[]
  /** init 参数；生产为 [runnerPath, 'init', '-v', '1.20.1', '--skip-callgraph'] */
  initArgs?: string[]
  /** mcdev-runner.mjs 启动器路径（测试 seam；生产自动解析 resources/ 下文件） */
  runnerPath?: string
  /**
   * 环境检测（测试 seam）。生产使用内置 Node 不需要系统 Node，
   * 仅测试注入时用于 node-missing 分级。
   */
  detect?: () => Promise<{ node: boolean; npx: boolean }>
  /** 1.20.1 索引探测目录（测试用） */
  cacheDir?: string
  /** 索引缺失时是否自动初始化（生产默认 true） */
  autoInit?: boolean
  /** 为子进程提供 JDK（init 需要 java 在 PATH 上） */
  javaHome?: () => string | undefined
  connectTimeoutMs?: number
  now?: () => Date
}

interface Runtime {
  client: Client
  transport: StdioClientTransport
  /** 服务端实际声明的工具（含非白名单，仅展示用） */
  serverTools: string[]
}

function status(
  kind: McpStatusKind,
  detail: string,
  tools: string[] = [],
  now: () => Date
): McpStatus {
  return { kind, tools, detail, initCommand: INIT_COMMAND, at: now().toISOString() }
}

/** 解析内置 mcdev-mcp 的 CLI 入口；打包后改用 app.asar.unpacked 实体文件 */
function resolveBundledCliPath(): string {
  const requireFromHere = createRequire(import.meta.url)
  let resolved = PACKAGE_CLI_ENTRY
  try {
    resolved = requireFromHere.resolve(PACKAGE_CLI_ENTRY)
  } catch {
    /* 保留裸入口，交由 spawn 报错分级 */
  }
  return resolved.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
}

/**
 * 解析 mcdev-runner.mjs 启动器路径：
 * - 打包态：process.resourcesPath/mcdev-runner.mjs（extraResources 分发）；
 * - 开发态：<项目根>/resources/mcdev-runner.mjs（electron-vite dev 的 cwd 即项目根）。
 * 启动器负责修正 ELECTRON_RUN_AS_NODE 下 commander 误走 Electron argv 切片的问题。
 */
function resolveRunnerPath(override?: string): string {
  if (override) return override
  const packaged = process.resourcesPath
    ? join(process.resourcesPath, 'mcdev-runner.mjs')
    : ''
  if (packaged && existsSync(packaged)) return packaged
  return join(process.cwd(), 'resources', 'mcdev-runner.mjs')
}

export function createMcpClient(deps: Deps = {}): McpClient {
  const now = deps.now ?? (() => new Date())
  const cliPath = resolveBundledCliPath()
  const runnerPath = resolveRunnerPath(deps.runnerPath)
  const command = deps.command ?? process.execPath
  const args = deps.args ?? [runnerPath, 'serve']
  const initArgs = deps.initArgs ?? [runnerPath, 'init', '-v', INIT_VERSION, '--skip-callgraph']
  const autoInit = deps.autoInit ?? true
  const connectTimeoutMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  const cacheDir =
    deps.cacheDir ?? join(process.env['LOCALAPPDATA'] ?? '', 'mcdev-mcp', 'Cache')

  let enabled = false
  /** 后台初始化+连接流水线（enable 不阻塞调用方） */
  let pipeline: Promise<McpStatus> | null = null
  let initProc: ChildProcess | null = null
  let runtime: Runtime | null = null
  let intentionalClose = false
  let lastStatus = status('disabled', 'mcdev-mcp 未启用', [], now)

  function setStatus(kind: McpStatusKind, detail: string, tools: string[] = []): McpStatus {
    lastStatus = status(kind, detail, tools, now)
    return lastStatus
  }

  /** 子进程环境：完整用户环境 + Electron 内置 Node 模式 + 配置 JDK 入 PATH */
  function buildEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v
    }
    env['ELECTRON_RUN_AS_NODE'] = '1'
    // 启动器据此动态 import 真正的 CLI（见 resources/mcdev-runner.mjs）
    env['MCDEV_CLI_ENTRY'] = cliPath
    const home = deps.javaHome ? deps.javaHome() : undefined
    if (home) {
      const bin = join(home, 'bin')
      // Windows 下环境块大小写不敏感，只写已有的键（Path/PATH 原样取），
      // 双写会在部分进程链生成大小写重复的坏 env 块导致 spawn ENOENT
      const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH'
      env[pathKey] = `${bin}${delimiter}${env[pathKey] ?? ''}`
      env['JAVA_HOME'] = home
    }
    return env
  }

  const detectEnv = deps.detect ?? null

  function isIndexInitialized(): boolean {
    // 官方布局：<cache>/index/1.20.1/manifest.json
    return existsSync(join(cacheDir, 'index', INIT_VERSION, 'manifest.json'))
  }

  async function teardownRuntime(): Promise<void> {
    const rt = runtime
    runtime = null
    if (!rt) return
    try {
      await rt.client.close()
    } catch {
      /* 忽略关闭异常 */
    }
    try {
      await rt.transport.close()
    } catch {
      /* transport.close 会终止 spawn 出的子进程 */
    }
  }

  /** Windows 下连孙进程（init 会派生 java）一起结束 */
  function killInitProcess(): void {
    const child = initProc
    initProc = null
    if (!child || child.killed || child.pid === undefined) return
    if (process.platform === 'win32') {
      execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {
        /* 进程可能已退出，忽略 */
      })
    } else {
      child.kill('SIGTERM')
    }
  }

  /**
   * 自动初始化：用内置 Node 执行 cli.js init（约 2GB），
   * stdout/stderr 最新一行实时进入状态文案。
   */
  function runInitializer(): Promise<boolean> {
    return new Promise((resolve) => {
      let child: ChildProcess
      try {
        child = spawn(command, initArgs, {
          env: buildEnv(),
          windowsHide: true
        })
      } catch (err) {
        setStatus('error', `无法启动内置初始化进程：${(err as Error).message}`)
        resolve(false)
        return
      }
      initProc = child
      let tail = ''
      const onData = (chunk: Buffer): void => {
        tail += chunk.toString('utf8')
        const lines = tail.split(/\r?\n/)
        tail = lines.pop() ?? ''
        for (const raw of lines) {
          const line = raw.trim()
          if (!line) continue
          setStatus(
            'initializing',
            `内置索引初始化中：${line.slice(0, 150)}（首次约 2GB，仅一次，完成后自动连接）`
          )
        }
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      child.on('error', (err) => {
        initProc = null
        setStatus(
          'error',
          `内置初始化进程启动失败：${err.message}。也可手动在终端执行 ${INIT_COMMAND} 后重试。`
        )
        resolve(false)
      })
      child.on('close', (code) => {
        initProc = null
        if (code === 0) resolve(true)
        else {
          setStatus(
            'error',
            `内置索引初始化失败（退出码 ${code ?? 'null'}，需要 Java 17+ 与网络连接）。` +
              `可手动在终端执行 ${INIT_COMMAND} 后点「重新检测」。`
          )
          resolve(false)
        }
      })
    })
  }

  async function connect(): Promise<McpStatus> {
    setStatus('connecting', '正在启动并连接内置 mcdev-mcp 服务…')
    intentionalClose = false

    const client = new Client(
      { name: 'kunyu-ecosystem', version: '1.0.0' },
      { capabilities: {} }
    )
    const transport = new StdioClientTransport({
      command,
      args,
      // 完整用户环境（含 ELECTRON_RUN_AS_NODE 与 JDK PATH）
      env: buildEnv(),
      // 子进程 stderr 仅供 SDK 内部日志，不污染本应用
      stderr: 'ignore'
    })
    transport.onclose = () => {
      // 服务进程退出：非主动关闭时降级 error（软失败，不影响应用其余能力）
      if (!intentionalClose) {
        runtime = null
        setStatus('error', 'mcdev-mcp 服务进程意外退出，可在设置中重新检测')
      }
    }
    transport.onerror = (err: Error) => {
      if (!intentionalClose) {
        runtime = null
        setStatus('error', `mcdev-mcp 连接错误：${err.message}`)
      }
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`MCP 握手超时（${connectTimeoutMs}ms）`)), connectTimeoutMs)
    })

    try {
      await Promise.race([client.connect(transport), timeout])
    } catch (err) {
      await teardownRuntime()
      const msg = (err as Error).message
      const packageFetch =
        /ENOENT|cannot find module|npm error|could not determine executable|404 Not Found|ENOTFOUND|ECONNRESET|ECONNREFUSED|fetch failed/i.test(
          msg
        )
      if (packageFetch) {
        return setStatus(
          'package-unavailable',
          '内置 mcdev-mcp 启动失败（文件缺失或被安全软件拦截），请重装应用或检查网络后重试。'
        )
      }
      return setStatus('error', `无法连接 mcdev-mcp：${msg}`)
    } finally {
      // race 结束（成功/失败）都清理定时器，避免句柄残留
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
    }

    let serverTools: string[] = []
    try {
      const listed = await client.listTools()
      serverTools = listed.tools.map((t) => t.name)
    } catch {
      await teardownRuntime()
      return setStatus('error', 'mcdev-mcp 已握手但工具发现失败')
    }

    runtime = { client, transport, serverTools }
    const exposed = serverTools.filter((n) =>
      (READONLY_STATIC_TOOLS as readonly string[]).includes(n)
    )

    if (!isIndexInitialized()) {
      // 自动初始化关闭（测试）或初始化后索引仍缺失：分级提示
      return setStatus(
        'not-initialized',
        'mcdev-mcp 已连接，但 1.20.1 源码索引尚未初始化（约 2GB）。请重新打开开关由应用自动初始化。',
        exposed
      )
    }
    return setStatus(
      'ready',
      `mcdev-mcp 就绪：${exposed.length} 个只读静态工具可用，1.20.1 索引已初始化。`,
      exposed
    )
  }

  /** 初始化（按需）→ serve 连接的后台流水线 */
  async function runPipeline(): Promise<McpStatus> {
    try {
      // 测试 seam：注入 detect 时保留系统 Node 缺失分级；生产走内置 Node 无需检测
      if (detectEnv) {
        const env = await detectEnv()
        if (!env.node || !env.npx) {
          return setStatus(
            'node-missing',
            '未检测到 Node.js / npx。mcdev-mcp 依赖本机 Node.js 18+，请安装后重启应用再启用。'
          )
        }
      }

      if (autoInit && !isIndexInitialized()) {
        setStatus(
          'initializing',
          '正在内置初始化 mcdev-mcp 1.20.1 索引（首次约 2GB：下载/反编译/建索引），完成后自动连接…'
        )
        const ok = await runInitializer()
        if (!enabled) return lastStatus // 初始化期间被用户关闭
        if (!ok) return lastStatus
      }

      return await connect()
    } catch (err) {
      return setStatus('error', `mcdev-mcp 流水线异常：${(err as Error).message}`)
    }
  }

  return {
    getStatus() {
      return lastStatus
    },
    isEnabled() {
      return enabled
    },
    async enable() {
      enabled = true
      if (runtime) return lastStatus
      if (pipeline) return lastStatus
      const needInit = autoInit && !isIndexInitialized()
      setStatus(
        needInit ? 'initializing' : 'connecting',
        needInit
          ? '正在内置初始化 mcdev-mcp 1.20.1 索引（首次约 2GB），完成后自动连接…'
          : '正在启动并连接内置 mcdev-mcp 服务…'
      )
      pipeline = runPipeline().finally(() => {
        pipeline = null
      })
      // 不阻塞调用方（初始化可能很久）；需要等待用 whenIdle()
      return lastStatus
    },
    whenIdle() {
      return pipeline ?? Promise.resolve(lastStatus)
    },
    async disable() {
      enabled = false
      intentionalClose = true
      killInitProcess()
      await teardownRuntime()
      // 流水线在 enable() 重新置位前通过 enabled 检查自行退出
      setStatus('disabled', 'mcdev-mcp 已禁用')
    },
    async refresh() {
      if (!enabled) return lastStatus
      intentionalClose = true
      killInitProcess()
      await teardownRuntime()
      return this.enable()
    },
    async callStaticTool(name, args, signal) {
      // 白名单硬约束：即使服务端声明了危险工具也不可调用
      if (!(READONLY_STATIC_TOOLS as readonly string[]).includes(name)) {
        return { ok: false, text: '', error: `工具 ${name} 不在只读白名单内` }
      }
      if (!enabled || !runtime) {
        return { ok: false, text: '', error: `mcdev-mcp 不可用：${lastStatus.detail}` }
      }
      try {
        const result = await runtime.client.callTool({ name, arguments: args }, undefined, {
          signal
        })
        const text = (result.content as Array<{ type: string; text?: string }> | undefined)
          ?.filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text as string)
          .join('\n')
        if (result.isError) {
          return { ok: false, text: text ?? '', error: 'mcdev-mcp 工具返回错误（详见文本）' }
        }
        return { ok: true, text: text ?? '' }
      } catch (err) {
        return { ok: false, text: '', error: `mcdev-mcp 调用失败：${(err as Error).message}` }
      }
    }
  }
}

/* ------------------------------ Electron 单例 ------------------------------ */

let singleton: McpClient | null = null

/**
 * 初始化单例。javaHome 由 bootstrap/orchestrator 从设置注入
 * （init 反编译需要 JDK 在 PATH 上），本模块不静态依赖 settingsService，
 * 以便验证脚本以纯 Node 打包注入测试。
 */
export function initMcpClient(deps?: Pick<Deps, 'javaHome'>): McpClient {
  if (singleton) return singleton
  singleton = createMcpClient(deps ?? {})
  return singleton
}

export function getMcpClient(): McpClient | null {
  return singleton
}

/* ------------------------------ 自定义 server 测试 ------------------------------ */

/**
 * 短连接测试任意 stdio MCP server。
 * 10s 内完成握手 + listTools 后立即关闭子进程，返回 ok/tools/error。
 * 与内置 mcdev-mcp 互不影响。
 */
export async function testCustomMcpServer(cfg: {
  command: string
  args: string[]
  env: Record<string, string>
  timeoutMs: number
  cwd?: string | null
}): Promise<{ ok: boolean; tools: string[]; error?: string }> {
  const timeoutMs = Math.min(120_000, Math.max(5_000, cfg.timeoutMs))
  // blockbench-mcp 网关：自动发现并注入 Blockbench 本地 token（用户手填优先）
  const { env: enrichedEnv } = enrichBlockbenchEnv(cfg.command, cfg.args, cfg.env)
  // 与持久连接同一沙箱边界：cwd 项目目录 + env 最小化
  const cwd = cfg.cwd || process.cwd()
  const env: Record<string, string> = buildSandboxEnv(enrichedEnv, cwd)

  /** 单次握手+列工具；失败时回传 rawError/stderr 供重试与提示拼装 */
  const attempt = async (
    command: string,
    args: string[]
  ): Promise<{ ok: boolean; tools: string[]; rawError: string; stderr: string }> => {
    const client = new Client({ name: 'kunyu-ecosystem-test', version: '1.0.0' }, { capabilities: {} })
    // Windows 裸命令（npx 等 .cmd 垫片）经 cmd /c 拉起，避免 ENOENT
      const spawnCmd = resolveStdioSpawn(command, args)
      // 劫持重写时 command=Electron 可执行文件，必须以纯 node 模式启动，否则会拉起应用窗口
      const spawnEnv = command === process.execPath
        ? { ...env, ELECTRON_RUN_AS_NODE: '1' }
        : env
      const transport = new StdioClientTransport({
        command: spawnCmd.command,
        args: spawnCmd.args,
        env: spawnEnv,
        cwd,
        stderr: 'pipe'
      })
    let stderrTail = ''
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000)
    })
    transport.onclose = () => { /* 忽略 */ }
    transport.onerror = () => { /* 忽略，在下方 catch 中统一处理 */ }
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`握手超时（${timeoutMs}ms）`)), timeoutMs)
    )
    try {
      await Promise.race([client.connect(transport), timeout])
      let tools: string[] = []
      try {
        const listed = await client.listTools()
        tools = listed.tools.map((t) => t.name)
      } catch (err) {
        await client.close().catch(() => {})
        await transport.close().catch(() => {})
        return { ok: false, tools: [], rawError: (err as Error).message, stderr: stderrTail }
      }
      await client.close().catch(() => {})
      await transport.close().catch(() => {})
      return { ok: true, tools, rawError: '', stderr: stderrTail }
    } catch (err) {
      await transport.close().catch(() => {})
      return { ok: false, tools: [], rawError: (err as Error).message, stderr: stderrTail }
    }
  }

  // win32：入口缺 shebang 的包其 .cmd 垫片必被 .js 文件关联劫持（弹编辑器加载入口），
  // 缓存就绪时首发即走 node+绝对路径；缓存未就绪先静默预取拉包，做到首次连接也不弹
  const preempt = await ensureNoPopNodeLaunch(cfg.command, cfg.args)
  let res = await attempt(preempt?.command ?? cfg.command, preempt?.args ?? cfg.args)
  if (res.ok) return { ok: true, tools: res.tools }

  // 主动劫持修复：npx 包缺 shebang 时，定位 npx 缓存中的 bin 入口，改用 node+绝对路径重试一次
  const rewrite = preempt ? null : resolveNpxEntryRewrite(cfg.command, cfg.args)
  if (rewrite) {
    const retry = await attempt(rewrite.command, rewrite.args)
    if (retry.ok) return { ok: true, tools: retry.tools }
    res = retry // 重试仍失败，沿用重试错误拼装提示
  }

  const stderrPart = res.stderr.trim() ? ` | stderr: ${res.stderr.trim().slice(-300)}` : ''
  const hijack = win32NpxHijackHint(cfg.command, cfg.args, res.rawError)
  const hint = (/ENOENT|cannot find|spawn/i.test(res.rawError)
    ? `可执行文件启动失败（${cfg.command || '未指定'}），检查路径或改用 "npx" 作为 command${stderrPart}`
    : `${res.rawError}${stderrPart}`) + (hijack ? `。${hijack}` : '')
  return { ok: false, tools: [], error: hint }
}

/* ------------------------------ 自定义 MCP 持久连接管理器 ------------------------------ */

/** 工具 schema 缓存项：含 name/description/inputSchema，供 ToolRegistry 注册 */
export interface CustomMcpToolSchema {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** 自定义 server 运行时状态（返回给渲染层展示用） */
export interface CustomMcpRuntime {
  id: string
  name: string
  enabled: boolean
  status: 'connecting' | 'ready' | 'disconnected' | 'error'
  tools: string[]
  error?: string
  /** 能力分类；旧数据未持久化时默认 'general' */
  category: McpCategory
  /** 权限分级；旧数据未持久化时默认 'read' */
  permission: McpPermission
}

/** 自定义 MCP server 持久运行时 */
interface CustomRuntime {
  client: Client
  transport: StdioClientTransport
  /** 仅工具名列表（给渲染层展示与 listAllTools 兼容） */
  tools: string[]
  /** 完整工具 schema 缓存（给 ToolRegistry 注册用） */
  toolSchemas: CustomMcpToolSchema[]
  status: 'connecting' | 'ready' | 'disconnected' | 'error'
  error?: string
  category: McpCategory
  permission: McpPermission
  /** 本次连接实际使用的启动签名（command/args/env），用于检测配置变化后重连 */
  sig?: string
  /** 连续失败计数（≥2 时熔断为 disabled，保留手动重试入口） */
  failCount?: number
}

/** 连续失败熔断阈值：达到后不再自动重连 */
const FAIL_CIRCUIT_THRESHOLD = 2

/** syncFromSettings 输入类型（与 CustomMcpServer 字段对齐，主进程从 settings 注入） */
export interface CustomMcpServerConfig {
  id: string
  name: string
  transport: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  timeoutMs: number
  enabled: boolean
  category: McpCategory
  permission: McpPermission
  /** 工具级过滤；缺省/undefined 表示全部允许 */
  toolFilter?: McpToolFilter
  /** 沙箱工作目录（主进程解析：有项目=项目根，无项目=userData/mcp-sandbox） */
  cwd?: string | null
}

/** 启动签名：占位符替换后的 command+args+env+cwd 一致才视为同一次连接 */
function serverSig(server: CustomMcpServerConfig): string {
  return JSON.stringify({ c: server.command, a: server.args, e: server.env, w: server.cwd ?? null })
}

/**
 * Windows spawn 兼容：npx/npm/pnpm/uvx 等 npm 全局 CLI 在 Windows 上是 .cmd 垫片，
 * Node spawn(shell:false) 直接报 ENOENT（表象即 MCP error -32000: Connection closed）。
 * 规则：win32 且命令为裸名（无路径分隔符、非 .exe）→ 经 cmd /c 拉起。
 * 绝对路径 .exe（如 Electron 内置 Node）不受影响。
 * 注意：cmd /c 下含空格的参数（如带空格的项目路径 __PROJECT_ROOT__）必须显式加双引号。
 */
export function resolveStdioSpawn(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command, args }
  const isBareName = !command.includes('/') && !command.includes('\\')
  const isExe = command.toLowerCase().endsWith('.exe')
  if (isBareName && !isExe) {
    // 走 cmd /c 分支，command 与每个 arg 都经 cmd.exe 二次解析，
    // 含 & | ^ % 等元字符会导致命令注入。拒绝而非转义（转义边界多、易遗漏）。
    assertCmdSafe('MCP 命令', command)
    for (const a of args) assertCmdSafe('MCP 参数', a)
    return {
      command: 'cmd',
      args: ['/c', command, ...args.map((a) => (a.includes(' ') ? `"${a}"` : a))]
    }
  }
  return { command, args }
}

/**
 * Windows 已知劫持护栏：包入口 dist/index.js 缺少 `#!/usr/bin/env node` shebang 时，
 * npm 生成的 .cmd 垫片不含 node 前缀，cmd 会按 .js 文件关联执行该文件
 * （本机若把 .js 关联到 VS Code，表现为反复弹出编辑器加载 index.js），服务器进程从未启动，
 * 表象即「握手超时 + 无 stderr」。修复：command 改 "node"、args 改该包 dist/index.js 绝对路径。
 */
export function win32NpxHijackHint(command: string, args: string[], errMessage: string): string {
  if (process.platform !== 'win32') return ''
  if (!/^(npx|pnpm dlx|bunx?|npm exec)$/i.test(command.trim())) return ''
  // Connection closed：垫片劫持时 VS Code 等编辑器秒开秒退，子进程即刻退出，同样是无 stderr 的典型表象
  if (!/握手超时|ETIMEDOUT|timeout|Connection closed/i.test(errMessage || '')) return ''
  const pkg = args.find((a) => a && !a.startsWith('-')) ?? ''
  return (
    `提示：若连接期间弹出了 VS Code/编辑器窗口加载某个 index.js，说明该 npm 包入口缺少 ` +
    `node shebang，Windows 下被 .js 文件关联劫持（服务器从未启动）。修复：command 改为 "node"，` +
    `args 改为该包 dist/index.js 的绝对路径` +
    (pkg ? `（npx 缓存路径形如 %LOCALAPPDATA%\\npm-cache\\_npx\\<hash>\\node_modules\\${pkg}\\dist\\index.js）` : '')
  )
}

/**
 * Windows npx 劫持主动修复：部分 npm 包的 bin 入口缺少 `#!/usr/bin/env node` shebang，
 * 导致 npm 生成的 .cmd 垫片不含 node 前缀，cmd 会按 .js 文件关联执行该入口
 * （本机若把 .js 关联到 VS Code，表现为反复弹编辑器加载 index.js，MCP 服务器从未启动）。
 *
 * 策略：npx 首次拉包虽因垫片损坏启动失败，但包已被下载到 _npx 缓存。这里在缓存中定位
 * 包的 bin 入口，改用 Electron 内置 node + 绝对路径直接启动，绕过损坏的 .cmd 垫片。
 * 仅处理 npx（插件市场主流 runtime）；pnpm dlx / bunx 缓存结构不同，仍走提示回退。
 * 返回 null 表示无法重写，调用方回退到 win32NpxHijackHint 文案。
 */
export function resolveNpxEntryRewrite(
  command: string,
  args: string[]
): { command: string; args: string[] } | null {
  if (process.platform !== 'win32') return null
  const cmd = command.trim().toLowerCase()
  // 兼容 "npx" 与 "npm exec"（后者首参为 exec）
  const isNpx = cmd === 'npx'
  const isNpmExec = cmd === 'npm' && args[0] === 'exec'
  if (!isNpx && !isNpmExec) return null
  const parsed = parseNpxCommand(isNpx ? args : args.slice(1))
  if (!parsed) return null
  const entry = resolveCachedPackageEntry(parsed.pkg)
  if (!entry) return null
  return {
    command: process.execPath,
    args: [entry, ...parsed.pkgArgs]
  }
}

/** 解析 npx 参数：跳过 npx 自身标志位（-y/--yes/-p/--package），取首个非标志位为包名，余下为包参数 */
function parseNpxCommand(args: string[]): { pkg: string; pkgArgs: string[] } | null {
  let i = 0
  while (i < args.length) {
    const a = args[i]
    if (a === '-y' || a === '--yes') { i++; continue }
    // -p / --package 后跟一个值，属于 npx 配置而非包名
    if (a === '-p' || a === '--package') { i += 2; continue }
    if (a.startsWith('--package=')) { i++; continue }
    if (a.startsWith('-')) { i++; continue }
    return { pkg: stripSpecVersion(a), pkgArgs: args.slice(i + 1) }
  }
  return null
}

/**
 * 剥掉 npm spec 的版本/标签后缀：`pkg@latest`→`pkg`、`@scope/pkg@1.2.3`→`@scope/pkg`。
 * npx 缓存目录按裸包名存放（_npx/<hash>/node_modules/<pkg>），带后缀查找必然落空，
 * 导致垫片劫持主动修复静默失效（实测 minecraft-mojang-mcp@latest 即踩中）。
 */
function stripSpecVersion(spec: string): string {
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/')
    const at = slash < 0 ? -1 : spec.indexOf('@', slash)
    return at < 0 ? spec : spec.slice(0, at)
  }
  const at = spec.indexOf('@')
  return at <= 0 ? spec : spec.slice(0, at)
}

/** 在 npx 缓存中查找包并解析其 bin 入口绝对路径（找不到返回 null） */
function resolveCachedPackageEntry(pkg: string): string | null {
  const cacheRoot = join(process.env['LOCALAPPDATA'] ?? '', 'npm-cache', '_npx')
  if (!existsSync(cacheRoot)) return null
  let hashDirs: string[] = []
  try {
    hashDirs = readdirSync(cacheRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return null
  }
  // scoped 包取末段（unscoped）作为 bin 名候选
  const binName = pkg.startsWith('@') ? (pkg.split('/').pop() ?? pkg) : pkg
  for (const hash of hashDirs) {
    const pkgDir = join(cacheRoot, hash, 'node_modules', pkg)
    const pjPath = join(pkgDir, 'package.json')
    if (!existsSync(pjPath)) continue
    try {
      const pj = JSON.parse(readFileSync(pjPath, 'utf8')) as {
        bin?: string | Record<string, string>
        main?: string
      }
      let binRel = ''
      if (typeof pj.bin === 'string') binRel = pj.bin
      else if (pj.bin && typeof pj.bin === 'object') {
        binRel = pj.bin[binName] ?? pj.bin[pkg] ?? (Object.values(pj.bin)[0] as string)
      }
      if (!binRel) binRel = pj.main ?? ''
      if (!binRel) continue
      const entry = join(pkgDir, binRel)
      if (existsSync(entry)) return entry
    } catch {
      /* 尝试下一个 hash 目录 */
    }
  }
  return null
}

/**
 * Windows 预防性直启：npx 包 bin 入口缺 shebang 时，.cmd 垫片会被 .js 文件关联劫持
 * （弹 VS Code/编辑器加载入口文件，服务器从未启动）。事后 resolveNpxEntryRewrite 重试
 * 虽能连上，但每次连接都先弹一次编辑器。缓存已就绪且入口缺 shebang 时，首发即走
 * node+绝对路径绕开垫片。入口带 shebang 的健康包不受影响（保留 npx 语义与 @latest 更新）。
 */
export function resolvePreemptiveNodeLaunch(
  command: string,
  args: string[]
): { command: string; args: string[] } | null {
  if (process.platform !== 'win32') return null
  const rewrite = resolveNpxEntryRewrite(command, args)
  if (!rewrite) return null
  return entryLacksShebang(rewrite.args[0]) ? rewrite : null
}

/** 读入口文件前两字节判断是否缺 #! shebang（读失败按不缺处理，不干预原链路） */
function entryLacksShebang(entry: string): boolean {
  try {
    const fd = openSync(entry, 'r')
    try {
      const buf = Buffer.alloc(2)
      const n = readSync(fd, buf, 0, 2, 0)
      return n < 2 || buf.toString('utf8', 0, n) !== '#!'
    } finally {
      closeSync(fd)
    }
  } catch {
    return false
  }
}

/** 提取 npx 命令行中的原始包 spec（保留 @version 后缀，供 npm exec 预取拉包） */
function parseNpxRawSpec(args: string[]): string | null {
  let i = 0
  while (i < args.length) {
    const a = args[i]
    if (a === '-y' || a === '--yes') { i++; continue }
    // -p/--package 的值才是要下载的包（其后跟随的是 bin 名与包参数）
    if (a === '-p' || a === '--package') { return args[i + 1] ?? null }
    if (a.startsWith('--package=')) { return a.slice('--package='.length) || null }
    if (a.startsWith('-')) { i++; continue }
    return a
  }
  return null
}

/**
 * win32 零弹窗直启（含预取）：resolvePreemptiveNodeLaunch 要求包已在 npx 缓存；
 * 新包首次连接时缓存未就绪，若直接走 npx 首发，缺 shebang 的包会被 .js 文件关联
 * 劫持弹一次编辑器。这里先用 `npm exec -- <noop>` 静默拉包（只下载、不执行 bin，
 * 垫片不会被触发），再重试预防性直启，做到首次连接也不弹窗。
 * 拉包失败返回 null，调用方回退原 npx 链路（此时下载本身已失败，弹窗风险可接受）。
 */
export async function ensureNoPopNodeLaunch(
  command: string,
  args: string[]
): Promise<{ command: string; args: string[] } | null> {
  const direct = resolvePreemptiveNodeLaunch(command, args)
  if (direct) return direct
  if (process.platform !== 'win32') return null
  const cmd = command.trim().toLowerCase()
  const isNpx = cmd === 'npx'
  const isNpmExec = cmd === 'npm' && args[0] === 'exec'
  if (!isNpx && !isNpmExec) return null
  const rawSpec = parseNpxRawSpec(isNpx ? args : args.slice(1))
  if (!rawSpec) return null
  try {
    // 与 resolveStdioSpawn 同一道防线：spec 要经 cmd.exe 二次解析，拒掉元字符
    assertCmdSafe('MCP 参数', rawSpec)
  } catch {
    return null
  }
  try {
    spawnSync('cmd', ['/c', 'npm', 'exec', '--yes', `--package=${rawSpec}`, '--', 'cmd', '/c', 'exit', '0'], {
      env: process.env as Record<string, string>,
      stdio: 'ignore',
      timeout: 90_000,
      windowsHide: true
    })
  } catch {
    /* 拉包失败：落到原链路 */
  }
  return resolvePreemptiveNodeLaunch(command, args)
}

/**
 * 管理多个开发者自定义 MCP server 的持久连接。
 * - settings 变化时（通过 syncFromSettings）自动增删连接
 * - 所有连接在主进程持有，渲染层只通过 IPC 调用
 * - 升级为工具路由器：缓存工具 schema、按能力分类路由、权限分级、能力简报注入 FC 循环
 */
export class CustomMcpManager {
  private runtimes = new Map<string, CustomRuntime>()
  private servers: CustomMcpServerConfig[] = []
  /** admin 权限 server 的工具首次调用需用户确认（本批次预置均 read/interact 不触发） */
  private confirmedAdminServers = new Set<string>()

  /**
   * 根据设置同步自定义 server 列表：新增 enabled 的连接、禁用/删除的断开。
   * 幂等，可反复调用。
   */
  async syncFromSettings(servers: CustomMcpServerConfig[]): Promise<void> {
    this.servers = servers
    // 先断开不再存在或已禁用的
    for (const [id, rt] of this.runtimes) {
      const server = servers.find((s) => s.id === id)
      if (!server || !server.enabled) {
        await this.teardownRuntime(id, rt)
      }
    }
    // 再连接新增的 enabled server；已存在的连接在「失败状态」或「启动配置变化
    // （典型：启动时无项目→__PROJECT_ROOT__ 快速失败，打开项目后参数已替换）」时重连。
    // 熔断：连续失败 ≥2 次的服务不再自动重连（保留手动重试入口）。
    for (const server of servers) {
      if (!server.enabled) continue
      const existing = this.runtimes.get(server.id)
      if (existing) {
        // 熔断：失败计数超限且签名未变 → 跳过自动重连
        if (
          (existing.failCount ?? 0) >= FAIL_CIRCUIT_THRESHOLD &&
          existing.sig === serverSig(server)
        ) {
          continue
        }
        const sigChanged = existing.sig !== serverSig(server)
        if (existing.status === 'error' || sigChanged) {
          await this.teardownRuntime(server.id, existing)
        } else {
          continue
        }
      }
      void this.connect(server) // 不阻塞
    }
  }

  async connect(server: CustomMcpServerConfig): Promise<CustomRuntime | null> {
    const existing = this.runtimes.get(server.id)
    if (existing) return existing
    // 快速失败：未解析的 __PROJECT_ROOT__ 占位符（无打开项目）不应拉起子进程，
    // 否则子进程把字面量当真实路径 realpath 崩溃（mctx-mcp: ENOENT）。
    // 同时覆盖独立参数（'__PROJECT_ROOT__'）、内嵌（'--root=__PROJECT_ROOT__'）与 env 值。
    const hasPlaceholder =
      server.args.some((a) => a.includes('__PROJECT_ROOT__')) ||
      Object.values(server.env).some((v) => String(v).includes('__PROJECT_ROOT__'))
    if (hasPlaceholder) {
      const rt: CustomRuntime = {
        client: null as unknown as Client,
        transport: null as unknown as StdioClientTransport,
        tools: [],
        toolSchemas: [],
        status: 'error',
        error: '该服务绑定项目目录（__PROJECT_ROOT__），请先打开一个项目再启用',
        category: server.category,
        permission: server.permission,
        sig: serverSig(server)
      }
      this.runtimes.set(server.id, rt)
      return null
    }
    // blockbench-mcp 网关：自动发现并注入 Blockbench 本地 token（用户手填优先）
    const { env: enrichedEnv } = enrichBlockbenchEnv(server.command, server.args, server.env)
    // 沙箱：cwd 收敛到项目目录（无项目→userData/mcp-sandbox），env 最小化不透传 Electron 进程变量
    const cwd = server.cwd || process.cwd()
    const env: Record<string, string> = buildSandboxEnv(enrichedEnv, cwd)
    const rt: CustomRuntime = {
      client: undefined as unknown as Client,
      transport: undefined as unknown as StdioClientTransport,
      tools: [],
      toolSchemas: [],
      status: 'connecting',
      category: server.category,
      permission: server.permission,
      sig: serverSig(server)
    }
    this.runtimes.set(server.id, rt)
    console.warn(`[MCP-Custom] connecting: ${server.name}`, JSON.stringify(server.args))

    /**
     * 单次连接尝试：创建独立 client/transport，握手+列工具。
     * 成功返回实例与工具 schema；失败回传 error（已含 stderr/diag）。
     * 拆成独立闭包便于「npx 劫持」时用 node+绝对路径重跑一次。
     */
    const attemptConnect = async (
      cmd: string,
      args: string[]
    ): Promise<
      | { ok: true; client: Client; transport: StdioClientTransport; tools: string[]; toolSchemas: CustomMcpToolSchema[] }
      | { ok: false; error: string }
    > => {
      // Windows 裸命令（npx 等 .cmd 垫片）必须经 cmd /c，否则 ENOENT → -32000 Connection closed
      const spawnCmd = resolveStdioSpawn(cmd, args)
      // 劫持重写时 command=Electron 可执行文件，必须以纯 node 模式启动，否则会拉起应用窗口
      const spawnEnv = cmd === process.execPath
        ? { ...env, ELECTRON_RUN_AS_NODE: '1' }
        : env
      const tp = new StdioClientTransport({
        command: spawnCmd.command,
        args: spawnCmd.args,
        env: spawnEnv,
        cwd,
        // 关键诊断通道：捕获子进程 stderr（npx 下载进度/真实崩溃堆栈都在这里）
        stderr: 'pipe'
      })
      let stderrTail = ''
      tp.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000)
        console.warn(`[MCP-Custom:${server.name}] stderr:`, chunk.toString('utf8').trimEnd())
      })
      // npx 首次拉包可能远超 30s，上限放宽到 120s（用户可在配置里调低）
      const tpTimeoutMs = Math.min(120_000, Math.max(5_000, server.timeoutMs))
      let tpHandle: ReturnType<typeof setTimeout> | undefined
      const tpTimeout = new Promise<never>((_, reject) => {
        tpHandle = setTimeout(() => reject(new Error(`握手超时（${tpTimeoutMs}ms）`)), tpTimeoutMs)
      })
      const cli = new Client({ name: 'kunyu-ecosystem-custom', version: '1.0.0' }, { capabilities: {} })
      try {
        await Promise.race([cli.connect(tp), tpTimeout])
      } catch (err) {
        await tp.close().catch(() => {})
        const msg = (err as Error).message
        // 优先用实时捕获的 stderr（真实崩溃原因）；为空再跑一次同步诊断（同样走 cmd /c 包装）
        let diag = stderrTail.trim() ? ` | stderr: ${stderrTail.trim().slice(-300)}` : ''
        if (!diag) {
          try {
            const r = spawnSync(spawnCmd.command, spawnCmd.args, { env: spawnEnv, cwd, input: '', encoding: 'utf8', timeout: 25000 })
            diag = ` | diag exit=${r.status} stderr=${(r.stderr || '').slice(0, 300)}`
          } catch (e) { diag = ` | diag fail: ${(e as Error).message}` }
        }
        return { ok: false, error: `${msg}${diag}` }
      } finally {
        if (tpHandle !== undefined) clearTimeout(tpHandle)
      }
      try {
        const listed = await cli.listTools()
        const schemas: CustomMcpToolSchema[] = listed.tools.map((t) => ({
          name: t.name,
          description: t.description ?? '',
          inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} }
        }))
        return { ok: true, client: cli, transport: tp, tools: schemas.map((s) => s.name), toolSchemas: schemas }
      } catch (err) {
        try { await cli.close() } catch { /* ignore */ }
        try { await tp.close() } catch { /* ignore */ }
        return { ok: false, error: `工具发现失败：${(err as Error).message}` }
      }
    }

    // win32：缺 shebang 的包垫片必被文件关联劫持，缓存就绪时首发直启 node；未就绪先静默预取
    const preempt = await ensureNoPopNodeLaunch(server.command, server.args)
    if (preempt) {
      console.warn(`[MCP-Custom] preemptive node launch (no shebang): ${server.name}`, JSON.stringify(preempt.args))
    }
    let result = await attemptConnect(preempt?.command ?? server.command, preempt?.args ?? server.args)
    if (!result.ok && !preempt) {
      // 主动劫持修复：npx 包缺 shebang 时，定位 npx 缓存中的 bin 入口，改用 node+绝对路径重试一次
      const rewrite = resolveNpxEntryRewrite(server.command, server.args)
      if (rewrite) {
        console.warn(`[MCP-Custom] hijack retry via node: ${server.name}`, JSON.stringify(rewrite.args))
        result = await attemptConnect(rewrite.command, rewrite.args)
      }
    }

    if (!result.ok) {
      rt.status = 'error'
      rt.failCount = (rt.failCount ?? 0) + 1
      const hijack = win32NpxHijackHint(server.command, server.args, result.error)
      rt.error = `${result.error}${hijack ? `。${hijack}` : ''}`
      console.error('[MCP-Custom] connect fail:', server.name, '| err:', result.error, '| PATH:', (env.PATH || '').slice(0, 200))
      return null
    }

    // 成功：重置失败计数，把真实 client/transport/tools 落到 rt 上，再补 onclose/onerror 钩子
    rt.failCount = 0
    rt.client = result.client
    rt.transport = result.transport
    rt.toolSchemas = result.toolSchemas
    rt.tools = result.tools
    rt.transport.onclose = () => {
      if (this.runtimes.get(server.id) === rt) rt.status = 'disconnected'
    }
    rt.transport.onerror = (err: Error) => {
      if (this.runtimes.get(server.id) === rt) {
        rt.status = 'error'
        rt.error = err.message
      }
    }
    rt.status = 'ready'
    return rt
  }

  async teardownRuntime(id: string, rt?: CustomRuntime): Promise<void> {
    const target = rt ?? this.runtimes.get(id)
    if (!target) return
    this.runtimes.delete(id)
    // Windows 下 transport.close() 只杀直接子进程（npx），
    // 其派生的 node 孙进程（真实 MCP server）会变孤儿。先抓 pid，close 后 taskkill /T 杀整棵树。
    // StdioClientTransport._process 是 SDK 私有字段，通过类型断言读取。
    const childPid =
      (target.transport as unknown as { _process?: ChildProcess })?._process?.pid ?? undefined
    try { await target.client.close() } catch { /* ignore */ }
    try { await target.transport.close() } catch { /* ignore */ }
    if (process.platform === 'win32' && childPid !== undefined) {
      execFile('taskkill', ['/pid', String(childPid), '/T', '/F'], { windowsHide: true }, () => {
        /* 进程可能已随 close 退出，忽略 */
      })
    }
  }

  async disconnect(id: string): Promise<void> {
    const rt = this.runtimes.get(id)
    if (rt) await this.teardownRuntime(id, rt)
  }

  list(): CustomMcpRuntime[] {
    return this.servers.map((s) => {
      const rt = this.runtimes.get(s.id)
      if (!s.enabled) {
        return { id: s.id, name: s.name, enabled: false, status: 'disconnected', tools: [], category: s.category, permission: s.permission }
      }
      if (!rt) {
        return { id: s.id, name: s.name, enabled: true, status: 'connecting', tools: [], category: s.category, permission: s.permission }
      }
      return { id: s.id, name: s.name, enabled: true, status: rt.status, tools: rt.tools, error: rt.error, category: rt.category, permission: rt.permission }
    })
  }

  listAllTools(): { serverId: string; serverName: string; tools: string[] }[] {
    return this.list()
      .filter((r) => r.status === 'ready')
      .map((r) => ({ serverId: r.id, serverName: r.name, tools: r.tools }))
  }

  /** 列出所有 ready server 的工具 schema（供 ToolRegistry 注册）；按 toolFilter 过滤 */
  listAllToolsWithSchema(): { serverId: string; serverIdShort: string; serverName: string; category: McpCategory; permission: McpPermission; tools: CustomMcpToolSchema[] }[] {
    const out: { serverId: string; serverIdShort: string; serverName: string; category: McpCategory; permission: McpPermission; tools: CustomMcpToolSchema[] }[] = []
    for (const s of this.servers) {
      const rt = this.runtimes.get(s.id)
      if (!rt || rt.status !== 'ready') continue
      out.push({
        serverId: s.id,
        serverIdShort: s.id.slice(0, 8),
        serverName: s.name,
        category: rt.category,
        permission: rt.permission,
        tools: applyToolFilter(rt.toolSchemas, s.toolFilter)
      })
    }
    return out
  }

  /** 按能力分类查找 ready server（路由器入口） */
  findServersByCategory(category: McpCategory): CustomMcpRuntime[] {
    return this.list().filter((r) => r.status === 'ready' && r.category === category)
  }

  /** 生成能力简报（注入 FC 循环 system prompt） */
  getCapabilityBrief(): string {
    const all = this.listAllToolsWithSchema()
    if (all.length === 0) return ''
    return all
      .map((entry) => {
        const tag = `[${entry.category}]`
        const toolList = entry.tools.map((t) => `${entry.serverIdShort}_${t.name}`).join('/')
        return `${tag} ${toolList} (${entry.serverName})`
      })
      .join(' | ')
  }

  /** 判断指定 server 是否 ready（供 ToolRegistry available 门控） */
  isReady(serverId: string): boolean {
    const rt = this.runtimes.get(serverId)
    return Boolean(rt && rt.status === 'ready')
  }

  /** 判断指定 server 的某工具是否被工具权限允许；供 ToolRegistry available 防御性门控 */
  isToolAllowedFor(serverId: string, toolName: string): boolean {
    const server = this.servers.find((s) => s.id === serverId)
    return isToolAllowed(toolName, server?.toolFilter)
  }

  /** 标记 admin 权限 server 已获用户确认（后续调用不再拦截） */
  markAdminConfirmed(serverId: string): void {
    this.confirmedAdminServers.add(serverId)
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string; error?: string; isError?: boolean }> {
    const rt = this.runtimes.get(serverId)
    if (!rt || rt.status !== 'ready') {
      return { ok: false, text: '', error: `server ${serverId} 未连接（${rt?.status ?? 'unknown'}）` }
    }
    // admin 权限工具首次调用拦截（本批次预置均 read/interact，不触发）
    if (rt.permission === 'admin' && !this.confirmedAdminServers.has(serverId)) {
      return {
        ok: false,
        text: '',
        error: `server ${serverId} 为 admin 权限，首次调用前需用户确认（callTool 已拦截，请先调用 markAdminConfirmed）`
      }
    }
    // 工具级过滤兜底：即使模型经其他路径拿到工具名，被禁用工具也在此拒绝
    const serverCfg = this.servers.find((s) => s.id === serverId)
    if (!isToolAllowed(toolName, serverCfg?.toolFilter)) {
      return {
        ok: false,
        text: '',
        error: `工具 ${toolName} 已被「${serverCfg?.name ?? serverId}」的工具权限设置禁用（可在插件详情中调整）`
      }
    }
    try {
      const result = await rt.client.callTool({ name: toolName, arguments: args }, undefined)
      const text = (result.content as Array<{ type: string; text?: string }> | undefined)
        ?.filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text as string)
        .join('\n')
      return { ok: true, text: text ?? '', isError: Boolean(result.isError) }
    } catch (err) {
      return { ok: false, text: '', error: `调用 ${toolName} 失败：${(err as Error).message}` }
    }
  }
}

let customManager: CustomMcpManager | null = null

export function initCustomMcpManager(): CustomMcpManager {
  if (!customManager) customManager = new CustomMcpManager()
  return customManager
}

export function getCustomMcpManager(): CustomMcpManager | null {
  return customManager
}
