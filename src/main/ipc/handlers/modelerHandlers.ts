/**
 * 模型工坊 IPC 处理器（方案 §4.1 modelerHandlers.ts）。
 * PNG 贴图导入导出 + 文档落盘（保存/自动保存/崩溃恢复，P2-f）；
 * 后续 .kunyu/modeler 文档读写迁移、格式导出通道也挂这里。
 */
import { ipcMain } from 'electron'
import { IpcChannels, type ModelerAnimExportInput, type ModelerBbmodelExportInput, type ModelerGltfExportInput, type ModelerObjExportInput, type ModelerSkinExportInput, type ModelerTextureExportInput } from '../../../shared/types/ipc'
import type { IpcContext } from '../context'
import { compileModelerDoc } from '../../services/modeler/modelerCompile'
import {
  exportAnimationsDialog,
  exportBbmodelDialog,
  exportControllerDialog,
  exportGltfDialog,
  exportJemDialog,
  exportJpmDialog,
  exportObjDialog,
  importBedrockGeoDialog,
  exportBedrockGeoDialog,
  exportSkinDialog,
  exportTexturePngDialog,
  importAnimationsDialog,
  importBbmodelDialog,
  importControllerDialog,
  importDaeDialog,
  importFbxDialog,
  importGltfDialog,
  importJemDialog,
  importJpmDialog,
  importObjDialog,
  importSkinDialog,
  importTexturePngDialog
} from '../../services/modeler/modelerIo'
import {
  autosaveModelerDoc,
  checkModelerDocRecovery,
  saveModelerDoc
} from '../../services/modeler/modelerBackup'
import { applyModelerGeoToEntity } from '../../services/modeler/modelerGeoApply'
import { applyModelerModelToObject } from '../../services/modeler/modelerModelApply'

/** 字符串参数校验（root/id/content 为外部输入，非法直接拒绝） */
function assertString(v: unknown, name: string): asserts v is string {
  if (typeof v !== 'string' || v.length === 0) throw new Error(`非法参数：${name}`)
}

export function registerModelerHandlers(ctx: IpcContext): void {
  // PNG 贴图导入：弹文件框 + 解码校验（root 预留做项目相对路径锚点，暂不使用）
  ipcMain.handle(IpcChannels.MODELER_TEXTURE_IMPORT, (_event, _root: string) =>
    importTexturePngDialog(ctx.win)
  )
  // PNG 贴图导出：弹保存框 + data URL 落盘
  ipcMain.handle(
    IpcChannels.MODELER_TEXTURE_EXPORT,
    (_event, _root: string, input: ModelerTextureExportInput) =>
      exportTexturePngDialog(ctx.win, input)
  )
  // 文档显式保存：备份轮转 + 原子写 + 清 autosave；P1② expectedRevision 乐观锁（冲突抛 ModelerConflictError）
  ipcMain.handle(
    IpcChannels.MODELER_DOC_SAVE,
    (_event, root: string, id: string, content: string, expectedRevision?: string | null) => {
      assertString(root, 'root')
      assertString(id, 'id')
      assertString(content, 'content')
      if (expectedRevision !== undefined && expectedRevision !== null && typeof expectedRevision !== 'string') {
        throw new Error('非法参数：expectedRevision')
      }
      return saveModelerDoc(root, id, content, { expectedRevision })
    }
  )
  // 自动保存影子文件（content=null 删除）
  ipcMain.handle(IpcChannels.MODELER_DOC_AUTOSAVE, (_event, root: string, id: string, content: string | null) => {
    assertString(root, 'root')
    assertString(id, 'id')
    if (content !== null && typeof content !== 'string') throw new Error('非法参数：content')
    return autosaveModelerDoc(root, id, content)
  })
  // 崩溃恢复信息（只读）
  ipcMain.handle(IpcChannels.MODELER_DOC_RECOVERY, (_event, root: string, id: string) => {
    assertString(root, 'root')
    assertString(id, 'id')
    return checkModelerDocRecovery(root, id)
  })
  // （P3-f）工坊文档导出 geo.json 写回实体（覆盖已有骨骼几何需 confirm）
  ipcMain.handle(
    IpcChannels.MODELER_APPLY_GEO_TO_ENTITY,
    (_event, root: string, docId: string, entityId: string, confirm?: boolean) => {
      assertString(root, 'root')
      assertString(docId, 'docId')
      assertString(entityId, 'entityId')
      if (confirm !== undefined && typeof confirm !== 'boolean') {
        throw new Error('非法参数：confirm')
      }
      return applyModelerGeoToEntity(root, docId, entityId, confirm)
    }
  )
  // （P4）.animation.json 导入：弹文件框读 JSON 原文（codec 在渲染层）
  ipcMain.handle(IpcChannels.MODELER_ANIM_IMPORT, (_event, _root: string) =>
    importAnimationsDialog(ctx.win)
  )
  // （P4）.animation.json 导出：弹保存框落盘动画 JSON 文本
  ipcMain.handle(
    IpcChannels.MODELER_ANIM_EXPORT,
    (_event, _root: string, input: ModelerAnimExportInput) =>
      exportAnimationsDialog(ctx.win, input)
  )
  // （P5-bbmodel）.bbmodel 导入：弹文件框读 JSON 原文（codec 在渲染层）
  ipcMain.handle(IpcChannels.MODELER_BBMODEL_IMPORT, (_event, _root: string) =>
    importBbmodelDialog(ctx.win)
  )
  // （P5-bbmodel）.bbmodel 导出：弹保存框落盘 bbmodel JSON 文本
  ipcMain.handle(
    IpcChannels.MODELER_BBMODEL_EXPORT,
    (_event, _root: string, input: ModelerBbmodelExportInput) =>
      exportBbmodelDialog(ctx.win, input)
  )
  // （B5-1）glTF 导出：弹保存框落盘 .gltf + .bin 并物化 PNG 贴图
  ipcMain.handle(
    IpcChannels.MODELER_GLTF_EXPORT,
    (_event, _root: string, input: ModelerGltfExportInput) =>
      exportGltfDialog(ctx.win, input)
  )
  // （C8）OBJ 导出：弹保存框落盘 .obj + 同目录 model.mtl
  ipcMain.handle(
    IpcChannels.MODELER_OBJ_EXPORT,
    (_event, _root: string, input: ModelerObjExportInput) =>
      exportObjDialog(ctx.win, input)
  )
  // （C9）Bedrock geo.json 导入：弹文件框读 JSON 原文（Entity / Block / GeckoLib 共用）
  ipcMain.handle(IpcChannels.MODELER_BEDROCK_GEO_IMPORT, (_event, _root: string) =>
    importBedrockGeoDialog(ctx.win)
  )
  // （C9）Bedrock geo.json 导出：弹保存框落盘 JSON
  ipcMain.handle(
    IpcChannels.MODELER_BEDROCK_GEO_EXPORT,
    (_event, _root: string, input: { name: string; content: string }) =>
      exportBedrockGeoDialog(ctx.win, input)
  )
  // （B5-2）控制器导入：弹文件框读 JSON 原文（codec 在渲染层）
  ipcMain.handle(IpcChannels.MODELER_CTRL_IMPORT, (_event, _root: string) =>
    importControllerDialog(ctx.win)
  )
  // （B5-2）控制器导出：弹保存框落盘 .animation_controllers.json 文本
  ipcMain.handle(
    IpcChannels.MODELER_CTRL_EXPORT,
    (_event, _root: string, input: ModelerAnimExportInput) =>
      exportControllerDialog(ctx.win, input)
  )
  // （B5-3）OptiFine JEM 导入：弹文件框读 JSON 原文（codec 在渲染层）
  ipcMain.handle(IpcChannels.MODELER_JEM_IMPORT, (_event, _root: string) => importJemDialog(ctx.win))
  // （B5-3）OptiFine JEM 导出：弹保存框落盘 .jem 文本
  ipcMain.handle(
    IpcChannels.MODELER_JEM_EXPORT,
    (_event, _root: string, input: ModelerAnimExportInput) => exportJemDialog(ctx.win, input)
  )
  // （B5-3）OptiFine JPM 导入：弹文件框读 JSON 原文（codec 在渲染层）
  ipcMain.handle(IpcChannels.MODELER_JPM_IMPORT, (_event, _root: string) => importJpmDialog(ctx.win))
  // （B5-3）OptiFine JPM 导出：弹保存框落盘 .jpm 文本
  ipcMain.handle(
    IpcChannels.MODELER_JPM_EXPORT,
    (_event, _root: string, input: ModelerAnimExportInput) => exportJpmDialog(ctx.win, input)
  )
  // （P5-obj）OBJ 导入：弹文件框读 .obj（+同目录 .mtl）原文（codec 在渲染层）
  ipcMain.handle(IpcChannels.MODELER_OBJ_IMPORT, (_event, _root: string) =>
    importObjDialog(ctx.win)
  )
  // （C5）Collada .dae 导入：弹文件框读 XML 原文（codec 在渲染层）
  ipcMain.handle(IpcChannels.MODELER_DAE_IMPORT, (_event, _root: string) => importDaeDialog(ctx.win))
  // （C5）ASCII FBX .fbx 导入：弹文件框读原文（codec 在渲染层）
  ipcMain.handle(IpcChannels.MODELER_FBX_IMPORT, (_event, _root: string) => importFbxDialog(ctx.win))
  // （C7）glTF 2.0 .gltf 导入：弹文件框读 JSON 原文（codec 在渲染层）
  ipcMain.handle(IpcChannels.MODELER_GLTF_IMPORT, (_event, _root: string) => importGltfDialog(ctx.win))
  // （B5-4）MC 皮肤导入：弹文件框读 PNG 像素串（文档组装在渲染层）
  ipcMain.handle(IpcChannels.MODELER_SKIN_IMPORT, (_event, _root: string) =>
    importSkinDialog(ctx.win)
  )
  // （B5-4）MC 皮肤导出：弹保存框把像素串编码为 PNG 落盘
  ipcMain.handle(
    IpcChannels.MODELER_SKIN_EXPORT,
    (_event, _root: string, input: ModelerSkinExportInput) => exportSkinDialog(ctx.win, input)
  )
  // （P5-open）工坊 java_block 文档导出 ModelAsset 写回方块/物品/实体（实体 geo→cube 需 confirm）
  ipcMain.handle(
    IpcChannels.MODELER_APPLY_MODEL_TO_OBJECT,
    (_event, root: string, docId: string, targetKind: 'block' | 'item' | 'entity', targetId: string, confirm?: boolean) => {
      assertString(root, 'root')
      assertString(docId, 'docId')
      assertString(targetKind, 'targetKind')
      assertString(targetId, 'targetId')
      if (confirm !== undefined && typeof confirm !== 'boolean') {
        throw new Error('非法参数：confirm')
      }
      return applyModelerModelToObject(root, docId, targetKind, targetId, confirm)
    }
  )
  // （D1）把已保存工坊文档直接编译落盘到资源包（产物落 assets/<modId>/）
  ipcMain.handle(IpcChannels.MODELER_COMPILE_RESOURCE, (_event, root: string, docId: string) => {
    assertString(root, 'root')
    assertString(docId, 'docId')
    return compileModelerDoc(root, docId)
  })
}
