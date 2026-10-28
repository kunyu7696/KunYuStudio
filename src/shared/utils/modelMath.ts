/**
 * Cube 模型几何/UV 纯函数（M12）。
 * 渲染层（three.js 坐标换算）与主进程（编译器、AI 工具）同源共用，
 * 不依赖 DOM/WebGL，可直接在 vitest（jsdom/node）下测试。
 *
 * 坐标系：Minecraft 模型空间 0..16；three.js 世界把 16 单位映射为 1 格，
 * 世界原点（方块中心）在 three (0,0,0)，即 MC 8 对应 three 0。
 */
import type {
  CubeElement,
  CubeFaceName,
  FaceUv,
  RotationAxis
} from '../types/content'

export type Vec3 = [number, number, number]

/** 旋转角吸附单位（原版模型限制：22.5° 倍数，±45°） */
export const ROTATION_STEP = 22.5
export const ROTATION_MAX = 45

/** MC 模型空间每轴范围 */
export const MODEL_EXTENT = 16

/** 允许的面内旋转角 */
export const FACE_ROTATIONS = [0, 90, 180, 270] as const

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** 坐标夹取到 0..16 */
export function clampCoord(n: number): number {
  return clamp(n, 0, MODEL_EXTENT)
}

/**
 * 规范化立方体：每轴 from/to 夹取 0..16 并保证 from ≤ to（逐轴排序）。
 * 不修改原对象。
 */
export function clampElement(el: CubeElement): CubeElement {
  const from = el.from.slice() as Vec3
  const to = el.to.slice() as Vec3
  for (let axis = 0; axis < 3; axis++) {
    let a = clampCoord(from[axis])
    let b = clampCoord(to[axis])
    if (a > b) {
      const t = a
      a = b
      b = t
    }
    from[axis] = a
    to[axis] = b
  }
  return { ...el, from, to }
}

/** 吸附到最近的 22.5° 倍数并夹到 ±45°（负半值远离 0 舍入，避免 -0） */
export function snapRotation(angle: number): number {
  if (!Number.isFinite(angle)) return 0
  const units = angle / ROTATION_STEP
  const snapped = Math.sign(units) * Math.round(Math.abs(units)) * ROTATION_STEP
  return clamp(snapped, -ROTATION_MAX, ROTATION_MAX)
}

/** 立方体中心（MC 0..16 空间） */
export function elementCenter(el: CubeElement): Vec3 {
  return [
    (el.from[0] + el.to[0]) / 2,
    (el.from[1] + el.to[1]) / 2,
    (el.from[2] + el.to[2]) / 2
  ]
}

/** 立方体各轴尺寸（MC 单位） */
export function elementSize(el: CubeElement): Vec3 {
  return [
    el.to[0] - el.from[0],
    el.to[1] - el.from[1],
    el.to[2] - el.from[2]
  ]
}

/**
 * 面的投影尺寸（贴图像素单位）：
 * north/south 看 Z 轴：宽 X、高 Y；
 * east/west 看 X 轴：宽 Z、高 Y；
 * up/down 看 Y 轴：宽 X、高 Z。
 */
export function faceDimensions(el: CubeElement, face: CubeFaceName): { w: number; h: number } {
  const [dx, dy, dz] = elementSize(el)
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

/**
 * 单面自动 UV：从贴图原点 (0,0) 起，取该面投影宽高。
 * 多个面可共享同一贴图区域（像素画单材质立方体的常见用法）。
 */
export function autoFaceUv(el: CubeElement, face: CubeFaceName): FaceUv {
  const { w, h } = faceDimensions(el, face)
  return [0, 0, w, h]
}

/** 给单个立方体的全部存在面重算自动 UV（不改变启用/剔面状态） */
export function autoUvElement(el: CubeElement): CubeElement {
  const faces = { ...el.faces }
  for (const face of Object.keys(faces) as CubeFaceName[]) {
    if (!faces[face]) continue
    faces[face] = { ...faces[face]!, uv: autoFaceUv(el, face) }
  }
  return { ...el, faces }
}

/**
 * 多立方体 box-uv 十字展开（Blockbench 风格）：
 * 按元素顺序从贴图左上排列，每个立方体占 (2*dz+2*dx) × (2*dz... ) 的十字格：
 *   up   (dx×dz) 居中在上排；down (dx×dz) 在上排右侧
 *   west/east (dz×dy)、north/south (dx×dy) 在下排
 * 超出贴图宽度自动换行；返回每个元素的六面 UV（调用方合并进 faces）。
 */
export function boxUvLayout(
  elements: CubeElement[],
  textureSize: number
): { index: number; faces: Partial<Record<CubeFaceName, FaceUv>> }[] {
  let cursorX = 0
  let cursorY = 0
  let rowH = 0

  const out: { index: number; faces: Partial<Record<CubeFaceName, FaceUv>> }[] = []

  function ensureFit(w: number, h: number): void {
    if (cursorX + w > textureSize) {
      cursorX = 0
      cursorY += rowH
      rowH = 0
    }
    if (cursorY + h > textureSize) {
      // 贴图放不下：剩余元素退化为 (0,0,w,h)，由 validateModel 报越界提示
      cursorX = 0
      cursorY = 0
      rowH = 0
    }
  }

  elements.forEach((el, index) => {
    const [dx, dy, dz] = elementSize(el).map((n) => Math.max(0.0001, n)) as Vec3
    const w = 2 * dz + 2 * dx
    const h = dz + dy
    ensureFit(w, h)
    const x = cursorX
    const y = cursorY
    rowH = Math.max(rowH, h)
    const map: Partial<Record<CubeFaceName, FaceUv>> = {
      up: [x + dz, y, x + dz + dx, y + dz],
      down: [x + dz + dx, y, x + 2 * dz + dx, y + dz],
      west: [x, y + dz, x + dz, y + dz + dy],
      north: [x + dz, y + dz, x + dz + dx, y + dz + dy],
      east: [x + dz + dx, y + dz, x + 2 * dz + dx, y + dz + dy],
      south: [x + 2 * dz + dx, y + dz, x + 2 * dz + 2 * dx, y + dz + dy]
    }
    out.push({ index, faces: map })
    cursorX += w
  })

  return out
}

/**
 * 镜像立方体（X 或 Z 轴，关于模型中心平面）：
 * 坐标翻转 + 对调对应面（X：east⇄west；Z：north⇄south）。
 */
export function mirrorElement(el: CubeElement, axis: 'x' | 'z'): CubeElement {
  const axisIndex = axis === 'x' ? 0 : 2
  const from = el.from.slice() as Vec3
  const to = el.to.slice() as Vec3
  const lo = MODEL_EXTENT - to[axisIndex]
  const hi = MODEL_EXTENT - from[axisIndex]
  from[axisIndex] = lo
  to[axisIndex] = hi

  const faces = { ...el.faces }
  const swap = (a: CubeFaceName, b: CubeFaceName): void => {
    const tmp = faces[a]
    if (faces[b]) faces[a] = { ...faces[b]! }
    else delete faces[a]
    if (tmp) faces[b] = { ...tmp }
    else delete faces[b]
  }
  if (axis === 'x') swap('east', 'west')
  else swap('north', 'south')

  const rotation = el.rotation
    ? {
        ...el.rotation,
        origin: el.rotation.origin.slice() as Vec3
      }
    : undefined
  if (rotation) rotation.origin[axisIndex] = MODEL_EXTENT - rotation.origin[axisIndex]

  return { ...el, from, to, faces, rotation }
}

/**
 * MC 坐标 → three.js 世界（16 单位 = 1 格，MC 8 为世界原点）。
 * 返回 mesh 的中心位置与缩放尺寸。
 */
export function elementToThree(el: CubeElement): { position: Vec3; size: Vec3 } {
  const c = elementCenter(el)
  const s = elementSize(el)
  return {
    position: [c[0] / 16 - 0.5, c[1] / 16 - 0.5, c[2] / 16 - 0.5],
    size: [s[0] / 16, s[1] / 16, s[2] / 16]
  }
}

/** three 世界坐标 → MC 坐标（用于拖动手柄回写） */
export function threeToMc(v: Vec3): Vec3 {
  return [(v[0] + 0.5) * 16, (v[1] + 0.5) * 16, (v[2] + 0.5) * 16]
}

/** 按 0.5 格吸附 MC 坐标（属性面板精调可绕过） */
export function snapHalf(n: number): number {
  return Math.round(n * 2) / 2
}

/** 判断旋转角是否为 22.5 的倍数（容差 1e-6） */
export function isLegalRotationAngle(angle: number): boolean {
  if (!Number.isFinite(angle)) return false
  if (Math.abs(angle) > ROTATION_MAX) return false
  return Math.abs(angle / ROTATION_STEP - Math.round(angle / ROTATION_STEP)) < 1e-6
}

/** 合法旋转轴类型守卫 */
export function isRotationAxis(v: unknown): v is RotationAxis {
  return v === 'x' || v === 'y' || v === 'z'
}
