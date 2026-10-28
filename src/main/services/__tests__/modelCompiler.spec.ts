import { describe, expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import {
  compileModelToMcJson,
  hasModelError,
  pixelsToPng,
  toTextureRef,
  validateModel,
  type McModelJson
} from '../modelCompiler'
import { createDefaultModel, type ModelAsset } from '../../../shared/types/content'

function makeModel(overrides: Partial<ModelAsset> = {}): ModelAsset {
  return { ...createDefaultModel('ruby_crate'), ...overrides }
}

describe('toTextureRef', () => {
  it('相对路径 → modid 纹理引用', () => {
    expect(toTextureRef('testmod', 'textures/model/ruby_crate.png')).toBe('testmod:model/ruby_crate')
    expect(toTextureRef('tm', 'textures/block/x.png')).toBe('tm:block/x')
  })
})

describe('compileModelToMcJson', () => {
  it('默认模型：六面 #all + 纹理加前缀 + 16 尺寸不输出 texture_size', () => {
    const json = compileModelToMcJson(makeModel(), 'testmod')
    expect(json.textures).toEqual({ all: 'testmod:model/ruby_crate', particle: 'testmod:model/ruby_crate' })
    expect(json.texture_size).toBeUndefined()
    const el0 = json.elements[0] as { faces: Record<string, { texture: string; uv: number[] }> }
    expect(el0.faces.north.texture).toBe('#all')
    expect(el0.faces.north.uv).toEqual([0, 0, 16, 16])
    expect(Object.keys(el0.faces).sort()).toEqual(['down', 'east', 'north', 'south', 'up', 'west'])
    // 不输出 Blockbench 私有 name 字段
    expect(json.elements[0]).not.toHaveProperty('name')
    // shade=true 是原版默认，省略
    expect(json.elements[0]).not.toHaveProperty('shade')
    // display.gui 直传
    expect(json.display?.gui?.rotation).toEqual([30, 225, 0])
  })

  it('32 尺寸输出 texture_size；ambientOcclusion=false 输出 ambientocclusion', () => {
    const json = compileModelToMcJson(makeModel({ textureSize: 32, pixels: Array(1024).fill(''), ambientOcclusion: false }), 'tm')
    expect(json.texture_size).toEqual([32, 32])
    expect(json.ambientocclusion).toBe(false)
  })

  it('剔面在输出中缺键；shade=false 与 face rotation 输出', () => {
    const m = makeModel()
    delete m.elements[0].faces.south
    m.elements[0].shade = false
    m.elements[0].faces.north!.rotation = 90
    const json = compileModelToMcJson(m, 'tm')
    const faces = (json.elements[0] as { faces: Record<string, unknown> }).faces
    expect(faces.south).toBeUndefined()
    expect((faces.north as { rotation: number }).rotation).toBe(90)
    expect(json.elements[0]).toHaveProperty('shade', false)
  })

  it('旋转元素输出 origin/axis/angle，rescale 仅 true 时出现', () => {
    const m = makeModel()
    m.elements[0].rotation = { origin: [8, 8, 8], axis: 'y', angle: 22.5 }
    let json: McModelJson = compileModelToMcJson(m, 'tm')
    let rot = json.elements[0].rotation as Record<string, unknown>
    expect(rot).toEqual({ origin: [8, 8, 8], axis: 'y', angle: 22.5 })
    expect(rot).not.toHaveProperty('rescale')

    m.elements[0].rotation.rescale = true
    json = compileModelToMcJson(m, 'tm')
    rot = json.elements[0].rotation as Record<string, unknown>
    expect(rot.rescale).toBe(true)
  })

  it('多纹理变量全部映射', () => {
    const m = makeModel()
    m.textures = { all: 'textures/model/ruby_crate.png', side: 'textures/model/side.png' }
    m.elements[0].faces.north!.texture = 'side'
    const json = compileModelToMcJson(m, 'tm')
    expect(json.textures.side).toBe('tm:model/side')
    expect(
      (json.elements[0] as { faces: Record<string, { texture: string }> }).faces.north.texture
    ).toBe('#side')
  })
})

describe('validateModel', () => {
  it('默认模型零诊断', () => {
    expect(validateModel(makeModel())).toHaveLength(0)
  })

  it('像素长度不符为 error', () => {
    const diags = validateModel(makeModel({ pixels: ['#fff'] }))
    expect(diags.some((d) => d.code === 'pixels_length' && d.severity === 'error')).toBe(true)
  })

  it('UV 越界为 error 且带面信息', () => {
    const m = makeModel()
    m.elements[0].faces.up!.uv = [0, 0, 32, 32]
    const diags = validateModel(m)
    const d = diags.find((x) => x.code === 'uv_range')
    expect(d?.severity).toBe('error')
    expect(d?.face).toBe('up')
    expect(d?.elementIndex).toBe(0)
  })

  it('面引用未定义贴图变量为 error', () => {
    const m = makeModel()
    m.elements[0].faces.north!.texture = 'missing'
    expect(validateModel(m).some((d) => d.code === 'unknown_texture')).toBe(true)
  })

  it('非 22.5 倍数旋转角为 error', () => {
    const m = makeModel()
    m.elements[0].rotation = { origin: [8, 8, 8], axis: 'x', angle: 30 }
    expect(validateModel(m).some((d) => d.code === 'rotation_angle')).toBe(true)
  })

  it('坐标越界 / from>to 为 error', () => {
    const m1 = makeModel()
    m1.elements[0].to = [20, 16, 16]
    expect(validateModel(m1).some((d) => d.code === 'coord_range')).toBe(true)

    const m2 = makeModel()
    m2.elements[0].from = [16, 0, 0]
    m2.elements[0].to = [0, 16, 16]
    expect(validateModel(m2).some((d) => d.code === 'coord_order')).toBe(true)
  })

  it('六面全剔为 warning（不是 error）', () => {
    const m = makeModel()
    m.elements[0].faces = {}
    const diags = validateModel(m)
    expect(diags).toHaveLength(1)
    expect(diags[0].code).toBe('all_faces_culled')
    expect(diags[0].severity).toBe('warning')
    expect(hasModelError(diags)).toBe(false)
  })

  it('hasModelError 只对 error 敏感', () => {
    expect(hasModelError(validateModel(makeModel()))).toBe(false)
    const bad = makeModel()
    bad.elements[0].faces.east!.uv = [0, 0, 99, 99]
    expect(hasModelError(validateModel(bad))).toBe(true)
  })
})

describe('pixelsToPng', () => {
  /** 解析 IDAT 还原 RGBA 像素（测试夹具用，仅处理 filter=0） */
  function decodeRgba(png: Buffer, size: number): number[][] {
    let pos = 8
    const idat: Buffer[] = []
    while (pos < png.length) {
      const len = png.readUInt32BE(pos)
      const type = png.toString('ascii', pos + 4, pos + 8)
      const data = png.subarray(pos + 8, pos + 8 + len)
      if (type === 'IDAT') idat.push(data)
      pos += 12 + len
    }
    const raw = inflateSync(Buffer.concat(idat))
    const pixels: number[][] = []
    const stride = size * 4
    for (let y = 0; y < size; y++) {
      const rowStart = y * (stride + 1)
      expect(raw[rowStart]).toBe(0) // filter none
      for (let x = 0; x < size; x++) {
        const p = rowStart + 1 + x * 4
        pixels.push([raw[p], raw[p + 1], raw[p + 2], raw[p + 3]])
      }
    }
    return pixels
  }

  it('2×2 四色（含透明）往返编解码一致', () => {
    const pixels = ['#ff0000', '#00ff00', '#0000ff', '']
    const png = pixelsToPng(pixels, 2)
    // 签名
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const decoded = decodeRgba(png, 2)
    expect(decoded[0]).toEqual([255, 0, 0, 255])
    expect(decoded[1]).toEqual([0, 255, 0, 255])
    expect(decoded[2]).toEqual([0, 0, 255, 255])
    expect(decoded[3]).toEqual([0, 0, 0, 0])
  })

  it('16×16 空画布全透明且长度合法', () => {
    const png = pixelsToPng(Array(256).fill(''), 16)
    const decoded = decodeRgba(png, 16)
    expect(decoded).toHaveLength(256)
    expect(decoded.every((px) => px[3] === 0)).toBe(true)
  })

  it('8 位 hex（#rrggbbaa）的 alpha 原样写入 PNG', () => {
    const pixels = ['#ff000080', '#00ff00ff', '#0000ff00', '#12345640']
    const decoded = decodeRgba(pixelsToPng(pixels, 2), 2)
    expect(decoded[0]).toEqual([255, 0, 0, 0x80])
    expect(decoded[1]).toEqual([0, 255, 0, 255])
    // a=00 语义等同透明
    expect(decoded[2]).toEqual([0, 0, 255, 0])
    expect(decoded[3]).toEqual([0x12, 0x34, 0x56, 0x40])
  })

  it('像素数量不符抛错', () => {
    expect(() => pixelsToPng([], 16)).toThrow(/像素数量|画布尺寸/)
  })
})
