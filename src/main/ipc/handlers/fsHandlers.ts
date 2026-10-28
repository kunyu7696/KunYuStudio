import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import {
  copyEntry,
  createEntry,
  deleteEntry,
  moveEntry,
  readBinaryFile,
  readDir,
  readFile,
  registerProjectRoot,
  renameEntry,
  searchFiles,
  statEntry,
  writeFile
} from '../../services/fsService'
import { startWatching, stopWatching } from '../../services/fileWatcher'
import { getAllProjects } from '../../services/projectService'
import type { IpcContext } from '../context'
import { handle } from '../handle'
import { resolve } from 'node:path'

/** 文件系统（M3） */
export function registerFsHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.FS_READ_DIR, (_event, path: string) => readDir(path))
  ipcMain.handle(IpcChannels.FS_READ_FILE, (_event, path: string) => readFile(path))
  ipcMain.handle(IpcChannels.FS_READ_BINARY, (_event, path: string) => readBinaryFile(path))
  // FS_WRITE_FILE：写入路径最终落点由 fsService.assertWithinRoot
  // 兜底（解析符号链接、拒绝越界），schema 在此做类型与长度防御，
  // 并经 handle 包装拒绝非主窗口 / 子帧调用。
  handle(
    IpcChannels.FS_WRITE_FILE,
    [
      { type: 'string', minLength: 1, maxLength: 4096 },
      { type: 'string', maxLength: 50 * 1024 * 1024 }
    ],
    (_event, path: string, content: string) => writeFile(path, content)
  )
  ipcMain.handle(IpcChannels.FS_CREATE, (_event, input) => createEntry(input))
  ipcMain.handle(IpcChannels.FS_RENAME, (_event, input) => renameEntry(input))
  ipcMain.handle(IpcChannels.FS_DELETE, (_event, path: string) => deleteEntry(path))
  ipcMain.handle(IpcChannels.FS_COPY, (_event, input) => copyEntry(input))
  ipcMain.handle(IpcChannels.FS_MOVE, (_event, src: string, destDir: string) =>
    moveEntry(src, destDir)
  )
  ipcMain.handle(IpcChannels.FS_SEARCH, (_event, root: string, query: string) =>
    searchFiles(root, query)
  )
  ipcMain.handle(IpcChannels.FS_STAT, (_event, path: string) => statEntry(path))
  // P2-K：FS_WATCH_START 仅允许已打开项目列表内的路径注册，防止任意目录穿越
  ipcMain.handle(IpcChannels.FS_WATCH_START, async (_event, root: string) => {
    const projects = await getAllProjects()
    const resolvedRoot = resolve(root)
    const allowed = projects.some((p) => resolve(p.path) === resolvedRoot)
    if (!allowed) {
      return { ok: false, error: '路径不在项目列表内，禁止注册文件监视' }
    }
    registerProjectRoot(root)
    startWatching(root, ctx.win)
    return { ok: true }
  })
  ipcMain.handle(IpcChannels.FS_WATCH_STOP, () => {
    stopWatching()
  })
}
