/**
 * Cube 元素集合编辑纯函数（M12）。
 *
 * 所有函数不可变更新：返回新 elements 数组/元素对象，
 * 供 Vue 响应式替换与单测直接断言；几何越界统一经 clampElement 收尾。
 */
import type { CubeElement, CubeFace, CubeFaceName } from '../types/content'
import { CUBE_FACES } from '../types/content'
import { autoFaceUv, boxUvLayout, clampElement, mirrorElement, type Vec3 } from './modelMath'

/** 几何补丁（视口手柄回写与属性面板共用） */
export interface ElementGeometryPatch {
  from?: Vec3
  to?: Vec3
  rotation?: CubeElement['rotation']
}

/** 新建一个居中的 4³ 小立方体（六面齐全，绑定 all 贴图变量） */
export function createSmallCube(name: string): CubeElement {
  const faces = {} as Partial<Record<CubeFaceName, CubeFace>>
  for (const face of CUBE_FACES) {
    faces[face] = { uv: [0, 0, 4, 4], texture: 'all' }
  }
  return { name, from: [6, 6, 6], to: [10, 10, 10], shade: true, faces }
}

/** 深拷贝立方体（faces 逐面复制，避免共享引用） */
export function cloneElement(el: CubeElement): CubeElement {
  const faces = {} as Partial<Record<CubeFaceName, CubeFace>>
  for (const face of CUBE_FACES) {
    const f = el.faces[face]
    if (f) faces[face] = { ...f, uv: [...f.uv] as CubeFace['uv'] }
  }
  return {
    ...el,
    from: [...el.from] as Vec3,
    to: [...el.to] as Vec3,
    rotation: el.rotation
      ? { ...el.rotation, origin: [...el.rotation.origin] as Vec3 }
      : undefined,
    faces
  }
}

/**
 * 相对参考立方体偏移复制：依次尝试 +x/-x/+z/-z/+y/-y 1 单位，
 * 选择第一个不越界的方向；都越界则原地复制。
 */
export function duplicateElement(elements: CubeElement[], index: number): {
  elements: CubeElement[]
  index: number
} {
  const src = elements[index]
  if (!src) return { elements, index: -1 }
  const offsets: Vec3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, 1, 0],
    [0, -1, 0]
  ]
  let next: CubeElement | null = null
  for (const [ox, oy, oz] of offsets) {
    const candidate = cloneElement(src)
    candidate.name = `${src.name || '立方体'}-副本`
    candidate.from = [src.from[0] + ox, src.from[1] + oy, src.from[2] + oz]
    candidate.to = [src.to[0] + ox, src.to[1] + oy, src.to[2] + oz]
    const ok = candidate.from.every((v) => v >= 0) && candidate.to.every((v) => v <= 16)
    if (ok) {
      next = candidate
      break
    }
  }
  // 所有方向都越界：原地复制并夹取到边界内
  if (!next) next = clampElement({ ...cloneElement(src), name: `${src.name || '立方体'}-副本` })
  const out = [...elements, next]
  return { elements: out, index: out.length - 1 }
}

/** 追加新立方体：有选中参考时按偏移复制，否则插入居中 4³ */
export function addElement(elements: CubeElement[], selectedIndex: number | null): {
  elements: CubeElement[]
  index: number
} {
  if (selectedIndex !== null && elements[selectedIndex]) {
    const r = duplicateElement(elements, selectedIndex)
    if (r.index >= 0) {
      r.elements[r.index] = { ...r.elements[r.index]!, name: `立方体 ${elements.length + 1}` }
      return r
    }
  }
  const el = createSmallCube(`立方体 ${elements.length + 1}`)
  const out = [...elements, el]
  return { elements: out, index: out.length - 1 }
}

/** 删除立方体（至少保留 1 个；返回新数组，仅 1 个时原样返回） */
export function removeElementAt(elements: CubeElement[], index: number): CubeElement[] {
  if (index < 0 || index >= elements.length || elements.length <= 1) return elements
  return elements.filter((_, i) => i !== index)
}

/** 重命名立方体 */
export function renameElement(elements: CubeElement[], index: number, name: string): CubeElement[] {
  if (!elements[index]) return elements
  const out = elements.slice()
  out[index] = { ...out[index]!, name }
  return out
}

/** 提交几何补丁（from/to/rotation），统一夹取；rotation 为 undefined 时移除旋转 */
export function commitElement(
  elements: CubeElement[],
  index: number,
  patch: ElementGeometryPatch
): CubeElement[] {
  const src = elements[index]
  if (!src) return elements
  const merged: CubeElement = {
    ...src,
    from: patch.from ?? src.from,
    to: patch.to ?? src.to,
    rotation: patch.rotation
  }
  const clamped = clampElement(merged)
  if (patch.rotation === undefined) delete clamped.rotation
  const out = elements.slice()
  out[index] = clamped
  return out
}

/** 切换面启用/剔除；开启时按面尺寸自动 UV，贴图变量沿用同体首面，缺省 all */
export function toggleFace(
  elements: CubeElement[],
  index: number,
  face: CubeFaceName
): CubeElement[] {
  const el = elements[index]
  if (!el) return elements
  const faces = { ...el.faces }
  if (faces[face]) {
    delete faces[face]
  } else {
    const firstVar = CUBE_FACES.map((f) => el.faces[f]?.texture).find((t) => !!t) ?? 'all'
    const probe: CubeElement = { ...el, faces }
    faces[face] = { uv: autoFaceUv(probe, face), texture: firstVar }
  }
  const out = elements.slice()
  out[index] = { ...el, faces }
  return out
}

/** 更新单面字段（uv/texture/rotation） */
export function updateFace(
  elements: CubeElement[],
  index: number,
  face: CubeFaceName,
  partial: Partial<Omit<CubeFace, 'uv'>> & { uv?: CubeFace['uv'] }
): CubeElement[] {
  const el = elements[index]
  const current = el?.faces[face]
  if (!el || !current) return elements
  const faces = { ...el.faces, [face]: { ...current, ...partial } }
  const out = elements.slice()
  out[index] = { ...el, faces }
  return out
}

/** 单立方体指定面重算自动 UV（面须存在） */
export function autoUvFace(
  elements: CubeElement[],
  index: number,
  face: CubeFaceName
): CubeElement[] {
  const el = elements[index]
  if (!el || !el.faces[face]) return elements
  const out = elements.slice()
  out[index] = {
    ...el,
    faces: { ...el.faces, [face]: { ...el.faces[face]!, uv: autoFaceUv(el, face) } }
  }
  return out
}

/** 单立方体全部存在面重算自动 UV */
export function autoUvOne(elements: CubeElement[], index: number): CubeElement[] {
  const el = elements[index]
  if (!el) return elements
  const out = elements.slice()
  const faces = { ...el.faces }
  for (const face of CUBE_FACES) {
    if (!faces[face]) continue
    faces[face] = { ...faces[face]!, uv: autoFaceUv(el, face) }
  }
  out[index] = { ...el, faces }
  return out
}

/** 全部立方体 box-uv 十字展开（仅更新存在的面） */
export function autoUvAllBox(elements: CubeElement[], textureSize: number): CubeElement[] {
  const layout = boxUvLayout(elements, textureSize)
  return elements.map((el, i) => {
    const item = layout[i]!
    const faces = { ...el.faces }
    for (const face of CUBE_FACES) {
      const uv = item.faces[face]
      if (uv && faces[face]) faces[face] = { ...faces[face]!, uv }
    }
    return { ...el, faces }
  })
}

/** 镜像指定立方体 */
export function mirrorAt(
  elements: CubeElement[],
  index: number,
  axis: 'x' | 'z'
): CubeElement[] {
  if (!elements[index]) return elements
  const out = elements.slice()
  out[index] = mirrorElement(out[index]!, axis)
  return out
}

/** 设置 shade（环境光遮蔽明暗） */
export function setElementShade(
  elements: CubeElement[],
  index: number,
  shade: boolean
): CubeElement[] {
  if (!elements[index]) return elements
  const out = elements.slice()
  out[index] = { ...out[index]!, shade }
  return out
}
