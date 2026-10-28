/**
 * P0b 游戏控制 FC 工具单测：用 node:http 起伪 kunyu-observer（protocol 3），
 * 验证 mc_state / mc_screenshot / mc_command / mc_chat / mc_world /
 * mc_observe_entity / mc_inventory / mc_input / mc_ensure_test_world 的
 * 协议映射、参数校验、离线与 503/429 软失败。
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Socket } from 'node:net'
import type { ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// 链路 toolRegistry → gradleService 会 import 真实 electron。其 index.js 在
// Node 下的形态是「default 导出二进制路径字符串，命名导出（app 等）全是
// undefined」，此处复刻该形态——不要 mock 成完整 API：app 为 undefined 是
// 本测试套件既有语义，给个真对象反而会激活从未执行过的代码路径。
// 注意本 mock 的边界：knowledgeSearch/mcDataService 里函数体内的裸
// require('electron') 不经 vite 模块图，mock 拦不住——真正的防线是 CI 在
// npm ci 后预置 path.txt + dist 桩（scripts/stub-electron-binary.cjs；
// electron 44 起无 postinstall，缺桩时 index.js 惰性 spawnSync 下载 ~100MB
// 二进制并冻结事件循环，墙钟判本文件同步测试超时）。
vi.mock('electron', () => ({ default: join(tmpdir(), `kunyu-fake-electron-${process.pid}`) }))
import { createToolRegistry, type ToolRegistryDeps } from '../toolRegistry'
import type { GameTestReport } from '../../../../shared/types/agent'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

function json(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(raw)
}

interface FakeHandle {
  port: number
  posts: Array<{ path: string; body: Record<string, unknown> }>
  gets: string[]
  setInGame: (v: boolean) => void
  stop: () => void
}

async function startFake(): Promise<FakeHandle> {
  const posts: FakeHandle['posts'] = []
  const gets: string[] = []
  const sockets = new Set<Socket>()
  let inGame = true
  const server = createServer((req, res) => {
    const url = req.url ?? '/'
    const [path, query = ''] = url.split('?')
    if (req.method === 'POST') {
      let raw = ''
      req.on('data', (c: Buffer) => (raw += c.toString('utf-8')))
      req.on('end', () => {
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        posts.push({ path: path ?? url, body })
        // 模拟输入护栏熔断（button=-1 在客户端校验允许，用作熔断触发信号）
        if (path === '/v1/input' && (body['type'] === 'denied' || body['button'] === -1)) {
          json(res, 429, { ok: false, error: '输入护栏熔断' })
          return
        }
        if (!inGame) {
          json(res, 503, { ok: false, error: '玩家尚未进入世界' })
          return
        }
        json(res, 200, { ok: true, command: body['command'] ?? undefined, selectedSlot: body['slot'] })
      })
      return
    }
    gets.push(url)
    if (!inGame && path !== '/v1/health') {
      json(res, 503, { ok: false, error: '玩家尚未进入世界' })
      return
    }
    const q = new URLSearchParams(query)
    switch (path) {
      case '/v1/health':
        json(res, 200, {
          ok: true,
          mod: 'kunyu_observer',
          version: '3.0.0',
          minecraft: '1.20.1',
          protocol: 3,
          capabilities: ['snapshot', 'command', 'select-slot', 'scroll', 'input', 'screenshot', 'world-block'],
          inGame,
          now: 1
        })
        break
      case '/v1/player':
        json(res, 200, {
          name: 'KunYu', uuid: 'u1', x: 1.5, y: 64, z: -3.25, yaw: 90, pitch: -10,
          health: 20, food: 18, onGround: true, selectedSlot: 0, gameMode: 'creative'
        })
        break
      case '/v1/snapshot':
        json(res, 200, {
          now: 42,
          player: {
            name: 'KunYu', uuid: 'u1', x: 1.5, y: 64, z: -3.25, yaw: 90, pitch: -10,
            health: 20, food: 18, onGround: true, selectedSlot: 0, gameMode: 'creative'
          },
          world: { time: 12000, timeOfDay: 6000, dimension: 'minecraft:overworld', raining: false },
          nearby: { radius: Number(q.get('radius') ?? 24), entities: [
            { type: 'minecraft:cow', name: '牛', uuid: 'c1', x: 2, y: 64, z: -2, distance: 1.5 }
          ] },
          chat: { messages: ['[服务器] hi'] },
          screen: { open: false },
          guard: { enabled: true, windowMs: 30000, maxEvents: 60, used: 1, remaining: 59, rejectedTotal: 0 }
        })
        break
      case '/v1/chat':
        json(res, 200, { messages: ['你好', '已保存'] })
        break
      case '/v1/nearby':
        json(res, 200, {
          radius: Number(q.get('radius') ?? 24),
          type: q.get('type') ?? undefined,
          entities: [
            { type: 'minecraft:cow', name: '牛', uuid: 'c1', x: 2, y: 64, z: -2, distance: 1.5 }
          ]
        })
        break
      case '/v1/inventory':
        json(res, 200, {
          selectedSlot: 2,
          slots: [{ slot: 0, id: 'minecraft:diamond_sword', name: '钻石剑', count: 1, damage: 0 }]
        })
        break
      case '/v1/screen':
        json(res, 200, { open: true, class: 'InventoryScreen', title: '物品栏', widgets: [] })
        break
      case '/v1/guard':
        json(res, 200, { enabled: true, windowMs: 30000, maxEvents: 60, used: 0, remaining: 60, rejectedTotal: 3 })
        break
      case '/v1/screenshot':
        json(res, 200, { mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', bytes: 1234 })
        break
      case '/v1/world':
        if (q.get('x') !== null) {
          json(res, 200, {
            x: Number(q.get('x')), y: Number(q.get('y')), z: Number(q.get('z')),
            block: 'minecraft:stone', air: false
          })
        } else {
          json(res, 200, {
            time: 1000, timeOfDay: 1000, dimension: 'minecraft:overworld',
            raining: false, thundering: false, bottomY: -64, topY: 320
          })
        }
        break
      default:
        json(res, 404, { ok: false, error: 'no route' })
    }
  })
  server.on('connection', (s: Socket) => sockets.add(s))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    port,
    posts,
    gets,
    setInGame: (v) => {
      inGame = v
    },
    stop: () => {
      server.close()
      for (const s of sockets) s.destroy()
    }
  }
}

describe('P0b 游戏控制 FC 工具', () => {
  let fake: FakeHandle

  beforeAll(async () => {
    fake = await startFake()
  })
  afterAll(() => fake.stop())

  const registryWith = (
    probe: () => Promise<{ port: number; health: { protocol?: number; inGame: boolean } } | null>,
    extra: ToolRegistryDeps = {}
  ) =>
    createToolRegistry({
      observerProbe: probe as never,
      ...extra
    })

  // CI 上 Windows runner 网络慢，createToolRegistry 可能触发 Electron 二进制下载导致超时
  test('12 个 mc_* 工具全部注册并暴露给 FC 循环', { timeout: 30000 }, () => {
    const reg = registryWith(async () => null)
    for (const name of [
      'mc_state', 'mc_screenshot', 'mc_command', 'mc_chat', 'mc_world',
      'mc_observe_entity', 'mc_inventory', 'mc_input', 'mc_ensure_test_world',
      'mc_cleanup_test_world', 'run_game_test', 'mc_launch'
    ]) {
      expect(reg.has(name)).toBe(true)
    }
    const defs = reg.getToolDefinitions().map((d) => d.function.name)
    expect(defs).toContain('mc_command')
    expect(defs).toContain('mc_ensure_test_world')
    expect(defs).toContain('mc_cleanup_test_world')
    expect(defs).toContain('run_game_test')
    expect(defs).toContain('mc_launch')
  })

  test('游戏离线时软失败，不抛异常', async () => {
    const reg = registryWith(async () => null)
    const r = await reg.executeTool('mc_state', {}, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('离线')
    const r2 = await reg.executeTool('mc_command', { command: 'say hi' }, CTX)
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('离线')
  })

  test('mc_state snapshot 聚合一次往返并格式化', async () => {
    const reg = registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: true } }))
    const r = await reg.executeTool('mc_state', { scope: 'snapshot' }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('KunYu')
    expect(r.text).toContain('minecraft:overworld')
    expect(r.text).toContain('minecraft:cow')
    expect(r.text).toContain('59/60')
  })

  test('mc_state 各单项 scope 走对应端点', async () => {
    const reg = registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: true } }))
    const player = await reg.executeTool('mc_state', { scope: 'player' }, CTX)
    expect(player.text).toContain('HP=20')
    const nearby = await reg.executeTool('mc_state', { scope: 'nearby', radius: 8, type: 'cow' }, CTX)
    expect(nearby.text).toContain('minecraft:cow')
    expect(fake.gets.some((g) => g.startsWith('/v1/nearby?') && g.includes('radius=8') && g.includes('type=cow'))).toBe(true)
    const chat = await reg.executeTool('mc_state', { scope: 'chat' }, CTX)
    expect(chat.text).toContain('你好')
    const inv = await reg.executeTool('mc_state', { scope: 'inventory' }, CTX)
    expect(inv.text).toContain('钻石剑')
    const screen = await reg.executeTool('mc_state', { scope: 'screen' }, CTX)
    expect(screen.text).toContain('InventoryScreen')
    const guard = await reg.executeTool('mc_state', { scope: 'guard' }, CTX)
    expect(guard.text).toContain('累计拒绝=3')
  })

  test('mc_screenshot 只回传元数据，dataUrl 不进文本', async () => {
    const reg = registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: true } }))
    const r = await reg.executeTool('mc_screenshot', {}, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('1234')
    expect(r.text).not.toContain('base64')
    expect(r.data).toMatchObject({ mime: 'image/png', bytes: 1234 })
  })

  test('mc_command 去前导斜杠并走 /v1/command；拒绝换行', async () => {
    const reg = registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: true } }))
    const r = await reg.executeTool('mc_command', { command: '/gamemode creative' }, CTX)
    expect(r.ok).toBe(true)
    const posted = fake.posts.find((p) => p.path === '/v1/command')
    expect(posted?.body['command']).toBe('gamemode creative')
    const bad = await reg.executeTool('mc_command', { command: 'say a\nsay b' }, CTX)
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('换行')
  })

  test('mc_chat 走 /v1/chat；以 / 开头被拒绝', async () => {
    const reg = registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: true } }))
    const r = await reg.executeTool('mc_chat', { message: '大家好' }, CTX)
    expect(r.ok).toBe(true)
    expect(fake.posts.some((p) => p.path === '/v1/chat' && p.body['message'] === '大家好')).toBe(true)
    const bad = await reg.executeTool('mc_chat', { message: '/gamemode creative' }, CTX)
    expect(bad.ok).toBe(false)
  })

  test('mc_world：env / get_block / set_block 协议映射与校验', async () => {
    const reg = registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: true } }))
    const env = await reg.executeTool('mc_world', { action: 'env' }, CTX)
    expect(env.ok).toBe(true)
    expect(env.text).toContain('维度=minecraft:overworld')
    const get = await reg.executeTool('mc_world', { action: 'get_block', x: 1, y: 64, z: 2 }, CTX)
    expect(get.text).toContain('(1,64,2) = minecraft:stone')
    expect(fake.gets.some((g) => g.startsWith('/v1/world?') && g.includes('x=1') && g.includes('y=64'))).toBe(true)
    const set = await reg.executeTool(
      'mc_world',
      { action: 'set_block', x: 1.5, y: 64, z: 2, block: 'stone', mode: 'keep' },
      CTX
    )
    expect(set.ok).toBe(true)
    const wp = fake.posts.filter((p) => p.path === '/v1/world').at(-1)
    expect(wp?.body).toMatchObject({ action: 'set_block', x: 1, y: 64, z: 2, block: 'minecraft:stone', mode: 'keep' })
    const badId = await reg.executeTool(
      'mc_world',
      { action: 'set_block', x: 0, y: 0, z: 0, block: '不是方块!!' },
      CTX
    )
    expect(badId.ok).toBe(false)
    const noPos = await reg.executeTool('mc_world', { action: 'get_block' }, CTX)
    expect(noPos.ok).toBe(false)
  })

  test('mc_observe_entity 带类型与半径参数', async () => {
    const reg = registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: true } }))
    const r = await reg.executeTool('mc_observe_entity', { type: 'minecraft:cow', radius: 10, limit: 5 }, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('uuid=c1')
    expect(fake.gets.some((g) => g.includes('/v1/nearby?') && g.includes('radius=10') && g.includes('limit=5'))).toBe(true)
  })

  test('mc_inventory 列出槽位', async () => {
    const reg = registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: true } }))
    const r = await reg.executeTool('mc_inventory', {}, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('槽0')
    expect(r.data).toMatchObject({ selectedSlot: 2, slots: [{ slot: 0 }] })
  })

  test('mc_input 六类注入与参数校验；429 转护栏软失败', async () => {
    const reg = registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: true } }))
    expect((await reg.executeTool('mc_input', { kind: 'look', yaw: 180, pitch: 200 }, CTX)).ok).toBe(true)
    const lookPost = fake.posts.filter((p) => p.path === '/v1/look').at(-1)
    // pitch 被夹到 90
    expect(lookPost?.body).toMatchObject({ yaw: 180, pitch: 90 })

    expect((await reg.executeTool('mc_input', { kind: 'hotbar', slot: 8 }, CTX)).ok).toBe(true)
    expect((await reg.executeTool('mc_input', { kind: 'hotbar', slot: 9 }, CTX)).ok).toBe(false)

    expect((await reg.executeTool('mc_input', { kind: 'key', key: 257 }, CTX)).ok).toBe(true)
    const keyPost = fake.posts.filter((p) => p.path === '/v1/input').at(-1)
    expect(keyPost?.body).toMatchObject({ type: 'key', key: 257, action: 1 })

    expect((await reg.executeTool('mc_input', { kind: 'char', codePoint: 65 }, CTX)).ok).toBe(true)
    expect((await reg.executeTool('mc_input', { kind: 'mouse', button: 0 }, CTX)).ok).toBe(true)
    expect((await reg.executeTool('mc_input', { kind: 'scroll', vertical: -1 }, CTX)).ok).toBe(true)
    expect((await reg.executeTool('mc_input', { kind: 'key' }, CTX)).ok).toBe(false)

    // 429：护栏熔断归一化为停止注入的软失败文案
    const denied = await reg.executeTool('mc_input', { kind: 'mouse', button: -1 }, CTX)
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('护栏')
  })

  test('mc_ensure_test_world：未进世界引导；进世界后下发默认与可选指令', async () => {
    fake.setInGame(false)
    const reg0 = registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: false } }))
    const notIn = await reg0.executeTool('mc_ensure_test_world', {}, CTX)
    expect(notIn.ok).toBe(false)
    expect(notIn.error).toContain('进入世界')

    fake.setInGame(true)
    const before = fake.posts.length
    const reg = registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: true } }))
    const r = await reg.executeTool('mc_ensure_test_world', { difficulty: 'normal', clearEntities: true }, CTX)
    expect(r.ok).toBe(true)
    const sent = fake.posts.slice(before).filter((p) => p.path === '/v1/command').map((p) => p.body['command'])
    expect(sent).toEqual([
      'gamemode creative',
      'time set day',
      'weather clear',
      'difficulty normal',
      'kill @e[type=!player]'
    ])
    expect(r.text).toContain('seed')
  })

  test('mc_cleanup_test_world：清实体+复位；blocks 回滚为空气；非法坐标不半清理；离线/未进世界软失败', async () => {
    const reg = registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: true } }))
    const before = fake.posts.length
    const r = await reg.executeTool('mc_cleanup_test_world', { blocks: [{ x: 1, y: 64, z: 2 }] }, CTX)
    expect(r.ok).toBe(true)
    const sent = fake.posts.slice(before)
    expect(sent.filter((p) => p.path === '/v1/command').map((p) => p.body['command'])).toEqual([
      'gamemode creative',
      'time set day',
      'weather clear',
      'kill @e[type=!player]'
    ])
    expect(sent.filter((p) => p.path === '/v1/world').map((p) => p.body)).toEqual([
      { action: 'set_block', x: 1, y: 64, z: 2, block: 'minecraft:air', mode: 'replace' }
    ])

    // 全部关闭 → 不下发任何指令
    const before2 = fake.posts.length
    await reg.executeTool('mc_cleanup_test_world', { entities: false, resetState: false }, CTX)
    expect(fake.posts.slice(before2).length).toBe(0)

    // 非法坐标 → 先校验后不发任何指令（避免半清理）
    const before3 = fake.posts.length
    const bad = await reg.executeTool('mc_cleanup_test_world', { blocks: [{ x: 1 }] }, CTX)
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('坐标')
    expect(fake.posts.slice(before3).length).toBe(0)

    // 未进世界 → 软失败
    fake.setInGame(false)
    const notIn = await registryWith(async () => ({ port: fake.port, health: { protocol: 3, inGame: false } }))
      .executeTool('mc_cleanup_test_world', {}, CTX)
    expect(notIn.ok).toBe(false)
    expect(notIn.error).toContain('进入世界')
    fake.setInGame(true)

    // 离线 → 软失败
    const offline = await registryWith(async () => null).executeTool('mc_cleanup_test_world', {}, CTX)
    expect(offline.ok).toBe(false)
    expect(offline.error).toContain('离线')
  })

  test('run_game_test：无项目软失败；注入 runner 后映射通过/失败/跳过', async () => {
    // 无 projectRoot → 软失败
    const noProj = await registryWith(async () => null).executeTool('run_game_test', {}, CTX)
    expect(noProj.ok).toBe(false)
    expect(noProj.error).toContain('无打开项目')

    const reportOf = (status: 'pass' | 'fail' | 'skipped'): GameTestReport => ({
      status,
      passed: status === 'fail' ? ['test_a'] : status === 'pass' ? ['test_a', 'test_b'] : [],
      failed: status === 'fail' ? [{ name: 'test_b', error: '断言失败' }] : [],
      summary: status === 'pass' ? 'All required tests passed!' : status === 'fail' ? 'Tests: 1 passed, 1 failed' : '未识别到 GameTest 输出',
      durationMs: 1234
    })

    const mkReg = (status: 'pass' | 'fail' | 'skipped') =>
      registryWith(async () => null, {
        projectRoot: () => 'D:/proj',
        runGameTest: async () => reportOf(status)
      })

    const pass = await mkReg('pass').executeTool('run_game_test', {}, CTX)
    expect(pass.ok).toBe(true)
    expect(pass.text).toContain('GameTest 通过')
    expect(pass.data).toMatchObject({ status: 'pass', passed: 2, failed: 0 })

    const fail = await mkReg('fail').executeTool('run_game_test', { timeoutMs: 999999 }, CTX)
    expect(fail.ok).toBe(false)
    expect(fail.text).toContain('GameTest 失败')
    expect(fail.text).toContain('断言失败')
    expect(fail.data).toMatchObject({ status: 'fail', failed: 1 })

    const skipped = await mkReg('skipped').executeTool('run_game_test', {}, CTX)
    expect(skipped.ok).toBe(false)
    expect(skipped.text).toContain('GameTest 未运行')
  })

  test('mc_launch：已在线不重复启动；未注入引导；注入后启动；无项目软失败', async () => {
    // 观察通道已在线 → 直接回报，不调 launcher
    let launched = 0
    const online = await registryWith(
      async () => ({ port: fake.port, health: { protocol: 3, inGame: true } }),
      { launchDevClient: async () => { launched++; return { ok: true, text: 'x' } } }
    ).executeTool('mc_launch', {}, CTX)
    expect(online.ok).toBe(true)
    expect(online.text).toContain('已在运行')
    expect(launched).toBe(0)

    // 离线 + 未注入 launcher → 引导文案
    const guided = await registryWith(async () => null, { projectRoot: () => 'D:/proj' }).executeTool('mc_launch', {}, CTX)
    expect(guided.ok).toBe(false)
    expect(guided.error).toContain('一键运行')

    // 离线 + 注入 launcher → 调用并回报
    let called = 0
    const launchedOk = await registryWith(async () => null, {
      projectRoot: () => 'D:/proj',
      launchDevClient: async () => { called++; return { ok: true, text: '已启动' } }
    }).executeTool('mc_launch', {}, CTX)
    expect(launchedOk.ok).toBe(true)
    expect(launchedOk.text).toContain('已启动')
    expect(called).toBe(1)

    // 无项目 → 软失败
    const noProj = await registryWith(async () => null, {
      launchDevClient: async () => ({ ok: true, text: 'x' })
    }).executeTool('mc_launch', {}, CTX)
    expect(noProj.ok).toBe(false)
    expect(noProj.error).toContain('无打开项目')
  })
})
