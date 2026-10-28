import { app, dialog, ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import { createObserverService } from '../../services/observer/observerService'
import { isPackagedRuntime } from '../../runtimeEnv'
import type { IpcContext } from '../context'

/**
 * kunyu-observer 内置探针注入（kunyu-observer-agent 游戏端）。
 * - 小白：OBSERVER_INJECT_PROJECT 一键复制进当前项目 run/mods；
 * - 高级：OBSERVER_PICK_DIR / OBSERVER_INJECT_DIR 注入启动器实例的自定义 mods 目录。
 */
export function registerObserverHandlers(ctx: IpcContext): void {
  const service = createObserverService({
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    isPackaged: isPackagedRuntime(app)
  })

  ipcMain.handle(IpcChannels.OBSERVER_GET_STATUS, () =>
    service.projectStatus(ctx.activeProject.current)
  )

  ipcMain.handle(IpcChannels.OBSERVER_INJECT_PROJECT, () =>
    service.injectProject(ctx.activeProject.current)
  )

  ipcMain.handle(IpcChannels.OBSERVER_INJECT_DIR, (_event, dir: unknown) =>
    service.injectDir(typeof dir === 'string' ? dir : '')
  )

  ipcMain.handle(IpcChannels.OBSERVER_PICK_DIR, async () => {
    const result = await dialog.showOpenDialog(ctx.win, {
      title: '选择游戏实例的 mods 目录',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }
    return { ok: true, path: result.filePaths[0] }
  })
}
