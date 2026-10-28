/**
 * 普通问答（非 Agent 模式）→ 桌宠事件合成。
 * 验证 AI_CHAT_STREAM 生命周期发出 running/done/error，AI_CHAT_STOP 发 skipped
 * 且 abort 后的 catch 不补发 error（避免覆盖桌宠回空闲态）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockChatStream, mockNotifyPet } = vi.hoisted(() => ({
  mockChatStream: vi.fn(),
  mockNotifyPet: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))
vi.mock('../../../services/aiService', () => ({
  chatStream: mockChatStream,
  chat: vi.fn(),
  listModels: vi.fn(),
  testProvider: vi.fn(),
  asAiResult: async (p: Promise<unknown>) => {
    try {
      return { ok: true as const, data: await p }
    } catch (e) {
      return { ok: false as const, errorKind: 'network' as const, errorMessage: (e as Error).message }
    }
  }
}))
vi.mock('../../../services/ai/cueContextService', () => ({ collectCueContext: vi.fn() }))
vi.mock('../../../services/dsh/petService', () => ({ notifyPetAgentEvent: mockNotifyPet }))

import { ipcMain } from 'electron'
import { IpcChannels } from '../../../../shared/types/ipc'
import { registerAiChatHandlers } from '../aiChatHandlers'

/** 捕获注册的 handler：channel → 业务函数 */
function handlers(): Map<string, (...args: unknown[]) => unknown> {
  const map = new Map<string, (...args: unknown[]) => unknown>()
  vi.mocked(ipcMain.handle).mockImplementation(((channel: string, fn: (...args: unknown[]) => unknown) => {
    map.set(channel, fn)
  }) as never)
  registerAiChatHandlers({
    win: { isDestroyed: () => true, webContents: { send: vi.fn() } }
  } as never)
  return map
}

const req = { providerId: 'p', model: 'm', messages: [{ role: 'user', content: 'hi' }] }

/** 提取喂给桌宠的 (phase, seq) 序列 */
function petPhases(): Array<[string | undefined, number]> {
  return mockNotifyPet.mock.calls.map(([ev]) => {
    const e = ev as { phase?: string; seq: number }
    return [e.phase, e.seq]
  })
}

describe('普通问答 → 桌宠事件', () => {
  beforeEach(() => {
    mockChatStream.mockReset()
    mockNotifyPet.mockReset()
  })

  it('流成功：running(0) → done(1)，runId 带 chat: 前缀', async () => {
    const h = handlers()
    mockChatStream.mockResolvedValue({ text: 'ok' })
    await h.get(IpcChannels.AI_CHAT_STREAM)!(undefined as never, 's1', req)
    expect(petPhases()).toEqual([
      ['running', 0],
      ['done', 1]
    ])
    const runIds = mockNotifyPet.mock.calls.map(([ev]) => (ev as { runId: string }).runId)
    expect(runIds).toEqual(['chat:s1', 'chat:s1'])
  })

  it('流失败：running(0) → error(1)', async () => {
    const h = handlers()
    mockChatStream.mockRejectedValue(new Error('boom'))
    await h.get(IpcChannels.AI_CHAT_STREAM)!(undefined as never, 's2', req)
    expect(petPhases()).toEqual([
      ['running', 0],
      ['error', 1]
    ])
  })

  it('用户点中断：STOP 发 skipped，abort 后的 catch 不补发 error', async () => {
    const h = handlers()
    // chatStream 监听 abort，中断后 reject（真实 AbortError 语义）
    mockChatStream.mockImplementation(
      (_r: unknown, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            reject(e)
          })
        })
    )
    const streamPromise = h.get(IpcChannels.AI_CHAT_STREAM)!(undefined as never, 's3', req)
    h.get(IpcChannels.AI_CHAT_STOP)!(undefined as never, 's3')
    await streamPromise
    expect(petPhases()).toEqual([
      ['running', 0],
      ['skipped', 1]
    ])
  })

  it('停止不存在的流：不发桌宠事件', () => {
    const h = handlers()
    h.get(IpcChannels.AI_CHAT_STOP)!(undefined as never, 'nonexistent')
    expect(mockNotifyPet).not.toHaveBeenCalled()
  })
})
