import { describe, expect, it } from 'vitest'
import {
  addVec3,
  aabbOfPoints,
  cubeWorldCorners,
  eulerMatrix,
  localMatrixOf,
  mat4Identity,
  mat4Invert,
  mat4Multiply,
  mat4RotationX,
  mat4RotationY,
  mat4RotationZ,
  mat4Scale,
  mat4Translation,
  negVec3,
  rotationAroundPivot,
  quatRotatePoint,
  rotateNodes,
  scaleNodes,
  transformDirection,
  transformPoint,
  translateNodes,
  worldAabbOfNode,
  worldAabbOfNodes,
  worldMatrixOf,
  worldPivotOf,
  documentAabb
} from '../transform'
import { createCubeNode, createDocument, createGroupNode, createLocatorNode, addNode, effectiveSelection } from '../document'
import { isCubeNode, isGroupNode, isLocatorNode } from '../types'
import type { CubeNode, GroupNode, LocatorNode, ModelDocument, Vec3 } from '../types'
import { quatFromEulerXYZDeg } from '../quat'
import type { Quat } from '../quat'

/** 固定测试文档：root: [cube1, group1[locator1, cube2], cube3] */
function fixture(): { doc: ModelDocument; ids: Record<string, string> } {
  let doc = createDocument({ id: 'doc-t', name: 't', format: 'free', now: 1000 })
  const cube1 = createCubeNode('c1', { from: [0, 0, 0], to: [8, 8, 8] })
  const group1 = createGroupNode('g1')
  const locator1 = createLocatorNode('l1', [1, 2, 3])
  const cube2 = createCubeNode('c2')
  const cube3 = createCubeNode('c3')
  doc = addNode(doc, cube1, null)
  doc = addNode(doc, group1, null)
  doc = addNode(doc, locator1, group1.id)
  doc = addNode(doc, cube2, group1.id)
  doc = addNode(doc, cube3, null)
  return {
    doc,
    ids: { cube1: cube1.id, group1: group1.id, locator1: locator1.id, cube2: cube2.id, cube3: cube3.id }
  }
}

/** 取出并收窄节点类型（断言失败即抛错） */
function cubeOf(doc: ModelDocument, id: string): CubeNode {
  const n = doc.nodes[id]!
  if (!isCubeNode(n)) throw new Error(`节点 ${id} 不是立方体`)
  return n
}
function groupOf(doc: ModelDocument, id: string): GroupNode {
  const n = doc.nodes[id]!
  if (!isGroupNode(n)) throw new Error(`节点 ${id} 不是组`)
  return n
}
function locatorOf(doc: ModelDocument, id: string): LocatorNode {
  const n = doc.nodes[id]!
  if (!isLocatorNode(n)) throw new Error(`节点 ${id} 不是定位器`)
  return n
}

function expectVecClose(actual: Vec3, expected: Vec3): void {
  expect(actual[0]).toBeCloseTo(expected[0], 6)
  expect(actual[1]).toBeCloseTo(expected[1], 6)
  expect(actual[2]).toBeCloseTo(expected[2], 6)
}

describe('modeler/transform Mat4 基础', () => {
  it('identity / translation / scale', () => {
    expect(mat4Identity()).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    const t = mat4Translation([1, 2, 3])
    expectVecClose(transformPoint(t, [0, 0, 0]), [1, 2, 3])
    const s = mat4Scale([2, 3, 4])
    expectVecClose(transformPoint(s, [1, 1, 1]), [2, 3, 4])
  })

  it('三轴旋转：+90° 右手系（X: +Y→+Z；Y: +Z→+X；Z: +X→+Y）', () => {
    expectVecClose(transformPoint(mat4RotationX(90), [0, 1, 0]), [0, 0, 1])
    expectVecClose(transformPoint(mat4RotationY(90), [0, 0, 1]), [1, 0, 0])
    expectVecClose(transformPoint(mat4RotationZ(90), [1, 0, 0]), [0, 1, 0])
  })

  it('eulerMatrix：单轴退化为纯旋转；多轴等于 Rx·Ry·Rz 合成', () => {
    expectVecClose(transformPoint(eulerMatrix([90, 0, 0]), [0, 1, 0]), [0, 0, 1])
    expectVecClose(transformPoint(eulerMatrix([0, 90, 0]), [0, 0, 1]), [1, 0, 0])
    expectVecClose(transformPoint(eulerMatrix([0, 0, 90]), [1, 0, 0]), [0, 1, 0])
    const composed = mat4Multiply(mat4Multiply(mat4RotationX(30), mat4RotationY(45)), mat4RotationZ(60))
    const p = transformPoint(eulerMatrix([30, 45, 60]), [3, -2, 5])
    expectVecClose(p, transformPoint(composed, [3, -2, 5]))
  })

  it('rotationAroundPivot：pivot 不动、偏移点绕 pivot 旋转', () => {
    const m = rotationAroundPivot([0, 0, 90], [8, 0, 0])
    expectVecClose(transformPoint(m, [8, 0, 0]), [8, 0, 0])
    expectVecClose(transformPoint(m, [12, 0, 0]), [8, 4, 0])
  })

  it('mat4Multiply：先作用右矩阵（T·R 先旋转后平移）', () => {
    const m = mat4Multiply(mat4Translation([10, 0, 0]), mat4RotationZ(90))
    expectVecClose(transformPoint(m, [1, 0, 0]), [10, 1, 0])
  })

  it('mat4Invert：M·M⁻¹ ≈ I；奇异矩阵抛错', () => {
    const m = mat4Multiply(
      mat4Translation([3, -2, 7]),
      mat4Multiply(rotationAroundPivot([10, 20, 30], [1, 2, 3]), mat4Scale([2, 1, 0.5]))
    )
    const inv = mat4Invert(m)
    const round = mat4Multiply(m, inv)
    expectVecClose(
      [round[0]!, round[5]!, round[10]!],
      [1, 1, 1]
    )
    expect(Math.abs(round[12]!)).toBeLessThan(1e-9)
    expect(Math.abs(round[13]!)).toBeLessThan(1e-9)
    expect(Math.abs(round[14]!)).toBeLessThan(1e-9)
    expect(() => mat4Invert(mat4Scale([0, 1, 1]))).toThrow(/不可逆/)
  })

  it('transformDirection 不含平移；addVec3/negVec3', () => {
    const m = mat4Multiply(mat4Translation([5, 5, 5]), mat4RotationZ(90))
    expectVecClose(transformDirection(m, [1, 0, 0]), [0, 1, 0])
    expectVecClose(addVec3([1, 2, 3], [10, 20, 30]), [11, 22, 33])
    expectVecClose(negVec3([1, -2, 3]), [-1, 2, -3])
  })
})

describe('modeler/transform 节点变换', () => {
  it('localMatrixOf：locator = T(position)', () => {
    const { doc, ids } = fixture()
    const m = localMatrixOf(doc.nodes[ids.locator1]!)
    expectVecClose(transformPoint(m, [0, 0, 0]), [1, 2, 3])
  })

  it('localMatrixOf：cube 零旋转 = 单位阵；绕 origin 旋转作用于几何', () => {
    const cube = createCubeNode('c', { from: [0, 0, 0], to: [8, 8, 8] })
    cube.rotation = [0, 0, 90]
    cube.origin = [8, 0, 0]
    const m = localMatrixOf(cube)
    expectVecClose(transformPoint(m, [12, 0, 0]), [8, 4, 0])
    const plain = localMatrixOf(createCubeNode('p'))
    expectVecClose(transformPoint(plain, [3, 4, 5]), [3, 4, 5])
  })

  it('localMatrixOf：group 含 scale 时 T(p)·R·S·T(−p)', () => {
    const g = createGroupNode('g')
    g.origin = [10, 0, 0]
    g.rotation = [0, 0, 0]
    g.scale = [2, 1, 1]
    expectVecClose(transformPoint(localMatrixOf(g), [12, 0, 0]), [14, 0, 0])
  })

  it('worldMatrixOf：父链合成——组绕 pivot 旋转子树，子树坐标不变', () => {
    let doc = createDocument({ name: 't', format: 'free' })
    const g = createGroupNode('g')
    g.origin = [8, 0, 0]
    g.rotation = [0, 90, 0]
    const c = createCubeNode('c', { from: [0, 0, 0], to: [4, 4, 4] })
    doc = addNode(doc, g, null)
    doc = addNode(doc, c, g.id)
    const m = worldMatrixOf(doc, c.id)
    // 角点 [0,0,0]：相对 pivot (−8,0,0) 绕 Y 转 90° → (0,0,8)，回到 pivot (8,0,8)
    expectVecClose(transformPoint(m, [0, 0, 0]), [8, 0, 8])
    // 角点 [4,4,4]：相对 pivot (−4,4,4) → Ry90 → (4,4,4) → (12,4,4)
    expectVecClose(transformPoint(m, [4, 4, 4]), [12, 4, 4])
  })

  it('worldMatrixOf：未知 id 返回单位阵', () => {
    const { doc } = fixture()
    expect(worldMatrixOf(doc, 'nope')).toEqual(mat4Identity())
  })

  it('worldPivotOf：cube/group 取 origin 世界位置；locator 取 position 世界位置', () => {
    const { doc, ids } = fixture()
    // cube1 顶层无变换 → origin [0,0,0]
    expectVecClose(worldPivotOf(doc, ids.cube1), [0, 0, 0])
    // locator1 顶层位置 [1,2,3]（其父 group1 无变换）
    expectVecClose(worldPivotOf(doc, ids.locator1), [1, 2, 3])
    // 父链连续空间语义：组无旋转时改 origin 只挪旋转中心，子级世界位置不变
    const g = groupOf(doc, ids.group1)
    const moved = {
      ...doc,
      nodes: { ...doc.nodes, [ids.group1]: { ...g, origin: [20, 0, 0] as Vec3 } }
    }
    expectVecClose(worldPivotOf(moved, ids.locator1), [1, 2, 3])
    // 组绕 pivot (8,0,0) 转 Rz90：子级 [1,2,3] → 相对 (−7,2,3) 旋转 → (6,−7,3)
    const rotated = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [ids.group1]: { ...g, origin: [8, 0, 0] as Vec3, rotation: [0, 0, 90] as Vec3 }
      }
    }
    expectVecClose(worldPivotOf(rotated, ids.locator1), [6, -7, 3])
  })

  it('cubeWorldCorners：8 角点且含自身旋转', () => {
    let doc = createDocument({ name: 't', format: 'free' })
    const c = createCubeNode('c', { from: [0, 0, 0], to: [4, 4, 4] })
    c.rotation = [0, 0, 90]
    c.origin = [0, 0, 0]
    doc = addNode(doc, c, null)
    const corners = cubeWorldCorners(doc, c)
    expect(corners).toHaveLength(8)
    const xs = corners.map((p) => p[0])
    const ys = corners.map((p) => p[1])
    // Rz90 把 [0,4] 映到 x∈[−4,0]、y∈[0,4]
    expect(Math.min(...xs)).toBeCloseTo(-4, 6)
    expect(Math.max(...xs)).toBeCloseTo(0, 6)
    expect(Math.min(...ys)).toBeCloseTo(0, 6)
    expect(Math.max(...ys)).toBeCloseTo(4, 6)
  })
})

describe('modeler/transform 包围盒', () => {
  it('aabbOfPoints：空集 null；点集取极值', () => {
    expect(aabbOfPoints([])).toBeNull()
    const b = aabbOfPoints([
      [1, 2, 3],
      [-1, 5, 0]
    ])!
    expectVecClose(b.min, [-1, 2, 0])
    expectVecClose(b.max, [1, 5, 3])
  })

  it('worldAabbOfNode：旋转 45° 的立方体包围盒大于几何本身', () => {
    let doc = createDocument({ name: 't', format: 'free' })
    const c = createCubeNode('c', { from: [4, 4, 0], to: [12, 12, 16] })
    c.rotation = [0, 0, 45]
    c.origin = [8, 8, 0]
    doc = addNode(doc, c, null)
    const b = worldAabbOfNode(doc, c.id)!
    expect(b.min[0]).toBeCloseTo(8 - 4 * Math.SQRT2, 6)
    expect(b.max[1]).toBeCloseTo(8 + 4 * Math.SQRT2, 6)
    expect(b.min[2]).toBeCloseTo(0, 6)
    expect(b.max[2]).toBeCloseTo(16, 6)
  })

  it('worldAabbOfNode：组聚合子树（含 locator 单点）；worldAabbOfNodes 混合取并', () => {
    const { doc, ids } = fixture()
    const bGroup = worldAabbOfNode(doc, ids.group1)!
    // group1 含 cube2 [0..16]³ 与 locator1 [1,2,3]
    expectVecClose(bGroup.min, [0, 0, 0])
    expectVecClose(bGroup.max, [16, 16, 16])
    const bMixed = worldAabbOfNodes(doc, [ids.cube1, ids.cube3])!
    expectVecClose(bMixed.min, [0, 0, 0])
    expectVecClose(bMixed.max, [16, 16, 16])
    expect(worldAabbOfNodes(doc, ['nope'])).toBeNull()
  })

  it('documentAabb：空文档 null；visibleOnly 跳过隐藏子树', () => {
    const empty = createDocument({ name: 'e', format: 'free' })
    expect(documentAabb(empty)).toBeNull()
    let doc = createDocument({ name: 't', format: 'free' })
    const a = createCubeNode('a', { from: [0, 0, 0], to: [4, 4, 4] })
    const g = createGroupNode('g')
    const b = createCubeNode('b', { from: [100, 0, 0], to: [104, 4, 4] })
    doc = addNode(doc, a, null)
    doc = addNode(doc, g, null)
    doc = addNode(doc, b, g.id)
    doc = { ...doc, nodes: { ...doc.nodes, [g.id]: { ...doc.nodes[g.id]!, visible: false } } }
    const all = documentAabb(doc)!
    expectVecClose(all.max, [104, 4, 4])
    const visibleOnly = documentAabb(doc, { visibleOnly: true })!
    expectVecClose(visibleOnly.max, [4, 4, 4])
  })
})

describe('modeler/transform 多选平移与顶层化', () => {
  it('effectiveSelection：祖先选中时剔除后代；过滤未知 id', () => {
    const { doc, ids } = fixture()
    expect(effectiveSelection(doc, [ids.group1, ids.cube2, ids.locator1])).toEqual([ids.group1])
    expect(effectiveSelection(doc, [ids.cube1, ids.cube3, 'nope'])).toEqual([ids.cube1, ids.cube3])
    expect(effectiveSelection(doc, [])).toEqual([])
  })

  it('translateNodes：单立方体 from/to/origin 同步偏移，faces 不动', () => {
    const { doc, ids } = fixture()
    const before = cubeOf(doc, ids.cube1)
    const next = translateNodes(doc, [ids.cube1], [1, 2, 3], 2000)
    const after = cubeOf(next, ids.cube1)
    expectVecClose(after.from, [1, 2, 3])
    expectVecClose(after.to, [9, 10, 11])
    expectVecClose(after.origin, [1, 2, 3])
    expect(after.faces).toEqual(before.faces)
    expect(next.meta.updatedAt).toBe(2000)
    expect(cubeOf(doc, ids.cube1).from).toEqual([0, 0, 0])
  })

  it('translateNodes：组平移带动整棵子树（世界刚体）', () => {
    const { doc, ids } = fixture()
    const next = translateNodes(doc, [ids.group1], [10, 0, 0], 2000)
    expectVecClose(groupOf(next, ids.group1).origin, [10, 0, 0])
    expectVecClose(cubeOf(next, ids.cube2).from, [10, 0, 0])
    expectVecClose(cubeOf(next, ids.cube2).to, [26, 16, 16])
    expectVecClose(cubeOf(next, ids.cube2).origin, [10, 0, 0])
    expectVecClose(locatorOf(next, ids.locator1).position, [11, 2, 3])
    // 未选中子树不受影响
    expectVecClose(cubeOf(next, ids.cube1).from, [0, 0, 0])
  })

  it('translateNodes：父子同时选中不重复施加；未知 id 与零 delta 原样返回', () => {
    const { doc, ids } = fixture()
    const next = translateNodes(doc, [ids.group1, ids.cube2, ids.locator1], [1, 1, 1], 2000)
    expectVecClose(cubeOf(next, ids.cube2).from, [1, 1, 1])
    expect(translateNodes(doc, [ids.cube1], [0, 0, 0])).toBe(doc)
    expect(translateNodes(doc, ['nope'], [1, 1, 1])).toBe(doc)
  })
})

describe('modeler/transform 多选旋转与缩放', () => {
  const Y90 = quatFromEulerXYZDeg([0, 90, 0]) // +90° 绕 Y：(x,y,z) → (z,y,−x)

  /** 世界角点应等于「绕 pivot 刚性旋转/缩放」后的位置（逐点对比，顺序由 cubeWorldCorners 保证） */
  function expectCornersMapped(before: Vec3[], after: Vec3[], map: (p: Vec3) => Vec3): void {
    expect(after.length).toBe(before.length)
    for (let i = 0; i < before.length; i++) expectVecClose(after[i]!, map(before[i]!))
  }
  const rotAbout =
    (q: Quat, pivot: Vec3) =>
    (p: Vec3): Vec3 =>
      addVec3(pivot, quatRotatePoint(q, [p[0] - pivot[0], p[1] - pivot[1], p[2] - pivot[2]]))
  const scaleAbout =
    (s: Vec3, pivot: Vec3) =>
    (p: Vec3): Vec3 =>
      [pivot[0] + s[0] * (p[0] - pivot[0]), pivot[1] + s[1] * (p[1] - pivot[1]), pivot[2] + s[2] * (p[2] - pivot[2])]

  it('rotateNodes：无父级立方体绕外部 pivot 旋转，origin 刚性移动、几何平移、欧拉合成', () => {
    let doc = createDocument({ name: 't', format: 'free' })
    const c = createCubeNode('c', { from: [0, 0, 0], to: [16, 16, 16] })
    c.origin = [8, 8, 8]
    doc = addNode(doc, c, null)
    const next = rotateNodes(doc, [c.id], Y90, [0, 0, 0], 2000)
    const after = cubeOf(next, c.id)
    expectVecClose(after.origin, [8, 8, -8])
    expectVecClose(after.from, [0, 0, -16])
    expectVecClose(after.to, [16, 16, 0])
    expectVecClose(after.rotation, [0, 90, 0])
    expect(next.meta.updatedAt).toBe(2000)
    // 世界几何 = 刚性旋转
    expectCornersMapped(cubeWorldCorners(doc, cubeOf(doc, c.id)), cubeWorldCorners(next, cubeOf(next, c.id)), rotAbout(Y90, [0, 0, 0]))
  })

  it('rotateNodes：旋转父级下的子立方体仍为世界刚体旋转（欧拉重提取）', () => {
    let doc = createDocument({ name: 't', format: 'free' })
    const g = createGroupNode('g')
    g.rotation = [0, 90, 0]
    g.origin = [8, 8, 8]
    const c = createCubeNode('c', { from: [0, 0, 0], to: [4, 4, 4] })
    c.origin = [2, 2, 2]
    doc = addNode(doc, g, null)
    doc = addNode(doc, c, g.id)
    const before = cubeWorldCorners(doc, cubeOf(doc, c.id))
    const next = rotateNodes(doc, [c.id], Y90, [8, 8, 8])
    expectCornersMapped(before, cubeWorldCorners(next, cubeOf(next, c.id)), rotAbout(Y90, [8, 8, 8]))
  })

  it('rotateNodes：组旋转带动整棵子树；父子同选不重复施加；locator 仅移动位置', () => {
    const { doc, ids } = fixture()
    const beforeCube = cubeWorldCorners(doc, cubeOf(doc, ids.cube2))
    const beforeLoc = worldPivotOf(doc, ids.locator1)
    const next = rotateNodes(doc, [ids.group1, ids.cube2, ids.locator1], Y90, [0, 0, 0], 2000)
    const map = rotAbout(Y90, [0, 0, 0])
    expectVecClose(groupOf(next, ids.group1).origin, map([0, 0, 0]))
    expectVecClose(groupOf(next, ids.group1).rotation, [0, 90, 0])
    expectCornersMapped(beforeCube, cubeWorldCorners(next, cubeOf(next, ids.cube2)), map)
    expectVecClose(worldPivotOf(next, ids.locator1), map(beforeLoc))
    // 未选中子树不受影响
    expectVecClose(cubeOf(next, ids.cube1).from, [0, 0, 0])
  })

  it('rotateNodes：零增量与未知 id 原样返回', () => {
    const { doc, ids } = fixture()
    expect(rotateNodes(doc, [ids.cube1], [0, 0, 0, 1], [0, 0, 0])).toBe(doc)
    expect(rotateNodes(doc, ['nope'], Y90, [0, 0, 0])).toBe(doc)
  })

  it('scaleNodes：多立方体绕共同 pivot 缩放；locator/组子树同步', () => {
    const { doc, ids } = fixture()
    const beforeCube = cubeWorldCorners(doc, cubeOf(doc, ids.cube2))
    const next = scaleNodes(doc, [ids.cube1, ids.group1], [2, 2, 2], [8, 8, 8], 2000)
    const map = scaleAbout([2, 2, 2], [8, 8, 8])
    // cube1 [0..8]³ 绕 (8,8,8) 放大 2 倍 → [-8..8]³
    expectVecClose(cubeOf(next, ids.cube1).from, [-8, -8, -8])
    expectVecClose(cubeOf(next, ids.cube1).to, [8, 8, 8])
    expectCornersMapped(beforeCube, cubeWorldCorners(next, cubeOf(next, ids.cube2)), map)
    expectVecClose(locatorOf(next, ids.locator1).position, [-6, -4, -2])
    expectVecClose(groupOf(next, ids.group1).origin, map([0, 0, 0]))
    // 组的 scale 字段不引入（烘焙进几何）
    expect(groupOf(next, ids.group1).scale).toBeUndefined()
    expect(next.meta.updatedAt).toBe(2000)
  })

  it('scaleNodes：旋转父级下均匀缩放仍精确（相似变换可交换）', () => {
    let doc = createDocument({ name: 't', format: 'free' })
    const g = createGroupNode('g')
    g.rotation = [0, 45, 0]
    g.origin = [8, 8, 8]
    const c = createCubeNode('c', { from: [0, 0, 0], to: [4, 4, 4] })
    c.origin = [2, 2, 2]
    doc = addNode(doc, g, null)
    doc = addNode(doc, c, g.id)
    const before = cubeWorldCorners(doc, cubeOf(doc, c.id))
    const next = scaleNodes(doc, [c.id], [2, 2, 2], [8, 8, 8])
    expectCornersMapped(before, cubeWorldCorners(next, cubeOf(next, c.id)), scaleAbout([2, 2, 2], [8, 8, 8]))
  })

  it('scaleNodes：单位因子与未知 id 原样返回；坍缩因子夹取', () => {
    const { doc, ids } = fixture()
    expect(scaleNodes(doc, [ids.cube1], [1, 1, 1], [0, 0, 0])).toBe(doc)
    expect(scaleNodes(doc, ['nope'], [2, 2, 2], [0, 0, 0])).toBe(doc)
    const next = scaleNodes(doc, [ids.cube1], [0, 1, 1], [0, 0, 0])
    expect(cubeOf(next, ids.cube1).to[0]).toBeCloseTo(0.0008, 8)
  })
})
