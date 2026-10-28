import { app, ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import type { McLaunchInput, McProvisionInput, McProvisionProgress } from '../../../shared/types/mcRuntime'
import {
  deleteMcInstance,
  fetchManifestWithFallback,
  listMcInstances,
  provisionMcRuntime,
  resolveMirror
} from '../../services/mcRuntimeService'
import { launchManagedInstance } from '../../services/mcLaunchService'
import { resolveObserverAgentJar } from '../../services/observer/observerService'
import { isPackagedRuntime } from '../../runtimeEnv'
import type { IpcContext } from '../context'

/** 零配置运行环境 3b：托管 MC 实例管理 + 运行时资产置备 */
export function registerMcHandlers(ctx: IpcContext): void {
  /** 推送置备进度到渲染层（窗口销毁时静默跳过） */
  const emitProgress = (p: McProvisionProgress): void => {
    try {
      if (!ctx.win.isDestroyed()) ctx.win.webContents.send(IpcChannels.MC_PROVISION_EVENT, p)
    } catch {
      /* 窗口已销毁不影响置备 */
    }
  }

  ipcMain.handle(IpcChannels.MC_LIST_VERSIONS, async (_event, mirror?: string) => {
    const { manifest } = await fetchManifestWithFallback(resolveMirror(mirror))
    return manifest.versions
  })

  ipcMain.handle(IpcChannels.MC_PROVISION, (_event, input: McProvisionInput) =>
    provisionMcRuntime(input, emitProgress)
  )

  ipcMain.handle(IpcChannels.MC_LIST_INSTANCES, () => listMcInstances())

  ipcMain.handle(IpcChannels.MC_DELETE_INSTANCE, (_event, id: string) => deleteMcInstance(id))

  ipcMain.handle(IpcChannels.MC_LAUNCH_INSTANCE, (_event, input: McLaunchInput) =>
    launchManagedInstance(input, {
      // kunyu-observer-agent（javaagent 形态）：可用即自动挂载，未构建时不阻塞启动
      resolveObserverAgent: () =>
        resolveObserverAgentJar(process.resourcesPath, app.getAppPath(), isPackagedRuntime(app))
    })
  )
}
