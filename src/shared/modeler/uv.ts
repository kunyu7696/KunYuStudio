/**
 * UV/贴图展开纯函数：面投影尺寸、自动 UV、box-uv 十字展开、面旋转角点映射、
 * box-uv 自动排布。全部基于立方体几何尺寸推导，不依赖文档与渲染层。
 *
 * UV 约定：uv 为 [u1, v1, u2, v2] 贴图像素坐标（u 向右、v 向下），
 * 未缩放的模型空间 1 单位 = 1 像素；面旋转 rotation 为贴图在面内的
 * 顺时针旋转角（0/90/180/270，对齐原版 block model 语义）。
 * 本模块不依赖 DOM/three/Electron。
 */
import type { CubeNode, FaceBinding, FaceName, FaceRotation, MeshFace, TextureId, Vec2, Vec3 } from './types'
import { FACE_NAMES } from './types'

/** UV 矩形 [u1, v1, u2, v2]（像素坐标） */
export type UvRect = [number, number, number, number]

/* ------------------------------------------------------------------ */
/* 尺寸与自动 UV                                                        */
/* ------------------------------------------------------------------ */

/** 立方体三轴尺寸（逐轴取 |to−from|，容忍负向书写） */
export function cubeSize(cube: Pick<CubeNode, 'from' | 'to'>): Vec3 {
  return [
    Math.abs(cube.to[0] - cube.from[0]),
    Math.abs(cube.to[1] - cube.from[1]),
    Math.abs(cube.to[2] - cube.from[2])
  ]
}

/**
 * 面的投影尺寸（像素）：
 * north/south 看 Z 轴：宽 X、高 Y；east/west 看 X 轴：宽 Z、高 Y；
 * up/down 看 Y 轴：宽 X、高 Z。
 */
export function faceDimensions(size: Vec3, face: FaceName): { w: number; h: number } {
  const [dx, dy, dz] = size
  switch (face) {
    case 'north':
    case 'south':
      return { w: dx, h: dy }
    case 'east':
    case 'west':
      return { w: dz, h: dy }
    case 'up':
    case 'down':
      return { w: dx, h: dz }
  }
}

/** 单面自动 UV：从贴图原点 (0,0) 起取该面投影宽高 */
export function autoFaceUv(size: Vec3, face: FaceName): UvRect {
  const { w, h } = faceDimensions(size, face)
  return [0, 0, w, h]
}

/**
 * 立方体自动 UV（不可变）：重算全部「已存在面」的 uv 为自动值，
 * 保留贴图绑定/旋转等其余字段；不新增缺失面。
 */
export function autoUvCube(cube: CubeNode): CubeNode {
  const size = cubeSize(cube)
  const faces = { ...cube.faces }
  for (const face of FACE_NAMES) {
    const binding = faces[face]
    if (!binding) continue
    faces[face] = { ...binding, uv: autoFaceUv(size, face) }
  }
  return { ...cube, faces }
}

/* ------------------------------------------------------------------ */
/* box-uv 十字展开                                                      */
/* ------------------------------------------------------------------ */

/** 单个立方体 box-uv 十字区域占用的画布尺寸：宽 2(dz+dx)，高 dy+dz */
export function boxUvRegionSize(size: Vec3): { width: number; height: number } {
  const [dx, , dz] = size
  return { width: 2 * (dz + dx), height: size[1] + dz }
}

/**
 * box-uv 标准十字展开（对齐原版/Bedrock 盒式布局）。
 * offset 为十字区域左上角在贴图上的像素坐标；返回六面的 uv 矩形：
 *   上排：up（居中偏左）、down（紧随其后）
 *   下排：west、north、east、south 依次排列
 */
export function boxUvFaces(size: Vec3, offset: Vec2): Record<FaceName, UvRect> {
  const [dx, dy, dz] = size
  const [x, y] = offset
  return {
    up: [x + dz, y, x + dz + dx, y + dz],
    down: [x + dz + dx, y, x + 2 * dz + dx, y + dz],
    west: [x, y + dz, x + dz, y + dz + dy],
    north: [x + dz, y + dz, x + dz + dx, y + dz + dy],
    east: [x + dz + dx, y + dz, x + 2 * dz + dx, y + dz + dy],
    south: [x + 2 * dz + dx, y + dz, x + 2 * dz + 2 * dx, y + dz + dy]
  }
}

/**
 * 生效面绑定：按文档 uvMode 解析立方体最终用于渲染/导出的面绑定——
 * - box 模式且节点带 boxUv：uv 来自十字展开（六面齐全），贴图/旋转等仍取 faces；
 * - 其余情况（per_face，或 box 模式缺 boxUv 的兜底）：直接使用 faces 声明。
 */
export interface ResolvedFaceBinding {
  uv?: UvRect
  texture?: TextureId
  rotation?: FaceRotation
  cullface?: FaceName
  tint?: number
}

export function effectiveFaceBindings(
  cube: CubeNode,
  uvMode: 'per_face' | 'box'
): Partial<Record<FaceName, ResolvedFaceBinding>> {
  const out: Partial<Record<FaceName, ResolvedFaceBinding>> = {}
  const size = cubeSize(cube)
  const boxMap = uvMode === 'box' && cube.boxUv ? boxUvFaces(size, cube.boxUv.uvOffset) : null
  for (const face of FACE_NAMES) {
    const binding: FaceBinding | undefined = cube.faces[face]
    if (!boxMap && !binding) continue
    out[face] = {
      uv: boxMap ? boxMap[face] : binding?.uv,
      texture: binding?.texture,
      rotation: binding?.rotation,
      cullface: binding?.cullface,
      tint: binding?.tint
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 面旋转                                                              */
/* ------------------------------------------------------------------ */

/**
 * 面内旋转的角点映射：返回面四角 [左上, 右上, 右下, 左下]（面自身朝向）
 * 对应的贴图采样坐标。rotation 为贴图顺时针旋转角。
 */
export function rotateUvCorners(uv: UvRect, rotation: FaceRotation): [Vec2, Vec2, Vec2, Vec2] {
  const [u1, v1, u2, v2] = uv
  switch (rotation) {
    case 90:
      // 贴图顺时针转 90°：面左上角采样原左下角
      return [[u1, v2], [u1, v1], [u2, v1], [u2, v2]]
    case 180:
      return [[u2, v2], [u1, v2], [u1, v1], [u2, v1]]
    case 270:
      return [[u2, v1], [u2, v2], [u1, v2], [u1, v1]]
    default:
      return [[u1, v1], [u2, v1], [u2, v2], [u1, v2]]
  }
}

/** 规范化 UV 矩形（自由框选后保证 u1≤u2、v1≤v2） */
export function normalizeUvRect(uv: UvRect): UvRect {
  const [u1, v1, u2, v2] = uv
  return [Math.min(u1, u2), Math.min(v1, v2), Math.max(u1, u2), Math.max(v1, v2)]
}

/* ------------------------------------------------------------------ */
/* mesh 逐顶点 UV ↔ per-face rect 桥接（v3 C3b）                          */
/* ------------------------------------------------------------------ */

/**
 * mesh 面 UV 包围盒（像素坐标 [u1,v1,u2,v2]）。立方体面用 per-face rect，
 * mesh 面用逐顶点 UV——本函数把后者归一到同一 rect 语义（两体系「打通」的桥）。
 * 面无 uv / 空数组 → null。
 */
export function meshFaceUvBounds(face: MeshFace): UvRect | null {
  if (face.uv.length === 0) return null
  let u1 = Infinity
  let v1 = Infinity
  let u2 = -Infinity
  let v2 = -Infinity
  for (const [u, v] of face.uv) {
    if (u < u1) u1 = u
    if (v < v1) v1 = v
    if (u > u2) u2 = u
    if (v > v2) v2 = v
  }
  return [u1, v1, u2, v2]
}

/** mesh 面逐顶点 UV 平移（+du, +dv），返回新数组（不改原面） */
export function translateMeshFaceUv(face: MeshFace, du: number, dv: number): Vec2[] {
  return face.uv.map(([u, v]) => [u + du, v + dv] as Vec2)
}

/** 设置 mesh 面某槽位顶点的 UV，返回新数组；槽位越界时原样返回副本 */
export function setMeshFaceUvVertex(face: MeshFace, slot: number, uv: Vec2): Vec2[] {
  const out = face.uv.map((c) => [...c] as Vec2)
  if (slot >= 0 && slot < out.length) out[slot] = [uv[0], uv[1]]
  return out
}

/**
 * 把 mesh 面 UV 按包围盒整体映射进目标矩形（逐轴拉伸填满，与立方体 per-face
 * rect 语义一致——rect 完整覆盖面）。包围盒某轴退化为 0（面无该轴延展）时该轴
 * 归到矩形左/上边。返回新数组（像素坐标）；面无 uv → 原样副本。
 */
export function fitMeshFaceUvIntoRect(face: MeshFace, rect: UvRect): Vec2[] {
  const b = meshFaceUvBounds(face)
  if (!b) return face.uv.map((c) => [...c] as Vec2)
  const [bu1, bv1, bu2, bv2] = b
  const [r1, c1, r2, c2] = normalizeUvRect(rect)
  const bw = bu2 - bu1
  const bh = bv2 - bv1
  const sx = bw > 0 ? (r2 - r1) / bw : 1
  const sy = bh > 0 ? (c2 - c1) / bh : 1
  return face.uv.map(([u, v]) => [r1 + (u - bu1) * sx, c1 + (v - bv1) * sy] as Vec2)
}

/* ------------------------------------------------------------------ */
/* box-uv 自动排布                                                      */
/* ------------------------------------------------------------------ */

/**
 * 为一组立方体分配 box-uv 左上角偏移（货架式排布，超出画布宽度自动换行）。
 * 放不下的立方体偏移记 [0,0] 并列入 overflow 下标，由调用方提示用户。
 */
export function packBoxUvOffsets(
  sizes: readonly Vec3[],
  canvas: Vec2
): { offsets: Vec2[]; overflow: number[] } {
  const [cw, ch] = canvas
  let cursorX = 0
  let cursorY = 0
  let rowH = 0
  const offsets: Vec2[] = []
  const overflow: number[] = []
  sizes.forEach((size, index) => {
    const { width: w, height: h } = boxUvRegionSize(size)
    if (w > cw || h > ch) {
      overflow.push(index)
      offsets.push([0, 0])
      return
    }
    if (cursorX + w > cw) {
      cursorX = 0
      cursorY += rowH
      rowH = 0
    }
    if (cursorY + h > ch) {
      overflow.push(index)
      offsets.push([0, 0])
      return
    }
    offsets.push([cursorX, cursorY])
    rowH = Math.max(rowH, h)
    cursorX += w
  })
  return { offsets, overflow }
}
