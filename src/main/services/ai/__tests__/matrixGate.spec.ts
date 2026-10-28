/**
 * P0-1 矩阵门禁。
 *
 * KY_MATRIX_GATE=1 时启用：对 core/extended（可经 KY_MATRIX_TIERS 覆盖，逗号分隔）
 * 全部「加载器 × MC 版本」组合走真实产品链路：
 *   createProject（全量脚手架）→ createQuickContent 注入 block/item/food/tool/armor
 *   → unifiedToBlock/unifiedToItem → generateContent → executeGradleBuild('build')
 * 构建结果写回矩阵健康统一存储 ai-reference-overlay.json 对应组合的
 * matrixHealth 档案与灯色（通过 = 100% + health 绿；失败 = 0% + health 黄），
 * 作为矩阵绿灯的真实来源（统一成套整改：不再回写仓库 manifest.json——
 * manifest 冻结为静态基线，health 唯一真源为 overlay，见 matrixHealthStore）。
 * 回写路径：KY_MATRIX_HEALTH_PATH 环境变量优先，缺省 <cwd>/.dev-userdata/ai/
 * ai-reference-overlay.json（即本机 dev 应用运行时读取的同一份文件，跑完重启
 * 应用或刷新设置面板即见；CI 上落入 runner 工作区，跑完随 job 丢弃）。
 *
 * 常规单测（无该环境变量）整组 skip——门禁含真实 Gradle 构建与网络下载，
 * 只能由 `npm run test:matrix`（CI matrix-gate job / 本机手动）触发；
 * matrixHealth 的 templateCount 语义随门禁接管：值为门禁注入的内容类型数。
 *
 * 本机手动运行前置：JDK17/21 已安装，并按 gateJavaHome 约定暴露
 * `JAVA_HOME_17_X64` / `JAVA_HOME_21_X64` 环境变量（CI 由 setup-java 自动提供）。
 * 注意 maven.neoforged.net 在部分国内网络环境被污染（DNS 指向无效 IP），
 * NFRT 下载会失败——neoforge 组合以 CI matrix-gate job 结果为准。
 */
import { rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// 门禁链路经 projectService/gradleService 触达 electron（SQLite userData / 设置缓存 /
// 构建事件推送）。node 测试环境以最小桩替身满足导入与调用：userData 指向临时目录，
// 不触碰真实应用数据；BrowserWindow/ipcMain/dialog/shell 仅需存在不抛错。
vi.mock('electron', async () => {
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = join(tmpdir(), `kunyu-matrix-gate-${process.pid}`)
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
import { getToolchain, isBetaBlocked, supportedMcVersions, tierOfMcVersion } from '../../../templates/loaderVersionMatrix'
import { generateContent } from '../../contentGenerator'
import { executeGradleBuild } from '../../gradleService'
import { createProject } from '../../projectService'
import { getSection, setSettings } from '../../settingsService'
import { createMatrixHealthStore } from '../matrixHealthStore'

const GATE_ENABLED = process.env.KY_MATRIX_GATE === '1'
/** PR 档轻量模式：跑 compileJava+processResources+jar（2-6 分钟/组合），不写回 manifest */
const GATE_PR = process.env.KY_MATRIX_PR === '1'
/** 门禁覆盖分层（legacy 在 P0-1 修复后纳入真机构建门禁） */
const GATE_TIERS = (process.env.KY_MATRIX_TIERS ?? 'core,extended,legacy')
  .split(',')
  .map((t) => t.trim())
  .filter((t) => t.length > 0)
/** 单组合上限：完整 build 首次需下载 Gradle 发行包与全部依赖（对齐编译探针 30 分钟并留余量）；
 *  PR 档跑 compileJava+processResources+jar（PR 档补资源拷贝与打包任务），
 *  forge/neoforge 冷缓存需下载 ForgeGradle 插件 + Minecraft 映射 + 重映射，10 分钟不够，
 *  CI 实测 forge-1.20.1 需 12+ 分钟，故 PR 档提至 15 分钟。
 *  可用 KY_MATRIX_VITEST_TIMEOUT 环境变量覆盖（毫秒），便于 CI 按 runner 性能调优。 */
/** 解析超时环境变量：非法值回退默认，NaN 防御。 */
function parseTimeoutMs(env: string | undefined, fallback: number): number {
  if (env === undefined) return fallback
  const n = Number(env)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
const DEFAULT_VITEST_TIMEOUT = (GATE_PR ? 15 : 50) * 60 * 1000
const VITEST_TIMEOUT = parseTimeoutMs(process.env.KY_MATRIX_VITEST_TIMEOUT, DEFAULT_VITEST_TIMEOUT)
/** gradleService 内部超时必须比 vitest testTimeout 早 1 分钟触发：
 *  确保超时回调里 cancelGradle（spawnSync taskkill）杀完进程树、finishRun 清理 activeRuns、
 *  done 事件回调 resolve 之后，vitest 才断言失败并进入 afterEach 清理——
 *  否则 vitest 先中断测试，异步 taskkill 未完成导致 EBUSY + activeRuns 残留阻塞后续组合。
 *  强制 GRADLE_TIMEOUT < VITEST_TIMEOUT（至少留 30s 余量），防止环境变量覆盖破坏分级。 */
const rawGradleTimeout = parseTimeoutMs(process.env.KY_MATRIX_GRADLE_TIMEOUT, VITEST_TIMEOUT - 60_000)
const GRADLE_TIMEOUT = Math.min(rawGradleTimeout, VITEST_TIMEOUT - 30_000)
/** PR 档任务集：compileJava 之外补 processResources（资源 JSON 落位）与 jar（打包链路） */
const GATE_PR_TASKS = ['compileJava', 'processResources', 'jar'] as const
/** 失败诊断保留的日志尾部大小 */
const LOG_TAIL = 32 * 1024

const LOADERS = ['fabric', 'forge', 'neoforge'] as const
type GateLoader = (typeof LOADERS)[number]

interface GateCombo {
  loader: GateLoader
  mcVersion: string
}

/** 门禁组合清单：三加载器矩阵中 tier 命中的全部 MC 版本（与 manifest 指纹一一对应）。
 *  beta 组合（NeoForge 26.3，官方未 GA）排除——createProject 会被 isSupportedCombo 拦截，
 *  绿灯留待官方稳定后再纳入真机构建。 */
const GATE_COMBOS: GateCombo[] = LOADERS.flatMap((loader) =>
  supportedMcVersions(loader)
    .filter((v) => GATE_TIERS.includes(tierOfMcVersion(v)))
    .filter((v) => !isBetaBlocked(loader, v))
    .map((mcVersion) => ({ loader, mcVersion }))
)

/** 按 GitHub runner 约定解析 JDK 宿主：setup-java 写入 JAVA_HOME_<major>_<arch> */
function gateJavaHome(requiredJdk: number): string | undefined {
  return (
    process.env[`JAVA_HOME_${requiredJdk}_X64`] ??
    process.env[`JAVA_HOME_${requiredJdk}_ARM64`] ??
    process.env.JAVA_HOME ??
    undefined
  )
}

interface GateBuildResult {
  exitCode: number | null
  timedOut: boolean
  cancelled: boolean
  log: string
}

/** 等待一次真实 Gradle 构建到 done，返回退出码与日志尾部。
 *  环境性失败（spawn ENOENT 等）不 reject，resolve 为 exitCode=null，
 *  以便调用方区分"环境失败"与"构建失败"，避免环境性失败污染 manifest。
 */
function runGradleBuild(root: string, javaHome: string | undefined): Promise<GateBuildResult> {
  return new Promise((resolveBuild) => {
    let log = ''
    try {
      executeGradleBuild(
        // --no-daemon：构建 JVM 随任务结束退出，避免常驻 GradleDaemon 锁定 loom-cache 映射 jar
        // （Windows 实证：daemon 存活导致 afterEach rmSync 连续 5 次重试仍 EBUSY，污染后续组合）
        {
          root,
          tasks: GATE_PR ? [...GATE_PR_TASKS] : ['build'],
          javaHome,
          timeoutMs: GRADLE_TIMEOUT,
          extraArgs: ['--no-daemon']
        },
        (ev) => {
          if (ev.type === 'output') {
            log += `${ev.text}\n`
            if (log.length > LOG_TAIL * 2) log = log.slice(-LOG_TAIL)
            return
          }
          if (ev.type === 'phase' && ev.phase === 'done') {
            resolveBuild({
              exitCode: ev.exitCode,
              timedOut: ev.timedOut,
              cancelled: ev.cancelled,
              log
            })
          }
        }
      )
    } catch (err) {
      // 环境性失败（spawn ENOENT 等）：resolve 为 exitCode=null，不 reject
      resolveBuild({
        exitCode: null,
        timedOut: false,
        cancelled: false,
        log: `${(err as Error).message}\n${(err as Error).stack ?? ''}`
      })
    }
  })
}

/** 把单组合构建结果写回矩阵健康统一存储（与探针/监测同一文件，杜绝双写分裂） */
function writeBackMatrixHealth(combo: GateCombo, pass: boolean, definitionCount: number): void {
  const storePath =
    process.env.KY_MATRIX_HEALTH_PATH ??
    resolve(process.cwd(), '.dev-userdata', 'ai', 'ai-reference-overlay.json')
  try {
    createMatrixHealthStore({ path: storePath }).recordGateResult({
      comboId: `${combo.loader}-${combo.mcVersion}`,
      pass,
      templateCount: definitionCount,
      at: new Date().toISOString()
    })
  } catch (err) {
    console.warn(`[matrix-gate] matrixHealth 回写失败（${storePath}）：${(err as Error).message}`)
  }
}

describe.skipIf(!GATE_ENABLED)(`矩阵门禁（tiers=${GATE_TIERS.join(',')}，共 ${GATE_COMBOS.length} 组合）`, () => {
  const gateBase = join(tmpdir(), `kunyu-matrix-gate-projects-${process.pid}`)

  beforeAll(() => {
    // CI runner 在国外，国内镜像源（BMCLAPI bmclapi2.bangbang93.com / 阿里云）
    // 对国外 IP 不稳定（实测 BMCLAPI 重定向到 bmclapi.hurtmc.com 时 DNS 解析失败），
    // 强制改用官方源。本地开发保持默认 china 镜像加速。
    if (process.env.CI) {
      const current = getSection('network')
      if (current.mirror !== 'official') {
        setSettings({ network: { ...current, mirror: 'official' } })
        console.warn('[matrix-gate] CI 环境已强制 mirror=official（国内镜像源对国外 runner 不稳定）')
      }
    }
  })

  afterEach(() => {
    // 逐组合清理脚手架与构建产物（构建日志已随断言消息输出）。
    // Windows 下 Gradle 进程被 spawnSync taskkill 杀死后，文件句柄可能延迟数十毫秒释放，
    // rmSync 会抛 EBUSY/EPERM——重试 5 次（每次递增等待），避免清理失败污染后续组合。
    const maxRetries = 5
    const isWin = process.platform === 'win32'
    for (let i = 0; i < maxRetries; i++) {
      try {
        rmSync(gateBase, { recursive: true, force: true })
        return
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (i === maxRetries - 1 || (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY')) {
          throw err
        }
        // 同步等待：execSync 阻塞（afterEach 是同步钩子，不能用 setTimeout/await）。
        // Windows 用 ping -n，POSIX 用 ping -c；加 timeout 防 ping 卡死，try-catch 防命令缺失。
        const pingCmd = isWin ? 'ping -n 2 127.0.0.1 > nul 2>&1' : 'ping -c 2 127.0.0.1 > /dev/null 2>&1'
        try {
          execSync(pingCmd, { stdio: 'ignore', timeout: 5000 })
        } catch {
          /* ping 失败不阻塞重试循环 */
        }
      }
    }
  })

  it.each(GATE_COMBOS)(
    '$loader @ $mcVersion：快速内容 → 生成 → gradlew build',
    async (combo) => {
      const { loader, mcVersion } = combo
      const project = createProject({
        name: `gate-${loader}-${mcVersion}`,
        type: 'mod',
        path: join(gateBase, `${loader}-${mcVersion}`),
        loader,
        mcVersion,
        modId: 'gatemod',
        namespace: 'gatemod'
      })

      // 五类高频内容全走「快速创建」语义入口，覆盖方块注册与物品四子类型
      const block = unifiedToBlock(
        createQuickContent('block', { id: 'gate_block', namespace: 'gatemod' })
      )
      const item = unifiedToItem(
        createQuickContent('item', { id: 'gate_item', namespace: 'gatemod' })
      )
      const food = unifiedToItem(
        createQuickContent('food', { id: 'gate_food', namespace: 'gatemod' })
      )
      const tool = unifiedToItem(
        createQuickContent('tool', { id: 'gate_tool', namespace: 'gatemod' })
      )
      const armor = unifiedToItem(
        createQuickContent('armor', { id: 'gate_armor', namespace: 'gatemod' })
      )
      const definitions = [block, item, food, tool, armor]
      const generated = generateContent(project.path, definitions)
      expect(generated.files.length).toBeGreaterThan(0)

      // 宿主 JDK 选择：FabricToolchain.hostJdk 优先（1.21.6+ loom 1.18.4 强制 JVM 25，
      // 编译目标仍是 tc.jdk=21），缺省回落 tc.jdk
      const tc = getToolchain(loader, mcVersion)
      const hostJdk = 'hostJdk' in tc && tc.hostJdk ? tc.hostJdk : tc.jdk
      const build = await runGradleBuild(project.path, gateJavaHome(hostJdk))
      // 环境性失败（exitCode=null，如 spawn ENOENT / 超时 / 取消）不写回统一存储，
      // 避免 yellow/0% 抹平原有健康数据；PR 档不写回
      if (build.exitCode !== null && !GATE_PR) {
        writeBackMatrixHealth(combo, build.exitCode === 0, definitions.length)
      }

      expect(
        build.exitCode,
        `gradlew build 失败（exit=${build.exitCode}，timedOut=${build.timedOut}，cancelled=${build.cancelled}）日志尾部：\n${build.log.slice(-LOG_TAIL)}`
      ).toBe(0)
    },
    VITEST_TIMEOUT
  )
})
