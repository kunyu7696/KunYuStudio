/**
 * 视口拾取与框选纯逻辑（自 ModelerViewport.vue 抽离，行为保持逐字一致）：
 * 客户端坐标 → NDC → 射线拾取（节点 / 顶点句柄 / 网格面 / 网格表面点）、
 * 可见性链判定、橡皮筋框选（子树几何点投影落矩形）。
 * three 单例（canvas/camera/raycaster/场景索引）由宿主注入快照，
 * 本模块不持有 Vue 响应式状态。
 */
import * as THREE from 'three'
import type { ModelDocument, MeshNode, NodeId, Vec3 } from '../../../../../shared/modeler/types'
import { isCubeNode, isLocatorNode, isMeshNode } from '../../../../../shared/modeler/types'
import { isEffectivelyLocked, isVisible } from '../../../../../shared/modeler/query'
import { cubeWorldCorners, worldPivotOf } from '../../../../../shared/modeler/transform'
import { subtreeIds } from '../../../../../shared/modeler/document'
import { meshWorldVertices } from '../../../../../shared/modeler/mesh'
import type { SubEditVisuals } from './subEditVisuals'

const ndc = new THREE.Vector2()

/** 拾取依赖的宿主上下文（快照；每次调用时由宿主构造） */
export interface PickCtx {
  canvas: HTMLCanvasElement | null
  camera: THREE.PerspectiveCamera | null
  raycaster: THREE.Raycaster
  pickMeshes: THREE.Mesh[]
  nodeObjects: Map<NodeId, THREE.Object3D>
  doc: ModelDocument | null
  visuals: SubEditVisuals
  weightOverlay: THREE.Points | null
}

/** 客户端坐标 → NDC 并设置射线（调用方需自行保证 canvas/camera 非空） */
function setRayFromClient(ctx: PickCtx, clientX: number, clientY: number): boolean {
  const canvas = ctx.canvas
  const camera = ctx.camera
  if (!canvas || !camera) return false
  const rect = canvas.getBoundingClientRect()
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  ctx.raycaster.setFromCamera(ndc, camera)
  return true
}

/** 对象链可见性（Raycaster 不按 visible 过滤，需手动检查） */
export function isChainVisible(obj: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj
  while (cur) {
    if (!cur.visible) return false
    cur = cur.parent
  }
  return true
}

/** 节点点选：raycast 可拾取 mesh → 最近可见对象的 nodeId */
export function pickNodeAt(ctx: PickCtx, clientX: number, clientY: number): NodeId | null {
  if (!ctx.canvas || !ctx.camera) return null
  if (!setRayFromClient(ctx, clientX, clientY)) return null
  const hits = ctx.raycaster.intersectObjects(ctx.pickMeshes, false)
  const hit = hits.find((h) => isChainVisible(h.object))
  return hit ? (hit.object.userData.nodeId as NodeId) : null
}

/** 顶点模式拾取（B4-3）：raycast 顶点句柄 Points → 顶点下标 */
export function pickVertexAt(ctx: PickCtx, clientX: number, clientY: number): number | null {
  const points = ctx.visuals.vertexPoints
  if (!ctx.canvas || !ctx.camera || !points) return null
  if (!setRayFromClient(ctx, clientX, clientY)) return null
  const hits = ctx.raycaster.intersectObject(points, false)
  const idx = hits[0]?.index
  return idx === undefined ? null : idx
}

/** 目标 mesh 的子 Mesh（排除面叠加/切刀标记等装饰对象） */
function meshChildrenOf(outer: THREE.Object3D, excluded: Set<THREE.Object3D>): THREE.Mesh[] {
  return outer.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !excluded.has(c))
}

/** 排除集（跳过空槽位） */
function exclusionSet(...objs: (THREE.Object3D | null)[]): Set<THREE.Object3D> {
  const s = new Set<THREE.Object3D>()
  for (const o of objs) if (o) s.add(o)
  return s
}

/**
 * 面模式拾取（B4-3）：raycast 目标 mesh 的分组网格 → 三角序号
 * 经 userData.triToFace 回映射为 node.faces 面下标。
 */
export function pickMeshFaceAt(
  ctx: PickCtx,
  meshEditTarget: NodeId | null,
  clientX: number,
  clientY: number
): number | null {
  if (!ctx.canvas || !ctx.camera) return null
  const outer = meshEditTarget ? ctx.nodeObjects.get(meshEditTarget) : undefined
  if (!outer) return null
  if (!setRayFromClient(ctx, clientX, clientY)) return null
  const meshes = meshChildrenOf(outer, exclusionSet(ctx.visuals.faceOverlay, ctx.visuals.knifeMarker))
  const hits = ctx.raycaster.intersectObjects(meshes, false)
  const hit = hits.find((h) => h.faceIndex !== undefined)
  if (!hit || hit.faceIndex == null) return null
  const map = hit.object.userData.triToFace as number[] | undefined
  return map?.[hit.faceIndex] ?? null
}

/**
 * 切刀拾取（v3 C2）：raycast 目标 mesh → { 面下标, 父空间交点坐标 }。
 * 父空间换算：outer.worldToLocal(世界交点) 得 (v−origin)/16，乘 16 再加回 origin。
 */
export function pickMeshSurfaceAt(
  ctx: PickCtx,
  meshEditTarget: NodeId | null,
  clientX: number,
  clientY: number
): { face: number; point: Vec3 } | null {
  if (!ctx.canvas || !ctx.camera) return null
  const node = meshEditTarget ? ctx.doc?.nodes[meshEditTarget] : undefined
  const outer = meshEditTarget ? ctx.nodeObjects.get(meshEditTarget) : undefined
  if (!node || !isMeshNode(node) || !outer) return null
  const rect = ctx.canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  if (!setRayFromClient(ctx, clientX, clientY)) return null
  outer.updateWorldMatrix(true, false)
  const meshes = meshChildrenOf(outer, exclusionSet(ctx.visuals.faceOverlay, ctx.visuals.knifeMarker))
  const hit = ctx.raycaster.intersectObjects(meshes, false).find((h) => h.faceIndex !== undefined)
  if (!hit || hit.faceIndex == null) return null
  const face = (hit.object.userData.triToFace as number[] | undefined)?.[hit.faceIndex] ?? null
  if (face === null) return null
  const local = outer.worldToLocal(hit.point.clone())
  return {
    face,
    point: [
      local.x * 16 + node.origin[0],
      local.y * 16 + node.origin[1],
      local.z * 16 + node.origin[2]
    ]
  }
}

/**
 * 拾取目标 mesh 表面在**父空间**的交点（raycast → worldToLocal → ×16 + origin）。
 * 与切刀拾取同源，但只返回点（权重笔刷不需要面下标）。
 */
export function pickMeshModelPoint(
  ctx: PickCtx,
  node: MeshNode | null,
  clientX: number,
  clientY: number
): Vec3 | null {
  if (!ctx.canvas || !ctx.camera) return null
  const outer = node ? ctx.nodeObjects.get(node.id) : undefined
  if (!node || !outer) return null
  const rect = ctx.canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  if (!setRayFromClient(ctx, clientX, clientY)) return null
  outer.updateWorldMatrix(true, false)
  const excluded = exclusionSet(ctx.visuals.faceOverlay, ctx.visuals.knifeMarker, ctx.weightOverlay)
  const meshes = meshChildrenOf(outer, excluded)
  const hit = ctx.raycaster.intersectObjects(meshes, false).find((h) => h.faceIndex !== undefined)
  if (!hit) return null
  const local = outer.worldToLocal(hit.point.clone())
  return [local.x * 16 + node.origin[0], local.y * 16 + node.origin[1], local.z * 16 + node.origin[2]]
}

/**
 * 框选：把每个节点的子树几何点（cube 世界角点 / mesh 世界顶点 / locator pivot）投影到屏幕，
 * 任一点落入矩形即选中该节点（组被其子树代表；父子重复选中由变换端顶层化消解）。
 * 隐藏节点与有效锁定节点不参与。返回命中的节点 id 列表（不写 store）。
 */
export function nodesInMarquee(
  doc: ModelDocument,
  camera: THREE.PerspectiveCamera,
  stageRect: { width: number; height: number },
  rect: { x1: number; y1: number; x2: number; y2: number }
): NodeId[] {
  const minX = Math.min(rect.x1, rect.x2)
  const maxX = Math.max(rect.x1, rect.x2)
  const minY = Math.min(rect.y1, rect.y2)
  const maxY = Math.max(rect.y1, rect.y2)
  const v = new THREE.Vector3()
  const hitIds: NodeId[] = []

  for (const node of Object.values(doc.nodes)) {
    if (!isVisible(doc, node.id) || isEffectivelyLocked(doc, node.id)) continue
    let hit = false
    for (const nid of subtreeIds(doc, node.id)) {
      const n = doc.nodes[nid]
      if (!n) continue
      const pts: Vec3[] = []
      if (isCubeNode(n)) pts.push(...cubeWorldCorners(doc, n))
      else if (isMeshNode(n)) pts.push(...meshWorldVertices(doc, n))
      else if (isLocatorNode(n)) pts.push(worldPivotOf(doc, nid))
      for (const p of pts) {
        v.set(p[0] / 16 - 0.5, p[1] / 16 - 0.5, p[2] / 16 - 0.5)
        v.project(camera)
        if (v.z < -1 || v.z > 1) continue // 相机后方
        const px = ((v.x + 1) / 2) * stageRect.width
        const py = ((1 - v.y) / 2) * stageRect.height
        if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
          hit = true
          break
        }
      }
      if (hit) break
    }
    if (hit) hitIds.push(node.id)
  }
  return hitIds
}
