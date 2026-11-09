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
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const GATE_ENABLED = process.env.KY_RUNTIME_GATE === '1'
/** 单组合超时：首次 runServer 需解析运行时依赖并生成世界，冷缓存下比 build 更慢 */
const VITEST_TIMEOUT = parseTimeoutMs(process.env.KY_RUNTIME_VITEST_TIMEOUT, 20 * 60 * 1000)
const GRADLE_TIMEOUT = Math.min(
  parseTimeoutMs(process.env.KY_RUNTIME_GRADLE_TIMEOUT, VITEST_TIMEOUT - 60_000),
  VITEST_TIMEOUT - 30_000
)
const REPORT_TAIL = 12 * 1024

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

      const result = await runServer(project.path, gateJavaHome(hostJdk), GRADLE_TIMEOUT)
      recordStageResult('load', `${loader}-${mcVersion}`, result.pass, result.reason)

      expect(
        result.pass,
        `服务器未启动到 Done（reason=${result.reason ?? 'unknown'}）日志尾部：\n${result.log.slice(-REPORT_TAIL)}`
      ).toBe(true)
    },
    VITEST_TIMEOUT
  )
})
