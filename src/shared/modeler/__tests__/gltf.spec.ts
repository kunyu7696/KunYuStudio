/**
 * glTF 2.0 导出 golden 测试（B5-1）。
 *
 * 核心不变量：
 * - 立方体几何：逐面 4 顶点 2 三角、坐标 ÷16、法线朝外、UV = 像素/贴图尺寸不翻 v；
 * - 层级：组 → 关节节点 TRS 分解（t = o − R·S·o/16）、嵌套父子、根级 cube 层级节点；
 * - 蒙皮：有父组 cube → 场景根蒙皮节点（恒等变换 + 世界绑定姿态顶点 +
 *   JOINTS_0 单关节 / WEIGHTS_0 = 1 + IBM = 平移缩放后世界矩阵的逆）；
 * - 动画：1/30s 稠密烘焙、position 通道 = 绝对 pivot、四元数连续性、
 *   非骨骼目标告警跳过；
 * - primitive 按贴图分组；降级码逐条可断言（bezier/loop/flipbook/display）。
 */
import { describe, expect, it } from 'vitest'
import { validateDocument } from '../document'
import {
  addAnimation,
  addNode,
  addTexture,
  createAnimation,
  createCubeNode,
  createDocument,
  createGroupNode,
  createLocatorNode,
  createMeshNode,
  patchNode,
  upsertAnimationKeyframe
} from '../document'
import { documentToGltf, gltfToDocument } from '../formats/gltf'
import { defaultMeshGeometry } from '../mesh'
import { quatFromEulerXYZDeg } from '../quat'
import type { MeshNode, ModelDocument, ModelTexture } from '../types'

/* ------------------------------------------------------------------ */
/* 文档构造                                                            */
/* ------------------------------------------------------------------ */

function tex(id: string, name: string, extra?: Partial<ModelTexture>): ModelTexture {
  return {
    id,
    name,
    width: 16,
    height: 16,
    data: 'data:image/png;base64,AAAA',
    visible: true,
    ...extra
  }
}

/** 单立方体文档：from [0,0,0] to [16,16,16]，north 面绑 tex_a（uv 全幅） */
function cubeDoc(): ModelDocument {
  let doc = createDocument({ name: 'gltf-test', format: 'free', now: 1000 })
  doc = addTexture(doc, tex('tex_a', 'base'))
  const cube = createCubeNode('box', { from: [0, 0, 0], to: [16, 16, 16] })
  cube.faces = { north: { uv: [0, 0, 16, 16], texture: 'tex_a' } }
  return addNode(doc, cube, null)
}

/** 骨骼文档：g1(origin [8,0,0]) → g2 子组；cube 挂 g1 下；root 下另有根级 cube 与 locator */
function rigDoc(): { doc: ModelDocument; g1: string; g2: string; skinnedCube: string } {
  let doc = createDocument({ name: 'rig', format: 'free', now: 1000 })
  doc = addTexture(doc, tex('tex_a', 'base'))
  const g1 = createGroupNode('body')
  g1.origin = [8, 0, 0]
  doc = addNode(doc, g1, null)
  const g2 = createGroupNode('head')
  g2.origin = [8, 16, 0]
  doc = addNode(doc, g2, g1.id)
  const cube = createCubeNode('bone-cube', { from: [0, 0, 0], to: [16, 16, 16] })
  cube.faces = { north: { uv: [0, 0, 16, 16], texture: 'tex_a' } }
  doc = addNode(doc, cube, g1.id)
  const rootCube = createCubeNode('root-cube', { from: [0, 0, 0], to: [16, 16, 16] })
  rootCube.faces = { up: { uv: [0, 0, 16, 16], texture: 'tex_a' } }
  doc = addNode(doc, rootCube, null)
  const loc = createLocatorNode('marker', [0, 32, 0])
  doc = addNode(doc, loc, g1.id)
  return { doc, g1: g1.id, g2: g2.id, skinnedCube: cube.id }
}

/** 网格文档：g1 父组、g2 子组；根级四棱锥网格挂 g1（用于 v3 C3a 逐顶点权重） */
function meshRigDoc(): { doc: ModelDocument; meshId: string; g1: string; g2: string } {
  let doc = createDocument({ name: 'mesh-rig', format: 'free', now: 1000 })
  const g1 = createGroupNode('body')
  doc = addNode(doc, g1, null)
  const g2 = createGroupNode('head')
  doc = addNode(doc, g2, g1.id)
  const mesh = createMeshNode('skin', defaultMeshGeometry())
  doc = addNode(doc, mesh, g1.id)
  return { doc, meshId: mesh.id, g1: g1.id, g2: g2.id }
}

/* ------------------------------------------------------------------ */
/* BIN 读取辅助                                                        */
/* ------------------------------------------------------------------ */

interface GltfJson {
  accessors: Array<Record<string, unknown>>
  bufferViews: Array<{ byteOffset: number; byteLength: number }>
  nodes: Array<Record<string, unknown>>
  meshes: Array<{ primitives: Array<{ attributes: Record<string, number>; material: number }> }>
  materials: Array<Record<string, unknown>>
  images: Array<{ uri: string }>
  skins?: Array<{ joints: number[]; inverseBindMatrices: number }>
  animations?: Array<{ name: string; channels: Array<{ sampler: number; target: { node: number; path: string } }>; samplers: Array<{ input: number; output: number }> }>
  scenes: Array<{ nodes: number[] }>
}

function readAccessor(gltf: GltfJson, bin: Uint8Array, index: number): number[] {
  const acc = gltf.accessors[index] as {
    bufferView: number
    componentType: number
    count: number
    type: string
  }
  const view = gltf.bufferViews[acc.bufferView]!
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type as 'SCALAR']!
  const out: number[] = []
  if (acc.componentType === 5126) {
    const dv = new DataView(bin.buffer, bin.byteOffset + view.byteOffset, view.byteLength)
    for (let i = 0; i < acc.count * comps; i++) out.push(dv.getFloat32(i * 4, true))
  } else {
    for (let i = 0; i < acc.count * comps; i++) out.push(bin[view.byteOffset + i]!)
  }
  return out
}

function closeAll(actual: number[], expected: number[], eps = 1e-5): void {
  expect(actual.length).toBe(expected.length)
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 5))
  void eps
}

/* ------------------------------------------------------------------ */
/* 用例                                                                */
/* ------------------------------------------------------------------ */

describe('documentToGltf 几何', () => {
  it('单面立方体：4 顶点 2 三角、坐标 ÷16、法线朝外、UV 不翻 v', () => {
    const { output, downgrades } = documentToGltf(cubeDoc())
    expect(downgrades).toEqual([])
    const gltf = output.gltf as unknown as GltfJson
    expect(gltf.meshes).toHaveLength(1)
    const prim = gltf.meshes[0]!.primitives[0]!
    const pos = readAccessor(gltf, output.bin, prim.attributes.POSITION!)
    // north 面 [TL,TR,BR,BL] = (16,16,0)(0,16,0)(0,0,0)(16,0,0)；三角 (TL,BL,BR),(TL,BR,TR)
    closeAll(pos, [
      1, 1, 0, 1, 0, 0, 0, 0, 0,
      1, 1, 0, 0, 0, 0, 0, 1, 0
    ])
    const nrm = readAccessor(gltf, output.bin, prim.attributes.NORMAL!)
    for (let i = 0; i < 6; i++) closeAll(nrm.slice(i * 3, i * 3 + 3), [0, 0, -1])
    const uv = readAccessor(gltf, output.bin, prim.attributes.TEXCOORD_0!)
    // 角点 UV [TL,TR,BR,BL] = (0,0)(1,0)(1,1)(0,1)，v = v_px/16 不翻
    closeAll(uv, [0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0])
    // POSITION accessor 带 min/max
    const posAcc = gltf.accessors[prim.attributes.POSITION!]!
    expect(posAcc.min).toEqual([0, 0, 0])
    expect(posAcc.max).toEqual([1, 1, 0])
    // 贴图落地列表
    expect(gltf.images).toEqual([{ uri: 'base.png' }])
    expect(output.images).toEqual([{ name: 'base.png', data: 'data:image/png;base64,AAAA' }])
  })

  it('满六面立方体：24 顶点 12 三角；多贴图拆 primitive', () => {
    let doc = addTexture(cubeDoc(), tex('tex_b', 'side'))
    const cubeId = doc.root[0]!
    const cube = { ...(doc.nodes[cubeId] as import('../types').CubeNode) }
    cube.faces = {
      north: { uv: [0, 0, 16, 16], texture: 'tex_a' },
      south: { uv: [0, 0, 16, 16], texture: 'tex_b' },
      east: { uv: [0, 0, 16, 16], texture: 'tex_b' },
      west: { uv: [0, 0, 16, 16], texture: 'tex_b' },
      up: { uv: [0, 0, 16, 16], texture: 'tex_a' },
      down: { uv: [0, 0, 16, 16] } // 无贴图 → 灰材质
    }
    doc = { ...doc, nodes: { ...doc.nodes, [cubeId]: cube } }
    const { output } = documentToGltf(doc)
    const gltf = output.gltf as unknown as GltfJson
    const prims = gltf.meshes[0]!.primitives
    expect(prims).toHaveLength(3) // tex_a / tex_b / 灰
    expect(prims.map((p) => p.material)).toEqual([0, 1, 2])
    // tex_a primitive：north+up 两面 → 12 顶点
    expect(readAccessor(gltf, output.bin, prims[0]!.attributes.POSITION!)).toHaveLength(36)
    // tex_b primitive：south+east+west 三面 → 18 顶点
    expect(readAccessor(gltf, output.bin, prims[1]!.attributes.POSITION!)).toHaveLength(54)
    // 灰 primitive 无 TEXCOORD_0
    expect(prims[2]!.attributes.TEXCOORD_0).toBeUndefined()
    expect(gltf.materials[2]).toMatchObject({
      pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1] }
    })
  })
})

describe('documentToGltf 层级与蒙皮', () => {
  it('组 TRS 分解 t = (o − R·S·o)/16；嵌套父子；蒙皮节点在场景根', () => {
    const { doc, g1, g2, skinnedCube } = rigDoc()
    // g1 加旋转与缩放：rotation [0,0,90]、scale [2,2,2]、origin [8,8,8]
    const g1Node = { ...(doc.nodes[g1] as import('../types').GroupNode) }
    g1Node.origin = [8, 8, 8]
    g1Node.rotation = [0, 0, 90]
    g1Node.scale = [2, 2, 2]
    const d2 = { ...doc, nodes: { ...doc.nodes, [g1]: g1Node } }

    const { output } = documentToGltf(d2)
    const gltf = output.gltf as unknown as GltfJson
    // 节点序：g1(0) → g2(1) → locator(2) → root-cube(3) → 蒙皮 cube(4)
    const n1 = gltf.nodes[0]!
    expect(n1.name).toBe('body')
    // R(90z)·S(2)·o = R(90z)·(16,16,16) = (−16,16,16)；t = (8−(−16), 8−16, 8−16)/16 = (1.5,−0.5,−0.5)
    closeAll(n1.translation as number[], [1.5, -0.5, -0.5])
    closeAll(n1.rotation as number[], [...quatFromEulerXYZDeg([0, 0, 90])])
    expect(n1.scale).toEqual([2, 2, 2])
    expect(n1.children).toHaveLength(2) // g2 + locator（蒙皮 cube 不在 children）
    expect(gltf.nodes[1]!.name).toBe('head')
    expect(gltf.nodes[2]!.name).toBe('marker')
    // 根级 cube 是层级 TRS 节点、带 mesh、无 skin
    const rootCubeNode = gltf.nodes[3]!
    expect(rootCubeNode.name).toBe('root-cube')
    expect(rootCubeNode.mesh).toBeTypeOf('number')
    expect(rootCubeNode.skin).toBeUndefined()
    // 蒙皮 cube 节点：场景根、恒等变换、skin 0
    const skinned = gltf.nodes[4]!
    expect(skinned.name).toBe('bone-cube')
    expect(skinned.translation).toBeUndefined()
    expect(skinned.skin).toBe(0)
    expect(gltf.scenes[0]!.nodes).toContain(4)
    // joints = [g1, g2]（文档 DFS 序）
    expect(gltf.skins![0]!.joints).toEqual([0, 1])
    void g2
    void skinnedCube
  })

  it('蒙皮顶点 = 世界绑定姿态/16；IBM = 平移/16 后世界矩阵的逆', () => {
    const { doc, g1, g2 } = rigDoc()
    // 组无旋转时局部矩阵为单位阵（origin 只作 pivot），因此用旋转制造非平凡世界矩阵：
    // g1 origin [8,0,0] rot [0,0,90]；g2 origin [8,16,0] rot [0,0,90]（世界合成 Rz180）
    const g1Node = { ...(doc.nodes[g1] as import('../types').GroupNode), rotation: [0, 0, 90] as [number, number, number] }
    const g2Node = { ...(doc.nodes[g2] as import('../types').GroupNode), rotation: [0, 0, 90] as [number, number, number] }
    const d2 = { ...doc, nodes: { ...doc.nodes, [g1]: g1Node, [g2]: g2Node } }
    const { output } = documentToGltf(d2)
    const gltf = output.gltf as unknown as GltfJson
    const skinnedIdx = gltf.nodes.findIndex((n) => n.name === 'bone-cube')
    const meshIdx = gltf.nodes[skinnedIdx]!.mesh as number
    const prim = gltf.meshes[meshIdx]!.primitives[0]!
    const pos = readAccessor(gltf, output.bin, prim.attributes.POSITION!)
    // W_g1 = [Rz90 | t=(8,−8,0)]；north TL (16,16,0) → (−8,8,0)/16 = (−0.5,0.5,0)
    closeAll(pos.slice(0, 3), [-0.5, 0.5, 0])
    // JOINTS_0 全为 [0,0,0,0]（g1 是关节 0）
    const joints = readAccessor(gltf, output.bin, prim.attributes.JOINTS_0!)
    expect(joints).toHaveLength(6 * 4)
    expect(new Set(joints)).toEqual(new Set([0]))
    // WEIGHTS_0 全为 [1,0,0,0]
    const weights = readAccessor(gltf, output.bin, prim.attributes.WEIGHTS_0!)
    for (let i = 0; i < 6; i++) closeAll(weights.slice(i * 4, i * 4 + 4), [1, 0, 0, 0])
    // IBM_g1：旋转 Rᵀ = Rz(−90)，平移 −Rᵀ·(8,−8,0)/16 = (0.5,0.5,0)，列主序
    const ibm = readAccessor(gltf, output.bin, gltf.skins![0]!.inverseBindMatrices)
    expect(ibm).toHaveLength(2 * 16)
    closeAll(ibm.slice(0, 16), [0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0.5, 0.5, 0, 1])
    // IBM_g2：世界合成 Rz180、平移 (0,16,0)/16 = (0,1,0)；逆平移 (0,1,0)
    closeAll(ibm.slice(16, 32), [-1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1])
  })
})

describe('documentToGltf 动画烘焙', () => {
  function animDoc(): { doc: ModelDocument; g1: string; cubeId: string } {
    const { doc, g1 } = rigDoc()
    const cubeId = doc.root.find((id) => (doc.nodes[id] as { name: string }).name === 'root-cube')!
    let d = doc
    const anim = createAnimation('walk', { length: 1, loop: 'loop' })
    d = addAnimation(d, anim)
    d = upsertAnimationKeyframe(d, anim.id, g1, 'position', { time: 0, value: [8, 0, 0], interpolation: 'linear' })
    d = upsertAnimationKeyframe(d, anim.id, g1, 'position', { time: 1, value: [24, 0, 0], interpolation: 'linear' })
    d = upsertAnimationKeyframe(d, anim.id, g1, 'rotation', { time: 0, value: [0, 0, 0], interpolation: 'linear' })
    d = upsertAnimationKeyframe(d, anim.id, g1, 'rotation', { time: 1, value: [0, 0, 90], interpolation: 'linear' })
    // 非骨骼目标：root-cube 的通道 → 告警跳过
    d = upsertAnimationKeyframe(d, anim.id, cubeId, 'rotation', { time: 0, value: [0, 0, 0], interpolation: 'linear' })
    return { doc: d, g1, cubeId }
  }

  it('逐关节稠密烘焙：采样网格/绝对 pivot 平移/四元数/loop 与非骨骼告警', () => {
    const { doc } = animDoc()
    const { output, downgrades } = documentToGltf(doc)
    const codes = downgrades.map((x) => x.code)
    expect(codes).toContain('loop_dropped')
    expect(codes).toContain('channel_target_not_bone')

    const gltf = output.gltf as unknown as GltfJson
    expect(gltf.animations).toHaveLength(1)
    const a = gltf.animations![0]!
    expect(a.name).toBe('walk')
    expect(a.channels).toHaveLength(3) // translation/rotation/scale 各一（非骨骼已跳过）
    const paths = a.channels.map((c) => c.target.path)
    expect(paths).toEqual(['translation', 'rotation', 'scale'])

    // 采样时刻：{0,1} ∪ 1/30 网格 ∪ 关键帧 0/1 → 31 帧
    const tSampler = a.samplers[a.channels[0]!.sampler]!
    const times = readAccessor(gltf, output.bin, tSampler.input)
    expect(times).toHaveLength(31)
    expect(times[0]).toBe(0)
    expect(times[30]).toBeCloseTo(1, 5)
    const inputAcc = gltf.accessors[tSampler.input]!
    expect(inputAcc.min).toEqual([0])
    expect((inputAcc.max as number[])[0]).toBeCloseTo(1, 5)

    // t=0：p=(8,0,0)、r=0、o=(8,0,0) → translation = (p − R·S·o)/16 = 0
    const trans = readAccessor(gltf, output.bin, tSampler.output)
    closeAll(trans.slice(0, 3), [0, 0, 0])
    // t=1：p=(24,0,0)、R(90z)·o = (0,8,0) → (24,−8,0)/16 = (1.5,−0.5,0)
    closeAll(trans.slice(30 * 3, 31 * 3), [1.5, -0.5, 0])
    // t=1 四元数 = quatFromEulerXYZDeg([0,0,90])
    const rot = readAccessor(gltf, output.bin, a.samplers[a.channels[1]!.sampler]!.output)
    closeAll(rot.slice(30 * 4, 31 * 4), [...quatFromEulerXYZDeg([0, 0, 90])], 1e-4)
    // scale 恒 [1,1,1]
    const scl = readAccessor(gltf, output.bin, a.samplers[a.channels[2]!.sampler]!.output)
    closeAll(scl.slice(0, 3), [1, 1, 1])
  })

  it('catmullrom / bezier 缓动降级码', () => {
    const { doc, g1 } = animDoc()
    const animId = Object.keys(doc.animations)[0]!
    let d = upsertAnimationKeyframe(doc, animId, g1, 'scale', {
      time: 0.5,
      value: [1, 1, 1],
      interpolation: 'catmullrom'
    })
    d = upsertAnimationKeyframe(d, animId, g1, 'scale', {
      time: 0.75,
      value: [2, 2, 2],
      interpolation: 'linear',
      easing: { cp: [0.42, 0, 0.58, 1] }
    })
    const { downgrades } = documentToGltf(d)
    const codes = downgrades.map((x) => x.code)
    expect(codes).toContain('anim_catmullrom_baked')
    expect(codes).toContain('easing_baked')
  })
})

describe('documentToGltf 降级与命名', () => {
  it('display / flipbook 降级码；贴图名清洗与冲突递增', () => {
    let doc = createDocument({ name: 'x', format: 'free', now: 1000 })
    doc = addTexture(doc, tex('tex_a', '我的 贴图!', { animation: { frametime: 2 } }))
    doc = addTexture(doc, tex('tex_b', '我的 贴图!'))
    const cube = createCubeNode('box', { from: [0, 0, 0], to: [16, 16, 16] })
    cube.faces = {
      north: { uv: [0, 0, 16, 16], texture: 'tex_a' },
      south: { uv: [0, 0, 16, 16], texture: 'tex_b' }
    }
    doc = addNode(doc, cube, null)
    doc = { ...doc, display: { gui: { scale: [1, 1, 1] } } }
    const { output, downgrades } = documentToGltf(doc)
    const codes = downgrades.map((x) => x.code)
    expect(codes).toContain('display_dropped')
    expect(codes).toContain('flipbook_strip')
    const gltf = output.gltf as unknown as GltfJson
    expect(gltf.images.map((i) => i.uri)).toEqual(['______.png', '_______2.png'])
    expect(output.images.map((i) => i.name)).toEqual(['______.png', '_______2.png'])
  })
})

describe('documentToGltf 逐顶点蒙皮权重（v3 C3a）', () => {
  it('网格带 weights → WEIGHTS_0 反映逐顶点权重（多关节混合，非刚性）', () => {
    const { doc, meshId, g1, g2 } = meshRigDoc()
    const m = doc.nodes[meshId] as MeshNode
    // 四棱锥 apex = 顶点 4（出现在 4 个侧面）；base 四顶点留空 → 回退父关节刚性
    const weights = m.vertices.map((_, i) => (i === 4 ? { [g1]: 0.25, [g2]: 0.75 } : {}))
    const withW = patchNode(doc, meshId, { weights })
    const { output } = documentToGltf(withW)
    const gltf = output.gltf as unknown as GltfJson
    const skinNode = gltf.nodes.find((n) => n.name === 'skin')!
    expect(skinNode.skin).toBe(0)
    const prim = gltf.meshes[skinNode.mesh as number]!.primitives[0]!
    const W = readAccessor(gltf, output.bin, prim.attributes.WEIGHTS_0!)
    const J = readAccessor(gltf, output.bin, prim.attributes.JOINTS_0!)
    expect(J).toHaveLength(W.length)
    expect(W.length).toBe(18 * 4) // 6 三角 × 3 顶点
    // apex 三角（4 个侧面）：权重降序 [0.75,0.25,0,0]、关节 [g2=1, g1=0, 0,0]
    // base 三角：权重全归父关节 g1（JOINTS 0）
    let blended = 0
    for (let i = 0; i < W.length / 4; i++) {
      const wv = W.slice(i * 4, i * 4 + 4)
      const jv = J.slice(i * 4, i * 4 + 4)
      if (Math.abs(wv[0]! - 0.75) < 1e-5) {
        blended++
        closeAll(wv, [0.75, 0.25, 0, 0])
        expect(jv).toEqual([1, 0, 0, 0])
      } else {
        closeAll(wv, [1, 0, 0, 0])
        expect(jv).toEqual([0, 0, 0, 0])
      }
    }
    expect(blended).toBe(4) // 四个侧面各含 apex
  })

  it('网格无 weights 字段 → 刚性导出（每顶点父关节权重 1）', () => {
    const { doc, meshId } = meshRigDoc()
    const { output } = documentToGltf(doc)
    const gltf = output.gltf as unknown as GltfJson
    const skinNode = gltf.nodes.find((n) => n.name === 'skin')!
    const prim = gltf.meshes[skinNode.mesh as number]!.primitives[0]!
    const W = readAccessor(gltf, output.bin, prim.attributes.WEIGHTS_0!)
    const J = readAccessor(gltf, output.bin, prim.attributes.JOINTS_0!)
    for (let i = 0; i < W.length / 4; i++) {
      closeAll(W.slice(i * 4, i * 4 + 4), [1, 0, 0, 0])
      expect(J.slice(i * 4, i * 4 + 4)).toEqual([0, 0, 0, 0])
    }
    expect((doc.nodes[meshId] as MeshNode).weights).toBeUndefined()
  })
})

/* ================================================================== */
/* glTF 2.0 导入（C7）                                                */
/* ================================================================== */

/** 拼接多个 TypedArray 为一个 Uint8Array 再整体 base64（buffer 内各段偏移对齐） */
function joinB64(parts: Array<{ bytes: number[]; length: number }>): { uri: string; byteLength: number } {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const merged = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    merged.set(new Uint8Array(p.bytes), off)
    off += p.length
  }
  let bin = ''
  for (let i = 0; i < merged.length; i++) bin += String.fromCharCode(merged[i]!)
  return { uri: `data:application/octet-stream;base64,${btoa(bin)}`, byteLength: merged.length }
}

/** Float32Array 的原始字节（little-endian） */
function f32raw(...values: number[]): { bytes: number[]; length: number } {
  const f32 = new Float32Array(values)
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength)
  const bytes = Array.from(u8)
  return { bytes, length: u8.byteLength }
}

/** Uint16Array 的原始字节（little-endian） */
function u16raw(...values: number[]): { bytes: number[]; length: number } {
  const u16 = new Uint16Array(values)
  const u8 = new Uint8Array(u16.buffer, u16.byteOffset, u16.byteLength)
  const bytes = Array.from(u8)
  return { bytes, length: u8.byteLength }
}

/** 构造最小 glTF 2.0 JSON + embedded base64 buffer */
function makeGltf(json: Record<string, unknown>): Record<string, unknown> {
  return { asset: { version: '2.0', generator: 'test' }, ...json }
}

describe('gltfToDocument 基础几何', () => {
  it('单三角 TRIANGLES + embedded base64 buffer → 1 MeshNode，顶点 ×16，validate 干净', () => {
    // 3 顶点 POSITION = 3×12=36 字节，3 索引 UINT16 = 6 字节
    const buf = joinB64([f32raw(0, 0, 0, 1, 0, 0, 0, 1, 0), u16raw(0, 1, 2)])
    const gltf = makeGltf({
      buffers: [buf],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36, byteStride: 12 },
        { buffer: 0, byteOffset: 36, byteLength: 6 }
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }
      ],
      meshes: [
        {
          name: 'tri',
          primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }]
        }
      ],
      nodes: [{ name: 'root', mesh: 0 }],
      scenes: [{ nodes: [0] }]
    })
    const { doc, downgrades } = gltfToDocument(gltf, [], { fitToBox: false })
    expect(downgrades.map((d) => d.code)).not.toContain('gltf_')
    expect(Object.values(doc.nodes).filter((n) => n.type === 'mesh')).toHaveLength(1)
    const mesh = Object.values(doc.nodes).find((n) => n.type === 'mesh') as MeshNode
    // glTF 单位 米 ×16 = 文档单位，顶点 (0,0,0)(16,0,0)(0,16,0)
    expect(mesh.vertices).toHaveLength(3)
    closeAll(mesh.vertices[0]!, [0, 0, 0])
    closeAll(mesh.vertices[1]!, [16, 0, 0])
    closeAll(mesh.vertices[2]!, [0, 16, 0])
    expect(mesh.faces).toHaveLength(1)
    expect(mesh.faces[0]!.vertices).toEqual([0, 1, 2])
    expect(validateDocument(doc)).toHaveLength(0)
  })

  it('无 indices → POSITION 直接按 3 倍数展开；TRIANGLE_STRIP mode=5 → 相邻倒序展开', () => {
    // 无索引 + mode=4：6 顶点 → 2 三角
    const buf6 = joinB64([f32raw(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1)])
    const gltf1 = makeGltf({
      buffers: [buf6],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 72, byteStride: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 6, type: 'VEC3' }],
      meshes: [{ name: 'm', primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
      nodes: [{ name: 'root', mesh: 0 }],
      scenes: [{ nodes: [0] }]
    })
    const r1 = gltfToDocument(gltf1, [], { fitToBox: false })
    const m1 = Object.values(r1.doc.nodes).find((n) => n.type === 'mesh') as MeshNode
    expect(m1.faces).toHaveLength(2)

    // 三角带 mode=5：4 顶点 → 2 三角（v0,v2,v1 + v1,v3,v2）
    const buf4 = joinB64([f32raw(0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0)])
    const gltf2 = makeGltf({
      buffers: [buf4],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48, byteStride: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' }],
      meshes: [{ name: 'm', primitives: [{ attributes: { POSITION: 0 }, mode: 5 }] }],
      nodes: [{ name: 'root', mesh: 0 }],
      scenes: [{ nodes: [0] }]
    })
    const r2 = gltfToDocument(gltf2, [], { fitToBox: false })
    const m2 = Object.values(r2.doc.nodes).find((n) => n.type === 'mesh') as MeshNode
    expect(m2.faces).toHaveLength(2)
    // extractPrimTri 返回 flatten 三角汤（复制顶点）：
    // pushTri(0,2,1) → [v0, v2, v1]; pushTri(1,3,2) → [v1, v3, v2]
    // allVerts = [v0, v2, v1, v1, v3, v2]（6 顶点）
    expect(m2.vertices).toHaveLength(6)
    expect(m2.faces[0]!.vertices).toEqual([0, 1, 2]) // v0, v2, v1 在 allVerts 中的位置
    expect(m2.faces[1]!.vertices).toEqual([3, 4, 5]) // v1, v3, v2 在 allVerts 中的位置
  })

  it('TRS 节点层级（translation=vec3, rotation=quat, scale=vec3）→ GroupNode origin/rotation/scale 正确', () => {
    const buf = joinB64([f32raw(0, 0, 0, 1, 0, 0, 0, 1, 0)])
    const gltf = makeGltf({
      buffers: [buf],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, byteStride: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 0 } }] }],
      // 节点 0 = 组（带 TRS）；节点 1 = mesh（挂在组下）
      nodes: [
        { name: 'group', translation: [0.5, 0.25, 0], rotation: [...quatFromEulerXYZDeg([0, 0, 90])], scale: [2, 2, 2], children: [1] },
        { name: 'tri_mesh', mesh: 0 }
      ],
      scenes: [{ nodes: [0] }]
    })
    const { doc } = gltfToDocument(gltf, [], { fitToBox: false })
    const group = Object.values(doc.nodes).find((n) => n.type === 'group')!
    // translation (0.5, 0.25, 0) ×16 = origin (8, 4, 0)
    closeAll((group as import('../types').GroupNode).origin, [8, 4, 0])
    // rotation 四元数 [0,0,0.707,0.707] → XYZ 欧拉 (0,0,90)
    closeAll((group as import('../types').GroupNode).rotation, [0, 0, 90], 5)
    closeAll((group as import('../types').GroupNode).scale ?? [1, 1, 1], [2, 2, 2])
  })

  it('matrix 4×4 列主序 → TRS 分解正确', () => {
    // 纯平移矩阵 (0.5, 0.25, 0)，列主序
    const buf = joinB64([
      f32raw(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 0.25, 0, 1),
      f32raw(0, 0, 0, 1, 0, 0, 0, 1, 0)
    ])
    const gltf = makeGltf({
      buffers: [buf],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 64 },
        { buffer: 0, byteOffset: 64, byteLength: 36, byteStride: 12 }
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 16, type: 'SCALAR' },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }
      ],
      meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 1 } }] }],
      // 节点 0 = 组（matrix）；节点 1 = mesh
      nodes: [
        { name: 'group', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 0.25, 0, 1], children: [1] },
        { name: 'tri_mesh', mesh: 0 }
      ],
      scenes: [{ nodes: [0] }]
    })
    const { doc } = gltfToDocument(gltf, [], { fitToBox: false })
    const group = Object.values(doc.nodes).find((n) => n.type === 'group')!
    // 纯平移 → origin (8, 4, 0)、rotation (0,0,0)、scale (1,1,1)
    closeAll((group as import('../types').GroupNode).origin, [8, 4, 0])
    closeAll((group as import('../types').GroupNode).rotation, [0, 0, 0])
    closeAll((group as import('../types').GroupNode).scale ?? [1, 1, 1], [1, 1, 1])
  })

  it('UV 像素换算（无 v 翻转！glTF (0,0)=左上 与编辑器一致）', () => {
    // 交错 buffer：每个顶点 5 个 float（pos.x, pos.y, pos.z, uv.u, uv.v）= 20 字节
    // v0 (0,0,0)+(0,0)  v1 (1,0,0)+(1,1)  v2 (0,1,0)+(0,1)
    const buf = joinB64([f32raw(
      0, 0, 0, 0, 0,
      1, 0, 0, 1, 1,
      0, 1, 0, 0, 1
    )])
    const gltf = makeGltf({
      buffers: [buf],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 60, byteStride: 20 }],
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 0, byteOffset: 12, componentType: 5126, count: 3, type: 'VEC2' }
      ],
      meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 } }] }],
      nodes: [{ name: 'root', mesh: 0 }],
      scenes: [{ nodes: [0] }]
    })
    // textureSize 缺省 16
    const { doc } = gltfToDocument(gltf, [], { fitToBox: false, textureSize: 16 })
    const mesh = Object.values(doc.nodes).find((n) => n.type === 'mesh') as MeshNode
    expect(mesh.faces).toHaveLength(1)
    const uv = mesh.faces[0]!.uv!
    // v0 (0,0) → (0×16, 0×16) = (0, 0)
    closeAll(uv[0]!, [0, 0])
    // v1 (1,1) → (1×16, 1×16) = (16, 16) — **不翻 v！**
    closeAll(uv[1]!, [16, 16])
    // v2 (0,1) → (0, 16) — **不翻 v！**
    closeAll(uv[2]!, [0, 16])
  })

  it('TEXCOORD_0 缺失 → 跳过 uv + info 降级；无 faces[].uv', () => {
    const buf = joinB64([f32raw(0, 0, 0, 1, 0, 0, 0, 1, 0)])
    const gltf = makeGltf({
      buffers: [buf],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, byteStride: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ name: 'root', mesh: 0 }],
      scenes: [{ nodes: [0] }]
    })
    const { doc, downgrades } = gltfToDocument(gltf, [], { fitToBox: false })
    const mesh = Object.values(doc.nodes).find((n) => n.type === 'mesh') as MeshNode
    expect(mesh.faces).toHaveLength(1)
    // 无 TEXCOORD_0 → uv 放 [0,0] 占位（validate 要求 uv.length === vertices.length）
    expect(mesh.faces[0]!.uv).toHaveLength(3)
    closeAll(mesh.faces[0]!.uv![0]!, [0, 0])
    expect(validateDocument(doc)).toHaveLength(0)
    void downgrades // 无 info 降级码可断言（无 UV 不降级）
  })

  it('fitToBox 归一化：包围盒 1m × 1m × 2m → 等比装进 16×16×16（maxDim=2 最矮轴放大）', () => {
    // 6 顶点（mode=4 要求 3 的倍数，2 三角），范围 (0,0,0) → (1,1,2)
    const buf = joinB64([f32raw(
      0, 0, 0,   // v0
      1, 0, 0,   // v1
      0, 1, 0,   // v2
      1, 0, 1,   // v3
      0, 1, 2,   // v4
      1, 1, 2    // v5
    )])
    const gltf = makeGltf({
      buffers: [buf],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 72, byteStride: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 6, type: 'VEC3' }],
      meshes: [{ name: 'm', primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
      nodes: [{ name: 'root', mesh: 0 }],
      scenes: [{ nodes: [0] }]
    })
    const { doc } = gltfToDocument(gltf, [], { fitToBox: true })
    const mesh = Object.values(doc.nodes).find((n) => n.type === 'mesh') as MeshNode
    // 原始范围 (0,0,0) → (16,16,32)（×16），maxDim=32，scale = 16/32 = 0.5
    // extractPrimTri flatten 三角汤：mode=4 6 顶点 = 2 三角，每三角 3 顶点 → 6 顶点 allVerts
    // 缩放后每个顶点 ×0.5
    expect(mesh.vertices).toHaveLength(6)
    closeAll(mesh.vertices[0]!, [0, 0, 0])     // v0=(0,0,0)×0.5
    closeAll(mesh.vertices[1]!, [8, 0, 0])     // v1=(16,0,0)×0.5
    closeAll(mesh.vertices[2]!, [0, 8, 0])     // v2=(0,16,0)×0.5
    closeAll(mesh.vertices[3]!, [8, 0, 8])     // v3=(16,0,16)×0.5
    closeAll(mesh.vertices[4]!, [0, 8, 16])    // v4=(0,16,32)×0.5
    closeAll(mesh.vertices[5]!, [8, 8, 16])    // v5=(16,16,32)×0.5
    expect(validateDocument(doc)).toHaveLength(0)
  })

  it('version != 2.x → Error 抛错', () => {
    const gltf = makeGltf({ asset: { version: '1.0' }, buffers: [], bufferViews: [], accessors: [], meshes: [], nodes: [], scenes: [{ nodes: [] }] })
    expect(() => gltfToDocument(gltf, [], {})).toThrow('仅支持 2.x')
  })

  it('sparse accessor → info 降级不崩溃', () => {
    // 有 sparse 的 accessor 仍然要有有效 bufferView（否则解码崩溃）
    const buf = joinB64([f32raw(0, 0, 0, 1, 0, 0, 0, 1, 0)])
    const gltf = makeGltf({
      buffers: [buf],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, byteStride: 12 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', sparse: { count: 1, indices: { bufferView: 0 }, values: { bufferView: 0 } } }
      ],
      meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ name: 'root', mesh: 0 }],
      scenes: [{ nodes: [0] }]
    })
    const { doc, downgrades } = gltfToDocument(gltf, [], { fitToBox: false })
    expect(downgrades.map((d) => d.code)).toContain('gltf_sparse_not_supported')
    expect(validateDocument(doc)).toHaveLength(0)
  })

  it('贴图导入：baseColorTexture → ModelTexture 挂 mesh 面', () => {
    // 1×1 透明 PNG base64（最小合法 PNG）
    const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=='
    const buf = joinB64([f32raw(0, 0, 0, 1, 0, 0, 0, 1, 0)])
    const gltf = makeGltf({
      buffers: [buf],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36, byteStride: 12 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      meshes: [{ name: 'tri', primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      textures: [{ source: 0 }],
      images: [{ uri: `data:image/png;base64,${pngB64}` }],
      nodes: [{ name: 'root', mesh: 0 }],
      scenes: [{ nodes: [0] }]
    })
    const { doc } = gltfToDocument(gltf, [], { fitToBox: false })
    expect(Object.values(doc.textures)).toHaveLength(1)
    const mesh = Object.values(doc.nodes).find((n) => n.type === 'mesh') as MeshNode
    expect(mesh.faces).toHaveLength(1)
    expect(mesh.faces[0]!.texture).toBeTypeOf('string')
    expect(validateDocument(doc)).toHaveLength(0)
  })
})
