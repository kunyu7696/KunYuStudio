/**
 * 应用自更新状态（updaterService → 渲染层）。
 *
 * 通道与策略：GitHub Releases 主源（kunyu7696/KunYuStudio），直连失败/下载停滞时
 * 按 settings.general.updateMirrorPrefix（ghproxy 风格前缀）+ releases/latest/download
 * 稳定路径兜底重试一次；下载需用户确认（electron-updater autoDownload=false）。
 */

export type UpdatePhase =
  /** 空闲（尚未检查或上一次流程已完结） */
  | 'idle'
  /** 正在检查 */
  | 'checking'
  /** 已是最新 */
  | 'latest'
  /** 发现新版本，等待用户确认下载 */
  | 'available'
  /** 下载中 */
  | 'downloading'
  /** 已下载，等待用户重启安装 */
  | 'downloaded'
  /** 检查/下载失败 */
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  /** 当前运行版本 */
  currentVersion: string
  /** 远端最新版本（available/downloading/downloaded 时存在） */
  latestVersion?: string
  /** 下载进度 0-100（downloading 时存在） */
  percent?: number
  /** 下载速率 B/s（downloading 时存在） */
  bytesPerSecond?: number
  /** 已下载/总字节（downloading 时存在） */
  transferred?: number
  total?: number
  /** 本次检查/下载是否走了镜像兜底 */
  viaMirror?: boolean
  /** 错误信息（phase=error 时存在） */
  error?: string
  /** 发布页地址（error 时供「浏览器打开」兜底） */
  releasePageUrl?: string
  /**
   * 仅检测不可自动下载（macOS 未签名包 electron-updater 拒绝替换 .app）。
   * true 时 UI 在 available 态提供「浏览器下载」而非应用内下载。
   */
  manualDownloadOnly?: boolean
}

/** 默认 Release 页（设置页「浏览器打开」兜底入口） */
export const UPDATE_RELEASE_PAGE = 'https://github.com/kunyu7696/KunYuStudio/releases'
