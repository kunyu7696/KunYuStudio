import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { IpcChannels } from '../../../shared/types/ipc'
import { getAllSettings, isSecretEncryptionAvailable, maskSecrets, setSettings } from '../../services/settingsService'
import type { IpcContext } from '../context'

/** 应用信息、设置、外部链接与原生对话框 */
export function registerAppHandlers(ctx: IpcContext): void {
  // 应用信息
  ipcMain.handle(IpcChannels.APP_GET_VERSION, () => app.getVersion())
  ipcMain.handle(IpcChannels.APP_GET_PLATFORM, () => process.platform)

  // 写盘自检探针：试写 userData 子目录。失败 = EDR/只读盘拦截，
  // 返回 { ok:false, path, error }，渲染层顶部横幅提示"保存/导出将失败"。
  ipcMain.handle(IpcChannels.APP_WRITE_PROBE, () => {
    const target = app.getPath('userData')
    try {
      const probeDir = mkdtempSync(join(target, 'write-probe-'))
      rmSync(probeDir, { recursive: true, force: true })
      return { ok: true, path: target }
    } catch (err) {
      return {
        ok: false,
        path: target,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // 无边框窗口控制（frame:false，由渲染层 TopBar 按钮触发）
  const win = ctx.win
  ipcMain.handle(IpcChannels.WIN_MINIMIZE, () => win.minimize())
  ipcMain.handle(IpcChannels.WIN_TOGGLE_MAXIMIZE, () => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle(IpcChannels.WIN_CLOSE, () => win.close())
  ipcMain.handle(IpcChannels.WIN_IS_MAXIMIZED, () => win.isMaximized())
  win.on('maximize', () => win.webContents.send(IpcChannels.WIN_MAXIMIZED_CHANGED, true))
  win.on('unmaximize', () => win.webContents.send(IpcChannels.WIN_MAXIMIZED_CHANGED, false))

  // 设置（M6）。下发渲染层前掩码密钥：渲染层只见哨兵/空串，明文不出主进程。
  ipcMain.handle(IpcChannels.SETTINGS_GET_ALL, () => maskSecrets(getAllSettings()))
  ipcMain.handle(IpcChannels.SETTINGS_SET, (_event, patch: unknown) => {
    const next = setSettings(patch)
    // 界面缩放即时应用到所有窗口
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.setZoomFactor(next.general.zoomLevel)
    }
    return maskSecrets(next)
  })
  // 密钥加密降级可见性：safeStorage 不可用时渲染层顶部横幅明示「明文落盘」
  ipcMain.handle(IpcChannels.SETTINGS_CRYPTO_STATUS, () => ({
    encrypted: isSecretEncryptionAvailable()
  }))
  ipcMain.handle(IpcChannels.SHELL_OPEN_EXTERNAL, (_event, url: unknown) => {
    if (typeof url !== 'string') return false
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return false
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
    void shell.openExternal(url)
    return true
  })
  ipcMain.handle(IpcChannels.SHELL_SHOW_ITEM_IN_FOLDER, (_event, targetPath: unknown) => {
    if (typeof targetPath !== 'string' || !targetPath) return false
    if (!existsSync(targetPath)) return false
    shell.showItemInFolder(targetPath)
    return true
  })

  // 原生对话框
  ipcMain.handle(IpcChannels.DIALOG_SELECT_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle(IpcChannels.DIALOG_SELECT_IMAGE, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 PNG 贴图',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      properties: ['openFile']
    })
    return result.canceled ? undefined : result.filePaths[0]
  })
  ipcMain.handle(
    IpcChannels.DIALOG_SELECT_FILE,
    async (_event, input: { title: string; extensions: string[] }) => {
      const result = await dialog.showOpenDialog({
        title: input.title,
        filters: [{ name: input.title, extensions: input.extensions }],
        properties: ['openFile']
      })
      return result.canceled ? undefined : result.filePaths[0]
    }
  )
}
