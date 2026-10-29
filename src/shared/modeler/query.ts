/**
 * 查询层：可见性继承、射线拾取（射线-AABB，经世界逆矩阵回到局部空间）、
 * 文档摘要统计。供视口拾取、运行详情/模型摘要面板复用。
 *
 * 拾取距离语义：distance 为沿 dir 的参数 t（dir 不要求归一化）；
 * 存在非均匀缩放的祖先时不同节点的 t 不严格可比（v1 可接受）。
 * 本模块不依赖 DOM/three/Electron。
 */
import type { FaceName, ModelDocument, ModelNode, Vec3 } from './types'
import { isCubeNode, isLocatorNode, isMeshNode } from './types'
import {
  documentAabb,
  mat4Invert,
  transformDirection,
  transformPoint,
  worldMatrixOf,
  type Bounds
} from './transform'

/* ------------------------------------------------------------------ */
/* 可见性                                                              */
/* ------------------------------------------------------------------ */

/** 节点是否实际可见（自身 visible 且全部祖先可见；节点不存在 = false） */
export function isVisible(doc: ModelDocument, id: string): boolean {
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

/** 实际可见的节点 id 集合（保持 nodes 键序） */
export function visibleNodeIds(doc: ModelDocument): string[] {
  return Object.keys(doc.nodes).filter((id) => isVisible(doc, id))
}

/** 节点自身或任一祖先被锁定 = 有效锁定（禁止视口变换；节点不存在 = false） */
export function isEffectivelyLocked(doc: ModelDocument, id: string): boolean {
  let cur: string | null = id
  let guard = 0
  while (cur && guard++ < 256) {
    const node: ModelNode | undefined = doc.nodes[cur]
    if (!node) return false
    if (node.locked) return true
    cur = node.parent
  }
  return false
}

/* ------------------------------------------------------------------ */
/* 射线-AABB                                                            */
/* ------------------------------------------------------------------ */

interface RayAabbHit {
  /** 进入距离（t≥0；起点在盒内时为 0） */
  t: number
  /** 进入薄片的轴（起点在盒内时为 -1） */
  axis: number
  /** 进入面法线方向：-1 = 负向面，1 = 正向面 */
  sign: 1 | -1
}

/** Slab 法射线-AABB 相交；dir 分量可为 0（轴对齐射线）。未命中返回 null。 */
export function rayAabb(origin: Vec3, dir: Vec3, min: Vec3, max: Vec3): number | null {
  return rayAabbHit(origin, dir, min, max)?.t ?? null
}

function rayAabbHit(origin: Vec3, dir: Vec3, min: Vec3, max: Vec3): RayAabbHit | null {
  const EPS = 1e-9
  let tmin = -Infinity
  let tmax = Infinity
  let axis = -1
  let sign: 1 | -1 = 1
  for (let i = 0; i < 3; i++) {
    const d = dir[i]!
    const o = origin[i]!
    if (Math.abs(d) < 1e-12) {
      if (o < min[i]! - EPS || o > max[i]! + EPS) return null
      continue
    }
    const inv = 1 / d
    let t1 = (min[i]! - o) * inv
    let t2 = (max[i]! - o) * inv
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
    }
    if (t1 > tmin) {
      tmin = t1
      axis = i
      sign = d > 0 ? -1 : 1
    }
    if (t2 < tmax) tmax = t2
    if (tmin > tmax + EPS) return null
  }
  if (tmax < 0) return null
  if (tmin > 0) return { t: tmin, axis, sign }
  return { t: 0, axis: -1, sign: 1 }
}

/** 进入薄片的轴/符号 → 面名（−X=west、+X=east、−Y=down、+Y=up、−Z=north、+Z=south） */
function slabFace(axis: number, sign: 1 | -1): FaceName {
  if (axis === 0) return sign < 0 ? 'west' : 'east'
  if (axis === 1) return sign < 0 ? 'down' : 'up'
  return sign < 0 ? 'north' : 'south'
}

/* ------------------------------------------------------------------ */
/* 立方体拾取                                                          */
/* ------------------------------------------------------------------ */

export interface CubePick {
  id: string
  /** 沿 dir 的参数距离 t */
  distance: number
  /** 命中面名（起点在盒内部时缺省） */
  face?: FaceName
  /** 世界空间命中点 */
  point: Vec3
}

export interface PickOptions {
  /** 包含锁定节点（默认 true——锁定只限制变换，不阻挡拾取） */
  includeLocked?: boolean
  /** 包含不可见节点（默认 false） */
  includeInvisible?: boolean
}

/**
 * 拾取射线命中的最近立方体：
 * 世界射线经逆世界矩阵变换到立方体局部空间后做 AABB 相交，
 * 命中面在局部空间推导（面名跟随几何而非世界朝向）。
 */
export function pickCubes(
  doc: ModelDocument,
  origin: Vec3,
  dir: Vec3,
  opts?: PickOptions
): CubePick | null {
  let best: CubePick | null = null
  for (const node of Object.values(doc.nodes)) {
    if (!isCubeNode(node)) continue
    if (!opts?.includeInvisible && !isVisible(doc, node.id)) continue
    if (opts?.includeLocked === false && node.locked) continue
    const inverse = mat4Invert(worldMatrixOf(doc, node.id))
    const localOrigin = transformPoint(inverse, origin)
    const localDir = transformDirection(inverse, dir)
    const hit = rayAabbHit(localOrigin, localDir, node.from, node.to)
    if (!hit) continue
    if (best && hit.t >= best.distance) continue
    best = {
      id: node.id,
      distance: hit.t,
      face: hit.axis >= 0 ? slabFace(hit.axis, hit.sign) : undefined,
      point: [
        origin[0] + dir[0] * hit.t,
        origin[1] + dir[1] * hit.t,
        origin[2] + dir[2] * hit.t
      ]
    }
  }
  return best
}

/* ------------------------------------------------------------------ */
/* 文档摘要                                                            */
/* ------------------------------------------------------------------ */

export interface DocumentSummary {
  cubeCount: number
  groupCount: number
  locatorCount: number
  meshCount: number
  textureCount: number
  animationCount: number
  keyframeCount: number
  /** 全文档世界包围盒（立方体与网格参与，含不可见；空文档为 null） */
  bounds: Bounds | null
}

/** 文档统计摘要（统一编辑器右栏「模型摘要」面板与工坊状态栏复用） */
export function documentSummary(doc: ModelDocument): DocumentSummary {
  let cubeCount = 0
  let groupCount = 0
  let locatorCount = 0
  let meshCount = 0
  for (const node of Object.values(doc.nodes)) {
    if (isCubeNode(node)) cubeCount++
    else if (isMeshNode(node)) meshCount++
    else if (isLocatorNode(node)) locatorCount++
    else groupCount++
  }
  let keyframeCount = 0
  for (const anim of Object.values(doc.animations)) {
    for (const channels of Object.values(anim.channels)) {
      keyframeCount += (channels.rotation?.length ?? 0) + (channels.position?.length ?? 0) + (channels.scale?.length ?? 0)
    }
  }
  return {
    cubeCount,
    groupCount,
    locatorCount,
    meshCount,
    textureCount: Object.keys(doc.textures).length,
    animationCount: Object.keys(doc.animations).length,
    keyframeCount,
    bounds: documentAabb(doc)
  }
}
