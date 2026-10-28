/**
 * dsh-pet 桌宠链路测试：
 * - 交付包 lib/agent-event-bridge.js：kunyu AgentEvent → session/event 映射（工作状态语义）
 * - 交付包 lib/pet-host.js：伪 ctx 契约（webServer 前缀路由 / llm shim 消息拍平与 chunk
 *   透传 / emit 桥 / stop 逆序 disposer），以假 dsh-pet 插件夹具验证
 * - installDshPetFromLocal：本地目录通道（完整文件集校验 + 复制 + 安装记录）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const userDataRoot = mkdtempSync(join(tmpdir(), 'ky-pet-'))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => userDataRoot
  }
}))

/** 交付包模块（纯 ESM JS，位于项目根 dsh-pet-kunyu/） */
const petHostUrl = pathToFileURL(join(process.cwd(), 'dsh-pet-kunyu', 'lib', 'pet-host.js')).href
const bridgeUrl = pathToFileURL(join(process.cwd(), 'dsh-pet-kunyu', 'lib', 'agent-event-bridge.js')).href

beforeEach(() => {
  rmSync(join(userDataRoot, 'dsh-plugins'), { recursive: true, force: true })
})

afterEach(() => {
  rmSync(join(userDataRoot, 'dsh-plugins'), { recursive: true, force: true })
})

// ---------------- agent-event-bridge ----------------

interface BridgeFeedFrame {
  type: string
  data: Record<string, unknown>
}

async function importBridge(): Promise<{
  createAgentEventBridge(): {
    feed(event: Record<string, unknown>): BridgeFeedFrame[]
    reset(): void
  }
}> {
  return (await import(bridgeUrl)) as unknown as {
    createAgentEventBridge(): {
      feed(event: Record<string, unknown>): BridgeFeedFrame[]
      reset(): void
    }
  }
}

describe('agent-event-bridge', () => {
  it('phase=running 首次映射 turn/start，同 run 重复不重发', async () => {
    const { createAgentEventBridge } = await importBridge()
    const bridge = createAgentEventBridge()
    expect(bridge.feed({ type: 'phase', runId: 'r1', phase: 'running', seq: 1 })).toEqual([
      { type: 'turn/start', data: {} }
    ])
    expect(bridge.feed({ type: 'phase', runId: 'r1', phase: 'running', seq: 2 })).toEqual([])
  })

  it('phase=waiting 未启动先补 turn/start，再 approval/asked', async () => {
    const { createAgentEventBridge } = await importBridge()
    const bridge = createAgentEventBridge()
    const frames = bridge.feed({ type: 'phase', runId: 'r1', phase: 'waiting', action: '等确认', seq: 3 })
    expect(frames).toEqual([
      { type: 'turn/start', data: {} },
      { type: 'approval/asked', data: { reason: '等确认' } }
    ])
  })

  it('paused/resumed 映射 approval/asked 与 tool/call', async () => {
    const { createAgentEventBridge } = await importBridge()
    const bridge = createAgentEventBridge()
    bridge.feed({ type: 'phase', runId: 'r1', phase: 'running', seq: 1 })
    expect(bridge.feed({ type: 'paused', runId: 'r1', detail: '等待授权', seq: 2 })).toEqual([
      { type: 'approval/asked', data: { reason: '等待授权' } }
    ])
    expect(bridge.feed({ type: 'resumed', runId: 'r1', seq: 3 })).toEqual([
      { type: 'tool/call', data: { name: 'resume' } }
    ])
  })

  it('reply → turn/end(completed) 并清运行态；error → turn/end(error)', async () => {
    const { createAgentEventBridge } = await importBridge()
    const bridge = createAgentEventBridge()
    bridge.feed({ type: 'phase', runId: 'r1', phase: 'running', seq: 1 })
    expect(bridge.feed({ type: 'reply', runId: 'r1', seq: 2 })).toEqual([
      { type: 'turn/end', data: { reason: { kind: 'completed' } } }
    ])
    // 已清：同 run 再来 reply 不重发
    expect(bridge.feed({ type: 'reply', runId: 'r1', seq: 3 })).toEqual([])

    bridge.feed({ type: 'phase', runId: 'r2', phase: 'running', seq: 4 })
    expect(bridge.feed({ type: 'error', runId: 'r2', seq: 5 })).toEqual([
      { type: 'turn/end', data: { reason: { kind: 'error' } } }
    ])
  })

  it('phase=done → turn/end(completed)；log/artifact 不映射', async () => {
    const { createAgentEventBridge } = await importBridge()
    const bridge = createAgentEventBridge()
    expect(bridge.feed({ type: 'phase', runId: 'r1', phase: 'done', seq: 1 })).toEqual([])
    bridge.feed({ type: 'phase', runId: 'r1', phase: 'running', seq: 2 })
    expect(bridge.feed({ type: 'phase', runId: 'r1', phase: 'done', seq: 3 })).toEqual([
      { type: 'turn/end', data: { reason: { kind: 'completed' } } }
    ])
    expect(bridge.feed({ type: 'log', runId: 'r1', seq: 4 })).toEqual([])
    expect(bridge.feed({ type: 'artifact', runId: 'r1', seq: 5 })).toEqual([])
  })

  it('phase=skipped → turn/end(aborted)（取消/超时回空闲）；未启动不映射、结束后不重发', async () => {
    const { createAgentEventBridge } = await importBridge()
    const bridge = createAgentEventBridge()
    // 未启动的 run 直接忽略
    expect(bridge.feed({ type: 'phase', runId: 'r1', phase: 'skipped', seq: 1 })).toEqual([])
    bridge.feed({ type: 'phase', runId: 'r1', phase: 'running', seq: 2 })
    expect(bridge.feed({ type: 'phase', runId: 'r1', phase: 'skipped', seq: 3 })).toEqual([
      { type: 'turn/end', data: { reason: { kind: 'aborted' } } }
    ])
    // 已清：同 run 再来 skipped 不重发
    expect(bridge.feed({ type: 'phase', runId: 'r1', phase: 'skipped', seq: 4 })).toEqual([])
  })

  it('reset 清空运行态', async () => {
    const { createAgentEventBridge } = await importBridge()
    const bridge = createAgentEventBridge()
    bridge.feed({ type: 'phase', runId: 'r1', phase: 'running', seq: 1 })
    bridge.reset()
    expect(bridge.feed({ type: 'phase', runId: 'r1', phase: 'running', seq: 2 })).toEqual([
      { type: 'turn/start', data: {} }
    ])
  })
})

// ---------------- pet-host（以假 dsh-pet 插件夹具） ----------------

interface PetHostHandle {
  port: number
  emit(name: string, ...args: unknown[]): unknown
  stop(): Promise<void>
}

interface CapturedStreamReq {
  provider: string
  model: string
  system?: string
  temperature?: number
  messages: Array<{ role: string; content: string }>
}

/** 生成一个假 dsh-pet 包：apply 捕获 ctx、注册前缀路由、记录 disposer 顺序 */
function writeFakePetPackage(dir: string): void {
  const libDir = join(dir, 'lib')
  mkdirSync(libDir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'dsh-pet', version: '9.9.9-fixture', type: 'module', main: 'lib/index.js' }),
    'utf-8'
  )
  writeFileSync(
    join(libDir, 'index.js'),
    [
      'export const name = "pet"',
      'export const inject = ["webServer", "agentDefaultModel", "credentials", "llm", "commands"]',
      'const state = { ctx: null, applied: 0, disposers: [] }',
      'export function __reset() { state.ctx = null; state.applied = 0; state.disposers = [] }',
      'export function __state() { return state }',
      'async function readBody(req) {',
      '  const chunks = []',
      '  for await (const c of req) chunks.push(c)',
      '  return Buffer.concat(chunks).toString("utf8")',
      '}',
      'export async function apply(ctx, config) {',
      '  state.ctx = ctx',
      '  state.applied++',
      '  state.config = config',
      '  ctx.effect(() => ctx.webServer.register({',
      '    kind: "prefix", path: "/dsh-pet-7340",',
      '    handler: async (req, res) => {',
      '      const body = req.method === "PUT" || req.method === "POST" ? await readBody(req) : undefined',
      '      res.writeHead(200, { "content-type": "application/json; charset=utf-8" })',
      '      res.end(JSON.stringify({ url: req.url, method: req.method, body: body ?? null, sel: ctx.agentDefaultModel.currentSelection(), seenPort: ctx.webServer.port }))',
      '    }',
      '  }), "test-route")',
      '  ctx.effect(() => () => { state.disposers.push("inner") })',
      '  return () => { state.disposers.push("returned") }',
      '}'
    ].join('\n'),
    'utf-8'
  )
}

describe('pet-host', () => {
  let fixtureDir = ''
  let captured: {
    __reset(): void
    __state(): { ctx: Record<string, unknown> | null; applied: number; disposers: string[] }
  } | null = null

  beforeEach(async () => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'ky-petpkg-'))
    writeFakePetPackage(fixtureDir)
    const mod = (await import(pathToFileURL(join(fixtureDir, 'lib', 'index.js')).href)) as unknown as {
      __reset(): void
      __state(): { ctx: Record<string, unknown> | null; applied: number; disposers: string[] }
    }
    mod.__reset()
    captured = mod
  })

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  function makeLlm(
    chunks: Array<{ type: 'text'; text: string }>,
    seen: { req?: CapturedStreamReq }
  ): Record<string, unknown> {
    return {
      listProviders: () => [{ id: 'prov1', name: 'Provider One' }],
      listModels: async () => [{ id: 'model-a', name: 'Model A' }],
      currentSelection: () => ({ provider: 'prov1', model: 'model-a' }),
      async *stream(req: CapturedStreamReq) {
        seen.req = req
        for (const c of chunks) yield c
      }
    }
  }

  async function start(options: Record<string, unknown>): Promise<PetHostHandle> {
    const { startPetHost } = (await import(petHostUrl)) as unknown as {
      startPetHost(o: Record<string, unknown>): Promise<PetHostHandle>
    }
    return startPetHost({ petPackagePath: fixtureDir, ...options })
  }

  it('加载插件并 apply；插件能看到端口与模型选择', async () => {
    const seen: { req?: CapturedStreamReq } = {}
    const handle = await start({ llm: makeLlm([], seen), modelSelection: () => ({ provider: 'prov1', model: 'model-a' }) })
    try {
      expect(handle.port).toBeGreaterThan(0)
      expect(captured?.__state().applied).toBe(1)
      const ctx = captured?.__state().ctx
      expect(ctx).toBeTruthy()
      const sel = (ctx as { agentDefaultModel: { currentSelection(): { provider: string; model: string } } })
        .agentDefaultModel.currentSelection()
      expect(sel).toEqual({ provider: 'prov1', model: 'model-a' })
      // credentials/commands 静默可用
      expect(await (ctx as { credentials: { resolve(): Promise<unknown> } }).credentials.resolve()).toBeUndefined()
    } finally {
      await handle.stop()
    }
  })

  it('credentials.resolve 透传 ref 给宿主解析器；未提供/抛错回 undefined', async () => {
    const seenRefs: unknown[] = []
    const handle = await start({
      llm: makeLlm([], {}),
      resolveCredential: async (ref: unknown) => {
        seenRefs.push(ref)
        if (ref === 'DEEPSEEK_API_KEY') return 'sk-secret'
        if (ref === 'BOOM') throw new Error('vault down')
        return undefined
      }
    })
    try {
      const ctx = captured?.__state().ctx as unknown as {
        credentials: { resolve(ref?: unknown): Promise<unknown> }
      }
      expect(await ctx.credentials.resolve('DEEPSEEK_API_KEY')).toEqual({ value: 'sk-secret' })
      expect(await ctx.credentials.resolve('OTHER')).toBeUndefined()
      // 解析器抛错必须吞成 undefined，不能让余额查询炸掉插件
      expect(await ctx.credentials.resolve('BOOM')).toBeUndefined()
      expect(seenRefs).toEqual(['DEEPSEEK_API_KEY', 'OTHER', 'BOOM'])
    } finally {
      await handle.stop()
    }
  })

  it('前缀路由分发 HTTP 请求（GET 无体 / POST 带体）', async () => {
    const handle = await start({ llm: makeLlm([], {}) })
    try {
      const res1 = await fetch(`http://127.0.0.1:${handle.port}/dsh-pet-7340/state?x=1`)
      const j1 = (await res1.json()) as { url: string; method: string; seenPort: number }
      expect(j1.url).toBe('/dsh-pet-7340/state?x=1')
      expect(j1.method).toBe('GET')
      expect(j1.seenPort).toBe(handle.port)
      const res2 = await fetch(`http://127.0.0.1:${handle.port}/dsh-pet-7340/broadcast`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '你好' })
      })
      const j2 = (await res2.json()) as { body: string }
      expect(JSON.parse(j2.body)).toEqual({ text: '你好' })
      // 非前缀 404
      const res3 = await fetch(`http://127.0.0.1:${handle.port}/other`)
      expect(res3.status).toBe(404)
    } finally {
      await handle.stop()
    }
  })

  it('llm shim：DSH 块消息拍平成 plain 文本，chunk 透传', async () => {
    const seen: { req?: CapturedStreamReq } = {}
    const handle = await start({
      llm: makeLlm(
        [
          { type: 'text', text: '你好，' },
          { type: 'text', text: '世界' }
        ],
        seen
      )
    })
    try {
      const ctx = captured?.__state().ctx as unknown as {
        llm: {
          stream(options: {
            provider: string
            model: string
            system: string
            messages: Array<{ role: string; content: unknown }>
          }): AsyncIterable<{ type: string; text: string }>
          listProviders(): Array<{ id: string; name: string }>
          listModels(id: string): Promise<Array<{ id: string; name: string }>>
        }
      }
      const chunks: Array<{ type: string; text: string }> = []
      for await (const c of ctx.llm.stream({
        provider: 'prov1',
        model: 'model-a',
        system: '人设',
        messages: [
          { role: 'user', content: [{ type: 'text', text: '第一句' }] },
          { role: 'assistant', content: [{ type: 'text', text: '第二句' }] }
        ]
      })) {
        chunks.push(c)
      }
      expect(seen.req?.messages).toEqual([
        { role: 'user', content: '第一句' },
        { role: 'assistant', content: '第二句' }
      ])
      expect(seen.req?.system).toBe('人设')
      expect(chunks).toEqual([
        { type: 'text', text: '你好，' },
        { type: 'text', text: '世界' }
      ])
      expect(await ctx.llm.listProviders()).toEqual([{ id: 'prov1', name: 'Provider One' }])
      expect(await ctx.llm.listModels('prov1')).toEqual([{ id: 'model-a', name: 'Model A' }])
    } finally {
      await handle.stop()
    }
  })

  it('emit 桥：宿主事件到达插件 ctx.on 注册的监听器', async () => {
    const handle = await start({ llm: makeLlm([], {}) })
    try {
      const ctx = captured?.__state().ctx as unknown as {
        on(name: string, fn: (...args: unknown[]) => void): () => void
      }
      const got: Array<[unknown, unknown]> = []
      ctx.on('session/event', (a, b) => {
        got.push([a, b])
      })
      handle.emit('session/event', { header: { id: 'run-1' } }, { type: 'turn/start', data: {}, seq: 1 })
      expect(got.length).toBe(1)
      expect(got[0][0]).toEqual({ header: { id: 'run-1' } })
      // 监听器抛错不外溢
      ctx.on('session/event', () => {
        throw new Error('boom')
      })
      expect(() =>
        handle.emit('session/event', { header: { id: 'run-2' } }, { type: 'tool/call', data: {}, seq: 2 })
      ).not.toThrow()
    } finally {
      await handle.stop()
    }
  })

  it('stop 逆序执行 effect disposer 与返回 disposer，并关闭端口', async () => {
    const handle = await start({ llm: makeLlm([], {}) })
    const port = handle.port
    await handle.stop()
    expect(captured?.__state().disposers).toEqual(['returned', 'inner'])
    await expect(fetch(`http://127.0.0.1:${port}/dsh-pet-7340/state`)).rejects.toThrow()
  })

  it('toPlainMessages：字符串与块数组两种 content 形态', async () => {
    const { toPlainMessages } = (await import(petHostUrl)) as unknown as {
      toPlainMessages(messages: unknown): Array<{ role: string; content: string }>
    }
    expect(
      toPlainMessages([
        { role: 'user', content: '纯文本' },
        { role: 'assistant', content: [{ type: 'text', text: '块一' }, { type: 'text', text: '块二' }] },
        { role: 'assistant', content: [{ type: 'tool_call', id: 'x' }] }
      ])
    ).toEqual([
      { role: 'user', content: '纯文本' },
      { role: 'assistant', content: '块一块二' },
      { role: 'assistant', content: '' }
    ])
    expect(toPlainMessages(undefined)).toEqual([])
  })

  it('缺 petPackagePath / 插件入口不存在 / 入口无 apply → 明确报错', async () => {
    const { startPetHost } = (await import(petHostUrl)) as unknown as {
      startPetHost(o: Record<string, unknown>): Promise<PetHostHandle>
    }
    await expect(startPetHost({ llm: makeLlm([], {}) })).rejects.toThrow(/petPackagePath/)
    await expect(
      start({ petPackagePath: join(fixtureDir, 'nope'), llm: makeLlm([], {}) })
    ).rejects.toThrow(/插件入口不存在/)
    const emptyDir = mkdtempSync(join(tmpdir(), 'ky-petempty-'))
    try {
      mkdirSync(join(emptyDir, 'lib'), { recursive: true })
      writeFileSync(join(emptyDir, 'lib', 'index.js'), 'export const x = 1\n', 'utf-8')
      await expect(start({ petPackagePath: emptyDir, llm: makeLlm([], {}) })).rejects.toThrow(/apply/)
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })
})

// ---------------- installDshPetFromLocal（本地目录安装通道） ----------------

describe('installDshPetFromLocal', () => {
  /** 生成完整的源包目录（含必需文件集）；每次调用独立临时目录，避免跨用例残留 */
  function writeSource(withHelper = true): string {
    const base = mkdtempSync(join(tmpdir(), 'ky-petsrc-'))
    const src = join(base, 'dsh-pet-src')
    mkdirSync(join(src, 'lib'), { recursive: true })
    mkdirSync(join(src, 'runtime', 'electron-helper'), { recursive: true })
    mkdirSync(join(src, 'assets'), { recursive: true })
    writeFileSync(
      join(src, 'package.json'),
      JSON.stringify({ name: 'dsh-pet', version: '0.3.6', type: 'module' }),
      'utf-8'
    )
    writeFileSync(join(src, 'lib', 'index.js'), 'export {}\n', 'utf-8')
    writeFileSync(join(src, 'assets', 'config.jsonc'), '{}\n', 'utf-8')
    if (withHelper) writeFileSync(join(src, 'runtime', 'electron-helper', 'main.js'), '// helper\n', 'utf-8')
    return src
  }

  it('完整源包 → 复制成功、写安装记录与五个 peer 桩（source=custom）', async () => {
    const { installDshPetFromLocal, DSH_PET_SHIMS } = await import('../dshInstaller')
    const { readInstalledRecords } = await import('../dshCatalog')
    const src = writeSource(true)
    const res = await installDshPetFromLocal(src)
    expect(res.ok).toBe(true)
    const dest = join(userDataRoot, 'dsh-plugins', 'node_modules', 'dsh-pet')
    expect(readFileSync(join(dest, 'lib', 'index.js'), 'utf-8')).toContain('export')
    // 五个未公开 peer 包桩已落位（dsh-pet/lib 的静态 import 靠 node_modules 向上解析到它们）
    const nm = join(userDataRoot, 'dsh-plugins', 'node_modules')
    for (const name of DSH_PET_SHIMS) {
      expect(existsSync(join(nm, name, 'package.json')), name).toBe(true)
      expect(existsSync(join(nm, name, 'index.js')), name).toBe(true)
    }
    expect(readFileSync(join(nm, '@deepseek-ai', 'dsh-llm', 'index.js'), 'utf-8')).toContain('createAssistantMessage')
    expect(readFileSync(join(nm, '@deepseek-ai', 'dsh-home-paths', 'index.js'), 'utf-8')).toContain('resolveDshHome')
    expect(readFileSync(join(nm, '@deepseek-ai', 'dsh-credentials', 'index.js'), 'utf-8')).toContain('credentialRef')
    const records = readInstalledRecords()
    expect(records.map((r) => r.npm)).toContain('dsh-pet')
    const record = records.find((r) => r.npm === 'dsh-pet')
    expect(record?.version).toBe('0.3.6')
    expect(record?.source).toBe('custom')
    expect(record?.shims).toEqual(DSH_PET_SHIMS)
  })

  it('源包缺 helper 主文件 → 拒绝且不写记录（完整文件集校验）', async () => {
    const { installDshPetFromLocal } = await import('../dshInstaller')
    const { readInstalledRecords } = await import('../dshCatalog')
    const src = writeSource(false)
    const res = await installDshPetFromLocal(src)
    expect(res.ok).toBe(false)
    expect(res.error ?? '').toContain('runtime')
    expect(readInstalledRecords().map((r) => r.npm)).not.toContain('dsh-pet')
  })

  it('源目录不存在 → 明确报错', async () => {
    const { installDshPetFromLocal } = await import('../dshInstaller')
    const res = await installDshPetFromLocal(join(userDataRoot, 'missing-dir'))
    expect(res.ok).toBe(false)
  })
})
