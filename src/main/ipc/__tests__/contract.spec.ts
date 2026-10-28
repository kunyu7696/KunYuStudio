/**
 * IPC 契约测试（P1-4）。
 *
 * 背景：此前 aiChatHandlers.spec 取裸函数绕过 handle() 包装、handle.spec 用假 ipcMain，
 * 没有任何测试验证「真实 handler 注册在正确通道且与 preload 暴露面对齐」——
 * 通道名拼写漂移、漏注册、preload 与主进程契约面脱节均无法被拦截。
 *
 * 本测试真实执行三条契约链：
 *  1. registerIpcHandlers() 全量注册 22 个 registrar，捕获 ipcMain.handle 的通道集合；
 *  2. preload/index.ts 真实执行，经 contextBridge.exposeInMainWorld 捕获暴露的 api 对象，
 *     逐个调用其全部叶子方法，捕获 ipcRenderer.invoke 的通道集合；
 *  3. 以 IpcChannels 为唯一真源断言两侧对齐（推送通道除外——它们不经 invoke/handle）。
 */
import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const state = vi.hoisted(() => ({
  handledChannels: [] as string[],
  invokedChannels: [] as unknown[][],
  exposed: null as unknown
}))
const { handledChannels, invokedChannels } = state

vi.mock('electron', async () => {
  const dir = join(tmpdir(), `kunyu-ipc-contract-${process.pid}`)
  const noop = (): void => undefined
  return {
    app: {
      getPath: () => dir,
      setPath: noop,
      getAppPath: () => dir,
      on: noop,
      once: noop,
      whenReady: async () => undefined,
      isReady: () => true,
      isPackaged: false,
      getVersion: () => '0.0.0-test',
      quit: noop,
      exit: noop
    },
    BrowserWindow: class {
      webContents = { send: noop, id: 1 }
      isDestroyed(): boolean {
        return false
      }
      on = noop
      static getAllWindows(): unknown[] {
        return []
      }
    },
    ipcMain: {
      handle: (channel: string) => {
        handledChannels.push(channel)
      },
      on: noop,
      once: noop
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true }),
      showSaveDialog: async () => ({ canceled: true }),
      showMessageBox: async () => ({ response: 0 })
    },
    shell: { openExternal: async () => undefined, openPath: async () => '', showItemInFolder: noop },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (b: Buffer) => b,
      decryptString: (b: Buffer) => b
    },
    contextBridge: {
      exposeInMainWorld: (_key: string, api: unknown) => {
        state.exposed = api
      }
    },
    ipcRenderer: {
      invoke: (...call: unknown[]) => {
        invokedChannels.push(call as string[])
        return Promise.resolve(undefined)
      },
      on: () => () => undefined,
      removeListener: noop
    }
  }
})

import { IpcChannels } from '../../../shared/types/ipc'
import { registerIpcHandlers } from '../index'
import '../../../preload/index'

/** 主→渲染推送通道：经 webContents.send / event.sender.send，不经 ipcMain.handle */
const PUSH_CHANNELS: readonly string[] = [
  IpcChannels.FS_EVENT,
  IpcChannels.GRADLE_EVENT,
  IpcChannels.AI_STREAM_EVENT,
  IpcChannels.AGENT_EVENT,
  IpcChannels.MONITOR_EVENT,
  IpcChannels.MODEL_EVENT,
  IpcChannels.SANDBOX_EVENT,
  IpcChannels.WIN_MAXIMIZED_CHANGED,
  IpcChannels.UPDATE_STATE_CHANGED,
  IpcChannels.INTEGRATION_AUTH_REQUEST,
  IpcChannels.INTEGRATION_AGENT_CHUNK,
  IpcChannels.INTEGRATION_AGENT_EXIT,
  IpcChannels.LAUNCHER_EVENT,
  IpcChannels.JDK_PROVISION_EVENT,
  IpcChannels.MC_PROVISION_EVENT,
  IpcChannels.DECOMPILE_EVENT,
  IpcChannels.AUDIO_EVENT
]

const ALL_CHANNELS: string[] = Object.values(IpcChannels)

function fakeWin(): unknown {
  return {
    webContents: { id: 1, send: () => undefined },
    isDestroyed: () => false,
    on: () => undefined,
    minimize: () => undefined,
    maximize: () => undefined,
    unmaximize: () => undefined,
    close: () => undefined,
    isMaximized: () => false
  }
}

describe('IPC 契约（P1-4）', () => {
  it('IpcChannels 通道名唯一且符合「领域:动作」命名', () => {
    const set = new Set(ALL_CHANNELS)
    expect(set.size).toBe(ALL_CHANNELS.length)
    for (const ch of ALL_CHANNELS) {
      expect(ch, `通道 ${ch} 不符合 domain:action 命名`).toMatch(
        /^[a-zA-Z][a-zA-Z0-9-]*:[a-zA-Z][a-zA-Z0-9-]*$/
      )
    }
  })

  it('registerIpcHandlers：注册的通道全部在 IpcChannels 清单内（无未知通道）', () => {
    registerIpcHandlers(fakeWin() as never)
    expect(handledChannels.length).toBeGreaterThan(0)
    for (const ch of handledChannels) {
      expect(ALL_CHANNELS, `handler 注册在未登记通道 ${ch}`).toContain(ch)
    }
  })

  it('registerIpcHandlers：除推送通道外，每个 IpcChannels 通道都有 handler（无漏注册）', () => {
    const registered = new Set(handledChannels)
    const expected = ALL_CHANNELS.filter((ch) => !PUSH_CHANNELS.includes(ch))
    const missing = expected.filter((ch) => !registered.has(ch))
    expect(missing, `以下通道已在 IpcChannels 登记但没有任何 handler 注册`).toEqual([])
  })

  it('preload：暴露 api 对象且发出的每个 invoke 通道都在 IpcChannels 清单内', async () => {
    expect(state.exposed).toBeTruthy()
    const api = state.exposed as Record<string, unknown>
    expect(typeof api.on).toBe('function')
    // on 收紧为推送通道白名单——白名单通道可订阅并返回退订函数
    const unsubscribe = (api.on as (ch: string, cb: () => void) => unknown)(PUSH_CHANNELS[0], () => undefined)
    expect(typeof unsubscribe).toBe('function')
    // 非白名单通道直接抛错（不再是无白名单通用转发）
    expect(() =>
      (api.on as (ch: string, cb: () => void) => unknown)('test:push', () => undefined)
    ).toThrow(/白名单/)

    const before = invokedChannels.length
    await invokeAllLeaves(api as object)
    const sent = invokedChannels.slice(before).map((call) => call[0] as string)
    expect(sent.length).toBeGreaterThan(100)
    for (const ch of sent) {
      expect(ALL_CHANNELS, `preload 发出的 invoke 通道 ${ch} 不在 IpcChannels 清单`).toContain(ch)
    }
    // 覆盖面：invoke 通道数应与「非推送通道数」一致（preload 每个非推送通道至少一条方法）
    const registered = new Set(handledChannels)
    const notInvoked = [...registered].filter(
      (ch) => !PUSH_CHANNELS.includes(ch) && !sent.includes(ch)
    )
    expect(notInvoked, `主进程有 handler 但 preload 未发出 invoke 的通道`).toEqual([])
  })

  it('preload：invoke 参数按位置原样透传（契约参数顺序抽样）', async () => {
    const api = state.exposed as {
      project: { delete: (id: string, deleteFiles: boolean) => Promise<unknown> }
    }
    const before = invokedChannels.length
    await api.project.delete('p1', true)
    expect(invokedChannels.slice(before)).toEqual([[IpcChannels.PROJECT_DELETE, 'p1', true]])
  })
})

/** 递归调用 api 对象的全部叶子函数（preload 方法均为直通 invoke，参数畸形无副作用） */
async function invokeAllLeaves(obj: object, depth = 0): Promise<void> {
  if (depth > 4) return
  for (const value of Object.values(obj)) {
    if (typeof value === 'function') {
      try {
        await (value as (...args: unknown[]) => unknown)({}, {}, {}, {}, {}, {})
      } catch {
        /* 采样调用不关心返回值/异常，只关心发出的通道 */
      }
    } else if (value && typeof value === 'object') {
      await invokeAllLeaves(value, depth + 1)
    }
  }
}
