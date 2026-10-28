/**
 * 材质语义结构测试：默认值、规范化、校验、尺寸调整与像素规范化。
 */
import { describe, expect, it } from 'vitest'
import {
  createDefaultTexture,
  normalizePixel,
  normalizeTextureSchema,
  resizePixels,
  validateTextureSchema
} from '../texture.schema'

describe('normalizePixel', () => {
  it('接受 #rrggbb 与无 # 前缀并转小写', () => {
    expect(normalizePixel('#FF8800')).toBe('#ff8800')
    expect(normalizePixel('ff8800')).toBe('#ff8800')
  })

  it('非法值转透明', () => {
    expect(normalizePixel('')).toBe('')
    expect(normalizePixel('red')).toBe('')
    expect(normalizePixel('#ff')).toBe('')
    expect(normalizePixel(undefined as unknown as string)).toBe('')
  })
})

describe('createDefaultTexture', () => {
  it('默认 16×16 全透明，kind 为 texture', () => {
    const t = createDefaultTexture('ruby_ore')
    expect(t.kind).toBe('texture')
    expect(t.width).toBe(16)
    expect(t.height).toBe(16)
    expect(t.pixels).toHaveLength(256)
    expect(t.pixels.every((p) => p === '')).toBe(true)
  })

  it('空 ID 兜底 new_texture', () => {
    expect(createDefaultTexture('').id).toBe('new_texture')
  })
})

describe('normalizeTextureSchema', () => {
  it('像素规范化并校正长度', () => {
    const t = createDefaultTexture('a')
    t.pixels[0] = 'FF8800'
    t.pixels[1] = 'not-hex'
    t.pixels.length = 10 // 人为破坏长度
    const n = normalizeTextureSchema(t)
    expect(n.pixels[0]).toBe('#ff8800')
    expect(n.pixels[1]).toBe('')
    expect(n.pixels).toHaveLength(256)
  })

  it('非法尺寸回退 16', () => {
    const t = createDefaultTexture('a')
    t.width = 33
    const n = normalizeTextureSchema(t)
    expect(n.width).toBe(16)
  })
})

describe('validateTextureSchema', () => {
  it('合法默认值通过', () => {
    expect(validateTextureSchema(createDefaultTexture('ruby_ore'))).toBeNull()
  })

  it('非法 ID / 空 displayName / 像素长度不匹配报错', () => {
    const a = createDefaultTexture('Bad-ID')
    expect(validateTextureSchema(a)).toContain('注册名')
    const b = createDefaultTexture('ruby')
    b.displayName = ''
    expect(validateTextureSchema(b)).toContain('显示名称')
    const c = createDefaultTexture('ruby')
    c.pixels = []
    expect(validateTextureSchema(c)).toContain('像素数据长度')
  })
})

describe('resizePixels', () => {
  it('尺寸不变返回原引用', () => {
    const pixels = new Array(4).fill('#000000')
    expect(resizePixels(pixels, { width: 2, height: 2 }, { width: 2, height: 2 })).toBe(pixels)
  })

  it('放大保留左上角重叠区域', () => {
    const pixels = ['#aa0000', '', '', '#00aa00'] // 2×2
    const next = resizePixels(pixels, { width: 2, height: 2 }, { width: 3, height: 3 })
    expect(next).toHaveLength(9)
    expect(next[0]).toBe('#aa0000')
    expect(next[4]).toBe('#00aa00')
    expect(next[8]).toBe('')
  })

  it('缩小丢弃越界像素', () => {
    const pixels = new Array(16).fill('#112233') // 4×4
    const next = resizePixels(pixels, { width: 4, height: 4 }, { width: 2, height: 2 })
    expect(next).toHaveLength(4)
    expect(next.every((p) => p === '#112233')).toBe(true)
  })
})
