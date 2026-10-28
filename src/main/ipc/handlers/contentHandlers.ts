import { dialog, ipcMain } from 'electron'
import {
  IpcChannels,
  type GalleryItemDto,
  type GallerySaveInputDto,
  type ModelApplyResponse,
  type ModelApplySourceRef,
  type ModelApplyTargetRef,
  type TextureApplyCandidateResponse,
  type TexturePaletteDto,
  type TexturePixelizeOptions,
  type TexturePixelizeRequest,
  type TexturePixelizeResponse,
  type TextureRepaintRequest,
  type TextureRepaintResponse
} from '../../../shared/types/ipc'
import {
  deleteContent,
  generateProjectContent,
  reverseSyncBlock,
  listContent,
  loadContent,
  saveContent,
  saveItemTexture,
  saveModelTexture,
  saveTextureAsset
} from '../../services/contentService'
import { importBbmodel, writeBbmodelAsset } from '../../services/bbmodelIo'
import { applyModelCandidate } from '../../services/modelApplyService'
import { importObjAsModel } from '../../services/objImport'
import { runContentDoctor } from '../../services/contentDoctor'
import { pixelizeDataUrl, pixelsToPngDataUrl, toPngDataUrl } from '../../services/ai/pixelize'
import { repaintTexture } from '../../services/ai/textureRepaint'
import { getTextureSource } from '../../services/ai/textureSourceCache'
import {
  DEFAULT_TEXTURE_PALETTE,
  readTexturePalette,
  writeTexturePalette
} from '../../services/ai/texturePaletteService'
import { deleteGalleryItem, listGalleryAll, saveGalleryItems } from '../../services/ai/galleryService'
import type { ContentDefinition, ContentKind, GenerateOptions, ModelAsset } from '../../../shared/types/content'
import type { IpcContext } from '../context'

/**
 * 白名单式拾取像素化参数：只接受允许的键，非法/越界值丢弃或夹取。
 * palette 仅保留合法 "#rrggbb"，非法项过滤后为空则视为未给（不锁定）。
 */
function sanitizePixelize(raw: unknown): TexturePixelizeOptions | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const out: TexturePixelizeOptions = {}
  if (typeof src.maxColors === 'number' && Number.isFinite(src.maxColors)) {
    out.maxColors = Math.max(2, Math.min(256, Math.round(src.maxColors)))
  }
  if (src.dither === 'floyd' || src.dither === 'none') out.dither = src.dither
  if (typeof src.outline === 'boolean') out.outline = src.outline
  if (typeof src.outlineFactor === 'number' && Number.isFinite(src.outlineFactor)) {
    out.outlineFactor = Math.max(0, Math.min(1, src.outlineFactor))
  }
  if (src.downsample === 'area' || src.downsample === 'nearest') out.downsample = src.downsample
  if (typeof src.alphaThreshold === 'number' && Number.isFinite(src.alphaThreshold)) {
    out.alphaThreshold = Math.max(0, Math.min(255, Math.round(src.alphaThreshold)))
  }
  if (Array.isArray(src.palette)) {
    const palette = src.palette.filter(
      (c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)
    )
    if (palette.length > 0) out.palette = palette
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 可视化编辑器内容资产（M4） */
export function registerContentHandlers(_ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.CONTENT_LIST, (_event, root: string) => listContent(root))
  ipcMain.handle(IpcChannels.CONTENT_LOAD, (_event, root: string, kind: string, id: string) =>
    loadContent(root, kind as ContentKind, id)
  )
  ipcMain.handle(IpcChannels.CONTENT_SAVE, (_event, root: string, def: unknown, prevId?: string) =>
    saveContent(root, def as ContentDefinition, prevId)
  )
  ipcMain.handle(IpcChannels.CONTENT_DELETE, (_event, root: string, kind: string, id: string) =>
    deleteContent(root, kind as ContentKind, id)
  )
  ipcMain.handle(
    IpcChannels.CONTENT_SAVE_TEXTURE,
    (_event, root: string, modelId: string, pixels: string[], size: 16 | 32) =>
      saveModelTexture(root, modelId, pixels, size)
  )
  ipcMain.handle(
    IpcChannels.CONTENT_SAVE_TEXTURE_ASSET,
    (
      _event,
      root: string,
      textureId: string,
      category: string,
      pixels: string[],
      width: number,
      height: number
    ) => saveTextureAsset(root, textureId, category, pixels, width, height)
  )
  ipcMain.handle(
    IpcChannels.CONTENT_GENERATE,
    (_event, root: string, options?: GenerateOptions) => generateProjectContent(root, options)
  )
  ipcMain.handle(
    IpcChannels.CONTENT_REVERSE_SYNC,
    (_event, root: string, id: string) => reverseSyncBlock(root, id)
  )

  // 建模工坊：Blockbench .bbmodel 导入/导出（文件对话框在主进程弹出）
  ipcMain.handle(
    IpcChannels.CONTENT_BBMODEL_IMPORT,
    async (_event, root: string, explicitId?: string) => {
      const picked = await dialog.showOpenDialog({
        title: '导入 Blockbench 模型',
        filters: [{ name: 'Blockbench 模型', extensions: ['bbmodel'] }, { name: '所有文件', extensions: ['*'] }],
        properties: ['openFile']
      })
      if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
      try {
        const res = importBbmodel(root, picked.filePaths[0], explicitId)
        return { canceled: false, ...res }
      } catch (err) {
        return { canceled: false, error: (err as Error).message }
      }
    }
  )
  ipcMain.handle(
    IpcChannels.CONTENT_BBMODEL_EXPORT,
    async (_event, _root: string, model: unknown) => {
      if (!model || typeof model !== 'object') {
        return { canceled: false, error: '缺少模型数据' }
      }
      const asset = model as ContentDefinition
      if (asset.kind !== 'model') return { canceled: false, error: '数据不是模型资产' }
      const picked = await dialog.showSaveDialog({
        title: '导出 Blockbench 模型',
        defaultPath: `${asset.id}.bbmodel`,
        filters: [{ name: 'Blockbench 模型', extensions: ['bbmodel'] }]
      })
      if (picked.canceled || !picked.filePath) return { canceled: true }
      try {
        const res = writeBbmodelAsset(asset as ModelAsset, picked.filePath)
        return { canceled: false, ...res }
      } catch (err) {
        return { canceled: false, error: (err as Error).message }
      }
    }
  )

  // 建模工坊 B2：OBJ 体素化导入（自动读取同目录 .mtl）
  ipcMain.handle(
    IpcChannels.CONTENT_OBJ_IMPORT,
    async (_event, root: string, id: string, resolution?: number) => {
      if (typeof id !== 'string' || !id.trim()) {
        return { canceled: false, error: '缺少模型 id（请先在工坊中打开对象）' }
      }
      const picked = await dialog.showOpenDialog({
        title: '导入 OBJ 体素模型',
        filters: [{ name: 'Wavefront OBJ', extensions: ['obj'] }, { name: '所有文件', extensions: ['*'] }],
        properties: ['openFile']
      })
      if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
      try {
        const res = importObjAsModel(root, picked.filePaths[0], id, {
          resolution: typeof resolution === 'number' ? resolution : undefined
        })
        return {
          canceled: false,
          model: res.model,
          warnings: res.warnings,
          mtlLoaded: res.mtlLoaded
        }
      } catch (err) {
        return { canceled: false, error: (err as Error).message }
      }
    }
  )

  // 贴图工坊 AI 重绘：渲染进程只送像素与 prompt，Key/供应商全在主进程侧（用户自带额度）
  ipcMain.handle(
    IpcChannels.CONTENT_TEXTURE_REPAINT,
    async (_event, raw: unknown): Promise<TextureRepaintResponse> => {
      const req = raw as Partial<TextureRepaintRequest> | null
      if (!req || typeof req !== 'object') {
        return { ok: false, errorKind: 'config', errorMessage: '重绘请求格式不正确' }
      }
      const size = req.size === 32 ? 32 : 16
      const pixels = Array.isArray(req.pixels) ? (req.pixels as string[]) : []
      if (pixels.length !== size * size) {
        return { ok: false, errorKind: 'config', errorMessage: `贴图像素数量必须是 ${size * size}，实际 ${pixels.length}` }
      }
      const prompt = typeof req.prompt === 'string' ? req.prompt : ''
      if (!prompt.trim()) {
        return { ok: false, errorKind: 'config', errorMessage: '请填写想把贴图改成什么样（中文即可）' }
      }
      const n = Math.max(1, Math.min(10, Math.floor(Number(req.n) || 1)))
      // 局部蒙版：长度不对就按整图重绘处理，避免 UI 状态错位导致半张图
      let maskFlags: boolean[] | undefined
      if (Array.isArray(req.maskFlags) && req.maskFlags.length === size * size) {
        const flags = req.maskFlags.map(Boolean)
        if (flags.some(Boolean)) maskFlags = flags
      }
      try {
        const outcome = await repaintTexture({
          sourceDataUrl: pixelsToPngDataUrl(size, pixels),
          prompt,
          size,
          n,
          maskFlags,
          providerId: typeof req.providerId === 'string' ? req.providerId : undefined,
          pixelize: sanitizePixelize(req.pixelize)
        })
        if (!outcome.ok) return { ok: false, errorKind: outcome.errorKind, errorMessage: outcome.errorMessage }
        return {
          ok: true,
          size: outcome.data.size,
          model: outcome.data.model,
          warnings: outcome.data.warnings,
          variants: outcome.data.variants.map((v) => ({
            pixels: v.pixels,
            dataUrl: v.dataUrl,
            palette: v.palette,
            ascii: v.ascii,
            ...(v.revisedPrompt ? { revisedPrompt: v.revisedPrompt } : {}),
            ...(v.sourceToken ? { sourceToken: v.sourceToken } : {})
          }))
        }
      } catch (err) {
        return { ok: false, errorKind: 'server', errorMessage: `AI 重绘异常：${(err as Error).message}` }
      }
    }
  )

  // 贴图工坊 · 本地重跑：用候选 sourceToken 取回主进程缓存的 AI 大图重新像素化（不消耗 AI 额度）
  ipcMain.handle(
    IpcChannels.CONTENT_TEXTURE_PIXELIZE,
    async (_event, raw: unknown): Promise<TexturePixelizeResponse> => {
      const req = raw as Partial<TexturePixelizeRequest> | null
      if (!req || typeof req !== 'object' || typeof req.sourceToken !== 'string') {
        return { ok: false, errorKind: 'config', errorMessage: '重跑请求格式不正确' }
      }
      const source = getTextureSource(req.sourceToken)
      if (!source) {
        return { ok: false, errorKind: 'config', errorMessage: '源图已过期，请重新生成候选' }
      }
      // size 非法一律按 16 处理（对齐既有 repaint 分支写法）
      const size = req.size === 32 ? 32 : 16
      try {
        const result = pixelizeDataUrl(source, { size, ...sanitizePixelize(req.options) })
        return {
          ok: true,
          size,
          variant: {
            pixels: result.pixels,
            dataUrl: toPngDataUrl(result),
            palette: result.palette,
            ascii: result.ascii
          }
        }
      } catch (err) {
        return { ok: false, errorKind: 'server', errorMessage: `像素化失败：${(err as Error).message}` }
      }
    }
  )

  // 贴图工坊 · 项目级色板锁定：读取/合并写入（.kunyu/texture-palette.json）
  ipcMain.handle(
    IpcChannels.CONTENT_TEXTURE_PALETTE_GET,
    (_event, root: unknown): TexturePaletteDto =>
      typeof root === 'string' && root.trim()
        ? readTexturePalette(root)
        : { ...DEFAULT_TEXTURE_PALETTE }
  )
  ipcMain.handle(
    IpcChannels.CONTENT_TEXTURE_PALETTE_SET,
    (_event, root: unknown, patch: unknown): TexturePaletteDto =>
      typeof root === 'string' && root.trim()
        ? writeTexturePalette(
            root,
            (patch && typeof patch === 'object' ? patch : {}) as Partial<TexturePaletteDto>
          )
        : { ...DEFAULT_TEXTURE_PALETTE }
  )

  // 贴图工坊 · 采用候选：把 AI 候选像素写回 item/block/model 资产（聊天「产物」卡点选候选）
  ipcMain.handle(
    IpcChannels.CONTENT_TEXTURE_APPLY_CANDIDATE,
    async (
      _event,
      root: unknown,
      kind: unknown,
      id: unknown,
      pixels: unknown,
      size: unknown
    ): Promise<TextureApplyCandidateResponse> => {
      if (typeof root !== 'string' || !root.trim()) {
        return { ok: false, errorMessage: '缺少项目根路径' }
      }
      const k =
        kind === 'model' ? 'model' : kind === 'item' ? 'item' : kind === 'block' ? 'block' : null
      if (!k || typeof id !== 'string' || !id.trim()) {
        return { ok: false, errorMessage: '资产类型或 id 不合法' }
      }
      const px = Array.isArray(pixels)
        ? pixels.filter((c): c is string => typeof c === 'string')
        : []
      const sz: 16 | 32 = size === 32 ? 32 : 16
      // 方块贴图的语义契约是 16×16（BlockTexture.pixels 固定 256 项），32 画布不接受
      if (k === 'block' && sz !== 16) {
        return { ok: false, errorMessage: '方块贴图仅支持 16×16 画布，请改用 16 尺寸的候选' }
      }
      if (px.length !== sz * sz) {
        return { ok: false, errorMessage: `像素数据长度必须为 ${sz * sz}` }
      }
      try {
        const def = loadContent(root, k, id)
        if (k === 'model') {
          if (def.kind !== 'model') return { ok: false, errorMessage: `${id} 不是 model 类型` }
          def.textureSize = sz
          def.pixels = px
          saveContent(root, def)
          return { ok: true, relPath: saveModelTexture(root, id, px, sz), pngWritten: true, size: sz }
        }
        // item / block 同规则：像素都住在 texture.pixels 里；自带贴图路径时 PNG 交由生成阶段处理
        if (def.kind !== 'item' && def.kind !== 'block') {
          return { ok: false, errorMessage: `${id} 不是 ${k} 类型` }
        }
        def.texture = { ...def.texture, pixels: px }
        saveContent(root, def)
        if (def.texture.path) {
          return { ok: true, relPath: def.texture.path, pngWritten: false, size: sz }
        }
        return {
          ok: true,
          relPath:
            k === 'item'
              ? saveItemTexture(root, id, px)
              : saveTextureAsset(root, id, 'block', px, sz, sz),
          pngWritten: true,
          size: sz
        }
      } catch (err) {
        return { ok: false, errorMessage: `写回资产失败：${(err as Error).message}` }
      }
    }
  )

  // 画廊模型条目 · 写回目标对象：落独立模型资产 + 绑定 cubeModelId（实体骨骼模型需 confirm 二次确认）
  ipcMain.handle(
    IpcChannels.CONTENT_MODEL_APPLY_CANDIDATE,
    (
      _event,
      sourceRoot: unknown,
      source: unknown,
      targetRoot: unknown,
      target: unknown,
      confirm: unknown
    ): ModelApplyResponse => {
      if (typeof sourceRoot !== 'string' || typeof targetRoot !== 'string') {
        return { ok: false, errorMessage: '缺少项目根路径' }
      }
      if (!source || typeof source !== 'object' || !target || typeof target !== 'object') {
        return { ok: false, errorMessage: '来源或目标对象信息不合法' }
      }
      return applyModelCandidate(
        sourceRoot,
        source as ModelApplySourceRef,
        targetRoot,
        target as ModelApplyTargetRef,
        confirm === true
      )
    }
  )

  // 画廊：列出 / 入库 / 删除（.kunyu/gallery/，AI 出图即存档、永不自动删除）
  // 列表 = 归档候选 + 项目已有像素资产（后者读时虚拟汇总，供画廊展示既有的画，不落盘）
  ipcMain.handle(IpcChannels.CONTENT_GALLERY_LIST, (_event, root: unknown): GalleryItemDto[] =>
    typeof root === 'string' && root.trim() ? listGalleryAll(root) : []
  )
  ipcMain.handle(
    IpcChannels.CONTENT_GALLERY_SAVE,
    (_event, root: unknown, items: unknown): GalleryItemDto[] =>
      typeof root === 'string' && root.trim() && Array.isArray(items)
        ? saveGalleryItems(root, items as GallerySaveInputDto[])
        : []
  )
  ipcMain.handle(
    IpcChannels.CONTENT_GALLERY_DELETE,
    (_event, root: unknown, id: unknown): boolean =>
      typeof root === 'string' && root.trim() && typeof id === 'string'
        ? deleteGalleryItem(root, id)
        : false
  )

  // 内容资源体检：只读检查跨对象/跨文件引用一致性
  ipcMain.handle(IpcChannels.CONTENT_DOCTOR, async (_event, root: unknown) => {
    if (typeof root !== 'string' || !root.trim()) {
      return { ok: false, issues: [], objectCount: 0, errorCount: 0, warningCount: 0, error: '缺少项目根路径' }
    }
    return runContentDoctor(root)
  })
}
