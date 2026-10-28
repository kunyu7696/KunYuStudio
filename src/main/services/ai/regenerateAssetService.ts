/**
 * 资源替换局部重跑（批5）：只重生成单个贴图资产，不重跑整个模组。
 *
 * 与「一键重跑流水线」相对：这里复用贴图工坊已有的 AI 重绘管线
 * （textureRepaint.repaintTexture + pixelize），读取项目内既有 PNG →
 * 交给用户自带额度的图像供应商重绘 → 把首选候选原地回写同一路径。
 *
 * 边界：仅接受 assets/<命名空间>/textures/ 下的 16/32 像素 PNG——其余资产类型
 * （Java/模型 JSON）不在此路径（模型 JSON 的生成需要 LLM，不属于「贴图重跑」）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { dataUrlToPngBuffer, decodePng } from './pixelize'
import { repaintTexture, type RepaintSize } from './textureRepaint'

export interface RegenerateAssetInput {
  /** 项目根绝对路径（当前打开项目） */
  projectPath: string
  /** 项目根相对的项目内 PNG 路径（POSIX 风格） */
  relPath: string
  /** 重绘需求描述 */
  instruction: string
  /** 覆盖默认图像供应商 */
  providerId?: string
}

export type RegenerateAssetResult =
  | { ok: true; path: string; size: number; model: string; warnings: string[] }
  | { ok: false; errorMessage: string }

/** 贴图资产路径白名单：assets/[命名空间]/textures/ 下的 .png（相对 POSIX 路径） */
const TEXTURE_PATH_RE = /^assets\/[^/]+\/textures\/[^/]+(\/[^/]+)*\.png$/

/**
 * 校验并解析项目内相对路径为绝对路径。
 * 拒绝：绝对路径、含 `..` 逃逸、非 assets 贴图目录下的 PNG。
 */
export function resolveTextureAbsPath(projectPath: string, relPath: string): string | null {
  if (!projectPath || !relPath) return null
  if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) return null
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized.split('/').includes('..')) return null
  if (!TEXTURE_PATH_RE.test(normalized)) return null
  const abs = resolve(projectPath, ...normalized.split('/'))
  const rel = relative(projectPath, abs).replace(/\\/g, '/')
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return abs
}

/**
 * 局部重跑：AI 重绘单个贴图并原地回写。
 * 失败（路径非法 / 解码失败 / 供应商错误）统一返回人类可读中文，不抛异常。
 */
export async function regenerateTextureAsset(
  input: RegenerateAssetInput
): Promise<RegenerateAssetResult> {
  const abs = resolveTextureAbsPath(input.projectPath, input.relPath)
  if (!abs) {
    return { ok: false, errorMessage: '仅支持项目内 assets/<命名空间>/textures/ 下的 PNG 贴图' }
  }
  const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : ''
  if (!instruction) {
    return { ok: false, errorMessage: '请填写想把这张贴图改成什么样（中文即可）' }
  }

  let buffer: Buffer
  try {
    buffer = readFileSync(abs)
  } catch {
    return { ok: false, errorMessage: '贴图文件不存在或无法读取（可能已被移动/删除）' }
  }

  let size: RepaintSize
  try {
    const raster = decodePng(buffer)
    if (raster.width !== raster.height || (raster.width !== 16 && raster.width !== 32)) {
      return {
        ok: false,
        errorMessage: `贴图尺寸须为 16x16 或 32x32，当前 ${raster.width}x${raster.height}`
      }
    }
    size = raster.width as RepaintSize
  } catch (err) {
    return { ok: false, errorMessage: `贴图解码失败：${(err as Error).message}` }
  }

  const sourceDataUrl = `data:image/png;base64,${buffer.toString('base64')}`
  const outcome = await repaintTexture({
    sourceDataUrl,
    prompt: instruction,
    size,
    providerId: input.providerId,
    n: 1
  })
  if (!outcome.ok) {
    return { ok: false, errorMessage: outcome.errorMessage }
  }
  const variant = outcome.data.variants[0]
  if (!variant) {
    return { ok: false, errorMessage: 'AI 未返回任何候选贴图' }
  }
  try {
    writeFileSync(abs, dataUrlToPngBuffer(variant.dataUrl))
  } catch (err) {
    return { ok: false, errorMessage: `贴图回写失败：${(err as Error).message}` }
  }

  return {
    ok: true,
    path: input.relPath,
    size,
    model: outcome.data.model,
    warnings: outcome.data.warnings
  }
}
