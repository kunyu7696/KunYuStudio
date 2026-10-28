import { describe, expect, it } from 'vitest'
import {
  dataUrlToPngBuffer,
  decodePng,
  downsample,
  encodePng,
  pixelizeDataUrl,
  pixelizePng,
  type Raster
} from '../pixelize'

/** 构造 RGBA 栅格 */
function raster(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = paint(x, y)
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return { width, height, data }
}

function pngOf(r: Raster): Buffer {
  return encodePng(r)
}

describe('pixelize 编码/降采样', () => {
  it('encode→decode 往返尺寸与像素一致', () => {
    const r = raster(4, 3, (x, y) => [x * 60, y * 80, 10, 255])
    const back = decodePng(pngOf(r))
    expect(back.width).toBe(4)
    expect(back.height).toBe(3)
    expect(Array.from(back.data.slice(0, 4))).toEqual([0, 0, 10, 255])
  })

  it('区域平均降采样：2x2 同色块收敛为该色', () => {
    const r = raster(2, 2, () => [200, 100, 50, 255])
    const small = downsample(r, 1, 'area')
    expect(small.width).toBe(1)
    expect(small.data[0]).toBe(200)
    expect(small.data[1]).toBe(100)
    expect(small.data[2]).toBe(50)
    expect(small.data[3]).toBe(255)
  })

  it('最近邻降采样保留硬边', () => {
    const r = raster(2, 2, (x) => (x === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
    const small = downsample(r, 2, 'nearest')
    expect(small.data[0]).toBe(0)
    expect(small.data[4]).toBe(255)
  })

  it('nearest 温和缩比（每目标 ≤4 源像素）仍为纯点采样，不走区域平均', () => {
    // 8→2 缩比恰为 4（阈值边界，不触发预降）：1px 棋盘格点采样落到全黑采样点
    const checker = raster(8, 8, (x, y) =>
      (x + y) % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]
    )
    const small = downsample(checker, 2, 'nearest')
    expect(small.data[0]).toBe(0)
  })

  it('nearest 极端缩比（>4）先区域平均再点采样：棋盘格不塌成全黑', () => {
    // 16→2 缩比 8，纯点采样每像素只取 1/64 个源像素，中心采样点全为黑色；
    // 分级降采样先 area 到 4×4（棋盘格均值≈128 灰）再 nearest，大块明暗信息保留。
    const checker = raster(16, 16, (x, y) =>
      (x + y) % 2 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]
    )
    const small = downsample(checker, 2, 'nearest')
    expect(small.data[0]).toBeGreaterThan(90)
    expect(small.data[0]).toBeLessThan(170)
    // 硬边仍保留：左黑右白的二值栅格在极端缩比下仍维持 0/255 对比
    const halves = raster(16, 16, (x) => (x < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
    const edge = downsample(halves, 2, 'nearest')
    expect(edge.data[0]).toBe(0)
    expect(edge.data[12]).toBe(255)
  })

  it('半透明边缘不发黑（预乘平均）', () => {
    const r = raster(2, 1, () => [255, 0, 0, 0])
    r.data[3] = 128
    const small = downsample(r, 1, 'area')
    expect(small.data[0]).toBe(255)
    expect(small.data[3]).toBe(64)
  })
})

describe('pixelizePng 完整管线', () => {
  it('纯色大图 → 16x16 单色，pixels 长度与调色板正确', () => {
    const buf = pngOf(raster(64, 64, () => [40, 120, 200, 255]))
    const res = pixelizePng(buf, { size: 16, maxColors: 8, outline: false })
    expect(res.size).toBe(16)
    expect(res.pixels).toHaveLength(256)
    expect(res.pixels.every((p) => p !== '')).toBe(true)
    expect(new Set(res.pixels).size).toBe(1)
    expect(res.palette).toHaveLength(1)
  })

  it('透明像素保持透明', () => {
    const buf = pngOf(raster(32, 32, (x, y) =>
      x < 16 && y < 16 ? [255, 255, 255, 255] : [0, 0, 0, 0]))
    const res = pixelizePng(buf, { size: 16, outline: false, dither: 'none' })
    const opaqueCount = res.pixels.filter((p) => p !== '').length
    expect(opaqueCount).toBe(64) // 左上四分之一
    expect(res.png.length).toBeGreaterThan(8)
  })

  it('多色彩图调色板不超过 maxColors', () => {
    const buf = pngOf(
      raster(32, 32, (x, y) => [(x * 8) % 256, (y * 8) % 256, ((x + y) * 4) % 256, 255])
    )
    const res = pixelizePng(buf, { size: 32, maxColors: 12, dither: 'none', outline: false })
    expect(res.palette.length).toBeLessThanOrEqual(12)
    expect(res.pixels).toHaveLength(1024)
  })

  it('抖动与不抖动两种模式均可产出', () => {
    const buf = pngOf(raster(16, 16, (x) => [x * 16, 80, 160, 255]))
    const d = pixelizePng(buf, { size: 16, maxColors: 4, dither: 'floyd', outline: false })
    const n = pixelizePng(buf, { size: 16, maxColors: 4, dither: 'none', outline: false })
    expect(d.pixels.every((p) => /^#[0-9a-f]{6}$/.test(p))).toBe(true)
    expect(n.pixels.every((p) => /^#[0-9a-f]{6}$/.test(p))).toBe(true)
  })

  it('描边仅压暗边缘，同色内部像素保持原色', () => {
    // 16x16 中 8x8 纯白实心方块（居中），其余透明；量化为单白
    const buf = pngOf(raster(32, 32, (x, y) =>
      x >= 12 && x < 20 && y >= 12 && y < 20 ? [255, 255, 255, 255] : [0, 0, 0, 0]))
    const res = pixelizePng(buf, { size: 16, maxColors: 4, dither: 'none', outline: true, outlineFactor: 0.5 })
    // 降采样后中心 4x4 为不透明：边缘 12 个暗、内部 4 个亮
    const lum = res.pixels
      .filter((p) => p !== '')
      .map((hex) => parseInt(hex.slice(1, 3), 16))
    const bright = lum.filter((v) => v > 200)
    const dark = lum.filter((v) => v < 180)
    expect(bright.length).toBe(4)
    expect(dark.length).toBe(12)
  })

  it('ASCII 行数等于 size 且透明位为空格', () => {
    const buf = pngOf(raster(16, 16, (x) => (x < 8 ? [255, 255, 255, 255] : [0, 0, 0, 0])))
    const res = pixelizePng(buf, { size: 16, outline: false })
    const lines = res.ascii.split('\n')
    expect(lines).toHaveLength(16)
    expect(lines[0].slice(0, 8)).not.toContain(' ')
  })

  it('data URL 入口往返 PNG 可再解码', () => {
    const res = pixelizeDataUrl(
      `data:image/png;base64,${pngOf(raster(8, 8, () => [10, 20, 30, 255])).toString('base64')}`,
      { size: 16, outline: false }
    )
    expect(decodePng(res.png).width).toBe(16)
  })

  it('非法 data URL 抛错', () => {
    expect(() => dataUrlToPngBuffer('not-a-data-url')).toThrow()
    expect(() => dataUrlToPngBuffer('data:image/jpeg;base64,AAAA')).toThrow(/PNG/)
  })
})

describe('pixelizePng 固定色板（项目级色板锁定）', () => {
  it('给定固定色板：跳过 median-cut，全部像素落在合法色板内（非法项忽略）', () => {
    const buf = pngOf(raster(64, 64, (x, y) => [(x * 4) % 256, (y * 4) % 256, 128, 255]))
    const res = pixelizePng(buf, {
      size: 16,
      palette: ['#ff0000', '#00ff00', 'not-a-color', '#12345'],
      dither: 'none',
      outline: false
    })
    const allowed = new Set(['#ff0000', '#00ff00'])
    expect(res.pixels.every((p) => allowed.has(p))).toBe(true)
    expect(res.palette.every((c) => allowed.has(c))).toBe(true)
  })

  it('固定色板 + 抖动：像素仍只取色板内颜色', () => {
    const buf = pngOf(raster(32, 32, (x) => [x * 8, 60, 200, 255]))
    const res = pixelizePng(buf, {
      size: 16,
      palette: ['#000000', '#ffffff'],
      dither: 'floyd',
      outline: false
    })
    const allowed = new Set(['#000000', '#ffffff'])
    expect(res.pixels.every((p) => allowed.has(p))).toBe(true)
  })

  it('不给色板：回退 median-cut（单色图收敛为该色）', () => {
    const buf = pngOf(raster(64, 64, () => [40, 120, 200, 255]))
    const res = pixelizePng(buf, { size: 16, maxColors: 8, outline: false })
    expect(res.palette).toEqual(['#2878c8'])
  })

  it('空色板数组等价于未给色板（回退 median-cut）', () => {
    const buf = pngOf(raster(64, 64, () => [40, 120, 200, 255]))
    const res = pixelizePng(buf, { size: 16, palette: [], maxColors: 8, outline: false })
    expect(res.palette).toEqual(['#2878c8'])
  })

  it('固定色板改变量化结果：超出色板的颜色被压到最近色', () => {
    const buf = pngOf(raster(64, 64, () => [40, 120, 200, 255]))
    const res = pixelizePng(buf, { size: 16, palette: ['#000000'], dither: 'none', outline: false })
    expect(res.pixels.every((p) => p === '#000000')).toBe(true)
  })
})
