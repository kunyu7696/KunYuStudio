import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  quitAndInstallUpdate
} from '../../services/updaterService'
import type { IpcContext } from '../context'

/** 应用自更新：状态查询 / 手动检查 / 确认下载 / 重启安装（状态机由 updaterService 持有并推送） */
export function registerUpdateHandlers(_ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.UPDATE_GET_STATE, () => getUpdateState())
  ipcMain.handle(IpcChannels.UPDATE_CHECK, () => checkForUpdates(true))
  ipcMain.handle(IpcChannels.UPDATE_DOWNLOAD, () => downloadUpdate())
  ipcMain.handle(IpcChannels.UPDATE_INSTALL, () => quitAndInstallUpdate())
}
