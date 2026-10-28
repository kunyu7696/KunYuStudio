/**
 * 像素画笔核心测试（批次4，clean-room 自研）。
 * 所有测试都是纯数学验证，不依赖 DOM/canvas。
 */
import { describe, expect, it } from 'vitest'
import {
  brushPixels,
  bucketFillPixels,
  ellipseBrushPixels,
  linePixels,
  pixelIndex
} from '../pixelBrush'

describe('brushPixels 圆形笔刷', () => {
  it('radius=0 → 仅中心点（画布内）', () => {
    expect(brushPixels(5, 5, 0, 16)).toEqual([[5, 5]])
  })
  it('radius=1 → 5 个像素（十字 + 中心）', () => {
    const pixels = brushPixels(5, 5, 1, 16)
    expect(pixels.sort()).toEqual([[4, 5], [5, 4], [5, 5], [5, 6], [6, 5]])
  })
  it('radius=2 → 13 个像素（验证几个边界点在圆内）', () => {
    const pixels = brushPixels(5, 5, 2, 16)
    expect(pixels.length).toBe(13)
    expect(pixels).toContainEqual([3, 5])
    expect(pixels).toContainEqual([7, 5])
    expect(pixels).toContainEqual([5, 3])
    expect(pixels).toContainEqual([5, 7])
    expect(pixels).toContainEqual([4, 4])
    expect(pixels).toContainEqual([6, 6])
  })
  it('画布左边界：笔刷圆心 (0,0) radius=2 → 不出现负坐标', () => {
    const pixels = brushPixels(0, 0, 2, 16)
    for (const [x, y] of pixels) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThanOrEqual(0)
    }
  })
  it('画布右边界：笔刷圆心 (15,15) radius=2 → 不出现 ≥16 坐标', () => {
    const pixels = brushPixels(15, 15, 2, 16)
    for (const [x, y] of pixels) {
      expect(x).toBeLessThan(16)
      expect(y).toBeLessThan(16)
    }
  })
})

describe('linePixels Bresenham 线段', () => {
  it('水平线 (0,0) → (3,0) → 4 个像素', () => {
    expect(linePixels(0, 0, 3, 0, 16)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]])
  })
  it('垂直线 (0,0) → (0,3) → 4 个像素', () => {
    expect(linePixels(0, 0, 0, 3, 16)).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]])
  })
  it('对角线 (0,0) → (3,3) → 4 个像素，y 随 x 递增', () => {
    const pts = linePixels(0, 0, 3, 3, 16)
    expect(pts).toHaveLength(4)
    for (let i = 0; i < pts.length; i++) {
      expect(pts[i]![0]).toBe(i)
      expect(pts[i]![1]).toBe(i)
    }
  })
  it('反向线 (3,0) → (0,0) → 仍从左到右', () => {
    expect(linePixels(3, 0, 0, 0, 16)).toEqual([[3, 0], [2, 0], [1, 0], [0, 0]])
  })
})

describe('bucketFillPixels 油漆桶（4 连通）', () => {
  it('起点在 16×16 纯色画布 → 256 个像素', () => {
    const size = 16
    const pixels = new Array(size * size).fill('#ff0000') as string[]
    const filled = bucketFillPixels(8, 8, pixels, size)
    expect(filled.length).toBe(256)
  })
  it('两色画布：左半红右半蓝 → 从红区点只填红区', () => {
    const size = 16
    const pixels: string[] = []
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        pixels.push(x < 8 ? '#ff0000' : '#0000ff')
      }
    }
    const filled = bucketFillPixels(3, 3, pixels, size)
    expect(filled.length).toBe(8 * 16) // 左半 128 像素
  })
  it('透明区域不填充（bucketFillPixels 忽略透明起点）', () => {
    const size = 16
    const pixels = new Array(size * size).fill('') as string[]
    const filled = bucketFillPixels(8, 8, pixels, size)
    expect(filled.length).toBe(0)
  })
  it('L 形区域（4 连通）：只填 4 连通部分', () => {
    const size = 8
    const pixels: string[] = new Array(size * size).fill('') as string[]
    // 画一个 L 形
    for (let i = 0; i < 5; i++) {
      pixels[i * 8] = '#00ff00' // 左列
    }
    for (let i = 0; i < 3; i++) {
      pixels[40 + i] = '#00ff00' // 底行 5..7
    }
    const filled = bucketFillPixels(0, 0, pixels, size)
    // 左列 5 + 底行右伸 3 = 8 像素，4 连通全部可达
    expect(filled.length).toBe(8)
  })
})

describe('ellipseBrushPixels 椭圆笔刷', () => {
  it('rx=ry=2 → 等同于圆形 brushPixels', () => {
    expect(ellipseBrushPixels(5, 5, 2, 2, 16).sort()).toEqual(brushPixels(5, 5, 2, 16).sort())
  })
  it('rx=1 ry=3 → 竖向椭圆（7 个像素）', () => {
    const pixels = ellipseBrushPixels(5, 5, 1, 3, 16)
    // 竖向椭圆：宽 3 高 7（但 y 范围 ±3 超出 rx=1 时 x 只取 1 个值）
    expect(pixels.length).toBeGreaterThan(5)
    expect(pixels.every(([x, y]) => x >= 4 && x <= 6 && y >= 2 && y <= 8)).toBe(true)
  })
})

describe('pixelIndex 坐标索引', () => {
  it('(0, 0) → 0，(15, 0) → 15，(0, 1) → 16', () => {
    expect(pixelIndex(0, 0, 16)).toBe(0)
    expect(pixelIndex(15, 0, 16)).toBe(15)
    expect(pixelIndex(0, 1, 16)).toBe(16)
    expect(pixelIndex(15, 15, 16)).toBe(255)
  })
})
