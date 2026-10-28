/**
 * handle 包装器单测。
 * 验证：发送方校验（主窗口顶层帧）+ ajv schema 校验 + 正常放行。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 必须在导入 handle 之前 mock electron：handle.ts 运行时只用到 ipcMain
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))

import { ipcMain } from 'electron'
import { assertTrustedSender, handle, setTrustedWindow } from '../handle'

/** 构造伪 IpcMainInvokeEvent：sender.id 与 senderFrame.parent 可控 */
function fakeEvent(opts: { senderId: number; parent: unknown }): never {
  return {
    sender: { id: opts.senderId },
    senderFrame: { parent: opts.parent }
  } as never
}

describe('handle 包装器', () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockReset()
    // 绑定可信主窗口：webContents.id = 42
    setTrustedWindow({ webContents: { id: 42 }, isDestroyed: () => false } as never)
  })

  it('assertTrustedSender：主窗口顶层帧（sender.id 匹配 + parent 为 null）放行', () => {
    expect(() => assertTrustedSender(fakeEvent({ senderId: 42, parent: null }))).not.toThrow()
  })

  it('assertTrustedSender：非主窗口 webContents 拒绝', () => {
    expect(() => assertTrustedSender(fakeEvent({ senderId: 99, parent: null }))).toThrow('非主窗口')
  })

  it('assertTrustedSender：子帧（parent 非空）拒绝', () => {
    expect(() => assertTrustedSender(fakeEvent({ senderId: 42, parent: {} }))).toThrow('非主帧')
  })

  it('assertTrustedSender：主窗口已销毁拒绝', () => {
    setTrustedWindow({ webContents: { id: 42 }, isDestroyed: () => true } as never)
    expect(() => assertTrustedSender(fakeEvent({ senderId: 42, parent: null }))).toThrow('不可用')
  })

  it('handle：schema 校验失败时拒绝并抛「参数校验失败」', async () => {
    let captured: ((event: unknown, ...args: unknown[]) => unknown) | null = null
    vi.mocked(ipcMain.handle).mockImplementation((_ch, fn) => {
      captured = fn as never
    })
    const fn = vi.fn()
    handle('test:bad', [{ type: 'string', minLength: 1 }], fn)
    expect(captured).not.toBeNull()
    // 传入非字符串
    await expect(captured!(fakeEvent({ senderId: 42, parent: null }), 123)).rejects.toThrow('参数校验失败')
    expect(fn).not.toHaveBeenCalled()
  })

  it('handle：schema 校验通过时调用业务函数并返回结果', async () => {
    let captured: ((event: unknown, ...args: unknown[]) => unknown) | null = null
    vi.mocked(ipcMain.handle).mockImplementation((_ch, fn) => {
      captured = fn as never
    })
    const fn = vi.fn().mockReturnValue(42)
    handle('test:ok', [{ type: 'string', minLength: 1 }], fn)
    const out = await captured!(fakeEvent({ senderId: 42, parent: null }), 'hello')
    expect(fn).toHaveBeenCalledWith(expect.anything(), 'hello')
    expect(out).toBe(42)
  })

  it('handle：发送方非主窗口时即便 schema 通过也拒绝', async () => {
    let captured: ((event: unknown, ...args: unknown[]) => unknown) | null = null
    vi.mocked(ipcMain.handle).mockImplementation((_ch, fn) => {
      captured = fn as never
    })
    const fn = vi.fn()
    handle('test:sender', [{ type: 'string' }], fn)
    await expect(captured!(fakeEvent({ senderId: 99, parent: null }), 'ok')).rejects.toThrow('非主窗口')
    expect(fn).not.toHaveBeenCalled()
  })

  it('handle：schemas 为 null 时跳过校验直接调用', async () => {
    let captured: ((event: unknown, ...args: unknown[]) => unknown) | null = null
    vi.mocked(ipcMain.handle).mockImplementation((_ch, fn) => {
      captured = fn as never
    })
    const fn = vi.fn().mockReturnValue('done')
    handle('test:null-schema', null, fn)
    const out = await captured!(fakeEvent({ senderId: 42, parent: null }), { anything: 1 })
    expect(fn).toHaveBeenCalledWith(expect.anything(), { anything: 1 })
    expect(out).toBe('done')
  })
})
