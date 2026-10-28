/**
 * 游戏控制工具（从 toolRegistry.ts builtinGameControlTools 拆出）：
 * kunyu-observer：运行中 Minecraft 1.20.1 的观察/指令通道。
 * mc_state / mc_screenshot / mc_command / mc_chat / mc_world /
 * mc_observe_entity / mc_inventory / mc_input / mc_ensure_test_world /
 * mc_cleanup_test_world
 * 独立触发：run_game_test（无头 GameTest）/ mc_launch（启动开发客户端）
 *
 * 安全边界：
 * - observer 仅监听 127.0.0.1，且输入注入有 30s/60 次护栏（429 熔断）
 * - 游戏/世界不在线时一律软失败（ok:false + 引导文案），绝不阻断流水线
 * - 写入类工具仅限本地测试世界语义；命令长度与标识符在本地先校验
 * - run_game_test / mc_launch 复用 Gradle 运行槽：已有任务运行时一律软失败，不抢占
 */
import type { RegisteredTool, ToolRegistryDeps, ToolResult } from '../toolRegistry'
import type { GameTestReport } from '../../../../shared/types/agent'
import { hasActiveRun } from '../../gradleService'
import { runGameTestServer } from '../../gameTestRunner'
import { clipToolText } from './textClip'
import { clampGameTestTimeout } from './toolPolicy'
import {
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
  ObserverError,
  probeObserver,
  runObserverCommand,
  selectHotbarSlot,
  sendChatMessage,
  sendInput,
  setBlockAt,
  setLook,
  type ObserverEndpoint,
  type ObserverInput
} from '../../observer/observerClient'

const GAME_OFFLINE_ERROR =
  '未检测到运行中的 Minecraft（kunyu-observer 观察通道离线）。请用一键运行启动装有观察 mod 的开发客户端并进入世界后重试。'

/** 方块注册名本地预校验（与 mod 侧正则同源）。 */
const BLOCK_ID_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_/.-]+$/

/** ObserverError 归一化为工具软失败。 */
function gameFailure(err: unknown): ToolResult {
  if (err instanceof ObserverError) {
    if (err.status === 429) {
      return {
        ok: false,
        text: '',
        error: `输入护栏熔断：${err.message}。请停止连续注入，等待约 30 秒窗口恢复后再试。`
      }
    }
    if (err.status === 503) {
      return { ok: false, text: '', error: `游戏端未就绪：${err.message}（请确认玩家已进入世界）` }
    }
    return { ok: false, text: '', error: `observer 调用失败：${err.message}` }
  }
  return { ok: false, text: '', error: `observer 调用异常：${(err as Error).message}` }
}

function numArg(args: Record<string, unknown>, key: string): number | undefined {
  return typeof args[key] === 'number' && Number.isFinite(args[key] as number)
    ? (args[key] as number)
    : undefined
}

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  return typeof args[key] === 'string' && (args[key] as string).length > 0
    ? (args[key] as string)
    : undefined
}

export function builtinGameControlTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []
  const probe = deps.observerProbe ?? probeObserver

  /** 探测游戏；返回端点或软失败结果（用 port 字段判别）。 */
  async function connect(): Promise<ObserverEndpoint | ToolResult> {
    try {
      const ep = await probe()
      return ep ?? { ok: false, text: '', error: GAME_OFFLINE_ERROR }
    } catch {
      return { ok: false, text: '', error: GAME_OFFLINE_ERROR }
    }
  }

  const isResult = (v: ObserverEndpoint | ToolResult): v is ToolResult => !('port' in v)

  const formatPlayer = (p: {
    name: string; x: number; y: number; z: number; yaw: number; pitch: number
    health: number; food: number; onGround: boolean; selectedSlot: number; gameMode: string
  }): string =>
    `玩家 ${p.name} @(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) ` +
    `yaw=${p.yaw.toFixed(1)} pitch=${p.pitch.toFixed(1)} HP=${p.health} 饱食=${p.food} ` +
    `模式=${p.gameMode} 在地面=${p.onGround} 快捷栏槽=${p.selectedSlot}`

  /* ---------------- mc_state：聚合/单项只读状态 ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_state',
        description:
          '读取运行中游戏（本地开发客户端）的状态快照：玩家姿态/生命/模式、世界时间天气、' +
          '周围实体、最近聊天、当前屏幕、背包、输入护栏。验证生成物游戏内表现前先用本工具核对现场。' +
          '游戏未启动时返回软失败提示，不影响其他工具。',
        parameters: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['snapshot', 'player', 'nearby', 'chat', 'inventory', 'screen', 'guard'],
              description: 'snapshot=一次往返聚合（默认）；其余为单项查询'
            },
            radius: { type: 'number', description: 'nearby/snapshot 实体搜索半径，默认 24，最大 64' },
            limit: { type: 'number', description: '实体或聊天条数上限（实体默认 16，聊天默认 20）' },
            type: { type: 'string', description: '实体类型过滤，如 cow / minecraft:cow' },
            widgets: { type: 'boolean', description: 'screen/snapshot 是否附带可交互控件树，默认 false' }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      const ep = await connect()
      if (isResult(ep)) return ep
      try {
        const scope = strArg(args, 'scope') ?? 'snapshot'
        const radius = Math.min(64, Math.max(1, numArg(args, 'radius') ?? 24))
        const type = strArg(args, 'type')
        const widgets = args['widgets'] === true
        switch (scope) {
          case 'player': {
            const p = await fetchPlayerState(ep.port)
            return { ok: true, text: formatPlayer(p), data: p }
          }
          case 'nearby': {
            const r = await fetchNearbyEntities(ep.port, radius, numArg(args, 'limit') ?? 32, type)
            const text =
              r.entities.length === 0
                ? `半径 ${radius} 内无实体${type ? `（类型 ${type}）` : ''}。`
                : r.entities
                    .map((e) => `- ${e.type}「${e.name}」@(${e.x.toFixed(1)},${e.y.toFixed(1)},${e.z.toFixed(1)}) 距离=${e.distance}`)
                    .join('\n')
            return { ok: true, text: clipToolText(text), data: { count: r.entities.length } }
          }
          case 'chat': {
            const r = await fetchRecentChat(ep.port, numArg(args, 'limit') ?? 20)
            return {
              ok: true,
              text: r.messages.length === 0 ? '最近无聊天记录。' : clipToolText(r.messages.join('\n')),
              data: { count: r.messages.length }
            }
          }
          case 'inventory': {
            const r = await fetchInventory(ep.port)
            const text =
              r.slots.length === 0
                ? '背包为空。'
                : r.slots
                    .map((s) => `- 槽${s.slot} ${s.id}「${s.name}」×${s.count}${s.damage ? ` 损耗=${s.damage}` : ''}`)
                    .join('\n') + `\n当前快捷栏槽：${r.selectedSlot}`
            return { ok: true, text: clipToolText(text), data: { selectedSlot: r.selectedSlot, slots: r.slots.length } }
          }
          case 'screen': {
            const r = await fetchScreen(ep.port)
            if (!r.open) return { ok: true, text: '当前无打开的 Screen（处于游戏内视角）。' }
            const ws = (r.widgets ?? [])
              .map((w) => `  - ${w.class}「${w.text}」(${w.x},${w.y} ${w.width}×${w.height}) enabled=${w.enabled}`)
              .join('\n')
            return {
              ok: true,
              text: clipToolText(`Screen：${r.class}「${r.title}」\n${ws ? `控件：\n${ws}` : '无控件信息'}`)
            }
          }
          case 'guard': {
            const g = await fetchGuardStats(ep.port)
            return {
              ok: true,
              text: `输入护栏：enabled=${g.enabled} 窗口=${g.windowMs}ms 额度=${g.remaining}/${g.maxEvents} 累计拒绝=${g.rejectedTotal}`
            }
          }
          case 'snapshot':
          default: {
            const s = await fetchObserverSnapshot(ep.port, {
              radius,
              entityLimit: numArg(args, 'limit') ?? 16,
              chatLimit: 20,
              type,
              widgets
            })
            const lines = [
              formatPlayer(s.player),
              `世界：${s.world.dimension} time=${s.world.time} dayTime=${s.world.timeOfDay} 下雨=${s.world.raining}`,
              `周围实体 ${s.nearby.entities.length} 个：` +
                (s.nearby.entities.length === 0
                  ? '无'
                  : s.nearby.entities.map((e) => `${e.type}@${e.distance}m`).join(', ')),
              s.chat.messages.length === 0
                ? '最近聊天：无'
                : '最近聊天：\n' + s.chat.messages.map((m) => `  ${m}`).join('\n'),
              s.screen.open ? `当前屏幕：${s.screen.class}「${s.screen.title}」` : '当前屏幕：无（游戏内视角）',
              `护栏剩余额度：${s.guard.remaining}/${s.guard.maxEvents}`
            ]
            return { ok: true, text: clipToolText(lines.join('\n')), data: { now: s.now } }
          }
        }
      } catch (e) {
        return gameFailure(e)
      }
    }
  })

  /* ---------------- mc_screenshot：当前帧截图 ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_screenshot',
        description:
          '捕获游戏当前帧 PNG（kunyu-observer）。用于游戏内视觉复核流程；返回体仅给字节数摘要，' +
          '画面由坤舆视觉复核通道消费。需要结构化现场信息时用 mc_state。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async () => {
      const ep = await connect()
      if (isResult(ep)) return ep
      try {
        const shot = await fetchScreenshot(ep.port)
        // dataUrl 体积大，不进模型文本上下文，仅回传元数据
        return {
          ok: true,
          text: `已捕获当前帧截图（${shot.mime}，${shot.bytes} 字节），可进入视觉复核。`,
          data: { mime: shot.mime, bytes: shot.bytes }
        }
      } catch (e) {
        return gameFailure(e)
      }
    }
  })

  /* ---------------- mc_command：下发原版指令 ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_command',
        description:
          '在本地开发客户端执行一条原版指令（不带斜杠），如 gamemode creative、give @s minecraft:diamond 1、' +
          'summon minecraft:cow、time set day。仅限本地测试世界：禁止执行封禁/踢出/停止服务器等管理性指令。' +
          '需要创造模式或指令权限；执行后用 mc_state / mc_observe_entity 核对效果。',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '指令内容（斜杠可带可不带），最长 256 字符' }
          },
          required: ['command']
        }
      }
    },
    execute: async (args) => {
      const raw = strArg(args, 'command')
      if (!raw) return { ok: false, text: '', error: 'command 不能为空' }
      const command = raw.startsWith('/') ? raw.slice(1).trim() : raw.trim()
      if (command.length > 256) return { ok: false, text: '', error: 'command 过长（>256 字符）' }
      if (/\n|\r/.test(command)) return { ok: false, text: '', error: 'command 不能包含换行' }
      const ep = await connect()
      if (isResult(ep)) return ep
      try {
        await runObserverCommand(ep.port, command, { protocol: ep.health.protocol })
        return { ok: true, text: `指令已下发：/${command}`, data: { command } }
      } catch (e) {
        return gameFailure(e)
      }
    }
  })

  /* ---------------- mc_chat：发送聊天消息 ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_chat',
        description: '以玩家身份向游戏内聊天发送一条消息（非指令，以 / 开头的内容请改用 mc_command）。',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: '聊天文本，1..256 字符' }
          },
          required: ['message']
        }
      }
    },
    execute: async (args) => {
      const message = strArg(args, 'message')
      if (!message) return { ok: false, text: '', error: 'message 不能为空' }
      if (message.startsWith('/')) return { ok: false, text: '', error: '聊天消息不能以 / 开头；发指令请用 mc_command' }
      if (message.length > 256) return { ok: false, text: '', error: 'message 过长（>256 字符）' }
      const ep = await connect()
      if (isResult(ep)) return ep
      try {
        await sendChatMessage(ep.port, message)
        return { ok: true, text: `聊天已发送：${message}` }
      } catch (e) {
        return gameFailure(e)
      }
    }
  })

  /* ---------------- mc_world：世界环境/方块读写 ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_world',
        description:
          '读取/改动本地测试世界：env=时间/维度/天气；get_block=查某坐标方块（直接读客户端世界）；' +
          'set_block=经 setblock 指令放置方块（需创造/权限）。',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['env', 'get_block', 'set_block'] },
            x: { type: 'number', description: '方块 X（整数坐标）' },
            y: { type: 'number', description: '方块 Y（整数坐标）' },
            z: { type: 'number', description: '方块 Z（整数坐标）' },
            block: { type: 'string', description: 'set_block：方块注册名，如 minecraft:stone' },
            mode: { type: 'string', enum: ['replace', 'destroy', 'keep'], description: 'set_block 处理模式，默认 replace' }
          },
          required: ['action']
        }
      }
    },
    execute: async (args) => {
      const action = strArg(args, 'action')
      if (!action) return { ok: false, text: '', error: 'action 不能为空（env/get_block/set_block）' }
      const ep = await connect()
      if (isResult(ep)) return ep
      try {
        if (action === 'env') {
          const env = await fetchWorldEnv(ep.port)
          return {
            ok: true,
            text: `维度=${env.dimension} 世界时间=${env.time} 当日时刻=${env.timeOfDay} 下雨=${env.raining} 雷暴=${env.raining ? env.thundering ?? false : false}（高度 ${env.bottomY ?? '?'}..${env.topY ?? '?'}）`,
            data: env
          }
        }
        const x = numArg(args, 'x')
        const y = numArg(args, 'y')
        const z = numArg(args, 'z')
        if (x === undefined || y === undefined || z === undefined) {
          return { ok: false, text: '', error: '需要整数坐标 x / y / z' }
        }
        const pos = { x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) }
        if (action === 'get_block') {
          const b = await fetchBlockAt(ep.port, pos)
          return { ok: true, text: `(${b.x},${b.y},${b.z}) = ${b.block}${b.air ? '（空气）' : ''}`, data: b }
        }
        // set_block
        const block = strArg(args, 'block')
        if (!block) return { ok: false, text: '', error: 'set_block 需要 block 字段（如 minecraft:stone）' }
        const normalized = block.includes(':') ? block : `minecraft:${block}`
        if (!BLOCK_ID_PATTERN.test(normalized)) {
          return { ok: false, text: '', error: `block 不是合法注册名：${block}` }
        }
        const mode = (strArg(args, 'mode') ?? 'replace') as 'replace' | 'destroy' | 'keep'
        const r = await setBlockAt(ep.port, pos, normalized, mode)
        return { ok: true, text: `方块放置指令已下发：${r.command}（生效需创造/指令权限，可用 get_block 复核）`, data: r }
      } catch (e) {
        return gameFailure(e)
      }
    }
  })

  /* ---------------- mc_observe_entity：观察周围实体 ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_observe_entity',
        description:
          '按类型/半径观察玩家周围实体（只读），返回类型、显示名、坐标与距离。' +
          '验证自定义实体生成、AI 行为或刷怪结果时使用；需要连续观察请间隔调用并对比坐标。',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: '实体注册名过滤，如 minecraft:cow（可省略命名空间）；缺省返回全部' },
            radius: { type: 'number', description: '搜索半径，默认 24，最大 64' },
            limit: { type: 'number', description: '返回条数上限，默认 32，最大 64' }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      const ep = await connect()
      if (isResult(ep)) return ep
      try {
        const radius = Math.min(64, Math.max(1, numArg(args, 'radius') ?? 24))
        const limit = Math.min(64, Math.max(1, numArg(args, 'limit') ?? 32))
        const type = strArg(args, 'type')
        const r = await fetchNearbyEntities(ep.port, radius, limit, type)
        const text =
          r.entities.length === 0
            ? `半径 ${radius} 内未观察到实体${type ? `（类型 ${type}）` : ''}。`
            : r.entities
                .map(
                  (e) =>
                    `- ${e.type}「${e.name}」uuid=${e.uuid} @(${e.x.toFixed(1)},${e.y.toFixed(1)},${e.z.toFixed(1)}) 距离=${e.distance}m`
                )
                .join('\n')
        return {
          ok: true,
          text: clipToolText(text),
          data: { count: r.entities.length, radius: r.radius }
        }
      } catch (e) {
        return gameFailure(e)
      }
    }
  })

  /* ---------------- mc_inventory：背包只读 ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_inventory',
        description: '读取玩家背包非空槽位（只读）：槽位、物品注册名、数量、损耗与当前快捷栏槽。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async () => {
      const ep = await connect()
      if (isResult(ep)) return ep
      try {
        const r = await fetchInventory(ep.port)
        const text =
          (r.slots.length === 0
            ? '背包为空。'
            : r.slots
                .map((s) => `- 槽${s.slot} ${s.id}「${s.name}」×${s.count}${s.damage ? ` 损耗=${s.damage}` : ''}`)
                .join('\n')) + `\n当前快捷栏槽：${r.selectedSlot}`
        return {
          ok: true,
          text: clipToolText(text),
          data: { selectedSlot: r.selectedSlot, slots: r.slots }
        }
      } catch (e) {
        return gameFailure(e)
      }
    }
  })

  /* ---------------- mc_input：受控键鼠注入 ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_input',
        description:
          '向游戏注入一次受控输入（受 30 秒最多 60 次护栏限制，熔断时工具返回 429 软失败）：' +
          'key=GLFW 键码事件（如 key=257 回车）、char=Unicode 字符、mouse=鼠标键（0 左 1 右 2 中）、' +
          'scroll=滚轮（vertical 1 上 / -1 下）、look=设置视角 yaw/pitch、hotbar=切换快捷栏槽 0..8。' +
          '仅用于自动化测试操作，不得用于连续高频注入。',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['key', 'char', 'mouse', 'scroll', 'look', 'hotbar'] },
            key: { type: 'number', description: 'kind=key：GLFW 键码' },
            scancode: { type: 'number', description: 'kind=key：扫描码（一般 0）' },
            action: { type: 'number', description: 'key：0 释放 1 按下 2 重复（默认 1）；mouse：0 释放 1 按下' },
            mods: { type: 'number', description: '修饰键位掩码（一般 0）' },
            codePoint: { type: 'number', description: 'kind=char：Unicode 码点' },
            button: { type: 'number', description: 'kind=mouse：鼠标键 0/1/2' },
            vertical: { type: 'number', description: 'kind=scroll：纵向滚动 1/-1' },
            horizontal: { type: 'number', description: 'kind=scroll：横向滚动（触控板，一般 0）' },
            yaw: { type: 'number', description: 'kind=look：水平视角（度）' },
            pitch: { type: 'number', description: 'kind=look：俯仰角（-90..90）' },
            slot: { type: 'number', description: 'kind=hotbar：快捷栏槽 0..8' }
          },
          required: ['kind']
        }
      }
    },
    execute: async (args) => {
      const kind = strArg(args, 'kind')
      if (!kind) return { ok: false, text: '', error: 'kind 不能为空（key/char/mouse/scroll/look/hotbar）' }
      const ep = await connect()
      if (isResult(ep)) return ep
      try {
        switch (kind) {
          case 'look': {
            const yaw = numArg(args, 'yaw')
            const pitch = numArg(args, 'pitch')
            if (yaw === undefined || pitch === undefined) {
              return { ok: false, text: '', error: 'look 需要 yaw 与 pitch' }
            }
            await setLook(ep.port, yaw, Math.max(-90, Math.min(90, pitch)))
            return { ok: true, text: `视角已设置：yaw=${yaw} pitch=${pitch}` }
          }
          case 'hotbar': {
            const slot = numArg(args, 'slot')
            if (slot === undefined || !Number.isInteger(slot) || slot < 0 || slot > 8) {
              return { ok: false, text: '', error: 'hotbar 需要 slot 整数 0..8' }
            }
            await selectHotbarSlot(ep.port, slot)
            return { ok: true, text: `快捷栏已切换到槽 ${slot}` }
          }
          case 'key': {
            const key = numArg(args, 'key')
            if (key === undefined) return { ok: false, text: '', error: 'key 注入需要 GLFW 键码' }
            const input: ObserverInput = {
              type: 'key',
              key: Math.trunc(key),
              scancode: numArg(args, 'scancode'),
              action: (numArg(args, 'action') as 0 | 1 | 2 | undefined) ?? 1,
              mods: numArg(args, 'mods')
            }
            await sendInput(ep.port, input)
            return { ok: true, text: `按键事件已注入：key=${input.key} action=${input.action}` }
          }
          case 'char': {
            const codePoint = numArg(args, 'codePoint')
            if (codePoint === undefined) return { ok: false, text: '', error: 'char 注入需要 codePoint' }
            await sendInput(ep.port, {
              type: 'char',
              codePoint: Math.trunc(codePoint),
              mods: numArg(args, 'mods')
            })
            return { ok: true, text: `字符事件已注入：U+${Math.trunc(codePoint).toString(16).toUpperCase()}` }
          }
          case 'mouse': {
            const button = numArg(args, 'button')
            if (button === undefined) return { ok: false, text: '', error: 'mouse 注入需要 button（0 左 1 右 2 中）' }
            await sendInput(ep.port, {
              type: 'mouse',
              button: Math.trunc(button),
              action: (numArg(args, 'action') as 0 | 1 | undefined) ?? 1,
              mods: numArg(args, 'mods')
            })
            return { ok: true, text: `鼠标事件已注入：button=${button}` }
          }
          case 'scroll': {
            const vertical = numArg(args, 'vertical') ?? 0
            await sendInput(ep.port, {
              type: 'scroll',
              vertical,
              horizontal: numArg(args, 'horizontal')
            })
            return { ok: true, text: `滚轮事件已注入：vertical=${vertical}` }
          }
          default:
            return { ok: false, text: '', error: `未知 kind：${kind}` }
        }
      } catch (e) {
        return gameFailure(e)
      }
    }
  })

  /* ---------------- mc_ensure_test_world：测试前置条件准备 ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_ensure_test_world',
        description:
          '把当前本地世界整理为可重复的测试前置：创造模式、白天、晴天、难度、可选清除非玩家实体。' +
          '玩家未进入世界时返回操作引导（本工具不代建新存档，建世界请用一键运行的测试客户端）。' +
          'seed/structures 只在建世界时生效，对已加载世界无效（会在结果中注明）。',
        parameters: {
          type: 'object',
          properties: {
            gameMode: { type: 'string', enum: ['creative', 'survival'], description: '默认 creative' },
            time: { type: 'string', enum: ['day', 'noon', 'night', 'midnight'], description: '锁定当日时刻，默认 day' },
            weather: { type: 'string', enum: ['clear', 'rain', 'thunder'], description: '天气，默认 clear' },
            difficulty: { type: 'string', enum: ['peaceful', 'easy', 'normal', 'hard'], description: '难度（需指令权限）' },
            clearEntities: { type: 'boolean', description: 'true 时清除所有非玩家实体（kill @e[type=!player]），默认 false' }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      const ep = await connect()
      if (isResult(ep)) return ep
      if (!ep.health.inGame) {
        return {
          ok: false,
          text: '',
          error: '观察 mod 在线但玩家尚未进入世界。请先在开发客户端进入本地测试世界（建议超平坦创造），再调用本工具。'
        }
      }
      const commands: string[] = []
      const gameMode = strArg(args, 'gameMode') ?? 'creative'
      commands.push(`gamemode ${gameMode}`)
      const time = strArg(args, 'time') ?? 'day'
      commands.push(`time set ${time}`)
      const weather = strArg(args, 'weather') ?? 'clear'
      commands.push(`weather ${weather}`)
      const difficulty = strArg(args, 'difficulty')
      if (difficulty) commands.push(`difficulty ${difficulty}`)
      if (args['clearEntities'] === true) commands.push('kill @e[type=!player]')
      try {
        for (const command of commands) {
          await runObserverCommand(ep.port, command, { protocol: ep.health.protocol })
        }
        const notes = [
          '已按默认/给定参数整理测试前置（seed 与 structures 仅新建世界时可指定，对当前世界无效）。',
          '若指令无权限，请在创建世界时开启作弊/创造，或开放局域网并允许作弊。'
        ]
        return {
          ok: true,
          text: `${notes.join('\n')}\n下发指令：\n${commands.map((c) => `- /${c}`).join('\n')}`,
          data: { commands }
        }
      } catch (e) {
        return gameFailure(e)
      }
    }
  })

  /* ---------------- mc_cleanup_test_world：测试世界收尾清理 ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_cleanup_test_world',
        description:
          '测试收尾：把本地测试世界清理回干净状态，供下次验证从已知前置开始。' +
          '默认清除非玩家实体并恢复测试前置（创造模式/白天/晴天）；可传入 blocks（坐标数组）' +
          '把 mc_test_scenario / setblock 放下的方块恢复为空气。游戏不在线或玩家未进入世界时返回软失败（不阻断流水线）。',
        parameters: {
          type: 'object',
          properties: {
            blocks: {
              type: 'array',
              description: '需要回滚为空气的方块坐标数组（最多 64 个）',
              items: {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  z: { type: 'number' }
                },
                required: ['x', 'y', 'z']
              }
            },
            entities: { type: 'boolean', description: '是否清除非玩家实体（kill @e[type=!player]），默认 true' },
            resetState: { type: 'boolean', description: '是否恢复测试前置（创造/白天/晴天），默认 true' }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      const ep = await connect()
      if (isResult(ep)) return ep
      if (!ep.health.inGame) {
        return {
          ok: false,
          text: '',
          error: '观察 mod 在线但玩家尚未进入世界，无需清理（进入世界后再执行收尾）。'
        }
      }
      const rawBlocks = Array.isArray(args['blocks']) ? (args['blocks'] as unknown[]) : []
      if (rawBlocks.length > 64) return { ok: false, text: '', error: 'blocks 最多 64 个坐标' }
      // 先全量校验坐标，任一非法都不下发任何指令（避免半清理状态）
      const positions: { x: number; y: number; z: number }[] = []
      for (const b of rawBlocks) {
        const rec = b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
        const x = numArg(rec, 'x')
        const y = numArg(rec, 'y')
        const z = numArg(rec, 'z')
        if (x === undefined || y === undefined || z === undefined) {
          return { ok: false, text: '', error: 'blocks 每个元素都必须含整数坐标 x/y/z' }
        }
        positions.push({ x: Math.trunc(x), y: Math.trunc(y), z: Math.trunc(z) })
      }
      const resetState = args['resetState'] !== false
      const entities = args['entities'] !== false
      const commands: string[] = []
      if (resetState) {
        commands.push('gamemode creative', 'time set day', 'weather clear')
      }
      if (entities) commands.push('kill @e[type=!player]')
      try {
        for (const command of commands) {
          await runObserverCommand(ep.port, command, { protocol: ep.health.protocol })
        }
        const restored: string[] = []
        for (const pos of positions) {
          const r = await setBlockAt(ep.port, pos, 'minecraft:air', 'replace')
          restored.push(r.command)
        }
        const lines = ['测试世界收尾完成。']
        if (commands.length > 0) lines.push(`下发指令：\n${commands.map((c) => `- /${c}`).join('\n')}`)
        if (restored.length > 0) lines.push(`回滚坐标（恢复空气）：\n${restored.map((c) => `- /${c}`).join('\n')}`)
        lines.push('如需彻底重置，请退出并重新进入测试世界。')
        return { ok: true, text: lines.join('\n'), data: { commands, restored } }
      } catch (e) {
        return gameFailure(e)
      }
    }
  })

  /* ---------------- run_game_test：独立重跑无头 GameTest ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'run_game_test',
        description:
          '独立运行项目内的 GameTest 无头测试（gradlew runGameTestServer），返回通过/失败清单。' +
          '用于生成测试类后主动验证运行时行为，或验收契约含 gametest-runtime 断言时的复验。' +
          '需项目含 .kunyu/content/gametest/*.json；已有 Gradle 任务运行时返回软失败（不抢占）。',
        parameters: {
          type: 'object',
          properties: {
            timeoutMs: { type: 'number', description: '超时毫秒（默认 120000，范围 10000..600000）' }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '无打开项目，无法运行 GameTest' }
      if (hasActiveRun()) {
        return { ok: false, text: '', error: '已有 Gradle 任务在运行（构建/客户端），请等其结束后再运行 GameTest' }
      }
      const timeoutMs = clampGameTestTimeout(numArg(args, 'timeoutMs'))
      const runner =
        deps.runGameTest ??
        ((input: { root: string; javaHome: string; timeoutMs?: number }) =>
          runGameTestServer({ root: input.root, javaHome: input.javaHome, timeoutMs: input.timeoutMs }))
      try {
        const report = await runner({ root, javaHome: deps.javaHome?.() ?? '', timeoutMs })
        return {
          ok: report.status === 'pass',
          text: formatGameTestReport(report),
          data: { status: report.status, passed: report.passed.length, failed: report.failed.length }
        }
      } catch (e) {
        return { ok: false, text: '', error: `运行 GameTest 异常：${(e as Error).message}` }
      }
    }
  })

  /* ---------------- mc_launch：独立启动开发客户端 ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_launch',
        description:
          '独立启动装有观察 mod 的开发客户端（gradlew runClient），为真机验证做准备。启动在后台进行，' +
          '本工具立即返回；随后用 mc_state 轮询确认玩家已进入世界（观察通道 9876-9886）。' +
          '若观察通道已在线（客户端已在运行）则不重复启动；已有 Gradle 任务运行时返回软失败。' +
          '注意：运行中的客户端会占用 Gradle 运行槽，构建阶段中途请勿调用。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    execute: async () => {
      // 已在运行：观察通道在线即视为客户端已就绪，直接回报状态
      try {
        const ep = await probe()
        if (ep) {
          return {
            ok: true,
            text: `开发客户端已在运行（观察通道 port=${ep.port}，已进入世界=${ep.health.inGame}）。无需重复启动。`,
            data: { port: ep.port, inGame: ep.health.inGame }
          }
        }
      } catch {
        /* 探测异常按未运行处理 */
      }
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '无打开项目，无法启动开发客户端' }
      const launcher = deps.launchDevClient
      if (!launcher) {
        return {
          ok: false,
          text: '',
          error: '当前会话未启用启动通道：请在坤舆界面使用「一键运行」启动开发客户端，再用 mc_state 核验。'
        }
      }
      if (hasActiveRun()) {
        return { ok: false, text: '', error: '已有 Gradle 任务在运行，请先停止后再启动新的客户端' }
      }
      try {
        const r = await launcher(root)
        return r.ok ? { ok: true, text: r.text } : { ok: false, text: '', error: r.error ?? r.text }
      } catch (e) {
        return { ok: false, text: '', error: `启动开发客户端异常：${(e as Error).message}` }
      }
    }
  })

  return tools
}

/** GameTestReport → 中文回执（含失败明细） */
function formatGameTestReport(report: GameTestReport): string {
  if (report.status === 'skipped') {
    return `GameTest 未运行：${report.summary}`
  }
  const head =
    report.status === 'pass'
      ? `GameTest 通过：${report.passed.length} 项`
      : `GameTest 失败：${report.failed.length} 项失败，${report.passed.length} 项通过`
  const detail = report.failed.length
    ? `\n失败明细：\n${report.failed.map((f) => `- ${f.name}: ${f.error}`).join('\n')}`
    : ''
  return `${head}\n${report.summary}${detail}`
}
