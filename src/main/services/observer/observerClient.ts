/**
 * kunyu-observer-agent 观察端的 HTTP 客户端（主进程侧）。
 *
 * 对端是 resources/observer-agent（JVM javaagent，覆盖 Fabric/Forge/NeoForge 与
 * MC 全版本，不再是 mod），仅监听 127.0.0.1。
 * 本模块只负责协议：健康探测（端口扫描 9876–9886）、只读查询、受控输入注入。
 * 所有请求都带超时，游戏未启动 / 未挂 agent 时返回 null 或抛 ObserverError，绝不挂死流水线。
 */
import { getCurrentObserverToken } from './observerToken'

/** observer 默认端口段（agent 可用 agent 参数 port= 覆盖）。 */
export const OBSERVER_PORT_BASE = 9876
export const OBSERVER_PORT_COUNT = 11 // 9876..9886

/** GET /v1/health 返回体。 */
export interface ObserverHealth {
  ok: boolean
  mod: string
  version: string
  minecraft: string
  /** 协议版本：旧版可能缺省（按 1 处理），2 起支持 snapshot/command/select-slot/scroll；
   * 3 起增加 GET/POST /v1/world（world-block 能力） */
  protocol?: number
  /** v2+：服务端能力声明（snapshot/command/select-slot/scroll/input/screenshot；v3 增 world-block） */
  capabilities?: string[]
  inGame: boolean
  now: number
}

/** GET /v1/player 返回体。 */
export interface ObserverPlayerState {
  name: string
  uuid: string
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  health: number
  food: number
  onGround: boolean
  selectedSlot: number
  gameMode: string
}

/** GET /v1/screenshot 返回体（默认 data URL）。 */
export interface ObserverScreenshot {
  mime: 'image/png'
  dataUrl: string
  bytes: number
}

/** GET /v1/nearby 中的实体条目。 */
export interface ObserverEntity {
  type: string
  name: string
  uuid: string
  x: number
  y: number
  z: number
  distance: number
}

/** GET /v1/inventory 中的槽位条目。 */
export interface ObserverSlot {
  slot: number
  id: string
  name: string
  count: number
  damage: number
}

/** GET /v1/screen 返回体。 */
export interface ObserverScreen {
  open: boolean
  class?: string
  title?: string
  widgets?: ObserverWidget[]
}

export interface ObserverWidget {
  class: string
  text: string
  x: number
  y: number
  width: number
  height: number
  enabled: boolean
  visible: boolean
}

/** GET /v1/guard 护栏状态。 */
export interface ObserverGuardStats {
  enabled: boolean
  windowMs: number
  maxEvents: number
  used: number
  remaining: number
  rejectedTotal: number
}

/** 探测成功结果。 */
export interface ObserverEndpoint {
  port: number
  health: ObserverHealth
}

/** 协议层错误（含 HTTP 状态码，便于区分 429 熔断 / 503 未进世界）。 */
export class ObserverError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly endpoint?: string
  ) {
    super(message)
    this.name = 'ObserverError'
  }
}

interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

/** 带超时的 JSON 请求；非 2xx 统一抛 ObserverError。 */
async function requestJson<T>(
  port: number,
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  options: RequestOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 3000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onAbort)
  try {
    let res: Response
    try {
      res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: init.method ?? 'GET',
        headers: (() => {
          // S-05：附带 observer 令牌（runClient 时由主进程注入游戏 JVM）
          const token = getCurrentObserverToken()
          const h: Record<string, string> = token ? { 'X-Observer-Token': token } : {}
          if (init.body !== undefined) h['Content-Type'] = 'application/json'
          return Object.keys(h).length ? h : undefined
        })(),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal
      })
    } catch (err) {
      // 连接拒绝 / 超时都视为「对端不可达」，交由上层决定降级
      throw new ObserverError(
        `observer ${path} 请求失败：${(err as Error).name === 'AbortError' ? `超时（${timeoutMs}ms）` : (err as Error).message}`,
        undefined,
        path
      )
    }
    const raw = await res.text()
    if (!res.ok) {
      let detail = raw
      try {
        detail = (JSON.parse(raw) as { error?: string }).error ?? raw
      } catch {
        // 非 JSON 错误体时保留原文
      }
      throw new ObserverError(`observer ${path} ${res.status}：${detail}`, res.status, path)
    }
    try {
      return JSON.parse(raw) as T
    } catch {
      throw new ObserverError(`observer ${path} 返回非 JSON：${raw.slice(0, 200)}`, res.status, path)
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * 扫描 9876–9886 上的 kunyu-observer 服务。
 * @param timeoutMs 单端口探测超时（默认 400ms）
 * @returns 第一个命中的端口与健康信息；全部不在线返回 null
 */
export async function probeObserver(
  options: { basePort?: number; portCount?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<ObserverEndpoint | null> {
  const base = options.basePort ?? OBSERVER_PORT_BASE
  const count = options.portCount ?? OBSERVER_PORT_COUNT
  const timeoutMs = options.timeoutMs ?? 400
  for (let port = base; port < base + count; port++) {
    try {
      const health = await requestJson<ObserverHealth>(port, '/v1/health', {}, { timeoutMs })
      if (health.ok && health.mod === 'kunyu_observer') {
        return { port, health }
      }
    } catch {
      // 端口不在线，继续扫下一个
    }
  }
  return null
}

// ----------------------------------------------------------------------
// 只读查询
// ----------------------------------------------------------------------

export async function fetchPlayerState(port: number, timeoutMs = 3000): Promise<ObserverPlayerState> {
  return requestJson<ObserverPlayerState>(port, '/v1/player', {}, { timeoutMs })
}

export async function fetchScreenshot(port: number, timeoutMs = 6000): Promise<ObserverScreenshot> {
  return requestJson<ObserverScreenshot>(port, '/v1/screenshot', {}, { timeoutMs })
}

export async function fetchRecentChat(
  port: number,
  limit = 50,
  timeoutMs = 3000
): Promise<{ messages: string[] }> {
  return requestJson<{ messages: string[] }>(port, `/v1/chat?limit=${limit}`, {}, { timeoutMs })
}

export async function fetchNearbyEntities(
  port: number,
  radius = 24,
  limit = 32,
  typeFilter?: string,
  timeoutMs = 3000
): Promise<{ radius: number; type?: string; entities: ObserverEntity[] }> {
  const params = new URLSearchParams({
    radius: String(radius),
    limit: String(limit)
  })
  // v2：cow / minecraft:cow 都可，mod 侧会补命名空间
  if (typeFilter) params.set('type', typeFilter)
  return requestJson<{ radius: number; type?: string; entities: ObserverEntity[] }>(
    port,
    `/v1/nearby?${params.toString()}`,
    {},
    { timeoutMs }
  )
}

/** GET /v1/snapshot 聚合体（v2）。 */
export interface ObserverSnapshot {
  now: number
  player: ObserverPlayerState
  world: {
    time: number
    timeOfDay: number
    dimension: string
    raining: boolean
  }
  nearby: { radius: number; type?: string; entities: ObserverEntity[] }
  chat: { messages: string[] }
  screen: ObserverScreen
  guard: ObserverGuardStats
}

export interface SnapshotOptions {
  radius?: number
  entityLimit?: number
  chatLimit?: number
  /** 实体类型过滤（如 'cow'） */
  type?: string
  /** 是否附带屏幕控件树（默认只要屏幕摘要） */
  widgets?: boolean
  timeoutMs?: number
}

/**
 * v2 聚合快照：一次往返拿玩家/世界/实体/聊天/屏幕/护栏。
 * 旧版 mod（health.protocol < 2）没有此端点，调用方应先看 probeObserver 的 health。
 */
export async function fetchObserverSnapshot(
  port: number,
  options: SnapshotOptions = {}
): Promise<ObserverSnapshot> {
  const params = new URLSearchParams()
  if (options.radius !== undefined) params.set('radius', String(options.radius))
  if (options.entityLimit !== undefined) params.set('entityLimit', String(options.entityLimit))
  if (options.chatLimit !== undefined) params.set('chatLimit', String(options.chatLimit))
  if (options.type) params.set('type', options.type)
  if (options.widgets) params.set('widgets', '1')
  const qs = params.toString()
  return requestJson<ObserverSnapshot>(
    port,
    qs ? `/v1/snapshot?${qs}` : '/v1/snapshot',
    {},
    { timeoutMs: options.timeoutMs ?? 4000 }
  )
}

export async function fetchInventory(
  port: number,
  timeoutMs = 3000
): Promise<{ selectedSlot: number; slots: ObserverSlot[] }> {
  return requestJson<{ selectedSlot: number; slots: ObserverSlot[] }>(port, '/v1/inventory', {}, { timeoutMs })
}

export async function fetchScreen(port: number, timeoutMs = 3000): Promise<ObserverScreen> {
  return requestJson<ObserverScreen>(port, '/v1/screen', {}, { timeoutMs })
}

export async function fetchGuardStats(port: number, timeoutMs = 2000): Promise<ObserverGuardStats> {
  return requestJson<ObserverGuardStats>(port, '/v1/guard', {}, { timeoutMs })
}

/** GET /v1/world 无参返回的世界环境（v3）。 */
export interface ObserverWorldEnv {
  time: number
  timeOfDay: number
  dimension: string
  raining: boolean
  thundering?: boolean
  bottomY?: number
  topY?: number
}

/** GET /v1/world?x=&y=&z= 返回的方块信息（v3）。 */
export interface ObserverBlockInfo {
  x: number
  y: number
  z: number
  block: string
  air: boolean
}

/** 整数坐标。 */
export interface BlockPos {
  x: number
  y: number
  z: number
}

/** v3：读取世界环境（时间/维度/天气）。 */
export async function fetchWorldEnv(port: number, timeoutMs = 3000): Promise<ObserverWorldEnv> {
  return requestJson<ObserverWorldEnv>(port, '/v1/world', {}, { timeoutMs })
}

/** v3：读取指定坐标方块（直接读客户端世界，不消耗指令权限）。 */
export async function fetchBlockAt(
  port: number,
  pos: BlockPos,
  timeoutMs = 3000
): Promise<ObserverBlockInfo> {
  const qs = new URLSearchParams({
    x: String(Math.trunc(pos.x)),
    y: String(Math.trunc(pos.y)),
    z: String(Math.trunc(pos.z))
  })
  return requestJson<ObserverBlockInfo>(port, `/v1/world?${qs.toString()}`, {}, { timeoutMs })
}

/** setblock 的方块处理模式，对应原版指令参数。 */
export type SetBlockMode = 'replace' | 'destroy' | 'keep'

/**
 * v3：放置方块（mod 侧经服务端 setblock 指令下发，需要创造/指令权限）。
 * @returns 实际下发的指令文本
 */
export async function setBlockAt(
  port: number,
  pos: BlockPos,
  block: string,
  mode: SetBlockMode = 'replace'
): Promise<{ ok: true; command: string }> {
  return requestJson<{ ok: true; command: string }>(port, '/v1/world', {
    method: 'POST',
    body: {
      action: 'set_block',
      x: Math.trunc(pos.x),
      y: Math.trunc(pos.y),
      z: Math.trunc(pos.z),
      block,
      mode
    }
  })
}

// ----------------------------------------------------------------------
// 受控写入（注入）
// ----------------------------------------------------------------------

/** 设置玩家视角（pitch 由 mod 侧夹在 ±90）。 */
export async function setLook(port: number, yaw: number, pitch: number): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(port, '/v1/look', { method: 'POST', body: { yaw, pitch } })
}

/** 发送聊天消息。 */
export async function sendChatMessage(port: number, message: string): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(port, '/v1/chat', { method: 'POST', body: { message } })
}

/**
 * 执行命令（带不带前导斜杠均可）。
 * v2 起走专用 /v1/command 端点；旧版 mod 只认 /v1/chat 的 command 字段。
 */
export async function runObserverCommand(
  port: number,
  command: string,
  options: { protocol?: number } = {}
): Promise<{ ok: true }> {
  const useV2 = (options.protocol ?? 2) >= 2
  return requestJson<{ ok: true }>(
    port,
    useV2 ? '/v1/command' : '/v1/chat',
    { method: 'POST', body: { command } }
  )
}

/** v2：切换主手快捷栏槽位（0..8）。 */
export async function selectHotbarSlot(port: number, slot: number): Promise<{ ok: true; selectedSlot: number }> {
  return requestJson<{ ok: true; selectedSlot: number }>(
    port,
    '/v1/select-slot',
    { method: 'POST', body: { slot } }
  )
}

export interface KeyInput {
  type: 'key'
  /** GLFW 键码，如 257 = Enter */
  key: number
  scancode?: number
  /** 0=释放 1=按下 2=长按重复，默认 1 */
  action?: 0 | 1 | 2
  mods?: number
}

export interface CharInput {
  type: 'char'
  /** Unicode 码点 */
  codePoint: number
  mods?: number
}

export interface MouseInput {
  type: 'mouse'
  /** GLFW 鼠标键 0=左 1=右 2=中 */
  button: number
  action?: 0 | 1
  mods?: number
}

/** v2：滚轮事件（vertical 1=向上一格，-1=向下，horizontal 触控板横向滚动）。 */
export interface ScrollInput {
  type: 'scroll'
  vertical: number
  horizontal?: number
}

export type ObserverInput = KeyInput | CharInput | MouseInput | ScrollInput

/**
 * 注入一次键鼠事件；mod 侧 InputGuard 每 30 秒最多放行 60 次。
 * 熔断时抛 status=429 的 ObserverError，调用方应停止后续注入。
 */
export async function sendInput(port: number, input: ObserverInput): Promise<{ ok: true }> {
  return requestJson<{ ok: true }>(port, '/v1/input', { method: 'POST', body: input }, { timeoutMs: 3000 })
}

// ----------------------------------------------------------------------
// agent 2.1.0 新增：注册表计数 / 服务器命令 / 优雅退出
// ----------------------------------------------------------------------

/** GET /v1/registry 返回体：内置注册表逐表条目计数。 */
export interface ObserverRegistryCounts {
  ok: true
  /** 命中的注册表持有类名（命名映射下为 BuiltInRegistries/Registries） */
  holder: string
  /** named = 字段名可读（BLOCK/ITEM…）；obfuscated = 混淆字段名原样保留 */
  mapping: 'named' | 'obfuscated'
  totalRegistries: number
  failedFields: number
  /** 键为注册表字段名（named 映射下 BLOCK/ITEM/ENTITY_TYPE…），值为条目数 */
  counts: Record<string, number>
}

/** agent 2.1.0：读取内置注册表条目计数（沙箱注册表探针用）。 */
export async function fetchRegistryCounts(port: number, timeoutMs = 5000): Promise<ObserverRegistryCounts> {
  return requestJson<ObserverRegistryCounts>(port, '/v1/registry', {}, { timeoutMs })
}

/** POST /v1/server-command 返回体。 */
export interface ObserverServerCommandResult {
  ok: true
  command: string
  /** 命令整型返回值（Brigadier 结果码） */
  result: number
  /** 捕获到的反馈文本行 */
  lines: string[]
  /** lines 拼成的整段输出 */
  output: string
}

/**
 * agent 2.1.0：在集成服务器上执行单行命令并捕获输出（spark 在线报告等用）。
 * 未进单人世界抛 503，当前映射环境不支持抛 501，执行异常抛 500（均为 ObserverError）。
 * 命令经服务器线程执行，agent 侧最长等待 60s，客户端超时给足余量。
 */
export async function runServerCommand(
  port: number,
  command: string,
  timeoutMs = 75_000
): Promise<ObserverServerCommandResult> {
  return requestJson<ObserverServerCommandResult>(
    port,
    '/v1/server-command',
    { method: 'POST', body: { command } },
    { timeoutMs }
  )
}

/**
 * agent 2.1.0：请求客户端优雅退出（等价旧通道 mc.stop()）。
 * 立即返回 200，退出动作延迟 400ms 在游戏主循环执行；
 * 混淆环境未定位 stop/close 时抛 501，调用方退化为进程树终止。
 */
export async function requestGameShutdown(port: number, timeoutMs = 3000): Promise<{ ok: true; detail: string }> {
  return requestJson<{ ok: true; detail: string }>(port, '/v1/shutdown', { method: 'POST' }, { timeoutMs })
}
