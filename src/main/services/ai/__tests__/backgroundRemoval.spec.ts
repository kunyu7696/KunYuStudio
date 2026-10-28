/**
 * backgroundRemoval 单测（P2-1）：
 * 边缘主色检测、flood/global 两种移除模式、三重误检护栏、容差语义、
 * 手动背景色、PNG 便捷入口，以及 textureRepaint 管线集成（默认开启）。
 */
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import type { AiProviderConfig } from '../../../../shared/types/ai'
import {
  detectBackgroundColor,
  removeBackground,
  removeBackgroundFromPng
} from '../backgroundRemoval'
import { decodePng, encodePng, type Raster } from '../pixelize'
import { repaintTexture } from '../textureRepaint'

type Rgb = [number, number, number]

/** 按像素函数造栅格：fn(x,y) 返回 [r,g,b,a] */
function makeRaster(size: number, fn: (x: number, y: number) => [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = fn(x, y)
      const o = (y * size + x) * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = a
    }
  }
  return { width: size, height: size, data }
}

function solid(size: number, rgb: Rgb, alpha = 255): Raster {
  return makeRaster(size, () => [rgb[0], rgb[1], rgb[2], alpha])
}

/** 白底 + 中心红实心方块（红区 x,y ∈ [8,23]，32x32 下移除率 75%） */
function whiteBgRedCenter(size = 32): Raster {
  return makeRaster(size, (x, y) =>
    x >= 8 && x <= 23 && y >= 8 && y <= 23 ? [220, 30, 30, 255] : [255, 255, 255, 255]
  )
}

/** 白底 + 红环（x 或 y 等于 8/23）+ 内部白孤岛（被红环封闭包围） */
function whiteBgRedRingInnerWhite(size = 32): Raster {
  return makeRaster(size, (x, y) => {
    const onRing = (x === 8 || x === 23 || y === 8 || y === 23) && x >= 8 && x <= 23 && y >= 8 && y <= 23
    if (onRing) return [220, 30, 30, 255]
    return [255, 255, 255, 255]
  })
}

function alphaAt(r: Raster, x: number, y: number): number {
  return r.data[(y * r.width + x) * 4 + 3]!
}

function rgbAt(r: Raster, x: number, y: number): Rgb {
  const o = (y * r.width + x) * 4
  return [r.data[o]!, r.data[o + 1]!, r.data[o + 2]!]
}

describe('detectBackgroundColor', () => {
  it('白边 + 红中心 → 检出白色，置信度接近 1', () => {
    const d = detectBackgroundColor(whiteBgRedCenter())!
    expect(d.color).toEqual([255, 255, 255])
    expect(d.confidence).toBeGreaterThan(0.95)
  })

  it('边缘整圈透明 → null', () => {
    const r = makeRaster(16, (x, y) =>
      x === 0 || y === 0 || x === 15 || y === 15 ? [0, 0, 0, 0] : [200, 0, 0, 255]
    )
    expect(detectBackgroundColor(r)).toBeNull()
  })

  it('量化桶吸收轻微噪点：250~255 抖动的白底仍检出一个主色', () => {
    const r = makeRaster(32, (x, y) => {
      const onEdge = x === 0 || y === 0 || x === 31 || y === 31
      if (!onEdge) return [200, 0, 0, 255]
      const v = 250 + ((x + y) % 6) // 250..255
      return [v, v, v, 255]
    })
    const d = detectBackgroundColor(r)!
    expect(d.confidence).toBeGreaterThan(0.9)
    expect(d.color[0]).toBeGreaterThan(248)
  })
})

describe('removeBackground · flood 模式（默认）', () => {
  it('白底红块：白色透明、红块保留、移除率 75%', () => {
    const res = removeBackground(whiteBgRedCenter())
    expect(res.applied).toBe(true)
    expect(res.bgColor).toEqual([255, 255, 255])
    expect(res.removedRatio).toBeCloseTo(0.75, 2)
    expect(alphaAt(res.raster, 0, 0)).toBe(0) // 角落透明
    expect(alphaAt(res.raster, 16, 16)).toBe(255) // 中心红保留
    expect(rgbAt(res.raster, 16, 16)).toEqual([220, 30, 30])
  })

  it('红环封闭的白色孤岛不被误伤（与边缘不连通）', () => {
    const res = removeBackground(whiteBgRedRingInnerWhite())
    expect(res.applied).toBe(true)
    expect(alphaAt(res.raster, 0, 0)).toBe(0) // 外圈白被抠
    expect(alphaAt(res.raster, 15, 15)).toBe(255) // 内岛白保留
    expect(rgbAt(res.raster, 15, 15)).toEqual([255, 255, 255])
  })

  it('不原地修改输入栅格', () => {
    const src = whiteBgRedCenter()
    const before = alphaAt(src, 0, 0)
    removeBackground(src)
    expect(alphaAt(src, 0, 0)).toBe(before)
  })
})

describe('removeBackground · global 模式', () => {
  it('内部同色孤岛一并抠除（白占比 94%，需放宽移除率护栏）', () => {
    const res = removeBackground(whiteBgRedRingInnerWhite(), { mode: 'global', maxRemovalRatio: 0.99 })
    expect(res.applied).toBe(true)
    expect(alphaAt(res.raster, 0, 0)).toBe(0)
    expect(alphaAt(res.raster, 15, 15)).toBe(0) // 内岛白也被抠
    expect(alphaAt(res.raster, 8, 15)).toBe(255) // 红环保留
  })
})

describe('removeBackground · 误检护栏', () => {
  it('护栏①：全透明图 → 跳过', () => {
    const res = removeBackground(solid(16, [0, 0, 0], 0))
    expect(res.applied).toBe(false)
    expect(res.reason).toContain('全透明')
  })

  it('护栏②：边缘颜色杂乱（主色占比低于阈值）→ 跳过并说明占比', () => {
    // 8 色均匀分布在边缘 → 主色占比 12.5% < 20%
    const palette: Rgb[] = [
      [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],
      [255, 0, 255], [0, 255, 255], [128, 128, 128], [255, 128, 0]
    ]
    const r = makeRaster(16, (x, y) => {
      const edgeIdx = y === 0 ? x : y === 15 ? 16 + x : x === 0 ? 32 + y : 48 + y
      return [...palette[edgeIdx % 8]!, 255] as [number, number, number, number]
    })
    const res = removeBackground(r)
    expect(res.applied).toBe(false)
    expect(res.reason).toContain('边缘颜色杂乱')
    expect(res.reason).toContain('已保留原图')
  })

  it('护栏③：纯色图移除率 100% → 判误检，原图保留（贴图纯色也是合法内容）', () => {
    const res = removeBackground(solid(32, [220, 30, 30]))
    expect(res.applied).toBe(false)
    expect(res.reason).toContain('误检')
    expect(res.removedCount).toBe(0)
    expect(alphaAt(res.raster, 5, 5)).toBe(255) // 原样保留
  })

  it('边缘整圈透明（已抠过的图）→ 跳过', () => {
    const r = makeRaster(16, (x, y) =>
      x === 0 || y === 0 || x === 15 || y === 15 ? [0, 0, 0, 0] : [200, 0, 0, 255]
    )
    const res = removeBackground(r)
    expect(res.applied).toBe(false)
    expect(res.reason).toContain('已是透明')
  })

  it('找不到近似区域（容差外）→ 跳过并提示容差', () => {
    // 底色 250/255 交替：检测桶均值 ≈253；tolerance=0 时无精确匹配
    const r = makeRaster(32, (x, y) => {
      const v = (x + y) % 2 === 0 ? 255 : 250
      return [v, v, v, 255]
    })
    const res = removeBackground(r, { tolerance: 0 })
    expect(res.applied).toBe(false)
    expect(res.reason).toContain('容差')
  })
})

describe('removeBackground · 容差与手动背景色', () => {
  it('默认容差覆盖底色轻微噪点（250~255 交替全抠）', () => {
    // 红块 16x16=256px（移除率 75%，不触护栏）；底色 250/255 噪点
    const r = makeRaster(32, (x, y) => {
      if (x >= 8 && x <= 23 && y >= 8 && y <= 23) return [200, 0, 0, 255]
      const v = (x + y) % 2 === 0 ? 255 : 250
      return [v, v, v, 255]
    })
    const res = removeBackground(r)
    expect(res.applied).toBe(true)
    expect(alphaAt(res.raster, 0, 0)).toBe(0)
    expect(alphaAt(res.raster, 15, 15)).toBe(255)
  })

  it('手动 bgColor 绕过边缘检测（边缘杂乱也能抠指定色）', () => {
    // 边缘红蓝各半（置信度 50% 也能过护栏，这里用手动色验证绕过路径）
    const r = makeRaster(16, (x, y) => {
      const onEdge = x === 0 || y === 0 || x === 15 || y === 15
      if (onEdge) return x < 8 ? [255, 0, 0, 255] : [0, 0, 255, 255]
      return [0, 200, 0, 255]
    })
    const res = removeBackground(r, { bgColor: [255, 0, 0] })
    expect(res.applied).toBe(true)
    expect(res.bgColor).toEqual([255, 0, 0])
    expect(alphaAt(res.raster, 0, 0)).toBe(0) // 红边被抠
    expect(alphaAt(res.raster, 15, 15)).toBe(255) // 蓝边保留
    expect(alphaAt(res.raster, 8, 8)).toBe(255) // 中心绿保留
  })
})

describe('removeBackgroundFromPng', () => {
  it('applied 时返回抠底后的新 PNG；未 applied 时原样返回输入 buffer', () => {
    const sprite = encodePng(whiteBgRedCenter())
    const hit = removeBackgroundFromPng(sprite)
    expect(hit.result.applied).toBe(true)
    expect(hit.png.equals(sprite)).toBe(false)
    expect(alphaAt(decodePng(hit.png), 0, 0)).toBe(0)

    const solidPng = encodePng(solid(32, [220, 30, 30]))
    const miss = removeBackgroundFromPng(solidPng)
    expect(miss.result.applied).toBe(false)
    expect(miss.png).toBe(solidPng) // 原 buffer 引用，零开销
  })
})

// ---------------------------------------------------------------------------
// 管线集成：repaintTexture 默认开启背景移除（伪供应商）
// ---------------------------------------------------------------------------

function providerFor(port: number): AiProviderConfig {
  return {
    id: 'fake',
    name: '伪图商',
    kind: 'openai-compatible',
    baseUrl: `http://127.0.0.1:${port}`,
    apiKey: 'k',
    apiKeyUrl: '',
    model: 'm',
    imageModel: 'fake-img',
    maxTokens: 1,
    temperature: 0.7,
    enabled: true
  }
}

function startPngServer(pngDataUrl: string): Promise<{ port: number; stop: () => void }> {
  const b64 = pngDataUrl.split(',')[1]!
  return new Promise((resolve) => {
    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data: [{ b64_json: b64 }] }))
    })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      resolve({ port, stop: () => server.close() })
    })
  })
}

function rasterToDataUrl(r: Raster): string {
  return `data:image/png;base64,${encodePng(r).toString('base64')}`
}

describe('repaintTexture 集成背景移除', () => {
  it('白底红块 AI 图：默认抠底后像素化——角落透明、中心红保留', async () => {
    const server = await startPngServer(rasterToDataUrl(whiteBgRedCenter()))
    try {
      const result = await repaintTexture({
        sourceDataUrl: rasterToDataUrl(solid(16, [10, 10, 200])),
        prompt: '红色宝石',
        size: 16,
        provider: providerFor(server.port),
        pixelize: { dither: 'none', outline: false }
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const px = result.data.variants[0]!.pixels
      expect(px).toHaveLength(256)
      expect(px[0]).toBe('') // 左上角 = 原白底 → 透明
      // 中心红块（16x16 下中心区域）非空且红通道强于蓝
      const center = px[8 * 16 + 8]!
      expect(center).not.toBe('')
      expect(parseInt(center.slice(1, 3), 16)).toBeGreaterThan(parseInt(center.slice(5, 7), 16))
    } finally {
      server.stop()
    }
  })

  it('纯色 AI 图：护栏触发 → warning 说明误检，像素照旧（不抠）', async () => {
    const server = await startPngServer(rasterToDataUrl(solid(32, [220, 30, 30])))
    try {
      const result = await repaintTexture({
        sourceDataUrl: rasterToDataUrl(solid(16, [10, 10, 200])),
        prompt: '红色宝石',
        size: 16,
        provider: providerFor(server.port),
        pixelize: { dither: 'none', outline: false }
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.warnings.join('')).toContain('背景移除已跳过')
      expect(result.data.warnings.join('')).toContain('误检')
      const first = result.data.variants[0]!.pixels[0]!
      expect(first).not.toBe('') // 纯色红照旧量化
      expect(parseInt(first.slice(1, 3), 16)).toBeGreaterThan(parseInt(first.slice(5, 7), 16))
    } finally {
      server.stop()
    }
  })

  it('removeBackground:false → 白底保留（角落有颜色而非透明）', async () => {
    const server = await startPngServer(rasterToDataUrl(whiteBgRedCenter()))
    try {
      const result = await repaintTexture({
        sourceDataUrl: rasterToDataUrl(solid(16, [10, 10, 200])),
        prompt: '红色宝石',
        size: 16,
        provider: providerFor(server.port),
        removeBackground: false,
        pixelize: { dither: 'none', outline: false }
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const corner = result.data.variants[0]!.pixels[0]!
      expect(corner).not.toBe('') // 白底被量化成颜色而非透明
      expect(parseInt(corner.slice(1, 3), 16)).toBeGreaterThan(200)
    } finally {
      server.stop()
    }
  })
})
