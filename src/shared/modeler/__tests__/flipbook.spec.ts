/**
 * 贴图 flipbook 动画测试（B2-1，v2）。
 *
 * 核心不变量：
 * - 帧数：height = width × 帧数（≥2）才视为合法帧条，其余 → null；
 * - mcmeta：仅写有定义字段（interpolate 真值、frames 非空才落），深拷贝不共享引用；
 * - 校验：非帧条 / frametime 非法 / 帧序越界逐条报告，无动画 → 空表；
 * - 文档命令：setTextureAnimation 归一化写入、null 删键、未知 id 不动文档；
 * - javaBlock codec 往返：帧条贴图导出 asset 带 textureAnimation 且无尺寸告警，
 *   导入恢复帧条高度与动画元数据。
 */
import { describe, expect, it } from 'vitest'
import { buildTextureMcmeta, textureFrameCount, validateTextureAnimation } from '../flipbook'
import { addTexture, createDocument, setTextureAnimation } from '../document'
import { documentToModelAsset, modelAssetToDocument } from '../formats/javaBlock'
import type { ModelTexture } from '../types'

function tex(width: number, height: number, name = 't'): ModelTexture {
  return { id: `tex-${name}`, name, width, height, data: 'data:image/png;base64,x', visible: true }
}

describe('textureFrameCount', () => {
  it('帧条识别：整除且 ≥2 帧', () => {
    expect(textureFrameCount({ width: 16, height: 64 })).toBe(4)
    expect(textureFrameCount({ width: 16, height: 48 })).toBe(3)
    expect(textureFrameCount({ width: 32, height: 64 })).toBe(2)
  })

  it('非帧条：正方形 / 不整除 / 非法尺寸 → null', () => {
    expect(textureFrameCount({ width: 16, height: 16 })).toBeNull()
    expect(textureFrameCount({ width: 16, height: 50 })).toBeNull()
    expect(textureFrameCount({ width: 0, height: 64 })).toBeNull()
  })
})

describe('buildTextureMcmeta', () => {
  it('无动画 → null；最小字段仅 frametime', () => {
    expect(buildTextureMcmeta(undefined)).toBeNull()
    expect(buildTextureMcmeta({ frametime: 2 })).toEqual({ animation: { frametime: 2 } })
  })

  it('可选字段仅真值/非空写入，frames 深拷贝', () => {
    expect(buildTextureMcmeta({ frametime: 1, interpolate: false, frames: [] })).toEqual({
      animation: { frametime: 1 }
    })
    const frames = [2, 1, 0]
    const out = buildTextureMcmeta({ frametime: 3, interpolate: true, frames })
    expect(out).toEqual({ animation: { frametime: 3, interpolate: true, frames: [2, 1, 0] } })
    frames.push(9)
    expect(out!.animation.frames).toEqual([2, 1, 0])
  })
})

describe('validateTextureAnimation', () => {
  it('无动画 → 空表；合法帧条 → 空表', () => {
    expect(validateTextureAnimation(tex(16, 16))).toEqual([])
    const t = { ...tex(16, 64), animation: { frametime: 2 } }
    expect(validateTextureAnimation(t)).toEqual([])
  })

  it('逐类报告：非帧条 / frametime 非法 / 帧序越界', () => {
    const notStrip = { ...tex(16, 16), animation: { frametime: 2 } }
    expect(validateTextureAnimation(notStrip).map((i) => i.code)).toEqual(['animation_not_strip'])

    const badTime = { ...tex(16, 64), animation: { frametime: 1.5 } }
    expect(validateTextureAnimation(badTime).map((i) => i.code)).toEqual(['animation_frametime_invalid'])

    const badFrames = { ...tex(16, 64), animation: { frametime: 1, frames: [0, 4, -1] } }
    expect(validateTextureAnimation(badFrames).map((i) => i.code)).toEqual([
      'animation_frame_out_of_range'
    ])
  })
})

describe('setTextureAnimation 文档命令', () => {
  it('写入归一化（interpolate:false / frames:[] 丢弃），null 删键', () => {
    let doc = createDocument({ name: 't', format: 'java_block' })
    doc = addTexture(doc, tex(16, 64))
    doc = setTextureAnimation(doc, 'tex-t', { frametime: 2, interpolate: false, frames: [] })
    expect(doc.textures['tex-t']!.animation).toEqual({ frametime: 2 })
    doc = setTextureAnimation(doc, 'tex-t', { frametime: 4, interpolate: true, frames: [1, 0] })
    expect(doc.textures['tex-t']!.animation).toEqual({ frametime: 4, interpolate: true, frames: [1, 0] })
    doc = setTextureAnimation(doc, 'tex-t', null)
    expect(doc.textures['tex-t']!.animation).toBeUndefined()
    expect('animation' in doc.textures['tex-t']!).toBe(false)
  })

  it('未知贴图 id → 文档原样返回', () => {
    const doc = createDocument({ name: 't', format: 'java_block' })
    expect(setTextureAnimation(doc, 'tex-ghost', { frametime: 1 })).toBe(doc)
  })
})

describe('javaBlock codec 往返', () => {
  const pixels16x64 = Array.from({ length: 16 * 64 }, () => '#112233')

  function stripDoc() {
    let doc = createDocument({ id: 'm1', name: 't', format: 'java_block' })
    const t = { ...tex(16, 64), animation: { frametime: 2, interpolate: true } }
    return addTexture(doc, t)
  }

  it('导出：帧条带 textureAnimation，无 texture_size_clamped 告警', () => {
    const { output, downgrades } = documentToModelAsset(stripDoc(), {
      resolvePixels: () => pixels16x64
    })
    expect(output.textureAnimation).toEqual({ frametime: 2, interpolate: true })
    expect(output.pixels).toHaveLength(16 * 64)
    expect(downgrades.some((d) => d.code === 'texture_size_clamped')).toBe(false)
  })

  it('导入：恢复帧条高度与动画元数据', () => {
    const { output } = documentToModelAsset(stripDoc(), { resolvePixels: () => pixels16x64 })
    const { doc } = modelAssetToDocument(output, { encodePixels: () => 'data:image/png;base64,y' })
    const imported = Object.values(doc.textures)[0]!
    expect(imported.width).toBe(16)
    expect(imported.height).toBe(64)
    expect(imported.animation).toEqual({ frametime: 2, interpolate: true })
  })
})
