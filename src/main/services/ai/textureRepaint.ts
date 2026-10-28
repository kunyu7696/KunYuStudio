/**
 * 贴图工坊 A2：AI 重绘 → MC 像素化一体化管线。
 *
 * 流程：用户提示词（自动补 Minecraft 像素风格约束）→ 用户自带 Key 的图像供应商
 * 出大图 → 复用 A1 pixelize 降采样/量化/描边 → 可选局部 mask 合成
 * （mask 外的像素一律保留原贴图，AI 只改被涂区域）。
 *
 * 本模块不直接做任何网络密钥管理：供应商读取/调用都走 imageGenService。
 */
import type { AiProviderConfig, AiResult } from '../../../shared/types/ai'
import { formatPixel, parsePixel } from '../../../shared/utils/pixelColor'
import {
  dataUrlToPngBuffer,
  decodePng,
  downsample,
  encodePng,
  pixelizeDataUrl,
  toPngDataUrl,
  type PixelizeOptions,
  type PixelizeResult,
  type Raster
} from './pixelize'
import { generateImages, type GenerateImageOptions } from './imageGenService'
import { putTextureSource } from './textureSourceCache'
import { removeBackgroundFromPng, type RemoveBackgroundOptions } from './backgroundRemoval'

/** 局部重绘允许的目标尺寸（物品 16，模型 16/32）。 */
export type RepaintSize = 16 | 32

export interface RepaintTextureOptions {
  /** 源贴图 data URL（必须 data:image/png；当前贴图或上传参考图） */
  sourceDataUrl: string
  /** 用户画面描述 */
  prompt: string
  /** 目标边长 16/32 */
  size: RepaintSize
  providerId?: string
  /** 局部重绘 mask（data:image/png）：不透明/偏白像素=允许 AI 重绘，其余保留源贴图 */
  maskDataUrl?: string
  /** 出图张数（候选画廊），默认 1 */
  n?: number
  /** 透传像素化参数（调色板/抖动/描边等） */
  pixelize?: PixelizeOptions
  /** 出图尺寸（供应商语法），默认 1024x1024 */
  imageSize?: GenerateImageOptions['size']
  timeoutMs?: number
  /** 测试注入：直接给供应商配置 */
  provider?: AiProviderConfig
  /** 测试注入：自定义 fetch */
  fetchImpl?: typeof fetch
  /** 语义蒙版（IPC 画廊直接给布尔，免去 PNG 往返）；与 maskDataUrl 二选一，优先此项 */
  maskFlags?: boolean[]
  /**
   * 背景移除（P2-1，默认开启）：AI 大图在像素化前先抠掉平整底色
   * （图像协议没有透明通道语义，出图几乎都带底色，而 MC 精灵要求背景透明）。
   * - false：关闭，维持旧行为；
   * - 对象：微调容差/模式/护栏（见 backgroundRemoval）。
   * 三重护栏触发（已透明/边缘无主色/移除比例过高）时自动跳过并把原因记入 warnings，
   * 纯色图、已透明图、杂乱照片背景均不会被误伤。
   */
  removeBackground?: boolean | RemoveBackgroundOptions
  /**
   * 源头大图缓存注入（测试用假实现，避免依赖全局单例）。
   * 每个候选生成时把对应的 AI 大图 dataUrl 存入并返回 token，供渲染层本地重跑。
   */
  sourceCache?: { put(dataUrl: string): string }
}

export interface RepaintVariant {
  /** size*size 项语义像素（"" = 透明），可直接写回 Item/Model 资产 */
  pixels: string[]
  /** 像素化后的 PNG data URL（画廊缩略图/预览用） */
  dataUrl: string
  palette: string[]
  ascii: string
  /**
   * 该候选对应的 AI 大图在源头缓存里的 token（本地重跑像素化参数的入场券）。
   * 过期后需重新生成候选。
   */
  sourceToken?: string
  revisedPrompt?: string
}

export interface RepaintOutcome {
  size: RepaintSize
  model: string
  variants: RepaintVariant[]
  /** 降级/提示（如 mask 全覆盖、供应商改了提示词等） */
  warnings: string[]
}

/** 给用户提示词补 Minecraft 像素贴图硬约束，避免出写实照片风。 */
export function buildRepaintPrompt(userPrompt: string, size: RepaintSize): string {
  const cleaned = userPrompt.trim().replace(/\s+/g, ' ')
  return [
    cleaned,
    `Minecraft mod texture, ${size}x${size} pixel art sprite`,
    'orthogonal flat front view, centered',
    'limited color palette, crisp hard pixel edges, no anti-aliasing',
    'no text, no watermark, no drop shadow outside the sprite',
    'transparent or flat solid background'
  ].join(', ')
}

function rasterToPixels(raster: Raster, alphaThreshold = 128): string[] {
  const px: string[] = new Array(raster.width * raster.height).fill('')
  for (let i = 0; i < raster.width * raster.height; i++) {
    const o = i * 4
    const a = raster.data[o + 3]!
    if (a < alphaThreshold) continue
    px[i] = formatPixel({
      r: raster.data[o]!,
      g: raster.data[o + 1]!,
      b: raster.data[o + 2]!,
      a
    })
  }
  return px
}

function pixelsToRaster(size: number, pixels: string[]): Raster {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    const c = parsePixel(pixels[i] ?? '')
    if (!c) continue
    const o = i * 4
    data[o] = c.r
    data[o + 1] = c.g
    data[o + 2] = c.b
    data[o + 3] = c.a
  }
  return { width: size, height: size, data }
}

/**
 * 局部 mask 合成（纯函数，便于单测）：
 * @param size       边长
 * @param basePixels 源贴图像素（保留方）
 * @param overlay    AI 重绘像素（覆盖方）
 * @param repaint    长度 size*size，true=该格允许 overlay 覆盖；全 true 等同整图重绘
 * @returns 合成后像素 + 警告
 */
export function applyMask(
  size: number,
  basePixels: string[],
  overlay: string[],
  repaint: boolean[]
): { pixels: string[]; warnings: string[] } {
  const warnings: string[] = []
  const repaintCount = repaint.filter(Boolean).length
  if (repaintCount === 0) {
    warnings.push('mask 没有任何可重绘区域（全黑），已整体保留原贴图。')
    return { pixels: [...basePixels], warnings }
  }
  if (repaintCount === size * size) {
    warnings.push('mask 覆盖整张贴图（无保留区域），等同整张重绘。')
  }
  const out = basePixels.map((base, i) => (repaint[i] ? (overlay[i] ?? base) : base))
  return { pixels: out, warnings }
}

/** 解码 mask PNG 到 size×size 布尔覆盖图：红通道 >128 视为允许重绘。 */
export function maskToRepaintFlags(maskDataUrl: string, size: RepaintSize): boolean[] {
  const raster = downsample(decodePng(dataUrlToPngBuffer(maskDataUrl)), size, 'area')
  const flags = new Array<boolean>(size * size).fill(false)
  for (let i = 0; i < size * size; i++) {
    flags[i] = raster.data[i * 4]! > 128
  }
  return flags
}

/** 默认源头缓存：模块级单例（测试可注入 options.sourceCache 覆盖）。 */
const defaultSourceCache = { put: putTextureSource }

function variantFromPixelize(
  result: PixelizeResult,
  revisedPrompt: string | undefined,
  sourceToken: string
): RepaintVariant {
  return {
    pixels: result.pixels,
    dataUrl: toPngDataUrl(result),
    palette: result.palette,
    ascii: result.ascii,
    sourceToken,
    revisedPrompt
  }
}

/**
 * AI 重绘主入口。失败统一返回 AiResult（网络/鉴权/配置见 imageGenService），
 * 不向 UI/工具层抛异常。
 */
export async function repaintTexture(
  options: RepaintTextureOptions
): Promise<AiResult<RepaintOutcome>> {
  const warnings: string[] = []
  const size = options.size
  if (!options.sourceDataUrl.startsWith('data:image/png')) {
    return { ok: false, errorKind: 'config', errorMessage: '源贴图必须是 data:image/png（像素化管线仅吃 PNG）。' }
  }

  // 源贴图像素（mask 保留方 + 最终兜底）
  let basePixels: string[]
  try {
    basePixels = rasterToPixels(downsample(decodePng(dataUrlToPngBuffer(options.sourceDataUrl)), size, 'area'))
  } catch (err) {
    return { ok: false, errorKind: 'config', errorMessage: `源贴图解码失败：${(err as Error).message}` }
  }

  let repaintFlags: boolean[] | null = null
  if (options.maskFlags && options.maskFlags.length === size * size) {
    repaintFlags = options.maskFlags
  } else if (options.maskDataUrl) {
    if (!options.maskDataUrl.startsWith('data:image/png')) {
      return { ok: false, errorKind: 'config', errorMessage: 'mask 必须是 data:image/png。' }
    }
    try {
      repaintFlags = maskToRepaintFlags(options.maskDataUrl, size)
    } catch (err) {
      return { ok: false, errorKind: 'config', errorMessage: `mask 解码失败：${(err as Error).message}` }
    }
  }

  const gen = await generateImages({
    provider: options.provider,
    fetchImpl: options.fetchImpl,
    providerId: options.providerId,
    prompt: buildRepaintPrompt(options.prompt, size),
    n: options.n ?? 1,
    size: options.imageSize ?? '1024x1024',
    timeoutMs: options.timeoutMs
  })
  if (!gen.ok) return gen

  const variants: RepaintVariant[] = []
  const sourceCache = options.sourceCache ?? defaultSourceCache
  for (const image of gen.data.images) {
    // 每个候选对应一张 AI 大图：存入源头缓存并带上 token，供渲染层本地重跑。
    // 注意：缓存的是「供应商原图」而非抠底后的图——背景移除参数随像素化参数一起重跑，
    // 原图才能保证回放路径与首跑完全一致。
    const sourceToken = sourceCache.put(image.dataUrl)
    let px: PixelizeResult
    try {
      let pngInput = image.dataUrl
      if (options.removeBackground !== false) {
        const { png, result: rb } = removeBackgroundFromPng(
          dataUrlToPngBuffer(image.dataUrl),
          typeof options.removeBackground === 'object' ? options.removeBackground : undefined
        )
        if (rb.applied) {
          pngInput = `data:image/png;base64,${png.toString('base64')}`
        } else if (rb.reason) {
          warnings.push(`背景移除已跳过：${rb.reason}`)
        }
      }
      px = pixelizeDataUrl(pngInput, { size, ...options.pixelize })
    } catch (err) {
      return {
        ok: false,
        errorKind: 'server',
        errorMessage:
          `AI 出图无法像素化（供应商可能返回了 JPEG/非 PNG：${(err as Error).message}）。` +
          '可换 cogview/seedream 等返回 PNG 的模型再试。'
      }
    }
    let pixels = px.pixels
    if (repaintFlags) {
      const merged = applyMask(size, basePixels, px.pixels, repaintFlags)
      pixels = merged.pixels
      warnings.push(...merged.warnings)
      const composited: PixelizeResult = { ...px, pixels, png: encodePng(pixelsToRaster(size, pixels)) }
      variants.push(variantFromPixelize(composited, image.revisedPrompt, sourceToken))
    } else {
      variants.push(variantFromPixelize(px, image.revisedPrompt, sourceToken))
    }
  }

  return {
    ok: true,
    data: { size, model: gen.data.model, variants, warnings: Array.from(new Set(warnings)) }
  }
}
