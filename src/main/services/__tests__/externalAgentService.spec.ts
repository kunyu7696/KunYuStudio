import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { spawn } from 'node:child_process'
import {
  buildAgentArgs,
  createExternalAgentService,
  stripAnsi,
  validateRunRequest
} from '../externalAgentService'
import type {
  ExternalAgentChunk,
  ExternalAgentExit,
  ExternalAgentRunRequest
} from '../../../shared/types/integration'
import type { IntegrationSettings } from '../../../shared/types/settings'

const SETTINGS: IntegrationSettings = {
  codexPath: '',
  claudeCodePath: '',
  externalAgentEnabled: true,
  mcpBridgeEnabled: false,
  mcpBridgePort: 0,
  mcpAuthMode: 'session'
}

const ROOT = 'D:\\projects\\demo'

function request(overrides: Partial<ExternalAgentRunRequest> = {}): ExternalAgentRunRequest {
  return { agentId: 'codex', prompt: '说明这个项目', cwd: ROOT, ...overrides }
}

describe('buildAgentArgs', () => {
  it('Codex 默认只读沙箱', () => {
    expect(buildAgentArgs('codex', false)).toEqual([
      'exec',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check'
    ])
  })

  it('Codex 允许写入时换 workspace-write', () => {
    expect(buildAgentArgs('codex', true)).toContain('workspace-write')
    expect(buildAgentArgs('codex', true)).not.toContain('read-only')
  })

  it('Claude 默认 plan 模式，写入时 acceptEdits，非交互打印', () => {
    expect(buildAgentArgs('claude-code', false)).toEqual([
      '-p',
      '--permission-mode',
      'plan',
      '--output-format',
      'text'
    ])
    expect(buildAgentArgs('claude-code', true)).toContain('acceptEdits')
    expect(buildAgentArgs('claude-code', true)).toContain('-p')
  })
})

describe('validateRunRequest', () => {
  it('拒绝空任务与超长任务', () => {
    expect(validateRunRequest(request({ prompt: '   ' }), ROOT)).toContain('不能为空')
    expect(validateRunRequest(request({ prompt: 'x'.repeat(20_001) }), ROOT)).toContain('过长')
  })

  it('无打开项目 / 目标不是当前项目时拒绝', () => {
    expect(validateRunRequest(request(), null)).toContain('先打开一个项目')
    expect(validateRunRequest(request({ cwd: 'D:\\other' }), ROOT)).toContain('当前打开的项目')
  })

  it('合法请求放行', () => {
    expect(validateRunRequest(request(), ROOT)).toBeNull()
  })
})

describe('stripAnsi', () => {
  it('剥掉颜色控制序列，保留正文', () => {
    expect(stripAnsi('\u001b[32mOK\u001b[0m done')).toBe('OK done')
  })
})

/** 最小假子进程：只需 stdout/stderr/stdin + EventEmitter 事件 */
function fakeChild(): EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { on: () => void; end: (text: string) => void }
  pid: number
  kill: () => void
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    stdin: { on: () => void; end: (text: string) => void }
    pid: number
    kill: () => void
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  let written = ''
  child.stdin = {
    on: () => undefined,
    end: (text: string) => {
      written = text
      ;(child as unknown as { lastStdin: string }).lastStdin = written
    }
  }
  child.pid = 1234
  child.kill = vi.fn()
  return child
}

describe('createExternalAgentService', () => {
  it('经 stdin 传任务，转发输出并在退出时报退出码', async () => {
    const child = fakeChild()
    const chunks: ExternalAgentChunk[] = []
    const exits: ExternalAgentExit[] = []
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn
    const service = createExternalAgentService({
      settings: () => SETTINGS,
      activeProjectRoot: () => ROOT,
      sendChunk: (c) => chunks.push(c),
      sendExit: (e) => exits.push(e),
      spawnImpl
    })

    const started = service.run(request())
    expect(started.writeAccess).toBe(false)
    expect(service.isRunning()).toBe(true)

    // 任务走 stdin，不出现在命令行里
    expect((child as unknown as { lastStdin: string }).lastStdin).toBe('说明这个项目')
    expect(started.command).not.toContain('说明这个项目')

    child.stdout.emit('data', Buffer.from('\u001b[32mhello\u001b[0m'))
    child.stderr.emit('data', Buffer.from('warn\n'))
    child.emit('close', 0, null)
    await Promise.resolve()

    expect(chunks).toEqual([
      { runId: started.runId, stream: 'stdout', text: 'hello' },
      { runId: started.runId, stream: 'stderr', text: 'warn\n' }
    ])
    expect(exits).toHaveLength(1)
    expect(exits[0].ok).toBe(true)
    expect(exits[0].code).toBe(0)
    expect(service.isRunning()).toBe(false)
  })

  it('启动失败（ENOENT）转成错误退出事件', () => {
    const child = fakeChild()
    const exits: ExternalAgentExit[] = []
    const service = createExternalAgentService({
      settings: () => SETTINGS,
      activeProjectRoot: () => ROOT,
      sendChunk: () => undefined,
      sendExit: (e) => exits.push(e),
      spawnImpl: (() => child) as unknown as typeof spawn
    })

    service.run(request())
    child.emit('error', new Error('spawn codex ENOENT'))

    expect(exits[0].ok).toBe(false)
    expect(exits[0].error).toContain('ENOENT')
    expect(service.isRunning()).toBe(false)
  })

  it('运行中再次派发被拒绝；未知 runId 无法停止', () => {
    const child = fakeChild()
    const service = createExternalAgentService({
      settings: () => SETTINGS,
      activeProjectRoot: () => ROOT,
      sendChunk: () => undefined,
      sendExit: () => undefined,
      spawnImpl: (() => child) as unknown as typeof spawn
    })

    const started = service.run(request())
    expect(() => service.run(request())).toThrow('已有外部 Agent 任务在运行')
    expect(service.stop('not-a-run')).toBe(false)
    expect(service.stop(started.runId)).toBe(true)
  })

  it('非法请求不启动进程', () => {
    const spawnImpl = vi.fn()
    const service = createExternalAgentService({
      settings: () => SETTINGS,
      activeProjectRoot: () => ROOT,
      sendChunk: () => undefined,
      sendExit: () => undefined,
      spawnImpl: spawnImpl as unknown as typeof spawn
    })
    expect(() => service.run(request({ cwd: 'D:\\other' }))).toThrow()
    expect(spawnImpl).not.toHaveBeenCalled()
  })
})
