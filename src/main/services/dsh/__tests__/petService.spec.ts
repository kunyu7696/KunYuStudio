/**
 * petService 真实单元测试：
 * 此前 dshPet.spec.ts 名同实异——实际只测交付包 lib/*.js，petService.ts 本体 0% 覆盖。
 * 这里直接 import petService，验证导出面：resolvePetElectron / petStatus /
 * startPet 失败路径（双通道顺序）/ stopPet 清错 / notifyPetAgentEvent 未启动静默 /
 * bridgeGradleEventsToPet 幂等注册。
 *
 * petService 含模块级可变状态（host/bridge/starting/lastError），本文件不使用
 * vi.resetModules（静态导入与 mock 实例保持一致）；用例按状态流转顺序编排：
 * 最前的用例享有全新模块状态，后续用例消费其落定状态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// 真实 fs + 可控 existsSync/readFileSync：默认实现为真实函数（restoreMocks 后还原）
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync)
  }
})

vi.mock('electron', () => ({ app: { isPackaged: false } }))

vi.mock('../../aiService', () => ({ chatStream: vi.fn(), listModels: vi.fn() }))
vi.mock('../../gradleService', () => ({ onGradleRunEvent: vi.fn(() => () => {}) }))
vi.mock('../../settingsService', () => ({
  getSection: vi.fn(() => ({ ai: { providers: [], defaultProviderId: '' } }))
}))
// vi.hoisted：工厂提升后仍可安全引用（普通 const 会 TDZ）
const petRootState = vi.hoisted(() => ({ pluginsRoot: '' }))
vi.mock('../dshCatalog', () => ({ dshPluginsRoot: vi.fn(() => petRootState.pluginsRoot) }))
vi.mock('../dshInstaller', () => ({
  installDshPetFromLocal: vi.fn(),
  installDshPlugin: vi.fn(),
  localDshPetSource: vi.fn(() => null)
}))

import { onGradleRunEvent } from '../../gradleService'
import { installDshPetFromLocal, installDshPlugin, localDshPetSource } from '../dshInstaller'
import {
  bridgeGradleEventsToPet,
  notifyPetAgentEvent,
  petStatus,
  resolvePetElectron,
  startPet,
  stopPet
} from '../petService'
import type { GradleRunLifecycleEvent } from '../../gradleService'

const existsMock = vi.mocked(existsSync)

let tempRoot = ''
let tempDshHome = ''
/** 加载期捕获 vi.fn 的初始实现 = 真实 existsSync（避免引用 mock 自身递归） */
const realExists = existsMock.getMockImplementation() as (p: import('node:fs').PathLike) => boolean

/** 仅放行临时根下的文件，其余一律不存在（隔离真实机器环境影响） */
function fakeExistsOnlyTemp(): void {
  existsMock.mockImplementation((p) => {
    const s = typeof p === 'string' ? p : String(p)
    return s.startsWith(tempRoot) && realExists(s)
  })
}

function makePetInstalled(withPkgJson = false): void {
  const petDir = join(tempRoot, 'node_modules', 'dsh-pet')
  mkdirSync(join(petDir, 'lib'), { recursive: true })
  writeFileSync(join(petDir, 'lib', 'index.js'), 'export {}')
  if (withPkgJson) {
    writeFileSync(join(petDir, 'package.json'), JSON.stringify({ version: '1.2.3' }))
  }
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'ky-petsvc-'))
  tempDshHome = join(tempRoot, 'dsh-home')
  mkdirSync(tempDshHome, { recursive: true })
  petRootState.pluginsRoot = tempRoot
  process.env.DSH_HOME = tempDshHome
  delete process.env.DSH_PET_ELECTRON_PATH
})

afterEach(() => {
  delete process.env.DSH_HOME
  delete process.env.DSH_PET_ELECTRON_PATH
  rmSync(tempRoot, { recursive: true, force: true })
})

describe('startPet → stopPet 状态流转（首个用例享有全新模块状态）', () => {
  it('双通道失败错误透传；stopPet 清除 lastError', async () => {
    fakeExistsOnlyTemp()
    vi.mocked(installDshPetFromLocal).mockResolvedValue({ ok: false, error: 'x' })
    vi.mocked(installDshPlugin).mockResolvedValue({ ok: false, error: 'y' })
    expect(installDshPetFromLocal).toHaveBeenCalledTimes(0) // 全新状态守卫
    const st = await startPet()
    expect(installDshPetFromLocal).toHaveBeenCalledTimes(1)
    expect(installDshPlugin).toHaveBeenCalledWith('dsh-pet', 'custom')
    expect(st.error).toBe('y')
    expect(st.running).toBe(false)
    const stopped = await stopPet()
    expect(stopped.error).toBeUndefined()
    expect(stopped.running).toBe(false)
  })
})

describe('resolvePetElectron', () => {
  it('DSH_PET_ELECTRON_PATH 显式指定优先命中', () => {
    const exe = join(tempRoot, 'my-electron.exe')
    writeFileSync(exe, 'x')
    process.env.DSH_PET_ELECTRON_PATH = exe
    expect(resolvePetElectron()).toBe(exe)
  })

  it('无任何候选时返回 null（node 测试环境不注入 kunyu execPath）', () => {
    fakeExistsOnlyTemp()
    expect(resolvePetElectron()).toBeNull()
  })

  it('DSH 桌面端自带 electron 存在时命中（$DSH_HOME/electron/<平台可执行名>）', () => {
    fakeExistsOnlyTemp()
    // 与 resolvePetElectron 的平台分支一致
    const exeName =
      process.platform === 'win32'
        ? 'electron.exe'
        : process.platform === 'darwin'
          ? join('Electron.app', 'Contents', 'MacOS', 'Electron')
          : 'electron'
    const exe = join(tempDshHome, 'electron', exeName)
    mkdirSync(dirname(exe), { recursive: true })
    writeFileSync(exe, 'x')
    existsMock.mockImplementation((p) => {
      const s = typeof p === 'string' ? p : String(p)
      return s === exe
    })
    expect(resolvePetElectron()).toBe(exe)
  })
})

describe('petStatus', () => {
  it('未安装：petInstalled=false、petVersion=null、running=false、port=null', () => {
    fakeExistsOnlyTemp()
    const st = petStatus()
    expect(st.petInstalled).toBe(false)
    expect(st.petVersion).toBeNull()
    expect(st.running).toBe(false)
    expect(st.port).toBeNull()
    expect(st.sourceAvailable).toBe(false)
    expect(st.error).toBeUndefined()
  })

  it('已安装：lib/index.js 存在 → petInstalled=true；package.json 版本可读', () => {
    fakeExistsOnlyTemp()
    makePetInstalled(true)
    const st = petStatus()
    expect(st.petInstalled).toBe(true)
    expect(st.petVersion).toBe('1.2.3')
  })

  it('本机有 DSH 桌面端源 → sourceAvailable=true', () => {
    fakeExistsOnlyTemp()
    vi.mocked(localDshPetSource).mockReturnValue(join(tempDshHome, 'profiles', 'desktop'))
    expect(petStatus().sourceAvailable).toBe(true)
  })

  it('package.json 损坏时 petVersion 回落 null 而不是抛错', () => {
    fakeExistsOnlyTemp()
    makePetInstalled(false)
    writeFileSync(join(tempRoot, 'node_modules', 'dsh-pet', 'package.json'), '{broken json')
    expect(petStatus().petVersion).toBeNull()
  })
})

describe('startPet 失败路径（不起真实宿主）', () => {
  it('本地通道成功即不再走 npm 通道（交付包适配层缺失时给出可读错误）', async () => {
    fakeExistsOnlyTemp()
    vi.mocked(installDshPetFromLocal).mockResolvedValue({ ok: true })
    const st = await startPet()
    expect(installDshPlugin).not.toHaveBeenCalled()
    expect(st.error).toContain('未找到 dsh-pet-kunyu 适配层')
    expect(st.running).toBe(false)
  })

  it('已安装时跳过两个安装通道', async () => {
    fakeExistsOnlyTemp()
    makePetInstalled(false)
    const st = await startPet()
    expect(installDshPetFromLocal).not.toHaveBeenCalled()
    expect(installDshPlugin).not.toHaveBeenCalled()
    expect(st.running).toBe(false)
  })
})

describe('notifyPetAgentEvent / bridgeGradleEventsToPet', () => {
  it('未启动时 notifyPetAgentEvent 静默丢弃，不抛错', () => {
    expect(() =>
      notifyPetAgentEvent({
        type: 'phase',
        phase: 'running',
        stage: 'build',
        runId: 'r1',
        seq: 0,
        at: '2026-10-12T00:00:00.000Z'
      })
    ).not.toThrow()
  })

  it('Gradle 事件桥幂等注册：多次调用只订阅一次，handler 未启动也安全', () => {
    bridgeGradleEventsToPet()
    bridgeGradleEventsToPet()
    bridgeGradleEventsToPet()
    expect(onGradleRunEvent).toHaveBeenCalledTimes(1)
    const handler = vi.mocked(onGradleRunEvent).mock.calls[0]?.[0]
    expect(handler).toBeTypeOf('function')
    const started: GradleRunLifecycleEvent = {
      runId: 'b1',
      phase: 'started',
      exitCode: null,
      cancelled: false,
      tasks: ['build']
    }
    const done: GradleRunLifecycleEvent = {
      runId: 'b1',
      phase: 'done',
      exitCode: 0,
      cancelled: false,
      tasks: ['build'],
      status: 'success'
    }
    expect(() => handler?.(started)).not.toThrow()
    expect(() => handler?.(done)).not.toThrow()
  })
})
