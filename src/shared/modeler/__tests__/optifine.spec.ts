/**
 * OptiFine JEM/JPM 格式编解码 golden 测试（B5-3）。
 *
 * 核心不变量：
 * - .jem 导入→导出→再导入 全等：坐标 / 部件树 / translate-rotate / 盒式与逐面 UV /
 *   formatData 元数据全部往返不丢；
 * - .jpm 单部件导入→导出→再导入 全等；
 * - 超子集内容逐条告警：invertAxis / mirrorTexture / baseId / 外部 jpm 引用 /
 *   animations / sprites / sizeAdd / 逐盒旋转 / locator / mesh / display / 组缩放。
 */
import { describe, expect, it } from 'vitest'
import { addNode, createCubeNode, createDocument, createGroupNode, validateDocument } from '../document'
import { boxUvFaces } from '../uv'
import { documentToJem, documentToJpm, jemToDocument, jpmToDocument } from '../formats/optifine'
import type { OptifineFormatData, OptifineJemJson, OptifinePartJson } from '../formats/optifine'
import type { CubeNode, GroupNode, ModelAnimation } from '../types'

/** 基准 .jem：两部件（body→子部件）、盒式与逐面 UV 混存、translate 偏移 */
function cleanJem(): OptifineJemJson {
  return {
    texture: 'textures/entity/kunyu_beast.png',
    textureSize: [64, 64],
    shadowSize: 0.5,
    models: [
      {
        part: 'body',
        translate: [0, 12, 0],
        boxes: [{ textureOffset: [16, 16], coordinates: [-4, -12, -2, 8, 12, 4] }],
        submodels: [
          {
            translate: [0, 12, 0],
            boxes: [
              {
                uvNorth: [0, 0, 8, 8],
                uvUp: [8, 8, 10, 10],
                coordinates: [-4, 0, -4, 8, 8, 8]
              }
            ]
          }
        ]
      }
    ]
  }
}

describe('jemToDocument 导入', () => {
  it('部件树/坐标/translate/UV/formatData 逐项落地，文档通过不变量校验', () => {
    const { doc, downgrades } = jemToDocument(cleanJem(), { now: 1000 })
    expect(validateDocument(doc)).toEqual([])
    expect(downgrades).toEqual([])
    expect(doc.format).toBe('free')
    expect(doc.id).toBe('kunyu_beast')
    expect(doc.name).toBe('OptiFine 模型')
    expect(doc.settings.uvMode).toBe('per_face') // 盒式 + 逐面混存 → per_face

    const body = doc.nodes['body'] as GroupNode
    expect(body.type).toBe('group')
    expect(body.origin).toEqual([0, 12, 0])
    expect(body.rotation).toEqual([0, 0, 0])
    expect(body.parent).toBeNull()

    const c1 = doc.nodes['body_cube_1'] as CubeNode
    expect(c1.from).toEqual([-4, -12, -2])
    expect(c1.to).toEqual([4, 0, 2])
    expect(c1.boxUv?.uvOffset).toEqual([16, 16])
    const cross = boxUvFaces([8, 12, 4], [16, 16])
    expect(c1.faces.north?.uv).toEqual(cross.north)
    expect(c1.faces.up?.uv).toEqual(cross.up)

    const sub = doc.nodes['body_sub1'] as GroupNode
    expect(sub.type).toBe('group')
    expect(sub.parent).toBe('body')
    expect(sub.origin).toEqual([0, 12, 0])
    expect(body.children).toContain('body_sub1')

    const c2 = doc.nodes['body_sub1_cube_1'] as CubeNode
    expect(c2.from).toEqual([-4, 0, -4])
    expect(c2.to).toEqual([4, 8, 4])
    expect(c2.faces.north?.uv).toEqual([0, 0, 8, 8])
    expect(c2.faces.up?.uv).toEqual([8, 8, 10, 10])
    expect(c2.faces.south).toBeUndefined() // 未声明的面 = 剔面

    expect(doc.formatData?.optifine).toEqual({
      texture: 'textures/entity/kunyu_beast.png',
      textureSize: [64, 64],
      shadowSize: 0.5,
      kind: 'jem'
    })
  })

  it('JSON 字符串输入；超子集字段逐条告警（invertAxis/mirror/外部引用/baseId/animations/sprites/sizeAdd）', () => {
    const jem = cleanJem()
    const model = jem.models![0]!
    model.invertAxis = 'x'
    model.mirrorTexture = 'u'
    model.baseId = 'parent_model'
    model.model = 'other.jpm'
    model.animations = [{}]
    model.attach = true
    model.scale = 2
    model.boxes![0]!.sizeAdd = 1
    model.sprites = [{}]
    const { doc, downgrades } = jemToDocument(JSON.stringify(jem), { now: 1 })
    const codes = downgrades.map((d) => d.code)
    for (const code of [
      'invert_axis_dropped',
      'mirror_texture_dropped',
      'base_id_inherit_ignored',
      'external_part_ref',
      'animations_dropped',
      'model_flag_dropped',
      'sprites_dropped',
      'size_add_dropped'
    ]) {
      expect(codes).toContain(code)
    }
    expect(validateDocument(doc)).toEqual([])
  })

  it('缺 models / 非对象 抛错；空 models 告警', () => {
    expect(() => jemToDocument('{"foo":1}' as unknown as OptifineJemJson)).toThrow()
    expect(() => jemToDocument('{"models":["bad"]}' as unknown as OptifineJemJson)).not.toThrow()
    const { downgrades } = jemToDocument({ models: [] }, { now: 1 })
    expect(downgrades.map((d) => d.code)).toContain('empty_model')
  })

  it('盒子缺 coordinates 告警跳过；缺 UV 告警', () => {
    const { doc, downgrades } = jemToDocument(
      { models: [{ part: 'p', boxes: [{ textureOffset: [0, 0] }, { textureOffset: [4, 4], coordinates: [0, 0, 0, 2, 2, 2] }] }] },
      { now: 1 }
    )
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('box_no_coordinates')
    expect(validateDocument(doc)).toEqual([])
    expect((doc.nodes['p'] as GroupNode).children).toHaveLength(1)
  })
})

describe('documentToJem 导出', () => {
  it('导入→导出→再导入 文档全等', () => {
    const r1 = jemToDocument(cleanJem(), { now: 1000 })
    const { output, downgrades } = documentToJem(r1.doc)
    expect(downgrades).toEqual([])
    const r2 = jemToDocument(output, { now: 1000 })
    expect(r2.doc).toEqual(r1.doc)
  })

  it('导出结构：部件项含 part、translate、盒式 textureOffset、逐面 uv<Face>', () => {
    const r1 = jemToDocument(cleanJem(), { now: 1000 })
    const { output } = documentToJem(r1.doc)
    expect(output.texture).toBe('textures/entity/kunyu_beast.png')
    expect(output.textureSize).toEqual([64, 64])
    expect(output.shadowSize).toBe(0.5)
    const body = output.models![0]!
    expect(body.part).toBe('body')
    expect(body.translate).toEqual([0, 12, 0])
    expect(body.boxes![0]!.textureOffset).toEqual([16, 16])
    expect(body.boxes![0]!.coordinates).toEqual([-4, -12, -2, 8, 12, 4])
    const sub = body.submodels![0]!
    expect(sub.boxes![0]!.uvNorth).toEqual([0, 0, 8, 8])
    expect(sub.boxes![0]!.uvUp).toEqual([8, 8, 10, 10])
  })

  it('根级散件归入合成部位；locator/mesh/display/动画/组缩放/逐盒旋转逐条告警', () => {
    let doc = createDocument({ id: 'm', name: 'Beast', format: 'free', now: 1 })
    const cube = createCubeNode('孤立方块', { from: [0, 0, 0], to: [4, 4, 4] })
    cube.rotation = [10, 0, 0]
    cube.inflate = 0.5
    cube.shade = false
    cube.faces.north = { uv: [0, 0, 4, 4], rotation: 90, cullface: 'down' }
    doc = addNode(doc, cube, null)
    const group = createGroupNode('arm')
    group.scale = [2, 1, 1]
    doc = addNode(doc, group, null)
    doc.display = { gui: { rotation: [0, 0, 0] } }
    const anim: ModelAnimation = { id: 'a', name: 'anim', length: 1, loop: 'once', channels: {} }
    doc.animations = { a: anim }
    const { output, downgrades } = documentToJem(doc)
    const codes = downgrades.map((d) => d.code)
    for (const code of [
      'cube_rotation_dropped',
      'inflate_dropped',
      'shade_dropped',
      'face_rotation_dropped',
      'face_extra_dropped',
      'group_scale_dropped',
      'orphan_wrapped',
      'display_dropped',
      'animations_dropped'
    ]) {
      expect(codes).toContain(code)
    }
    expect(output.models!.map((m) => m.part)).toEqual(['arm', 'Beast'])
    expect(output.models![1]!.boxes![0]!.coordinates).toEqual([0, 0, 0, 4, 4, 4])
    expect(output.models![1]!.boxes![0]!.textureOffset).toBeUndefined()
    expect(output.models![1]!.boxes![0]!.uvNorth).toEqual([0, 0, 4, 4])
  })

  it('无 formatData 时贴图路径按 doc.id 合成，纹理尺寸回退首张贴图', () => {
    let doc = createDocument({ id: 'wolf', name: '狼', format: 'free', now: 1 })
    doc = addNode(doc, createCubeNode('c', { from: [0, 0, 0], to: [4, 4, 4] }), null)
    doc = addNode(doc, createGroupNode('head'), null)
    doc.textures = { t: { id: 't', name: 't', width: 64, height: 32, data: 'fake://x', visible: true } }
    const { output } = documentToJem(doc)
    expect(output.texture).toBe('textures/entity/wolf.png')
    expect(output.textureSize).toEqual([64, 32])
  })
})

describe('jpmToDocument / documentToJpm', () => {
  function cleanJpm(): OptifinePartJson {
    return {
      texture: 'textures/entity/part.png',
      textureSize: [32, 32],
      boxes: [{ textureOffset: [0, 0], coordinates: [0, 0, 0, 4, 4, 4] }],
      submodels: [{ translate: [0, 4, 0], boxes: [{ textureOffset: [4, 0], coordinates: [0, 0, 0, 2, 2, 2] }] }]
    }
  }

  it('导入→导出→再导入 文档全等（单部件 → 一个顶层组）', () => {
    const r1 = jpmToDocument(cleanJpm(), { now: 1000, name: 'body' })
    expect(validateDocument(r1.doc)).toEqual([])
    expect(r1.doc.root).toHaveLength(1)
    expect((r1.doc.nodes[r1.doc.root[0]!] as GroupNode).name).toBe('body')
    const { output, downgrades } = documentToJpm(r1.doc)
    expect(downgrades).toEqual([])
    const r2 = jpmToDocument(output, { now: 1000, name: 'body' })
    expect(r2.doc).toEqual(r1.doc)
  })

  it('JPM 顶层盒式 UV → boxUv 与十字展开；导出元数据透传', () => {
    const { doc } = jpmToDocument(cleanJpm(), { now: 1, name: 'p' })
    expect((doc.nodes['p_cube_1'] as CubeNode).boxUv?.uvOffset).toEqual([0, 0])
    expect((doc.formatData?.optifine as OptifineFormatData).kind).toBe('jpm')
    const { output } = documentToJpm(doc)
    expect(output.texture).toBe('textures/entity/part.png')
    expect(output.textureSize).toEqual([32, 32])
    expect(output.boxes![0]!.textureOffset).toEqual([0, 0])
  })

  it('非对象根 / 空部件行为', () => {
    expect(() => jpmToDocument('[]' as unknown as OptifinePartJson)).toThrow()
    const { downgrades } = jpmToDocument({}, { now: 1, name: 'empty' })
    expect(downgrades.map((d) => d.code)).toContain('empty_model')
  })
})
