import { describe, expect, it } from 'vitest'
import {
  applyPoints,
  ellipsePoints,
  floodFill,
  linePoints,
  rectFillPoints,
  rectOutlinePoints
} from '../pixelAlgorithms'

describe('linePoints（Bresenham）', () => {
  it('水平线', () => {
    const pts = linePoints(1, 2, 4, 2)
    expect(pts).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 }
    ])
  })

  it('对角线端点连续', () => {
    const pts = linePoints(0, 0, 3, 3)
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[pts.length - 1]).toEqual({ x: 3, y: 3 })
    expect(pts).toHaveLength(4)
  })

  it('反向直线对称（端点交换后点集一致）', () => {
    expect(new Set(linePoints(0, 0, 3, 1).map((p) => `${p.x},${p.y}`))).toEqual(
      new Set(linePoints(3, 1, 0, 0).map((p) => `${p.x},${p.y}`))
    )
  })
})

describe('rectOutlinePoints / rectFillPoints', () => {
  it('描边点数 = 2w + 2(h-2)', () => {
    // 4×3 矩形：12 边界点
    expect(rectOutlinePoints(0, 0, 3, 2)).toHaveLength(10)
  })

  it('填充点数 = w×h', () => {
    expect(rectFillPoints(0, 0, 3, 2)).toHaveLength(12)
  })

  it('反角矩形归一化', () => {
    const pts = rectFillPoints(3, 2, 0, 0)
    expect(pts).toContainEqual({ x: 0, y: 0 })
    expect(pts).toContainEqual({ x: 3, y: 2 })
    // 归一化后区域 x 0..3 × y 0..2 = 12 点（与正向矩形一致）
    expect(pts).toHaveLength(12)
  })
})

describe('ellipsePoints', () => {
  it('正圆包含四个极值点', () => {
    const pts = ellipsePoints(0, 0, 10, 10)
    const keys = new Set(pts.map((p) => `${p.x},${p.y}`))
    expect(keys.has('5,0')).toBe(true)
    expect(keys.has('5,10')).toBe(true)
    expect(keys.has('0,5')).toBe(true)
    expect(keys.has('10,5')).toBe(true)
  })

  it('1×1 退化为单点', () => {
    const pts = ellipsePoints(2, 2, 2, 2)
    expect(pts).toContainEqual({ x: 2, y: 2 })
  })
})

describe('floodFill（迭代）', () => {
  const w = 4
  const h = 4
  const blank = (): string[] => new Array(w * h).fill('')

  it('填充同色连通区域', () => {
    const px = blank()
    const n = floodFill(px, w, h, 0, 0, '#ff0000')
    expect(n).toBe(16)
    expect(px.every((c) => c === '#ff0000')).toBe(true)
  })

  it('不同色边界阻止渗透', () => {
    const px = blank()
    px[5] = '#00ff00' // (1,1) 处障碍
    const n = floodFill(px, w, h, 0, 0, '#ff0000')
    expect(n).toBe(15)
    expect(px[5]).toBe('#00ff00')
  })

  it('目标色等于替换色时返回 0', () => {
    const px = blank()
    expect(floodFill(px, w, h, 0, 0, '')).toBe(0)
  })

  it('越界起点返回 0', () => {
    const px = blank()
    expect(floodFill(px, w, h, 9, 9, '#ff0000')).toBe(0)
  })
})

describe('applyPoints', () => {
  it('不改原数组且越界点被忽略', () => {
    const px = new Array(16).fill('')
    const next = applyPoints(px, 4, 4, [{ x: 1, y: 1 }, { x: 99, y: 99 }], '#abcdef')
    expect(px[5]).toBe('')
    expect(next[5]).toBe('#abcdef')
    expect(next).toHaveLength(16)
  })
})
