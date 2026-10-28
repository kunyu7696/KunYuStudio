/**
 * 网格（mesh）纯函数助手（B4-1，v2）。
 *
 * 只承载「几何事实计算」：默认形构造、面三角化、面法线、世界顶点。
 * 文档结构操作（增删节点/校验）在 document.ts，变换写在 transform.ts。
 * 本模块不依赖 DOM/three/Electron。
 */
import type { MeshFace, MeshNode, ModelDocument, Vec2, Vec3 } from './types'
import { transformPoint, worldMatrixOf } from './transform'

/**
 * 默认网格形：四棱锥（底面 8×8 居中于原点上方，高 8）。
 * 5 顶点 6 面（1 四边底面 + 4 三角侧面），UV 占满 0..16 方便直接绑贴图。
 */
export function defaultMeshGeometry(): { vertices: Vec3[]; faces: MeshFace[] } {
  const vertices: Vec3[] = [
    [-4, 0, -4],
    [4, 0, -4],
    [4, 0, 4],
    [-4, 0, 4],
    [0, 8, 0]
  ]
  const faces: MeshFace[] = [
    // 底面（法线朝下，从下方看逆时针）
    { vertices: [0, 2, 1], uv: [[0, 16], [16, 0], [16, 16]] },
    { vertices: [0, 3, 2], uv: [[0, 16], [0, 0], [16, 0]] },
    // 四个侧面（法线朝外）
    { vertices: [0, 1, 4], uv: [[0, 16], [16, 16], [8, 0]] },
    { vertices: [1, 2, 4], uv: [[0, 16], [16, 16], [8, 0]] },
    { vertices: [2, 3, 4], uv: [[0, 16], [16, 16], [8, 0]] },
    { vertices: [3, 0, 4], uv: [[0, 16], [16, 16], [8, 0]] }
  ]
  return { vertices, faces }
}

/**
 * 面三角化：返回三角形顶点索引三元组列表（索引指向 face.vertices 的槽位）。
 * 三角面恒为 [[0,1,2]]；四边面扇形拆分 [[0,1,2],[0,2,3]]。
 * 非法长度（<3）返回空数组（渲染层跳过，文档校验另行报告）。
 */
export function triangulateFace(face: MeshFace): Array<[number, number, number]> {
  const n = face.vertices.length
  if (n === 3) return [[0, 1, 2]]
  if (n === 4) return [
    [0, 1, 2],
    [0, 2, 3]
  ]
  return []
}

/**
 * 面法线（Newell 法，三/四边通用，退化面返回零向量）。
 * 输入为面顶点实际坐标（父空间或世界空间均可，方向一致）。
 */
export function faceNormal(points: readonly Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0]
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    n[0] += (a[1] - b[1]) * (a[2] + b[2])
    n[1] += (a[2] - b[2]) * (a[0] + b[0])
    n[2] += (a[0] - b[0]) * (a[1] + b[1])
  }
  const len = Math.hypot(n[0], n[1], n[2])
  if (len < 1e-12) return [0, 0, 0]
  return [n[0] / len, n[1] / len, n[2] / len]
}

/** 面顶点实际坐标（按 face.vertices 索引收集；越界下标静默跳过——校验层另行报告） */
export function facePoints(node: MeshNode, face: MeshFace): Vec3[] {
  const pts: Vec3[] = []
  for (const idx of face.vertices) {
    const v = node.vertices[idx]
    if (v) pts.push(v)
  }
  return pts
}

/** 网格节点全部顶点的世界坐标（含自身旋转与全部祖先变换） */
export function meshWorldVertices(doc: ModelDocument, node: MeshNode): Vec3[] {
  const m = worldMatrixOf(doc, node.id)
  return node.vertices.map((v) => transformPoint(m, v))
}

/** 网格面 UV 归一化辅助：像素坐标 → 0..1（渲染层 v 翻转自行处理） */
export function uvToUnit(uv: Vec2, width: number, height: number): Vec2 {
  return [uv[0] / width, uv[1] / height]
}

/**
 * 平移网格顶点（B4-3）：返回新顶点数组（未选中项保持原引用）。
 * 越界下标由调用方先行过滤；此处按集合命中平移。
 */
export function translateMeshVertices(node: MeshNode, indices: Iterable<number>, delta: Vec3): Vec3[] {
  const sel = new Set(indices)
  return node.vertices.map((v, i) =>
    sel.has(i) ? ([v[0] + delta[0], v[1] + delta[1], v[2] + delta[2]] as Vec3) : v
  )
}

/**
 * 删除网格面（B4-3）：返回新面数组（面内数组保持原引用，命令差分最小化）。
 * 顶点不压缩——共享顶点可能被保留面引用，压缩会使其余面下标整体漂移。
 */
export function removeMeshFaces(node: MeshNode, indices: Iterable<number>): MeshFace[] {
  const drop = new Set(indices)
  return node.faces.filter((_, i) => !drop.has(i))
}

/* ------------------------------------------------------------------ */
/* 边与环切（v3 C1）                                                     */
/* ------------------------------------------------------------------ */

/**
 * 网格边（无向）：顶点下标对。边没有稳定的数组下标（面增删后下标漂移），
 * 故边选择与查找一律以 meshEdgeKey 为目标，不用下标。
 */
export interface MeshEdge {
  a: number
  b: number
}

/** 无向边键：小下标在前（唯一标识一条边，作边选择/去重的稳定 key） */
export function meshEdgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`
}

/** 边键反解析；非法格式返回 null */
export function parseMeshEdgeKey(key: string): MeshEdge | null {
  const m = /^(\d+)_(\d+)$/.exec(key)
  if (!m) return null
  return { a: Number(m[1]), b: Number(m[2]) }
}

/** 全网格唯一边列表（按面遍历首次出现顺序；退化边与越界下标跳过） */
export function buildMeshEdges(node: MeshNode): MeshEdge[] {
  const seen = new Set<string>()
  const out: MeshEdge[] = []
  for (const face of node.faces) {
    const v = face.vertices
    for (let i = 0; i < v.length; i++) {
      const a = v[i]!
      const b = v[(i + 1) % v.length]!
      if (a === b || !node.vertices[a] || !node.vertices[b]) continue
      const key = meshEdgeKey(a, b)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ a, b })
    }
  }
  return out
}

/** 边 → 相邻面下标列表（环切穿面用；三角/四边均登记） */
function edgeFaceMap(node: MeshNode): Map<string, number[]> {
  const map = new Map<string, number[]>()
  node.faces.forEach((face, fi) => {
    const v = face.vertices
    for (let i = 0; i < v.length; i++) {
      const key = meshEdgeKey(v[i]!, v[(i + 1) % v.length]!)
      const arr = map.get(key)
      if (arr) arr.push(fi)
      else map.set(key, [fi])
    }
  })
  return map
}

/**
 * 四边面内某边的对边键：quad 边序 e0↔e2、e1↔e3（两边无公共顶点）。
 * 非四边面或边不在面内返回 null（环切在三角面处终止）。
 */
function oppositeEdgeKeyInQuad(face: MeshFace, key: string): string | null {
  const v = face.vertices
  if (v.length !== 4) return null
  const keys = [
    meshEdgeKey(v[0]!, v[1]!),
    meshEdgeKey(v[1]!, v[2]!),
    meshEdgeKey(v[2]!, v[3]!),
    meshEdgeKey(v[3]!, v[0]!)
  ]
  const i = keys.indexOf(key)
  if (i < 0) return null
  return keys[(i + 2) % 4]!
}

export interface EdgeRing {
  /** 有序环边（种子两侧各走一趟后合并） */
  edges: MeshEdge[]
  /** 是否闭合环（回到种子边） */
  closed: boolean
}

/**
 * 边环（edge ring）查找（v3 C1，对齐公开的「面内对边穿越」定义）：
 * 从种子边出发，沿相邻四边面内的对边连续穿越，收集相互平行的一圈边。
 * 三角面无对边、边界边无对侧面 → 环在该处终止（closed=false）。
 */
export function findEdgeRing(node: MeshNode, seed: MeshEdge): EdgeRing {
  const seedKey = meshEdgeKey(seed.a, seed.b)
  const edgeFaces = edgeFaceMap(node)
  const visited = new Set<string>([seedKey])
  let closed = false

  const walk = (startFace: number | undefined): MeshEdge[] => {
    const list: MeshEdge[] = []
    let curFace = startFace
    let curKey = seedKey
    let guard = 0
    while (curFace !== undefined && guard++ <= node.faces.length) {
      const face = node.faces[curFace]
      if (!face) break
      const oppKey = oppositeEdgeKeyInQuad(face, curKey)
      if (!oppKey) break // 非四边面 / 边不在面内 → 环终止
      if (oppKey === seedKey) {
        closed = true // 闭合环
        break
      }
      if (visited.has(oppKey)) break
      visited.add(oppKey)
      list.push(parseMeshEdgeKey(oppKey)!)
      curFace = (edgeFaces.get(oppKey) ?? []).find((fi) => fi !== curFace)
      curKey = oppKey
    }
    return list
  }

  const seedFaces = edgeFaces.get(seedKey) ?? []
  const backward = walk(seedFaces[0])
  const forward = walk(seedFaces[1])
  return { edges: [...backward.reverse(), seed, ...forward], closed }
}

export interface LoopCutResult {
  vertices: Vec3[]
  faces: MeshFace[]
  /** 新增顶点在结果 vertices 中的下标（供选择/高亮） */
  newVertexIndices: number[]
}

/**
 * 环切（v3 C1）：在环上每条「被切」边按比例 t 插入新顶点，并把含两条对边环边的
 * 四边面沿两新顶点连成的中线一分为二（UV 按边两端线性插值，贴图绑定继承）。
 * 三角面/仅含单条环边的面保持原引用；未触及的面与顶点保持原引用（命令差分最小）。
 * 未被任何切分面引用的环边不产生新顶点（避免悬空顶点）；无四边面可切时原样返回。
 */
export function loopCutMesh(node: MeshNode, ring: readonly MeshEdge[], t = 0.5): LoopCutResult {
  const ringKeys = new Set(ring.map((e) => meshEdgeKey(e.a, e.b)))

  // 1) 找出可切分的四边面：面内恰有两条互相对边的环边（i 规范化为较小者）
  interface SplitPlan {
    face: number
    i: number
  }
  const plans: SplitPlan[] = []
  node.faces.forEach((face, fi) => {
    const v = face.vertices
    if (v.length !== 4 || face.uv.length !== 4) return
    const keys = [
      meshEdgeKey(v[0]!, v[1]!),
      meshEdgeKey(v[1]!, v[2]!),
      meshEdgeKey(v[2]!, v[3]!),
      meshEdgeKey(v[3]!, v[0]!)
    ]
    for (let i = 0; i < 4; i++) {
      if (ringKeys.has(keys[i]!) && ringKeys.has(keys[(i + 2) % 4]!)) {
        plans.push({ face: fi, i: Math.min(i, (i + 2) % 4) })
        break
      }
    }
  })
  if (plans.length === 0) {
    return { vertices: node.vertices, faces: node.faces, newVertexIndices: [] }
  }

  // 2) 为被切分的环边建新顶点（键 → 新下标；共享边两邻面共用同一新顶点）
  const usedKeys = new Set<string>()
  for (const plan of plans) {
    const v = node.faces[plan.face]!.vertices
    usedKeys.add(meshEdgeKey(v[plan.i]!, v[(plan.i + 1) % 4]!))
    usedKeys.add(meshEdgeKey(v[(plan.i + 2) % 4]!, v[(plan.i + 3) % 4]!))
  }
  const vertices = node.vertices.slice()
  const indexByKey = new Map<string, number>()
  const newVertexIndices: number[] = []
  for (const key of usedKeys) {
    const pair = parseMeshEdgeKey(key)
    const va = pair ? node.vertices[pair.a] : undefined
    const vb = pair ? node.vertices[pair.b] : undefined
    if (!va || !vb) continue
    vertices.push([
      va[0] + (vb[0] - va[0]) * t,
      va[1] + (vb[1] - va[1]) * t,
      va[2] + (vb[2] - va[2]) * t
    ])
    indexByKey.set(key, vertices.length - 1)
    newVertexIndices.push(vertices.length - 1)
  }

  // 3) 生成面：非切分面保持原引用；切分面 → 两个新四边面（UV 按边两端插值）
  const planByFace = new Map<number, number>()
  for (const plan of plans) planByFace.set(plan.face, plan.i)
  const faces: MeshFace[] = []
  node.faces.forEach((face, fi) => {
    const i = planByFace.get(fi)
    if (i === undefined) {
      faces.push(face)
      return
    }
    const v = face.vertices
    const uv = face.uv
    const mA = indexByKey.get(meshEdgeKey(v[i]!, v[(i + 1) % 4]!))
    const mB = indexByKey.get(meshEdgeKey(v[(i + 2) % 4]!, v[(i + 3) % 4]!))
    if (mA === undefined || mB === undefined) {
      faces.push(face) // 兜底：新顶点缺失时保持原面
      return
    }
    const uvA: Vec2 = [uv[i]![0] / 2 + uv[(i + 1) % 4]![0] / 2, uv[i]![1] / 2 + uv[(i + 1) % 4]![1] / 2]
    const uvB: Vec2 = [
      uv[(i + 2) % 4]![0] / 2 + uv[(i + 3) % 4]![0] / 2,
      uv[(i + 2) % 4]![1] / 2 + uv[(i + 3) % 4]![1] / 2
    ]
    const texture = face.texture !== undefined ? { texture: face.texture } : {}
    faces.push({
      vertices: [v[i]!, mA, mB, v[(i + 3) % 4]!],
      uv: [uv[i]!, uvA, uvB, uv[(i + 3) % 4]!],
      ...texture
    })
    faces.push({
      vertices: [mA, v[(i + 1) % 4]!, v[(i + 2) % 4]!, mB],
      uv: [uvA, uv[(i + 1) % 4]!, uv[(i + 2) % 4]!, uvB],
      ...texture
    })
  })

  return { vertices, faces, newVertexIndices }
}

/* ------------------------------------------------------------------ */
/* 切刀：平面跨面切割（v3 C2）                                            */
/* ------------------------------------------------------------------ */

/**
 * 由两次点击求切割平面法线（v3 C2 切刀）：平面**过 a、b 两点**且**垂直于首击面**
 * ——法线取 (b−a) × n_seed，既与 (b−a) 正交（平面含线段 ab），又与首击面法线
 * 正交（平面垂直于首击面），即「刀身贴着首击面、沿两击点方向剖开」的自然切面。
 * 两点连线与首击面法线平行（|sin| < 1e-3）、首击面退化或下标越界 → 平面不确定，返回 null。
 */
export function knifeCutPlane(node: MeshNode, seedFace: number, a: Vec3, b: Vec3): Vec3 | null {
  const face = node.faces[seedFace]
  if (!face) return null
  const nSeed = faceNormal(facePoints(node, face))
  const nLen = Math.hypot(nSeed[0], nSeed[1], nSeed[2])
  if (nLen < 1e-9) return null
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const dLen = Math.hypot(d[0], d[1], d[2])
  if (dLen < 1e-9) return null
  const u: Vec3 = [d[0] / dLen, d[1] / dLen, d[2] / dLen]
  const s: Vec3 = [nSeed[0] / nLen, nSeed[1] / nLen, nSeed[2] / nLen]
  const n: Vec3 = [
    u[1] * s[2] - u[2] * s[1],
    u[2] * s[0] - u[0] * s[2],
    u[0] * s[1] - u[1] * s[0]
  ]
  const len = Math.hypot(n[0], n[1], n[2])
  if (len < 1e-3) return null
  return [n[0] / len, n[1] / len, n[2] / len]
}

export interface PlaneCutResult {
  vertices: Vec3[]
  faces: MeshFace[]
  /** 新增顶点在结果 vertices 中的下标 */
  newVertexIndices: number[]
}

/**
 * 平面切割（v3 C2 切刀核心）：把**跨平面**的面沿平面一分为二，在跨面的边上插入
 * 新顶点——新顶点按「边键」在相邻面间共享（一侧半边不会裂开）；UV 按**该面自身**
 * 的边两端线性插值，硬缝两侧各保留各自的 UV（与环切一致）。平面恰好穿过顶点时
 * 复用该顶点不新建；每个面被切出的两个多边形分别成面（3/4 顶点直接成面，超 4
 * 顶点如「四边面被切在相邻两边」得五边形 → 扇形三角化）。不跨平面的面与未触及
 * 顶点保持原引用；平面未穿过任何面（无新顶点）时原样返回原引用。全部按**父空间**
 * 计算（与 node.vertices 同空间）。
 */
export function sliceMeshByPlane(node: MeshNode, p0: Vec3, normal: Vec3): PlaneCutResult {
  const nLen = Math.hypot(normal[0], normal[1], normal[2])
  if (nLen < 1e-12) return { vertices: node.vertices, faces: node.faces, newVertexIndices: [] }
  const n: Vec3 = [normal[0] / nLen, normal[1] / nLen, normal[2] / nLen]
  // 有符号距离；>=0 视为正侧（恰好落在平面上归正侧，避免零厚度碎面）
  const d = node.vertices.map(
    (v) => (v[0] - p0[0]) * n[0] + (v[1] - p0[1]) * n[1] + (v[2] - p0[2]) * n[2]
  )
  const EPS = 1e-6

  const vertices = node.vertices.slice()
  const newVertexIndices: number[] = []
  const sharedByKey = new Map<string, number>()

  /** 边 (a,b) 与平面的交点顶点下标：t 落在端点上直接复用端点，否则按边键共享新顶点 */
  const crossingVertex = (a: number, b: number): number => {
    const da = d[a] ?? 0
    const db = d[b] ?? 0
    const t = Math.abs(da - db) < 1e-12 ? 0.5 : da / (da - db)
    if (t <= EPS) return a
    if (t >= 1 - EPS) return b
    const key = meshEdgeKey(a, b)
    const hit = sharedByKey.get(key)
    if (hit !== undefined) return hit
    const va = node.vertices[a]!
    const vb = node.vertices[b]!
    vertices.push([
      va[0] + (vb[0] - va[0]) * t,
      va[1] + (vb[1] - va[1]) * t,
      va[2] + (vb[2] - va[2]) * t
    ])
    const idx = vertices.length - 1
    sharedByKey.set(key, idx)
    newVertexIndices.push(idx)
    return idx
  }

  const faces: MeshFace[] = []
  node.faces.forEach((face) => {
    const v = face.vertices
    const uv = face.uv
    const hasPos = v.some((vi) => (d[vi] ?? 0) >= 0)
    const hasNeg = v.some((vi) => (d[vi] ?? 0) < 0)
    if (!hasPos || !hasNeg) {
      faces.push(face) // 完全在一侧（含整面落在平面上）→ 保持原引用
      return
    }
    interface Slot {
      vi: number
      uv: Vec2
    }
    const pos: Slot[] = []
    const neg: Slot[] = []
    // 相邻同顶点去重（交点恰好落在顶点上时会出现重复）
    const push = (arr: Slot[], slot: Slot): void => {
      const last = arr[arr.length - 1]
      if (last && last.vi === slot.vi) return
      arr.push(slot)
    }
    for (let i = 0; i < v.length; i++) {
      const j = (i + 1) % v.length
      const vi = v[i]!
      const vj = v[j]!
      const di = d[vi] ?? 0
      const dj = d[vj] ?? 0
      push(di >= 0 ? pos : neg, { vi, uv: uv[i] ?? [0, 0] })
      if (di >= 0 !== dj >= 0) {
        const t = Math.abs(di - dj) < 1e-12 ? 0.5 : di / (di - dj)
        const uvi = uv[i] ?? [0, 0]
        const uvj = uv[j] ?? [0, 0]
        // 交点同时属于两侧多边形（否则一侧会缺边界而闭合错误）
        const cross: Slot = {
          vi: crossingVertex(vi, vj),
          uv: [uvi[0] + (uvj[0] - uvi[0]) * t, uvi[1] + (uvj[1] - uvi[1]) * t]
        }
        push(pos, cross)
        push(neg, cross)
      }
    }
    const texture = face.texture !== undefined ? { texture: face.texture } : {}
    for (const poly of [pos, neg]) {
      // 首尾同顶点（切点落在首个顶点上）→ 去尾，避免退化边
      while (poly.length > 1 && poly[0]!.vi === poly[poly.length - 1]!.vi) poly.pop()
      if (poly.length < 3) continue
      if (poly.length <= 4) {
        faces.push({
          vertices: poly.map((s) => s.vi),
          uv: poly.map((s) => s.uv),
          ...texture
        })
      } else {
        // 超四边 → 以首顶点扇形三角化（保持平面内分割，UV 随槽位）
        for (let k = 1; k + 1 < poly.length; k++) {
          faces.push({
            vertices: [poly[0]!.vi, poly[k]!.vi, poly[k + 1]!.vi],
            uv: [poly[0]!.uv, poly[k]!.uv, poly[k + 1]!.uv],
            ...texture
          })
        }
      }
    }
  })

  if (newVertexIndices.length === 0) {
    return { vertices: node.vertices, faces: node.faces, newVertexIndices: [] }
  }
  return { vertices, faces, newVertexIndices }
}

/* ------------------------------------------------------------------ */
/* 顶点合并 / mesh 分裂（v3 C6）                                           */
/* ------------------------------------------------------------------ */

/**
 * 合并相同坐标顶点（v3 C6a）：把 mesh 顶点池里坐标相同（≤threshold 距离）的
 * 顶点合并为一个，并重新索引所有 face.vertices。UV 按"首次出现"策略——
 * 保留第一次引用该顶点的 face 的 UV 槽位，其余槽位复用。threshold 缺省 1e-6（MC
 * 资源包里 16 单位 = 1 方块、sub-1e-6 远小于像素精度）。**没有可合并对时原样返回
 * 原引用数组**，零开销（与 translateMeshVertices 语义一致）。
 *
 * 返回：{ vertices, faces, mergedCount, remap }
 *   - remap[i] = 合并后顶点下标（未被合并时 remap[i] = i）
 *   - 未被任何 face 引用的孤立顶点一并剔除（避免顶点池膨胀）
 */
export function mergeMeshVertices(
  node: MeshNode,
  threshold = 1e-6
): { vertices: Vec3[]; faces: MeshFace[]; mergedCount: number; remap: number[] } {
  const verts = node.vertices
  const n = verts.length
  if (n === 0) return { vertices: verts, faces: node.faces, mergedCount: 0, remap: verts.map((_, i) => i) }

  /* 1) 收集每个顶点在 faces 中的首次引用 UV（用于"首次出现"UV 策略） */
  const firstUvOfVertex = new Map<number, Vec2>()
  for (const face of node.faces) {
    for (let i = 0; i < face.vertices.length; i++) {
      const vi = face.vertices[i]!
      if (!firstUvOfVertex.has(vi)) firstUvOfVertex.set(vi, face.uv[i] ?? [0, 0])
    }
  }

  /* 2) 并查集合并 */
  const parent = verts.map((_, i) => i)
  const find = (x: number): number => {
    let p = parent[x]!
    while (p !== x) {
      parent[x] = parent[p]
      x = p
      p = parent[x]!
    }
    return p
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  let anyMerged = false
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = verts[i]!
      const b = verts[j]!
      const dx = a[0] - b[0]
      const dy = a[1] - b[1]
      const dz = a[2] - b[2]
      if (dx * dx + dy * dy + dz * dz <= threshold * threshold) {
        union(i, j)
        anyMerged = true
      }
    }
  }

  /* 无合并对 + 无孤立顶点需要剔除：原样返回原引用（零开销） */
  if (!anyMerged) {
    const usedIds = new Set<number>()
    for (const f of node.faces) for (const v of f.vertices) usedIds.add(v)
    if (usedIds.size === n) {
      return {
        vertices: verts,
        faces: node.faces,
        mergedCount: 0,
        remap: verts.map((_, i) => i)
      }
    }
    /* 无合并但有孤立顶点：仍走压缩路径剔除孤立（mergedCount=0，只做去除） */
  }

  /* 3) 压缩：每个 root 保留第一个出现的顶点（稳定排序），remap 映射 */
  const rootOrder = new Map<number, number>()
  const vertices: Vec3[] = []
  const remap: number[] = []
  let mergedCount = 0
  for (let i = 0; i < n; i++) {
    const r = find(i)
    let newIdx = rootOrder.get(r)
    if (newIdx === undefined) {
      newIdx = vertices.length
      rootOrder.set(r, newIdx)
      vertices.push(verts[i]!)
    } else {
      mergedCount++
    }
    remap.push(newIdx)
  }

  /* 4) 重索引 faces；被合并顶点的 UV 槽位"首次出现"继承 */
  const faces: MeshFace[] = node.faces.map((face) => {
    const newV = face.vertices.map((vi) => remap[vi] ?? vi)
    const newUv: Vec2[] = []
    for (let i = 0; i < newV.length; i++) {
      const origVi = face.vertices[i]!
      if (origVi === newV[i]) {
        /* 未被合并：原 UV 保留 */
        newUv.push(face.uv[i] ?? [0, 0])
      } else {
        /* 被合并：优先用本面原 UV，否则用首次引用的 UV（兜底） */
        newUv.push(face.uv[i] ?? firstUvOfVertex.get(origVi) ?? [0, 0])
      }
    }
    return {
      vertices: newV,
      uv: newUv,
      ...(face.texture !== undefined ? { texture: face.texture } : {})
    }
  })

  /* 5) 剔除未被任何 face 引用的孤立顶点 */
  const usedVertIds = new Set<number>()
  for (const f of faces) for (const v of f.vertices) usedVertIds.add(v)
  if (usedVertIds.size < vertices.length) {
    const denseRemap: number[] = []
    const dense: Vec3[] = []
    const newIdxByOld = new Map<number, number>()
    for (let i = 0; i < vertices.length; i++) {
      if (usedVertIds.has(i)) {
        newIdxByOld.set(i, dense.length)
        dense.push(vertices[i]!)
      }
      denseRemap.push(newIdxByOld.get(i) ?? -1)
    }
    const compactedFaces = faces.map((f) => ({
      vertices: f.vertices.map((vi) => denseRemap[vi] ?? vi),
      uv: f.uv,
      ...(f.texture !== undefined ? { texture: f.texture } : {})
    }))
    /* 外层 remap 也要更新为新下标 */
    for (let i = 0; i < remap.length; i++) {
      remap[i] = denseRemap[remap[i]] ?? remap[i]
    }
    return { vertices: dense, faces: compactedFaces, mergedCount, remap }
  }

  return { vertices, faces, mergedCount, remap }
}

export interface SplitMeshResult {
  /** 分裂后的 mesh（两个 MeshNode 各自拥有独立顶点池） */
  meshes: { vertices: Vec3[]; faces: MeshFace[] }[]
  /** 留在原 mesh 的顶点下标（输入）*/
  keptVertexSet: Set<number>
}

/**
 * 按顶点集合分裂 mesh（v3 C6b）：把顶点分成"保留集合"与"另一侧"，
 * 两者的顶点各自构成独立 mesh。**只有每个面的全部顶点在同一边时该面才归属该 mesh**
 * （若一个面横跨两侧，那是用户选择问题，本函数不做面级拆分，直接丢弃该面并 info 降级）。
 * 返回两个 mesh（两侧各一个，若某侧无面则该 mesh 不存在）。
 *
 * 分裂后每个 mesh 内的顶点池独立（去重 + 重索引），UV 原位保留。常用于：loop cut
 * 或 knife cut 后把 mesh 分离成两部分再各自编辑；或删去某个子网格。
 */
export function splitMeshByVertices(
  node: MeshNode,
  keep: Iterable<number>
): SplitMeshResult {
  const keepSet = new Set(keep)
  /* 另一侧 = 不在 keepSet 里的所有顶点 */
  const otherSet = new Set<number>()
  for (let i = 0; i < node.vertices.length; i++) if (!keepSet.has(i)) otherSet.add(i)

  /* 面归类：全部顶点在 keepSet → keep；全部在 otherSet → other；否则丢弃 */
  const keepFaces: MeshFace[] = []
  const otherFaces: MeshFace[] = []
  for (const face of node.faces) {
    const allInKeep = face.vertices.every((vi) => keepSet.has(vi))
    const allInOther = face.vertices.every((vi) => otherSet.has(vi))
    if (allInKeep) keepFaces.push(face)
    else if (allInOther) otherFaces.push(face)
    /* 横跨两侧 → 丢弃（调用方如需要更精细的面级拆分得自行实现） */
  }

  /** 重索引：给定面数组 + 顶点集合 → 新顶点池 + 新 faces */
  const compact = (faces: MeshFace[], sourceIds: Set<number>): { vertices: Vec3[]; faces: MeshFace[] } => {
    const order: number[] = []
    for (let i = 0; i < node.vertices.length; i++) if (sourceIds.has(i)) order.push(i)
    const old2New = new Map<number, number>()
    const vertices: Vec3[] = []
    for (const id of order) {
      old2New.set(id, vertices.length)
      vertices.push(node.vertices[id]!)
    }
    const remappedFaces: MeshFace[] = faces.map((f) => ({
      vertices: f.vertices.map((vi) => old2New.get(vi) ?? vi),
      uv: f.uv,
      ...(f.texture !== undefined ? { texture: f.texture } : {})
    }))
    return { vertices, faces: remappedFaces }
  }

  const meshes: { vertices: Vec3[]; faces: MeshFace[] }[] = []
  if (keepFaces.length > 0) meshes.push(compact(keepFaces, keepSet))
  if (otherFaces.length > 0) meshes.push(compact(otherFaces, otherSet))

  return { meshes, keptVertexSet: keepSet }
}

/**
 * 顶点按权重插值（v3 C6c proportional edit 核心）：把 `indices` 里的顶点按
 * `weights[i]`（0..1，1=选中顶点完整偏移、0=完全不动）线性插值 delta。
 * `weights` 未提供时退化为 translateMeshVertices（所有选中权重 = 1）。
 */
export function translateMeshVerticesProportional(
  node: MeshNode,
  indices: Iterable<number>,
  delta: Vec3,
  weights?: Iterable<number>
): Vec3[] {
  const sel: number[] = [...indices]
  if (sel.length === 0) return node.vertices.slice()
  const wArr = weights ? [...weights] : sel.map(() => 1)
  const byIdx = new Map<number, number>()
  for (let i = 0; i < sel.length; i++) byIdx.set(sel[i]!, wArr[i] ?? 1)
  return node.vertices.map((v, i) => {
    const w = byIdx.get(i)
    if (w === undefined || w === 0) return v
    return [v[0] + delta[0] * w, v[1] + delta[1] * w, v[2] + delta[2] * w] as Vec3
  })
}
