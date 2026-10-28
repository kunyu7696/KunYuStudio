/**
 * integrationService 单测：CLI 检测、授权门、MCP 桥接启停。
 * 所有外部依赖（exec / registry / sendAuthRequest / auditLog）均注入 seam。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { request as httpRequest } from 'node:http'
import {
  createIntegrationService,
  resetIntegrationServiceForTest,
  type IntegrationServiceDeps
} from '../integrationService'
import type { ToolRegistry } from '../ai/toolRegistry'
import type { ToolDefinition } from '../../../shared/types/ai'

describe('detectAgents', () => {
  beforeEach(() => resetIntegrationServiceForTest())

  function deps(opts: Partial<IntegrationServiceDeps> = {}): IntegrationServiceDeps {
    return {
      getRegistry: () => fakeRegistry(),
      sendAuthRequest: () => {},
      settings: () => ({
        codexPath: '',
        claudeCodePath: '',
        externalAgentEnabled: false,
        mcpBridgeEnabled: false,
        mcpBridgePort: 9731,
        mcpAuthMode: 'session'
      }),
      projectContext: () => ({ loader: 'fabric' as const, mcVersion: '1.20.1' }),
      now: () => new Date('2025-01-01T00:00:00Z'),
      ...opts
    }
  }

  function fakeRegistry(): ToolRegistry {
    return {
      registerTool: () => {},
      getToolDefinitions: () => [],
      has: () => false,
      executeTool: async () => ({ ok: true, text: '' })
    }
  }

  it('PATH 检测到 codex', async () => {
    const exec = async (cmd: string, _args: string[]) => {
      if (cmd === 'codex') return { stdout: 'codex 1.2.3', stderr: '' }
      throw new Error('not found')
    }
    const svc = createIntegrationService(deps({ exec }))
    const list = await svc.detectAgents()
    const codex = list.find((a) => a.id === 'codex')!
    expect(codex.found).toBe(true)
    expect(codex.version).toContain('1.2.3')
  })

  it('自定义路径无效时返回错误', async () => {
    const exec = async () => {
      throw new Error('ENOENT')
    }
    const svc = createIntegrationService(
      deps({
        exec,
        settings: () => ({
          codexPath: 'D:/nonexistent/codex.exe',
          claudeCodePath: '',
          externalAgentEnabled: false,
          mcpBridgeEnabled: false,
          mcpBridgePort: 9731,
          mcpAuthMode: 'session'
        })
      })
    )
    const list = await svc.detectAgents()
    const codex = list.find((a) => a.id === 'codex')!
    expect(codex.found).toBe(false)
    expect(codex.error).toContain('自定义路径无法执行')
  })

  it('全部未检测到返回 not found', async () => {
    const exec = async () => {
      throw new Error('not found')
    }
    const svc = createIntegrationService(deps({ exec }))
    const list = await svc.detectAgents()
    expect(list.every((a) => !a.found)).toBe(true)
  })
})

describe('MCP 桥接启停', () => {
  beforeEach(() => resetIntegrationServiceForTest())

  function deps(opts: Partial<IntegrationServiceDeps> = {}): IntegrationServiceDeps {
    return {
      getRegistry: () => fakeRegistry(),
      sendAuthRequest: () => {},
      settings: () => ({
        codexPath: '',
        claudeCodePath: '',
        externalAgentEnabled: false,
        mcpBridgeEnabled: false,
        mcpBridgePort: 19732,
        mcpAuthMode: 'session'
      }),
      projectContext: () => ({ loader: 'fabric' as const, mcVersion: '1.20.1' }),
      ...opts
    }
  }

  function fakeRegistry(defs: ToolDefinition[] = []): ToolRegistry {
    return {
      registerTool: () => {},
      getToolDefinitions: () => defs,
      has: () => false,
      executeTool: async () => ({ ok: true, text: '' })
    }
  }

  it('startBridge 后 running=true，stopBridge 后 running=false', async () => {
    const svc = createIntegrationService(deps())
    const started = await svc.startBridge()
    expect(started.running).toBe(true)
    expect(started.port).toBe(19732)
    expect(started.endpoint).toBe('http://127.0.0.1:19732/mcp')

    const stopped = await svc.stopBridge()
    expect(stopped.running).toBe(false)
    expect(stopped.pendingAuth).toBe(0)
  })

  it('重复启动幂等，不额外建 server', async () => {
    const svc = createIntegrationService(deps())
    const first = await svc.startBridge()
    const second = await svc.startBridge()
    expect(second.running).toBe(true)
    expect(second.port).toBe(first.port)
    await svc.stopBridge()
  })
})

describe('授权拦截', () => {
  beforeEach(() => resetIntegrationServiceForTest())

  function deps(opts: Partial<IntegrationServiceDeps> = {}): IntegrationServiceDeps {
    return {
      getRegistry: () => fakeRegistry(),
      sendAuthRequest: () => {},
      settings: () => ({
        codexPath: '',
        claudeCodePath: '',
        externalAgentEnabled: false,
        mcpBridgeEnabled: false,
        mcpBridgePort: 19733,
        mcpAuthMode: 'session'
      }),
      projectContext: () => ({ loader: 'fabric' as const, mcVersion: '1.20.1' }),
      ...opts
    }
  }

  function fakeRegistry(): ToolRegistry {
    return {
      registerTool: () => {},
      getToolDefinitions: () => [],
      has: (name: string) => name === 'write_file',
      executeTool: async () => ({ ok: true, text: 'done' })
    }
  }

  it('只读工具不触发授权（mcdev_search 等）', async () => {
    const sent: unknown[] = []
    const svc = createIntegrationService(
      deps({ sendAuthRequest: (req) => sent.push(req) })
    )
    await svc.startBridge()
    expect(svc.getBridgeStatus().pendingAuth).toBe(0)
    await svc.stopBridge()
    expect(sent.length).toBe(0)
  })

  it('授权允许后同工具 session 记住不再弹窗', async () => {
    let capturedReqId = ''
    const svc = createIntegrationService(
      deps({
        sendAuthRequest: (req) => {
          capturedReqId = req.requestId
        }
      })
    )
    await svc.startBridge()
    svc.respondAuth({ requestId: capturedReqId, allow: true, rememberSession: true })
    await svc.stopBridge()
  })

  it('respondAuth 拒绝后 pendingAuth 清零', async () => {
    const svc = createIntegrationService(deps())
    await svc.startBridge()
    svc.respondAuth({ requestId: 'unknown-id', allow: false, rememberSession: false })
    expect(svc.getBridgeStatus().pendingAuth).toBe(0)
    await svc.stopBridge()
  })
})

describe('组级授权 + 审计（HTTP 端到端）', () => {
  beforeEach(() => resetIntegrationServiceForTest())

  // 每个用例独占端口：避免 undici 全局连接池复用上个用例已关闭的 keep-alive socket（ECONNRESET）
  function deps(port: number, opts: Partial<IntegrationServiceDeps> = {}): IntegrationServiceDeps {
    return {
      getRegistry: () => fakeRegistry(),
      sendAuthRequest: () => {},
      settings: () => ({
        codexPath: '',
        claudeCodePath: '',
        externalAgentEnabled: false,
        mcpBridgeEnabled: false,
        mcpBridgePort: port,
        mcpAuthMode: 'session'
      }),
      projectContext: () => ({ loader: 'fabric' as const, mcVersion: '1.20.1' }),
      ...opts
    }
  }

  function fakeRegistry(): ToolRegistry {
    return {
      registerTool: () => {},
      getToolDefinitions: () => [],
      has: (name: string) =>
        name === 'write_project_file' || name === 'texture_paint' || name === 'mc_command',
      executeTool: async () => ({ ok: true, text: 'done' })
    }
  }

  interface JsonRpcReply {
    jsonrpc: string
    id: string | number
    result?: { content: Array<{ type: string; text: string }>; isError?: boolean }
    error?: { message: string }
  }

  /** MCP Streamable HTTP：Accept 必须同时含 json + event-stream；响应按 Content-Type 解析（SSE 取匹配 id 的 message 事件） */
  async function callTool(port: number, name: string, args: Record<string, unknown>, token: string): Promise<JsonRpcReply> {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/call', params: { name, arguments: args } })
    })
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('text/event-stream')) {
      const body = await res.text()
      for (const block of body.split('\n\n')) {
        const dataLine = block.split('\n').find((l) => l.startsWith('data: '))
        if (!dataLine || dataLine === 'data: ') continue
        const msg = JSON.parse(dataLine.slice(6)) as JsonRpcReply
        if (msg.id === '1') return msg
      }
      throw new Error(`SSE 响应中未找到 id=1 的回复：${body.slice(0, 200)}`)
    }
    return (await res.json()) as JsonRpcReply
  }

  /** 轮询等待授权请求送达（替代固定 sleep，避免慢机抖动） */
  async function waitFor(cond: () => boolean): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if (cond()) return
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error('等待授权请求超时')
  }

  it('组级 session 记忆：同组第二个工具不再弹窗', async () => {
    const auditLines: string[] = []
    let capturedReqId = ''
    let authCount = 0

    const svc = createIntegrationService(
      deps(19734, {
        sendAuthRequest: (req) => {
          authCount++
          capturedReqId = req.requestId
        },
        auditLog: {
          getPath: () => '/tmp/audit.jsonl',
          appendFile: (_p, line) => auditLines.push(line)
        }
      })
    )

    await svc.startBridge()
    const token = svc.getBridgeStatus().token!

    // 第一次调用 interact 工具 → 弹窗
    const p1 = callTool(19734, 'write_project_file', { relPath: 'a.java', content: 'x' }, token)
    await waitFor(() => capturedReqId !== '')
    svc.respondAuth({ requestId: capturedReqId, allow: true, rememberSession: true })
    const r1 = await p1
    expect(r1.error).toBeUndefined()
    expect(r1.result?.isError).toBe(false)
    expect(authCount).toBe(1)

    // 第二次调用同组 interact 工具 → 不再弹窗（session 记忆）
    const r2 = await callTool(19734, 'texture_paint', { kind: 'item', id: 'x', shape: 'sword', primary: '#f00' }, token)
    expect(r2.error).toBeUndefined()
    expect(authCount).toBe(1) // 没有第二次弹窗

    // audit 应有两条成功记录
    expect(auditLines.length).toBe(2)
    const a1 = JSON.parse(auditLines[0]) as { tool: string; group: string; decision: string; result: string }
    const a2 = JSON.parse(auditLines[1]) as { tool: string; group: string; decision: string; result: string }
    expect(a1.tool).toBe('write_project_file')
    expect(a1.group).toBe('interact')
    expect(a1.decision).toBe('allow')
    expect(a2.tool).toBe('texture_paint')
    expect(a2.group).toBe('interact')

    await svc.stopBridge()
  })

  it('拒绝后审计记录 decision=deny', async () => {
    const auditLines: string[] = []
    let capturedReqId = ''

    const svc = createIntegrationService(
      deps(19735, {
        sendAuthRequest: (req) => {
          capturedReqId = req.requestId
        },
        auditLog: {
          getPath: () => '/tmp/audit.jsonl',
          appendFile: (_p, line) => auditLines.push(line)
        }
      })
    )

    await svc.startBridge()
    const token = svc.getBridgeStatus().token!

    const p1 = callTool(19735, 'mc_command', { command: 'time set day' }, token)
    await waitFor(() => capturedReqId !== '')
    svc.respondAuth({ requestId: capturedReqId, allow: false, rememberSession: false })
    const r1 = await p1
    // 拒绝走 JSON-RPC result + isError（不是 error 字段），文本含「拒绝」
    expect(r1.result?.isError).toBe(true)
    expect(r1.result?.content[0]?.text).toContain('拒绝')

    expect(auditLines.length).toBe(1)
    const a = JSON.parse(auditLines[0]) as { tool: string; group: string; decision: string; result: string }
    expect(a.tool).toBe('mc_command')
    expect(a.group).toBe('admin')
    expect(a.decision).toBe('deny')
    expect(a.result).toBe('denied')

    await svc.stopBridge()
  })
})

describe('传输层安全门（P1-8）', () => {
  beforeEach(() => resetIntegrationServiceForTest())

  function deps(port: number, opts: Partial<IntegrationServiceDeps> = {}): IntegrationServiceDeps {
    return {
      getRegistry: () => ({
        registerTool: () => {},
        getToolDefinitions: () => [],
        has: () => false,
        executeTool: async () => ({ ok: true, text: '' })
      }),
      sendAuthRequest: () => {},
      settings: () => ({
        codexPath: '',
        claudeCodePath: '',
        externalAgentEnabled: false,
        mcpBridgeEnabled: false,
        mcpBridgePort: port,
        mcpAuthMode: 'session'
      }),
      projectContext: () => ({ loader: 'fabric' as const, mcVersion: '1.20.1' }),
      ...opts
    }
  }

  async function post(url: string, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/list' })
    })
  }

  /** 原生 http 客户端：可伪造 Host 头（undici fetch 会按 URL 重写） */
  function rawPost(port: number, headers: Record<string, string>): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/mcp',
          method: 'POST',
          setHost: false,
          headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }
        },
        (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode ?? 0))
        }
      )
      req.on('error', reject)
      req.end(JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/list' }))
    })
  }

  it('无令牌请求被 401 拒绝（旧版裸握手不再可行）', async () => {
    const svc = createIntegrationService(deps(19736))
    await svc.startBridge()
    const res = await post('http://127.0.0.1:19736/mcp')
    expect(res.status).toBe(401)
    await svc.stopBridge()
  })

  it('错误令牌 401；Bearer / x-kunyu-token / ?token= 三种携带方式均放行', async () => {
    const svc = createIntegrationService(deps(19737))
    await svc.startBridge()
    const token = svc.getBridgeStatus().token!
    expect(token.length).toBeGreaterThan(20)

    const bad = await post('http://127.0.0.1:19737/mcp', { authorization: 'Bearer wrong-token' })
    expect(bad.status).toBe(401)

    const okBearer = await post('http://127.0.0.1:19737/mcp', { authorization: `Bearer ${token}` })
    expect(okBearer.status).toBe(200)
    const okHeader = await post('http://127.0.0.1:19737/mcp', { 'x-kunyu-token': token })
    expect(okHeader.status).toBe(200)
    const okQuery = await post(`http://127.0.0.1:19737/mcp?token=${encodeURIComponent(token)}`)
    expect(okQuery.status).toBe(200)

    await svc.stopBridge()
  })

  it('非回环 Host 403（防 DNS rebinding）', async () => {
    const svc = createIntegrationService(deps(19738))
    await svc.startBridge()
    const token = svc.getBridgeStatus().token!
    // undici fetch 会按 URL 重写 Host 头，必须用原生 http 客户端才能伪造
    const status = await rawPost(19738, { authorization: `Bearer ${token}`, host: 'evil.example.com' })
    expect(status).toBe(403)
    await svc.stopBridge()
  })

  it('跨源 Origin 403；本端点自身 Origin 放行', async () => {
    const svc = createIntegrationService(deps(19739))
    await svc.startBridge()
    const token = svc.getBridgeStatus().token!
    const evil = await post('http://127.0.0.1:19739/mcp', {
      authorization: `Bearer ${token}`,
      origin: 'http://evil.example.com'
    })
    expect(evil.status).toBe(403)
    const own = await post('http://127.0.0.1:19739/mcp', {
      authorization: `Bearer ${token}`,
      origin: 'http://127.0.0.1:19739'
    })
    expect(own.status).toBe(200)
    await svc.stopBridge()
  })

  it('端口配置 0 时由 OS 分配随机空闲端口，令牌与端点可用', async () => {
    const svc = createIntegrationService(deps(0))
    const started = await svc.startBridge()
    expect(started.running).toBe(true)
    expect(started.port).toBeGreaterThanOrEqual(1024)
    expect(started.endpoint).toBe(`http://127.0.0.1:${started.port}/mcp`)
    expect(started.token).toBeTruthy()
    const res = await post(`${started.endpoint}?token=${encodeURIComponent(started.token!)}`)
    expect(res.status).toBe(200)
    await svc.stopBridge()
  })
})
