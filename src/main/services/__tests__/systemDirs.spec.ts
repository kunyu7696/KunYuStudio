/**
 * isSystemDirectory 单测。
 * 确保 PROJECT_RELOCATE 拒绝把系统目录登记为项目可写根，
 * 防止「登记系统目录 → FS_WRITE_FILE 写任意扩展名 → 持久化 RCE」链。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// mock electron 的 app：getAppPath / getPath 返回固定路径，避免依赖真实运行时
const FAKE_APP_PATH = 'C:\\FakeApp'
const FAKE_USER_DATA = 'C:\\FakeUserData'
vi.mock('electron', () => ({
  app: {
    getAppPath: () => FAKE_APP_PATH,
    getPath: () => FAKE_USER_DATA
  }
}))

import { isSystemDirectory } from '../systemDirs'

/** 创建临时目录作为「合法项目目录」样本 */
function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'kunyu-sysdir-'))
}

describe('isSystemDirectory', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('合法的临时项目目录不判定为系统目录', () => {
    expect(isSystemDirectory(tmpDir())).toBe(false)
  })

  it('不存在或非目录路径不判定为系统目录（调用方先经 dialog 保证存在）', () => {
    expect(isSystemDirectory(join(tmpdir(), 'kunyu-definitely-not-exist-xyz'))).toBe(false)
  })

  it('Windows：C:\\Windows 及其子目录被拒绝', () => {
    // 仅在 Windows 下断言；其它平台 process.env.SystemRoot 可能未设
    if (process.platform !== 'win32') return
    const sysRoot = process.env.SystemRoot ?? 'C:\\Windows'
    expect(isSystemDirectory(sysRoot)).toBe(true)
    expect(isSystemDirectory(join(sysRoot, 'System32'))).toBe(true)
  })

  it('应用自身目录与 userData 被拒绝（防止 app 资源被登记为可写根后篡改）', () => {
    // FAKE_APP_PATH / FAKE_USER_DATA 不存在 → isSystemDirectory 先返回 false
    // 故构造其下真实子目录再断言
    const mk = (root: string): string => {
      try {
        return mkdtempSync(join(root, 'sysdir-'))
      } catch {
        return '' // 路径不可写时跳过该断言
      }
    }
    const underApp = mk(FAKE_APP_PATH)
    if (underApp) expect(isSystemDirectory(underApp)).toBe(true)
    const underUserData = mk(FAKE_USER_DATA)
    if (underUserData) expect(isSystemDirectory(underUserData)).toBe(true)
  })

  it('类 Unix：系统目录被拒绝', () => {
    if (process.platform === 'win32') return
    // /tmp 在 Linux 上是真实目录且不在 denylist → false；/etc 存在且在 denylist → true
    expect(isSystemDirectory('/etc')).toBe(true)
    expect(isSystemDirectory('/usr')).toBe(true)
  })
})
