import { ipcMain } from 'electron'
import {
  importFancyMenuAsset,
  readFancyMenu,
  writeFancyMenu
} from '../../services/fancyMenuService'
import { IpcChannels } from '../../../shared/types/ipc'
import type { FmElement } from '../../../shared/types/fancymenu'

export function registerFancyMenuHandlers(): void {
  ipcMain.handle(IpcChannels.FANCYMENU_READ, (_evt, root: string, loader?: string) => {
    return readFancyMenu(root, loader)
  })
  ipcMain.handle(
    IpcChannels.FANCYMENU_SAVE,
    (_evt, root: string, elements: unknown, loader?: string) => {
      // 不做运行时强校验（类型系统已保证），直接透传；保存内部只操作合法元素
      return writeFancyMenu(root, elements as FmElement[], loader)
    }
  )
  ipcMain.handle(
    IpcChannels.FANCYMENU_IMPORT_ASSET,
    (_evt, root: string, srcFile: string, loader?: string) =>
      importFancyMenuAsset(root, srcFile, loader)
  )
}
