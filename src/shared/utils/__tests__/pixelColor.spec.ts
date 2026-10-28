import { describe, expect, it } from 'vitest'
import {
  blendPixel,
  formatPixel,
  hasAlpha,
  isPixelValue,
  parsePixel
} from '../pixelColor'

describe('pixelColor', () => {
  it('parsePixel 解析 6 位 hex（alpha 缺省 255）与 8 位 hex', () => {
    expect(parsePixel('#123456')).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 255 })
    expect(parsePixel('#12345680')).toEqual({ r: 0x12, g: 0x34, b: 0x56, a: 0x80 })
    expect(parsePixel('#ABCDEF')).toEqual({ r: 0xab, g: 0xcd, b: 0xef, a: 255 })
  })

  it('parsePixel 对空串与非法值返回 null', () => {
    expect(parsePixel('')).toBeNull()
    expect(parsePixel('#12345')).toBeNull()
    expect(parsePixel('123456')).toBeNull()
    expect(parsePixel('#123456789')).toBeNull()
    expect(parsePixel('#gggggg')).toBeNull()
  })

  it('isPixelValue / hasAlpha 判定', () => {
    expect(isPixelValue('')).toBe(true)
    expect(isPixelValue('#ffffff')).toBe(true)
    expect(isPixelValue('#ffffff00')).toBe(true)
    expect(isPixelValue('#fff')).toBe(false)
    expect(hasAlpha('#ffffff00')).toBe(true)
    expect(hasAlpha('#ffffff')).toBe(false)
  })

  it('formatPixel：a=0 → 透明串，a=255 → 6 位，其余 → 8 位', () => {
    expect(formatPixel({ r: 1, g: 2, b: 3, a: 0 })).toBe('')
    expect(formatPixel({ r: 255, g: 128, b: 0, a: 255 })).toBe('#ff8000')
    expect(formatPixel({ r: 255, g: 128, b: 0, a: 128 })).toBe('#ff800080')
  })

  it('blendPixel：不透明度 1 全不透明覆盖', () => {
    expect(blendPixel('#000000', '#ff0000', 1)).toBe('#ff0000')
  })

  it('blendPixel：0.5 刷到透明底 → 半透明像素', () => {
    expect(blendPixel('', '#ff0000', 0.5)).toBe('#ff000080')
  })

  it('blendPixel：0.5 叠加到已有不透明色 → 按权重混合', () => {
    // 白 50% 刷到黑上 = 50% 灰，alpha 回满 255
    expect(blendPixel('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('blendPixel：opacity=0 不改变原像素', () => {
    expect(blendPixel('#123456', '#ffffff', 0)).toBe('#123456')
    expect(blendPixel('', '#ffffff', 0)).toBe('')
  })

  it('blendPixel：源色自带 alpha 时与 opacity 相乘', () => {
    // 源 alpha 128 × opacity 0.5 = 64
    expect(blendPixel('', '#ff000080', 0.5)).toBe('#ff000040')
  })

  it('blendPixel：叠加到已有半透明像素上 alpha 不回退', () => {
    const out = blendPixel('#ff0000ff', '#0000ff', 0.5)
    const c = parsePixel(out)
    expect(c).not.toBeNull()
    expect(c!.a).toBe(255)
  })

  it('blendPixel：非法源色 / 非法底色不炸，尽量原样保留', () => {
    expect(blendPixel('#123456', 'oops', 1)).toBe('#123456')
    expect(blendPixel('oops', 'oops', 1)).toBe('')
  })
})
