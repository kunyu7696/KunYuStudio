/**
 * Blockbench .bbmodel 文件导入/导出服务（建模工坊 B1）。
 *
 * 导入：读文件 → bbmodelToAsset → 内嵌 PNG 解码降采样为 pixels →
 *       normalizeModelSchema 校验 → saveContent 落语义资产。
 * 导出：loadContent 模型 → pixels 重编码 PNG 内嵌 → assetToBbmodel → 写 .bbmodel。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { bbmodelToAsset, assetToBbmodel, type BbmodelDoc } from '../../shared/utils/bbmodel'
import { normalizeModelSchema, validateModelSchema } from '../../shared/schemas/model.schema'
import { formatPixel, isPixelValue, parsePixel } from '../../shared/utils/pixelColor'
import type { ModelAsset } from '../../shared/types/content'
import { loadContent, saveContent } from './contentService'
import { decodePng, downsample, encodePng, type Raster } from './ai/pixelize'

export interface BbmodelImportResult {
  id: string
  warnings: string[]
}

/** 文件名 → 安全资产 id（小写下划线） */
function fileNameToId(name: string): string {
  const stem = basename(name).replace(/\.bbmodel$/i, '')
  const cleaned = stem
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'imported_model'
}

function dataUrlToBuffer(dataUrl: string): Buffer | null {
  const m = /^data:image\/png;base64,(.+)$/s.exec(dataUrl)
  return m ? Buffer.from(m[1], 'base64') : null
}

/** 内嵌 PNG → 模型画布像素（区域平均降采样，逐像素保留 alpha） */
function embeddedPngToPixels(dataUrl: string, size: 16 | 32): string[] {
  const buf = dataUrlToBuffer(dataUrl)
  if (!buf) return Array.from({ length: size * size }, () => '')
  const raster: Raster = downsample(decodePng(buf), size, 'area')
  const pixels: string[] = []
  for (let i = 0; i < size * size; i++) {
    pixels.push(
      formatPixel({
        r: raster.data[i * 4],
        g: raster.data[i * 4 + 1],
        b: raster.data[i * 4 + 2],
        a: raster.data[i * 4 + 3]
      })
    )
  }
  return pixels
}

/** pixels → PNG data URL（导出时内嵌进 bbmodel） */
export function pixelsToPngDataUrl(model: ModelAsset): string {
  const size = model.textureSize
  const raster: Raster = {
    width: size,
    height: size,
    data: new Uint8ClampedArray(size * size * 4)
  }
  for (let i = 0; i < size * size; i++) {
    const c = parsePixel(model.pixels[i] ?? '')
    if (!c) continue
    raster.data[i * 4] = c.r
    raster.data[i * 4 + 1] = c.g
    raster.data[i * 4 + 2] = c.b
    raster.data[i * 4 + 3] = c.a
  }
  return `data:image/png;base64,${encodePng(raster).toString('base64')}`
}

/**
 * 导入 .bbmodel 为语义模型资产。
 * @param root 项目根
 * @param filePath 用户选择的 bbmodel 绝对路径
 * @param explicitId 可选显式 id（覆盖文件名推导）
 */
export function importBbmodel(root: string, filePath: string, explicitId?: string): BbmodelImportResult {
  const raw = readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')
  let doc: BbmodelDoc
  try {
    doc = JSON.parse(raw) as BbmodelDoc
  } catch (err) {
    throw new Error(`bbmodel JSON 解析失败：${(err as Error).message}`)
  }
  const id = explicitId?.trim() || fileNameToId(filePath)
  const converted = bbmodelToAsset(doc, id)
  const model = converted.model

  // 回填内嵌贴图像素（取第一张）
  const embedded = converted.embeddedTextures.find((u) => u.length > 0)
  if (embedded) {
    model.pixels = embeddedPngToPixels(embedded, model.textureSize)
  }

  const normalized = normalizeModelSchema(model)
  const error = validateModelSchema(normalized)
  if (error) throw new Error(`导入模型校验失败：${error}`)
  saveContent(root, normalized)
  return { id: normalized.id, warnings: converted.warnings }
}

/** 导出内存中的模型资产为 .bbmodel 文件（用于统一编辑器未保存的嵌入式模型），返回字节数 */
export function writeBbmodelAsset(model: ModelAsset, destPath: string): { path: string; bytes: number } {
  const hasPixels = model.pixels.some((p) => p !== '' && isPixelValue(p))
  const doc = assetToBbmodel(model, hasPixels ? pixelsToPngDataUrl(model) : undefined)
  const json = JSON.stringify(doc, null, 2)
  writeFileSync(destPath, json, 'utf-8')
  return { path: destPath, bytes: Buffer.byteLength(json, 'utf-8') }
}

/** 导出语义模型资产为 .bbmodel 文件，返回写入字节数 */
export function exportBbmodel(root: string, id: string, destPath: string): { path: string; bytes: number } {
  const def = loadContent(root, 'model', id)
  if (def.kind !== 'model') throw new Error(`${id} 不是模型资产`)
  return writeBbmodelAsset(def as ModelAsset, destPath)
}
