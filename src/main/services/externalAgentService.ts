import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type {
  ExternalAgentChunk,
  ExternalAgentExit,
  ExternalAgentRunRequest,
  ExternalAgentRunStart
} from '../../shared/types/integration'
import type { IntegrationSettings } from '../../shared/types/settings'

/**
 * 外部 Agent 派发服务：把任务交给本机 Codex CLI / Claude Code 执行。
 *
 * 与 MCP 桥接（KunYu 作为 server）相反，这里是 KunYu 作为 client 调用外部 CLI：
 * - 任务经 stdin 传入，避免 Windows 命令行转义（提示词可含引号/换行）；
 * - stdout/stderr 实时回传渲染层，结束后回传退出码与耗时；
 * - 默认只读：Codex 走 `--sandbox read-only`，Claude 走 `--permission-mode plan`；
 *   开启写入后才分别放开到 workspace-write / acceptEdits。
 *
 * 注意：外部 CLI 用自己的工具链写盘，不经过 KunYu 的工具授权门，
 * 因此「允许写入」必须由渲染层二次确认后显式传入。
 */

const MAX_PROMPT_CHARS = 20_000

/** ANSI 控制序列（CLI 彩色输出），回传前剥掉避免渲染层出现乱码 */
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

/**
 * 构造非交互参数。
 * - Codex：`codex exec` 非交互执行；沙箱 read-only / workspace-write；
 *   `--skip-git-repo-check` 允许在非 git 仓库的项目根运行。
 * - Claude Code：`-p` 打印模式；只读用 plan 模式，写入用 acceptEdits
 *   （print 模式下无法交互授权，因此不放开 Bash 等高危工具）。
 */
export function buildAgentArgs(
  agentId: ExternalAgentRunRequest['agentId'],
  writeAccess: boolean
): string[] {
  if (agentId === 'codex') {
    return ['exec', '--sandbox', writeAccess ? 'workspace-write' : 'read-only', '--skip-git-repo-check']
  }
  return [
    '-p',
    '--permission-mode',
    writeAccess ? 'acceptEdits' : 'plan',
    '--output-format',
    'text'
  ]
}

/** 校验派发请求；返回错误文案（合法时返回 null） */
export function validateRunRequest(
  req: ExternalAgentRunRequest,
  activeProjectRoot: string | null
): string | null {
  if (req.agentId !== 'codex' && req.agentId !== 'claude-code') return '未知的外部 Agent'
  const prompt = typeof req.prompt === 'string' ? req.prompt.trim() : ''
  if (!prompt) return '任务描述不能为空'
  if (prompt.length > MAX_PROMPT_CHARS) return `任务描述过长（上限 ${MAX_PROMPT_CHARS} 字符）`
  if (!activeProjectRoot) return '请先打开一个项目'
  if (req.cwd !== activeProjectRoot) return '只能对当前打开的项目派发任务'
  return null
}

export interface ExternalAgentServiceDeps {
  /** 读取集成设置（自定义路径优先） */
  settings: () => IntegrationSettings
  /** 当前打开项目根；无项目返回 null */
  activeProjectRoot: () => string | null
  /** 主→渲染：输出片段 */
  sendChunk: (chunk: ExternalAgentChunk) => void
  /** 主→渲染：结束事件 */
  sendExit: (exit: ExternalAgentExit) => void
  /** 子进程工厂 seam（测试注入假实现） */
  spawnImpl?: typeof spawn
}

export interface ExternalAgentService {
  run(req: ExternalAgentRunRequest): ExternalAgentRunStart
  stop(runId: string): boolean
  /** 当前是否有运行中的任务（pane 恢复状态用） */
  isRunning(): boolean
}

interface ActiveRun {
  child: ChildProcess
  startedAt: number
  stopped: boolean
}

export function createExternalAgentService(deps: ExternalAgentServiceDeps): ExternalAgentService {
  const spawnProcess = deps.spawnImpl ?? spawn
  let active: { runId: string; run: ActiveRun } | null = null

  function commandFor(agentId: ExternalAgentRunRequest['agentId']): string {
    const s = deps.settings()
    if (agentId === 'codex') return s.codexPath.trim() || 'codex'
    return s.claudeCodePath.trim() || 'claude'
  }

  function finish(
    runId: string,
    startedAt: number,
    payload: { code: number | null; signal: string | null; error?: string }
  ): void {
    const durationMs = Date.now() - startedAt
    deps.sendExit({
      runId,
      code: payload.code,
      signal: payload.signal,
      durationMs,
      ok: payload.code === 0 && !payload.error,
      ...(payload.error ? { error: payload.error } : {})
    })
    if (active?.runId === runId) active = null
  }

  function run(req: ExternalAgentRunRequest): ExternalAgentRunStart {
    const invalid = validateRunRequest(req, deps.activeProjectRoot())
    if (invalid) throw new Error(invalid)
    if (active) throw new Error('已有外部 Agent 任务在运行，请先停止')

    const writeAccess = req.writeAccess === true
    const args = buildAgentArgs(req.agentId, writeAccess)
    const command = commandFor(req.agentId)
    const runId = randomUUID()

    // Windows 上 npm 全局安装的是 .cmd 垫片，必须经 shell 才能执行
    const child = spawnProcess(command, args, {
      cwd: req.cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' }
    })

    const startedAt = Date.now()
    active = { runId, run: { child, startedAt, stopped: false } }

    const forward = (stream: 'stdout' | 'stderr') => (data: Buffer | string): void => {
      const text = stripAnsi(typeof data === 'string' ? data : data.toString('utf8'))
      if (text) deps.sendChunk({ runId, stream, text })
    }
    child.stdout?.on('data', forward('stdout'))
    child.stderr?.on('data', forward('stderr'))

    // stdin 传任务描述后关闭，CLI 读到 EOF 开始执行
    child.stdin?.on('error', () => {
      /* 进程提前退出时写 stdin 会 EPIPE，忽略即可 */
    })
    child.stdin?.end(req.prompt.trim())

    let settled = false
    const settle = (payload: { code: number | null; signal: string | null; error?: string }): void => {
      if (settled) return
      settled = true
      finish(runId, startedAt, payload)
    }

    child.on('error', (err) => {
      settle({ code: null, signal: null, error: `无法启动 ${command}：${err.message}` })
    })
    child.on('close', (code, signal) => {
      settle({ code, signal })
    })

    return {
      runId,
      command: `${command} ${args.join(' ')}`,
      writeAccess
    }
  }

  function stop(runId: string): boolean {
    if (!active || active.runId !== runId) return false
    const { child, stopped } = active.run
    if (stopped) return false
    active.run.stopped = true
    if (process.platform === 'win32' && child.pid) {
      // 经 shell 启动时杀掉 cmd.exe 不会带走子进程，按进程树终止
      spawnProcess('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true
      }).on('error', () => {
        child.kill()
      })
    } else {
      child.kill('SIGTERM')
    }
    return true
  }

  function isRunning(): boolean {
    return active !== null
  }

  return { run, stop, isRunning }
}
