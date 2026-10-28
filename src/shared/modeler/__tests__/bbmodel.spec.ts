/**
 * .bbmodel 互操作编解码 golden 测试（方案 §6.2：codec 用 golden/fixture，P5-bbmodel）。
 *
 * 核心不变量：
 * - 版本门禁：<3.6 拒绝；缺失/不可解析 info；3.6–4.x 接受；≥5.0 warning 继续；
 * - 导入：组/骨骼树（outliner）、多贴图（下标→TextureId、uvSize=resolution）、
 *   逐面 UV/面旋转、box-uv 十字补齐与文件逐面优先、三通道动画、loop/length 全落地；
 * - 导出→再导入 往返：几何/UV/贴图绑定/组树顺序/动画关键帧/插值/display 不丢；
 * - 超子集内容逐条告警：未知元素类型、molang 关键帧、bezier 插值、定位器、非骨骼通道；
 * - mesh 互操作（B4-2）：命名顶点表（相对 origin 偏移）↔ 父空间顶点、面 UV 按键对齐、
 *   ngon 扇形三角化、缺顶点引用面跳过、outliner 字符串引用还原、往返不丢。
 */
import { describe, expect, it } from 'vitest'
import { createDocument, validateDocument } from '../document'
import { addNode, addTexture, createCubeNode, createGroupNode, createLocatorNode } from '../document'
import { addAnimation } from '../document'
import { bbmodelToDocument, documentToBbmodel } from '../formats/bbmodel'
import type { BbmodelDocJson, BbmodelMeshFaceJson } from '../formats/bbmodel'
import type { CubeNode, GroupNode, MeshNode, ModelDocument } from '../types'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** 全特性基准：两组嵌套 + 顶层面外立方体 + 双贴图 + 一段动画 + display */
function fullBbmodel(): BbmodelDocJson {
  return {
    meta: { format_version: '4.10', model_format: 'free' },
    name: 'golem',
    box_uv: false,
    resolution: { width: 32, height: 32 },
    elements: [
      {
        uuid: 'cube-body',
        name: '躯干',
        from: [2, 4, 2],
        to: [14, 16, 6],
        origin: [8, 10, 4],
        faces: {
          north: { uv: [0, 0, 12, 12], texture: 0 },
          up: { uv: [4, 4, 16, 8], texture: 1, rotation: 90 },
          down: { uv: [0, 0, 12, 4], texture: null }
        }
      },
      {
        uuid: 'cube-head',
        name: '头',
        from: [4, 16, 0],
        to: [12, 24, 8],
        origin: [8, 16, 4],
        rotation: [0, 15, 0],
        faces: { north: { uv: [16, 16, 24, 24], texture: 0 } }
      },
      {
        uuid: 'cube-loose',
        name: '散件',
        from: [0, 0, 0],
        to: [2, 2, 2],
        faces: {}
      }
    ],
    outliner: [
      {
        uuid: 'grp-body',
        name: 'body',
        origin: [8, 10, 4],
        rotation: [5, 0, 0],
        children: [
          'cube-body',
          { uuid: 'grp-head', name: 'head', origin: [8, 16, 4], children: ['cube-head'] }
        ]
      },
      'cube-loose'
    ],
    textures: [
      { uuid: 'tex-main', name: 'main.png', origin: PNG, width: 32, height: 32, visible: true },
      { uuid: 'tex-deco', name: 'deco.png', origin: PNG, width: 32, height: 32 }
    ],
    animations: [
      {
        uuid: 'anim-walk',
        name: 'walk',
        loop: 'loop',
        length: 1.5,
        animators: {
          'grp-body': {
            name: 'body',
            type: 'bone',
            keyframes: [
              { channel: 'rotation', time: 0, interpolation: 'linear', data_points: [{ x: 0, y: 0, z: 0 }] },
              { channel: 'rotation', time: 0.75, interpolation: 'catmullrom', data_points: [{ x: 10, y: 0, z: 5 }] },
              { channel: 'position', time: 0.5, interpolation: 'step', data_points: [{ x: 0, y: 2, z: 0 }] }
            ]
          }
        }
      }
    ],
    display: { gui: { rotation: [30, 45, 0], translation: [0, 1, 0], scale: [0.5, 0.5, 0.5] } }
  }
}

describe('版本门禁', () => {
  it('3.6 以下直接拒绝', () => {
    const doc = { meta: { format_version: '3.5' }, elements: [{ from: [0, 0, 0], to: [1, 1, 1] }] }
    expect(() => bbmodelToDocument(doc)).toThrow(/过旧/)
  })

  it('缺失或不可解析 → info 告警继续', () => {
    const r1 = bbmodelToDocument({ elements: [{ from: [0, 0, 0], to: [1, 1, 1] }] }, { now: 1 })
    expect(r1.downgrades.map((d) => d.code)).toContain('version_unknown')
    const r2 = bbmodelToDocument(
      { meta: { format_version: 'abc' }, elements: [{ from: [0, 0, 0], to: [1, 1, 1] }] },
      { now: 1 }
    )
    expect(r2.downgrades.map((d) => d.code)).toContain('version_unknown')
  })

  it('3.6–4.x 无版本告警；5.x → version_too_new warning 继续', () => {
    const ok = bbmodelToDocument(fullBbmodel(), { now: 1 })
    expect(ok.downgrades.find((d) => d.code.startsWith('version'))).toBeUndefined()
    const newer = bbmodelToDocument(
      { ...fullBbmodel(), meta: { format_version: '5.0', model_format: 'free' } },
      { now: 1 }
    )
    const gate = newer.downgrades.find((d) => d.code === 'version_too_new')
    expect(gate?.severity).toBe('warning')
    expect(validateDocument(newer.doc)).toEqual([])
  })
})

describe('bbmodelToDocument 导入', () => {
  it('组树/立方体/多贴图/UV/动画/display 逐项落地，文档通过不变量校验', () => {
    const { doc, downgrades } = bbmodelToDocument(fullBbmodel(), { now: 1000 })
    expect(validateDocument(doc)).toEqual([])
    expect(downgrades).toEqual([])
    expect(doc.id).toBe('golem')
    expect(doc.format).toBe('free')
    expect(doc.settings.textureSize).toEqual([32, 32])

    /* 组树：body（顶层） → head（子）；散件立方体顶层 */
    expect(doc.root).toEqual(['grp-body', 'cube-loose'])
    const body = doc.nodes['grp-body'] as GroupNode
    expect(body.type).toBe('group')
    expect(body.origin).toEqual([8, 10, 4])
    expect(body.rotation).toEqual([5, 0, 0])
    expect(body.children).toEqual(['cube-body', 'grp-head'])
    const head = doc.nodes['grp-head'] as GroupNode
    expect(head.parent).toBe('grp-body')
    expect(head.children).toEqual(['cube-head'])

    /* 立方体 */
    const torso = doc.nodes['cube-body'] as CubeNode
    expect(torso.parent).toBe('grp-body')
    expect(torso.from).toEqual([2, 4, 2])
    expect(torso.to).toEqual([14, 16, 6])
    expect(torso.faces.north).toEqual({ uv: [0, 0, 12, 12], texture: 'tex-main' })
    expect(torso.faces.up).toEqual({ uv: [4, 4, 16, 8], texture: 'tex-deco', rotation: 90 })
    expect(torso.faces.down).toEqual({ uv: [0, 0, 12, 4] }) // texture:null → 无贴图绑定
    const headCube = doc.nodes['cube-head'] as CubeNode
    expect(headCube.rotation).toEqual([0, 15, 0])
    expect(headCube.origin).toEqual([8, 16, 4])

    /* 贴图：uvSize = resolution */
    expect(Object.keys(doc.textures)).toEqual(['tex-main', 'tex-deco'])
    expect(doc.textures['tex-main']!.uvSize).toEqual([32, 32])
    expect(doc.textures['tex-deco']!.visible).toBe(true)

    /* 动画：animator uuid → 组节点 id；三通道插值保留 */
    const anim = doc.animations['anim-walk']!
    expect(anim.name).toBe('walk')
    expect(anim.loop).toBe('loop')
    expect(anim.length).toBe(1.5)
    const ch = anim.channels['grp-body']!
    expect(ch.rotation).toHaveLength(2)
    expect(ch.rotation![1]).toEqual({ time: 0.75, value: [10, 0, 5], interpolation: 'catmullrom' })
    expect(ch.position![0]).toEqual({ time: 0.5, value: [0, 2, 0], interpolation: 'step' })

    /* display 直通 */
    expect(doc.display?.gui).toEqual({ rotation: [30, 45, 0], translation: [0, 1, 0], scale: [0.5, 0.5, 0.5] })
  })

  it('model_format 推导文档 format；options.format 覆盖', () => {
    expect(bbmodelToDocument({ meta: { model_format: 'java_block' }, elements: [{ from: [0, 0, 0], to: [1, 1, 1] }] }, { now: 1 }).doc.format).toBe('java_block')
    expect(bbmodelToDocument({ meta: { model_format: 'modded_entity' }, elements: [{ from: [0, 0, 0], to: [1, 1, 1] }] }, { now: 1 }).doc.format).toBe('bedrock_entity')
    expect(bbmodelToDocument(fullBbmodel(), { now: 1, format: 'geckolib' }).doc.format).toBe('geckolib')
  })

  it('box_uv 模式：uv_offset 十字补齐并记录 boxUv 绑定', () => {
    const r = bbmodelToDocument(
      {
        meta: { format_version: '4.5', model_format: 'java_block' },
        box_uv: true,
        resolution: { width: 16, height: 16 },
        elements: [{ uuid: 'c1', name: 'b', from: [0, 0, 0], to: [4, 8, 2], uv_offset: [4, 4], faces: {} }]
      },
      { now: 1 }
    )
    expect(r.doc.settings.uvMode).toBe('box')
    const cube = r.doc.nodes['c1'] as CubeNode
    expect(cube.boxUv).toEqual({ uvOffset: [4, 4] })
    // 十字展开：north 面 uv 尺寸 = [w=4, h=8]
    const north = cube.faces.north!.uv!
    expect(north[2] - north[0]).toBe(4)
    expect(north[3] - north[1]).toBe(8)
  })

  it('box_uv 文件同时写了逐面 uv 时以文件为准', () => {
    const r = bbmodelToDocument(
      {
        meta: { format_version: '4.5' },
        box_uv: true,
        elements: [
          {
            uuid: 'c1',
            from: [0, 0, 0],
            to: [4, 4, 4],
            uv_offset: [0, 0],
            faces: { north: { uv: [1, 1, 5, 5], texture: null } }
          }
        ]
      },
      { now: 1 }
    )
    const cube = r.doc.nodes['c1'] as CubeNode
    expect(cube.faces.north!.uv).toEqual([1, 1, 5, 5])
    expect(cube.faces.up).toBeUndefined() // 文件未写的面 = 剔面
  })

  it('超子集内容逐条告警：未知元素类型/molang/bezier/多数据点/目标缺失/坏贴图下标', () => {
    const r = bbmodelToDocument(
      {
        meta: { format_version: '4.5' },
        elements: [
          { uuid: 'm1', name: '样条', type: 'spline' },
          {
            uuid: 'c1',
            name: '盒',
            from: [0, 0, 0],
            to: [1, 1, 1],
            faces: { north: { uv: [0, 0, 1, 1], texture: 7 } }
          }
        ],
        outliner: [{ uuid: 'grp-g', name: 'g', children: ['c1'] }, 'ghost-uuid'],
        animations: [
          {
            uuid: 'a1',
            name: 'x',
            animators: {
              nobody: { name: 'nobody', keyframes: [] },
              'grp-g': {
                name: 'g',
                keyframes: [
                  { channel: 'rotation', time: 0, data_points: [{ x: 'math.sin(q)', y: 0, z: 0 }] },
                  { channel: 'rotation', time: 1, interpolation: 'bezier', data_points: [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }] }
                ]
              }
            }
          }
        ]
      },
      { now: 1 }
    )
    const codes = r.downgrades.map((d) => d.code)
    expect(codes).toContain('element_type_skipped')
    expect(codes).toContain('texture_index_missing')
    expect(codes).toContain('outliner_ref_missing')
    expect(codes).toContain('animator_target_missing')
    expect(codes).toContain('keyframe_molang')
    expect(codes).toContain('keyframe_multi_points')
    expect(codes).toContain('interpolation_degraded')
    // bezier 关键帧本身保留（降级为 linear 并取首点）
    const anim = r.doc.animations['a1']!
    expect(anim.channels['grp-g']!.rotation![0]).toEqual({ time: 1, value: [1, 2, 3], interpolation: 'linear' })
  })
})

/** 构造 per-face 双贴图带骨骼文档（导出基准） */
function exportDoc(): ModelDocument {
  let doc = createDocument({ id: 'golem', name: 'golem', format: 'free', now: 1000 })
  doc = { ...doc, settings: { ...doc.settings, textureSize: [32, 32] } }
  doc = addTexture(doc, { id: 'tex-main', name: 'main', width: 32, height: 32, data: PNG, uvSize: [32, 32], visible: true })
  doc = addTexture(doc, { id: 'tex-deco', name: 'deco', width: 32, height: 32, data: PNG, uvSize: [32, 32], visible: true })

  const body = createGroupNode('body')
  body.id = 'grp-body'
  body.origin = [8, 10, 4]
  const head = createGroupNode('head')
  head.id = 'grp-head'
  head.origin = [8, 16, 4]
  doc = addNode(doc, body, null)
  doc = addNode(doc, head, 'grp-body')

  const torso = createCubeNode('躯干', { from: [2, 4, 2], to: [14, 16, 6] })
  torso.id = 'cube-body'
  torso.origin = [8, 10, 4]
  torso.faces = {
    north: { uv: [0, 0, 12, 12], texture: 'tex-main' },
    up: { uv: [4, 4, 16, 8], texture: 'tex-deco', rotation: 90 },
    down: { uv: [0, 0, 12, 4] }
  }
  doc = addNode(doc, torso, 'grp-body')
  const headCube = createCubeNode('头', { from: [4, 16, 0], to: [12, 24, 8] })
  headCube.id = 'cube-head'
  doc = addNode(doc, headCube, 'grp-head')

  doc = addAnimation(doc, {
    id: 'anim-walk',
    name: 'walk',
    length: 1.5,
    loop: 'loop',
    channels: {
      'grp-body': {
        rotation: [
          { time: 0, value: [0, 0, 0], interpolation: 'linear' },
          { time: 0.75, value: [10, 0, 5], interpolation: 'catmullrom' }
        ],
        position: [{ time: 0.5, value: [0, 2, 0], interpolation: 'step' }]
      }
    }
  })
  doc = { ...doc, display: { gui: { rotation: [30, 45, 0] } } }
  return doc
}

describe('documentToBbmodel 导出与往返', () => {
  it('导出结构：元素/outliner/贴图/动画/分辨率逐项正确', () => {
    const { output, downgrades } = documentToBbmodel(exportDoc())
    expect(downgrades).toEqual([])
    expect(output.meta).toEqual({ format_version: '4.5', model_format: 'free' })
    expect(output.resolution).toEqual({ width: 32, height: 32 })
    expect(output.box_uv).toBe(false)

    const torso = output.elements!.find((e) => e.uuid === 'cube-body')!
    expect(torso.faces!.north).toEqual({ uv: [0, 0, 12, 12], texture: 0 })
    expect(torso.faces!.up).toEqual({ uv: [4, 4, 16, 8], texture: 1, rotation: 90 })
    expect(torso.faces!.down).toEqual({ uv: [0, 0, 12, 4], texture: null })

    expect(output.outliner).toEqual([
      {
        uuid: 'grp-body',
        name: 'body',
        origin: [8, 10, 4],
        children: [{ uuid: 'grp-head', name: 'head', origin: [8, 16, 4], children: ['cube-head'] }, 'cube-body']
      }
    ])
    expect(output.textures!.map((t) => t.uuid)).toEqual(['tex-main', 'tex-deco'])

    const anim = output.animations![0]!
    expect(anim.uuid).toBe('anim-walk')
    expect(anim.loop).toBe('loop')
    const kfs = anim.animators!['grp-body']!.keyframes!
    expect(kfs).toHaveLength(3)
    expect(kfs.find((k) => k.channel === 'position')).toEqual({
      channel: 'position',
      time: 0.5,
      interpolation: 'step',
      data_points: [{ x: 0, y: 2, z: 0 }]
    })
    expect(output.display).toEqual({ gui: { rotation: [30, 45, 0] } })
  })

  it('导出→再导入 往返：几何/UV/绑定/组树/动画全等', () => {
    const before = exportDoc()
    const { output } = documentToBbmodel(before)
    const { doc: after, downgrades } = bbmodelToDocument(output, { now: 1000 })
    expect(validateDocument(after)).toEqual([])
    expect(downgrades).toEqual([])
    expect(after.root).toEqual(before.root)
    for (const id of Object.keys(before.nodes)) {
      const a = before.nodes[id]!
      const b = after.nodes[id]
      expect(b, `节点 ${id} 丢失`).toBeDefined()
      expect(b!.type).toBe(a.type)
      expect(b!.name).toBe(a.name)
      expect(b!.parent).toBe(a.parent)
      if (a.type === 'cube' && b!.type === 'cube') {
        expect(b!.from).toEqual(a.from)
        expect(b!.to).toEqual(a.to)
        expect(b!.faces).toEqual(a.faces)
      }
      if (a.type === 'group' && b!.type === 'group') {
        expect(b!.children).toEqual(a.children)
        expect(b!.origin).toEqual(a.origin)
      }
    }
    expect(after.animations['anim-walk']).toEqual(before.animations['anim-walk'])
    expect(Object.keys(after.textures)).toEqual(Object.keys(before.textures))
  })

  it('java_block 文档导出 model_format=java_block；定位器/非骨骼通道告警', () => {
    let doc = createDocument({ id: 'stone', name: 'stone', format: 'java_block', now: 1 })
    const loc = createLocatorNode('挂点', [8, 8, 8])
    doc = addNode(doc, loc, null)
    doc = addAnimation(doc, {
      id: 'a1',
      name: 'a1',
      length: 1,
      loop: 'once',
      channels: { [loc.id]: { rotation: [{ time: 0, value: [0, 0, 0], interpolation: 'linear' }] } }
    })
    const { output, downgrades } = documentToBbmodel(doc)
    expect(output.meta!.model_format).toBe('java_block')
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('locator_dropped')
    expect(codes).toContain('channel_target_not_bone')
  })
})

describe('独立 PNG 引用（path ↔ file）', () => {
  it('导入保留 path 为 file（POSIX 规范化），导出写回，往返不丢', () => {
    const src = fullBbmodel()
    src.textures = [
      { uuid: 'tex-linked', name: 'linked.png', origin: PNG, width: 32, height: 32, path: 'textures\\linked.png' },
      { uuid: 'tex-embed', name: 'embed.png', origin: PNG, width: 32, height: 32 }
    ]
    const { doc, downgrades } = bbmodelToDocument(src, { now: 1000 })
    expect(downgrades).toEqual([])
    expect(doc.textures['tex-linked']!.file).toBe('textures/linked.png')
    expect(doc.textures['tex-embed']!.file).toBeUndefined()

    const { output, downgrades: outWarns } = documentToBbmodel(doc)
    expect(outWarns).toEqual([])
    expect(output.textures![0]).toMatchObject({ uuid: 'tex-linked', path: 'textures/linked.png' })
    expect(output.textures![1]).toMatchObject({ uuid: 'tex-embed', path: '' })

    // 再导入：file 依然保留
    const again = bbmodelToDocument(output, { now: 2000 })
    expect(again.doc.textures['tex-linked']!.file).toBe('textures/linked.png')
  })

  it('path 存在但未内嵌（外链读不到）→ texture_file_unresolved 告警，data 置空', () => {
    const src = fullBbmodel()
    src.textures = [{ uuid: 'tex-ext', name: 'ext.png', width: 32, height: 32, path: 'textures/ext.png' }]
    const { doc, downgrades } = bbmodelToDocument(src, { now: 1000 })
    const warn = downgrades.find((d) => d.code === 'texture_file_unresolved')
    expect(warn).toBeDefined()
    expect(warn!.severity).toBe('warning')
    expect(warn!.message).toContain('textures/ext.png')
    expect(doc.textures['tex-ext']!.data).toBe('')
    expect(doc.textures['tex-ext']!.file).toBe('textures/ext.png')
  })
})

/* ------------------------------------------------------------------ */
/* mesh 互操作（B4-2）                                                  */
/* ------------------------------------------------------------------ */

/** 含 mesh 元素的基准：四棱锥（5 顶点）+ ngon 面 + 坏面/退化面 + 双贴图 + 组树 */
function meshBbmodel(): BbmodelDocJson {
  return {
    meta: { format_version: '4.10', model_format: 'free' },
    name: 'pyramid',
    resolution: { width: 16, height: 16 },
    elements: [
      {
        uuid: 'mesh-pyr',
        name: '锥',
        type: 'mesh',
        origin: [8, 0, 8],
        rotation: [0, 45, 0],
        vertices: {
          a: [-4, 0, -4],
          b: [4, 0, -4],
          c: [4, 0, 4],
          d: [-4, 0, 4],
          apex: [0, 8, 0]
        },
        faces: {
          base: {
            uv: { a: [0, 0], b: [16, 0], c: [16, 16], d: [0, 16] },
            vertices: ['a', 'b', 'c', 'd'],
            texture: 0
          },
          side: {
            uv: { a: [0, 16], b: [16, 16], apex: [8, 0] },
            vertices: ['a', 'b', 'apex'],
            texture: 1
          },
          ngon: {
            uv: { a: [0, 0], b: [4, 0], c: [8, 0], d: [8, 8], apex: [4, 4] },
            vertices: ['a', 'b', 'c', 'd', 'apex'],
            texture: null
          },
          broken: {
            uv: { a: [0, 0] },
            vertices: ['a', 'ghost', 'b'],
            texture: 0
          },
          degenerate: {
            uv: {},
            vertices: ['a', 'b'],
            texture: 0
          }
        }
      }
    ],
    outliner: [{ uuid: 'grp-root', name: 'root', origin: [8, 0, 8], children: ['mesh-pyr'] }],
    textures: [
      { uuid: 'tex-a', name: 'a.png', origin: PNG, width: 16, height: 16 },
      { uuid: 'tex-b', name: 'b.png', origin: PNG, width: 16, height: 16 }
    ]
  }
}

describe('mesh 互操作（B4-2）', () => {
  it('导入：顶点偏移+origin→父空间、面 UV 按键对齐、贴图下标映射、outliner 归位、文档过校验', () => {
    const { doc, downgrades } = bbmodelToDocument(meshBbmodel(), { now: 1000 })
    const node = doc.nodes['mesh-pyr'] as MeshNode
    expect(node).toBeDefined()
    expect(node.type).toBe('mesh')
    expect(node.parent).toBe('grp-root')
    expect(node.origin).toEqual([8, 0, 8])
    expect(node.rotation).toEqual([0, 45, 0])
    // 顶点 = origin + 偏移，顺序 = 文件键序
    expect(node.vertices).toEqual([
      [4, 0, 4], // a
      [12, 0, 4], // b
      [12, 0, 12], // c
      [4, 0, 12], // d
      [8, 8, 8] // apex
    ])
    // 面：base(4) + side(3) + ngon→3 三角；broken/degenerate 跳过 → 共 5
    expect(node.faces).toHaveLength(5)
    const base = node.faces[0]!
    expect(base.vertices).toEqual([0, 1, 2, 3])
    expect(base.uv).toEqual([
      [0, 0],
      [16, 0],
      [16, 16],
      [0, 16]
    ])
    expect(base.texture).toBe('tex-a')
    const side = node.faces[1]!
    expect(side.vertices).toEqual([0, 1, 4])
    expect(side.uv).toEqual([
      [0, 16],
      [16, 16],
      [8, 0]
    ])
    expect(side.texture).toBe('tex-b')
    // ngon 扇形三角化：[0,1,2] [0,2,3] [0,3,4]，无贴图
    expect(node.faces[2]!.vertices).toEqual([0, 1, 2])
    expect(node.faces[3]!.vertices).toEqual([0, 2, 3])
    expect(node.faces[4]!.vertices).toEqual([0, 3, 4])
    expect(node.faces[2]!.texture).toBeUndefined()
    expect(node.faces[4]!.uv[2]).toEqual([4, 4]) // apex uv 按键对齐
    // 告警：ngon info + 缺顶点引用 warning + 退化面 warning
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('mesh_ngon_triangulated')
    expect(codes).toContain('mesh_face_vertex_missing')
    expect(codes).toContain('mesh_face_invalid')
    // 文档过不变量校验
    expect(validateDocument(doc)).toEqual([])
  })

  it('导出：顶点写回相对 origin 偏移、面/顶点键确定性、贴图下标、outliner 字符串引用', () => {
    const { doc } = bbmodelToDocument(meshBbmodel(), { now: 1000 })
    const { output, downgrades } = documentToBbmodel(doc)
    expect(downgrades).toEqual([])
    const el = output.elements!.find((e) => e.uuid === 'mesh-pyr')!
    expect(el.type).toBe('mesh')
    expect(el.origin).toEqual([8, 0, 8])
    expect(el.rotation).toEqual([0, 45, 0])
    // 顶点 = 父空间 - origin（还原偏移）
    expect(el.vertices).toEqual({
      'mesh-pyr_v0': [-4, 0, -4],
      'mesh-pyr_v1': [4, 0, -4],
      'mesh-pyr_v2': [4, 0, 4],
      'mesh-pyr_v3': [-4, 0, 4],
      'mesh-pyr_v4': [0, 8, 0]
    })
    expect(Object.keys(el.faces!)).toHaveLength(5)
    const base = el.faces!['mesh-pyr_f0'] as BbmodelMeshFaceJson
    expect(base.vertices).toEqual(['mesh-pyr_v0', 'mesh-pyr_v1', 'mesh-pyr_v2', 'mesh-pyr_v3'])
    expect(base.uv!['mesh-pyr_v2']).toEqual([16, 16])
    expect(base.texture).toBe(0)
    expect((el.faces!['mesh-pyr_f1'] as BbmodelMeshFaceJson).texture).toBe(1)
    // ngon 已三角化导入，导出为 3 个三角面（无贴图 → null）
    expect((el.faces!['mesh-pyr_f2'] as BbmodelMeshFaceJson).vertices).toEqual(['mesh-pyr_v0', 'mesh-pyr_v1', 'mesh-pyr_v2'])
    expect((el.faces!['mesh-pyr_f2'] as BbmodelMeshFaceJson).texture).toBeNull()
    // outliner：组 children 含 mesh uuid 字符串
    const grp = output.outliner![0] as { uuid: string; children: unknown[] }
    expect(grp.uuid).toBe('grp-root')
    expect(grp.children).toContain('mesh-pyr')
  })

  it('导出→再导入 往返：顶点/面拓扑/UV/贴图/origin/rotation 全等', () => {
    const first = bbmodelToDocument(meshBbmodel(), { now: 1000 })
    const exported = documentToBbmodel(first.doc)
    const second = bbmodelToDocument(exported.output, { now: 2000 })
    const a = first.doc.nodes['mesh-pyr'] as MeshNode
    const b = second.doc.nodes['mesh-pyr'] as MeshNode
    expect(b.origin).toEqual(a.origin)
    expect(b.rotation).toEqual(a.rotation)
    expect(b.vertices).toEqual(a.vertices)
    expect(b.faces).toEqual(a.faces)
    expect(b.parent).toBe('grp-root')
    expect(validateDocument(second.doc)).toEqual([])
  })

  it('空 mesh 元素（无 vertices/faces 键）→ 空网格不崩溃，顶层兜底', () => {
    const { doc, downgrades } = bbmodelToDocument(
      { meta: { format_version: '4.5' }, elements: [{ uuid: 'm0', name: '空', type: 'mesh' }] },
      { now: 1 }
    )
    expect(downgrades).toEqual([])
    const node = doc.nodes['m0'] as MeshNode
    expect(node.vertices).toEqual([])
    expect(node.faces).toEqual([])
    expect(doc.root).toContain('m0')
  })
})
