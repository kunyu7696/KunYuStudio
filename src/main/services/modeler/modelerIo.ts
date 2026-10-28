/**
 * 模型工坊文件 IO（方案 §4.1 modelerIo.ts）：PNG 贴图导入/导出。
 *
 * 职责边界：
 * - textureFromPngBuffer 为纯函数（pngjs 解码 + 尺寸校验），可直接 vitest；
 * - importTexturePngDialog / exportTexturePngDialog 负责 Electron 对话框与落盘，
 *   由 modelerHandlers 接线，渲染层不接触文件路径细节。
 * 约束：贴图单边 ≤512（方案 §5 贴图行 ✔（≤512））；导入不缩放原图，
 * 超尺寸直接报错让用户自行处理，避免静默降采样丢失像素。
 */
import { dialog, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type {
  ModelerAnimExportInput,
  ModelerAnimExportResult,
  ModelerAnimImportResult,
  ModelerBbmodelExportInput,
  ModelerBbmodelImportResult,
  ModelerGltfExportInput,
  ModelerObjExportInput,
  ModelerObjImportResult,
  ModelerSkinExportInput,
  ModelerSkinExportResult,
  ModelerSkinImportResult,
  ModelerTextModelImportResult,
  ModelerTextureExportInput,
  ModelerTextureExportResult,
  ModelerTextureImportResult
} from '../../../shared/types/ipc'
import { dataUrlToPngBuffer, decodePng, encodePng } from '../ai/pixelize'
import { formatPixel, parsePixel } from '../../../shared/utils/pixelColor'
import { findMtlReference } from '../objImport'

/** 贴图单边上限（与渲染层新建贴图尺寸选择一致） */
export const MODELER_TEXTURE_MAX_SIZE = 512

export interface ParsedTexturePng {
  width: number
  height: number
  dataUrl: string
}

/**
 * 解析 PNG 缓冲区为贴图数据（纯函数）。
 * 非法 PNG / 超尺寸 / 空图抛错，由调用方包装为 error 结果。
 */
export function textureFromPngBuffer(buf: Buffer): ParsedTexturePng {
  if (buf.length === 0) throw new Error('文件为空')
  const raster = decodePng(buf) // 非法 PNG 由 pngjs 抛错
  const { width, height } = raster
  if (width < 1 || height < 1) throw new Error('PNG 尺寸异常')
  if (width > MODELER_TEXTURE_MAX_SIZE || height > MODELER_TEXTURE_MAX_SIZE) {
    throw new Error(
      `贴图尺寸 ${width}×${height} 超出上限 ${MODELER_TEXTURE_MAX_SIZE}，请先缩小再导入`
    )
  }
  return { width, height, dataUrl: `data:image/png;base64,${buf.toString('base64')}` }
}

/** 弹文件框导入 PNG 为文档贴图（canceled=true = 用户取消） */
export async function importTexturePngDialog(
  win: BrowserWindow
): Promise<ModelerTextureImportResult> {
  const picked = await dialog.showOpenDialog(win, {
    title: '导入 PNG 贴图',
    filters: [
      { name: 'PNG 图片', extensions: ['png'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
  const filePath = picked.filePaths[0]!
  try {
    const parsed = textureFromPngBuffer(readFileSync(filePath))
    return {
      canceled: false,
      name: basename(filePath).replace(/\.png$/i, ''),
      ...parsed
    }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/** 文件名清洗：去掉 OS 不允许的字符，空名回退 texture */
function safeFileName(raw: string): string {
  const cleaned = raw.replace(/[\\/:*?"<>|]/g, '_').trim()
  return cleaned || 'texture'
}

/** 弹保存框把贴图 data URL 落盘为 PNG（canceled=true = 用户取消） */
export async function exportTexturePngDialog(
  win: BrowserWindow,
  input: ModelerTextureExportInput
): Promise<ModelerTextureExportResult> {
  if (!input || typeof input.dataUrl !== 'string' || !input.dataUrl.startsWith('data:image/png')) {
    return { canceled: false, error: '贴图数据不是 PNG data URL' }
  }
  const picked = await dialog.showSaveDialog(win, {
    title: '导出 PNG 贴图',
    defaultPath: `${safeFileName(input.name)}.png`,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }]
  })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  try {
    const buf = dataUrlToPngBuffer(input.dataUrl)
    writeFileSync(picked.filePath, buf)
    return { canceled: false, path: picked.filePath, bytes: buf.length }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/* ------------------------------------------------------------------ */
/* .animation.json 导入/导出（P4）：主进程只做对话框与文件读写，            */
/* 编解码在渲染层 shared/modeler/formats/bedrockAnim 完成。               */
/* ------------------------------------------------------------------ */

/** 动画文件大小上限（防误选超大 JSON 卡死渲染层，2MB 足够数千关键帧） */
const ANIM_JSON_MAX_BYTES = 2 * 1024 * 1024

/** 弹文件框导入 .animation.json（canceled=true = 用户取消） */
export async function importAnimationsDialog(
  win: BrowserWindow
): Promise<ModelerAnimImportResult> {
  const picked = await dialog.showOpenDialog(win, {
    title: '导入动画（.animation.json）',
    filters: [
      { name: 'Bedrock 动画', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
  const filePath = picked.filePaths[0]!
  try {
    const content = readFileSync(filePath, 'utf8')
    if (content.length > ANIM_JSON_MAX_BYTES) {
      return { canceled: false, error: '文件超过 2MB 上限，不是有效的动画文件' }
    }
    return {
      canceled: false,
      name: basename(filePath).replace(/\.animation\.json$|\.json$/i, ''),
      content
    }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/** 弹保存框把动画 JSON 文本落盘为 .animation.json（canceled=true = 用户取消） */
export async function exportAnimationsDialog(
  win: BrowserWindow,
  input: ModelerAnimExportInput
): Promise<ModelerAnimExportResult> {
  if (!input || typeof input.content !== 'string' || input.content.length === 0) {
    return { canceled: false, error: '动画内容为空' }
  }
  const picked = await dialog.showSaveDialog(win, {
    title: '导出动画（.animation.json）',
    defaultPath: `${safeFileName(input.name)}.animation.json`,
    filters: [{ name: 'Bedrock 动画', extensions: ['json'] }]
  })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  try {
    writeFileSync(picked.filePath, input.content, 'utf8')
    return { canceled: false, path: picked.filePath, bytes: Buffer.byteLength(input.content) }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/* ------------------------------------------------------------------ */
/* 控制器导入/导出（B5-2）：主进程只做对话框与文件读写，                    */
/* 编解码在渲染层 shared/modeler/formats/bedrockController 完成。          */
/* ------------------------------------------------------------------ */

/** 弹文件框读 .animation_controllers.json 原文（canceled=true = 用户取消） */
export async function importControllerDialog(
  win: BrowserWindow
): Promise<ModelerAnimImportResult> {
  const picked = await dialog.showOpenDialog(win, {
    title: '导入动画控制器（.animation_controllers.json）',
    filters: [
      { name: 'Bedrock 动画控制器', extensions: ['json'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
  const filePath = picked.filePaths[0]!
  try {
    const content = readFileSync(filePath, 'utf8')
    if (content.length > ANIM_JSON_MAX_BYTES) {
      return { canceled: false, error: '文件超过 2MB 上限，不是有效的控制器文件' }
    }
    return {
      canceled: false,
      name: basename(filePath).replace(/\.animation_controllers\.json$|\.json$/i, ''),
      content
    }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/** 弹保存框把控制器 JSON 文本落盘为 .animation_controllers.json（canceled=true = 用户取消） */
export async function exportControllerDialog(
  win: BrowserWindow,
  input: ModelerAnimExportInput
): Promise<ModelerAnimExportResult> {
  if (!input || typeof input.content !== 'string' || input.content.length === 0) {
    return { canceled: false, error: '控制器内容为空' }
  }
  const picked = await dialog.showSaveDialog(win, {
    title: '导出动画控制器（.animation_controllers.json）',
    defaultPath: `${safeFileName(input.name)}.animation_controllers.json`,
    filters: [{ name: 'Bedrock 动画控制器', extensions: ['json'] }]
  })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  try {
    writeFileSync(picked.filePath, input.content, 'utf8')
    return { canceled: false, path: picked.filePath, bytes: Buffer.byteLength(input.content) }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/* ------------------------------------------------------------------ */
/* OptiFine JEM/JPM 导入/导出（B5-3）：主进程只做对话框与文件读写，          */
/* 编解码在渲染层 shared/modeler/formats/optifine 完成。                  */
/* ------------------------------------------------------------------ */

/** 弹文件框读 OptiFine .jem/.jpm 原文（canceled=true = 用户取消） */
async function importOptifineDialog(
  win: BrowserWindow,
  kind: 'jem' | 'jpm'
): Promise<ModelerAnimImportResult> {
  const upper = kind.toUpperCase()
  const picked = await dialog.showOpenDialog(win, {
    title: `导入 OptiFine ${upper} 模型（.${kind}）`,
    filters: [
      { name: `OptiFine ${upper} 模型`, extensions: [kind] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
  const filePath = picked.filePaths[0]!
  try {
    const content = readFileSync(filePath, 'utf8')
    if (content.length > ANIM_JSON_MAX_BYTES) {
      return { canceled: false, error: `文件超过 2MB 上限，不是有效的 .${kind} 文件` }
    }
    const raw = basename(filePath).replace(new RegExp(`\\.${kind}$`, 'i'), '')
    return { canceled: false, name: raw, content }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/** 弹保存框把 OptiFine .jem/.jpm 文本落盘（canceled=true = 用户取消） */
async function exportOptifineDialog(
  win: BrowserWindow,
  kind: 'jem' | 'jpm',
  input: ModelerAnimExportInput
): Promise<ModelerAnimExportResult> {
  const upper = kind.toUpperCase()
  if (!input || typeof input.content !== 'string' || input.content.length === 0) {
    return { canceled: false, error: `${upper} 内容为空` }
  }
  const picked = await dialog.showSaveDialog(win, {
    title: `导出 OptiFine ${upper} 模型（.${kind}）`,
    defaultPath: `${safeFileName(input.name)}.${kind}`,
    filters: [{ name: `OptiFine ${upper} 模型`, extensions: [kind] }]
  })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  try {
    writeFileSync(picked.filePath, input.content, 'utf8')
    return { canceled: false, path: picked.filePath, bytes: Buffer.byteLength(input.content) }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/** 导入 .jem 整实体模型原文 */
export function importJemDialog(win: BrowserWindow): Promise<ModelerAnimImportResult> {
  return importOptifineDialog(win, 'jem')
}

/** 导出 .jem 整实体模型文本 */
export function exportJemDialog(
  win: BrowserWindow,
  input: ModelerAnimExportInput
): Promise<ModelerAnimExportResult> {
  return exportOptifineDialog(win, 'jem', input)
}

/** 导入 .jpm 部件原文 */
export function importJpmDialog(win: BrowserWindow): Promise<ModelerAnimImportResult> {
  return importOptifineDialog(win, 'jpm')
}

/** 导出 .jpm 部件文本 */
export function exportJpmDialog(
  win: BrowserWindow,
  input: ModelerAnimExportInput
): Promise<ModelerAnimExportResult> {
  return exportOptifineDialog(win, 'jpm', input)
}

/* ------------------------------------------------------------------ */
/* .bbmodel 导入/导出（P5-bbmodel）：主进程只做对话框与文件读写，           */
/* 编解码在渲染层 shared/modeler/formats/bbmodel 完成。                  */
/* ------------------------------------------------------------------ */

/** bbmodel 文件大小上限（内嵌 base64 贴图，32MB 足够 512² 多贴图工程） */
const BBMODEL_MAX_BYTES = 32 * 1024 * 1024

/* 独立 PNG 引用（textures[].path ↔ ModelTexture.file）的导入解引用与导出物化。    */
/* 渲染层 codec 只认内嵌 data URL，文件读写全部收在本模块（主进程唯一 fs 边界）。   */

/**
 * 校验贴图引用路径：仅接受相对 POSIX 路径（拒绝绝对路径/盘符/.. 逃逸），
 * 返回规范化后的相对路径；非法返回 null。
 */
export function safeTextureRelPath(file: string): string | null {
  const norm = file.replace(/\\/g, '/').trim()
  if (!norm || norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return null
  const parts = norm.split('/').filter((p) => p !== '' && p !== '.')
  if (parts.length === 0 || parts.some((p) => p === '..')) return null
  return parts.join('/')
}

/** 透明 PNG 替身（外链贴图读不到时保证文档像素链可用，尺寸夹取 1..4096） */
function blankPngDataUrl(width: number, height: number): { dataUrl: string; width: number; height: number } {
  const w = Number.isFinite(width) && width >= 1 ? Math.min(Math.floor(width), 4096) : 16
  const h = Number.isFinite(height) && height >= 1 ? Math.min(Math.floor(height), 4096) : 16
  const buf = encodePng({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })
  return { dataUrl: `data:image/png;base64,${buf.toString('base64')}`, width: w, height: h }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * .bbmodel 外链贴图解引用（纯函数）：textures[] 中带 path 且 origin 未内嵌的条目，
 * 按「相对 .bbmodel 所在目录」解析读盘填入 data URL（缺失尺寸一并补齐）；
 * 读不到的条目替换为同尺寸透明 PNG 并记告警（保证文档像素链完整可用）。
 * JSON 解析失败原样返回（格式错误由渲染层 codec 报更友好的错）。
 */
export function resolveBbmodelLinkedTextures(
  content: string,
  bbmodelDir: string
): { content: string; warnings: string[] } {
  const warnings: string[] = []
  let data: unknown
  try {
    data = JSON.parse(content)
  } catch {
    return { content, warnings }
  }
  if (!isRecord(data) || !Array.isArray(data.textures)) return { content, warnings }
  let touched = false
  for (const raw of data.textures) {
    if (!isRecord(raw)) continue
    const p = typeof raw.path === 'string' ? raw.path.trim() : ''
    if (!p) continue
    if (typeof raw.origin === 'string' && raw.origin.startsWith('data:')) continue
    touched = true
    const label = typeof raw.name === 'string' && raw.name ? raw.name : p
    try {
      const buf = readFileSync(resolve(bbmodelDir, p))
      const raster = decodePng(buf) // 顺带校验确实是 PNG
      raw.origin = `data:image/png;base64,${buf.toString('base64')}`
      if (!(typeof raw.width === 'number' && raw.width >= 1)) raw.width = raster.width
      if (!(typeof raw.height === 'number' && raw.height >= 1)) raw.height = raster.height
    } catch {
      const blank = blankPngDataUrl(
        typeof raw.width === 'number' ? raw.width : NaN,
        typeof raw.height === 'number' ? raw.height : NaN
      )
      raw.origin = blank.dataUrl
      raw.width = blank.width
      raw.height = blank.height
      warnings.push(`贴图「${label}」引用的外部文件「${p}」读取失败，已用空白贴图替代`)
    }
  }
  return touched ? { content: JSON.stringify(data), warnings } : { content, warnings }
}

export interface BbmodelLinkedTextureInput {
  /** 独立 PNG 引用（相对 .bbmodel 的 POSIX 路径） */
  file: string
  /** 贴图像素 data URL（文档内嵌态，物化时解码落盘） */
  data: string
  name: string
}

/**
 * 导出落地：把带独立 PNG 引用的贴图物化到 .bbmodel 所在目录（随格式导出落地）。
 * 路径越界（绝对/.. 逃逸）或写盘失败逐条记告警不中断，返回落地数量与告警。
 */
export function materializeBbmodelTextures(
  bbmodelFile: string,
  textures: readonly BbmodelLinkedTextureInput[]
): { written: number; warnings: string[] } {
  const warnings: string[] = []
  let written = 0
  const dir = dirname(bbmodelFile)
  for (const tex of textures) {
    const rel = safeTextureRelPath(tex.file)
    if (!rel) {
      warnings.push(`贴图「${tex.name}」的引用路径「${tex.file}」越界（仅支持相对路径），未落地`)
      continue
    }
    const dest = resolve(dir, ...rel.split('/'))
    if (dest !== dir && !dest.startsWith(dir + sep)) {
      warnings.push(`贴图「${tex.name}」的引用路径「${tex.file}」越界（仅支持相对路径），未落地`)
      continue
    }
    try {
      const buf = dataUrlToPngBuffer(tex.data)
      if (!existsSync(dirname(dest))) mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, buf)
      written++
    } catch (err) {
      warnings.push(`贴图「${tex.name}」落地失败（${tex.file}）：${(err as Error).message}`)
    }
  }
  return { written, warnings }
}

/** 弹文件框导入 .bbmodel（canceled=true = 用户取消；外链贴图已在主进程解引用） */
export async function importBbmodelDialog(
  win: BrowserWindow
): Promise<ModelerBbmodelImportResult> {
  const picked = await dialog.showOpenDialog(win, {
    title: '导入 Blockbench 工程（.bbmodel）',
    filters: [
      { name: 'Blockbench 工程', extensions: ['bbmodel'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
  const filePath = picked.filePaths[0]!
  try {
    const raw = readFileSync(filePath, 'utf8')
    if (raw.length > BBMODEL_MAX_BYTES) {
      return { canceled: false, error: '文件超过 32MB 上限，不是有效的 .bbmodel 工程' }
    }
    const { content, warnings } = resolveBbmodelLinkedTextures(raw, dirname(filePath))
    return {
      canceled: false,
      name: basename(filePath).replace(/\.bbmodel$/i, ''),
      content,
      ...(warnings.length > 0 ? { warnings } : {})
    }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/** 弹保存框把 bbmodel JSON 文本落盘为 .bbmodel；带引用的贴图同步物化 PNG（canceled=true = 用户取消） */
export async function exportBbmodelDialog(
  win: BrowserWindow,
  input: ModelerBbmodelExportInput
): Promise<ModelerAnimExportResult> {
  if (!input || typeof input.content !== 'string' || input.content.length === 0) {
    return { canceled: false, error: '导出内容为空' }
  }
  const picked = await dialog.showSaveDialog(win, {
    title: '导出 Blockbench 工程（.bbmodel）',
    defaultPath: `${safeFileName(input.name)}.bbmodel`,
    filters: [{ name: 'Blockbench 工程', extensions: ['bbmodel'] }]
  })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  try {
    writeFileSync(picked.filePath, input.content, 'utf8')
    let texturesWritten: number | undefined
    let warnings: string[] | undefined
    if (Array.isArray(input.textures) && input.textures.length > 0) {
      const r = materializeBbmodelTextures(picked.filePath, input.textures)
      if (r.written > 0) texturesWritten = r.written
      if (r.warnings.length > 0) warnings = r.warnings
    }
    return {
      canceled: false,
      path: picked.filePath,
      bytes: Buffer.byteLength(input.content),
      ...(texturesWritten !== undefined ? { texturesWritten } : {}),
      ...(warnings ? { warnings } : {})
    }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/* ------------------------------------------------------------------ */
/* glTF 导出（B5-1）：主进程只做对话框与落盘（.gltf + .bin + PNG 贴图）， */
/* 编解码在渲染层 shared/modeler/formats/gltf 完成。                      */
/* ------------------------------------------------------------------ */

/**
 * 弹保存框把 glTF JSON + BIN 落盘为 .gltf/.bin，并把贴图物化为同目录 PNG。
 * buffers[0].uri 由渲染层留空，此处回填为 <主文件名>.bin（glTF 规范相对引用）。
 */
export async function exportGltfDialog(
  win: BrowserWindow,
  input: ModelerGltfExportInput
): Promise<ModelerAnimExportResult> {
  if (!input || typeof input.gltf !== 'string' || input.gltf.length === 0) {
    return { canceled: false, error: '导出内容为空' }
  }
  if (!(input.bin instanceof Uint8Array)) {
    return { canceled: false, error: 'BIN 缓冲缺失' }
  }
  const picked = await dialog.showSaveDialog(win, {
    title: '导出 glTF 2.0（.gltf）',
    defaultPath: `${safeFileName(input.name)}.gltf`,
    filters: [{ name: 'glTF 模型', extensions: ['gltf'] }]
  })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  try {
    const gltfPath = picked.filePath
    const binName = `${basename(gltfPath).replace(/\.gltf$/i, '')}.bin`
    const parsed = JSON.parse(input.gltf) as { buffers?: Array<Record<string, unknown>> }
    if (!Array.isArray(parsed.buffers) || parsed.buffers.length !== 1) {
      return { canceled: false, error: 'glTF JSON 结构非法：buffers 缺失' }
    }
    parsed.buffers[0]!.uri = binName
    const content = JSON.stringify(parsed, null, 2)
    writeFileSync(gltfPath, content, 'utf8')
    writeFileSync(join(dirname(gltfPath), binName), Buffer.from(input.bin))
    let texturesWritten: number | undefined
    let warnings: string[] | undefined
    if (Array.isArray(input.images) && input.images.length > 0) {
      const warn: string[] = []
      let written = 0
      const dir = dirname(gltfPath)
      for (const img of input.images) {
        const name = safeFileName(img.name)
        try {
          const buf = dataUrlToPngBuffer(img.data)
          writeFileSync(join(dir, name), buf)
          written++
        } catch (err) {
          warn.push(`贴图「${img.name}」落地失败：${(err as Error).message}`)
        }
      }
      if (written > 0) texturesWritten = written
      if (warn.length > 0) warnings = warn
    }
    return {
      canceled: false,
      path: gltfPath,
      bytes: Buffer.byteLength(content) + input.bin.length,
      ...(texturesWritten !== undefined ? { texturesWritten } : {}),
      ...(warnings ? { warnings } : {})
    }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/* ------------------------------------------------------------------ */
/* OBJ 导入（P5-obj）：主进程只做对话框与文件读写（.obj + 同目录 .mtl），  */
/* 体素化与文档组装在渲染层 shared/modeler/formats/obj 完成。             */
/* ------------------------------------------------------------------ */

/** OBJ 文件大小上限（16MB 足够数十万三角形） */
const OBJ_MAX_BYTES = 16 * 1024 * 1024

/** 弹文件框导入 .obj（canceled=true = 用户取消；.mtl 找不到不报错，走兜底色） */
export async function importObjDialog(win: BrowserWindow): Promise<ModelerObjImportResult> {
  const picked = await dialog.showOpenDialog(win, {
    title: '导入 OBJ 模型（.obj）',
    filters: [
      { name: 'OBJ 模型', extensions: ['obj'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
  const filePath = picked.filePaths[0]!
  try {
    const content = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
    if (content.length > OBJ_MAX_BYTES) {
      return { canceled: false, error: '文件超过 16MB 上限，不是有效的 OBJ 模型' }
    }
    /* 材质：mtllib 同目录引用优先，同名 .mtl 兜底（与旧内容管线 objImport 同策略） */
    let mtlContent: string | undefined
    const mtlName = findMtlReference(content)
    const candidates = mtlName ? [join(dirname(filePath), basename(mtlName))] : []
    candidates.push(filePath.replace(/\.obj$/i, '.mtl'))
    for (const candidate of candidates) {
      try {
        mtlContent = readFileSync(candidate, 'utf8')
        break
      } catch {
        /* 试下一个候选 */
      }
    }
    return {
      canceled: false,
      name: basename(filePath).replace(/\.obj$/i, ''),
      content,
      ...(mtlContent !== undefined ? { mtlContent } : {})
    }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/* ------------------------------------------------------------------ */
/* 文本网格模型导入（C5：Collada .dae / ASCII FBX .fbx）：主进程只做对话框 */
/* 与文件读取，XML/ASCII 解析与文档组装在渲染层 shared codec 完成。        */
/* ------------------------------------------------------------------ */

/** DAE/FBX 文件大小上限（32MB；ASCII FBX 与 Collada 均可能较大） */
const MESH_TEXT_MAX_BYTES = 32 * 1024 * 1024

/** 弹文件框导入 .dae / .fbx / .gltf 文本网格模型（canceled=true = 用户取消） */
async function importMeshTextDialog(
  win: BrowserWindow,
  kind: 'dae' | 'fbx' | 'gltf'
): Promise<ModelerTextModelImportResult> {
  const label = kind === 'dae' ? 'Collada 模型' : kind === 'fbx' ? 'FBX 模型' : 'glTF 模型'
  const picked = await dialog.showOpenDialog(win, {
    title: `导入 ${label}（.${kind}）`,
    filters: [
      { name: label, extensions: [kind] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
  const filePath = picked.filePaths[0]!
  try {
    const content = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
    if (content.length > MESH_TEXT_MAX_BYTES) {
      return { canceled: false, error: `文件超过 32MB 上限，不是有效的 ${label}` }
    }
    return {
      canceled: false,
      name: basename(filePath).replace(new RegExp(`\\.${kind}$`, 'i'), ''),
      content
    }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/** 导入 Collada .dae 原文（解析在渲染层 codec） */
export function importDaeDialog(win: BrowserWindow): Promise<ModelerTextModelImportResult> {
  return importMeshTextDialog(win, 'dae')
}

/** 导入 ASCII FBX .fbx 原文（解析在渲染层 codec） */
export function importFbxDialog(win: BrowserWindow): Promise<ModelerTextModelImportResult> {
  return importMeshTextDialog(win, 'fbx')
}

/** 导入 glTF 2.0 .gltf JSON 原文（解析在渲染层 codec；嵌入式 base64 buffer 自带在 JSON 里） */
export function importGltfDialog(win: BrowserWindow): Promise<ModelerTextModelImportResult> {
  return importMeshTextDialog(win, 'gltf')
}

/* ------------------------------------------------------------------ */
/* Bedrock geo.json 导入/导出（C9）：Entity / Block / GeckoLib 共用    */
/* 编解码在渲染层 shared/modeler/formats/bedrock.ts 完成。            */
/* ------------------------------------------------------------------ */

/** 弹文件框选 Bedrock geo.json，返回 JSON 原文 */
export async function importBedrockGeoDialog(win: BrowserWindow): Promise<ModelerTextModelImportResult> {
  const picked = await dialog.showOpenDialog(win, {
    title: '导入 Bedrock geo.json',
    filters: [{ name: 'Bedrock 几何', extensions: ['json'] }],
    properties: ['openFile']
  })
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
  try {
    const filePath = picked.filePaths[0]!
    const content = readFileSync(filePath, 'utf8')
    const fileName = basename(filePath)
    return {
      canceled: false,
      name: fileName.replace(/\.[^.]+$/, ''),
      content
    }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/** 弹保存框把 Bedrock geo.json JSON 文本落盘 */
export async function exportBedrockGeoDialog(
  win: BrowserWindow,
  input: { name: string; content: string }
): Promise<ModelerAnimExportResult> {
  if (!input || typeof input.content !== 'string' || input.content.length === 0) {
    return { canceled: false, error: '导出内容为空' }
  }
  const picked = await dialog.showSaveDialog(win, {
    title: '导出 Bedrock geo.json',
    defaultPath: `${safeFileName(input.name)}.geo.json`,
    filters: [{ name: 'Bedrock 几何', extensions: ['json'] }]
  })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  try {
    writeFileSync(picked.filePath, input.content, 'utf8')
    return {
      canceled: false,
      path: picked.filePath,
      bytes: Buffer.byteLength(input.content, 'utf8')
    }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/* ------------------------------------------------------------------ */

/**
 * 弹保存框把 .obj + .mtl 落盘为两个文件。.mtl 固定写为 <obj 同目录>/model.mtl。
 */
export async function exportObjDialog(
  win: BrowserWindow,
  input: ModelerObjExportInput
): Promise<ModelerAnimExportResult> {
  if (!input || typeof input.obj !== 'string' || input.obj.length === 0) {
    return { canceled: false, error: '导出内容为空' }
  }
  const picked = await dialog.showSaveDialog(win, {
    title: '导出 OBJ（.obj）',
    defaultPath: `${safeFileName(input.name)}.obj`,
    filters: [{ name: 'Wavefront OBJ', extensions: ['obj'] }]
  })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  try {
    writeFileSync(picked.filePath, input.obj, 'utf8')
    const mtlPath = join(dirname(picked.filePath), 'model.mtl')
    writeFileSync(mtlPath, input.mtl ?? '', 'utf8')
    return {
      canceled: false,
      path: picked.filePath,
      bytes: Buffer.byteLength(input.obj, 'utf8') + (input.mtl ? Buffer.byteLength(input.mtl, 'utf8') : 0)
    }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/* ------------------------------------------------------------------ */
/* MC 皮肤导入/导出（B5-4）：主进程只做对话框与 PNG 编解码，              */
/* 文档组装与区域烘焙在渲染层 shared/modeler/formats/skin 完成。          */
/* ------------------------------------------------------------------ */

/** 皮肤画布尺寸校验：仅 64×64（现代）/ 64×32（经典） */
function isSkinSize(width: unknown, height: unknown): boolean {
  return width === 64 && (height === 64 || height === 32)
}

/** 弹文件框导入 MC 皮肤 PNG（64×64/64×32），解码为行优先像素串（canceled=true = 用户取消） */
export async function importSkinDialog(win: BrowserWindow): Promise<ModelerSkinImportResult> {
  const picked = await dialog.showOpenDialog(win, {
    title: '导入 MC 皮肤（.png）',
    filters: [
      { name: 'PNG 图片', extensions: ['png'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }
  const filePath = picked.filePaths[0]!
  try {
    const buf = readFileSync(filePath)
    if (buf.length === 0) throw new Error('文件为空')
    const raster = decodePng(buf) // 非法 PNG 由 pngjs 抛错
    if (!isSkinSize(raster.width, raster.height)) {
      throw new Error(
        `不是有效的 MC 皮肤尺寸：${raster.width}×${raster.height}（仅支持 64×64 / 64×32）`
      )
    }
    const pixels: string[] = []
    for (let i = 0; i < raster.width * raster.height; i++) {
      const o = i * 4
      pixels.push(
        formatPixel({
          r: raster.data[o]!,
          g: raster.data[o + 1]!,
          b: raster.data[o + 2]!,
          a: raster.data[o + 3]!
        })
      )
    }
    return {
      canceled: false,
      name: basename(filePath).replace(/\.png$/i, ''),
      width: raster.width,
      height: raster.height,
      pixels
    }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}

/** 弹保存框把皮肤像素串编码为 PNG 落盘（canceled=true = 用户取消） */
export async function exportSkinDialog(
  win: BrowserWindow,
  input: ModelerSkinExportInput
): Promise<ModelerSkinExportResult> {
  if (!input || typeof input.name !== 'string') {
    return { canceled: false, error: '导出入参缺失' }
  }
  const { width, height, pixels } = input
  if (!isSkinSize(width, height)) {
    return { canceled: false, error: `皮肤尺寸非法：${String(width)}×${String(height)}` }
  }
  if (!Array.isArray(pixels) || pixels.length !== width * height) {
    return { canceled: false, error: '皮肤像素数量与尺寸不符' }
  }
  const picked = await dialog.showSaveDialog(win, {
    title: '导出 MC 皮肤（.png）',
    defaultPath: `${safeFileName(input.name)}.png`,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }]
  })
  if (picked.canceled || !picked.filePath) return { canceled: true }
  try {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      const c = parsePixel(pixels[i] ?? '')
      if (!c) continue
      const o = i * 4
      data[o] = c.r
      data[o + 1] = c.g
      data[o + 2] = c.b
      data[o + 3] = c.a
    }
    const buf = encodePng({ width, height, data })
    writeFileSync(picked.filePath, buf)
    return { canceled: false, path: picked.filePath, bytes: buf.length }
  } catch (err) {
    return { canceled: false, error: (err as Error).message }
  }
}
