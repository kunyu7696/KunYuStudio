import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import {
  deleteDataPackEntry,
  initDataPack,
  listDataPackEntries,
  readDataPackEntry,
  readDataPackMeta,
  writeDataPackEntry,
  type PackMode as DataPackMode
} from '../../services/datapackService'
import {
  deleteShaderFile,
  exportShaderPackZip,
  initShaderPack,
  listShaderFiles,
  readShaderFile,
  readShaderPackMeta,
  writeShaderFile
} from '../../services/shaderpackService'
import {
  deleteResourceFile,
  exportResourcePackZip,
  importPackIcon,
  importResourceSound,
  initResourcePack,
  listResourceFiles,
  readResourceFile,
  readResourcePackMeta,
  readResourceSound,
  readResourceTexture,
  writeResourceFile,
  writeResourceTexture
} from '../../services/resourcepackService'
import type { IpcContext } from '../context'

/** 数据包 / 光影包 / 资源包三个独立编辑器的文件通道 */
export function registerEditorPackHandlers(_ctx: IpcContext): void {
  // 数据包编辑器（P0）
  ipcMain.handle(IpcChannels.DATAPACK_GET_META, (_event, root: string) => readDataPackMeta(root))
  ipcMain.handle(
    IpcChannels.DATAPACK_INIT,
    (
      _event,
      root: string,
      input: { namespace: string; description: string; mcVersion: '1.20.1' | '1.21.1' },
      mode: DataPackMode
    ) => initDataPack(root, input, mode)
  )
  ipcMain.handle(IpcChannels.DATAPACK_LIST_ENTRIES, (_event, root: string, mode: DataPackMode) =>
    listDataPackEntries(root, mode)
  )
  ipcMain.handle(
    IpcChannels.DATAPACK_READ_ENTRY,
    (_event, root: string, category: string, id: string, mode: DataPackMode) =>
      readDataPackEntry(root, category, id, mode)
  )
  ipcMain.handle(
    IpcChannels.DATAPACK_WRITE_ENTRY,
    (_event, root: string, category: string, id: string, content: string, mode: DataPackMode) =>
      writeDataPackEntry(root, category, id, content, mode)
  )
  ipcMain.handle(
    IpcChannels.DATAPACK_DELETE_ENTRY,
    (_event, root: string, category: string, id: string, mode: DataPackMode) =>
      deleteDataPackEntry(root, category, id, mode)
  )

  // 光影包编辑器（P0）
  ipcMain.handle(IpcChannels.SHADERPACK_GET_META, (_event, root: string) => readShaderPackMeta(root))
  ipcMain.handle(
    IpcChannels.SHADERPACK_INIT,
    (
      _event,
      root: string,
      input: {
        packId?: string
        name: string
        loader: 'iris' | 'optifine'
        mcVersion: '1.20.1' | '1.21.1'
        version?: string
        description: string
      },
      mode: DataPackMode
    ) => initShaderPack(root, input, mode)
  )
  ipcMain.handle(IpcChannels.SHADERPACK_LIST_FILES, (_event, root: string, mode: DataPackMode) =>
    listShaderFiles(root, mode)
  )
  ipcMain.handle(
    IpcChannels.SHADERPACK_READ_FILE,
    (_event, root: string, relPath: string, mode: DataPackMode) =>
      readShaderFile(root, relPath, mode)
  )
  ipcMain.handle(
    IpcChannels.SHADERPACK_WRITE_FILE,
    (_event, root: string, relPath: string, content: string, mode: DataPackMode) =>
      writeShaderFile(root, relPath, content, mode)
  )
  ipcMain.handle(
    IpcChannels.SHADERPACK_DELETE_FILE,
    (_event, root: string, relPath: string, mode: DataPackMode) =>
      deleteShaderFile(root, relPath, mode)
  )
  // 导出可分发 zip（产物固定在项目 dist/ 下，避免渲染层指定任意写盘路径）
  ipcMain.handle(IpcChannels.SHADERPACK_EXPORT_ZIP, (_event, root: string, mode: DataPackMode) =>
    exportShaderPackZip(root, mode)
  )

  // 资源包编辑器（P0）
  ipcMain.handle(IpcChannels.RESOURCEPACK_GET_META, (_event, root: string) =>
    readResourcePackMeta(root)
  )
  ipcMain.handle(
    IpcChannels.RESOURCEPACK_INIT,
    (
      _event,
      root: string,
      input: {
        packId?: string
        name: string
        mcVersion: string
        description: string
        namespace: string
      },
      mode: DataPackMode
    ) => initResourcePack(root, input, mode)
  )
  ipcMain.handle(IpcChannels.RESOURCEPACK_LIST_FILES, (_event, root: string, mode: DataPackMode) =>
    listResourceFiles(root, mode)
  )
  ipcMain.handle(
    IpcChannels.RESOURCEPACK_READ_FILE,
    (_event, root: string, relPath: string, mode: DataPackMode) =>
      readResourceFile(root, relPath, mode)
  )
  ipcMain.handle(
    IpcChannels.RESOURCEPACK_WRITE_FILE,
    (_event, root: string, relPath: string, content: string, mode: DataPackMode) =>
      writeResourceFile(root, relPath, content, mode)
  )
  ipcMain.handle(
    IpcChannels.RESOURCEPACK_DELETE_FILE,
    (_event, root: string, relPath: string, mode: DataPackMode) =>
      deleteResourceFile(root, relPath, mode)
  )
  ipcMain.handle(
    IpcChannels.RESOURCEPACK_IMPORT_ICON,
    (_event, root: string, srcPath: string, mode: DataPackMode) =>
      importPackIcon(root, srcPath, mode)
  )
  ipcMain.handle(
    IpcChannels.RESOURCEPACK_WRITE_TEXTURE,
    (
      _event,
      root: string,
      relPath: string,
      pixels: string[],
      width: number,
      height: number,
      mode: DataPackMode
    ) => writeResourceTexture(root, relPath, pixels, width, height, mode)
  )
  ipcMain.handle(
    IpcChannels.RESOURCEPACK_READ_TEXTURE,
    (_event, root: string, relPath: string, mode: DataPackMode) =>
      readResourceTexture(root, relPath, mode)
  )
  // 导出可分发 zip（产物固定在项目 dist/ 下；zip 顶层 = pack.mcmeta + assets/）
  ipcMain.handle(
    IpcChannels.RESOURCEPACK_EXPORT_ZIP,
    (_event, root: string, mode: DataPackMode) => exportResourcePackZip(root, mode)
  )
  // 导入 .ogg 音效（系统选择器源路径）与读取试听 data URL
  ipcMain.handle(
    IpcChannels.RESOURCEPACK_IMPORT_SOUND,
    (_event, root: string, srcPath: string, mode: DataPackMode) =>
      importResourceSound(root, srcPath, mode)
  )
  ipcMain.handle(
    IpcChannels.RESOURCEPACK_READ_SOUND,
    (_event, root: string, relPath: string, mode: DataPackMode) =>
      readResourceSound(root, relPath, mode)
  )
}
