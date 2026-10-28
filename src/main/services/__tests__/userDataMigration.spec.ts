/**
 * userDataMigration 单测（品牌改名 KunYuEcosystem → KunYu Studio 的数据目录接管）：
 * - 旧目录存在且新目录不存在 → rename 接管
 * - 新目录已存在 → 不动（全新安装/已迁移过）
 * - 旧目录不存在 → 不动
 * - 非打包环境 → 不动（开发模式 userData 指向工作区 .dev-userdata）
 * - rename 抛错 → 降级为不迁移，不向调用方抛错
 */
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import {
  LEGACY_USER_DATA_DIR_NAME,
  migrateLegacyUserData,
  type UserDataMigrationDeps
} from '../userDataMigration'

const APP_DATA = 'C:\\Users\\demo\\AppData\\Roaming'
const NEW_DIR = join(APP_DATA, 'KunYu Studio')
const LEGACY_DIR = join(APP_DATA, LEGACY_USER_DATA_DIR_NAME)

function makeDeps(overrides: Partial<UserDataMigrationDeps> = {}) {
  const rename = vi.fn()
  const log = vi.fn()
  const deps: UserDataMigrationDeps = {
    isPackaged: true,
    appDataDir: APP_DATA,
    userDataDir: NEW_DIR,
    exists: () => false,
    rename,
    log,
    ...overrides
  }
  return { deps, rename, log }
}

describe('migrateLegacyUserData', () => {
  it('旧目录存在且新目录不存在 → 整体 rename 接管', () => {
    const { deps, rename } = makeDeps({
      exists: (p) => p === LEGACY_DIR
    })
    expect(migrateLegacyUserData(deps)).toBe(true)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledWith(LEGACY_DIR, NEW_DIR)
  })

  it('新目录已存在 → 不动（避免覆盖新数据）', () => {
    const { deps, rename } = makeDeps({
      exists: () => true
    })
    expect(migrateLegacyUserData(deps)).toBe(false)
    expect(rename).not.toHaveBeenCalled()
  })

  it('旧目录不存在 → 不动（全新用户）', () => {
    const { deps, rename } = makeDeps({
      exists: () => false
    })
    expect(migrateLegacyUserData(deps)).toBe(false)
    expect(rename).not.toHaveBeenCalled()
  })

  it('非打包环境 → 不动（开发模式不误搬 .dev-userdata）', () => {
    const { deps, rename } = makeDeps({
      isPackaged: false,
      exists: (p) => p === LEGACY_DIR
    })
    expect(migrateLegacyUserData(deps)).toBe(false)
    expect(rename).not.toHaveBeenCalled()
  })

  it('新旧目录相同 → 不动（productName 未变时的自保）', () => {
    const { deps, rename } = makeDeps({
      userDataDir: LEGACY_DIR,
      exists: () => true
    })
    expect(migrateLegacyUserData(deps)).toBe(false)
    expect(rename).not.toHaveBeenCalled()
  })

  it('rename 抛错（占用/跨盘）→ 记录日志并降级为不迁移，绝不抛出', () => {
    const { deps, log } = makeDeps({
      exists: (p) => p === LEGACY_DIR,
      rename: () => {
        throw new Error('EPERM: operation not permitted')
      }
    })
    expect(migrateLegacyUserData(deps)).toBe(false)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0]?.[0]).toContain('迁移失败')
  })
})
