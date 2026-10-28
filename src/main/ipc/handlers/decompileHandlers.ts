import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import type { DecompileEvent } from '../../../shared/types/decompile'
import {
  deleteWorkspace,
  ensureVineflower,
  listWorkspaces,
  readDirIn,
  readFileIn,
  searchIn,
  startDecompile,
  toolStatus
} from '../../services/decompileService'
import type { IpcContext } from '../context'

let jobSeq = 0

/** 反编译工作区：Vineflower 工具按需下载 + 任务进度推送 + 产物只读浏览 */
export function registerDecompileHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.DECOMPILE_STATUS, () => toolStatus())

  ipcMain.handle(IpcChannels.DECOMPILE_ENSURE_TOOL, () => ensureVineflower())

  ipcMain.handle(IpcChannels.DECOMPILE_START, async (_event, jarPath: string) => {
    const jobId = `dc-${Date.now()}-${++jobSeq}`
    const send = (payload: DecompileEvent): void => {
      if (!ctx.win.isDestroyed()) ctx.win.webContents.send(IpcChannels.DECOMPILE_EVENT, payload)
    }
    try {
      const result = await startDecompile(jarPath, (phase, message) => {
        send({ jobId, phase, message })
      })
      send({ jobId, phase: 'done', outDir: result.outDir, fileCount: result.fileCount })
      return result
    } catch (err) {
      send({ jobId, phase: 'error', error: (err as Error).message })
      throw err
    }
  })

  ipcMain.handle(IpcChannels.DECOMPILE_LIST_WORKSPACES, () => listWorkspaces())
  ipcMain.handle(IpcChannels.DECOMPILE_READ_DIR, (_event, root: string, relDir: string) =>
    readDirIn(root, relDir)
  )
  ipcMain.handle(IpcChannels.DECOMPILE_READ_FILE, (_event, root: string, relPath: string) =>
    readFileIn(root, relPath)
  )
  ipcMain.handle(IpcChannels.DECOMPILE_SEARCH, (_event, root: string, query: string) =>
    searchIn(root, query)
  )
  ipcMain.handle(IpcChannels.DECOMPILE_DELETE_WORKSPACE, (_event, root: string) =>
    deleteWorkspace(root)
  )
}
