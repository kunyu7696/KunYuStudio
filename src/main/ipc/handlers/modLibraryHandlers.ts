import { app, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { IpcChannels } from '../../../shared/types/ipc'
import { getAllProjects } from '../../services/projectService'
import { getSection } from '../../services/settingsService'
import {
  addEntryToProject,
  downloadEntry,
  enrichIcons,
  importLocalFiles,
  listEntries,
  listWorlds,
  removeEntry
} from '../../services/modLibraryService'
import type { ModLibraryDownloadInput, ModLibraryFilter } from '../../../shared/types/modLibrary'
import type { IpcContext } from '../context'

/**
 * 用户级 Mod 库 IPC：
 * 库根目录统一为 userData/mod-library；CurseForge Key 从设置注入。
 */
export function registerModLibraryHandlers(ctx: IpcContext): void {
  const libraryRoot = (): string => join(app.getPath('userData'), 'mod-library')
  const cfKey = (): string => getSection('marketplace').curseforgeApiKey
  // 当前进行中的下载控制器，供 MODLIB_CANCEL_DOWNLOAD 中断
  let currentDownload: AbortController | null = null

  /** 校验项目路径确实是已登记的整合包项目 */
  function findModpack(projectPath: string) {
    const project = getAllProjects().find((p) => p.path === projectPath)
    return project?.type === 'modpack' ? project : undefined
  }

  ipcMain.handle(IpcChannels.MODLIB_LIST, (_event, filter: ModLibraryFilter | undefined) =>
    listEntries(libraryRoot(), filter)
  )

  ipcMain.handle(IpcChannels.MODLIB_DOWNLOAD, async (_event, input: ModLibraryDownloadInput) => {
    const controller = new AbortController()
    currentDownload = controller
    try {
      return await downloadEntry(libraryRoot(), input, cfKey(), controller.signal)
    } finally {
      if (currentDownload === controller) currentDownload = null
    }
  })

  ipcMain.handle(IpcChannels.MODLIB_CANCEL_DOWNLOAD, () => {
    if (currentDownload) {
      currentDownload.abort()
      currentDownload = null
      return { ok: true }
    }
    return { ok: false, error: '当前没有进行中的下载' }
  })

  ipcMain.handle(IpcChannels.MODLIB_PICK_AND_IMPORT, async () => {
    const result = await dialog.showOpenDialog(ctx.win, {
      title: '选择要导入资源库的文件（jar/zip/mrpack，可多选）',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Minecraft 资源（jar/zip/mrpack）', extensions: ['jar', 'zip', 'mrpack'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return []
    return importLocalFiles(libraryRoot(), result.filePaths)
  })

  ipcMain.handle(IpcChannels.MODLIB_REMOVE, (_event, fileName: string) =>
    removeEntry(libraryRoot(), fileName)
  )

  ipcMain.handle(
    IpcChannels.MODLIB_ADD_TO_PROJECT,
    (_event, projectPath: string, fileName: string, overwrite: boolean | undefined, worldName: string | undefined) => {
      if (!findModpack(projectPath)) {
        return { ok: false, error: '目标不是已登记的整合包项目' }
      }
      return addEntryToProject(libraryRoot(), projectPath, fileName, overwrite === true, worldName)
    }
  )

  ipcMain.handle(IpcChannels.MODLIB_LIST_WORLDS, (_event, projectPath: string) => {
    if (!findModpack(projectPath)) return []
    return listWorlds(projectPath)
  })

  ipcMain.handle(IpcChannels.MODLIB_ROOT, () => libraryRoot())

  ipcMain.handle(IpcChannels.MODLIB_REVEAL, (_event, fileName: string) => {
    const target = join(libraryRoot(), fileName)
    if (!existsSync(target)) return false
    shell.showItemInFolder(target)
    return true
  })

  ipcMain.handle(IpcChannels.MODLIB_ENRICH_ICONS, () => enrichIcons(libraryRoot(), cfKey()))
}
