/**
 * 三态门禁共用工具（Stage 1 专用服务器加载 / Stage 2 客户端进游戏）。
 *
 * 两个门禁共用同一套"工程准备 + 代表组内容 + Gradle 启动"逻辑，
 * 避免 prepareServer / gateDefinitions 在两处漂移导致「服务器能加载、
 * 客户端却进不去」的结论不可比。Gradle 事件与回写路径沿用 matrixGate 的约定：
 * 结果只写统一存储 overlay（唯一真源），由 workflow 导出到 manifest。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createDefaultEntity } from '../../../../shared/schemas/entity.schema'
import { createQuickContent } from '../../../../shared/schemas/quickCreate'
import { unifiedToBlock, unifiedToItem } from '../../../../shared/schemas/unified.adapter'
import { createDefaultCube, type ContentDefinition } from '../../../../shared/types/content'
import { cancelGradle, executeGradleBuild } from '../../gradleService'
import { createMatrixHealthStore } from '../matrixHealthStore'

export type GateLoader = 'fabric' | 'forge' | 'neoforge'

export interface GateCombo {
  loader: GateLoader
  mcVersion: string
}

/** 日志尾部保留量（失败报告只取尾部，避免日志撑爆内存） */
export const GATE_LOG_TAIL = 32 * 1024

export function parseTimeoutMs(env: string | undefined, fallback: number): number {
  if (env === undefined) return fallback
  const n = Number(env)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** 服务器启动失败的首因模式（命中即提前终止，避免白等超时） */
export const SERVER_FATAL_PATTERNS: RegExp[] = [
  /Exception in thread "main"/,
  /Failed to start the minecraft server/,
  /Missing or unsupported mandatory dependencies/,
  /Mod resolution failed/i,
  /Registry remapping failed/i,
  // 排除 netty 原生传输探测：Forge 26.3（FG7）在 Windows 上会把 epoll/kqueue 原生包一并放进
  // classpath，初始化时必然抛 "Only supported on Linux/OSX"，但服务端会继续启动到 Done
  // （forge-26.3 门禁实测：日志有此异常但随后 Done）——不属于 mod 加载失败。
  /java\.lang\.NoClassDefFoundError(?!.*io\.netty)/,
  /Could not execute entrypoint/,
  /A fatal error has been detected/,
  /You need to agree to the EULA/,
  /Failed to load mods/i
]

export function gateJavaHome(requiredJdk: number): string | undefined {
  return (
    process.env[`JAVA_HOME_${requiredJdk}_X64`] ??
    process.env[`JAVA_HOME_${requiredJdk}_ARM64`] ??
    process.env.JAVA_HOME ??
    undefined
  )
}

/**
 * CI 的 Gradle 发行包走腾讯云直连镜像（与 matrixGate 同因：GitHub Releases 504）。
 * maven 仓库仍按 CI 策略使用 official。
 */
export function useGradleDistMirror(root: string, gradleVersion: string): void {
  const p = join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties')
  try {
    const text = readFileSync(p, 'utf-8')
    const next = text.replace(
      /^distributionUrl=.*$/m,
      `distributionUrl=https\\://mirrors.cloud.tencent.com/gradle/gradle-${gradleVersion}-bin.zip`
    )
    if (next !== text) writeFileSync(p, next, 'utf-8')
  } catch {
    /* wrapper 缺失时交给 gradleService 报错 */
  }
}

/** 首次启动的世界/协议配置：平地、离线、单人，尽量缩短生成时间 */
export function prepareServer(root: string): void {
  const runDir = join(root, 'run')
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, 'eula.txt'), 'eula=true\n', 'utf-8')
  writeFileSync(
    join(runDir, 'server.properties'),
    [
      'online-mode=false',
      'level-type=minecraft\\:flat',
      'generate-structures=false',
      'spawn-npcs=false',
      'spawn-animals=false',
      'spawn-monsters=false',
      'max-players=1',
      'view-distance=4',
      'sync-chunk-writes=false',
      'level-seed=1',
      'motd=kunyu-runtime-gate'
    ].join('\n') + '\n',
    'utf-8'
  )
}

/** 与矩阵门禁一致的高频内容 + 一个带 cube 模型的被动实体（覆盖实体注册/属性） */
export function gateDefinitions(): ContentDefinition[] {
  const block = unifiedToBlock(createQuickContent('block', { id: 'gate_block', namespace: 'gatemod' }))
  const item = unifiedToItem(createQuickContent('item', { id: 'gate_item', namespace: 'gatemod' }))
  const food = unifiedToItem(createQuickContent('food', { id: 'gate_food', namespace: 'gatemod' }))
  const tool = unifiedToItem(createQuickContent('tool', { id: 'gate_tool', namespace: 'gatemod' }))
  const armor = unifiedToItem(createQuickContent('armor', { id: 'gate_armor', namespace: 'gatemod' }))
  const entity = createDefaultEntity('gate_sprite')
  entity.displayName = { en_us: 'Gate Sprite', zh_cn: '门禁精灵' }
  entity.spawnEgg.enabled = true
  entity.renderer.cubeModel = {
    textureSize: 16,
    pixels: Array.from({ length: 256 }, () => '#a8c98f'),
    elements: [createDefaultCube('body')]
  }
  return [block, item, food, tool, armor, entity]
}

export interface ServerRunResult {
  pass: boolean
  log: string
  reason?: string
}

/** 启动专用服务器到 Done；命中 Done 后主动取消 Gradle 任务，避免常驻 */
export function runServer(
  root: string,
  javaHome: string | undefined,
  timeoutMs: number
): Promise<ServerRunResult> {
  return new Promise((resolveLoad) => {
    let log = ''
    let runId = ''
    let sawDone = false
    let stopRequested = false
    let finished = false
    // 记录真正触发取消的失败模式：日志只保留尾部 32KB，事后在全量 log 上重扫
    // 可能因关键行被截断而找不到（曾把「端口占用」误报成 exit=0）
    let fatalHit: RegExp | undefined
    const finish = (pass: boolean, reason?: string): void => {
      if (finished) return
      finished = true
      resolveLoad({ pass, log, reason })
    }
    try {
      runId = executeGradleBuild(
        {
          root,
          tasks: ['runServer'],
          javaHome,
          timeoutMs,
          extraArgs: ['--no-daemon']
        },
        (ev) => {
          if (ev.type === 'output') {
            log += `${ev.text}\n`
            if (log.length > GATE_LOG_TAIL * 2) log = log.slice(-GATE_LOG_TAIL)
            if (!sawDone && /\bDone \([\d.]+s\)! For help/.test(ev.text)) {
              sawDone = true
              if (!stopRequested) {
                stopRequested = true
                cancelGradle(runId)
              }
              return
            }
            const hit = SERVER_FATAL_PATTERNS.find((re) => re.test(ev.text))
            if (!sawDone && hit && !stopRequested) {
              stopRequested = true
              fatalHit = hit
              cancelGradle(runId)
            }
            return
          }
          if (ev.type === 'phase' && ev.phase === 'done') {
            if (sawDone) return finish(true)
            const hit = fatalHit ?? SERVER_FATAL_PATTERNS.find((re) => re.test(log))
            finish(
              false,
              ev.timedOut
                ? '服务器启动超时'
                : hit
                  ? `命中启动失败模式：${hit.source}`
                  : `服务器提前退出（exit=${ev.exitCode}）`
            )
          }
        }
      )
    } catch (e) {
      finish(false, (e as Error).message)
    }
  })
}

/** 门禁结果回写统一存储 overlay 的指定阶段（KY_MATRIX_HEALTH_PATH 可覆盖） */
export function recordStageResult(
  stage: 'load' | 'runtime',
  comboId: string,
  pass: boolean,
  note?: string
): void {
  const storePath =
    process.env.KY_MATRIX_HEALTH_PATH ??
    resolve(process.cwd(), '.dev-userdata', 'ai', 'ai-reference-overlay.json')
  try {
    const store = createMatrixHealthStore({ path: storePath })
    const input = {
      comboId,
      pass,
      at: new Date().toISOString(),
      ...(note ? { note: note.slice(0, 300) } : {})
    }
    if (stage === 'load') store.recordLoadResult(input)
    else store.recordRuntimeResult(input)
  } catch (err) {
    console.warn(`[gate] stages.${stage} 回写失败（${storePath}）：${(err as Error).message}`)
  }
}
