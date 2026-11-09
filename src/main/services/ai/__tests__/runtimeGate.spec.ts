/**
 * Runtime 门禁（Stage 1：专用服务器加载）。
 *
 * 三态报告的第二态：编译通过 ≠ 能加载。本门禁在代表组上执行
 * createProject → generateContent（含实体）→ gradlew runServer，
 * 以日志出现 `Done (…)` 为通过；失败记录首因到 matrixHealth.stages.load。
 *
 * 覆盖策略（版本族代表组，而非全量 35 组合）：
 *  - fabric  1.20.1 / 1.21.1 / 1.21.11 / 26.3（Yarn / ResourceLocation / Identifier 三个断点）
 *  - forge   1.20.1 / 1.21.1 / 26.3
 *  - neoforge 1.20.4 / 1.21.1 / 1.21.11 / 26.3
 * Forge 矩阵没有 1.21.11 组合，故代表组为 11 个而非 12 个。
 *
 * 常规单测整组 skip；由 `npm run test:runtime`（CI runtime-gate job / 本机手动）触发。
 * 结果写回统一存储 overlay 的 stages.load，再由 workflow 导出并提交 manifest。
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// 与 matrixGate.spec 相同：门禁链路触达 electron，最小桩替身避免触碰真实应用数据。
vi.mock('electron', async () => {
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = join(tmpdir(), `kunyu-runtime-gate-${process.pid}`)
  const noop = (): void => undefined
  return {
    app: {
      getPath: () => dir,
      setPath: noop,
      on: noop,
      once: noop,
      whenReady: async () => undefined,
      isReady: () => true,
      quit: noop,
      exit: noop
    },
    BrowserWindow: class {
      webContents = { send: noop }
      isDestroyed(): boolean {
        return false
      }
      static getAllWindows(): unknown[] {
        return []
      }
    },
    ipcMain: { on: noop, once: noop, handle: noop },
    dialog: {
      showOpenDialog: async () => ({ canceled: true }),
      showSaveDialog: async () => ({ canceled: true }),
      showMessageBox: async () => ({ response: 0 })
    },
    shell: { openExternal: async () => undefined, openPath: async () => '' },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (b: Buffer) => b,
      decryptString: (b: Buffer) => b
    }
  }
})

import { createQuickContent } from '../../../../shared/schemas/quickCreate'
import { unifiedToBlock, unifiedToItem } from '../../../../shared/schemas/unified.adapter'
import { createDefaultEntity } from '../../../../shared/schemas/entity.schema'
import { createDefaultCube, type ContentDefinition } from '../../../../shared/types/content'
import { getToolchain } from '../../../templates/loaderVersionMatrix'
import { generateContent } from '../../contentGenerator'
import { cancelGradle, executeGradleBuild } from '../../gradleService'
import { createProject } from '../../projectService'
import { getSection, setSettings } from '../../settingsService'
import { createMatrixHealthStore } from '../matrixHealthStore'

const GATE_ENABLED = process.env.KY_RUNTIME_GATE === '1'
/** 单组合超时：首次 runServer 需解析运行时依赖并生成世界，冷缓存下比 build 更慢 */
function parseTimeoutMs(env: string | undefined, fallback: number): number {
  if (env === undefined) return fallback
  const n = Number(env)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
const VITEST_TIMEOUT = parseTimeoutMs(process.env.KY_RUNTIME_VITEST_TIMEOUT, 20 * 60 * 1000)
const GRADLE_TIMEOUT = Math.min(
  parseTimeoutMs(process.env.KY_RUNTIME_GRADLE_TIMEOUT, VITEST_TIMEOUT - 60_000),
  VITEST_TIMEOUT - 30_000
)
const LOG_TAIL = 32 * 1024
const REPORT_TAIL = 12 * 1024

type GateLoader = 'fabric' | 'forge' | 'neoforge'

interface GateCombo {
  loader: GateLoader
  mcVersion: string
}

/** 版本族代表组（见文件头注释；Forge 无 1.21.11） */
const REPRESENTATIVE: GateCombo[] = [
  { loader: 'fabric', mcVersion: '1.20.1' },
  { loader: 'fabric', mcVersion: '1.21.1' },
  { loader: 'fabric', mcVersion: '1.21.11' },
  { loader: 'fabric', mcVersion: '26.3' },
  { loader: 'forge', mcVersion: '1.20.1' },
  { loader: 'forge', mcVersion: '1.21.1' },
  { loader: 'forge', mcVersion: '26.3' },
  { loader: 'neoforge', mcVersion: '1.20.4' },
  { loader: 'neoforge', mcVersion: '1.21.1' },
  { loader: 'neoforge', mcVersion: '1.21.11' },
  { loader: 'neoforge', mcVersion: '26.3' }
]

const COMBOS_FILTER = (process.env.KY_RUNTIME_COMBOS ?? '')
  .split(',')
  .map((c) => c.trim())
  .filter((c) => c.length > 0)
const COMBOS = REPRESENTATIVE.filter(
  (c) => COMBOS_FILTER.length === 0 || COMBOS_FILTER.includes(`${c.loader}-${c.mcVersion}`)
)

/** 服务器启动失败的首因模式（命中即提前终止，避免白等超时） */
const FATAL_PATTERNS: RegExp[] = [
  /Exception in thread "main"/,
  /Failed to start the minecraft server/,
  /Missing or unsupported mandatory dependencies/,
  /Mod resolution failed/i,
  /Registry remapping failed/i,
  /java\.lang\.NoClassDefFoundError/,
  /Could not execute entrypoint/,
  /A fatal error has been detected/,
  /You need to agree to the EULA/,
  /Failed to load mods/i
]

interface LoadResult {
  pass: boolean
  log: string
  reason?: string
}

function gateJavaHome(requiredJdk: number): string | undefined {
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
function useGradleDistMirror(root: string, gradleVersion: string): void {
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
function prepareServer(root: string): void {
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
function gateDefinitions(): ContentDefinition[] {
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

/** 启动专用服务器到 Done；命中 Done 后主动取消 Gradle 任务，避免常驻 */
function runServer(root: string, javaHome: string | undefined): Promise<LoadResult> {
  return new Promise((resolveLoad) => {
    let log = ''
    let runId = ''
    let sawDone = false
    let stopRequested = false
    let finished = false
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
          timeoutMs: GRADLE_TIMEOUT,
          extraArgs: ['--no-daemon']
        },
        (ev) => {
          if (ev.type === 'output') {
            log += `${ev.text}\n`
            if (log.length > LOG_TAIL * 2) log = log.slice(-LOG_TAIL)
            if (!sawDone && /\bDone \([\d.]+s\)! For help/.test(ev.text)) {
              sawDone = true
              if (!stopRequested) {
                stopRequested = true
                cancelGradle(runId)
              }
              return
            }
            if (!sawDone && FATAL_PATTERNS.some((re) => re.test(ev.text)) && !stopRequested) {
              stopRequested = true
              cancelGradle(runId)
            }
            return
          }
          if (ev.type === 'phase' && ev.phase === 'done') {
            if (sawDone) return finish(true)
            const hit = FATAL_PATTERNS.find((re) => re.test(log))
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

/** 回写 stages.load（租用与矩阵门禁相同的运行时真源路径） */
function recordLoad(combo: GateCombo, pass: boolean, reason?: string): void {
  const storePath =
    process.env.KY_MATRIX_HEALTH_PATH ??
    resolve(process.cwd(), '.dev-userdata', 'ai', 'ai-reference-overlay.json')
  try {
    createMatrixHealthStore({ path: storePath }).recordLoadResult({
      comboId: `${combo.loader}-${combo.mcVersion}`,
      pass,
      at: new Date().toISOString(),
      ...(reason ? { note: reason.slice(0, 300) } : {})
    })
  } catch (err) {
    console.warn(`[runtime-gate] stages.load 回写失败（${storePath}）：${(err as Error).message}`)
  }
}

describe.skipIf(!GATE_ENABLED)(`Runtime 门禁（专用服务器加载，共 ${COMBOS.length} 组合）`, () => {
  const gateBase = join(tmpdir(), `kunyu-runtime-gate-projects-${process.pid}`)

  beforeAll(() => {
    // 与矩阵门禁同策略：CI runner 在国外，maven 仓库强制 official
    if (process.env.CI) {
      const current = getSection('network')
      if (current.mirror !== 'official') {
        setSettings({ network: { ...current, mirror: 'official' } })
      }
    }
  })

  afterEach(() => {
    const maxRetries = 5
    const isWin = process.platform === 'win32'
    for (let i = 0; i < maxRetries; i++) {
      try {
        rmSync(gateBase, { recursive: true, force: true })
        return
      } catch {
        if (!isWin) return
        try {
          execSync('ping -n 2 127.0.0.1 > nul 2>&1', {
            stdio: 'ignore',
            timeout: 5000
          })
        } catch {
          /* 忽略 ping 失败 */
        }
      }
    }
  })

  it.each(COMBOS)(
    '$loader @ $mcVersion：服务器启动到 Done',
    async (combo) => {
      const { loader, mcVersion } = combo
      const project = createProject({
        name: `runtime-${loader}-${mcVersion}`,
        type: 'mod',
        path: join(gateBase, `${loader}-${mcVersion}`),
        loader,
        mcVersion,
        modId: 'gatemod',
        namespace: 'gatemod'
      })

      const tc = getToolchain(loader, mcVersion)
      const hostJdk = 'hostJdk' in tc && tc.hostJdk ? tc.hostJdk : tc.jdk
      if (process.env.CI) useGradleDistMirror(project.path, tc.gradleVersion)

      prepareServer(project.path)
      const generated = generateContent(project.path, gateDefinitions())
      expect(generated.files.length).toBeGreaterThan(0)

      const result = await runServer(project.path, gateJavaHome(hostJdk))
      recordLoad(combo, result.pass, result.reason)

      expect(
        result.pass,
        `服务器未启动到 Done（reason=${result.reason ?? 'unknown'}）日志尾部：\n${result.log.slice(-REPORT_TAIL)}`
      ).toBe(true)
    },
    VITEST_TIMEOUT
  )
})
