/**
 * 应用自更新服务（electron-updater 封装）。
 *
 * 信任模型（重要）：
 * - 更新元数据 latest.yml 始终从 GitHub 直连获取（可信源），镜像不参与；
 * - 仅安装包本体在下载时改走镜像前缀（settings.general.updateMirrorPrefix，
 *   ghproxy 风格），镜像因此不可信也没关系——sha512 来自可信 latest.yml；
 * - 下载完成后本服务会用 Node 自己算一遍 sha512 与体积（≥10 MB）再进入
 *   downloaded 态，校验不通过直接删除并报错，绝不交给 updater 安装。
 *   镜像同时篡改 latest.yml 与安装包也无用：清单根本不会从镜像读。
 *
 * 策略（用户定案）：
 * - autoDownload=false：检查到新版只进 available 态，用户点「下载」才拉包；
 * - 安装需用户点「重启安装」（quitAndInstall 非静默，走 NSIS 向导）；
 * - 仅打包版生效（isPackagedRuntime），dev 下检查返回诚实错误，不静默吞。
 *
 * 停滞判定：下载中 30s 无 progress 事件 → 取消本次下载；若正在走镜像则回退
 * GitHub 重试一次，仍失败 → error 态 + 发布页地址（UI 提供「浏览器打开」兜底）。
 *
 * macOS：无 Apple 开发者签名，electron-updater 拒绝替换 .app（MacUpdater 强校验签名），
 * 故 darwin 只走「检查 → available → 浏览器下载 dmg」链路（manualDownloadOnly），
 * 应用内下载/安装被禁用；latest-mac.yml 仍由 electron-builder 发布，版本检测正常。
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import { basename } from 'node:path'
import { app, BrowserWindow } from 'electron'
// electron-updater 是 CJS 包，而主进程产物是 ESM（package.json type: module）。
// Node 的 CJS→ESM 具名导出依赖 cjs-module-lexer 静态分析，而 autoUpdater 在产物里
// 是 `Object.defineProperty(exports, ...)` 的惰性 getter，检测不到；具名导入会在
// 模块链接阶段抛 SyntaxError: Named export 'autoUpdater' not found，主进程直接起不来。
// 只能走 default 导入（= module.exports 整体），再经下面的 updater() 惰性取用。
import electronUpdater from 'electron-updater'
import type {
  AppUpdater,
  ProgressInfo,
  UpdateDownloadedEvent,
  UpdateInfo
} from 'electron-updater'
// CancellationToken 在 electron-updater 的 .d.ts 里（export * from './types'），
// 但 CJS 运行时产物并未 re-export（out/main.js 无 CancellationToken），
// 故从定义处 builder-util-runtime 取（其 out/index.js 有真实具名导出）。
import { CancellationToken } from 'builder-util-runtime'
import { IpcChannels } from '../../shared/types/ipc'
import { UPDATE_RELEASE_PAGE, type UpdateState } from '../../shared/types/update'
import { getSection } from './settingsService'
import { isPackagedRuntime } from '../runtimeEnv'

/**
 * 惰性取 autoUpdater：它在 CJS 产物里是 `get autoUpdater()`，首次访问才构造实例。
 * 不在模块顶层解构，避免主进程刚加载本模块（早于 app ready）就实例化 updater。
 */
function updater(): AppUpdater {
  return electronUpdater.autoUpdater
}

/** 主源 feed：GitHub Releases（与 electron-builder.yml publish 一致），元数据只从这里来 */
export function buildGithubFeed(): { provider: 'github'; owner: string; repo: string } {
  return { provider: 'github', owner: 'kunyu7696', repo: 'KunYuStudio' }
}

/**
 * 校验镜像前缀并归一化末尾斜杠。
 *
 * 三条硬性要求（防止拼接出的下载地址被改写或夹带凭证）：
 * - 必须是 https:；
 * - 不得含 `?` `#`（会截断/改写后续拼接的 release 路径）；
 * - 不得含 `@`（`https://user:pass@host` 形式可把请求引向攻击者主机）。
 * @returns 不合法或为空（用户禁用镜像）时返回 null
 */
export function normalizeMirrorPrefix(prefix: string): string | null {
  const trimmed = prefix.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  if (/[?#@]/.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname) return null
  return trimmed
}

/**
 * 镜像安装包根地址：前缀 + 固定版本号的 release 下载路径。
 * 用 `releases/download/v<version>` 而不是 `latest/download`：版本号来自可信
 * latest.yml，能保证镜像即使指向别的 Release 也会因文件名/sha512 不匹配而失败。
 * @returns 前缀或版本号不合法时返回 null
 */
export function buildMirrorInstallerBase(prefix: string, version: string): string | null {
  const base = normalizeMirrorPrefix(prefix)
  if (!base || !/^[0-9A-Za-z.+_-]+$/.test(version)) return null
  return `${base}/https://github.com/kunyu7696/KunYuStudio/releases/download/v${version}`
}

/** 安装包体积下限：10 MB（正常 NSIS/AppImage 远大于此，低于即视为被替换或下载残缺） */
export const MIN_INSTALLER_BYTES = 10 * 1024 * 1024
/** 无 progress 多少毫秒判定下载停滞 */
export const DOWNLOAD_STALL_MS = 30_000
/** 启动后延迟多少毫秒做自动检查（让窗口先出来） */
export const AUTO_CHECK_DELAY_MS = 8_000

let win: BrowserWindow | null = null
let cancelDownload: CancellationToken | null = null
let stallTimer: ReturnType<typeof setTimeout> | null = null
let checking = false
let wired = false
/** 本次检查拿到的可信元数据（update-available 事件对象，与 updater 内部同一引用） */
let trustedInfo: UpdateInfo | null = null
/** 改写到镜像前的原始文件 URL，回退 GitHub 时恢复 */
let originalFileUrls: string[] = []
/** 本次取消是否由停滞超时触发（用于给出可读错误文案） */
let stalledByTimeout = false

const state: UpdateState = {
  phase: 'idle',
  currentVersion: app.getVersion(),
  releasePageUrl: UPDATE_RELEASE_PAGE,
  // macOS 无签名包不可自动更新（见文件头说明）
  manualDownloadOnly: process.platform === 'darwin'
}

function broadcast(): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcChannels.UPDATE_STATE_CHANGED, { ...state })
  }
}

function patchState(patch: Partial<UpdateState>): void {
  Object.assign(state, patch)
  broadcast()
}

function clearStallTimer(): void {
  if (stallTimer !== null) {
    clearTimeout(stallTimer)
    stallTimer = null
  }
}

function armStallTimer(): void {
  clearStallTimer()
  stallTimer = setTimeout(() => {
    stallTimer = null
    onDownloadStalled()
  }, DOWNLOAD_STALL_MS)
}

/** 从清单 URL 取安装包文件名（兼容相对路径与已改写的绝对镜像地址） */
function installerFileName(raw: string): string | null {
  try {
    return basename(decodeURIComponent(new URL(raw, 'https://placeholder.invalid/').pathname)) || null
  } catch {
    return null
  }
}

/** 把 updater 将要下载的文件 URL 改写到镜像（sha512 仍保留可信清单里的值） */
function redirectInstallerToMirror(info: UpdateInfo, mirrorBase: string): boolean {
  const files = info.files ?? []
  if (files.length === 0) return false
  const rewritten: string[] = []
  for (const file of files) {
    const name = installerFileName(file.url)
    if (!name) return false
    rewritten.push(`${mirrorBase}/${encodeURIComponent(name)}`)
  }
  originalFileUrls = files.map((file) => file.url)
  files.forEach((file, index) => {
    file.url = rewritten[index]!
  })
  return true
}

/** 恢复 GitHub 原始文件 URL（镜像失败回退时调用） */
function restoreInstallerUrls(info: UpdateInfo | null): void {
  if (info && originalFileUrls.length > 0) {
    info.files?.forEach((file, index) => {
      const original = originalFileUrls[index]
      if (original) file.url = original
    })
  }
  originalFileUrls = []
}

function onDownloadStalled(): void {
  if (state.phase !== 'downloading') return
  stalledByTimeout = true
  try {
    cancelDownload?.cancel()
  } catch {
    /* 取消失败不阻断回退逻辑 */
  }
  clearStallTimer()
  // 取消后由 startDownload 的 catch 接管：镜像 → 回退 GitHub；GitHub → error
}

async function startDownload(): Promise<void> {
  clearStallTimer()
  cancelDownload = new CancellationToken()
  stalledByTimeout = false
  armStallTimer()
  try {
    await updater().downloadUpdate(cancelDownload)
  } catch (err) {
    clearStallTimer()
    // 已不在下载态：本次失败已被后续流程接管（如新一轮下载），不重复报错
    if (state.phase !== 'downloading') return
    if (state.viaMirror) {
      // 镜像不可用/被劫持/停滞：回退可信主源再试一次（此时 viaMirror=false，失败即报错）
      restoreInstallerUrls(trustedInfo)
      updater().disableDifferentialDownload = false
      patchState({ viaMirror: false, percent: 0, transferred: undefined, total: undefined })
      await startDownload()
      return
    }
    const message = stalledByTimeout
      ? '下载停滞（30 秒无进度），已取消；可点「重试」或用浏览器到发布页下载'
      : err instanceof Error
        ? err.message
        : String(err)
    stalledByTimeout = false
    patchState({ phase: 'error', error: message })
  }
}

/** 流式计算文件 sha512（base64，与 electron-builder latest.yml 的编码一致） */
async function sha512OfFile(file: string): Promise<string> {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('base64')
}

/**
 * 安装包自检：体积下限 + 自算 sha512，与可信清单比对。
 * 不依赖 electron-updater 内部校验（它也会校验，这里是第二道闸门）。
 */
export async function verifyInstallerFile(
  file: string,
  expectedSha512: string | null,
  minBytes: number = MIN_INSTALLER_BYTES
): Promise<void> {
  if (!expectedSha512) throw new Error('可信清单缺少 sha512，拒绝安装')
  const info = await stat(file)
  if (!info.isFile()) throw new Error('安装包路径不是文件')
  if (info.size < minBytes) {
    throw new Error(`安装包体积异常：${info.size} 字节，低于 ${minBytes} 字节下限`)
  }
  const actual = await sha512OfFile(file)
  if (actual !== expectedSha512) {
    throw new Error('安装包 sha512 与可信清单不一致，已拒绝安装')
  }
}

/** 取该安装包在可信清单里的 sha512（按下载文件名匹配，匹配不到退回首个文件） */
function expectedInstallerSha512(info: UpdateInfo, downloadedFile: string): string | null {
  const files = info.files ?? []
  const name = basename(downloadedFile)
  const match = files.find((file) => installerFileName(file.url) === name)
  const legacy = (info as UpdateInfo & { sha512?: string }).sha512
  return (match ?? files[0])?.sha512 ?? legacy ?? null
}

async function onUpdateDownloaded(event: UpdateDownloadedEvent): Promise<void> {
  clearStallTimer()
  try {
    await verifyInstallerFile(event.downloadedFile, expectedInstallerSha512(event, event.downloadedFile))
    patchState({ phase: 'downloaded', latestVersion: event.version, percent: 100, error: undefined })
  } catch (err) {
    // 校验失败：删掉已下载文件，避免下次被 updater 的缓存复用
    await unlink(event.downloadedFile).catch(() => {
      /* 删除失败不掩盖原始校验错误 */
    })
    patchState({
      phase: 'error',
      error: `安装包校验未通过：${err instanceof Error ? err.message : String(err)}`
    })
  }
}

function wireUpdaterEvents(): void {
  if (wired) return
  wired = true
  const autoUpdater = updater()
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false

  autoUpdater.on('checking-for-update', () => patchState({ phase: 'checking', error: undefined }))
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    // 事件里的 info 与 updater 内部 updateInfoAndProvider.info 是同一对象，
    // 后续 downloadUpdate 改 URL 才能生效。
    trustedInfo = info
    patchState({ phase: 'available', latestVersion: info.version, error: undefined })
  })
  autoUpdater.on('update-not-available', () => {
    trustedInfo = null
    patchState({ phase: 'latest', latestVersion: undefined, error: undefined })
  })
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    armStallTimer()
    patchState({
      phase: 'downloading',
      percent: Math.round(p.percent * 10) / 10,
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total
    })
  })
  autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
    void onUpdateDownloaded(event)
  })
  autoUpdater.on('error', (err: Error) => {
    clearStallTimer()
    // 下载阶段的失败统一由 startDownload 的 catch 处理（含镜像回退 / 停滞文案）
    if (state.phase === 'downloading') return
    patchState({ phase: 'error', error: err.message })
  })
}

export function initUpdater(mainWindow: BrowserWindow): void {
  win = mainWindow
  state.currentVersion = app.getVersion()
  wireUpdaterEvents()
  // 启动自动检查：仅打包版 + 设置开关开；静默失败（结果仍进状态机，UI 随时可查）
  if (isPackagedRuntime(app) && getSection('general').updateAutoCheck) {
    setTimeout(() => {
      void checkForUpdates(false)
    }, AUTO_CHECK_DELAY_MS)
  }
}

/** 手动/自动检查更新。manual=false 时错误不回弹对话框，只沉淀到状态机 */
export async function checkForUpdates(manual: boolean): Promise<UpdateState> {
  if (!isPackagedRuntime(app)) {
    patchState({ phase: 'error', error: '开发模式不检查更新；请使用打包版本' })
    return { ...state }
  }
  if (checking) return { ...state }
  checking = true
  // 元数据永远只从 GitHub 读（镜像只参与安装包下载，见文件头信任模型）
  updater().setFeedURL(buildGithubFeed())
  patchState({ phase: 'checking', viaMirror: false, error: undefined })
  try {
    await updater().checkForUpdates()
  } catch (err) {
    // error 事件通常已先行处理；promise reject 兜底：事件没覆盖时才落 error
    if (state.phase === 'checking') {
      trustedInfo = null
      patchState({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    checking = false
  }
  void manual
  return { ...state }
}

export async function downloadUpdate(): Promise<UpdateState> {
  // macOS 未签名：应用内下载被禁用，UI 引导浏览器下载 dmg（见文件头说明）
  if (state.manualDownloadOnly) return { ...state }
  if (state.phase === 'available' || state.phase === 'error') {
    const info = trustedInfo
    // 清理上一轮可能残留的镜像地址，保证下面记录的「原始 URL」一定是 GitHub 的
    restoreInstallerUrls(info)
    const mirrorBase =
      info == null ? null : buildMirrorInstallerBase(getSection('general').updateMirrorPrefix, info.version)
    const viaMirror = info != null && mirrorBase != null && redirectInstallerToMirror(info, mirrorBase)
    // 镜像只下全量包：跳过差分（差分还要从镜像取 blockmap，完全没必要）
    updater().disableDifferentialDownload = viaMirror
    patchState({
      phase: 'downloading',
      percent: 0,
      transferred: undefined,
      total: undefined,
      error: undefined,
      viaMirror
    })
    await startDownload()
  }
  return { ...state }
}

export function quitAndInstallUpdate(): void {
  // 只有自检通过的安装包才允许进入安装（防止状态被外部错误推进）
  if (state.phase !== 'downloaded') return
  // 非静默：走 NSIS 安装向导；安装完成后自动拉起新版本
  updater().quitAndInstall(false, true)
}

export function getUpdateState(): UpdateState {
  return { ...state }
}
