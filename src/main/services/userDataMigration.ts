/**
 * 品牌改名（KunYuEcosystem → KunYu Studio）userData 一次性迁移。
 *
 * 打包版 Electron 的 userData 默认跟随 productName（Windows: %APPDATA%/<productName>），
 * 改名后旧用户的设置、AI 覆盖层（ai/ai-reference-overlay.json）、资源库（mod-library/）
 * 仍躺在旧目录 %APPDATA%/KunYuEcosystem。此处在新目录尚不存在时把旧目录整体
 * rename 接管；rename 失败（占用/跨盘等）只记录日志降级为不迁移，绝不阻断启动。
 * 仅打包版执行：开发模式 userData 已被重定向到工作区 .dev-userdata，不能误搬。
 */
import { app } from 'electron'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { isPackagedRuntime } from '../runtimeEnv'

/** 改名前打包版的 userData 目录名（旧 productName） */
export const LEGACY_USER_DATA_DIR_NAME = 'KunYuEcosystem'

export interface UserDataMigrationDeps {
  isPackaged: boolean
  /** app.getPath('appData') */
  appDataDir: string
  /** app.getPath('userData')（新 productName 对应的目录） */
  userDataDir: string
  exists: (p: string) => boolean
  rename: (from: string, to: string) => void
  log: (msg: string) => void
}

/** 返回 true 表示发生了迁移；任何异常都内部消化，返回 false */
export function migrateLegacyUserData(deps: UserDataMigrationDeps): boolean {
  if (!deps.isPackaged) return false
  const legacyDir = join(deps.appDataDir, LEGACY_USER_DATA_DIR_NAME)
  const currentDir = deps.userDataDir
  if (legacyDir === currentDir) return false
  if (!deps.exists(legacyDir)) return false
  if (deps.exists(currentDir)) return false
  try {
    deps.rename(legacyDir, currentDir)
    deps.log(`[userDataMigration] 已接管旧版数据目录：${legacyDir} → ${currentDir}`)
    return true
  } catch (err) {
    deps.log(`[userDataMigration] 旧版数据目录迁移失败（已跳过，不影响启动）: ${String(err)}`)
    return false
  }
}

/** 主进程入口调用：须在 app ready 之前、任何 userData 读写之前执行 */
export function migrateLegacyUserDataIfNeeded(): void {
  migrateLegacyUserData({
    isPackaged: isPackagedRuntime(app),
    appDataDir: app.getPath('appData'),
    userDataDir: app.getPath('userData'),
    exists: existsSync,
    rename: renameSync,
    log: (msg) => console.warn(msg)
  })
}
