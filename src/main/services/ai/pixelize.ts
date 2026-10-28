/**
 * pixelize：大图 → Minecraft 风格像素贴图后处理管线（贴图工坊 A1）。
 *
 * 三段式：PNG 解码 → 区域平均降采样 → 中位切分调色板量化（可选 Floyd–Steinberg 抖动），
 * 透明背景精灵可选 8 邻域自动描边。输出与 pixelArtGenerator 一致的语义 pixels
 * （size*size 项，"#rrggbb" 或 "" 透明），可直接写入 Item/Model 资产。
 *
 * 纯函数 + pngjs（无原生依赖），同时供：
 * - texture_pixelize Agent 工具（主进程）
 * - 贴图工坊候选画廊（IPC 服务）
 */
import { PNG } from 'pngjs'
import { parsePixel } from '../../../shared/utils/pixelColor'

export interface Raster {
  width: number
  height: number
  /** RGBA，长度 width*height*4 */
  data: Uint8ClampedArray
}

export interface PixelizeOptions {
  /** 目标边长（贴图必须为正方形），默认 16，MC 常用 16/32/64 */
  size?: number
  /** 调色板最大颜色数（不含透明），默认 32；MC 16x 建议 16-48 */
  maxColors?: number
  /** 降采样策略：area=区域平均（默认，抗锯齿自然）；nearest=最近邻（保留硬边像素风） */
  downsample?: 'area' | 'nearest'
  /** 颜色抖动：floyd=弗洛伊德-斯坦伯格（默认，渐变更顺）；none=不抖动（色块更干净） */
  dither?: 'floyd' | 'none'
  /** 透明判定阈值 0-255，alpha 低于此值视为透明，默认 128 */
  alphaThreshold?: number
  /** 透明背景精灵自动描边（邻接透明的像素压暗），默认开启；全不透明图自动跳过 */
  outline?: boolean
  /** 描边压暗系数 0-1，默认 0.5 */
  outlineFactor?: number
  /**
   * 固定色板量化（项目级色板锁定用）：给非空合法色板时跳过 median-cut，
   * 直接对每个像素做最近邻量化，保证同项目所有贴图色板一致；
   * 代价是超出色板的颜色会被压到最近色。色板项非法（非 #rrggbb）自动忽略，
   * 合法项为空或未给时回退现有 median-cut 行为。
   */
  palette?: string[]
}

export interface PixelizeResult {
  size: number
  /** size*size 项，"#rrggbb" 或 ""（透明） */
  pixels: string[]
  /** 实际使用的调色板（去重后） */
  palette: string[]
  /** 16/32 行 ASCII 自检预览（空格透明，字符越密越亮） */
  ascii: string
  /** 量化后重新编码的 PNG（边长 size） */
  png: Buffer
}

const ASCII_RAMP = ' .:-=+*#%@'

function clamp(v: number): number {
  return Math.max(0, Math.min(255, v))
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number): string => clamp(Math.round(v)).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** 解析 "#rrggbb" 为 RGB 三元组；非法（含大小写不匹配的简写）返回 null */
function parseHexColor(hex: string): [number, number, number] | null {
  if (typeof hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

/** PNG Buffer → RGBA 栅格 */
export function decodePng(buffer: Buffer): Raster {
  const png = PNG.sync.read(buffer)
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) }
}

/** RGBA 栅格 → PNG Buffer */
export function encodePng(raster: Raster): Buffer {
  const png = new PNG({ width: raster.width, height: raster.height })
  png.data = Buffer.from(raster.data)
  return PNG.sync.write(png)
}

/**
 * 贴图内容质量闸门（空白贴图回归：实体贴图 100% 透明落盘，
 * 构建照过、游戏内隐身）——「文件存在」不等于「内容可用」。
 * 判定：不透明像素（alpha>=8）为 0 → 空白；占比 <5% → 近空白；
 * 不透明去重色数 <=1 → 纯色无细节。
 * 返回 null 表示可用；否则返回人类可读问题描述（会回喂模型补救轮）。
 */
export function lintTextureContent(raster: Raster): string | null {
  const total = raster.width * raster.height
  if (total === 0) return '贴图尺寸为 0'
  let opaque = 0
  const colors = new Set<number>()
  const d = raster.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue
    opaque++
    colors.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
  }
  if (opaque === 0) return '贴图 100% 透明（空白图）'
  if (opaque / total < 0.05) {
    return `贴图近乎全透明（不透明像素仅 ${((opaque / total) * 100).toFixed(1)}%）`
  }
  if (colors.size <= 1) return '贴图为纯色、无任何细节'
  return null
}

/** data URL（data:image/png;base64,...）→ Buffer；非 PNG data URL 抛错 */
export function dataUrlToPngBuffer(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,(.+)$/s.exec(dataUrl)
  if (!m) {
    if (dataUrl.startsWith('data:image/')) {
      throw new Error('pixelize 仅支持 PNG 输入（请在渲染层用 canvas 转成 image/png）')
    }
    throw new Error('不是合法的图片 data URL')
  }
  return Buffer.from(m[1], 'base64')
}

export function toPngDataUrl(result: PixelizeResult): string {
  return `data:image/png;base64,${result.png.toString('base64')}`
}

/** 语义像素（size*size 项，"" 透明 / "#rrggbb" / "#rrggbbaa"）→ PNG data URL（AI 重绘取当前贴图当源图用）。 */
export function pixelsToPngDataUrl(size: number, pixels: string[]): string {
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
  const png = encodePng({ width: size, height: size, data })
  return `data:image/png;base64,${png.toString('base64')}`
}

/** 纯点采样最近邻（每目标像素取源图中心 1 个像素；仅在缩比温和时保真） */
function nearestPoint(src: Raster, size: number): Raster {
  const out = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x + 0.5) * src.width / size))
      const sy = Math.min(src.height - 1, Math.floor((y + 0.5) * src.height / size))
      const si = (sy * src.width + sx) * 4
      const di = (y * size + x) * 4
      out[di] = src.data[si]
      out[di + 1] = src.data[si + 1]
      out[di + 2] = src.data[si + 2]
      out[di + 3] = src.data[si + 3]
    }
  }
  return { width: size, height: size, data: out }
}

/**
 * nearest 点采样在极端缩比下每目标像素只采 1 个源像素（512→16 时采样率 1/1024，
 * 丢失 99.9% 信息。超过该轴缩比阈值（每目标像素覆盖 >4 个源像素）时，
 * 先用区域平均降到 size*2 的中间尺寸，再点采样到目标——末级仍为最近邻以保留硬边
 * 像素风，但前置平均保证大块色彩/明暗信息不丢。
 */
const NEAREST_SAFE_RATIO = 4

/** 区域平均/最近邻降采样到 size×size */
export function downsample(src: Raster, size: number, strategy: 'area' | 'nearest'): Raster {
  if (size <= 0) throw new Error('size 必须为正整数')
  if (strategy === 'nearest') {
    const ratio = Math.max(src.width / size, src.height / size)
    if (ratio > NEAREST_SAFE_RATIO) {
      // 极端缩比保护：area 预降（尺寸恒为 2 的幂序列的末级 size*2），再 nearest
      const mid = areaDownsample(src, size * 2)
      return nearestPoint(mid, size)
    }
    return nearestPoint(src, size)
  }
  return areaDownsample(src, size)
}

/** 区域平均：按目标像素覆盖的源区域加权（含 alpha 必要项） */
function areaDownsample(src: Raster, size: number): Raster {
  const out = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    const sy0 = Math.floor((y * src.height) / size)
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * src.height) / size))
    for (let x = 0; x < size; x++) {
      const sx0 = Math.floor((x * src.width) / size)
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * src.width) / size))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const si = (sy * src.width + sx) * 4
          const pxA = src.data[si + 3]
          // 预乘 alpha 平均，避免半透明边缘发黑
          r += src.data[si] * pxA
          g += src.data[si + 1] * pxA
          b += src.data[si + 2] * pxA
          a += pxA
          n++
        }
      }
      const di = (y * size + x) * 4
      const avgA = a / n
      out[di + 3] = clamp(avgA)
      if (a > 0) {
        out[di] = clamp(r / a)
        out[di + 1] = clamp(g / a)
        out[di + 2] = clamp(b / a)
      }
    }
  }
  return { width: size, height: size, data: out }
}

interface Box {
  pixels: number[] // 像素索引（仅不透明）
}

/** 中位切分：返回最多 maxColors 个代表色 */
function medianCut(indices: number[], data: Uint8ClampedArray, maxColors: number): Array<[number, number, number]> {
  const avg = (box: Box): [number, number, number] => {
    let r = 0, g = 0, b = 0
    for (const i of box.pixels) {
      r += data[i * 4]
      g += data[i * 4 + 1]
      b += data[i * 4 + 2]
    }
    const n = box.pixels.length || 1
    return [r / n, g / n, b / n]
  }
  let boxes: Box[] = [{ pixels: indices }]
  while (boxes.length < maxColors) {
    let chosen = -1
    let chosenRange = 0
    let chosenChannel = 0
    for (let bi = 0; bi < boxes.length; bi++) {
      const px = boxes[bi].pixels
      if (px.length < 2) continue
      let min = [255, 255, 255]
      let max = [0, 0, 0]
      for (const i of px) {
        for (let c = 0; c < 3; c++) {
          const v = data[i * 4 + c]
          if (v < min[c]) min[c] = v
          if (v > max[c]) max[c] = v
        }
      }
      for (let c = 0; c < 3; c++) {
        const range = max[c] - min[c]
        if (range > chosenRange) {
          chosenRange = range
          chosen = bi
          chosenChannel = c
        }
      }
    }
    if (chosen < 0) break
    const box = boxes[chosen]
    box.pixels.sort((p, q) => data[p * 4 + chosenChannel] - data[q * 4 + chosenChannel])
    const mid = box.pixels.length >> 1
    const a: Box = { pixels: box.pixels.slice(0, mid) }
    const b: Box = { pixels: box.pixels.slice(mid) }
    boxes = boxes.slice(0, chosen).concat([a, b], boxes.slice(chosen + 1))
  }
  return boxes.map(avg)
}

function nearestPalette(r: number, g: number, b: number, palette: Array<[number, number, number]>): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < palette.length; i++) {
    const [pr, pg, pb] = palette[i]
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/**
 * 执行完整像素化。输入任意尺寸 PNG（建议长边 ≥ 目标 size），
 * 输出 MC 风正方形像素贴图。
 */
export function pixelizePng(buffer: Buffer, opts: PixelizeOptions = {}): PixelizeResult {
  const size = opts.size ?? 16
  const maxColors = Math.max(2, Math.min(256, opts.maxColors ?? 32))
  const alphaThreshold = opts.alphaThreshold ?? 128
  const src = decodePng(buffer)
  const small = downsample(src, size, opts.downsample ?? 'area')

  const opaque: number[] = []
  for (let i = 0; i < size * size; i++) {
    if (small.data[i * 4 + 3] > alphaThreshold) opaque.push(i)
  }
  // 项目级色板锁定：给定合法色板时跳过 median-cut，直接最近邻量化，
  // 保证同项目所有贴图色板一致；代价是超出色板的颜色会被压到最近色。
  const lockedPalette: Array<[number, number, number]> = []
  for (const hex of opts.palette ?? []) {
    const rgb = parseHexColor(hex)
    if (rgb) lockedPalette.push(rgb)
  }
  const paletteRgb =
    lockedPalette.length > 0
      ? lockedPalette
      : opaque.length > 0
        ? medianCut(opaque, small.data, maxColors)
        : []

  // 量化（可选抖动）。抖动在副本上做误差扩散，避免污染调色板统计
  const indexed = new Int8Array(size * size).fill(-1)
  if (opts.dither !== 'none' && paletteRgb.length > 0) {
    const work = new Float32Array(size * size * 3)
    for (const i of opaque) {
      work[i * 3] = small.data[i * 4]
      work[i * 3 + 1] = small.data[i * 4 + 1]
      work[i * 3 + 2] = small.data[i * 4 + 2]
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x
        if (small.data[i * 4 + 3] <= alphaThreshold) continue
        const r = work[i * 3]
        const g = work[i * 3 + 1]
        const b = work[i * 3 + 2]
        const pi = nearestPalette(r, g, b, paletteRgb)
        indexed[i] = pi
        const [pr, pg, pb] = paletteRgb[pi]
        const errR = r - pr
        const errG = g - pg
        const errB = b - pb
        const spread = (xx: number, yy: number, f: number): void => {
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) return
          const ni = yy * size + xx
          if (small.data[ni * 4 + 3] <= alphaThreshold) return
          work[ni * 3] += errR * f
          work[ni * 3 + 1] += errG * f
          work[ni * 3 + 2] += errB * f
        }
        spread(x + 1, y, 7 / 16)
        spread(x - 1, y + 1, 3 / 16)
        spread(x, y + 1, 5 / 16)
        spread(x + 1, y + 1, 1 / 16)
      }
    }
  } else {
    for (const i of opaque) {
      indexed[i] = nearestPalette(
        small.data[i * 4],
        small.data[i * 4 + 1],
        small.data[i * 4 + 2],
        paletteRgb
      )
    }
  }

  // 描边：邻接透明的像素使用「该索引色压暗后的独立色」，不影响同色内部像素
  const hasTransparency = opaque.length < size * size
  const edgeDark = new Map<number, [number, number, number]>()
  if ((opts.outline ?? true) && hasTransparency && paletteRgb.length > 0) {
    const factor = opts.outlineFactor ?? 0.5
    for (let i = 0; i < size * size; i++) {
      const pi = indexed[i]
      if (pi < 0 || edgeDark.has(pi)) continue
      const x = i % size
      const y = (i / size) | 0
      let edge = false
      for (let dy = -1; dy <= 1 && !edge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= size || ny >= size || indexed[ny * size + nx] < 0) {
            edge = true
            break
          }
        }
      }
      if (edge) {
        const [r, g, b] = paletteRgb[pi]
        edgeDark.set(pi, [r * factor, g * factor, b * factor])
      }
    }
  }

  const pixels: string[] = new Array(size * size).fill('')
  const usedHex = new Set<string>()
  for (let i = 0; i < size * size; i++) {
    const pi = indexed[i]
    if (pi < 0) {
      small.data[i * 4 + 3] = 0
      continue
    }
    // 仅当该像素本身处于边缘时才用压暗色（避免同色内部像素被描边）
    let rgb = paletteRgb[pi]
    if (edgeDark.has(pi)) {
      const x = i % size
      const y = (i / size) | 0
      let edge = false
      for (let dy = -1; dy <= 1 && !edge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= size || ny >= size || indexed[ny * size + nx] < 0) {
            edge = true
            break
          }
        }
      }
      if (edge) rgb = edgeDark.get(pi) ?? rgb
    }
    const [r, g, b] = rgb
    const hex = toHex(r, g, b)
    pixels[i] = hex
    usedHex.add(hex)
    small.data[i * 4] = clamp(r)
    small.data[i * 4 + 1] = clamp(g)
    small.data[i * 4 + 2] = clamp(b)
    small.data[i * 4 + 3] = 255
  }

  // ASCII 自检（按亮度映射；透明为空格）
  const lines: string[] = []
  for (let y = 0; y < size; y++) {
    let line = ''
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      if (indexed[i] < 0) {
        line += ' '
        continue
      }
      const lum =
        small.data[i * 4] * 0.299 + small.data[i * 4 + 1] * 0.587 + small.data[i * 4 + 2] * 0.114
      const ci = Math.min(ASCII_RAMP.length - 1, Math.floor((lum / 255) * ASCII_RAMP.length))
      line += ASCII_RAMP[ci]
    }
    lines.push(line)
  }

  return {
    size,
    pixels,
    palette: Array.from(usedHex),
    ascii: lines.join('\n'),
    png: encodePng(small)
  }
}

/** data URL 便捷入口（渲染层/Agent 工具共用） */
export function pixelizeDataUrl(dataUrl: string, opts?: PixelizeOptions): PixelizeResult {
  return pixelizePng(dataUrlToPngBuffer(dataUrl), opts)
}
