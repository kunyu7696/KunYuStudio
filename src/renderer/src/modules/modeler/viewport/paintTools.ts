/**
 * 绘画工具纯算法（自 ModelerViewport.vue 抽离，行为保持逐字一致）：
 * 射线拾面、方形笔刷落笔（镜像/锁 alpha/橡皮）、Bresenham 连续笔画、
 * 油漆桶 4-连通域填充、绘画网格线生成。
 * 画布/贴图条目由宿主注入（TexEntryLike），本模块不持有 Vue 响应式状态。
 */
import * as THREE from 'three'
import type { FaceName, ModelDocument, ModelNode, NodeId, TextureId, Vec2, Vec3 } from '../../../../../shared/modeler/types'
import { isCubeNode, isMeshNode } from '../../../../../shared/modeler/types'
import { effectiveFaceBindings, rotateUvCorners } from '../../../../../shared/modeler/uv'

/** BoxGeometry materialIndex → 文档面名（+x,-x,+y,-y,+z,-z） */
export const BOX_FACE_BY_INDEX: readonly FaceName[] = ['east', 'west', 'up', 'down', 'south', 'north']

/** BoxGeometry materialIndex → mesh 局部法线（绘画网格沿法线偏移防 z-fight） */
export const BOX_FACE_NORMALS: readonly Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
]

/** 视口贴图条目的最小契约（宿主 TexEntry 的结构子集） */
export interface TexEntryLike {
  id: TextureId
  w: number
  h: number
  tex: { needsUpdate: boolean }
  paintCanvas: HTMLCanvasElement
  paintCtx: CanvasRenderingContext2D
  loadedPaintData: string
}

export interface FaceHit {
  nodeId: NodeId
  /** 立方体面名（mesh 面为 null，改用 faceKey） */
  face: FaceName | null
  /** 面标识键（cube:北 / mesh:3 等）：跨面断线判定用（mesh 无 FaceName） */
  faceKey: string
  texId: TextureId | null
  /** 命中像素（贴图坐标，已 clamp） */
  px: Vec2
  /** 命中 mesh 与几何面索引（cube = materialIndex，mesh = 三角形下标） */
  mesh: THREE.Mesh
  faceIndex: number
}

export interface StrokeState {
  texId: TextureId
  entry: TexEntryLike
  startPx: Vec2
  lastPx: Vec2
  lastFaceKey: string
  /** Shift 直线模式：move 时从快照重画 start→cur */
  shiftLine: boolean
  snapshot: ImageData
  /** 本笔画已落像素（防止重复合成加深） */
  painted: Set<string>
  changed: boolean
}

/** 绘画参数快照（宿主每帧从响应式读取后传入） */
export interface PaintParams {
  paintTool: 'brush' | 'eraser' | 'bucket'
  color: string
  /** 0–100 */
  opacity: number
  brushSize: number
  mirrorX: boolean
  mirrorY: boolean
  lockAlpha: boolean
}

/** 拾面/绘画依赖的宿主上下文 */
export interface PaintCtx {
  doc: ModelDocument | null
  canvas: HTMLCanvasElement
  camera: THREE.PerspectiveCamera
  raycaster: THREE.Raycaster
  pickMeshes: THREE.Mesh[]
  texEntries: Map<TextureId, TexEntryLike>
  isChainVisible: (obj: THREE.Object3D) => boolean
}

const ndc = new THREE.Vector2()

/** 构造笔画状态（含活动层像素快照；宿主在命中面后调用） */
export function createStrokeState(
  hit: FaceHit,
  entry: TexEntryLike,
  shiftLine: boolean
): StrokeState {
  return {
    texId: hit.texId!,
    entry,
    startPx: hit.px,
    lastPx: hit.px,
    lastFaceKey: hit.faceKey,
    shiftLine,
    snapshot: entry.paintCtx.getImageData(0, 0, entry.w, entry.h),
    painted: new Set(),
    changed: false
  }
}

/**
 * 射线拾取表面命中 → 贴图 + 命中像素（v3 C3b 起同时支持 cube 与 mesh）。
 * - cube：materialIndex 推面名，贴图取有效绑定；
 * - mesh：几何三角形下标经 userData.triToFace 推网格面下标，贴图取 face.texture；
 * - 命中像素统一由命中 uv 反推（视口 uv = (u/w, 1 − v/h)，两体系一致）。
 */
export function pickFaceAt(ctx: PaintCtx, clientX: number, clientY: number): FaceHit | null {
  const { canvas, camera, doc: d } = ctx
  const rect = canvas.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null
  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1
  ctx.raycaster.setFromCamera(ndc, camera)
  const hits = ctx.raycaster.intersectObjects(ctx.pickMeshes, false)
  const hit = hits.find((h) => ctx.isChainVisible(h.object) && h.face && h.uv)
  if (!hit || !hit.face || !hit.uv || !d) return null
  const nodeId = hit.object.userData.nodeId as NodeId
  const node = d.nodes[nodeId]
  if (!node) return null
  const mesh = hit.object as THREE.Mesh

  let texId: TextureId | null = null
  let faceKey: string
  let cubeFace: FaceName | null = null
  let faceIndex: number
  if (isCubeNode(node)) {
    cubeFace = BOX_FACE_BY_INDEX[hit.face.materialIndex] ?? null
    if (!cubeFace) return null
    faceKey = `cube:${cubeFace}`
    faceIndex = hit.face.materialIndex // 几何面下标 0..5（绘画网格按面 4 顶点定位）
    texId = effectiveFaceBindings(node, d.settings.uvMode)[cubeFace]?.texture ?? null
  } else if (isMeshNode(node)) {
    const triToFace = mesh.userData.triToFace as number[] | undefined
    const fi = triToFace ? triToFace[hit.faceIndex!] : undefined
    if (fi === undefined) return null
    const face = node.faces[fi]
    if (!face) return null
    faceKey = `mesh:${fi}`
    faceIndex = hit.faceIndex! // 三角形下标（网格面全三角化，无固定 4 顶点布局）
    texId = face.texture && d.textures[face.texture] ? face.texture : null
  } else {
    return null
  }

  const texMeta = texId ? d.textures[texId] : undefined
  if (!texMeta) {
    return { nodeId, face: cubeFace, faceKey, texId: null, px: [0, 0], mesh, faceIndex }
  }
  const px: Vec2 = [
    Math.min(texMeta.width - 1, Math.max(0, Math.floor(hit.uv.x * texMeta.width))),
    Math.min(texMeta.height - 1, Math.max(0, Math.floor((1 - hit.uv.y) * texMeta.height)))
  ]
  return { nodeId, face: cubeFace, faceKey, texId, px, mesh, faceIndex }
}

/**
 * 方形笔刷落笔：源覆盖合成（globalAlpha fillRect；橡皮为 destination-out 擦除），
 * 同笔画内同像素不重复画；镜像开关把落点扩展到贴图对侧；锁 alpha 跳过全透明像素。
 */
export function stampAt(p: PaintParams, s: StrokeState, cx: number, cy: number): void {
  const half = Math.floor(p.brushSize / 2)
  const ctx = s.entry.paintCtx
  const erasing = p.paintTool === 'eraser'
  ctx.globalAlpha = p.opacity / 100
  ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
  ctx.fillStyle = erasing ? '#000000' : p.color
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      stampTexel(p, s, cx + dx, cy + dy)
    }
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  s.entry.tex.needsUpdate = true
}

/** 单 texel 落笔（含镜像扩展与锁 alpha 判定） */
function stampTexel(p: PaintParams, s: StrokeState, x: number, y: number): void {
  const w = s.entry.w
  const h = s.entry.h
  const pts: [number, number][] = [[x, y]]
  if (p.mirrorX) pts.push([w - 1 - x, y])
  if (p.mirrorY) pts.push([x, h - 1 - y])
  if (p.mirrorX && p.mirrorY) pts.push([w - 1 - x, h - 1 - y])
  const erasing = p.paintTool === 'eraser'
  for (const [px, py] of pts) {
    if (px < 0 || py < 0 || px >= w || py >= h) continue
    const key = `${px},${py}`
    if (s.painted.has(key)) continue
    if (p.lockAlpha && !erasing) {
      if (s.entry.paintCtx.getImageData(px, py, 1, 1).data[3] === 0) continue
    }
    s.painted.add(key)
    s.entry.paintCtx.fillRect(px, py, 1, 1)
    s.changed = true
  }
}

/** Bresenham 线段落笔（连续笔画插值） */
export function strokeLine(p: PaintParams, s: StrokeState, from: Vec2, to: Vec2): void {
  let [x0, y0] = from
  const [x1, y1] = to
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    stampAt(p, s, x0, y0)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}

/**
 * 油漆桶：4-连通域精确匹配种子色 → 源覆盖填充（橡皮桶 = 区域擦除）。
 * 镜像开关扩展填充集；锁 alpha 时全透明像素不参与；无变化不提交。
 * 返回是否有像素变化（有变化时内部已 putImageData + tex.needsUpdate）。
 */
export function bucketFillAt(
  p: PaintParams,
  hit: FaceHit,
  entry: TexEntryLike
): boolean {
  const w = entry.w
  const h = entry.h
  const img = entry.paintCtx.getImageData(0, 0, w, h)
  const data = img.data
  const [sx, sy] = hit.px
  const si = (sy * w + sx) * 4
  const seed = [data[si]!, data[si + 1]!, data[si + 2]!, data[si + 3]!] as const
  if (p.lockAlpha && seed[3] === 0) return false

  // 连通域收集（BFS，精确 RGBA 匹配）
  const region = new Set<number>()
  const queue = [sy * w + sx]
  region.add(queue[0]!)
  while (queue.length > 0) {
    const cur = queue.pop()!
    const cx = cur % w
    const cy = Math.floor(cur / w)
    for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const ni = ny * w + nx
      if (region.has(ni)) continue
      const o = ni * 4
      if (data[o] !== seed[0] || data[o + 1] !== seed[1] || data[o + 2] !== seed[2] || data[o + 3] !== seed[3]) continue
      region.add(ni)
      queue.push(ni)
    }
  }

  // 镜像扩展为应用集
  const applySet = new Set<number>(region)
  if (p.mirrorX || p.mirrorY) {
    for (const idx of region) {
      const cx = idx % w
      const cy = Math.floor(idx / w)
      if (p.mirrorX) applySet.add(cy * w + (w - 1 - cx))
      if (p.mirrorY) applySet.add((h - 1 - cy) * w + cx)
      if (p.mirrorX && p.mirrorY) applySet.add((h - 1 - cy) * w + (w - 1 - cx))
    }
  }

  const erasing = p.paintTool === 'eraser'
  const opacity = p.opacity / 100
  const fr = parseInt(p.color.slice(1, 3), 16)
  const fg = parseInt(p.color.slice(3, 5), 16)
  const fb = parseInt(p.color.slice(5, 7), 16)
  let changed = false
  for (const idx of applySet) {
    const o = idx * 4
    const ba = data[o + 3]! / 255
    if (p.lockAlpha && data[o + 3] === 0) continue
    if (erasing) {
      const outA = Math.round(data[o + 3]! * (1 - opacity))
      if (outA === data[o + 3]) continue
      data[o + 3] = outA
      changed = true
      continue
    }
    const outA = opacity + ba * (1 - opacity)
    const nr = outA > 0 ? Math.round((fr * opacity + data[o]! * ba * (1 - opacity)) / outA) : 0
    const ng = outA > 0 ? Math.round((fg * opacity + data[o + 1]! * ba * (1 - opacity)) / outA) : 0
    const nb = outA > 0 ? Math.round((fb * opacity + data[o + 2]! * ba * (1 - opacity)) / outA) : 0
    const na = Math.round(outA * 255)
    if (nr === data[o] && ng === data[o + 1] && nb === data[o + 2] && na === data[o + 3]) continue
    data[o] = nr
    data[o + 1] = ng
    data[o + 2] = nb
    data[o + 3] = na
    changed = true
  }
  if (!changed) return false
  entry.paintCtx.putImageData(img, 0, 0)
  entry.tex.needsUpdate = true
  return true
}

/**
 * 绘画网格几何：取命中面 UV 矩形像素数 w×h，从 mesh 几何位置属性读该面
 * 4 顶点（面内序 [TL,TR,BL,BR]）双线性插值生成 (w+1)+(h+1) 条边界线，
 * 沿法线微移防 z-fight。仅支持 cube；mesh/无 UV/重复悬停（key 相同）返回 null。
 */
export function computePaintGrid(
  hit: FaceHit,
  node: ModelNode,
  uvMode: ModelDocument['settings']['uvMode'],
  lastKey: string
): { positions: number[]; key: string } | null {
  if (!hit.texId || !isCubeNode(node) || !hit.face) return null
  const binding = effectiveFaceBindings(node, uvMode)[hit.face]
  if (!binding?.uv) return null
  const corners = rotateUvCorners(binding.uv, binding.rotation ?? 0) // [TL,TR,BR,BL] 像素坐标
  const w = Math.max(1, Math.round(Math.hypot(corners[1]![0] - corners[0]![0], corners[1]![1] - corners[0]![1])))
  const h = Math.max(1, Math.round(Math.hypot(corners[3]![0] - corners[0]![0], corners[3]![1] - corners[0]![1])))
  const key = `${hit.nodeId}:${hit.faceIndex}:${w}x${h}`
  if (key === lastKey) return null

  const posAttr = hit.mesh.geometry.attributes.position as THREE.BufferAttribute
  const base = hit.faceIndex * 4
  const vert = (i: number): [number, number, number] => [
    posAttr.getX(base + i),
    posAttr.getY(base + i),
    posAttr.getZ(base + i)
  ]
  const vTL = vert(0)
  const vTR = vert(1)
  const vBL = vert(2)
  const vBR = vert(3)
  const n = BOX_FACE_NORMALS[hit.faceIndex]!
  const OFF = 0.006 // 局部单位偏移（随 mesh scale 缩放）
  const pointAt = (s: number, t: number): [number, number, number] => [
    (1 - t) * ((1 - s) * vTL[0] + s * vTR[0]) + t * ((1 - s) * vBL[0] + s * vBR[0]) + n[0]! * OFF,
    (1 - t) * ((1 - s) * vTL[1] + s * vTR[1]) + t * ((1 - s) * vBL[1] + s * vBR[1]) + n[1]! * OFF,
    (1 - t) * ((1 - s) * vTL[2] + s * vTR[2]) + t * ((1 - s) * vBL[2] + s * vBR[2]) + n[2]! * OFF
  ]
  const pts: number[] = []
  for (let i = 0; i <= w; i++) {
    const s = i / w
    pts.push(...pointAt(s, 0), ...pointAt(s, 1))
  }
  for (let j = 0; j <= h; j++) {
    const t = j / h
    pts.push(...pointAt(0, t), ...pointAt(1, t))
  }
  return { positions: pts, key }
}
