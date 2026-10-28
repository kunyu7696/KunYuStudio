/**
 * textureRepaint 单测：提示词约束、mask 纯函数合成、端到端伪供应商像素化。
 */
import { describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import { PNG } from 'pngjs'
import type { AiProviderConfig } from '../../../../shared/types/ai'
import {
  applyMask,
  buildRepaintPrompt,
  maskToRepaintFlags,
  repaintTexture
} from '../textureRepaint'

function solidPng(size: number, rgb: [number, number, number], alpha = 255): string {
  const png = new PNG({ width: size, height: size })
  for (let i = 0; i < size * size; i++) {
    png.data[i * 4] = rgb[0]
    png.data[i * 4 + 1] = rgb[1]
    png.data[i * 4 + 2] = rgb[2]
    png.data[i * 4 + 3] = alpha
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}

/** 左半红（重绘区）右半黑（保留区）的 mask。 */
function halfMaskPng(size: number): string {
  const png = new PNG({ width: size, height: size })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const repaint = x < size / 2
      png.data[i] = repaint ? 255 : 0
      png.data[i + 1] = 0
      png.data[i + 2] = 0
      png.data[i + 3] = 255
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`
}

describe('buildRepaintPrompt', () => {
  it('追加 Minecraft 像素风硬约束并带尺寸', () => {
    const p = buildRepPromptSafe('一把寒冰剑', 16)
    expect(p).toContain('一把寒冰剑')
    expect(p).toContain('16x16')
    expect(p).toMatch(/pixel art/i)
    expect(p).toMatch(/no anti-aliasing/i)
  })
})

function buildRepPromptSafe(p: string, s: 16 | 32): string {
  return buildRepaintPrompt(p, s)
}

describe('applyMask', () => {
  it('null 区域保留 base，repaint 区域采用 overlay', () => {
    const size = 2
    const base = ['#111111', '#222222', '#333333', '#444444']
    const overlay = ['#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd']
    const { pixels } = applyMask(size, base, overlay, [true, false, true, false])
    expect(pixels).toEqual(['#aaaaaa', '#222222', '#cccccc', '#444444'])
  })

  it('全黑 mask：整体保留 base 并告警', () => {
    const { pixels, warnings } = applyMask(1, ['#123456'], ['#654321'], [false])
    expect(pixels).toEqual(['#123456'])
    expect(warnings.join('')).toContain('没有任何可重绘区域')
  })

  it('全白 mask：等同整图重绘并告警', () => {
    const { pixels, warnings } = applyMask(1, ['#123456'], ['#654321'], [true])
    expect(pixels).toEqual(['#654321'])
    expect(warnings.join('')).toContain('覆盖整张')
  })
})

describe('maskToRepaintFlags', () => {
  it('左半为 true 右半为 false（红通道阈值 128）', () => {
    const flags = maskToRepaintFlags(halfMaskPng(16), 16)
    expect(flags).toHaveLength(256)
    expect(flags[0]).toBe(true) // 左上
    expect(flags[15]).toBe(false) // 右上
  })
})

describe('repaintTexture 端到端（伪供应商）', () => {
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

  it('整图重绘：返回 16x16 像素 + dataUrl + ASCII', async () => {
    const server = await startPngServer(solidPng(32, [220, 30, 30]))
    try {
      const result = await repaintTexture({
        sourceDataUrl: solidPng(16, [10, 10, 200]),
        prompt: '红色宝石',
        size: 16,
        provider: providerFor(server.port),
        pixelize: { dither: 'none', outline: false }
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.size).toBe(16)
      expect(result.data.variants[0]?.pixels).toHaveLength(256)
      expect(result.data.variants[0]?.dataUrl).toMatch(/^data:image\/png;base64,/)
      // 源为蓝、AI 出图为红：量化后首像素红通道应明显强于蓝
      const first = result.data.variants[0]!.pixels[0]!
      expect(parseInt(first.slice(1, 3), 16)).toBeGreaterThan(parseInt(first.slice(5, 7), 16))
    } finally {
      server.stop()
    }
  })

  it('局部 mask：右半保留源贴图蓝色，左半被红图覆盖', async () => {
    const server = await startPngServer(solidPng(32, [220, 30, 30]))
    try {
      const result = await repaintTexture({
        sourceDataUrl: solidPng(16, [30, 30, 220]),
        maskDataUrl: halfMaskPng(16),
        prompt: '红色左半',
        size: 16,
        provider: providerFor(server.port),
        pixelize: { dither: 'none', outline: false }
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const px = result.data.variants[0]!.pixels
      const left = px[0]!
      const right = px[15]!
      expect(parseInt(left.slice(1, 3), 16)).toBeGreaterThan(parseInt(left.slice(5, 7), 16))
      expect(parseInt(right.slice(5, 7), 16)).toBeGreaterThan(parseInt(right.slice(1, 3), 16))
    } finally {
      server.stop()
    }
  })

  it('候选带 sourceToken：注入假 sourceCache，不依赖全局状态', async () => {
    const server = await startPngServer(solidPng(32, [10, 200, 10]))
    const stored: string[] = []
    try {
      const result = await repaintTexture({
        sourceDataUrl: solidPng(16, [0, 0, 0]),
        prompt: '绿色宝石',
        size: 16,
        provider: providerFor(server.port),
        pixelize: { dither: 'none', outline: false },
        sourceCache: {
          put: (dataUrl: string): string => {
            stored.push(dataUrl)
            return `tok-${stored.length}`
          }
        }
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.variants[0]?.sourceToken).toBe('tok-1')
      // 存入的是 AI 大图（PNG data URL），供本地重跑回放
      expect(stored).toHaveLength(1)
      expect(stored[0]).toMatch(/^data:image\/png;base64,/)
    } finally {
      server.stop()
    }
  })

  it('源非 PNG data URL → config 失败', async () => {
    const result = await repaintTexture({
      sourceDataUrl: 'data:image/jpeg;base64,AAAA',
      prompt: 'x',
      size: 16,
      provider: providerFor(1)
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorKind).toBe('config')
  })

  it('语义 maskFlags（IPC 画廊路径）：右半保留源蓝、左半被红覆盖', async () => {
    const server = await startPngServer(solidPng(32, [220, 30, 30]))
    try {
      const flags = new Array(256).fill(false).map((_, i) => i % 16 < 8)
      const result = await repaintTexture({
        sourceDataUrl: solidPng(16, [30, 30, 220]),
        maskFlags: flags,
        prompt: '红色左半',
        size: 16,
        provider: providerFor(server.port),
        pixelize: { dither: 'none', outline: false }
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const px = result.data.variants[0]!.pixels
      const left = px[0]!
      const right = px[15]!
      expect(parseInt(left.slice(1, 3), 16)).toBeGreaterThan(parseInt(left.slice(5, 7), 16))
      expect(parseInt(right.slice(5, 7), 16)).toBeGreaterThan(parseInt(right.slice(1, 3), 16))
    } finally {
      server.stop()
    }
  })

  it('供应商未配图像模型 → config 失败（引导用户去设置）', async () => {
    const result = await repaintTexture({
      sourceDataUrl: solidPng(16, [0, 0, 0]),
      prompt: 'x',
      size: 16,
      provider: { ...providerFor(1), imageModel: '' }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorKind).toBe('config')
      expect(result.errorMessage).toContain('图像模型')
    }
  })
})
