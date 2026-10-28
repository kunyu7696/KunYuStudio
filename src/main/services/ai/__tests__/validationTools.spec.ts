/**
 * P1 校验/验证 FC 工具单测：
 * fabric_mod_json_validate（结构+实物交叉）、fabric_log_debugger（粘贴/崩溃报告/latest.log）、
 * mc_test_scenario（node:http 伪 observer：全通过/fail-fast/指令护栏/离线）。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Socket } from 'node:net'
import type { ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createToolRegistry, type ToolRegistry, type ToolResult } from '../toolRegistry'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

/* ------------------------- fabric.mod.json / 日志 测试夹具 ------------------------- */

let root: string

function writeModJson(obj: unknown): void {
  mkdirSync(join(root, 'src', 'main', 'resources'), { recursive: true })
  writeFileSync(join(root, 'src', 'main', 'resources', 'fabric.mod.json'), JSON.stringify(obj))
}

function validModJson(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'testmod',
    version: '${version}',
    name: 'Test Mod',
    license: 'MIT',
    environment: '*',
    entrypoints: { main: ['com.example.testmod.TestmodMod'] },
    depends: { fabricloader: '>=0.15.0', minecraft: '~1.20.1', java: '>=17', 'fabric-api': '*' }
  }
}

function mkProject(): ToolRegistry {
  root = mkdtempSync(join(tmpdir(), 'kunyu-validate-'))
  mkdirSync(join(root, 'src', 'main', 'java', 'com', 'example', 'testmod'), { recursive: true })
  writeFileSync(join(root, 'src', 'main', 'java', 'com', 'example', 'testmod', 'TestmodMod.java'), 'class TestmodMod {}\n')
  return createToolRegistry({ projectRoot: () => root })
}

/* ------------------------- 伪 observer ------------------------- */

function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

interface FakeObserver {
  port: number
  posts: Array<{ path: string; body: Record<string, unknown> }>
  stop: () => void
}

function startFakeObserver(inGame: boolean): Promise<FakeObserver> {
  const sockets = new Set<Socket>()
  const posts: FakeObserver['posts'] = []
  const server = createServer((req, res) => {
    const url = req.url ?? '/'
    const [path, query = ''] = url.split('?')
    if (req.method === 'POST') {
      let raw = ''
      req.on('data', (c: Buffer) => (raw += c.toString('utf-8')))
      req.on('end', () => {
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        posts.push({ path: path ?? url, body })
        if (!inGame) return json(res, 503, { ok: false, error: '未进入世界' })
        json(res, 200, { ok: true, command: body['command'] ?? undefined })
      })
      return
    }
    if (!inGame && path !== '/v1/health') return json(res, 503, { ok: false, error: '未进入世界' })
    const q = new URLSearchParams(query)
    if (path === '/v1/health') {
      return json(res, 200, {
        ok: true, mod: 'kunyu_observer', version: '3.0.0', minecraft: '1.20.1', protocol: 3,
        capabilities: ['snapshot', 'command', 'world-block'], inGame, now: 1
      })
    }
    if (path === '/v1/player') {
      return json(res, 200, {
        name: 'KunYu', uuid: 'u1', x: 0.5, y: 64, z: 0.5, yaw: 0, pitch: 0,
        health: 18, food: 20, onGround: true, selectedSlot: 0, gameMode: 'creative'
      })
    }
    if (path === '/v1/world') {
      const y = Number(q.get('y') ?? 0)
      return json(res, 200, {
        x: Number(q.get('x')), y, z: Number(q.get('z')),
        block: y >= 100 ? 'minecraft:air' : 'minecraft:stone', air: y >= 100
      })
    }
    if (path === '/v1/nearby') {
      const type = q.get('type') ?? ''
      const entities = type.includes('cow')
        ? [{ type: 'minecraft:cow', name: '牛', uuid: 'c1', x: 1, y: 64, z: 1, distance: 1 }]
        : []
      return json(res, 200, { radius: Number(q.get('radius') ?? 16), entities })
    }
    if (path === '/v1/chat') {
      return json(res, 200, { messages: ['<KunYu> hello', '[系统] 已生成红宝石'] })
    }
    json(res, 404, { ok: false, error: 'no route' })
  })
  return new Promise<FakeObserver>((resolveListener) => {
    server.on('connection', (s: Socket) => sockets.add(s))
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      resolveListener({
        port,
        posts,
        stop: () => {
          server.close()
          for (const s of sockets) s.destroy()
        }
      })
    })
  })
}

let fake: FakeObserver

beforeAll(async () => {
  fake = await startFakeObserver(true)
})
afterAll(() => fake.stop())

function scenarioRegistry(inGame = true): ToolRegistry {
  return createToolRegistry({
    observerProbe: (async () =>
      inGame
        ? { port: fake.port, health: { protocol: 3, inGame: true, capabilities: [], mod: 'kunyu_observer', version: '3.0.0', minecraft: '1.20.1', now: 1 } }
        : { port: fake.port, health: { protocol: 3, inGame: false, capabilities: [], mod: 'kunyu_observer', version: '3.0.0', minecraft: '1.20.1', now: 1 } }) as never
  })
}

/* ------------------------- fabric_mod_json_validate ------------------------- */

describe('fabric_mod_json_validate', () => {
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('标准项目通过', () => {
    const reg = mkProject()
    writeModJson(validModJson())
    return reg.executeTool('fabric_mod_json_validate', {}, CTX).then((r) => {
      expect(r.ok).toBe(true)
      expect(r.text).toContain('校验通过')
    })
  })

  it('无项目时不暴露；文件缺失报错', async () => {
    const none = createToolRegistry({})
    expect(none.getToolDefinitions().map((d) => d.function.name)).not.toContain('fabric_mod_json_validate')
    const reg = mkProject()
    const r = await reg.executeTool('fabric_mod_json_validate', {}, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('fabric.mod.json')
  })

  it('非法 JSON / id / schemaVersion 报错', async () => {
    const reg = mkProject()
    mkdirSync(join(root, 'src', 'main', 'resources'), { recursive: true })
    writeFileSync(join(root, 'src', 'main', 'resources', 'fabric.mod.json'), '{ broken')
    let r = await reg.executeTool('fabric_mod_json_validate', {}, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('合法 JSON')

    writeModJson({ ...validModJson(), schemaVersion: 2, id: 'Bad Id!' })
    r = await reg.executeTool('fabric_mod_json_validate', {}, CTX)
    expect(r.ok).toBe(false)
    expect(r.text).toContain('schemaVersion')
    expect(r.text).toContain('id 非法')
  })

  it('入口类文件不存在报错；fabricloader 低于 0.15 报错；缺 minecraft 报错', async () => {
    const reg = mkProject()
    writeModJson({
      ...validModJson(),
      entrypoints: { main: ['com.example.testmod.GhostMod'] },
      depends: { fabricloader: '>=0.14.0' }
    })
    const r = await reg.executeTool('fabric_mod_json_validate', {}, CTX)
    expect(r.ok).toBe(false)
    expect(r.text).toContain('入口类文件不存在')
    expect(r.text).toContain('0.15.0')
    expect(r.text).toContain('depends 缺少 minecraft')
  })

  it('mixins 引用文件缺失报错；文件存在则通过；environment 非法报错；缺 api/java 警告', async () => {
    const reg = mkProject()
    writeModJson({
      ...validModJson(),
      environment: 'both',
      depends: { fabricloader: '>=0.15.0', minecraft: '~1.20.1' },
      mixins: ['testmod.mixins.json']
    })
    let r = await reg.executeTool('fabric_mod_json_validate', {}, CTX)
    expect(r.ok).toBe(false)
    expect(r.text).toContain('配置文件不存在')
    expect(r.text).toContain('environment')

    writeFileSync(join(root, 'src', 'main', 'resources', 'testmod.mixins.json'), JSON.stringify({ package: 'com.example.testmod.mixin' }))
    writeModJson({
      ...validModJson(),
      depends: { fabricloader: '>=0.15.0', minecraft: '~1.20.1' },
      mixins: ['testmod.mixins.json']
    })
    r = await reg.executeTool('fabric_mod_json_validate', {}, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('fabric-api')
  })
})

/* ------------------------- fabric_log_debugger ------------------------- */

describe('fabric_log_debugger', () => {
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('粘贴 Mixin 崩溃报告 → 分类 mixin；无内容文本报错', async () => {
    const reg = createToolRegistry({})
    const crash = `---- Minecraft Crash Report ----
Description: Unexpected error

org.spongepowered.asm.mixin.injection.throwables.InvalidMixinException: @Inject method could not find target
\tat net.minecraft.client.MinecraftClient.handler(MinecraftClient.java:1)
`
    const r = await reg.executeTool('fabric_log_debugger', { customLog: crash }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('mixin')
    expect(r.text).toContain('InvalidMixinException')
    const empty = await reg.executeTool('fabric_log_debugger', { customLog: '一切正常，没有异常' }, CTX)
    expect(empty.ok).toBe(false)
  })

  it('无项目且无 customLog 报错', async () => {
    const r = await createToolRegistry({}).executeTool('fabric_log_debugger', {}, CTX)
    expect(r.ok).toBe(false)
  })

  it('优先读最新 crash report（缺类）；source=latest 时读 latest.log（重复注册）', async () => {
    const reg = mkProject()
    writeModJson({ id: 'testmod' })
    const crashDir = join(root, 'run', 'crash-reports')
    mkdirSync(crashDir, { recursive: true })
    writeFileSync(
      join(crashDir, 'crash-2025-01-01_00.00.00-client.txt'),
      `Description: Initializing game

java.lang.NoClassDefFoundError: software/bernie/geckolib/GeckoLib
\tat com.example.testmod.TestmodMod.onInitialize(TestmodMod.java:10)
`
    )
    const logDir = join(root, 'run', 'logs')
    mkdirSync(logDir, { recursive: true })
    writeFileSync(
      join(logDir, 'latest.log'),
      `[12:00:00] [main/INFO]: loading\n[12:00:01] [main/ERROR]: java.lang.IllegalStateException: Block testmod:ruby already registered\n`
    )

    const byCrash = await reg.executeTool('fabric_log_debugger', {}, CTX)
    expect(byCrash.ok).toBe(true)
    expect(byCrash.text).toContain('missing-dependency')
    expect(byCrash.text).toContain('crash-2025')

    const byLog = await reg.executeTool('fabric_log_debugger', { source: 'latest' }, CTX)
    expect(byLog.ok).toBe(true)
    expect(byLog.text).toContain('duplicate-registration')
    expect(byLog.text).toContain('already registered')
  })

  it('无任何日志时引导先运行游戏', async () => {
    const reg = mkProject()
    const r = await reg.executeTool('fabric_log_debugger', {}, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('一键运行')
  })
})

/* ------------------------- mc_test_scenario ------------------------- */

describe('mc_test_scenario', () => {
  const run = (args: Record<string, unknown>): Promise<ToolResult> =>
    scenarioRegistry().executeTool('mc_test_scenario', args, CTX)

  it('三工具注册；场景工具无需项目也暴露（依赖在线游戏）', () => {
    const reg = scenarioRegistry()
    for (const n of ['fabric_mod_json_validate', 'fabric_log_debugger', 'mc_test_scenario']) {
      expect(reg.has(n)).toBe(true)
    }
    const defs = createToolRegistry({}).getToolDefinitions().map((d) => d.function.name)
    expect(defs).toContain('mc_test_scenario')
    expect(defs).not.toContain('fabric_mod_json_validate')
  })

  it('离线软失败', async () => {
    const reg = createToolRegistry({ observerProbe: (async () => null) as never })
    const r = await reg.executeTool('mc_test_scenario', { steps: [{ op: 'state' }] }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('离线')
  })

  it('参数校验：空 steps / 超过 32 步 / 未进世界', async () => {
    expect((await run({ steps: [] })).ok).toBe(false)
    expect((await run({ steps: Array.from({ length: 33 }, () => ({ op: 'state' })) })).ok).toBe(false)
    const reg = scenarioRegistry(false)
    const r = await reg.executeTool('mc_test_scenario', { steps: [{ op: 'state' }] }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('进入世界')
  })

  it('全通过场景：command→setblock→wait→assert_block/entity/state/chat→state', async () => {
    const r = await run({
      name: '红宝石放块验证',
      steps: [
        { op: 'command', name: '给物品', command: '/give @s minecraft:diamond 1' },
        { op: 'setblock', x: 3, y: 64, z: 3, block: 'stone', mode: 'replace' },
        { op: 'wait', ms: 60 },
        { op: 'state' },
        { op: 'assert_block', name: '方块落地', x: 3, y: 64, z: 3, block: 'stone' },
        { op: 'assert_block', x: 3, y: 120, z: 3, air: true },
        { op: 'assert_entity', type: 'minecraft:cow', radius: 8, count: 1 },
        { op: 'assert_state', gameMode: 'creative', healthMin: 10 },
        { op: 'assert_chat', contains: '红宝石' }
      ]
    })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('全部通过')
    expect(r.data).toMatchObject({ passed: true, executed: 9, total: 9 })
    const cmds = fake.posts.filter((p) => p.path === '/v1/command').map((p) => p.body['command'])
    expect(cmds).toContain('give @s minecraft:diamond 1')
    const setPost = fake.posts.find((p) => p.path === '/v1/world')
    expect(setPost?.body).toMatchObject({ action: 'set_block', x: 3, y: 64, z: 3, block: 'minecraft:stone' })
  })

  it('断言失败 fail-fast：期望钻石块实际石头，后续步骤不执行', async () => {
    const r = await run({
      steps: [
        { op: 'command', command: 'time set day' },
        { op: 'assert_block', x: 1, y: 64, z: 1, block: 'diamond_block' },
        { op: 'state' }
      ]
    })
    expect(r.ok).toBe(false)
    expect(r.data).toMatchObject({ passed: false, failedAt: 2, executed: 2, total: 3 })
    expect(r.text).toContain('minecraft:diamond_block')
    expect(r.text).toContain('minecraft:stone')
  })

  it('管理性指令被拒；实体数量不符失败；累计等待超限', async () => {
    const stop = await run({ steps: [{ op: 'command', command: 'stop' }] })
    expect(stop.ok).toBe(false)
    expect(stop.text).toContain('管理性指令')
    const noPig = await run({ steps: [{ op: 'assert_entity', type: 'pig', radius: 16 }] })
    expect(noPig.ok).toBe(false)
    expect(noPig.text).toContain('数量=0')
    const tooLong = await run({
      steps: [
        { op: 'wait', ms: 5000 },
        { op: 'wait', ms: 5000 },
        { op: 'wait', ms: 5000 },
        { op: 'wait', ms: 5000 },
        { op: 'wait', ms: 5000 },
        { op: 'wait', ms: 5000 },
        { op: 'wait', ms: 5000 }
      ]
    })
    expect(tooLong.ok).toBe(false)
    expect(tooLong.text).toContain('累计等待')
  }, 36000)
})
