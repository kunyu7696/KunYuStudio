/**
 * 应用自更新服务（electron-updater 封装）。
 *
 * 链路：GitHub Releases 主源（kunyu7696/KunYuStudio，公开仓库免 Token）
 * → 直连失败/下载停滞 → 镜像兜底（settings.general.updateMirrorPrefix，
 * ghproxy 风格前缀 + releases/latest/download 稳定路径，目录式布局正好匹配
 * electron-updater generic provider 的 `${url}/latest.yml` 拉取方式）。
 *
 * 策略（用户定案）：
 * - autoDownload=false：检查到新版只进 available 态，用户点「下载」才拉包；
 * - 安装需用户点「重启安装」（quitAndInstall 非静默，走 NSIS 向导）；
 * - 仅打包版生效（isPackagedRuntime），dev 下检查返回诚实错误，不静默吞。
 *
 * 停滞判定：下载中 30s 无任何 progress 事件 → 取消本次下载并切镜像重试一次；
 * 镜像再失败 → error 态 + 发布页地址（UI 提供「浏览器打开」手动下载兜底）。
 *
 * macOS：无 Apple 开发者签名，electron-updater 拒绝替换 .app（MacUpdater 强校验签名），
 * 故 darwin 只走「检查 → available → 浏览器下载 dmg」链路（manualDownloadOnly），
 * 应用内下载/安装被禁用；latest-mac.yml 仍由 electron-builder 发布，版本检测正常。
 */
import { app, BrowserWindow } from 'electron'
// electron-updater 是 CJS 包，而主进程产物是 ESM（package.json type: module）。
// Node 的 CJS→ESM 具名导出依赖 cjs-module-lexer 静态分析，而 autoUpdater 在产物里
// 是 `Object.defineProperty(exports, ...)` 的惰性 getter，检测不到；具名导入会在
// 模块链接阶段抛 SyntaxError: Named export 'autoUpdater' not found，主进程直接起不来。
// 只能走 default 导入（= module.exports 整体），再经下面的 updater() 惰性取用。
import electronUpdater from 'electron-updater'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
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

/** 主源 feed：GitHub Releases（与 electron-builder.yml publish 一致） */
export function buildGithubFeed(): { provider: 'github'; owner: string; repo: string } {
  return { provider: 'github', owner: 'kunyu7696', repo: 'KunYuStudio' }
}

/**
 * 镜像兜底 feed：ghproxy 风格前缀 + releases/latest/download 稳定路径。
 * latest.yml / 安装包 / blockmap 均以 `releases/latest/download/<file>` 暴露，
 * 前缀代理后目录布局不变，generic provider 可直接消费（差分 blockmap 同目录）。
 * @returns 前缀为空（用户禁用镜像）时返回 null
 */
export function buildMirrorFeed(
  prefix: string
): { provider: 'generic'; url: string } | null {
  const trimmed = prefix.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  return {
    provider: 'generic',
    url: `${trimmed}/https://github.com/kunyu7696/KunYuStudio/releases/latest/download`
  }
}

/** 无 progress 多少毫秒判定下载停滞（转镜像兜底） */
export const DOWNLOAD_STALL_MS = 30_000
/** 启动后延迟多少毫秒做自动检查（让窗口先出来） */
export const AUTO_CHECK_DELAY_MS = 8_000

let win: BrowserWindow | null = null
let cancelDownload: CancellationToken | null = null
let stallTimer: ReturnType<typeof setTimeout> | null = null
let checking = false
let wired = false

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

/** 当前是否还有镜像兜底可用（未用过镜像且用户配置了前缀） */
function mirrorAvailable(): boolean {
  return !state.viaMirror && buildMirrorFeed(getSection('general').updateMirrorPrefix) !== null
}

/** 切镜像 feed 并重新走「检查 →（若发现新版）下载」；返回是否成功发起重试 */
async function retryViaMirror(): Promise<boolean> {
  const feed = buildMirrorFeed(getSection('general').updateMirrorPrefix)
  if (!feed) return false
  updater().setFeedURL(feed)
  patchState({ viaMirror: true })
  try {
    const result = await updater().checkForUpdates()
    if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
      // 镜像侧没有比当前新的版本：如实报「已是最新」语义交由事件归一，这里无需动作
      return true
    }
    // update-available 事件已把状态推进到 available；若此前在下载流程被打断，直接续下载
    await startDownload()
    return true
  } catch (err) {
    patchState({
      phase: 'error',
      error: `镜像兜底也失败了：${err instanceof Error ? err.message : String(err)}`
    })
    return false
  }
}

function onDownloadStalled(): void {
  if (state.phase !== 'downloading') return
  try {
    cancelDownload?.cancel()
  } catch {
    /* 取消失败不阻断兜底 */
  }
  clearStallTimer()
  if (mirrorAvailable()) {
    void retryViaMirror()
  } else {
    patchState({ phase: 'error', error: '下载停滞（30 秒无进度），已取消；可点「重试」或用浏览器到发布页下载' })
  }
}

async function startDownload(): Promise<void> {
  cancelDownload = new CancellationToken()
  armStallTimer()
  try {
    await updater().downloadUpdate(cancelDownload)
  } catch (err) {
    clearStallTimer()
    // 取消/切换 feed 引发的 reject 不视为错误（兜底流程已接管或已报错）
    if (state.phase !== 'error' && state.phase !== 'downloading' && state.phase !== 'downloaded') {
      if (mirrorAvailable()) {
        await retryViaMirror()
      } else {
        patchState({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
      }
    }
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
  autoUpdater.on('update-available', (info: UpdateInfo) =>
    patchState({ phase: 'available', latestVersion: info.version, error: undefined })
  )
  autoUpdater.on('update-not-available', () =>
    patchState({ phase: 'latest', latestVersion: undefined, error: undefined })
  )
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
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    clearStallTimer()
    patchState({ phase: 'downloaded', latestVersion: info.version, percent: 100 })
  })
  autoUpdater.on('error', (err: Error) => {
    clearStallTimer()
    // 检查阶段失败：主源直连 → 有镜像则自动兜底一次；下载阶段失败由 startDownload 的 catch 接管
    if (state.phase === 'checking') {
      if (mirrorAvailable()) {
        void retryViaMirror()
        return
      }
    }
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
  // 每次检查都从主源重新开始（上一次镜像态不带入下一次）
  updater().setFeedURL(buildGithubFeed())
  patchState({ phase: 'checking', viaMirror: false, error: undefined })
  try {
    await updater().checkForUpdates()
  } catch (err) {
    // error 事件通常已先行处理（含镜像兜底）；promise reject 兜底：事件没覆盖时才落 error
    if (state.phase === 'checking') {
      if (mirrorAvailable()) {
        await retryViaMirror()
      } else {
        patchState({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
      }
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
    patchState({ phase: 'downloading', percent: 0, error: undefined })
    await startDownload()
  }
  return { ...state }
}

export function quitAndInstallUpdate(): void {
  // 非静默：走 NSIS 安装向导；安装完成后自动拉起新版本
  updater().quitAndInstall(false, true)
}

export function getUpdateState(): UpdateState {
  return { ...state }
}
