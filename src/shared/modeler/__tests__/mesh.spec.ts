/**
 * 网格（mesh）节点测试（B4-1，v2）。
 *
 * 核心不变量：
 * - createMeshNode：深拷贝种子几何，默认形（四棱锥）校验通过；
 * - validateDocument：越界下标 / UV 数不齐 / 顶点数非 3|4 / 贴图引用缺失 逐类检出；
 * - transform 三件套：平移同步 vertices+origin；旋转绕 pivot 更新 origin/rotation
 *   并刚性偏移顶点；缩放绕 pivot 缩放顶点；
 * - 序列化往返不丢；removeTexture 清 mesh 面贴图引用；duplicateNodes 深拷贝几何。
 */
import { describe, expect, it } from 'vitest'
import {
  addNode,
  addTexture,
  createDocument,
  createMeshNode,
  deserializeDocument,
  duplicateNodes,
  patchNode,
  removeTexture,
  serializeDocument,
  validateDocument
} from '../document'
import { rotateNodes, scaleNodes, translateNodes, documentAabb } from '../transform'
import {
  buildMeshEdges,
  defaultMeshGeometry,
  faceNormal,
  findEdgeRing,
  knifeCutPlane,
  loopCutMesh,
  mergeMeshVertices,
  meshEdgeKey,
  meshWorldVertices,
  parseMeshEdgeKey,
  removeMeshFaces,
  sliceMeshByPlane,
  splitMeshByVertices,
  translateMeshVertices,
  translateMeshVerticesProportional,
  triangulateFace
} from '../mesh'
import type { MeshFace, MeshNode, ModelTexture, Vec3 } from '../types'

function docWithMesh(node?: MeshNode) {
  let doc = createDocument({ name: 'd', format: 'free' })
  const mesh = node ?? createMeshNode('m', defaultMeshGeometry())
  doc = addNode(doc, mesh, null)
  return { doc, mesh }
}

function tex(): ModelTexture {
  return { id: 'tex-1', name: 't', width: 16, height: 16, data: 'data:image/png;base64,x', visible: true }
}

describe('createMeshNode / 默认形', () => {
  it('默认四棱锥：5 顶点 6 面，校验无问题', () => {
    const { doc } = docWithMesh()
    expect(validateDocument(doc)).toEqual([])
    const mesh = Object.values(doc.nodes)[0] as MeshNode
    expect(mesh.type).toBe('mesh')
    expect(mesh.vertices).toHaveLength(5)
    expect(mesh.faces).toHaveLength(6)
    expect(mesh.origin).toEqual([0, 0, 0])
    expect(mesh.rotation).toEqual([0, 0, 0])
  })

  it('种子几何深拷贝：改种子不影响节点', () => {
    const seed = defaultMeshGeometry()
    const node = createMeshNode('m', seed)
    seed.vertices[0]![0] = 999
    seed.faces[0]!.vertices[0] = 99
    expect(node.vertices[0]![0]).not.toBe(999)
    expect(node.faces[0]!.vertices[0]).not.toBe(99)
  })
})

describe('validateDocument mesh 分支', () => {
  it('越界顶点下标 → mesh_face_invalid', () => {
    const mesh = createMeshNode('m', defaultMeshGeometry())
    mesh.faces[0]!.vertices[0] = 99
    const { doc } = docWithMesh(mesh)
    const issues = validateDocument(doc)
    expect(issues.some((i) => i.code === 'mesh_face_invalid' && i.message.includes('越界'))).toBe(true)
  })

  it('UV 数与顶点数不一致 → mesh_face_invalid', () => {
    const mesh = createMeshNode('m', defaultMeshGeometry())
    mesh.faces[1]!.uv = [[0, 0]]
    const { doc } = docWithMesh(mesh)
    const issues = validateDocument(doc)
    expect(issues.some((i) => i.code === 'mesh_face_invalid' && i.message.includes('UV 数'))).toBe(true)
  })

  it('面顶点数非 3/4 → mesh_face_invalid', () => {
    const mesh = createMeshNode('m', defaultMeshGeometry())
    mesh.faces.push({ vertices: [0, 1, 2, 3, 4], uv: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] })
    const { doc } = docWithMesh(mesh)
    const issues = validateDocument(doc)
    expect(issues.some((i) => i.code === 'mesh_face_invalid' && i.message.includes('非法'))).toBe(true)
  })

  it('面贴图引用缺失 → texture_ref_missing；removeTexture 清理后不报', () => {
    let mesh = createMeshNode('m', defaultMeshGeometry())
    mesh.faces = mesh.faces.map((f) => ({ ...f, texture: 'tex-1' }))
    let doc = createDocument({ name: 'd', format: 'free' })
    doc = addNode(doc, mesh, null)
    expect(validateDocument(doc).some((i) => i.code === 'texture_ref_missing')).toBe(true)

    doc = addTexture(doc, tex())
    expect(validateDocument(doc)).toEqual([])
    doc = removeTexture(doc, 'tex-1')
    expect(validateDocument(doc)).toEqual([])
    const after = doc.nodes[mesh.id] as MeshNode
    expect(after.faces.every((f) => f.texture === undefined)).toBe(true)
    // uv 保留
    expect(after.faces[0]!.uv.length).toBeGreaterThan(0)
  })
})

describe('transform 三件套（mesh）', () => {
  it('translateNodes：顶点与 origin 同步平移', () => {
    const { doc, mesh } = docWithMesh()
    const next = translateNodes(doc, [mesh.id], [1, 2, 3])
    const moved = next.nodes[mesh.id] as MeshNode
    expect(moved.origin).toEqual([1, 2, 3])
    expect(moved.vertices[0]).toEqual([-3, 2, -1]) // [-4,0,-4] + [1,2,3]
    // 世界顶点 = 平移后的存储顶点（无旋转无父级）
    const world = meshWorldVertices(next, moved)
    expect(world[0]).toEqual([-3, 2, -1])
  })

  it('rotateNodes：绕世界 pivot 旋转，origin/rotation/顶点一致更新', () => {
    const { doc, mesh } = docWithMesh()
    // 绕世界原点 +90° Y（四元数 [0, sin45, 0, cos45]）
    const s = Math.SQRT1_2
    const next = rotateNodes(doc, [mesh.id], [0, s, 0, s], [0, 0, 0])
    const rotated = next.nodes[mesh.id] as MeshNode
    expect(rotated.rotation[1]).toBeCloseTo(90, 3)
    expect(rotated.origin).toEqual([0, 0, 0])
    // 世界顶点：[-4,0,-4] 绕 Y +90°（+Z→+X 语义，见 mat4RotationY）→ [-4,0,4] 附近
    const world = meshWorldVertices(next, rotated)
    const first = world[0]!
    expect(Math.hypot(first[0], first[2])).toBeCloseTo(Math.hypot(4, 4), 3)
    expect(first[1]).toBeCloseTo(0, 3)
  })

  it('scaleNodes：绕 pivot 缩放顶点与 origin', () => {
    const { doc, mesh } = docWithMesh()
    const next = scaleNodes(doc, [mesh.id], [2, 2, 2], [0, 0, 0])
    const scaled = next.nodes[mesh.id] as MeshNode
    expect(scaled.vertices[0]).toEqual([-8, 0, -8])
    expect(scaled.vertices[4]).toEqual([0, 16, 0])
    expect(scaled.origin).toEqual([0, 0, 0])
  })

  it('documentAabb 纳入网格顶点', () => {
    const { doc } = docWithMesh()
    const b = documentAabb(doc)
    expect(b).not.toBeNull()
    expect(b!.min).toEqual([-4, 0, -4])
    expect(b!.max).toEqual([4, 8, 4])
  })
})

describe('序列化 / 复制', () => {
  it('serialize → deserialize 往返不丢', () => {
    const { doc } = docWithMesh()
    const json = serializeDocument(doc)
    const back = deserializeDocument(json)
    expect(validateDocument(back)).toEqual([])
    const mesh = Object.values(back.nodes)[0] as MeshNode
    expect(mesh.vertices).toHaveLength(5)
    expect(mesh.faces).toHaveLength(6)
    expect(mesh.faces[0]!.uv).toEqual([[0, 16], [16, 0], [16, 16]])
  })

  it('duplicateNodes：几何深拷贝换新 id，改副本不动原件', () => {
    const { doc, mesh } = docWithMesh()
    const { doc: next, idMap } = duplicateNodes(doc, [mesh.id])
    const copyId = idMap[mesh.id]!
    expect(copyId).not.toBe(mesh.id)
    const copy = next.nodes[copyId] as MeshNode
    copy.vertices[0]![0] = 999
    const original = next.nodes[mesh.id] as MeshNode
    expect(original.vertices[0]![0]).toBe(-4)
    expect(validateDocument(next)).toEqual([])
  })

  it('patchNode 可写 vertices/faces（命令栈路径）', () => {
    const { doc, mesh } = docWithMesh()
    const vertices = mesh.vertices.map((v) => [v[0], v[1] + 1, v[2]] as Vec3)
    const next = patchNode(doc, mesh.id, { vertices })
    expect((next.nodes[mesh.id] as MeshNode).vertices[0]).toEqual([-4, 1, -4])
    expect(validateDocument(next)).toEqual([])
  })
})

describe('mesh.ts 纯函数', () => {
  it('triangulateFace：三角恒等 / 四边扇形 / 非法返回空', () => {
    expect(triangulateFace({ vertices: [0, 1, 2], uv: [] })).toEqual([[0, 1, 2]])
    expect(triangulateFace({ vertices: [0, 1, 2, 3], uv: [] })).toEqual([
      [0, 1, 2],
      [0, 2, 3]
    ])
    expect(triangulateFace({ vertices: [0, 1], uv: [] })).toEqual([])
  })

  it('faceNormal：+Y 朝上四边面法线 [0,1,0]；退化面零向量', () => {
    // 逆时针（从 +Y 看）四边面
    const n = faceNormal([
      [-1, 0, -1],
      [-1, 0, 1],
      [1, 0, 1],
      [1, 0, -1]
    ])
    expect(n[1]).toBeCloseTo(1, 5)
    const deg = faceNormal([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ])
    expect(deg).toEqual([0, 0, 0])
  })

  it('defaultMeshGeometry 面索引全部合法且 UV 对齐', () => {
    const g = defaultMeshGeometry()
    for (const f of g.faces) {
      expect(f.uv).toHaveLength(f.vertices.length)
      for (const vi of f.vertices) {
        expect(vi).toBeGreaterThanOrEqual(0)
        expect(vi).toBeLessThan(g.vertices.length)
      }
    }
  })
})

describe('顶点级编辑（B4-3）', () => {
  it('translateMeshVertices：只动选中顶点，未选中保持原引用', () => {
    const mesh = createMeshNode('m', defaultMeshGeometry())
    const before = mesh.vertices
    const out = translateMeshVertices(mesh, [0, 4], [1, 2, 3])
    expect(out[0]).toEqual([-3, 2, -1])
    expect(out[4]).toEqual([1, 10, 3])
    expect(out[1]).toBe(before[1]) // 未选中引用不变（命令差分最小化）
    expect(out).not.toBe(before)
    expect(before[0]).toEqual([-4, 0, -4]) // 纯函数不改输入
  })

  it('removeMeshFaces：删除选中面，顶点不压缩、保留面引用不变', () => {
    const mesh = createMeshNode('m', defaultMeshGeometry())
    const out = removeMeshFaces(mesh, [0, 2])
    expect(out).toHaveLength(4)
    expect(out[0]).toBe(mesh.faces[1]) // 保留面原引用
    // 顶点保持原样（删底面后其角点仍被侧面引用）
    expect(mesh.vertices).toHaveLength(5)
    // 全删 → 空面数组，校验仍通过
    expect(removeMeshFaces(mesh, [0, 1, 2, 3, 4, 5])).toEqual([])
  })

  it('patchNode 写删除后面数组 → 文档校验通过', () => {
    const { doc, mesh } = docWithMesh()
    const m = doc.nodes[mesh.id] as MeshNode
    const next = patchNode(doc, mesh.id, { faces: removeMeshFaces(m, [0, 1]) })
    expect(validateDocument(next)).toEqual([])
    expect((next.nodes[mesh.id] as MeshNode).faces).toHaveLength(4)
  })
})

describe('边与环切（v3 C1）', () => {
  /** 2 个并排四边面（XY 平面，共享中缝边 1-4）：0-1-4-3 与 1-2-5-4 */
  function quadStrip(): MeshNode {
    return createMeshNode('strip', {
      vertices: [
        [0, 0, 0],
        [4, 0, 0],
        [8, 0, 0],
        [0, 4, 0],
        [4, 4, 0],
        [8, 4, 0]
      ],
      faces: [
        { vertices: [0, 1, 4, 3], uv: [[0, 0], [4, 0], [4, 4], [0, 4]] },
        { vertices: [1, 2, 5, 4], uv: [[4, 0], [8, 0], [8, 4], [4, 4]] }
      ]
    })
  }

  it('meshEdgeKey：无向归一；parseMeshEdgeKey 往返', () => {
    expect(meshEdgeKey(4, 1)).toBe('1_4')
    expect(meshEdgeKey(1, 4)).toBe('1_4')
    expect(parseMeshEdgeKey('1_4')).toEqual({ a: 1, b: 4 })
    expect(parseMeshEdgeKey('bad')).toBeNull()
  })

  it('buildMeshEdges：2 四边面共 7 条唯一边（中缝边只出现一次）', () => {
    const edges = buildMeshEdges(quadStrip())
    expect(edges).toHaveLength(7)
    expect(edges.filter((e) => meshEdgeKey(e.a, e.b) === '1_4')).toHaveLength(1)
  })

  it('findEdgeRing：从边 0-3 穿越得竖直环（0-3 / 1-4 / 2-5），非闭合', () => {
    const ring = findEdgeRing(quadStrip(), { a: 0, b: 3 })
    expect(ring.closed).toBe(false)
    const keys = ring.edges.map((e) => meshEdgeKey(e.a, e.b)).sort()
    expect(keys).toEqual(['0_3', '1_4', '2_5'])
  })

  it('findEdgeRing：从中缝边 1-4 两侧穿越得同一环', () => {
    const ring = findEdgeRing(quadStrip(), { a: 1, b: 4 })
    const keys = ring.edges.map((e) => meshEdgeKey(e.a, e.b)).sort()
    expect(keys).toEqual(['0_3', '1_4', '2_5'])
  })

  it('loopCutMesh：竖直环切 → 4 面 9 顶点（2 四边面各一分为二），新增 3 个中点，UV 插值', () => {
    const node = quadStrip()
    const ring = findEdgeRing(node, { a: 0, b: 3 })
    const cut = loopCutMesh(node, ring.edges)
    expect(cut.vertices).toHaveLength(9)
    expect(cut.faces).toHaveLength(4)
    expect(cut.newVertexIndices).toHaveLength(3)
    // 原顶点引用不变（命令差分最小化）
    expect(cut.vertices[0]).toBe(node.vertices[0])
    // 中缝边(1-4)中点 [4,2,0] 被两面共享：只出现一次
    const mids = cut.newVertexIndices.map((i) => cut.vertices[i])
    expect(mids.filter((v) => v![0] === 4 && v![1] === 2 && v![2] === 0)).toHaveLength(1)
    // 切分后仍是四边面且 UV 逐顶点对齐
    for (const f of cut.faces) {
      expect(f.vertices).toHaveLength(4)
      expect(f.uv).toHaveLength(4)
    }
    // UV 插值：边 0-3（uv [0,0]→[0,4]）中点 uv = [0,2]
    const midUv = cut.faces.flatMap((f) => f.uv).filter((u) => u[0] === 0 && u[1] === 2)
    expect(midUv.length).toBeGreaterThan(0)
  })

  it('loopCutMesh：默认四棱锥全三角面 → 无切分（原样返回原引用）', () => {
    const node = createMeshNode('m', defaultMeshGeometry())
    const cut = loopCutMesh(node, buildMeshEdges(node))
    expect(cut.faces).toHaveLength(node.faces.length)
    expect(cut.faces).toBe(node.faces)
    expect(cut.vertices).toBe(node.vertices)
    expect(cut.newVertexIndices).toEqual([])
  })

  it('环切结果经 patchNode 写回文档并通过校验', () => {
    const node = quadStrip()
    const cut = loopCutMesh(node, findEdgeRing(node, { a: 0, b: 3 }).edges)
    let doc = createDocument({ name: 'd', format: 'free' })
    doc = addNode(doc, node, null)
    const next = patchNode(doc, node.id, { vertices: cut.vertices, faces: cut.faces })
    expect(validateDocument(next)).toEqual([])
    const after = next.nodes[node.id] as MeshNode
    expect(after.vertices).toHaveLength(9)
    expect(after.faces).toHaveLength(4)
  })
})

describe('切刀：平面跨面切割（v3 C2）', () => {
  const QUAD_UV: Array<[number, number]> = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4]
  ]

  /** 单个四边面（z=0 平面，x/y ∈ [0,4]，法线 +Z） */
  function wallQuad(): MeshNode {
    return createMeshNode('wall', {
      vertices: [
        [0, 0, 0],
        [4, 0, 0],
        [4, 4, 0],
        [0, 4, 0]
      ],
      faces: [{ vertices: [0, 1, 2, 3], uv: QUAD_UV.map((u) => [u[0], u[1]] as [number, number]) }]
    })
  }

  /** 立方体（[0,8]³，6 四边面） */
  function boxQuads(): MeshNode {
    return createMeshNode('box', {
      vertices: [
        [0, 0, 0],
        [8, 0, 0],
        [8, 8, 0],
        [0, 8, 0],
        [0, 0, 8],
        [8, 0, 8],
        [8, 8, 8],
        [0, 8, 8]
      ],
      faces: [
        { vertices: [0, 1, 2, 3], uv: QUAD_UV.map((u) => [u[0], u[1]] as [number, number]) },
        { vertices: [4, 5, 6, 7], uv: QUAD_UV.map((u) => [u[0], u[1]] as [number, number]) },
        { vertices: [0, 1, 5, 4], uv: QUAD_UV.map((u) => [u[0], u[1]] as [number, number]) },
        { vertices: [3, 2, 6, 7], uv: QUAD_UV.map((u) => [u[0], u[1]] as [number, number]) },
        { vertices: [0, 3, 7, 4], uv: QUAD_UV.map((u) => [u[0], u[1]] as [number, number]) },
        { vertices: [1, 2, 6, 5], uv: QUAD_UV.map((u) => [u[0], u[1]] as [number, number]) }
      ]
    })
  }

  it('knifeCutPlane：首击面法线 +Z、两点沿 X → 平面法线沿 Y（竖直面被横切）', () => {
    const n = knifeCutPlane(wallQuad(), 0, [0, 1, 0], [3, 1, 0])
    expect(n).not.toBeNull()
    expect(Math.abs(n![1]!)).toBeCloseTo(1, 6)
    expect(Math.abs(n![0]!)).toBeLessThan(1e-6)
    expect(Math.abs(n![2]!)).toBeLessThan(1e-6)
  })

  it('knifeCutPlane：两点沿首击面法线方向 → 平面不确定（null）', () => {
    expect(knifeCutPlane(wallQuad(), 0, [1, 1, 0], [1, 1, 5])).toBeNull()
  })

  it('knifeCutPlane：种子面下标越界 → null', () => {
    expect(knifeCutPlane(wallQuad(), 9, [0, 0, 0], [1, 1, 0])).toBeNull()
  })

  it('sliceMeshByPlane：单四边面对半切 → 2 面 6 顶点，新顶点在中线且 UV 插值', () => {
    const node = wallQuad()
    const cut = sliceMeshByPlane(node, [2, 0, 0], [1, 0, 0])
    expect(cut.vertices).toHaveLength(6)
    expect(cut.faces).toHaveLength(2)
    expect(cut.newVertexIndices).toHaveLength(2)
    // 新顶点恰在 x=2 且落在原边上（[2,0,0] / [2,4,0]）
    const mids = cut.newVertexIndices.map((i) => cut.vertices[i]!)
    expect(mids).toEqual(
      expect.arrayContaining([
        [2, 0, 0],
        [2, 4, 0]
      ])
    )
    // 两侧多边形均保持四边，UV 数对齐
    for (const f of cut.faces) {
      expect(f.vertices).toHaveLength(4)
      expect(f.uv).toHaveLength(4)
    }
    // UV 沿边线性插值：中点 uv = [2,0] 与 [2,4]
    const uvs = cut.faces.flatMap((f) => f.uv)
    expect(uvs).toEqual(
      expect.arrayContaining([
        [2, 0],
        [2, 4]
      ])
    )
    // 原顶点保持原引用（命令差分最小化）
    expect(cut.vertices[0]).toBe(node.vertices[0])
  })

  it('sliceMeshByPlane：立方体 x=4 中切 → 10 面 12 顶点，4 个新顶点共享自 4 条跨面边', () => {
    const node = boxQuads()
    const cut = sliceMeshByPlane(node, [4, 0, 0], [1, 0, 0])
    expect(cut.faces).toHaveLength(10) // x=0/x=8 两面保持 + 4 面各裂为 2
    expect(cut.vertices).toHaveLength(12)
    expect(cut.newVertexIndices).toHaveLength(4)
    for (const i of cut.newVertexIndices) expect(cut.vertices[i]![0]).toBeCloseTo(4, 9)
    for (const f of cut.faces) {
      expect(f.vertices.length).toBeGreaterThanOrEqual(3)
      expect(f.vertices.length).toBeLessThanOrEqual(4)
      expect(f.uv).toHaveLength(f.vertices.length)
    }
  })

  it('sliceMeshByPlane：三角面被切 → 一角一四边（共 2 面 2 新顶点）', () => {
    const node = createMeshNode('tri', {
      vertices: [
        [0, 0, 0],
        [4, 0, 0],
        [0, 4, 0]
      ],
      faces: [{ vertices: [0, 1, 2], uv: [[0, 0], [4, 0], [0, 4]] }]
    })
    const cut = sliceMeshByPlane(node, [2, 0, 0], [1, 0, 0])
    expect(cut.faces).toHaveLength(2)
    expect(cut.newVertexIndices).toHaveLength(2)
    const sizes = cut.faces.map((f) => f.vertices.length).sort()
    expect(sizes).toEqual([3, 4])
  })

  it('sliceMeshByPlane：平面未穿过网格 → 原样返回原引用', () => {
    const node = wallQuad()
    const cut = sliceMeshByPlane(node, [100, 0, 0], [1, 0, 0])
    expect(cut.vertices).toBe(node.vertices)
    expect(cut.faces).toBe(node.faces)
    expect(cut.newVertexIndices).toEqual([])
  })

  it('sliceMeshByPlane：面全在正侧（平面只擦过边界）→ 保持原引用不裂面', () => {
    const node = wallQuad()
    // 平面 y=0（法线 +Y）：面顶点 y ∈ {0,4} 全部 >= 0 → 平面只沿边 v0-v1 擦过，不切割
    const cut = sliceMeshByPlane(node, [0, 0, 0], [0, 1, 0])
    expect(cut.faces).toBe(node.faces)
    expect(cut.vertices).toBe(node.vertices)
    expect(cut.newVertexIndices).toEqual([])
  })

  it('切刀结果经 patchNode 写回文档并通过校验', () => {
    const node = boxQuads()
    const cut = sliceMeshByPlane(node, [4, 0, 0], [1, 0, 0])
    let doc = createDocument({ name: 'd', format: 'free' })
    doc = addNode(doc, node, null)
    const next = patchNode(doc, node.id, { vertices: cut.vertices, faces: cut.faces })
    expect(validateDocument(next)).toEqual([])
    const after = next.nodes[node.id] as MeshNode
    expect(after.vertices).toHaveLength(12)
    expect(after.faces).toHaveLength(10)
  })
})

describe('顶点合并（v3 C6a）', () => {
  it('无重复顶点：mergedCount=0，vertices/faces 原引用保持（零开销）', () => {
    const node = createMeshNode('m', defaultMeshGeometry())
    const result = mergeMeshVertices(node)
    expect(result.mergedCount).toBe(0)
    expect(result.vertices).toBe(node.vertices)
    expect(result.faces).toBe(node.faces)
    expect(result.remap).toEqual([0, 1, 2, 3, 4])
  })

  it('合并重复坐标顶点：两顶点同坐标 → 合并为一个，faces 重索引正确', () => {
    /* 顶点 0 和 1 坐标相同（盒子两个顶点在原点重合的退化盒） */
    const verts: Vec3[] = [
      [0, 0, 0],
      [0, 0, 0], /* 与 0 同坐标 */
      [4, 0, 0],
      [4, 4, 0],
      [0, 4, 0]
    ]
    const faces = [
      { vertices: [0, 2, 3, 4], uv: [[0, 0], [16, 0], [16, 16], [0, 16]] },
      { vertices: [1, 3, 2], uv: [[8, 8], [16, 16], [16, 8]] }
    ]
    const node = createMeshNode('m', { vertices: verts, faces: faces as MeshFace[] })
    const r = mergeMeshVertices(node)
    expect(r.mergedCount).toBe(1)
    /* 顶点 1 合并进 0 → vertices 长度从 5 变 4，remap[1]=0 */
    expect(r.vertices).toHaveLength(4)
    expect(r.remap).toEqual([0, 0, 1, 2, 3])
    /* 第二个面原顶点 1 重映射到 0 → faces 内部 [1,3,2] → [0,2,1] */
    expect(r.faces[1]!.vertices).toEqual([0, 2, 1])
    /* UV 保留（本面原 UV 继承，首次出现策略兜底） */
    expect(r.faces[0]!.uv).toEqual([[0, 0], [16, 0], [16, 16], [0, 16]])
  })

  it('合并后剔除未被任何 face 引用的孤立顶点', () => {
    const verts: Vec3[] = [
      [0, 0, 0], /* 被面引用 */
      [2, 0, 0], /* 被面引用 */
      [0, 2, 0], /* 被面引用 */
      [99, 99, 99] /* 孤立，不在任何 face */
    ]
    const faces = [
      { vertices: [0, 1, 2], uv: [[0, 0], [16, 0], [8, 16]] }
    ]
    const node = createMeshNode('m', { vertices: verts, faces: faces as MeshFace[] })
    const r = mergeMeshVertices(node)
    /* 顶点 3 孤立 → 压缩剔除，vertices 长度从 4 变 3 */
    expect(r.vertices).toHaveLength(3)
    expect(r.mergedCount).toBe(0)
    expect(r.faces[0]!.vertices).toEqual([0, 1, 2])
  })

  it('阈值参数生效：1e-6 内合并；阈值过小跳过', () => {
    const verts: Vec3[] = [
      [0, 0, 0],
      [0.5e-6, 0, 0], /* 距离 0.5e-6 */
      [4, 0, 0],
      [4, 4, 0],
      [0, 4, 0]
    ]
    const faces = [
      { vertices: [0, 2, 3, 4], uv: [[0, 0], [16, 0], [16, 16], [0, 16]] },
      { vertices: [1, 3, 2], uv: [[8, 8], [16, 16], [16, 8]] }
    ]
    const node = createMeshNode('m', { vertices: verts, faces: faces as MeshFace[] })
    const big = mergeMeshVertices(node, 1e-5)
    expect(big.mergedCount).toBe(1)
    const small = mergeMeshVertices(node, 1e-7)
    expect(small.mergedCount).toBe(0)
  })
})

describe('mesh 分裂（v3 C6b）', () => {
  it('按顶点集合分裂：面全在 keepSet → 归属第一 mesh；全在另一侧 → 第二 mesh', () => {
    const verts: Vec3[] = [
      [0, 0, 0], /* 0 */
      [2, 0, 0], /* 1 */
      [0, 2, 0], /* 2 */
      [10, 0, 0], /* 3 */
      [12, 0, 0], /* 4 */
      [10, 2, 0]  /* 5 */
    ]
    const faces = [
      { vertices: [0, 1, 2], uv: [[0, 0], [16, 0], [8, 16]] },
      { vertices: [3, 4, 5], uv: [[0, 0], [16, 0], [8, 16]] }
    ]
    const node = createMeshNode('m', { vertices: verts, faces: faces as MeshFace[] })
    const r = splitMeshByVertices(node, [0, 1, 2])
    expect(r.meshes).toHaveLength(2)
    expect(r.meshes[0]!.vertices).toHaveLength(3) /* keep 侧 3 顶点 */
    expect(r.meshes[0]!.faces).toHaveLength(1)
    expect(r.meshes[1]!.vertices).toHaveLength(3) /* 另一侧 3 顶点 */
    expect(r.meshes[1]!.faces).toHaveLength(1)
  })

  it('横跨两侧的面直接丢弃（用户跨面选择场景 info 降级）', () => {
    const verts: Vec3[] = [
      [0, 0, 0], /* 0 keep */
      [4, 0, 0], /* 1 other */
      [0, 4, 0]  /* 2 keep */
    ]
    const faces = [
      { vertices: [0, 1, 2], uv: [[0, 0], [16, 0], [8, 16]] } /* 横跨 keep/other */
    ]
    const node = createMeshNode('m', { vertices: verts, faces: faces as MeshFace[] })
    const r = splitMeshByVertices(node, [0, 2])
    /* 两侧都没独立面 → 只返回空结果 */
    expect(r.meshes).toHaveLength(0)
  })

  it('分裂后顶点池独立（两侧各自重索引为 0..n）', () => {
    const verts: Vec3[] = [
      [0, 0, 0], [2, 0, 0], [0, 2, 0], /* keep */
      [10, 0, 0], [12, 0, 0], [10, 2, 0] /* other */
    ]
    const faces = [
      { vertices: [0, 1, 2], uv: [[0, 0], [16, 0], [8, 16]] },
      { vertices: [3, 4, 5], uv: [[0, 0], [16, 0], [8, 16]] }
    ]
    const node = createMeshNode('m', { vertices: verts, faces: faces as MeshFace[] })
    const r = splitMeshByVertices(node, [0, 1, 2])
    /* 第二 mesh 的 faces 顶点应重映射到 0..2 而非 3..5 */
    expect(r.meshes[1]!.faces[0]!.vertices).toEqual([0, 1, 2])
    expect(r.meshes[1]!.vertices[0]).toEqual([10, 0, 0])
  })

  it('split + merge 组合：分裂后两侧各自 merge 相同顶点 → 独立干净 mesh', () => {
    /* 退化盒：两面共享两条边（相同顶点引用），合并后成干净三角 */
    const verts: Vec3[] = [[0, 0, 0], [4, 0, 0], [0, 4, 0], [4, 4, 0]]
    const faces = [
      { vertices: [0, 1, 2], uv: [[0, 0], [16, 0], [8, 16]] },
      { vertices: [1, 3, 2], uv: [[16, 0], [16, 16], [8, 16]] }
    ]
    const node = createMeshNode('m', { vertices: verts, faces: faces as MeshFace[] })
    /* keepSet=[0,1,2]（仅含第一面） */
    const r = splitMeshByVertices(node, [0, 1, 2])
    expect(r.meshes).toHaveLength(1) /* 第二面顶点 3 不在 keepSet 里、但单独构面 */
    /* split 结果可直接 createMeshNode + mergeMeshVertices 继续处理 */
    const merged = mergeMeshVertices(createMeshNode('sub', r.meshes[0]!))
    expect(merged.vertices).toHaveLength(3)
    expect(merged.faces[0]!.vertices).toEqual([0, 1, 2])
  })
})

describe('proportional edit 核心（v3 C6c）', () => {
  it('权重 1 的顶点完整偏移；权重 0 的不动', () => {
    const verts: Vec3[] = [[0, 0, 0], [2, 0, 0], [0, 2, 0], [4, 4, 4]]
    const faces = [{ vertices: [0, 1, 2, 3], uv: [[0, 0], [16, 0], [8, 16], [16, 16]] }]
    const node = createMeshNode('m', { vertices: verts, faces: faces as MeshFace[] })
    /* 选中顶点 0 和 3；权重分别为 1 和 0 */
    const w = translateMeshVerticesProportional(node, [0, 3], [1, 2, 3], [1, 0])
    expect(w[0]).toEqual([1, 2, 3]) /* 权重 1 → 完整偏移 */
    expect(w[3]).toEqual([4, 4, 4]) /* 权重 0 → 不动 */
    expect(w[1]).toEqual([2, 0, 0]) /* 未选中 → 不动 */
  })

  it('未提供 weights → 退化为 translateMeshVertices（全部权重=1）', () => {
    const verts: Vec3[] = [[0, 0, 0], [2, 0, 0]]
    const faces: MeshFace[] = [{ vertices: [0, 1, 1], uv: [[0, 0], [16, 0], [16, 0]] }]
    const node = createMeshNode('m', { vertices: verts, faces })
    const w = translateMeshVerticesProportional(node, [0], [3, 0, 0])
    expect(w[0]).toEqual([3, 0, 0])
    expect(w[1]).toEqual([2, 0, 0])
  })
})
