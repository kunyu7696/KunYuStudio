import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import type { KubejsScriptDir } from '../../../shared/types/kubejs'
import {
  applyTemplate,
  deleteScript,
  listScripts,
  listTemplates,
  readScript,
  writeScript
} from '../../services/kubejsService'

/** KubeJS 脚本：kubejs/{startup,server,client}_scripts/*.js 读写 + 模板库（纯请求-响应） */
export function registerKubejsHandlers(): void {
  ipcMain.handle(IpcChannels.KUBEJS_LIST, (_event, root: string) => listScripts(root))
  ipcMain.handle(IpcChannels.KUBEJS_READ, (_event, root: string, dir: KubejsScriptDir, stem: string) =>
    readScript(root, dir, stem)
  )
  ipcMain.handle(
    IpcChannels.KUBEJS_SAVE,
    (_event, root: string, dir: KubejsScriptDir, stem: string, content: string) =>
      writeScript(root, dir, stem, content)
  )
  ipcMain.handle(IpcChannels.KUBEJS_DELETE, (_event, root: string, dir: KubejsScriptDir, stem: string) =>
    deleteScript(root, dir, stem)
  )
  ipcMain.handle(IpcChannels.KUBEJS_TEMPLATES, () => listTemplates())
  ipcMain.handle(IpcChannels.KUBEJS_APPLY_TEMPLATE, (_event, root: string, templateId: string) =>
    applyTemplate(root, templateId)
  )
}
