/**
 * P1 校验/验证类 FC 工具：
 *
 * - fabric_mod_json_validate：fabric.mod.json 结构与项目实物交叉校验
 *   （schemaVersion/id/entrypoints 类文件/depends 版本约束/mixins 配置文件/environment）。
 * - fabric_log_debugger：分析 run/crash-reports 与 run/logs/latest.log（复用 crashAnalyzer 纯规则），
 *   支持直接粘贴日志；只给诊断与修复建议，不自动改代码。
 * - mc_test_scenario：经 kunyu-observer 顺序编排「指令/放方块/等待 + 断言（方块/实体/玩家状态/聊天）」
 *   的游戏内可重复验证场景，fail-fast 返回失败步骤。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { diagnose } from '../../crashAnalyzer'
import { extractCrashEvidence, renderCrashEvidence } from './crashEvidence'
import {
  fetchBlockAt,
  fetchNearbyEntities,
  fetchPlayerState,
  fetchRecentChat,
  probeObserver,
  runObserverCommand,
  setBlockAt,
  type ObserverEndpoint,
  type SetBlockMode
} from '../../observer/observerClient'
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'

const CLIP = 8000
function clip(text: string): string {
  return text.length <= CLIP ? text : `${text.slice(0, CLIP)}…（已截断）`
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

const FABRIC_MOD_JSON = join('src', 'main', 'resources', 'fabric.mod.json')
const JAVA_ROOT = join('src', 'main', 'java')

export function builtinValidationTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  /* ---------------- fabric_mod_json_validate ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'fabric_mod_json_validate',
        description:
          '校验当前 Fabric 项目的 src/main/resources/fabric.mod.json：schemaVersion/id/version/name 等必填字段、' +
          'entrypoints 类名格式且对应 .java 文件存在、depends 版本约束（fabricloader>=0.15.0、minecraft 与目标版本对齐、' +
          'java/fabric-api）、mixins 引用的配置文件是否存在、environment 取值。' +
          '报 error 的项会导致加载或构建失败；warning 为规范/兼容性提醒。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    visibility: 'project',
    execute: () => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const errors: string[] = []
      const warnings: string[] = []
      const path = join(root, FABRIC_MOD_JSON)
      if (!existsSync(path)) {
        return { ok: false, text: '', error: `未找到 ${FABRIC_MOD_JSON}` }
      }
      let json: Record<string, unknown>
      try {
        json = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
      } catch (e) {
        return { ok: false, text: '', error: `fabric.mod.json 不是合法 JSON：${(e as Error).message}` }
      }

      // 基础字段
      if (json['schemaVersion'] !== 1) errors.push('schemaVersion 必须为数字 1')
      const id = asString(json['id'])
      if (!id) errors.push('缺少 id 字段')
      else if (!/^[a-z][a-z0-9_-]{1,63}$/.test(id)) {
        errors.push(`id 非法（${id}）：必须 2..64 位小写字母/数字/_/-，且字母开头`)
      }
      if (!asString(json['version'])) errors.push('缺少 version 字段（可用 "${version}" 占位由 Gradle 展开）')
      if (!asString(json['name'])) errors.push('缺少 name 字段')
      if (!json['license']) warnings.push('缺少 license 字段（开源协作建议声明 MIT 等）')
      const env = json['environment']
      if (env !== undefined && !['*', 'client', 'server'].includes(asString(env))) {
        errors.push(`environment 取值非法：${String(env)}（仅允许 * / client / server）`)
      }

      // entrypoints
      const eps = json['entrypoints']
      if (eps === undefined) {
        warnings.push('缺少 entrypoints：模组将没有初始化入口（纯资源包可忽略）')
      } else if (typeof eps !== 'object' || Array.isArray(eps) || eps === null) {
        errors.push('entrypoints 必须是对象（main/client/server → 类名数组）')
      } else {
        for (const [side, list] of Object.entries(eps as Record<string, unknown>)) {
          if (!['main', 'client', 'server'].includes(side)) {
            warnings.push(`entrypoints 含非标准键「${side}」（标准：main/client/server）`)
          }
          if (!Array.isArray(list)) {
            errors.push(`entrypoints.${side} 必须是数组`)
            continue
          }
          list.forEach((item, i) => {
            const cls =
              typeof item === 'string'
                ? item
                : item && typeof item === 'object' && typeof (item as Record<string, unknown>)['value'] === 'string'
                  ? asString((item as Record<string, unknown>)['value'])
                  : ''
            if (!cls) {
              errors.push(`entrypoints.${side}[${i}] 必须是类名字符串或 { value, adapter } 对象`)
              return
            }
            if (!/^[a-z][a-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(cls)) {
              errors.push(`entrypoints.${side}[${i}] 类名不像完整全限定名：${cls}`)
              return
            }
            const javaRel = join(JAVA_ROOT, `${cls.replace(/\./g, '/')}.java`)
            if (!existsSync(join(root, javaRel))) errors.push(`入口类文件不存在：${javaRel}（${side}）`)
          })
        }
      }

      // depends
      const depends = json['depends']
      if (depends === undefined) {
        warnings.push('缺少 depends：建议至少声明 fabricloader/minecraft/java（项目标准含 fabric-api）')
      } else if (typeof depends !== 'object' || Array.isArray(depends) || depends === null) {
        errors.push('depends 必须是对象（modId → 版本范围）')
      } else {
        const d = depends as Record<string, unknown>
        if (!d['fabricloader']) errors.push('depends 缺少 fabricloader（项目标准要求 >=0.15.0）')
        else {
          const range = String(d['fabricloader'])
          if (/(<|<=)\s*0\.1[0-4](\.|$)|==?\s*0\.1[0-4]/.test(range) || /0\.14/.test(range)) {
            errors.push(`fabricloader 范围 ${range} 低于硬约束 >=0.15.0`)
          }
        }
        if (!d['minecraft']) errors.push('depends 缺少 minecraft 版本范围（如 ~1.20.1）')
        if (!d['java']) warnings.push('depends 未声明 java（建议 >=17）')
        if (!d['fabric-api']) warnings.push('depends 未声明 fabric-api（仅用原版 API 的纯核心模组可忽略）')
      }

      // mixins 引用
      const mixins = json['mixins']
      if (mixins !== undefined) {
        if (!Array.isArray(mixins)) {
          errors.push('mixins 必须是数组')
        } else {
          mixins.forEach((item, i) => {
            const cfg =
              typeof item === 'string'
                ? item
                : item && typeof item === 'object' && typeof (item as Record<string, unknown>)['config'] === 'string'
                  ? asString((item as Record<string, unknown>)['config'])
                  : ''
            if (!cfg) {
              errors.push(`mixins[${i}] 必须是配置名字符串或 { config, environment } 对象`)
              return
            }
            if (!/^[a-z0-9_.-]+\.mixins\.json$/.test(cfg)) {
              warnings.push(`mixins[${i}] 配置名 ${cfg} 不符合 <name>.mixins.json 惯例`)
            }
            const cfgRel = join('src', 'main', 'resources', cfg)
            if (!existsSync(join(root, cfgRel))) {
              errors.push(`mixins[${i}] 引用的配置文件不存在：${cfgRel}（可用 mixin_register 自动创建/登记）`)
            }
          })
        }
      }

      const text =
        errors.length === 0
          ? `fabric.mod.json 校验通过 ✓（${warnings.length} 条警告）` +
            (warnings.length ? `\n${warnings.map((w) => `- ⚠️ ${w}`).join('\n')}` : '')
          : `fabric.mod.json 发现 ${errors.length} 个错误${warnings.length ? `、${warnings.length} 条警告` : ''}：\n` +
            `${errors.map((e) => `- ✗ ${e}`).join('\n')}` +
            (warnings.length ? `\n警告：\n${warnings.map((w) => `- ⚠️ ${w}`).join('\n')}` : '')
      return {
        ok: errors.length === 0,
        text: clip(text),
        data: { valid: errors.length === 0, errors, warnings, modId: id || null }
      }
    }
  })

  /* ---------------- fabric_log_debugger ---------------- */
  /** 找目录下 mtime 最新的 *.txt（crash report）。 */
  function latestCrashReport(root: string): { path: string; mtime: number } | null {
    const dir = join(root, 'run', 'crash-reports')
    if (!existsSync(dir)) return null
    let best: { path: string; mtime: number } | null = null
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.txt')) continue
      const p = join(dir, name)
      let mtime: number
      try {
        mtime = statSync(p).mtimeMs
      } catch {
        continue
      }
      if (!best || mtime > best.mtime) best = { path: p, mtime }
    }
    return best
  }

  /** 从日志中抽与本模组相关的最后若干行（按 modId/包名线索）。 */
  function ownHintsOf(modId: string): string[] {
    return [modId, modId.replace(/-/g, '_'), `com.${modId.replace(/[^a-z0-9_]/gi, '').toLowerCase()}`].filter(
      (n) => n.length > 0
    )
  }
  function ownModLines(log: string, modId: string): string[] {
    const needles = ownHintsOf(modId)
    const out: string[] = []
    for (const raw of log.split(/\r?\n/)) {
      if (needles.some((n) => raw.toLowerCase().includes(n))) out.push(raw.trim())
    }
    return out.slice(-12)
  }

  /** 读项目 modId（无 fabric.mod.json / 无项目时返回空串，调用方降级处理） */
  function readOwnModId(): string {
    const root = deps.projectRoot?.()
    if (!root) return ''
    try {
      const mj = JSON.parse(readFileSync(join(root, FABRIC_MOD_JSON), 'utf-8')) as Record<string, unknown>
      return asString(mj['id'])
    } catch {
      return ''
    }
  }

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'fabric_log_debugger',
        description:
          '诊断本地运行崩溃/报错：默认自动读取项目 run/crash-reports/ 最新崩溃报告（优先）或 run/logs/latest.log，' +
          '输出根因分类、证据栈帧与针对性修复建议（Mixin 注入失败/缺类/重复注册/资源缺失/OOM/JDK 版本等），' +
          '并摘出与本模组 id 相关的日志行。也可用 customLog 直接粘贴日志文本分析。只诊断不自动修复。',
        parameters: {
          type: 'object',
          properties: {
            customLog: { type: 'string', description: '直接粘贴崩溃报告或日志片段（给了就不读文件，无打开项目也可用）' },
            source: { type: 'string', enum: ['auto', 'crash', 'latest'], description: 'auto（默认，crash 优先）/crash/最新崩溃报告/latest/latest.log' }
          },
          required: []
        }
      }
    },
    execute: (args) => {
      const custom = asString(args['customLog']).trim()
      const source = (asString(args['source']) || 'auto') as 'auto' | 'crash' | 'latest'
      if (custom) {
        const looksCrash = /---- Minecraft Crash Report|Description:\s|Caused by:|crash\s*report/i.test(custom)
        const d = looksCrash ? diagnose({ reportText: custom }) : diagnose({ logText: custom })
        if (!d) return { ok: false, text: '', error: '粘贴内容中未识别到崩溃报告或 ERROR/WARN 日志行' }
        // P10：标准化证据清单（ready-line/最深 Caused by/首个自有栈帧）
        const evSection = renderCrashEvidence(extractCrashEvidence(custom, ownHintsOf(readOwnModId())))
        return {
          ok: true,
          text: clip(
            `## 粘贴日志诊断\n分类：${d.category}\n标题：${d.headline}\n根因：${d.cause}\n` +
              `证据：\n${d.evidence.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n建议：${d.suggestion}` +
              (evSection ? `\n${evSection}` : '')
          ),
          data: d
        }
      }

      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目，且未提供 customLog' }

      // 读 modId 用于自有日志过滤（无 fabric.mod.json 也允许分析日志）
      const modId = readOwnModId()

      const logPath = join(root, 'run', 'logs', 'latest.log')
      const crash = source === 'latest' ? null : latestCrashReport(root)
      const useCrash = crash && source !== 'latest'
      const logText = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : ''
      if (!useCrash && !logText) {
        return {
          ok: false,
          text: '',
          error: '未找到 run/crash-reports/*.txt 或 run/logs/latest.log：请先用一键运行启动游戏并复现问题'
        }
      }

      const d = useCrash
        ? diagnose({ reportText: readFileSync(crash!.path, 'utf-8'), reportPath: crash!.path, logText })
        : diagnose({ logText })
      if (!d) return { ok: false, text: '', error: '日志中未识别到崩溃或 ERROR/WARN 问题行' }

      // P10：标准化证据清单——报告正文找最深 Caused by/自有栈帧，latest.log 补 ready-line
      const evidence = extractCrashEvidence(
        useCrash ? `${readFileSync(crash!.path, 'utf-8')}\n${logText}` : logText,
        ownHintsOf(modId)
      )
      const evSection = renderCrashEvidence(evidence)

      const lines = [
        `## 游戏日志诊断（来源：${useCrash ? `崩溃报告 ${crash!.path}` : logPath}）`,
        `分类：${d.category}`,
        `标题：${d.headline}`,
        `根因：${d.cause}`,
        `证据：`,
        ...d.evidence.map((e, i) => `${i + 1}. ${e}`),
        `修复建议：${d.suggestion}`
      ]
      if (evSection) lines.push(evSection)
      if (modId && logText) {
        const own = ownModLines(logText, modId)
        if (own.length > 0) lines.push(`与本模组（${modId}）相关的最后日志行：\n${own.map((l) => `· ${l}`).join('\n')}`)
      }
      return { ok: true, text: clip(lines.join('\n')), data: d }
    }
  })

  /* ---------------- mc_test_scenario ---------------- */
  const probe = deps.observerProbe ?? probeObserver
  const GAME_OFFLINE = 'kunyu-observer 离线：游戏未启动（请先一键运行开发客户端并进入测试世界）'
  const FORBIDDEN_COMMANDS = /^(ban|ban-ip|banlist|deop|kick|op|pardon|pardon-ip|save-off|save-on|stop|whitelist)\b/

  interface ScenarioStep {
    op: string
    [k: string]: unknown
  }
  interface StepResult {
    index: number
    op: string
    name?: string
    ok: boolean
    detail: string
  }

  const MAX_STEPS = 32
  const WAIT_MIN = 50
  const WAIT_MAX = 5000
  const WAIT_TOTAL_MAX = 30000
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mc_test_scenario',
        description:
          '在本地测试世界按顺序执行游戏内验证场景并自动断言：支持 command（原版指令）、setblock（放方块）、' +
          'wait（等待刻生效）、state（记录现场快照）与 assert_block（坐标方块等于期望值）、' +
          'assert_entity（周围存在某类型实体，可给 count 与 exact/atLeast）、assert_state（玩家模式/生命下限）、' +
          'assert_chat（最近聊天包含文本）。断言失败立即停止并标红失败步骤；全程受 observer 输入护栏保护。' +
          '适用于「生成内容→游戏内验证表现」闭环；破坏性/管理性指令被拒绝。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '场景名称（结果中展示）' },
            steps: {
              type: 'array',
              description: `最多 ${MAX_STEPS} 步，按顺序执行；每步含 op 与相应参数`,
              items: {
                type: 'object',
                properties: {
                  op: {
                    type: 'string',
                    enum: [
                      'command',
                      'setblock',
                      'wait',
                      'state',
                      'assert_block',
                      'assert_entity',
                      'assert_state',
                      'assert_chat'
                    ]
                  },
                  name: { type: 'string', description: '本步名称（失败定位用）' },
                  command: { type: 'string', description: 'command：指令（不带斜杠）' },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  z: { type: 'number' },
                  block: { type: 'string', description: 'setblock/assert_block：方块注册名，如 stone / minecraft:stone' },
                  air: { type: 'boolean', description: 'assert_block：期望该坐标是空气' },
                  mode: { type: 'string', enum: ['replace', 'destroy', 'keep'], description: 'setblock 模式，默认 replace' },
                  ms: { type: 'number', description: 'wait：50..5000 毫秒' },
                  type: { type: 'string', description: 'assert_entity：实体类型，如 cow 或 minecraft:cow' },
                  radius: { type: 'number', description: 'assert_entity：搜索半径，默认 16，最大 64' },
                  count: { type: 'number', description: 'assert_entity：期望数量，默认 1' },
                  match: { type: 'string', enum: ['atLeast', 'exact'], description: 'assert_entity 数量匹配方式，默认 atLeast' },
                  gameMode: { type: 'string', description: 'assert_state：期望游戏模式（creative/survival/adventure/spectator）' },
                  healthMin: { type: 'number', description: 'assert_state：生命下限' },
                  contains: { type: 'string', description: 'assert_chat：最近聊天需包含的文本' }
                },
                required: ['op']
              }
            }
          },
          required: ['steps']
        }
      }
    },
    execute: async (args) => {
      const steps = args['steps']
      const scenarioName = asString(args['name']) || '未命名场景'
      if (!Array.isArray(steps) || steps.length === 0) {
        return { ok: false, text: '', error: 'steps 必须是非空数组' }
      }
      if (steps.length > MAX_STEPS) return { ok: false, text: '', error: `场景最多 ${MAX_STEPS} 步` }
      let ep: ObserverEndpoint | null = null
      try {
        ep = await probe()
      } catch {
        ep = null
      }
      if (!ep) return { ok: false, text: '', error: GAME_OFFLINE }
      if (ep.health.inGame === false) {
        return { ok: false, text: '', error: '观察 mod 在线但玩家尚未进入世界，请先进入本地测试世界' }
      }

      const results: StepResult[] = []
      let waitTotal = 0
      let failedAt = -1

      for (let i = 0; i < steps.length; i++) {
        const s = steps[i] as ScenarioStep
        const stepName = asString(s['name'])
        const mark = (ok: boolean, detail: string): StepResult => ({ index: i + 1, op: s.op, ...(stepName ? { name: stepName } : {}), ok, detail })
        try {
          switch (s.op) {
            case 'command': {
              let cmd = asString(s['command']).trim().replace(/^\//, '')
              if (!cmd) throw new Error('缺少 command')
              if (cmd.length > 256 || /[\r\n]/.test(cmd)) throw new Error('指令过长或含换行')
              const head = cmd.split(/\s+/)[0]!.toLowerCase()
              if (FORBIDDEN_COMMANDS.test(head)) throw new Error(`管理性指令被禁止：${head}`)
              await runObserverCommand(ep.port, cmd, { protocol: ep.health.protocol })
              results.push(mark(true, `/${cmd}`))
              break
            }
            case 'setblock': {
              const x = asNumber(s['x'])
              const y = asNumber(s['y'])
              const z = asNumber(s['z'])
              const block = asString(s['block']).trim()
              if (x === undefined || y === undefined || z === undefined) throw new Error('缺少坐标 x/y/z')
              if (!block) throw new Error('缺少 block')
              const full = block.includes(':') ? block : `minecraft:${block}`
              const mode = (['replace', 'destroy', 'keep'].includes(asString(s['mode'])) ? asString(s['mode']) : 'replace') as SetBlockMode
              const r = await setBlockAt(ep.port, { x, y, z }, full, mode)
              results.push(mark(true, r.command))
              break
            }
            case 'wait': {
              const ms = Math.min(WAIT_MAX, Math.max(WAIT_MIN, asNumber(s['ms']) ?? 300))
              // 先判总额再睡，避免无谓等待
              if (waitTotal + ms > WAIT_TOTAL_MAX) throw new Error(`累计等待超过 ${WAIT_TOTAL_MAX}ms`)
              waitTotal += ms
              await sleep(ms)
              results.push(mark(true, `等待 ${ms}ms`))
              break
            }
            case 'state': {
              const p = await fetchPlayerState(ep.port)
              results.push(mark(true, `@(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}) HP=${p.health} 模式=${p.gameMode}`))
              break
            }
            case 'assert_block': {
              const x = asNumber(s['x'])
              const y = asNumber(s['y'])
              const z = asNumber(s['z'])
              if (x === undefined || y === undefined || z === undefined) throw new Error('缺少坐标 x/y/z')
              const b = await fetchBlockAt(ep.port, { x, y, z })
              if (s['air'] === true) {
                if (!b.air) throw new Error(`期望空气，实际 ${b.block}`)
              } else {
                const want = asString(s['block']).trim()
                if (!want) throw new Error('缺少期望 block（或设 air=true）')
                const full = want.includes(':') ? want : `minecraft:${want}`
                if (b.air || b.block !== full) throw new Error(`期望 ${full}，实际 ${b.air ? '空气' : b.block}`)
              }
              results.push(mark(true, `(${b.x},${b.y},${b.z}) = ${b.air ? '空气' : b.block} ✓`))
              break
            }
            case 'assert_entity': {
              const type = asString(s['type']).trim()
              if (!type) throw new Error('缺少 type')
              const radius = Math.min(64, Math.max(1, asNumber(s['radius']) ?? 16))
              const wantCount = Math.max(1, Math.trunc(asNumber(s['count']) ?? 1))
              const exact = asString(s['match']) === 'exact'
              const r = await fetchNearbyEntities(ep.port, radius, 64, type)
              const n = r.entities.length
              const pass = exact ? n === wantCount : n >= wantCount
              if (!pass) throw new Error(`半径 ${radius} 内 ${type} 数量=${n}，期望${exact ? '等于' : '至少'} ${wantCount}`)
              results.push(mark(true, `${type} ×${n}（${exact ? '=' : '≥'}${wantCount}）✓`))
              break
            }
            case 'assert_state': {
              const p = await fetchPlayerState(ep.port)
              const problems: string[] = []
              const gameMode = asString(s['gameMode']).trim()
              if (gameMode && p.gameMode !== gameMode) problems.push(`模式=${p.gameMode}≠${gameMode}`)
              const healthMin = asNumber(s['healthMin'])
              if (healthMin !== undefined && p.health < healthMin) problems.push(`HP=${p.health}<${healthMin}`)
              if (!gameMode && healthMin === undefined) throw new Error('至少给 gameMode 或 healthMin 之一')
              if (problems.length > 0) throw new Error(problems.join('；'))
              results.push(mark(true, `模式=${p.gameMode} HP=${p.health} ✓`))
              break
            }
            case 'assert_chat': {
              const contains = asString(s['contains']).trim()
              if (!contains) throw new Error('缺少 contains')
              const r = await fetchRecentChat(ep.port, 20)
              if (!r.messages.some((m) => m.includes(contains))) {
                throw new Error(`最近聊天未包含「${contains}」；实际 ${r.messages.length} 条`)
              }
              results.push(mark(true, `聊天包含「${contains}」✓`))
              break
            }
            default:
              throw new Error(`未知 op：${String(s.op)}`)
          }
        } catch (e) {
          results.push(mark(false, (e as Error).message))
          failedAt = i + 1
          break
        }
        if (failedAt >= 0) break
      }

      const passed = failedAt < 0
      const summary = results.map((r) => `${r.ok ? '✓' : '✗'} #${r.index} ${r.op}${r.name ? `「${r.name}」` : ''}：${r.detail}`).join('\n')
      return {
        ok: passed,
        text:
          `场景「${scenarioName}」${passed ? '全部通过 ✓' : `在第 ${failedAt} 步失败 ✗`}（${results.length}/${steps.length} 步）\n${summary}` +
          (passed ? '' : '\n请根据失败步骤修正生成物或测试前置后重跑；必要时用 fabric_log_debugger 查游戏日志。'),
        data: { passed, failedAt, executed: results.length, total: steps.length, results }
      }
    }
  })

  return tools
}
