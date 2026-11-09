/**
 * Runtime 门禁（Stage 2：客户端进游戏）。
 *
 * 三态报告的第三态：加载通过 ≠ 能玩。本门禁在代表组上执行
 * createProject → generateContent（含实体）→（专用服务器生成平地世界）→
 * gradlew runClient + quickPlaySingleplayer，在虚拟显示（Xvfb + Mesa 软件渲染）
 * 下等待集成服务器 Done，然后抓屏留证；结果写回 matrixHealth.stages.runtime。
 *
 * 为什么不用全量 35 组合：每组含服务器生成世界 + 客户端首启（下载资源/渲染管线），
 * 单组以十分钟计，全量即数小时。客户端差异是族级的（Yarn/Mojmap 客户端入口、
 * 实体渲染器 API、Forge/NeoForge 客户端事件），故只跑版本族代表组。
 *
 * 通过判据（三者缺一不可）：
 *  1) 客户端进程存活到世界加载完成（日志出现玩家加入单人世界）；
 *  2) 无致命渲染/模组异常、无新 crash-report；
 *  3) 抓屏成功且画面非全黑（截图作为 artifact 上传，编译绿 ≠ 能玩的证据）。
 *
 * 仅 Linux（依赖 Xvfb / x11grab）；常规单测整组 skip，由
 * `npm run test:client`（CI client-gate job / 本机 xvfb-run）触发。
 * 定位：advisory（不阻塞合并/发布），稳定后再纳入发布前检查单。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// 与 matrixGate.spec / runtimeGate.spec 相同：门禁链路触达 electron，最小桩替身。
vi.mock('electron', async () => {
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = join(tmpdir(), `kunyu-client-gate-${process.pid}`)
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

import { getToolchain } from '../../../templates/loaderVersionMatrix'
import { generateContent } from '../../contentGenerator'
import { createProject } from '../../projectService'
import { getSection, setSettings } from '../../settingsService'
import {
  gateDefinitions,
  gateJavaHome,
  parseTimeoutMs,
  prepareServer,
  recordStageResult,
  runServer,
  useGradleDistMirror,
  type GateCombo
} from './gateHelpers'

const GATE_ENABLED =
  process.env.KY_CLIENT_GATE === '1' && process.platform === 'linux' && !!process.env.DISPLAY
/** 单组合超时：先服务器生成世界，再客户端首启（含资源下载与软件渲染） */
const VITEST_TIMEOUT = parseTimeoutMs(process.env.KY_CLIENT_VITEST_TIMEOUT, 30 * 60 * 1000)
const SERVER_TIMEOUT = parseTimeoutMs(process.env.KY_CLIENT_SERVER_TIMEOUT, 10 * 60 * 1000)
const CLIENT_TIMEOUT = Math.min(
  parseTimeoutMs(process.env.KY_CLIENT_TIMEOUT, 16 * 60 * 1000),
  VITEST_TIMEOUT - 150_000
)
const LOG_TAIL = 64 * 1024
const REPORT_TAIL = 12 * 1024
/** 世界加载完成后等待画面稳定（区块渲染/光照）再抓屏 */
const SCREENSHOT_SETTLE_MS = 6000
/** 抓屏分辨率（须与 Xvfb 屏幕一致；游戏窗口同尺寸，避免截图含大片黑边） */
const VIDEO_SIZE = process.env.KY_CLIENT_VIDEO_SIZE ?? '640x360'
const [GAME_WIDTH = '640', GAME_HEIGHT = '360'] = VIDEO_SIZE.split('x')

/**
 * 软件渲染（llvmpipe）下每帧成本直接决定加载进度：集成服务器 tick 挂在客户端帧循环上，
 * 帧率被背景模糊拖垮就等于世界永远加载不完（jstack 实测 Render thread 停在
 * processBlurEffect → glDrawArrays）。这里关掉主菜单背景模糊、拉低画质与视距，
 * 让"能否进入世界"的判据不被画面质量卡住。
 */
const CLIENT_OPTIONS = [
  'menuBackgroundBlurriness:0',
  'graphicsMode:1',
  'renderDistance:2',
  // 1.21.11 的模拟距离下限是 5，写 2 会报 "outside of range [5:33]" 并落回默认 12
  'simulationDistance:5',
  'guiScale:1',
  'particles:2',
  'entityShadows:false',
  'ao:false',
  'maxFps:60',
  'enableVsync:false',
  'pauseOnLostFocus:false',
  'fullscreen:false'
].join('\n')

/**
 * runClient 追加 quickPlay 参数。
 * 用 init script 在 projectsEvaluated 阶段 append，而非命令行 `--args`：
 * `--args` 会整体替换 JavaExec 的 args 列表（各加载器自己的启动参数可能被冲掉），
 * 而 append 与 Loom/FG/MDG 的参数装配方式无关。
 */
const CLIENT_INIT_SCRIPT = `gradle.projectsEvaluated {
    gradle.rootProject.allprojects { p ->
        p.tasks.matching { it.name == 'runClient' }.configureEach { t ->
            if (t instanceof org.gradle.api.tasks.JavaExec) {
                t.args('--quickPlaySingleplayer', 'gate_world', '--width', '${GAME_WIDTH}', '--height', '${GAME_HEIGHT}')
            }
        }
    }
}
`

/** 版本族代表组（客户端入口/渲染断点；Forge 只保留 1.20.1 旧入口，26.3 先观察 NeoForge） */
const REPRESENTATIVE: GateCombo[] = [
  { loader: 'fabric', mcVersion: '1.20.1' },
  { loader: 'fabric', mcVersion: '1.21.11' },
  { loader: 'fabric', mcVersion: '26.3' },
  { loader: 'forge', mcVersion: '1.20.1' },
  { loader: 'neoforge', mcVersion: '1.21.11' },
  { loader: 'neoforge', mcVersion: '26.3' }
]

const COMBOS_FILTER = (process.env.KY_CLIENT_COMBOS ?? '')
  .split(',')
  .map((c) => c.trim())
  .filter((c) => c.length > 0)
const COMBOS = REPRESENTATIVE.filter(
  (c) => COMBOS_FILTER.length === 0 || COMBOS_FILTER.includes(`${c.loader}-${c.mcVersion}`)
)

/** 客户端致命首因（命中即提前终止，避免白等超时；进程退出后仍用整段日志复查） */
const CLIENT_FATAL_PATTERNS: RegExp[] = [
  /A fatal error has been detected/,
  /The game crashed whilst/,
  /Exception in thread "Render thread"/,
  /Exception in thread "main"/,
  /Failed to create window/,
  /Failed to initialize GLFW/,
  /GLFW error 65544/,
  /Couldn't set pixel format/,
  /Missing or unsupported mandatory dependencies/,
  /Mod resolution failed/i,
  /Could not execute entrypoint/,
  /java\.lang\.NoClassDefFoundError/
]

/** 客户端窗口/渲染管线就绪（Sound engine 依赖音频设备，headless 下不可靠，不作判据） */
const CLIENT_READY_RE = /Backend library: LWJGL|Setting user:|Environment: authHost/
/**
 * 已进入世界。
 * 单人集成服务器不会打印专用服务器的 `Done (…)`（实测 1.21.11 只输出
 * `Preparing spawn area: 100%`、`logged in with entity id`、`joined the game`），
 * 故以玩家成功加入为就绪标志，同时保留 DedicatedServer 的 Done 兼容。
 */
const WORLD_READY_RE =
  /\bDone \([\d.]+s\)! For help|\] .* joined the game|logged in with entity id/

interface ClientRunResult {
  pass: boolean
  log: string
  reason?: string
  /** 截图绝对路径（失败时为 undefined） */
  screenshot?: string
  /** 相对仓库根的截图路径（写入 stages.runtime.note） */
  screenshotRel?: string
}

/** 供 afterEach 兜底清理（超时/失败路径不留下游戏进程） */
let activeChild: ChildProcess | null = null

function killTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid === undefined) return
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      /* 已退出 */
    }
  }
}

function waitClose(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolveWait) => {
    const timer = setTimeout(() => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* 已退出 */
      }
      resolveWait()
    }, timeoutMs)
    child.once('close', () => {
      clearTimeout(timer)
      resolveWait()
    })
  })
}

/** 世界加载完成后的抓屏（优先 ffmpeg x11grab；回退 ImageMagick import） */
function captureScreen(display: string, outPath: string): boolean {
  const ffmpeg = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'x11grab',
      '-video_size',
      VIDEO_SIZE,
      '-i',
      display,
      '-frames:v',
      '1',
      '-y',
      outPath
    ],
    { timeout: 30_000 }
  )
  if (ffmpeg.status === 0 && existsSync(outPath) && statSync(outPath).size > 0) return true
  const magick = spawnSync('import', ['-display', display, '-window', 'root', outPath], {
    timeout: 30_000
  })
  return magick.status === 0 && existsSync(outPath) && statSync(outPath).size > 0
}

/** 证据校验：能解码、非全黑、有画面层次（防止 GL 初始化失败却拿到黑屏截图） */
function inspectScreenshot(path: string): { ok: boolean; note: string } {
  let png: PNG
  try {
    png = PNG.sync.read(readFileSync(path))
  } catch (err) {
    return { ok: false, note: `截图无法解码：${(err as Error).message}` }
  }
  if (png.width < 320 || png.height < 240) {
    return { ok: false, note: `截图尺寸异常：${png.width}x${png.height}` }
  }
  let bright = 0
  let sampled = 0
  const colors = new Set<number>()
  // 隔点采样：全屏逐像素遍历无必要，采样足够判定"黑屏/单色"
  for (let i = 0; i < png.data.length; i += 16) {
    const r = png.data[i]!
    const g = png.data[i + 1]!
    const b = png.data[i + 2]!
    sampled += 1
    if (0.2126 * r + 0.7152 * g + 0.0722 * b > 12) bright += 1
    colors.add((r << 16) | (g << 8) | b)
  }
  const ratio = sampled > 0 ? bright / sampled : 0
  if (ratio < 0.05) return { ok: false, note: `截图接近全黑（亮像素占比 ${(ratio * 100).toFixed(1)}%）` }
  if (colors.size < 8) return { ok: false, note: `截图缺乏画面层次（仅 ${colors.size} 种颜色）` }
  return {
    ok: true,
    note: `${png.width}x${png.height}，亮像素占比 ${(ratio * 100).toFixed(0)}%，${colors.size} 种颜色`
  }
}

/** 世界生成后把服务器 run/world 复制为单机存档 run/saves/gate_world（quickPlay 入口） */
function stageWorld(root: string): { ok: boolean; reason?: string } {
  const runDir = join(root, 'run')
  const worldDir = join(runDir, 'world')
  const savesDir = join(runDir, 'saves', 'gate_world')
  if (!existsSync(join(worldDir, 'level.dat'))) {
    return { ok: false, reason: '服务器未生成世界（run/world/level.dat 缺失）' }
  }
  try {
    rmSync(savesDir, { recursive: true, force: true })
    mkdirSync(join(runDir, 'saves'), { recursive: true })
    cpSync(worldDir, savesDir, { recursive: true })
    // 服务器进程已退出，锁文件无意义；删掉避免单人打开时被判为"世界正在使用"
    rmSync(join(savesDir, 'session.lock'), { force: true })
  } catch (err) {
    return { ok: false, reason: `世界复制失败：${(err as Error).message}` }
  }
  return { ok: true }
}

function readNewCrash(runDir: string, known: Set<string>): string | null {
  const dir = join(runDir, 'crash-reports')
  if (!existsSync(dir)) return null
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.txt'))
  } catch {
    return null
  }
  const fresh = files.filter((f) => !known.has(f)).sort()
  return fresh.length > 0 ? join(dir, fresh[fresh.length - 1]!) : null
}

/**
 * 失败留证：完整客户端日志 + Java 进程命令行 + JVM 线程栈。
 * 只给日志尾部无法区分「渲染线程卡在 native 调用」与「加载只是极慢」；
 * 超时瞬间的 jstack 加上 ps 命令行（可确认 quickPlay 参数是否真的注入）能直接定位。
 */
function dumpClientDiagnostics(runDir: string, comboId: string): string {
  const outDir = join(process.cwd(), '.dev-userdata', 'client-gate')
  mkdirSync(outDir, { recursive: true })
  const saved: string[] = []

  const latest = join(runDir, 'logs', 'latest.log')
  if (existsSync(latest)) {
    const dest = join(outDir, `${comboId}-latest.log`)
    try {
      cpSync(latest, dest)
      saved.push(dest)
    } catch {
      /* 日志可能正被写入，忽略 */
    }
  }

  if (process.platform === 'linux') {
    // gradlew → java 主类：Fabric=devlaunchinjector，Forge/NeoForge=dev-launch，原版=Main
    const found = spawnSync(
      'bash',
      [
        '-c',
        "pgrep -f 'devlaunchinjector|dev-launch-injector|net.minecraft.client.main.Main' | head -n 1"
      ],
      { encoding: 'utf-8', timeout: 10_000 }
    )
    const pid = (found.stdout ?? '').trim()
    if (pid.length > 0) {
      const cmdline = join(outDir, `${comboId}-cmdline.txt`)
      try {
        writeFileSync(
          cmdline,
          spawnSync('bash', ['-c', `ps -o args= -p ${pid}`], { encoding: 'utf-8' }).stdout ?? '',
          'utf-8'
        )
        saved.push(cmdline)
      } catch {
        /* 忽略 */
      }
      const stack = join(outDir, `${comboId}-jstack.txt`)
      const res = spawnSync('bash', ['-c', `jstack ${pid} > "${stack}" 2>&1`], {
        timeout: 40_000
      })
      if (res.status === 0) saved.push(stack)
    }
  }

  return saved.length > 0 ? `已留证：${saved.map((p) => p.split(/[\\/]/).pop()).join('、')}` : '留证失败'
}

function runClient(
  root: string,
  javaHome: string | undefined,
  comboId: string,
  display: string
): Promise<ClientRunResult> {
  return new Promise((resolveRun) => {
    const runDir = join(root, 'run')
    const logPath = join(runDir, 'logs', 'latest.log')
    const shotDir = join(process.cwd(), '.dev-userdata', 'client-gate')
    const shotPath = join(shotDir, `${comboId}.png`)

    const knownCrashes = new Set<string>()
    const crashDir = join(runDir, 'crash-reports')
    if (existsSync(crashDir)) {
      try {
        readdirSync(crashDir).forEach((f) => knownCrashes.add(f))
      } catch {
        /* 忽略 */
      }
    }
    // 客户端会轮转日志；先删掉服务器阶段的 latest.log，避免把服务器 Done 误判为进世界
    rmSync(logPath, { force: true })
    // 首启前落一份 options.txt：软件渲染下默认画质/背景模糊会把帧率压到无法推进世界加载
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'options.txt'), `${CLIENT_OPTIONS}\n`, 'utf-8')

    let log = ''
    const append = (text: string): void => {
      log += text
      if (log.length > LOG_TAIL * 2) log = log.slice(-LOG_TAIL)
    }
    let offset = 0
    let clientReady = false
    let worldReady = false
    let stopping = false
    let finished = false
    let settleTimer: NodeJS.Timeout | null = null
    let pollTimer: NodeJS.Timeout | null = null
    let timeoutTimer: NodeJS.Timeout | null = null

    const finish = (result: ClientRunResult): void => {
      if (finished) return
      finished = true
      if (settleTimer) clearTimeout(settleTimer)
      if (pollTimer) clearInterval(pollTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      const child = activeChild
      activeChild = null
      if (child) {
        killTree(child)
        void waitClose(child, 20_000).then(() => resolveRun(result))
      } else {
        resolveRun(result)
      }
    }

    const fail = (reason: string): void => {
      if (finished) return
      const crash = readNewCrash(runDir, knownCrashes)
      const diag = dumpClientDiagnostics(runDir, comboId)
      let suffix = ''
      if (crash) {
        try {
          suffix = `；crash-report：${readFileSync(crash, 'utf-8').slice(0, 1200)}`
        } catch {
          suffix = '；crash-report 读取失败'
        }
      }
      finish({ pass: false, log, reason: `${reason}；${diag}${suffix}` })
    }

    if (!existsSync(join(root, 'gradlew'))) return fail('项目中未找到 Gradle Wrapper')

    /** 世界加载完成 → 等画面稳定 → 抓屏校验；截图是"能玩"的唯一证据 */
    const onWorldReady = (): void => {
      if (worldReady || finished) return
      worldReady = true
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        if (finished) return
        mkdirSync(shotDir, { recursive: true })
        if (!captureScreen(display, shotPath)) return fail('抓屏失败（ffmpeg/ImageMagick 均不可用）')
        const shot = inspectScreenshot(shotPath)
        if (!shot.ok) return fail(shot.note)
        finish({
          pass: true,
          log,
          screenshot: shotPath,
          screenshotRel: `.dev-userdata/client-gate/${comboId}.png`
        })
      }, SCREENSHOT_SETTLE_MS)
    }

    /** 增量日志统一处理：窗口就绪标记、致命首因（优先）、进世界 */
    const scan = (text: string): void => {
      if (CLIENT_READY_RE.test(text)) clientReady = true
      if (!stopping && !worldReady) {
        const fatal = CLIENT_FATAL_PATTERNS.find((re) => re.test(text))
        if (fatal) {
          stopping = true
          return fail(`命中客户端失败模式：${fatal.source}`)
        }
      }
      if (WORLD_READY_RE.test(text)) onWorldReady()
    }

    const env: NodeJS.ProcessEnv = { ...process.env, DISPLAY: display }
    if (javaHome) {
      env['JAVA_HOME'] = javaHome
      env['PATH'] = `${join(javaHome, 'bin')}:${env['PATH'] ?? ''}`
    }
    // Loom 1.19 在 CI + Linux 下会给 runClient 再套一层 `xvfb-run --auto-servernum`
    // （游戏渲染到内部独立 DISPLAY），外层抓屏只会拿到黑屏。
    // 摘掉 CI 让 Loom 复用外层 Xvfb 的 DISPLAY，截图才是真实画面。
    delete env['CI']
    // 无声卡的 CI 上 OpenAL 会走 ALSA default PCM，既刷错误也可能拖住渲染线程初始化；
    // 门禁只关心画面，强制 OpenAL Soft 用 null 后端，把音频变量从判据里摘出去。
    env['ALSOFT_DRIVERS'] = env['ALSOFT_DRIVERS'] ?? 'null'

    const initScript = join(root, 'gate-client.init.gradle')
    writeFileSync(initScript, CLIENT_INIT_SCRIPT, 'utf-8')
    // --no-daemon：每组独占一个单次 daemon，随游戏退出释放内存（6 组合常驻 daemon 会压满 runner）
    const child = spawn(
      'sh',
      [
        join(root, 'gradlew'),
        'runClient',
        '--console=plain',
        '--no-daemon',
        `--init-script=${initScript}`
      ],
      {
        cwd: root,
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    activeChild = child

    const onOutput = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      append(text)
      scan(text)
    }
    child.stdout?.on('data', onOutput)
    child.stderr?.on('data', onOutput)

    child.on('error', (err) => fail(`无法启动 Gradle 进程：${err.message}`))
    child.on('close', (code) => {
      if (finished) return
      fail(
        worldReady
          ? `客户端在世界加载后退出（exit=${code}）`
          : `客户端提前退出（exit=${code}）`
      )
    })

    pollTimer = setInterval(() => {
      if (finished) return
      if (!existsSync(logPath)) return
      try {
        const size = statSync(logPath).size
        if (size <= offset) return
        const buf = readFileSync(logPath)
        const chunk = buf.subarray(offset, size).toString('utf8')
        offset = size
        append(chunk)
        scan(chunk)
      } catch {
        /* 日志暂不可读，下轮重试 */
      }
    }, 2000)

    timeoutTimer = setTimeout(() => {
      if (finished) return
      fail(
        worldReady
          ? '抓屏阶段超时'
          : clientReady
            ? '客户端已启动但未进入世界（渲染/加载阻塞）'
            : '客户端启动超时（未出现游戏窗口）'
      )
    }, CLIENT_TIMEOUT)
  })
}

describe.skipIf(!GATE_ENABLED)(`客户端进游戏门禁（共 ${COMBOS.length} 组合）`, () => {
  const gateBase = join(tmpdir(), `kunyu-client-gate-projects-${process.pid}`)

  beforeAll(() => {
    // 与矩阵/运行时门禁同策略：CI runner 在国外，maven 仓库强制 official
    if (process.env.CI) {
      const current = getSection('network')
      if (current.mirror !== 'official') {
        setSettings({ network: { ...current, mirror: 'official' } })
      }
    }
  })

  afterEach(() => {
    if (activeChild) {
      killTree(activeChild)
      activeChild = null
    }
    rmSync(gateBase, { recursive: true, force: true })
  })

  afterAll(() => {
    if (activeChild) {
      killTree(activeChild)
      activeChild = null
    }
  })

  it.each(COMBOS)(
    '$loader @ $mcVersion：客户端进入世界并留证',
    async (combo) => {
      const comboId = `${combo.loader}-${combo.mcVersion}`
      const project = createProject({
        name: `client-${comboId}`,
        type: 'mod',
        path: join(gateBase, comboId),
        loader: combo.loader,
        mcVersion: combo.mcVersion,
        modId: 'gatemod',
        namespace: 'gatemod'
      })

      const tc = getToolchain(combo.loader, combo.mcVersion)
      const hostJdk = 'hostJdk' in tc && tc.hostJdk ? tc.hostJdk : tc.jdk
      if (process.env.CI) useGradleDistMirror(project.path, tc.gradleVersion)

      prepareServer(project.path)
      const generated = generateContent(project.path, gateDefinitions())
      expect(generated.files.length).toBeGreaterThan(0)

      // 1) 先让专用服务器生成平地世界（Stage 1 已验证该路径）
      const server = await runServer(project.path, gateJavaHome(hostJdk), SERVER_TIMEOUT)
      if (!server.pass) {
        recordStageResult('runtime', comboId, false, `世界生成失败：${server.reason ?? 'unknown'}`)
        expect.fail(
          `世界生成失败（reason=${server.reason ?? 'unknown'}）日志尾部：\n${server.log.slice(-REPORT_TAIL)}`
        )
      }
      const staged = stageWorld(project.path)
      if (!staged.ok) {
        recordStageResult('runtime', comboId, false, staged.reason)
        expect.fail(staged.reason)
      }

      // 2) 客户端 quickPlay 进世界（Xvfb + 软件渲染由 workflow 提供 DISPLAY）
      const display = process.env.DISPLAY ?? ''
      const result = await runClient(project.path, gateJavaHome(hostJdk), comboId, display)
      recordStageResult(
        'runtime',
        comboId,
        result.pass,
        result.pass
          ? `已进入世界并截图：${result.screenshotRel}`
          : `未进入世界：${result.reason ?? 'unknown'}`
      )

      expect(
        result.pass,
        `客户端未进入世界（reason=${result.reason ?? 'unknown'}）日志尾部：\n${result.log.slice(-REPORT_TAIL)}`
      ).toBe(true)
    },
    VITEST_TIMEOUT
  )
})
