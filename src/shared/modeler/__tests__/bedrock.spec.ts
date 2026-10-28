/**
 * bedrock_entity 格式编解码 golden 测试（方案 §6.2：codec 用 golden/fixture）。
 *
 * 核心不变量：
 * - 导入→导出→再导入 全等：坐标 / 骨骼树 / 旋转 X/Y 取反 / box-uv / 逐面 UV /
 *   定位器 / description 字段全部往返不丢；
 * - 超能力内容逐条告警：mirror / 多 geometry / 负 uv_size / 面旋转 /
 *   cullface / shade / display / 动画 / 组缩放 / 根级散件包裹。
 */
import { describe, expect, it } from 'vitest'
import { addNode, createCubeNode, createDocument, createGroupNode, validateDocument } from '../document'
import { boxUvFaces } from '../uv'
import { getFormat, listFormats } from '../formats'
import { documentToGeo, geoToDocument } from '../formats/bedrock'
import type { BedrockFormatData, BedrockGeoJson } from '../formats/bedrock'
import type { CubeNode, GroupNode, LocatorNode, ModelAnimation } from '../types'

/** 基准几何：两骨骼（body→head）、box-uv 与逐面混存、数字旋转简写、定位器、inflate */
function cleanGeo(): BedrockGeoJson {
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: {
          identifier: 'geometry.kunyu.beast',
          texture_width: 64,
          texture_height: 64,
          visible_bounds_width: 2,
          visible_bounds_height: 3,
          visible_bounds_offset: [0, 1.5, 0]
        },
        bones: [
          {
            name: 'body',
            pivot: [0, 12, 0],
            rotation: [5, -10, 3],
            cubes: [
              { origin: [-4, 0, -2], size: [8, 12, 4], uv: [16, 16] },
              {
                origin: [2, 8, 2],
                size: [2, 2, 2],
                rotation: 45,
                pivot: [3, 9, 3],
                uv: {
                  north: { uv: [0, 0], uv_size: [2, 2] },
                  up: { uv: [8, 8], uv_size: [2, 2] }
                }
              }
            ],
            locators: { tail_anchor: [0, 12, -2] }
          },
          {
            name: 'head',
            parent: 'body',
            pivot: [0, 24, 0],
            cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0], inflate: 0.5 }]
          }
        ]
      }
    ]
  }
}

describe('bedrock 注册与能力矩阵', () => {
  it('注册表内含 bedrock_entity，能力矩阵为层级/枢轴/自由旋转/双 UV 模式', () => {
    const f = getFormat('bedrock_entity')
    expect(f.name).toBe('Bedrock 实体几何')
    expect(f.capabilities.hierarchy).toBe(true)
    expect(f.capabilities.pivots).toBe(true)
    expect(f.capabilities.uv).toEqual({ perFace: true, box: true, faceRotation: false })
    expect(f.capabilities.rotation.mode).toBe('free')
    expect(f.capabilities.coordinateRange).toBeNull()
    expect(f.capabilities.animations).toBe(true)
    expect(listFormats().map((x) => x.id)).toContain('bedrock_entity')
  })
})

describe('geoToDocument 导入', () => {
  it('骨骼树/坐标/旋转取反/UV/定位器/formatData 逐项落地，文档通过不变量校验', () => {
    const { doc, downgrades } = geoToDocument(cleanGeo(), { now: 1000 })
    expect(validateDocument(doc)).toEqual([])
    expect(downgrades).toEqual([])
    expect(doc.format).toBe('bedrock_entity')
    expect(doc.id).toBe('kunyu_beast')
    expect(doc.name).toBe('geometry.kunyu.beast')
    expect(doc.settings.uvMode).toBe('per_face') // box 与 per-face 混存 → per_face

    const body = doc.nodes['body'] as GroupNode
    expect(body.type).toBe('group')
    expect(body.origin).toEqual([0, 12, 0])
    expect(body.rotation).toEqual([-5, 10, 3]) // Bedrock X/Y 取反
    expect(body.parent).toBeNull()

    const head = doc.nodes['head'] as GroupNode
    expect(head.parent).toBe('body')
    expect(head.origin).toEqual([0, 24, 0])
    expect(head.rotation).toEqual([0, 0, 0])
    expect(body.children).toContain('head')

    const c1 = doc.nodes['body_cube_1'] as CubeNode
    expect(c1.from).toEqual([-4, 0, -2])
    expect(c1.to).toEqual([4, 12, 2])
    expect(c1.boxUv?.uvOffset).toEqual([16, 16])
    const cross = boxUvFaces([8, 12, 4], [16, 16])
    expect(c1.faces.north?.uv).toEqual(cross.north)
    expect(c1.faces.up?.uv).toEqual(cross.up)

    const c2 = doc.nodes['body_cube_2'] as CubeNode
    expect(c2.rotation).toEqual([-45, 0, 0]) // 数字简写 45 → [-45,0,0]
    expect(c2.origin).toEqual([3, 9, 3]) // pivot 缺省 [0,0,0] → 此处显式 pivot
    expect(c2.faces.north?.uv).toEqual([0, 0, 2, 2])
    expect(c2.faces.up?.uv).toEqual([8, 8, 10, 10])
    expect(c2.faces.south).toBeUndefined() // 未声明的面 = 剔面

    const loc = doc.nodes['tail_anchor'] as LocatorNode
    expect(loc.type).toBe('locator')
    expect(loc.parent).toBe('body')
    expect(loc.position).toEqual([0, 12, -2])

    const hc = doc.nodes['head_cube_1'] as CubeNode
    expect(hc.inflate).toBe(0.5)
    expect(hc.from).toEqual([-4, 24, -4])
    expect(hc.to).toEqual([4, 32, 4])

    expect(doc.formatData?.bedrock).toEqual({
      identifier: 'geometry.kunyu.beast',
      formatVersion: '1.12.0',
      textureWidth: 64,
      textureHeight: 64,
      visibleBoundsWidth: 2,
      visibleBoundsHeight: 3,
      visibleBoundsOffset: [0, 1.5, 0]
    })
  })

  it('JSON 字符串输入、mirror 丢弃告警、多 geometry 取首个', () => {
    const geo = cleanGeo()
    geo['minecraft:geometry']![0]!.bones![1]!.cubes![0]!.mirror = true
    geo['minecraft:geometry']!.push({ description: { identifier: 'geometry.kunyu.other' } })
    const { doc, downgrades } = geoToDocument(JSON.stringify(geo), { now: 1000 })
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('mirror_dropped')
    expect(codes).toContain('multi_geometry')
    expect((doc.formatData?.bedrock as BedrockFormatData).identifier).toBe('geometry.kunyu.beast')
  })

  it('纯 box-uv 文件 → 文档默认 box 模式', () => {
    const geo: BedrockGeoJson = {
      format_version: '1.12.0',
      'minecraft:geometry': [
        {
          bones: [{ name: 'solo', cubes: [{ origin: [0, 0, 0], size: [8, 12, 4], uv: [0, 0] }] }]
        }
      ]
    }
    const { doc } = geoToDocument(geo, { now: 1 })
    expect(doc.settings.uvMode).toBe('box')
  })

  it('负 uv_size 归一化翻转并告警；非法 uv 类型记 uv_invalid', () => {
    const geo: BedrockGeoJson = {
      'minecraft:geometry': [
        {
          bones: [
            {
              name: 'b',
              cubes: [
                {
                  origin: [0, 0, 0],
                  size: [4, 4, 4],
                  uv: { north: { uv: [4, 4], uv_size: [-2, 2] } }
                },
                { origin: [8, 0, 8], size: [2, 2, 2], uv: 'bad' as unknown as number[] }
              ]
            }
          ]
        }
      ]
    }
    const { doc, downgrades } = geoToDocument(geo, { now: 1 })
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('uv_size_negative')
    expect(codes).toContain('uv_invalid')
    const c1 = Object.values(doc.nodes).find((n) => n.type === 'cube') as CubeNode
    expect(c1.faces.north?.uv).toEqual([2, 4, 4, 6])
  })

  it('父级缺失/成环回退顶层骨骼并告警，文档树仍然合法', () => {
    const geo: BedrockGeoJson = {
      'minecraft:geometry': [
        {
          bones: [
            { name: 'a', parent: 'ghost' },
            { name: 'b', parent: 'a' },
            { name: 'c', parent: 'c' }
          ]
        }
      ]
    }
    const { doc, downgrades } = geoToDocument(geo, { now: 1 })
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('parent_missing')
    expect(codes).toContain('parent_cycle')
    expect(validateDocument(doc)).toEqual([])
    expect((doc.nodes['a'] as GroupNode).parent).toBeNull()
    expect((doc.nodes['b'] as GroupNode).parent).toBe('a')
    expect((doc.nodes['c'] as GroupNode).parent).toBeNull()
  })
})

describe('documentToGeo 导出', () => {
  it('导入→导出 与原文件全等；再导入文档与首次导入全等', () => {
    const r1 = geoToDocument(cleanGeo(), { now: 1000 })
    const { output, downgrades } = documentToGeo(r1.doc)
    expect(downgrades).toEqual([])
    expect(output).toEqual(cleanGeo())
    const r2 = geoToDocument(output, { now: 1000 })
    expect(r2.doc).toEqual(r1.doc)
  })

  it('根级散件自动包入 root 骨骼并告警', () => {
    let doc = createDocument({ id: 'm', name: 'm', format: 'bedrock_entity', now: 1 })
    const cube = createCubeNode('c', { from: [0, 0, 0], to: [4, 4, 4] })
    doc = addNode(doc, cube, null)
    const { output, downgrades } = documentToGeo(doc)
    expect(downgrades.map((d) => d.code)).toContain('orphan_wrapped')
    const bones = output['minecraft:geometry']![0]!.bones!
    expect(bones).toHaveLength(1)
    expect(bones[0]!.name).toBe('root')
    expect(bones[0]!.cubes![0]!.origin).toEqual([0, 0, 0])
    expect(bones[0]!.cubes![0]!.size).toEqual([4, 4, 4])
  })

  it('面旋转/cullface/shade/display/动画/组缩放逐条告警且不写入产物', () => {
    let doc = createDocument({ id: 'm', name: 'm', format: 'bedrock_entity', now: 1 })
    const cube = createCubeNode('c', { from: [0, 0, 0], to: [4, 4, 4] })
    cube.shade = false
    cube.faces = { north: { uv: [0, 0, 4, 4], rotation: 90, cullface: 'down' } }
    doc = addNode(doc, cube, null)
    const group = createGroupNode('g')
    group.scale = [2, 1, 1]
    doc = addNode(doc, group, null)
    doc.display = { gui: { rotation: [0, 0, 0] } }
    const anim: ModelAnimation = { id: 'a', name: 'anim', length: 1, loop: 'once', channels: {} }
    doc.animations = { a: anim }
    const { output, downgrades } = documentToGeo(doc)
    const codes = downgrades.map((d) => d.code)
    for (const code of [
      'shade_dropped',
      'face_rotation_dropped',
      'face_extra_dropped',
      'display_dropped',
      'animations_dropped',
      'group_scale_dropped',
      'orphan_wrapped'
    ]) {
      expect(codes).toContain(code)
    }
    const bones = output['minecraft:geometry']![0]!.bones!
    const cubeJson = bones[0]!.cubes![0]!
    expect(cubeJson.uv).toEqual({ north: { uv: [0, 0], uv_size: [4, 4] } })
    expect(cubeJson.rotation).toBeUndefined()
    expect(cubeJson.pivot).toBeUndefined()
    expect('scale' in bones[1]!).toBe(false)
  })

  it('重名骨骼导出自动去重', () => {
    let doc = createDocument({ id: 'm', name: 'm', format: 'bedrock_entity', now: 1 })
    doc = addNode(doc, createGroupNode('arm'), null)
    doc = addNode(doc, createGroupNode('arm'), null)
    const { output, downgrades } = documentToGeo(doc)
    expect(downgrades).toEqual([])
    const names = output['minecraft:geometry']![0]!.bones!.map((b) => b.name)
    expect(names).toEqual(['arm', 'arm_2'])
  })

  it('无 formatData 时 identifier 按 doc.id 合成，贴图尺寸回退首张贴图', () => {
    let doc = createDocument({ id: 'wolf', name: '狼', format: 'bedrock_entity', now: 1 })
    doc = addNode(doc, createCubeNode('c', { from: [0, 0, 0], to: [4, 4, 4] }), null)
    doc = addNode(doc, createGroupNode('bone'), null)
    doc.textures = {
      t: { id: 't', name: 't', width: 64, height: 32, data: 'fake://x', visible: true }
    }
    const { output } = documentToGeo(doc)
    const desc = output['minecraft:geometry']![0]!.description!
    expect(desc.identifier).toBe('geometry.wolf')
    expect(desc.texture_width).toBe(64)
    expect(desc.texture_height).toBe(32)
    expect(output.format_version).toBe('1.12.0')
  })
})

describe('geckolib 薄壳注册（P3-b）', () => {
  it('注册表内含 geckolib，编解码复用 bedrock codec 且 format 标记正确', () => {
    const f = getFormat('geckolib')
    expect(f.name).toBe('GeckoLib 实体几何')
    expect(f.capabilities).toEqual(getFormat('bedrock_entity').capabilities)
    const imported = f.importDocument!(JSON.stringify(cleanGeo())) as ReturnType<typeof geoToDocument>
    expect(imported.doc.format).toBe('geckolib')
    expect(validateDocument(imported.doc)).toEqual([])
    const exported = f.exportDocument!(imported.doc) as ReturnType<typeof documentToGeo>
    expect(exported.output).toEqual(cleanGeo())
  })
})
