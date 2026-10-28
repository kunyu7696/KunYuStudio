import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import { createSandboxRunner } from '../../services/sandboxService'

/** M10 游戏测试沙箱：观察通道走 kunyu-observer-agent，事件按请求 sender 回推 */
export function registerSandboxHandlers(): void {
  const sandboxRunner = createSandboxRunner()
  ipcMain.handle(IpcChannels.SANDBOX_RUN, (event, config) =>
    sandboxRunner.run(config, (sandboxEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send(IpcChannels.SANDBOX_EVENT, sandboxEvent)
    })
  )
  ipcMain.handle(IpcChannels.SANDBOX_CANCEL, (_event, runId?: string) => {
    sandboxRunner.cancel(runId)
    return true
  })
}
