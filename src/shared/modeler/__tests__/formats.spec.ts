/**
 * java_block / free 格式编解码 golden 测试（方案 §6.2：codec 用 golden/fixture）。
 *
 * 核心不变量：
 * - 单贴图资产 导入→导出 往返不丢（几何/UV/旋转/display/贴图路径）；
 * - 超能力内容导出必带降级告警（多轴旋转/越界/组变换/定位器/无贴图）；
 * - box-uv 导出按十字展开为逐面 UV。
 */
import { describe, expect, it } from 'vitest'
import type { ModelAsset } from '../../types/content'
import { addNode, addTexture, createCubeNode, createDocument, createGroupNode, createLocatorNode, validateDocument } from '../document'
import { boxUvFaces } from '../uv'
import type { ModelTexture } from '../types'
import { getFormat, listFormats, registerFormat } from '../formats'
import { documentToModelAsset, modelAssetToDocument } from '../formats/javaBlock'
import type { FormatDefinition } from '../formats/types'

/** 测试用像素编解码对：encode 记录像素，resolve 按 data URL 找回 */
function fakePixelCodec() {
  const store = new Map<string, string[]>()
  return {
    encodePixels: (pixels: string[], w: number, h: number) => {
      const url = `fake://${w}x${h}/${store.size}`
      store.set(url, [...pixels])
      return url
    },
    resolvePixels: (tex: ModelTexture) => store.get(tex.data) ?? null
  }
}

/** 基准资产：两个立方体（一个带合法单轴旋转 + shade:false），display 槽位齐全 */
function baseAsset(): ModelAsset {
  return {
    kind: 'model',
    id: 'sword',
    displayName: '测试剑',
    description: '',
    textureSize: 16,
    pixels: Array.from({ length: 256 }, (_, i) => (i % 2 ? '#ff0000' : '')),
    textures: { all: 'textures/model/sword.png' },
    elements: [
      {
        name: 'blade',
        from: [7, 0, 7],
        to: [9, 12, 9],
        faces: {
          north: { uv: [0, 0, 2, 12], texture: 'all' },
          south: { uv: [0, 0, 2, 12], texture: 'all', rotation: 90 }
        }
      },
      {
        name: 'guard',
        from: [5, 12, 5],
        to: [11, 14, 11],
        rotation: { origin: [8, 12, 8], axis: 'y', angle: 45 },
        shade: false,
        faces: { up: { uv: [0, 0, 6, 6], texture: 'all' } }
      }
    ],
    ambientOcclusion: true,
    display: {
      gui: { rotation: [30, 225, 0], scale: [0.625, 0.625, 0.625] },
      thirdperson_righthand: { rotation: [0, -90, 55] }
    },
    createdAt: 1000,
    updatedAt: 1000
  }
}

describe('格式注册表', () => {
  it('内建 java_block 与 free', () => {
    const ids = listFormats().map((f) => f.id)
    expect(ids).toContain('java_block')
    expect(ids).toContain('free')
    expect(getFormat('java_block').capabilities.rotation.mode).toBe('singleAxis')
    expect(getFormat('free').capabilities.hierarchy).toBe(true)
  })

  it('重复注册同 id 抛错', () => {
    const dup: FormatDefinition = {
      id: 'free',
      name: 'dup',
      capabilities: getFormat('free').capabilities
    }
    expect(() => registerFormat(dup)).toThrow(/已注册/)
  })

  it('free 导出即文档克隆', () => {
    const doc = createDocument({ name: 'x', format: 'free', now: 1 })
    const { output, downgrades } = getFormat('free').exportDocument!(doc) as {
      output: typeof doc
      downgrades: unknown[]
    }
    expect(downgrades).toEqual([])
    expect(output).toEqual(doc)
    expect(output).not.toBe(doc)
  })
})

describe('modelAssetToDocument 导入', () => {
  it('几何/旋转/UV/display 完整落地，文档通过不变量校验', () => {
    const codec = fakePixelCodec()
    const { doc, downgrades } = modelAssetToDocument(baseAsset(), {
      encodePixels: codec.encodePixels,
      now: 1000
    })
    expect(validateDocument(doc)).toEqual([])
    expect(downgrades).toEqual([])
    expect(doc.format).toBe('java_block')
    expect(doc.settings.textureSize).toEqual([16, 16])
    expect(Object.keys(doc.textures)).toHaveLength(1)
    expect(doc.display?.gui?.rotation).toEqual([30, 225, 0])
    expect(doc.formatData?.javaTextures).toEqual({ all: 'textures/model/sword.png' })

    const cubes = Object.values(doc.nodes).filter((n) => n.type === 'cube')
    expect(cubes).toHaveLength(2)
    const guard = cubes.find((c) => c.name === 'guard')!
    expect(guard.rotation).toEqual([0, 45, 0])
    expect(guard.origin).toEqual([8, 12, 8])
    expect(guard.shade).toBe(false)
    const blade = cubes.find((c) => c.name === 'blade')!
    expect(blade.faces.south?.rotation).toBe(90)
    expect(blade.faces.south?.texture).toBe(Object.keys(doc.textures)[0])
    expect(blade.faces.east).toBeUndefined() // 缺键 = 剔面
  })

  it('缺编码器时跳过贴图并告警，面 UV 保留', () => {
    const { doc, downgrades } = modelAssetToDocument(baseAsset())
    expect(downgrades.map((d) => d.code)).toContain('texture_not_imported')
    expect(Object.keys(doc.textures)).toHaveLength(0)
    const blade = Object.values(doc.nodes).find((n) => n.type === 'cube' && n.name === 'blade')
    expect(blade?.type === 'cube' && blade.faces.north?.uv).toEqual([0, 0, 2, 12])
    expect(blade?.type === 'cube' && blade.faces.north?.texture).toBeUndefined()
  })
})

describe('documentToModelAsset 导出', () => {
  it('单贴图往返等价（导入→导出 不丢字段）', () => {
    const codec = fakePixelCodec()
    const asset = baseAsset()
    const { doc } = modelAssetToDocument(asset, { encodePixels: codec.encodePixels, now: 1000 })
    const { output, downgrades } = documentToModelAsset(doc, {
      resolvePixels: codec.resolvePixels,
      now: 1000
    })
    expect(downgrades).toEqual([])
    expect(output.id).toBe(asset.id)
    expect(output.displayName).toBe(asset.displayName)
    expect(output.textureSize).toBe(16)
    expect(output.pixels).toEqual(asset.pixels)
    expect(output.textures).toEqual(asset.textures) // formatData 还原路径
    expect(output.display).toEqual(asset.display)
    expect(output.elements).toEqual(asset.elements)
  })

  it('多轴旋转导出丢弃并告警', () => {
    let doc = createDocument({ id: 'm', name: 'm', format: 'java_block', now: 1 })
    const cube = createCubeNode('c')
    cube.rotation = [10, 20, 0]
    doc = addNode(doc, cube, null)
    const { output, downgrades } = documentToModelAsset(doc, { now: 1 })
    expect(downgrades.map((d) => d.code)).toContain('rotation_multi_axis')
    expect(output.elements[0]!.rotation).toBeUndefined()
  })

  it('非法单轴角度（非 22.5 步进）丢弃并告警；合法 22.5 保留', () => {
    let doc = createDocument({ id: 'm', name: 'm', format: 'java_block', now: 1 })
    const bad = createCubeNode('bad')
    bad.rotation = [30, 0, 0]
    doc = addNode(doc, bad, null)
    const good = createCubeNode('good')
    good.rotation = [0, 0, -22.5]
    good.origin = [8, 8, 8]
    doc = addNode(doc, good, null)
    const { output, downgrades } = documentToModelAsset(doc, { now: 1 })
    expect(downgrades.map((d) => d.code)).toContain('rotation_angle')
    const badEl = output.elements.find((e) => e.name === 'bad')!
    const goodEl = output.elements.find((e) => e.name === 'good')!
    expect(badEl.rotation).toBeUndefined()
    expect(goodEl.rotation).toEqual({ origin: [8, 8, 8], axis: 'z', angle: -22.5 })
  })

  it('越界坐标保留原值并告警', () => {
    let doc = createDocument({ id: 'm', name: 'm', format: 'java_block', now: 1 })
    const cube = createCubeNode('big', { from: [-4, 0, 0], to: [20, 16, 16] })
    doc = addNode(doc, cube, null)
    const { output, downgrades } = documentToModelAsset(doc, { now: 1 })
    expect(downgrades.map((d) => d.code)).toContain('coord_range')
    expect(output.elements[0]!.from).toEqual([-4, 0, 0])
    expect(output.elements[0]!.to).toEqual([20, 16, 16])
  })

  it('box-uv 导出按十字展开为逐面 UV，面旋转保留', () => {
    let doc = createDocument({
      id: 'm',
      name: 'm',
      format: 'java_block',
      settings: { uvMode: 'box' },
      now: 1
    })
    const cube = createCubeNode('c', { from: [0, 0, 0], to: [4, 8, 2] })
    cube.boxUv = { uvOffset: [10, 20] }
    cube.faces = { north: { rotation: 180 } }
    doc = addNode(doc, cube, null)
    const { output, downgrades } = documentToModelAsset(doc, { now: 1 })
    expect(downgrades.filter((d) => d.code === 'uv_auto_filled')).toHaveLength(0)
    const expected = boxUvFaces([4, 8, 2], [10, 20])
    const el = output.elements[0]!
    for (const face of ['north', 'south', 'east', 'west', 'up', 'down'] as const) {
      expect(el.faces[face]?.uv).toEqual(expected[face])
    }
    expect(el.faces.north?.rotation).toBe(180)
  })

  it('per-face 缺 UV 的面按自动 UV 补齐并记 info', () => {
    let doc = createDocument({ id: 'm', name: 'm', format: 'java_block', now: 1 })
    const cube = createCubeNode('c', { from: [0, 0, 0], to: [4, 8, 2] })
    cube.faces = { north: {} }
    doc = addNode(doc, cube, null)
    const { output, downgrades } = documentToModelAsset(doc, { now: 1 })
    expect(downgrades.map((d) => d.code)).toContain('uv_auto_filled')
    expect(output.elements[0]!.faces.north?.uv).toEqual([0, 0, 4, 8])
  })

  it('组旋转/定位器/无贴图分别告警', () => {
    let doc = createDocument({ id: 'm', name: 'm', format: 'java_block', now: 1 })
    const group = createGroupNode('g')
    group.rotation = [0, 45, 0]
    doc = addNode(doc, group, null)
    const child = createCubeNode('child')
    doc = addNode(doc, child, group.id)
    const locator = createLocatorNode('hook')
    doc = addNode(doc, locator, null)
    const { downgrades } = documentToModelAsset(doc, { now: 1 })
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('group_transform_lost')
    expect(codes).toContain('locator_dropped')
    expect(codes).toContain('no_texture')
  })

  it('多贴图变量导出：第一张 all，其余按名清洗，面引用对应变量', () => {
    const codec = fakePixelCodec()
    let doc = createDocument({ id: 'm', name: 'm', format: 'java_block', now: 1 })
    const texA: ModelTexture = {
      id: 'ta',
      name: 'Body',
      width: 16,
      height: 16,
      data: codec.encodePixels(Array(256).fill('#111111'), 16, 16),
      visible: true
    }
    const texB: ModelTexture = {
      id: 'tb',
      name: 'Glow Mask',
      width: 16,
      height: 16,
      data: codec.encodePixels(Array(256).fill('#222222'), 16, 16),
      visible: true
    }
    doc = addTexture(doc, texA)
    doc = addTexture(doc, texB)
    const cube = createCubeNode('c')
    cube.faces = {
      north: { uv: [0, 0, 16, 16], texture: 'ta' },
      south: { uv: [0, 0, 16, 16], texture: 'tb' }
    }
    doc = addNode(doc, cube, null)
    const { output, downgrades } = documentToModelAsset(doc, {
      resolvePixels: codec.resolvePixels,
      now: 1
    })
    expect(downgrades).toEqual([])
    expect(Object.keys(output.textures)).toEqual(['all', 'glow_mask'])
    expect(output.textures.all).toBe('textures/model/m.png')
    expect(output.textures.glow_mask).toBe('textures/model/m_glow_mask.png')
    expect(output.elements[0]!.faces.north?.texture).toBe('all')
    expect(output.elements[0]!.faces.south?.texture).toBe('glow_mask')
    expect(output.pixels).toEqual(Array(256).fill('#111111')) // 主贴图像素
  })

  it('贴图尺寸非 16/32 时告警并按档记录', () => {
    let doc = createDocument({ id: 'm', name: 'm', format: 'java_block', now: 1 })
    const tex: ModelTexture = {
      id: 't',
      name: 'big',
      width: 64,
      height: 64,
      data: 'fake://x',
      visible: true
    }
    doc = addTexture(doc, tex)
    doc = addNode(doc, createCubeNode('c'), null)
    const { output, downgrades } = documentToModelAsset(doc, { now: 1 })
    expect(downgrades.map((d) => d.code)).toContain('texture_size_clamped')
    expect(output.textureSize).toBe(32)
    expect(downgrades.map((d) => d.code)).toContain('pixels_unresolved')
  })
})
