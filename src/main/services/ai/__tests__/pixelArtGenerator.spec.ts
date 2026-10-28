/**
 * 程序化像素画生成器单测。
 *
 * 覆盖：11 种形状全部产出合法 16x16 像素数组、色调派生（主色/点缀/副色）、
 * 自动描边存在、剑模板的关键结构（刃/护手/柄）、ASCII 预览形状、非法输入兜底。
 */
import { describe, expect, it } from 'vitest'

import {
  PAINT_SHAPES,
  PAINT_SHAPE_LABELS,
  paintPixels,
  validatePaintShape,
  type PaintSpec
} from '../pixelArtGenerator'

function makeSpec(overrides: Partial<PaintSpec> = {}): PaintSpec {
  return { shape: 'sword', primary: '#9aa7b8', ...overrides }
}

const HEX_RE = /^#[0-9a-f]{6}$/

describe('paintPixels 全形状基础契约', () => {
  for (const shape of PAINT_SHAPES) {
    it(`${shape} → 256 项合法像素 + 16 行 ASCII`, () => {
      const r = paintPixels(makeSpec({ shape }))
      expect(r.pixels).toHaveLength(256)
      for (const p of r.pixels) {
        expect(p === '' || HEX_RE.test(p)).toBe(true)
      }
      const lines = r.ascii.split('\n')
      expect(lines).toHaveLength(16)
      for (const line of lines) expect(line).toHaveLength(16)
      // 非空像素数与 ASCII 非透明字符数一致
      const paintedChars = r.ascii.split('').filter((c) => c !== '.' && c !== '\n').length
      expect(r.painted).toBe(paintedChars)
      expect(r.painted).toBeGreaterThan(0)
      expect(PAINT_SHAPE_LABELS[shape]).toBeTruthy()
    })
  }
})

describe('色调派生', () => {
  it('主色四阶明暗 + 点缀 + 副色齐全且为合法 hex', () => {
    const r = paintPixels(makeSpec({ primary: '#b04040', accent: '#d4a017', secondary: '#5c4033' }))
    const t = r.tones
    for (const v of [t.o, t.d, t.m, t.l, t.h, t.a, t.A, t.g, t.G]) {
      expect(HEX_RE.test(v)).toBe(true)
    }
    expect(t.m).toBe('#b04040')
    expect(t.A).toBe('#d4a017')
    // 亮阶比中阶亮（红通道更大）
    expect(parseInt(t.l.slice(1, 3), 16)).toBeGreaterThan(parseInt(t.m.slice(1, 3), 16))
    // 暗阶比中阶暗
    expect(parseInt(t.d.slice(1, 3), 16)).toBeLessThan(parseInt(t.m.slice(1, 3), 16))
    // 轮廓最深
    expect(parseInt(t.o.slice(1, 3), 16)).toBeLessThan(parseInt(t.d.slice(1, 3), 16))
  })

  it('非法颜色回退默认值', () => {
    const r = paintPixels(makeSpec({ primary: 'red', accent: 'zzz', secondary: '' }))
    expect(r.tones.m).toBe('#8b8b8b')
    expect(r.tones.A).toBe('#d4a017')
  })
})

describe('剑模板结构', () => {
  const r = paintPixels(makeSpec({ shape: 'sword', primary: '#c0c8d8', accent: '#802020' }))
  const grid = r.ascii.split('\n')

  it('刃为对角走向（右上区域有主体像素）', () => {
    expect(grid[1]).toContain('m')
    expect(grid[10]).toContain('m')
  })

  it('护手含点缀色 a/A', () => {
    expect(grid[11]).toMatch(/a|A/)
  })

  it('存在轮廓 o 与高光/亮阶', () => {
    expect(r.ascii).toContain('o')
    expect(r.ascii).toMatch(/l|h/)
  })

  it('像素值与色调表一致（刃核心 = 主色）', () => {
    // y=1 行核心线 x=14-1=13 是 'm' → pixels[1*16+13] === tones.m
    expect(grid[1][13]).toBe('m')
    expect(r.pixels[1 * 16 + 13]).toBe(r.tones.m)
  })

  it('透明像素为空串', () => {
    expect(r.pixels[0]).toBe('')
  })
})

describe('描边封闭性', () => {
  it('实心像素的透明 4 邻域必须是轮廓 o（8 邻域自动描边保证）', () => {
    for (const shape of PAINT_SHAPES) {
      const r = paintPixels(makeSpec({ shape }))
      const g = r.ascii.split('\n')
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const c = g[y][x]
          if (c === '.' || c === 'o') continue
          const neighbors: [number, number][] = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1]
          ]
          for (const [nx, ny] of neighbors) {
            if (nx < 0 || nx > 15 || ny < 0 || ny > 15) continue
            const nc = g[ny][nx]
            if (nc === '.') {
              expect.fail(`${shape}: 实心(${x},${y}) 的透明邻居(${nx},${ny})未描边`)
            }
          }
        }
      }
    }
  })
})

describe('validatePaintShape', () => {
  it('合法 shape 通过', () => {
    expect(validatePaintShape('sword')).toBe('sword')
    expect(validatePaintShape('gem')).toBe('gem')
  })

  it('非法 shape 返回 null', () => {
    expect(validatePaintShape('lightsaber')).toBeNull()
    expect(validatePaintShape(42)).toBeNull()
    expect(validatePaintShape(undefined)).toBeNull()
  })
})

describe('配色影响输出', () => {
  it('不同主色产出不同像素数组', () => {
    const a = paintPixels(makeSpec({ primary: '#c0c8d8' }))
    const b = paintPixels(makeSpec({ primary: '#703830' }))
    expect(a.pixels).not.toEqual(b.pixels)
    // 形状相同 → ASCII 相同
    expect(a.ascii).toBe(b.ascii)
  })
})
