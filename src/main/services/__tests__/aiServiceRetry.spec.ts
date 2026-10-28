/**
 * P1-5 非流式 429/503 退避回归：
 * 此前仅流式 chatStream 有 429 退避，非流式 chat()/FIM 走 requestJson
 * 一次即失败（实测 8ms 即报 rateLimit）。现在 requestJson 内置 429/503 退避
 * （最多 3 次尝试，Retry-After 优先），与流式共用 retryWaitMs。
 * 测试用本地 http 服务模拟限流/维护窗口；Retry-After 给 0.01（10ms）避免测试等待 2s/5s。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'

const { getSectionMock } = vi.hoisted(() => ({ getSectionMock: vi.fn() }))
vi.mock('../settingsService', () => ({ getSection: getSectionMock }))
vi.mock('../httpUtil', () => ({
  networkTimeoutMs: () => 5_000,
  resolveDispatcher: async () => undefined
}))

const { chat } = await import('../aiService')

let server: Server
let hits = 0
/** 每次请求按脚本依次返回的状态码；脚本耗尽后重复最后一项 */
let script: Array<{ status: number; body?: string }> = []
let baseUrl = ''

beforeAll(async () => {
  server = createServer((_req, res) => {
    hits++
    const step = script[Math.min(hits - 1, script.length - 1)]
    res.writeHead(step.status, { 'Content-Type': 'application/json', 'retry-after': '0.01' })
    res.end(step.body ?? JSON.stringify({ error: 'rate limited' }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}/v1`
})

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()))
})

beforeEach(() => {
  hits = 0
  script = []
  getSectionMock.mockReturnValue({
    providers: [
      {
        id: 'p1',
        kind: 'openai-compatible',
        enabled: true,
        baseUrl,
        apiKey: 'test-key',
        model: 'test-model',
        temperature: 0.7,
        maxTokens: 1024
      }
    ]
  })
})

function okBody(): string {
  return JSON.stringify({
    model: 'test-model',
    choices: [{ message: { content: ' pong' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  })
}

describe('chat() 非流式 429/503 退避（P1-5）', () => {
  it('429 ×2 后 200：按 Retry-After 退避重试并成功返回', async () => {
    script = [{ status: 429 }, { status: 429 }, { status: 200, body: okBody() }]
    const r = await chat({ providerId: 'p1', messages: [{ role: 'user', content: 'ping' }] })
    expect(r.content).toBe(' pong')
    expect(hits).toBe(3)
  })

  it('503 后 200：维护窗口重试成功（此前 503 一次即失败）', async () => {
    script = [{ status: 503 }, { status: 200, body: okBody() }]
    const r = await chat({ providerId: 'p1', messages: [{ role: 'user', content: 'ping' }] })
    expect(r.content).toBe(' pong')
    expect(hits).toBe(2)
  })

  it('429 连续 3 次：重试耗尽后归 rateLimit（不做无限退避）', async () => {
    script = [{ status: 429 }]
    await expect(
      chat({ providerId: 'p1', messages: [{ role: 'user', content: 'ping' }] })
    ).rejects.toMatchObject({ kind: 'rateLimit' })
    expect(hits).toBe(3)
  })

  it('401 认证失败不重试（非可重试状态直接归类上抛）', async () => {
    script = [{ status: 401, body: JSON.stringify({ error: 'bad key' }) }]
    await expect(
      chat({ providerId: 'p1', messages: [{ role: 'user', content: 'ping' }] })
    ).rejects.toMatchObject({ kind: 'auth' })
    expect(hits).toBe(1)
  })
})
