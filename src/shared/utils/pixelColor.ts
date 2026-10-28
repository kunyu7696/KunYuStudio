/**
 * 像素颜色纯函数层（贴图 / 画廊 / 建模绘画共用）。
 *
 * 像素模型统一为字符串数组（`''` 透明，`'#rrggbb'` 不透明，`'#rrggbbaa'` 带透明度），
 * 本模块是解析 / 格式化 / 源覆盖合成的唯一实现，main 与 renderer 两侧共用，
 * 避免各处各写一份 6 位正则导致 8 位色被误判。
 */

export interface Rgba {
  /** 0-255 */
  r: number
  g: number
  b: number
  /** 0-255，0 = 完全透明 */
  a: number
}

const HEX6 = /^#[0-9a-fA-F]{6}$/
const HEX8 = /^#[0-9a-fA-F]{8}$/

/** 解析 "#rrggbb" / "#rrggbbaa"；空串与非法值返回 null（null = 透明） */
export function parsePixel(value: string): Rgba | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!HEX6.test(v) && !HEX8.test(v)) return null
  return {
    r: parseInt(v.slice(1, 3), 16),
    g: parseInt(v.slice(3, 5), 16),
    b: parseInt(v.slice(5, 7), 16),
    a: v.length === 9 ? parseInt(v.slice(7, 9), 16) : 255
  }
}

/** 是否为合法像素值（空串算合法：表示透明） */
export function isPixelValue(value: string): boolean {
  return value === '' || HEX6.test(value) || HEX8.test(value)
}

/** 是否为带透明度的像素值（8 位） */
export function hasAlpha(value: string): boolean {
  return HEX8.test(value)
}

function hex2(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
}

/** RGBA → 像素值：a=0 → ''（透明）；a=255 → 6 位；其余 → 8 位 */
export function formatPixel(c: Rgba): string {
  if (c.a <= 0) return ''
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`
  return c.a >= 255 ? base : `${base}${hex2(c.a)}`
}

/**
 * 源覆盖合成（贴图绘画 / AI 重绘落笔用）：把 color 以 opacity（0-1）刷到 existing 之上。
 * - existing 为 `''` 或非法 → 视为全透明底
 * - color 自带 alpha 时与 opacity 相乘
 * - 结果全透明返回 `''`
 */
export function blendPixel(existing: string, color: string, opacity = 1): string {
  const src = parsePixel(color)
  if (!src) return isPixelValue(existing) ? existing : ''
  const op = Math.max(0, Math.min(1, opacity))
  const sa = Math.round(src.a * op)
  if (sa <= 0) return isPixelValue(existing) ? existing : ''
  if (sa >= 255) return formatPixel({ r: src.r, g: src.g, b: src.b, a: 255 })

  const dst = parsePixel(existing) ?? { r: 0, g: 0, b: 0, a: 0 }
  const da = Math.round(dst.a * (255 - sa) / 255)
  const outA = sa + da
  if (outA <= 0) return ''
  // 非预乘的 source-over：out = (src*sa + dst*da) / outA
  return formatPixel({
    r: (src.r * sa + dst.r * da) / outA,
    g: (src.g * sa + dst.g * da) / outA,
    b: (src.b * sa + dst.b * da) / outA,
    a: outA
  })
}
