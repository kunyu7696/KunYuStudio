/**
 * 图像背景移除。
 *
 * 动机：OpenAI 兼容图像协议没有透明通道语义，AI 出图即使提示词写了
 * 「transparent or flat solid background」也几乎都是带平整底色的不透明图。
 * 直接像素化会把底色量化为贴图的一部分（MC 精灵贴图要求背景透明）。
 *
 * 方案（纯本地、离线、零依赖，借鉴方法论、不抄任何实现）：
 * 1. 边缘主色检测：采样四周一圈像素，按 16 级量化桶统计，取占比最高的桶均值
 *    作为背景色；边缘样本中主色占比即「置信度」。
 * 2. 两种移除模式：
 *    - flood（默认）：从边缘与背景色相近的像素洪泛填充，只抠掉「与边缘连通」
 *      的背景——贴图内部与背景同色的孤岛（如白底上的白高光）不会被误伤；
 *    - global：全图色度键，所有近似背景色的像素一律透明（适合明确底色场景）。
 * 3. 三重误检护栏（AI 图千变万化，宁可不抠也不许抠坏）：
 *    - 图本身已全透明 → 跳过；
 *    - 边缘颜色杂乱（主色置信度低于阈值）→ 没有平整背景，跳过；
 *    - 移除比例过高（默认 >85%）→ 整图疑似纯色/误检，保留原图。
 * 跳过原因以中文返回，由调用方透传告警，绝不做静默改动。
 */
import { decodePng, encodePng, type Raster } from './pixelize'

export interface RemoveBackgroundOptions {
  /** RGB 欧氏距离容差 0-255，默认 40（覆盖 AI 底色的轻微噪点/渐变） */
  tolerance?: number
  /** flood=边缘连通（默认）；global=全图色度键 */
  mode?: 'flood' | 'global'
  /** 手动指定背景色；给定后跳过自动检测与置信度护栏 */
  bgColor?: [number, number, number]
  /** 误检护栏：移除像素占全图比例超过此值判定为误检并保留原图，默认 0.85 */
  maxRemovalRatio?: number
  /** 误检护栏：边缘主色置信度低于此值判定为「无平整背景」并跳过，默认 0.2 */
  minEdgeConfidence?: number
}

export interface BackgroundDetection {
  /** 检测到的背景色（边缘主色桶均值） */
  color: [number, number, number]
  /** 边缘不透明样本中主色桶占比 0..1 */
  confidence: number
  /** 参与统计的边缘不透明样本数 */
  edgeSamples: number
}

export interface RemoveBackgroundResult {
  /** 处理后的栅格（applied=false 时为原图原样返回，不做任何改动） */
  raster: Raster
  /** 是否真正执行了移除 */
  applied: boolean
  /** 跳过原因（applied=false 时给出，中文，供调用方告警透传） */
  reason?: string
  /** 实际使用的背景色（手动指定或自动检测；无法检测时为 null） */
  bgColor: [number, number, number] | null
  removedCount: number
  /** 移除像素 / 全图像素 0..1 */
  removedRatio: number
}

const DEFAULT_TOLERANCE = 40
const DEFAULT_MAX_REMOVAL_RATIO = 0.85
const DEFAULT_MIN_EDGE_CONFIDENCE = 0.2

/** 颜色量化桶键：每通道压到 16 级，吸收底色的轻微噪点 */
function bucketKey(r: number, g: number, b: number): number {
  return ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
}

function colorDistSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2
}

/**
 * 检测边缘主色（自动背景色）。只统计不透明像素（alpha>=8）。
 * 返回 null 表示边缘没有任何不透明样本（整圈透明——已经抠过了）。
 */
export function detectBackgroundColor(raster: Raster): BackgroundDetection | null {
  const { width, height, data } = raster
  if (width === 0 || height === 0) return null
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  let edgeSamples = 0
  const visit = (x: number, y: number): void => {
    const o = (y * width + x) * 4
    if (data[o + 3]! < 8) return
    edgeSamples++
    const r = data[o]!
    const g = data[o + 1]!
    const b = data[o + 2]!
    const key = bucketKey(r, g, b)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count++
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(key, { count: 1, r, g, b })
    }
  }
  for (let x = 0; x < width; x++) {
    visit(x, 0)
    if (height > 1) visit(x, height - 1)
  }
  for (let y = 1; y < height - 1; y++) {
    visit(0, y)
    if (width > 1) visit(width - 1, y)
  }
  if (edgeSamples === 0) return null
  let best: { count: number; r: number; g: number; b: number } | null = null
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket
  }
  if (!best) return null
  return {
    color: [Math.round(best.r / best.count), Math.round(best.g / best.count), Math.round(best.b / best.count)],
    confidence: best.count / edgeSamples,
    edgeSamples
  }
}

/** 深拷贝栅格（绝不原地改调用方数据） */
function cloneRaster(raster: Raster): Raster {
  return { width: raster.width, height: raster.height, data: new Uint8ClampedArray(raster.data) }
}

/**
 * 执行背景移除。纯函数：输入栅格不变，结果走新栅格。
 * 所有护栏触发时 applied=false 且 raster 为原图拷贝（调用方可直接用）。
 */
export function removeBackground(raster: Raster, opts: RemoveBackgroundOptions = {}): RemoveBackgroundResult {
  const tolerance = opts.tolerance ?? DEFAULT_TOLERANCE
  const maxRemovalRatio = opts.maxRemovalRatio ?? DEFAULT_MAX_REMOVAL_RATIO
  const minEdgeConfidence = opts.minEdgeConfidence ?? DEFAULT_MIN_EDGE_CONFIDENCE
  const total = raster.width * raster.height
  const out = cloneRaster(raster)

  const noop = (reason: string, bgColor: [number, number, number] | null): RemoveBackgroundResult => ({
    raster: out,
    applied: false,
    reason,
    bgColor,
    removedCount: 0,
    removedRatio: 0
  })

  if (total === 0) return noop('图像尺寸为 0，无可处理内容。', null)

  // 护栏①：图本身已全透明（无可抠对象）
  let opaqueTotal = 0
  for (let i = 0; i < total; i++) {
    if (raster.data[i * 4 + 3]! >= 8) opaqueTotal++
  }
  if (opaqueTotal === 0) return noop('图像本身已全透明，无需移除背景。', null)

  // 背景色：手动指定优先，否则自动检测（护栏②：边缘无主色 → 无平整背景）
  let bg: [number, number, number]
  if (opts.bgColor) {
    bg = opts.bgColor
  } else {
    const detection = detectBackgroundColor(raster)
    if (!detection) return noop('图像边缘整圈透明（背景已是透明的），无需移除。', null)
    if (detection.confidence < minEdgeConfidence) {
      return noop(
        `边缘颜色杂乱（主色占比 ${(detection.confidence * 100).toFixed(0)}%，低于 ${(minEdgeConfidence * 100).toFixed(0)}% 阈值），` +
          '未检测到平整背景，已保留原图。',
        detection.color
      )
    }
    bg = detection.color
  }

  const tolSq = tolerance * tolerance
  const near = (i: number): boolean => {
    const o = i * 4
    return colorDistSq(out.data[o]!, out.data[o + 1]!, out.data[o + 2]!, bg[0], bg[1], bg[2]) <= tolSq
  }

  // 待移除标记
  const remove = new Uint8Array(total)
  let removedCount = 0
  if (opts.mode === 'global') {
    for (let i = 0; i < total; i++) {
      if (out.data[i * 4 + 3]! >= 8 && near(i)) {
        remove[i] = 1
        removedCount++
      }
    }
  } else {
    // flood：从边缘所有近似背景色的像素出发，4 邻域洪泛，只抠与边缘连通的背景
    const { width, height } = raster
    const queue: number[] = []
    const push = (i: number): void => {
      if (remove[i]) return
      if (out.data[i * 4 + 3]! < 8) return
      if (!near(i)) return
      remove[i] = 1
      removedCount++
      queue.push(i)
    }
    for (let x = 0; x < width; x++) {
      push(x)
      push((height - 1) * width + x)
    }
    for (let y = 0; y < height; y++) {
      push(y * width)
      push(y * width + width - 1)
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!
      const x = i % width
      const y = (i / width) | 0
      if (x > 0) push(i - 1)
      if (x < width - 1) push(i + 1)
      if (y > 0) push(i - width)
      if (y < height - 1) push(i + width)
    }
  }

  if (removedCount === 0) {
    return noop('没有找到与背景色相近的可移除区域（容差可能过小），已保留原图。', bg)
  }

  // 护栏③：移除比例过高 → 整图疑似纯色/误检
  const removedRatio = removedCount / total
  if (removedRatio > maxRemovalRatio) {
    return noop(
      `移除比例高达 ${(removedRatio * 100).toFixed(0)}%（超过 ${(maxRemovalRatio * 100).toFixed(0)}% 护栏），` +
        '判定为误检（整图可能接近纯色），已保留原图。',
      bg
    )
  }

  for (let i = 0; i < total; i++) {
    if (remove[i]) out.data[i * 4 + 3] = 0
  }
  return { raster: out, applied: true, bgColor: bg, removedCount, removedRatio }
}

/** PNG Buffer 便捷入口：解码 → 移除 → 重编码（applied=false 时 png 为原图重编码）。 */
export function removeBackgroundFromPng(
  buffer: Buffer,
  opts?: RemoveBackgroundOptions
): { png: Buffer; result: RemoveBackgroundResult } {
  const result = removeBackground(decodePng(buffer), opts)
  return { png: result.applied ? encodePng(result.raster) : buffer, result }
}
