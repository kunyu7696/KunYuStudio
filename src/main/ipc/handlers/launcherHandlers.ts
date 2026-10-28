import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import type {
  AddLauncherInput,
  AutoIntegrateInput,
  ImportBatchInput,
  ImportInput,
  LauncherEvent
} from '../../../shared/types/launcher'
import type { IpcContext } from '../context'

/** M11 启动器集成：detect → listInstances → import → setActive → launch 全链路 */
export function registerLauncherHandlers(ctx: IpcContext): void {
  const launcherService = ctx.launcherService

  /** 推送启动器事件到渲染层（窗口销毁时静默跳过） */
  const emitLauncherEvent = (event: LauncherEvent): void => {
    if (!ctx.win.isDestroyed()) ctx.win.webContents.send(IpcChannels.LAUNCHER_EVENT, event)
  }
  /** 错误信息提取（避免 any） */
  const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  ipcMain.handle(IpcChannels.LAUNCHER_DETECT, async () => {
    emitLauncherEvent({ phase: 'detect', status: 'start' })
    try {
      const result = await launcherService.detect()
      emitLauncherEvent({
        phase: 'detect',
        status: 'done',
        detail: `${result.launchers.length} 个启动器${result.errors.length ? `（${result.errors.length} 个错误）` : ''}`
      })
      return result
    } catch (err) {
      emitLauncherEvent({ phase: 'detect', status: 'failed', detail: errMsg(err) })
      throw err
    }
  })
  ipcMain.handle(IpcChannels.LAUNCHER_LIST_INSTANCES, (_event, launcherId: string) =>
    launcherService.listInstances(launcherId)
  )
  ipcMain.handle(IpcChannels.LAUNCHER_IMPORT, async (_event, input: ImportInput) => {
    emitLauncherEvent({ phase: 'import', status: 'start' })
    try {
      const result = await launcherService.import(input)
      if (result.ok && result.record) {
        emitLauncherEvent({
          phase: 'import',
          status: 'done',
          recordId: result.record.id,
          detail: result.record.fileName
        })
      } else {
        emitLauncherEvent({
          phase: 'import',
          status: 'failed',
          detail: result.error ?? '导入失败'
        })
      }
      return result
    } catch (err) {
      emitLauncherEvent({ phase: 'import', status: 'failed', detail: errMsg(err) })
      throw err
    }
  })
  ipcMain.handle(IpcChannels.LAUNCHER_IMPORT_BATCH, async (_event, input: ImportBatchInput) => {
    emitLauncherEvent({ phase: 'import', status: 'start' })
    try {
      const result = await launcherService.importBatch(input)
      emitLauncherEvent({
        phase: 'import',
        status: result.ok ? 'done' : 'failed',
        detail: result.ok
          ? `${result.imported.length} 个模组已就位`
          : (result.error ?? `${result.failed.length} 个模组导入失败`)
      })
      return result
    } catch (err) {
      emitLauncherEvent({ phase: 'import', status: 'failed', detail: errMsg(err) })
      throw err
    }
  })
  ipcMain.handle(IpcChannels.LAUNCHER_SET_ACTIVE, (_event, instanceId: string) =>
    launcherService.setActive(instanceId)
  )
  ipcMain.handle(IpcChannels.LAUNCHER_LAUNCH, async (_event, instanceId: string) => {
    emitLauncherEvent({ phase: 'launch', status: 'start' })
    try {
      const ok = await launcherService.launch(instanceId)
      emitLauncherEvent({
        phase: 'launch',
        status: ok ? 'done' : 'failed',
        detail: ok ? undefined : '实例未找到或启动器缺失'
      })
      return ok
    } catch (err) {
      emitLauncherEvent({ phase: 'launch', status: 'failed', detail: errMsg(err) })
      throw err
    }
  })
  ipcMain.handle(IpcChannels.LAUNCHER_ADD, (_event, input: AddLauncherInput) =>
    launcherService.add(input)
  )
  ipcMain.handle(IpcChannels.LAUNCHER_AUTO_INTEGRATE, async (_event, input: AutoIntegrateInput) => {
    emitLauncherEvent({ phase: 'detect', status: 'start', detail: '自动扫描本机启动器' })
    try {
      const result = await launcherService.autoIntegrate(input)
      emitLauncherEvent({
        phase: 'detect',
        status: result.ok ? 'done' : 'failed',
        detail: result.ok
          ? `已集成 ${result.instance?.name ?? ''}`
          : (result.error ?? '未找到可用实例')
      })
      return result
    } catch (err) {
      emitLauncherEvent({ phase: 'detect', status: 'failed', detail: errMsg(err) })
      throw err
    }
  })
  ipcMain.handle(IpcChannels.LAUNCHER_GET_STATE, () => launcherService.getState())
}
