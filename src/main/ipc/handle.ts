/**
 * 统一 IPC handle 包装。
 *
 * 背景：原 ipcMain.handle 全部裸注册，发送方不校验、入参不校验。
 * 渲染层一旦出现 XSS（如 md/markdown 渲染、外链 img onerror 等），
 * 攻击者可直接 window.api.<dangerous>() 触发主进程写盘 / spawn / 改名。
 *
 * 本包装做两件事：
 * 1. assertTrustedSender：调用必须来自主窗口顶层渲染帧，拒绝子帧/其它窗口注入；
 * 2. ajv 入参 schema 校验：按位置校验各参数类型/结构，拒绝畸形入参提前到达服务层。
 *
 * 仅对最危险的通道（PROJECT_RELOCATE / FS_WRITE_FILE / MCP_TEST_SERVER /
 * MCP_SYNC_CUSTOM / MCP_CALL_CUSTOM_TOOL / PROFILE_APPLY_ACTIONS）启用，
 * 其余通道保持裸 ipcMain.handle（后续按需迁移）。
 */
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import Ajv, { type AnySchemaObject, type ValidateFunction } from 'ajv'

const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false })

let trustedWindow: BrowserWindow | null = null

/** 绑定可信主窗口；其 webContents.id 用于发送方校验。 */
export function setTrustedWindow(win: BrowserWindow): void {
  trustedWindow = win
}

/**
 * 校验 IPC 调用来源必须来自主窗口的顶层渲染帧。
 * - event.sender.id 必须等于主窗口 webContents.id（拒绝其它窗口 / webview 注入）
 * - 若 senderFrame 可用，其 parent 必须为 null（拒绝 iframe / 子帧注入）
 * 防止渲染层 XSS 经子帧或额外窗口绕过 preload 白名单直接 invoke 危险通道。
 */
export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const win = trustedWindow
  if (!win || win.isDestroyed()) {
    throw new Error('IPC 调用时主窗口不可用')
  }
  if (event.sender.id !== win.webContents.id) {
    throw new Error('拒绝非主窗口 IPC 调用')
  }
  const frame = event.senderFrame
  if (frame && frame.parent !== null) {
    throw new Error('拒绝非主帧 IPC 调用')
  }
}

/**
 * 统一 IPC handle 包装。
 *
 * @param channel 通道名
 * @param schemas 按位置校验各入参的 JSON Schema；null 位跳过；整体 null 不校验
 * @param fn 实际处理函数，签名同 ipcMain.handle 第二参
 *
 * 异常会经 invoke reject 回渲染层，preload 侧的 prettifyIpcError 负责中文展示。
 */
export function handle(
  channel: string,
  schemas: (AnySchemaObject | null)[] | null,
  // fn 的剩余入参用 any[] 而非 unknown[]：业务 handler 声明具体类型
  // （path: string, content: string 等），是 any[] 的协变子类型，可直接传入；
  // 用 unknown[] 会因逆变量参数报「string 不可赋给 unknown」。
  fn: (event: IpcMainInvokeEvent, ...args: any[]) => unknown | Promise<unknown>
): void {
  const validators: (ValidateFunction | null)[] = schemas
    ? schemas.map((s) => (s ? ajv.compile(s) : null))
    : []
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedSender(event)
    for (let i = 0; i < validators.length; i++) {
      const v = validators[i]
      if (!v) continue
      if (!v(args[i])) {
        const errs = (v.errors ?? [])
          .map((e) => `${e.instancePath || '(root)'}: ${e.message ?? ''}`)
          .join('; ')
        throw new Error(`参数校验失败: ${errs}`)
      }
    }
    return fn(event, ...args)
  })
}
