/**
 * observerClient 单测：用 node:http 起一个伪 kunyu-observer 服务验证协议，
 * 包括端口探测、只读查询、注入 POST 与 429 熔断、超时降级。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { AddressInfo, Socket } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ObserverError,
  fetchBlockAt,
  fetchGuardStats,
  fetchInventory,
  fetchNearbyEntities,
  fetchObserverSnapshot,
  fetchPlayerState,
  fetchRecentChat,
  fetchScreenshot,
  fetchScreen,
  fetchWorldEnv,
  probeObserver,
  runObserverCommand,
  selectHotbarSlot,
  sendInput,
  setBlockAt,
  setLook
} from '../observerClient'
import { findBuiltAgentJar, OBSERVER_AGENT_JAR_NAME } from '../observerInstaller'

/** 简易路由伪服务。 */
async function startFakeObserver(): Promise<{ port: number; posts: Array<{ path: string; body: unknown }>; gets: string[]; stop: () => void }> {
  const posts: Array<{ path: string; body: unknown }> = []
  const gets: string[] = []
  const sockets = new Set<Socket>()
  const server = createServer((req, res: ServerResponse, ) => {
    const url = req.url ?? '/'
    if (req.method === 'POST') {
      let raw = ''
      req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf-8')))
      req.on('end', () => {
        let body: unknown = {}
        try {
          body = raw ? JSON.parse(raw) : {}
        } catch {
          // 保持空对象
        }
        posts.push({ path: url.split('?')[0] ?? url, body })
        // select-slot 回显槽位，world 回显指令，其余通用 ok
        const p0 = url.split('?')[0] ?? url
        if (p0 === '/v1/select-slot') {
          json(res, 200, { ok: true, selectedSlot: (body as { slot?: number }).slot ?? 0 })
        } else if (p0 === '/v1/world') {
          const b = body as { x?: number; y?: number; z?: number; block?: string; mode?: string }
          json(res, 200, { ok: true, command: `setblock ${b.x} ${b.y} ${b.z} ${b.block} ${b.mode ?? 'replace'}` })
        } else {
          json(res, 200, { ok: true })
        }
      })
      return
    }

    gets.push(url)
    const path = url.split('?')[0] ?? url
    switch (path) {
      case '/v1/health':
        json(res, 200, { ok: true, mod: 'kunyu_observer', version: '2.0.0', minecraft: '1.20.1', protocol: 2, capabilities: ['snapshot', 'command', 'select-slot', 'scroll', 'input', 'screenshot'], inGame: true, now: 1 })
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
          nearby: { radius: 24, entities: [] },
          chat: { messages: ['第一条'] },
          screen: { open: false },
          guard: { enabled: true, windowMs: 30000, maxEvents: 60, used: 0, remaining: 60, rejectedTotal: 0 }
        })
        break
      case '/v1/screenshot':
        json(res, 200, { mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', bytes: 4 })
        break
      case '/v1/chat':
        json(res, 200, { messages: ['你好', '已保存游戏'] })
        break
      case '/v1/nearby':
        json(res, 200, { radius: 24, entities: [{ type: 'minecraft:pig', name: '猪', uuid: 'e1', x: 2, y: 64, z: -3, distance: 0.71 }] })
        break
      case '/v1/inventory':
        json(res, 200, { selectedSlot: 1, slots: [{ slot: 0, id: 'minecraft:diamond_sword', name: '钻石剑', count: 1, damage: 0 }] })
        break
      case '/v1/screen':
        json(res, 200, { open: true, class: 'TitleScreen', title: 'Minecraft', widgets: [{ class: 'ButtonWidget', text: '单人游戏', x: 10, y: 20, width: 100, height: 20, enabled: true, visible: true }] })
        break
      case '/v1/guard-stats':
        json(res, 200, { enabled: true, windowMs: 30000, maxEvents: 60, used: 1, remaining: 59, rejectedTotal: 0 })
        break
      case '/v1/guard':
        json(res, 200, { enabled: true, windowMs: 30000, maxEvents: 60, used: 1, remaining: 59, rejectedTotal: 0 })
        break
      case '/v1/world': {
        const wq = new URLSearchParams(url.split('?')[1] ?? '')
        if (wq.get('x') !== null) {
          json(res, 200, {
            x: Number(wq.get('x')), y: Number(wq.get('y')), z: Number(wq.get('z')),
            block: 'minecraft:stone', air: false
          })
        } else {
          json(res, 200, {
            time: 1000, timeOfDay: 1000, dimension: 'minecraft:overworld',
            raining: false, thundering: false, bottomY: -64, topY: 320
          })
        }
        break
      }
      default:
        json(res, 404, { ok: false, error: 'no route' })
    }
  })
  // 记录连接以便强制关闭挂起的请求
  server.on('connection', (socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    posts,
    gets,
    stop: () => {
      for (const s of sockets) s.destroy()
      server.close()
    }
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf-8')
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

describe('observerClient 协议', () => {
  let fake: Awaited<ReturnType<typeof startFakeObserver>>

  beforeAll(async () => {
    fake = await startFakeObserver()
  })
  afterAll(() => fake.stop())

  test('health 探测命中正确 mod', async () => {
    const endpoint = await probeObserver({ basePort: fake.port, portCount: 1, timeoutMs: 500 })
    expect(endpoint).not.toBeNull()
    expect(endpoint?.port).toBe(fake.port)
    expect(endpoint?.health.mod).toBe('kunyu_observer')
  })

  test('玩家状态字段完整', async () => {
    const p = await fetchPlayerState(fake.port)
    expect(p.name).toBe('KunYu')
    expect(p.gameMode).toBe('creative')
    expect(p.health).toBe(20)
  })

  test('截图 / 聊天 / 实体 / 背包 / 屏幕解析', async () => {
    const shot = await fetchScreenshot(fake.port)
    expect(shot.dataUrl).toMatch(/^data:image\/png;base64,/)

    const chat = await fetchRecentChat(fake.port, 10)
    expect(chat.messages).toHaveLength(2)

    const nearby = await fetchNearbyEntities(fake.port)
    expect(nearby.entities[0]?.type).toBe('minecraft:pig')

    const inv = await fetchInventory(fake.port)
    expect(inv.slots[0]?.id).toBe('minecraft:diamond_sword')
    expect(inv.selectedSlot).toBe(1)

    const screen = await fetchScreen(fake.port)
    expect(screen.open).toBe(true)
    expect(screen.widgets?.[0]?.text).toBe('单人游戏')

    const guard = await fetchGuardStats(fake.port)
    expect(guard.remaining).toBe(59)
  })

  test('视角 / 命令 / 输入 POST 到正确路径且带载荷', async () => {
    await setLook(fake.port, 180, 45)
    await runObserverCommand(fake.port, '/gamemode creative')
    await sendInput(fake.port, { type: 'key', key: 257, action: 1 })
    await sendInput(fake.port, { type: 'char', codePoint: 97 })
    await sendInput(fake.port, { type: 'mouse', button: 0 })
    await sendInput(fake.port, { type: 'scroll', vertical: -1 })

    const paths = fake.posts.map((p) => p.path)
    expect(paths).toEqual([
      '/v1/look',
      '/v1/command', // v2：命令走专用端点
      '/v1/input',
      '/v1/input',
      '/v1/input',
      '/v1/input'
    ])
    expect(fake.posts[0]?.body).toMatchObject({ yaw: 180, pitch: 45 })
    expect(fake.posts[1]?.body).toMatchObject({ command: '/gamemode creative' })
    expect(fake.posts[2]?.body).toMatchObject({ type: 'key', key: 257, action: 1 })
    expect(fake.posts[4]?.body).toMatchObject({ type: 'mouse', button: 0 })
    expect(fake.posts[5]?.body).toMatchObject({ type: 'scroll', vertical: -1 })
  })

  test('v3 世界环境 / 方块查询 / setblock', async () => {
    const env = await fetchWorldEnv(fake.port)
    expect(env.dimension).toBe('minecraft:overworld')
    expect(env.bottomY).toBe(-64)

    const block = await fetchBlockAt(fake.port, { x: 1.9, y: 64, z: 2 })
    expect(block.block).toBe('minecraft:stone')
    expect(block.air).toBe(false)
    // 坐标在客户端截断为整数并进入查询串
    expect(fake.gets.some((g) => g.startsWith('/v1/world?') && g.includes('x=1') && g.includes('y=64') && g.includes('z=2'))).toBe(true)

    const r = await setBlockAt(fake.port, { x: 3, y: 64, z: 4 }, 'minecraft:stone', 'keep')
    expect(r.command).toBe('setblock 3 64 4 minecraft:stone keep')
    const posted = fake.posts.find((p) => p.path === '/v1/world')
    expect(posted?.body).toMatchObject({ action: 'set_block', x: 3, y: 64, z: 4, block: 'minecraft:stone', mode: 'keep' })
  })

  test('v2 聚合快照字段完整', async () => {
    const snap = await fetchObserverSnapshot(fake.port, { radius: 16, type: 'cow', widgets: true })
    expect(snap.player.name).toBe('KunYu')
    expect(snap.world.dimension).toBe('minecraft:overworld')
    expect(snap.world.time).toBe(12000)
    expect(snap.chat.messages).toEqual(['第一条'])
    expect(snap.screen.open).toBe(false)
    expect(snap.guard.remaining).toBe(60)
    // 查询参数透传
    const lastGet = [...fake.gets].reverse().find((u) => u.startsWith('/v1/snapshot'))
    expect(lastGet).toContain('radius=16')
    expect(lastGet).toContain('type=cow')
    expect(lastGet).toContain('widgets=1')
  })

  test('命令在 protocol=1 旧版回退 /v1/chat', async () => {
    await runObserverCommand(fake.port, 'say hi', { protocol: 1 })
    const post = fake.posts[fake.posts.length - 1]
    expect(post?.path).toBe('/v1/chat')
    expect(post?.body).toMatchObject({ command: 'say hi' })
  })

  test('select-slot 回显选中槽位；nearby 类型过滤拼进 query', async () => {
    const res = await selectHotbarSlot(fake.port, 3)
    expect(res.selectedSlot).toBe(3)
    expect(fake.posts[fake.posts.length - 1]?.path).toBe('/v1/select-slot')

    await fetchNearbyEntities(fake.port, 12, 5, 'minecraft:cow')
    const lastNearby = [...fake.gets].reverse().find((u) => u.startsWith('/v1/nearby'))
    expect(lastNearby).toContain('type=minecraft%3Acow')
    expect(lastNearby).toContain('radius=12')
  })

  test('离线端口探测返回 null（不抛异常）', async () => {
    const endpoint = await probeObserver({ basePort: 9899, portCount: 1, timeoutMs: 100 })
    expect(endpoint).toBeNull()
  })

  test('非 2xx 抛带状态码的 ObserverError', async () => {
    // 用一个返回 429 的迷你服务模拟护栏熔断
    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      json(res, 429, { ok: false, error: '输入护栏熔断' })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      await expect(sendInput(port, { type: 'key', key: 1 })).rejects.toMatchObject({
        name: 'ObserverError',
        status: 429
      })
    } finally {
      server.close()
    }
  })

  test('请求超时抛 ObserverError 且不挂死', async () => {
    // 永不响应的服务
    const server = createServer(() => undefined)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    try {
      let caught: unknown = null
      try {
        await fetchPlayerState(port, 100)
      } catch (e) {
        caught = e
      }
      expect(caught).toBeInstanceOf(ObserverError)
      expect((caught as ObserverError).message).toContain('超时')
    } finally {
      server.close()
    }
  })
})

describe('observerInstaller（javaagent 形态：只读定位，无 mods 复制）', () => {
  test('找不到产物时返回 null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kunyu-observer-empty-'))
    expect(findBuiltAgentJar(dir)).toBeNull()
  })

  test('固定文件名定位 agent jar', () => {
    const work = mkdtempSync(join(tmpdir(), 'kunyu-observer-agent-'))
    const dist = join(work, 'dist')
    mkdirSync(dist, { recursive: true })
    const jar = join(dist, OBSERVER_AGENT_JAR_NAME)
    writeFileSync(jar, 'fake-jar')
    expect(findBuiltAgentJar(dist)).toBe(jar)
    // 干扰项：其他 jar 不影响定位
    writeFileSync(join(dist, 'kunyu-observer-1.0.0.jar'), 'legacy-mod')
    expect(findBuiltAgentJar(dist)).toBe(jar)
  })
})
