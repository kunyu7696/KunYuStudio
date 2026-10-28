import { BrowserWindow } from 'electron'
import chokidar, { type FSWatcher } from 'chokidar'
import { resolve } from 'node:path'
import { IpcChannels } from '../../shared/types/ipc'
import type { FsChangeEvent } from '../../shared/types/fs'
import { DEFAULT_EXCLUDE_PATTERNS } from '../../shared/types/fs'
import { normalizePath } from './fsService'

let watcher: FSWatcher | null = null
let currentRoot: string | null = null

/**
 * 启动对项目根目录的监听。
 * 同一时间只监听一个项目根；切换项目时先 stop 再 start。
 */
export function startWatching(root: string, win: BrowserWindow): void {
  stopWatching()
  currentRoot = resolve(root)
  watcher = chokidar.watch(currentRoot, {
    ignored: (path: string) => {
      const seg = path.split(/[\\/]/).pop() ?? ''
      return DEFAULT_EXCLUDE_PATTERNS.includes(seg)
    },
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  })

  const emit = (type: FsChangeEvent['type'], rawPath: string): void => {
    if (win.isDestroyed()) return
    const event: FsChangeEvent = { type, path: normalizePath(rawPath) }
    win.webContents.send(IpcChannels.FS_EVENT, event)
  }

  watcher
    .on('add', (p) => emit('add', p))
    .on('change', (p) => emit('change', p))
    .on('unlink', (p) => emit('unlink', p))
    .on('addDir', (p) => emit('addDir', p))
    .on('unlinkDir', (p) => emit('unlinkDir', p))
}

export function stopWatching(): void {
  if (watcher) {
    watcher.close().catch(() => {})
    watcher = null
  }
  currentRoot = null
}

export function getWatchedRoot(): string | null {
  return currentRoot
}
