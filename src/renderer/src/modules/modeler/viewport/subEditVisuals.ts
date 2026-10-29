/**
 * 网格子对象编辑可视化纯逻辑（自 ModelerViewport.vue 抽离，行为保持逐字一致）：
 * 顶点句柄 Points / 选中面叠加 Mesh / 边句柄 LineSegments / 切刀锚点标记的同步与释放。
 * three 对象登记在宿主注入的 visuals 槽位中（对象引用共享，置空即同步回宿主）；
 * store 切片以快照参数传入，本模块不持有 Vue 响应式状态。
 */
import * as THREE from 'three'
import type { ModelDocument, NodeId, Vec3 } from '../../../../../shared/modeler/types'
import { isMeshNode } from '../../../../../shared/modeler/types'
import { buildMeshEdges, meshEdgeKey, triangulateFace } from '../../../../../shared/modeler/mesh'

/** 选中高亮色（与视口选择线框一致） */
const SELECT_COLOR = 0x89b4fa

/** 网格子对象编辑模式（与 stores/modeler 的 MeshEditMode 结构一致） */
export type SubEditMode = 'object' | 'vertex' | 'face' | 'edge' | 'knife'

/** 子对象编辑可视化槽位（宿主持有本对象，函数内对字段的写回即时生效） */
export interface SubEditVisuals {
  vertexPoints: THREE.Points | null
  faceOverlay: THREE.Mesh | null
  edgeLines: THREE.LineSegments | null
  knifeMarker: THREE.Mesh | null
}

export function createSubEditVisuals(): SubEditVisuals {
  return { vertexPoints: null, faceOverlay: null, edgeLines: null, knifeMarker: null }
}

/** 同步函数依赖的宿主上下文（store 切片快照 + 场景索引） */
export interface SubEditCtx {
  visuals: SubEditVisuals
  nodeObjects: Map<NodeId, THREE.Object3D>
  doc: ModelDocument | null
  editMode: SubEditMode
  meshEditTarget: NodeId | null
  vertexSelection: readonly number[]
  faceSelection: readonly number[]
  edgeSelection: readonly string[]
  knifeAnchor: { face: number; point: Vec3 } | null
}

/** 释放并移除单个槽位的 three 对象 */
function clearSlot(visuals: SubEditVisuals, key: keyof SubEditVisuals): void {
  const obj = visuals[key]
  if (!obj) return
  obj.parent?.remove(obj)
  obj.geometry.dispose()
  ;(obj.material as THREE.Material).dispose()
  visuals[key] = null
}

/** 释放并移除顶点句柄/面叠加/边句柄/切刀标记（重建/切模式/切选中前调用） */
export function clearSubEditHandles(visuals: SubEditVisuals): void {
  clearSlot(visuals, 'vertexPoints')
  clearSlot(visuals, 'faceOverlay')
  clearSlot(visuals, 'edgeLines')
  clearSlot(visuals, 'knifeMarker')
}

/** 边句柄：目标 mesh 全部唯一边 → THREE.LineSegments（选中边高亮；随节点 outer 组变换） */
export function syncEdgeHandles(ctx: SubEditCtx): void {
  clearSlot(ctx.visuals, 'edgeLines')
  if (ctx.editMode !== 'edge') return
  const id = ctx.meshEditTarget
  const node = id ? ctx.doc?.nodes[id] : undefined
  const outer = id ? ctx.nodeObjects.get(id) : undefined
  if (!node || !isMeshNode(node) || !outer) return
  const sel = new Set(ctx.edgeSelection)
  const cSel = new THREE.Color(SELECT_COLOR)
  const cNor = new THREE.Color(0x9aa3b2)
  const pos: number[] = []
  const col: number[] = []
  for (const e of buildMeshEdges(node)) {
    const va = node.vertices[e.a]!
    const vb = node.vertices[e.b]!
    pos.push(
      (va[0] - node.origin[0]) / 16, (va[1] - node.origin[1]) / 16, (va[2] - node.origin[2]) / 16,
      (vb[0] - node.origin[0]) / 16, (vb[1] - node.origin[1]) / 16, (vb[2] - node.origin[2]) / 16
    )
    const c = sel.has(meshEdgeKey(e.a, e.b)) ? cSel : cNor
    col.push(c.r, c.g, c.b, c.r, c.g, c.b)
  }
  if (pos.length === 0) return
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false })
  const lines = new THREE.LineSegments(geo, mat)
  lines.renderOrder = 1000
  ctx.visuals.edgeLines = lines
  outer.add(lines)
}

/** 顶点句柄：目标 mesh 全部顶点 → THREE.Points（选中顶点高亮；随节点 outer 组变换） */
export function syncVertexHandles(ctx: SubEditCtx): void {
  clearSlot(ctx.visuals, 'vertexPoints')
  if (ctx.editMode !== 'vertex') return
  const id = ctx.meshEditTarget
  const node = id ? ctx.doc?.nodes[id] : undefined
  const outer = id ? ctx.nodeObjects.get(id) : undefined
  if (!node || !isMeshNode(node) || !outer) return
  const sel = new Set(ctx.vertexSelection)
  const cSel = new THREE.Color(SELECT_COLOR)
  const cNor = new THREE.Color(0xf2f4f8)
  const pos: number[] = []
  const col: number[] = []
  node.vertices.forEach((v, i) => {
    pos.push((v[0] - node.origin[0]) / 16, (v[1] - node.origin[1]) / 16, (v[2] - node.origin[2]) / 16)
    const c = sel.has(i) ? cSel : cNor
    col.push(c.r, c.g, c.b)
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  const mat = new THREE.PointsMaterial({
    size: 0.045,
    vertexColors: true,
    sizeAttenuation: true,
    depthTest: false
  })
  const points = new THREE.Points(geo, mat)
  points.renderOrder = 999
  ctx.visuals.vertexPoints = points
  outer.add(points)
}

/** 选中面叠加：选中 MeshFace 三角化 → 半透明面片（polygonOffset 防 z-fight） */
export function syncFaceOverlay(ctx: SubEditCtx): void {
  clearSlot(ctx.visuals, 'faceOverlay')
  if (ctx.editMode !== 'face') return
  const id = ctx.meshEditTarget
  const node = id ? ctx.doc?.nodes[id] : undefined
  const outer = id ? ctx.nodeObjects.get(id) : undefined
  if (!node || !isMeshNode(node) || !outer || ctx.faceSelection.length === 0) return
  const sel = new Set(ctx.faceSelection)
  const positions: number[] = []
  node.faces.forEach((face, fi) => {
    if (!sel.has(fi)) return
    for (const tri of triangulateFace(face)) {
      for (const slot of tri) {
        const v = node.vertices[face.vertices[slot]!]
        if (!v) continue
        positions.push((v[0] - node.origin[0]) / 16, (v[1] - node.origin[1]) / 16, (v[2] - node.origin[2]) / 16)
      }
    }
  })
  if (positions.length === 0) return
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const mat = new THREE.MeshBasicMaterial({
    color: SELECT_COLOR,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2
  })
  const overlay = new THREE.Mesh(geo, mat)
  overlay.renderOrder = 998
  ctx.visuals.faceOverlay = overlay
  outer.add(overlay)
}

/**
 * 切刀锚点标记：knife 模式且已定第一点时，在首击点处显示小球（随 outer 组变换）。
 * 局部坐标 = (父空间点 − origin)/16，与网格几何同系。
 */
export function syncKnifeMarker(ctx: SubEditCtx): void {
  clearSlot(ctx.visuals, 'knifeMarker')
  const anchor = ctx.editMode === 'knife' ? ctx.knifeAnchor : null
  const id = ctx.meshEditTarget
  const node = id ? ctx.doc?.nodes[id] : undefined
  const outer = id ? ctx.nodeObjects.get(id) : undefined
  if (!anchor || !node || !isMeshNode(node) || !outer) return
  const geo = new THREE.SphereGeometry(0.06, 12, 8)
  const mat = new THREE.MeshBasicMaterial({ color: SELECT_COLOR, depthTest: false })
  const marker = new THREE.Mesh(geo, mat)
  marker.position.set(
    (anchor.point[0] - node.origin[0]) / 16,
    (anchor.point[1] - node.origin[1]) / 16,
    (anchor.point[2] - node.origin[2]) / 16
  )
  marker.renderOrder = 1001
  ctx.visuals.knifeMarker = marker
  outer.add(marker)
}
