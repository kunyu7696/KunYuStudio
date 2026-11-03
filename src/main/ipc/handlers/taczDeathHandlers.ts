import { ipcMain } from 'electron'
import { readTaczDeath, saveTaczDeath } from '../services/taczDeathService'
import { IpcChannels } from '../shared/types/ipc'
import type { TaczGlobalConfig, TaczWorldsFile } from '../shared/types/taczdeath'

export function registerTaczDeathHandlers(): void {
  ipcMain.handle(IpcChannels.TACZDEATH_READ, (_evt, root: string) => readTaczDeath(root))
  ipcMain.handle(
    IpcChannels.TACZDEATH_SAVE,
    (_evt, root: string, global: TaczGlobalConfig, worlds: TaczWorldsFile) =>
      saveTaczDeath(root, global, worlds)
  )
}
