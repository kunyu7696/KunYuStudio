import { dialog, ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import {
  exportCreation,
  importCreation,
  listCreations,
  previewSharePackage,
  readSharePackage,
  writeSharePackage
} from '../../services/kunyuShareService'
import type { ContentKind } from '../../../shared/types/content'
import type { IpcContext } from '../context'

/** M17 KunYu 创作社区：跨项目创作聚合 + .kyshare.json 分享包导出/导入 */
export function registerKunyuHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.KUNYU_LIST_CREATIONS, () => listCreations())

  ipcMain.handle(
    IpcChannels.KUNYU_EXPORT_CREATION,
    async (
      _event,
      input: { projectPath: string; kind: ContentKind; id: string; license?: string }
    ) => {
      const pkg = exportCreation(input.projectPath, input.kind, input.id, {
        license: input.license
      })
      const picked = await dialog.showSaveDialog(ctx.win, {
        title: '导出 KunYu 分享包',
        defaultPath: `${input.id}.kyshare.json`,
        filters: [{ name: 'KunYu 分享包', extensions: ['json'] }]
      })
      if (picked.canceled || !picked.filePath) return null
      writeSharePackage(picked.filePath, pkg)
      return { filePath: picked.filePath }
    }
  )

  ipcMain.handle(
    IpcChannels.KUNYU_IMPORT_CREATION,
    async (
      _event,
      targetProjectPath: string,
      overwrite?: boolean,
      options?: { preview?: boolean; filePath?: string }
    ) => {
      let filePath = options?.filePath
      if (!filePath) {
        const picked = await dialog.showOpenDialog(ctx.win, {
          title: '导入 KunYu 分享包',
          properties: ['openFile'],
          filters: [{ name: 'KunYu 分享包', extensions: ['json'] }]
        })
        if (picked.canceled || picked.filePaths.length === 0) return null
        filePath = picked.filePaths[0]!
      }
      const pkg = readSharePackage(filePath)
      // 预览模式：只读包返回元数据供确认前展示，不落盘；确认后回传 filePath 走真实导入
      if (options?.preview) return previewSharePackage(pkg, filePath, targetProjectPath)
      return importCreation(pkg, targetProjectPath, overwrite === true)
    }
  )
}
