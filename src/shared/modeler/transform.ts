/**
 * 变换数学层：Mat4/Vec3 纯函数、节点局部/世界变换、多选平移、包围盒。
 *
 * 坐标与层级约定（通用文档格式，见 docs/adr/0002-model-document.md）：
 * - 16 单位 = 1 方块，Y 轴向上；文档坐标不做 0..16 夹取（越界约束属于格式能力，
 *   导出 java_block 时由适配层降级）；
 * - 「父链连续空间」语义（与 Bedrock 几何一致）：所有位置字段
 *   （cube.from/to/origin、group.origin、locator.position）存放在
 *   「父级旋转前的延续空间」中——组旋转绕自身 pivot 转动整棵子树，
 *   子树的存储坐标保持不变；
 * - 局部矩阵：cube / group = T(origin)·R(rotation)·T(−origin)（group 另含可选
 *   scale，合成 T(origin)·R·S·T(−origin)）；locator = T(position)；
 * - 欧拉合成顺序固定为 R = Rx·Ry·Rz（列向量下 Z 轴旋转最先作用）；单轴时退化为
 *   纯旋转。格式导出适配层若目标欧拉序不同，需在导出时自行换算；
 * - Mat4 为长度 16 的列主序数组（m[col*4+row]，与 WebGL/three 约定兼容）。
 *
 * 多选变换（视口 gizmo 的写入路径）：平移/旋转/缩放均绕「顶层化选中集的共同
 * pivot」（视口取质心）。旋转经四元数合成后重提取欧拉角；精确性见
 * rotateNodes / scaleNodes 注释。
 * 本模块不依赖 DOM/three/Electron，可在 node/vitest 与渲染层同源使用。
 */
import type { ModelDocument, ModelNode, Vec3 } from './types'
import { isCubeNode, isGroupNode, isLocatorNode, isMeshNode } from './types'
import { effectiveSelection, subtreeIds } from './document'
import type { Quat } from './quat'
import {
  ancestorRotationQuat,
  eulerXYZDegFromQuat,
  normalizeQuat,
  quatConj,
  quatFromEulerXYZDeg,
  quatMul
} from './quat'

/** 列主序 4×4 矩阵（m[col*4+row]） */
export type Mat4 = number[]

/** 轴对齐包围盒（世界/文档空间） */
export interface Bounds {
  min: Vec3
  max: Vec3
}

const DEG2RAD = Math.PI / 180

/* ------------------------------------------------------------------ */
/* 向量小工具                                                          */
/* ------------------------------------------------------------------ */

export function addVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function negVec3(a: Vec3): Vec3 {
  return [-a[0], -a[1], -a[2]]
}

/* ------------------------------------------------------------------ */
/* Mat4 基础                                                           */
/* ------------------------------------------------------------------ */

export function mat4Identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** 矩阵乘法 a·b（先作用 b 再作用 a） */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3]
    }
  }
  return out
}

export function mat4Translation(v: Vec3): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1]
}

export function mat4Scale(v: Vec3): Mat4 {
  return [v[0], 0, 0, 0, 0, v[1], 0, 0, 0, 0, v[2], 0, 0, 0, 0, 1]
}

/** 绕 X 轴旋转（度，右手系：+90° 把 +Y 转向 +Z） */
export function mat4RotationX(deg: number): Mat4 {
  const c = Math.cos(deg * DEG2RAD)
  const s = Math.sin(deg * DEG2RAD)
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]
}

/** 绕 Y 轴旋转（度，右手系：+90° 把 +Z 转向 +X） */
export function mat4RotationY(deg: number): Mat4 {
  const c = Math.cos(deg * DEG2RAD)
  const s = Math.sin(deg * DEG2RAD)
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
}

/** 绕 Z 轴旋转（度，右手系：+90° 把 +X 转向 +Y） */
export function mat4RotationZ(deg: number): Mat4 {
  const c = Math.cos(deg * DEG2RAD)
  const s = Math.sin(deg * DEG2RAD)
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** 欧拉角 → 矩阵，合成顺序 R = Rx·Ry·Rz（见模块头注释） */
export function eulerMatrix(rot: Vec3): Mat4 {
  return mat4Multiply(mat4Multiply(mat4RotationX(rot[0]), mat4RotationY(rot[1])), mat4RotationZ(rot[2]))
}

/** 绕指定点旋转（T(pivot)·R·T(−pivot)） */
export function rotationAroundPivot(rot: Vec3, pivot: Vec3): Mat4 {
  return mat4Multiply(
    mat4Multiply(mat4Translation(pivot), eulerMatrix(rot)),
    mat4Translation(negVec3(pivot))
  )
}

/**
 * 通用 4×4 求逆（余子式展开）。奇异矩阵（行列式为 0，如零缩放）抛错。
 */
export function mat4Invert(m: Mat4): Mat4 {
  const a00 = m[0]!
  const a01 = m[1]!
  const a02 = m[2]!
  const a03 = m[3]!
  const a10 = m[4]!
  const a11 = m[5]!
  const a12 = m[6]!
  const a13 = m[7]!
  const a20 = m[8]!
  const a21 = m[9]!
  const a22 = m[10]!
  const a23 = m[11]!
  const a30 = m[12]!
  const a31 = m[13]!
  const a32 = m[14]!
  const a33 = m[15]!

  const b00 = a00 * a11 - a01 * a10
  const b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11
  const b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30
  const b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31
  const b11 = a22 * a33 - a23 * a32

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (!det) throw new Error('矩阵不可逆（行列式为 0）')
  det = 1 / det

  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det,
    (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det,
    (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det,
    (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det,
    (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det,
    (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det,
    (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det,
    (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det,
    (a20 * b03 - a21 * b01 + a22 * b00) * det
  ]
}

/** 变换点（含平移与投影除法——本层矩阵均为仿射，w 恒为 1） */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!
  ]
}

/** 变换方向（仅取左上 3×3，不含平移，不归一化） */
export function transformDirection(m: Mat4, v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2],
    m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2],
    m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2]
  ]
}

/* ------------------------------------------------------------------ */
/* 节点变换                                                            */
/* ------------------------------------------------------------------ */

/** 节点相对父级的局部矩阵（见模块头注释的层级语义） */
export function localMatrixOf(node: ModelNode): Mat4 {
  if (isLocatorNode(node)) return mat4Translation(node.position)
  // cube / group 共用「绕 pivot 旋转」形态
  const base = rotationAroundPivot(node.rotation, node.origin)
  if (isGroupNode(node) && node.scale) {
    const s = node.scale
    if (s[0] !== 1 || s[1] !== 1 || s[2] !== 1) {
      return mat4Multiply(
        mat4Multiply(mat4Translation(node.origin), eulerMatrix(node.rotation)),
        mat4Multiply(mat4Scale(s), mat4Translation(negVec3(node.origin)))
      )
    }
  }
  return base
}

/** 节点的世界（文档根）变换矩阵；节点不存在返回单位阵；断链/环按可到达部分截断 */
export function worldMatrixOf(doc: ModelDocument, id: string): Mat4 {
  const chain: ModelNode[] = []
  let cur: ModelNode | undefined = doc.nodes[id]
  let guard = 0
  while (cur && guard++ < 256) {
    chain.push(cur)
    cur = cur.parent ? doc.nodes[cur.parent] : undefined
  }
  let m = mat4Identity()
  for (let i = chain.length - 1; i >= 0; i--) m = mat4Multiply(m, localMatrixOf(chain[i]!))
  return m
}

/**
 * 节点 pivot 的世界位置：
 * - cube/group = 世界矩阵作用其 origin（旋转中心）；
 * - locator = 父级世界矩阵作用其 position（自身局部矩阵只含平移，不能重复施加）。
 */
export function worldPivotOf(doc: ModelDocument, id: string): Vec3 {
  const node = doc.nodes[id]
  if (!node) return [0, 0, 0]
  if (isLocatorNode(node)) {
    const parentWorld = node.parent ? worldMatrixOf(doc, node.parent) : mat4Identity()
    return transformPoint(parentWorld, node.position)
  }
  return transformPoint(worldMatrixOf(doc, id), node.origin)
}

/** 立方体 8 个角点的世界坐标（含自身旋转与全部祖先变换） */
export function cubeWorldCorners(doc: ModelDocument, cube: ModelNode & { type: 'cube' }): Vec3[] {
  const m = worldMatrixOf(doc, cube.id)
  const corners: Vec3[] = []
  for (const x of [cube.from[0], cube.to[0]]) {
    for (const y of [cube.from[1], cube.to[1]]) {
      for (const z of [cube.from[2], cube.to[2]]) {
        corners.push(transformPoint(m, [x, y, z]))
      }
    }
  }
  return corners
}

/* ------------------------------------------------------------------ */
/* 包围盒                                                              */
/* ------------------------------------------------------------------ */

/** 点集包围盒；空集返回 null */
export function aabbOfPoints(points: readonly Vec3[]): Bounds | null {
  if (points.length === 0) return null
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      if (p[i]! < min[i]!) min[i] = p[i]
      if (p[i]! > max[i]!) max[i] = p[i]
    }
  }
  return { min, max }
}

/** 一组节点（各自连同子树）的世界包围盒；无几何时返回 null。定位器按单点参与。 */
export function worldAabbOfNodes(doc: ModelDocument, ids: readonly string[]): Bounds | null {
  const pts: Vec3[] = []
  for (const id of ids) {
    const node = doc.nodes[id]
    if (!node) continue
    if (isCubeNode(node)) pts.push(...cubeWorldCorners(doc, node))
    else if (isMeshNode(node)) {
      const m = worldMatrixOf(doc, id)
      for (const v of node.vertices) pts.push(transformPoint(m, v))
    } else if (isLocatorNode(node)) pts.push(worldPivotOf(doc, id))
  }
  return aabbOfPoints(pts)
}

/** 单节点（组会聚合整棵子树）的世界包围盒 */
export function worldAabbOfNode(doc: ModelDocument, id: string): Bounds | null {
  return worldAabbOfNodes(doc, subtreeIds(doc, id))
}

/**
 * 整份文档的世界包围盒（立方体与网格参与；定位器/组 pivot 不参与，便于取景）。
 * visibleOnly=true 时仅统计自身与祖先全部可见的几何节点。
 */
export function documentAabb(doc: ModelDocument, opts?: { visibleOnly?: boolean }): Bounds | null {
  const pts: Vec3[] = []
  for (const node of Object.values(doc.nodes)) {
    if (isCubeNode(node)) {
      if (opts?.visibleOnly && !isVisibleIn(doc, node.id)) continue
      pts.push(...cubeWorldCorners(doc, node))
      continue
    }
    if (isMeshNode(node)) {
      if (opts?.visibleOnly && !isVisibleIn(doc, node.id)) continue
      const m = worldMatrixOf(doc, node.id)
      for (const v of node.vertices) pts.push(transformPoint(m, v))
    }
  }
  return aabbOfPoints(pts)
}

/** 可见性继承判断（防循环依赖的内部实现，与 query.isVisible 语义一致） */
function isVisibleIn(doc: ModelDocument, id: string): boolean {
  let cur: ModelNode | undefined = doc.nodes[id]
  if (!cur) return false
  let guard = 0
  while (cur && guard++ < 256) {
    if (!cur.visible) return false
    const parent: ModelNode | undefined = cur.parent ? doc.nodes[cur.parent] : undefined
    if (cur.parent && !parent) break
    cur = parent
  }
  return true
}

/* ------------------------------------------------------------------ */
/* 多选平移                                                            */
/* ------------------------------------------------------------------ */

/**
 * 平移一组选中节点（世界刚体平移，delta 为文档空间向量）：
 * - 选中集先做「顶层化」（祖先被选中时后代不再重复施加）；
 * - 顶层节点及其子树内所有节点的位置字段统一加 delta
 *   （cube: from/to/origin；group: origin；locator: position）——
 *   父链连续空间语义下，子树坐标同步偏移 = 子树整体世界刚体平移；
 * - 不检查 locked（锁定语义是「限制变换操作」，由调用方/UI 决定是否过滤）；
 * - 面 UV、动画通道不受影响；delta 为零向量或无有效节点时原样返回。
 */
export function translateNodes(
  doc: ModelDocument,
  ids: readonly string[],
  delta: Vec3,
  now?: number
): ModelDocument {
  const tops = effectiveSelection(doc, ids)
  if (
    tops.length === 0 ||
    (delta[0] === 0 && delta[1] === 0 && delta[2] === 0)
  ) {
    return doc
  }
  const targets = new Set<string>()
  for (const id of tops) for (const nid of subtreeIds(doc, id)) targets.add(nid)
  const nodes = { ...doc.nodes }
  for (const id of targets) {
    const node = doc.nodes[id]!
    if (isCubeNode(node)) {
      nodes[id] = {
        ...node,
        from: addVec3(node.from, delta),
        to: addVec3(node.to, delta),
        origin: addVec3(node.origin, delta)
      }
    } else if (isGroupNode(node)) {
      nodes[id] = { ...node, origin: addVec3(node.origin, delta) }
    } else if (isMeshNode(node)) {
      nodes[id] = {
        ...node,
        vertices: node.vertices.map((v) => addVec3(v, delta)),
        origin: addVec3(node.origin, delta)
      }
    } else {
      nodes[id] = { ...node, position: addVec3(node.position, delta) }
    }
  }
  return { ...doc, nodes, meta: { ...doc.meta, updatedAt: now ?? Date.now() } }
}

/* ------------------------------------------------------------------ */
/* 多选旋转 / 缩放（绕共同 pivot）                                       */
/* ------------------------------------------------------------------ */

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4
const normDeg = (v: number): number => ((((v + 180) % 360) + 360) % 360) - 180

function subVec3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function roundVec3(v: Vec3): Vec3 {
  return [r4(v[0]), r4(v[1]), r4(v[2])]
}

/** 四元数旋转向量：v' = q ⊗ (v,0) ⊗ conj(q)（展开式，输入需归一化） */
export function quatRotatePoint(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q
  // t = 2·cross(q.xyz, v)
  const tx = 2 * (qy * v[2] - qz * v[1])
  const ty = 2 * (qz * v[0] - qx * v[2])
  const tz = 2 * (qx * v[1] - qy * v[0])
  return [
    v[0] + qw * tx + qy * tz - qz * ty,
    v[1] + qw * ty + qz * tx - qx * tz,
    v[2] + qw * tz + qx * ty - qy * tx
  ]
}

/** 祖先链（根 → 直接父级）各组节点的旋转列表（世界旋转折叠用；组 scale 不参与） */
export function ancestorRotationChain(doc: ModelDocument, id: string): Vec3[] {
  const chain: Vec3[] = []
  let cur = doc.nodes[id]?.parent ?? null
  let guard = 0
  while (cur && guard++ < 256) {
    const n = doc.nodes[cur]
    if (!n) break
    if (isGroupNode(n)) chain.push(n.rotation)
    cur = n.parent
  }
  return chain.reverse()
}

/**
 * 旋转一组选中节点：世界系增量 deltaWorld 绕世界 pivot 刚性旋转每个顶层子树。
 *
 * 分解推导（对每个顶层节点，记父级世界矩阵 W、节点空间 = W 的源空间）：
 * - 目标：新局部 L′ 使 W·L′(x′) = M·W·L(x) 对全部几何成立（M = 绕 pivot 的世界旋转）；
 * - 原点刚性旋转：o′ = W⁻¹·M·W·o；旋转合成：R′ = R_c ⊗ R_l，
 *   其中 R_c = conj(Qp) ⊗ Qd ⊗ Qp（Qp = 父链世界旋转，骨骼空间同法）；
 * - 几何平移量恰为 Δ = o′ − o：L′(x) = R′(x + Δ − o′) + o′ = R_c·R_l(x − o) + o′
 *   与 C·L 逐项相等（C = W⁻¹·M·W）——无螺旋残余，几何只需随原点同步平移；
 * - cube：from/to += Δ、origin = o′、rotation = R′；
 *   group：origin = o′、rotation = R′、子树全部位置字段 += Δ（translateNodes 同语义）；
 *   locator：position 直接刚性旋转（无朝向字段）。
 *
 * 精确性：父链含非均匀 scale 时 Qp 折叠（仅旋转）与点映射（含 scale）存在偏差，
 * 其余情形（含父链旋转/均匀 scale）均精确。旋转角归一化到 (−180,180] 并保留 4 位小数。
 */
export function rotateNodes(
  doc: ModelDocument,
  ids: readonly string[],
  deltaWorld: Quat,
  pivotWorld: Vec3,
  now?: number
): ModelDocument {
  const tops = effectiveSelection(doc, ids)
  const qd = normalizeQuat(deltaWorld)
  if (tops.length === 0 || Math.abs(qd[3]) > 1 - 1e-9) return doc

  const nodes = { ...doc.nodes }
  for (const id of tops) {
    const node = doc.nodes[id]!
    const parentWorld = node.parent ? worldMatrixOf(doc, node.parent) : mat4Identity()
    const inv = mat4Invert(parentWorld)
    // 世界点 p 的刚性旋转：pivot + Qd·(p − pivot)，再映回节点空间
    const rotateWorldPoint = (p: Vec3): Vec3 =>
      roundVec3(transformPoint(inv, addVec3(pivotWorld, quatRotatePoint(qd, subVec3(p, pivotWorld)))))

    if (isLocatorNode(node)) {
      const world = transformPoint(parentWorld, node.position)
      nodes[id] = { ...node, position: rotateWorldPoint(world) }
      continue
    }

    const qp = ancestorRotationQuat(ancestorRotationChain(doc, id))
    const rc = normalizeQuat(quatMul(quatMul(quatConj(qp), qd), qp))
    const newRot = eulerXYZDegFromQuat(
      normalizeQuat(quatMul(rc, quatFromEulerXYZDeg(node.rotation)))
    ).map((v) => normDeg(r4(v))) as Vec3
    const newOrigin = rotateWorldPoint(transformPoint(parentWorld, node.origin))
    const shift = subVec3(newOrigin, node.origin)

    if (isCubeNode(node)) {
      nodes[id] = {
        ...node,
        origin: newOrigin,
        rotation: newRot,
        from: roundVec3(addVec3(node.from, shift)),
        to: roundVec3(addVec3(node.to, shift))
      }
      continue
    }
    if (isMeshNode(node)) {
      nodes[id] = {
        ...node,
        origin: newOrigin,
        rotation: newRot,
        vertices: node.vertices.map((v) => roundVec3(addVec3(v, shift)))
      }
      continue
    }
    // group：原点与旋转更新后，子树位置字段同步偏移 shift（世界刚体旋转）
    nodes[id] = { ...node, origin: newOrigin, rotation: newRot }
    for (const nid of subtreeIds(doc, id)) {
      if (nid === id) continue
      const dn = doc.nodes[nid]!
      if (isCubeNode(dn)) {
        nodes[nid] = {
          ...dn,
          from: roundVec3(addVec3(dn.from, shift)),
          to: roundVec3(addVec3(dn.to, shift)),
          origin: roundVec3(addVec3(dn.origin, shift))
        }
      } else if (isGroupNode(dn)) {
        nodes[nid] = { ...dn, origin: roundVec3(addVec3(dn.origin, shift)) }
      } else if (isMeshNode(dn)) {
        nodes[nid] = {
          ...dn,
          vertices: dn.vertices.map((v) => roundVec3(addVec3(v, shift))),
          origin: roundVec3(addVec3(dn.origin, shift))
        }
      } else {
        nodes[nid] = { ...dn, position: roundVec3(addVec3(dn.position, shift)) }
      }
    }
  }
  return { ...doc, nodes, meta: { ...doc.meta, updatedAt: now ?? Date.now() } }
}

/**
 * 缩放一组选中节点：世界 pivot、世界轴向因子 scale，逐顶层子树施加。
 * - cube：from/to/origin 逐轴绕 pivot 缩放（box 保持轴对齐，可由 rotation 再旋转）；
 * - group：origin 缩放 + 子树全部位置字段同步缩放，group.scale 字段不动（烘焙进几何）；
 * - locator：position 缩放。
 *
 * 精确性：均匀缩放（kx=ky=kz）任意姿态精确；非均匀缩放仅在节点与祖先均无旋转时
 * 精确（旋转坐标系下世界轴向缩放不可由轴对齐 box 表达，属格式表达力边界，与单选
 * 缩放同策略）。因子绝对值 < 1e-4 夹取防坍缩。
 */
export function scaleNodes(
  doc: ModelDocument,
  ids: readonly string[],
  scale: Vec3,
  pivotWorld: Vec3,
  now?: number
): ModelDocument {
  const tops = effectiveSelection(doc, ids)
  const s: Vec3 = [
    Math.abs(scale[0]) < 1e-4 ? 1e-4 : scale[0],
    Math.abs(scale[1]) < 1e-4 ? 1e-4 : scale[1],
    Math.abs(scale[2]) < 1e-4 ? 1e-4 : scale[2]
  ]
  if (tops.length === 0 || (s[0] === 1 && s[1] === 1 && s[2] === 1)) return doc

  const nodes = { ...doc.nodes }
  for (const id of tops) {
    const node = doc.nodes[id]!
    const parentWorld = node.parent ? worldMatrixOf(doc, node.parent) : mat4Identity()
    const pc = transformPoint(mat4Invert(parentWorld), pivotWorld)
    const sp = (p: Vec3): Vec3 => [
      r4(pc[0] + s[0] * (p[0] - pc[0])),
      r4(pc[1] + s[1] * (p[1] - pc[1])),
      r4(pc[2] + s[2] * (p[2] - pc[2]))
    ]

    if (isLocatorNode(node)) {
      nodes[id] = { ...node, position: sp(node.position) }
      continue
    }
    if (isCubeNode(node)) {
      nodes[id] = { ...node, from: sp(node.from), to: sp(node.to), origin: sp(node.origin) }
      continue
    }
    if (isMeshNode(node)) {
      nodes[id] = {
        ...node,
        vertices: node.vertices.map((v) => sp(v)),
        origin: sp(node.origin)
      }
      continue
    }
    nodes[id] = { ...node, origin: sp(node.origin) }
    for (const nid of subtreeIds(doc, id)) {
      if (nid === id) continue
      const dn = doc.nodes[nid]!
      if (isCubeNode(dn)) {
        nodes[nid] = { ...dn, from: sp(dn.from), to: sp(dn.to), origin: sp(dn.origin) }
      } else if (isGroupNode(dn)) {
        nodes[nid] = { ...dn, origin: sp(dn.origin) }
      } else if (isMeshNode(dn)) {
        nodes[nid] = {
          ...dn,
          vertices: dn.vertices.map((v) => sp(v)),
          origin: sp(dn.origin)
        }
      } else {
        nodes[nid] = { ...dn, position: sp(dn.position) }
      }
    }
  }
  return { ...doc, nodes, meta: { ...doc.meta, updatedAt: now ?? Date.now() } }
}
