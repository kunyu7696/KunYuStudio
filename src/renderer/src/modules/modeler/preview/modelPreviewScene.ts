/**
 * ModelPreview 场景纯函数层：只读预览的几何装配 / UV 映射 / 相机取景。
 *
 * 与旧 useCubeScene 的区别：纯只读（无变换手柄/绘画/雕刻），供统一编辑器右栏、
 * 贴图弹窗与画廊 3D 预览共用；输入为旧 ModelAsset / EmbeddedCubeModel 的
 * CubeElement[] + 单张贴图（MVP 仅 all 变量）。
 *
 * 几何约定（Minecraft 公开模型格式）：
 * - 模型空间 0..16（16 单位 = 1 格），three 世界中心为原点；
 * - 每元素 6 面独立 UV/剔面（BoxGeometry 材质组 px,nx,py,ny,pz,nz）；
 * - 元素旋转：单轴、绕 origin；UV 原点左上（v 向下），three 左下，按极值重映射；
 * - 面内 rotation 为贴图顺时针旋转角（0/90/180/270，BlockFaceUV 语义）。
 * 纯函数不触发 WebGL，可在 node/jsdom 单测。
 */
import * as THREE from 'three'
import type { CubeElement, CubeFaceName } from '../../../../../shared/types/content'
import { isMeshElement } from './documentToElements'
import type { MeshElement, PreviewElement } from './documentToElements'

/** BoxGeometry 材质组索引（px,nx,py,ny,pz,nz）→ MC 面名 */
export const BOX_GROUP_FACES: readonly CubeFaceName[] = ['east', 'west', 'up', 'down', 'south', 'north']

/**
 * 面内 rotation 角点置换表（rotation=0/90/180/270）。
 * BoxGeometry 每面顶点序恒为 0 左上、1 右上、2 左下、3 右下；
 * rotation 为从面外看顺时针，目标顶点 i 取基准角置换表的第 i 项。
 */
export const FACE_ROTATION_PERM: readonly number[][] = [
  [0, 1, 2, 3], //   0°：恒等
  [2, 0, 3, 1], //  90°：TL←BL, TR←TL, BL←BR, BR←TR
  [3, 2, 1, 0], // 180°：TL↔BR, TR↔BL
  [1, 3, 0, 2] //  270°：TL←TR, TR←BR, BL←TL, BR←BL
]

/** MC 坐标（0..16）→ three（中心原点，16 单位 = 1 格） */
export function mcToThree(v: number): number {
  return v / 16 - 0.5
}

function elementCenter(el: CubeElement): [number, number, number] {
  return [
    (el.from[0] + el.to[0]) / 2,
    (el.from[1] + el.to[1]) / 2,
    (el.from[2] + el.to[2]) / 2
  ]
}

function elementSize(el: CubeElement): [number, number, number] {
  return [
    Math.abs(el.to[0] - el.from[0]),
    Math.abs(el.to[1] - el.from[1]),
    Math.abs(el.to[2] - el.from[2])
  ]
}

/**
 * 按 face.uv 设置 BoxGeometry 某材质组的 UV。
 * MC UV 原点左上（v 向下），three 左下（v 向上），按原 UV 极值重映射。
 */
export function applyFaceUvs(
  geometry: THREE.BoxGeometry,
  faces: CubeElement['faces'],
  textureSize: number
): void {
  const uvAttr = geometry.attributes.uv as THREE.BufferAttribute
  for (let groupIndex = 0; groupIndex < BOX_GROUP_FACES.length; groupIndex++) {
    const faceName = BOX_GROUP_FACES[groupIndex]!
    const face = faces[faceName]
    if (!face) continue
    const [u1, v1, u2, v2] = face.uv
    const start = groupIndex * 4

    // 基准四角 UV：借 BoxGeometry 默认 0/1 UV 选角（顶点序 0 左上、1 右上、2 左下、3 右下）
    const corners: Array<[number, number]> = []
    for (let i = 0; i < 4; i++) {
      const ux = uvAttr.getX(start + i) // 0 或 1
      const vy = uvAttr.getY(start + i) // 0 或 1
      corners.push([
        (ux === 0 ? u1 : u2) / textureSize,
        1 - (vy === 0 ? v2 : v1) / textureSize
      ])
    }

    // 面内 rotation：仅在单面 UV 矩形内重排四角，不动几何
    const perm = FACE_ROTATION_PERM[(face.rotation ?? 0) / 90]!
    for (let i = 0; i < 4; i++) {
      uvAttr.setXY(start + i, corners[perm[i]!]![0], corners[perm[i]!]![1])
    }
  }
  uvAttr.needsUpdate = true
}

/** 剔除面材质：不写颜色/深度，视觉等同该面不存在 */
export function makeCulledMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false
  })
}

/** 面材质：只剔除近零 alpha（保证全透明像素不写深度），其余按 alpha 混合渲染 */
export function makeFaceMaterial(texture: THREE.Texture | null): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    map: texture ?? null,
    transparent: true,
    alphaTest: 0.02,
    side: THREE.FrontSide
  })
}

/**
 * 把元素数组装配为 THREE.Group 层级：
 * root └ pivot[i]（位置=旋转原点或几何中心，带单轴旋转）└ mesh（单位盒 scale=尺寸/16）
 */
export function buildCubeGroup(
  elements: CubeElement[],
  texture: THREE.Texture | null = null,
  textureSize = 16
): THREE.Group {
  const root = new THREE.Group()
  root.name = 'model-preview-root'
  elements.forEach((el, index) => addCubeElement(root, el, index, texture, textureSize))
  return root
}

/**
 * 预览元素数组（立方体 + 网格，v3 C4）装配为 Group。
 * 两类元素共用 pivot>mesh 结构与 elementIndex 标记（高亮/释放逻辑不区分类型）。
 */
export function buildPreviewGroup(
  elements: PreviewElement[],
  texture: THREE.Texture | null = null,
  textureSize = 16
): THREE.Group {
  const root = new THREE.Group()
  root.name = 'model-preview-root'
  elements.forEach((el, index) => {
    if (isMeshElement(el)) addMeshElement(root, el, index, texture, textureSize)
    else addCubeElement(root, el, index, texture, textureSize)
  })
  return root
}

function addCubeElement(
  root: THREE.Group,
  el: CubeElement,
  index: number,
  texture: THREE.Texture | null,
  textureSize: number
): void {
  const geo = new THREE.BoxGeometry(1, 1, 1)
  applyFaceUvs(geo, el.faces, textureSize)
  const materials = BOX_GROUP_FACES.map((faceName) =>
    el.faces[faceName] ? makeFaceMaterial(texture) : makeCulledMaterial()
  )
  const mesh = new THREE.Mesh(geo, materials)
  mesh.name = `preview-mesh:${index}`
  mesh.userData.elementIndex = index

  const pivot = new THREE.Group()
  pivot.name = `preview-pivot:${index}`
  pivot.userData.elementIndex = index

  const center = elementCenter(el)
  const size = elementSize(el)
  const degToRad = (deg: number): number => (deg * Math.PI) / 180
  if (el.rotation) {
    pivot.position.set(
      mcToThree(el.rotation.origin[0]),
      mcToThree(el.rotation.origin[1]),
      mcToThree(el.rotation.origin[2])
    )
    mesh.position.set(
      (center[0] - el.rotation.origin[0]) / 16,
      (center[1] - el.rotation.origin[1]) / 16,
      (center[2] - el.rotation.origin[2]) / 16
    )
    const rad = degToRad(el.rotation.angle)
    if (el.rotation.axis === 'x') pivot.rotation.x = rad
    else if (el.rotation.axis === 'y') pivot.rotation.y = rad
    else pivot.rotation.z = rad
  } else {
    pivot.position.set(mcToThree(center[0]), mcToThree(center[1]), mcToThree(center[2]))
  }
  mesh.scale.set(size[0] / 16, size[1] / 16, size[2] / 16)

  pivot.add(mesh)
  root.add(pivot)
}

/**
 * 网格元素装配（v3 C4）：非索引化三角汤（与视口/glTF 导出同策略），
 * pivot = T(origin) + 三轴欧拉 XYZ（与文档 eulerMatrix 的 Rx·Ry·Rz 一致），
 * mesh 局部坐标 = 顶点/16 − origin/16，故无旋转时世界坐标 = 顶点/16 − 0.5；
 * UV = (u/贴图宽, 1 − v/贴图高)（glTF/preview 同为左下原点，与 applyFaceUvs 一致）。
 * 面 UV 槽位与顶点不齐（或为空）时按槽位在 0..16 对角线展开兜底，保证形体可辨。
 */
function addMeshElement(
  root: THREE.Group,
  el: MeshElement,
  index: number,
  texture: THREE.Texture | null,
  textureSize: number
): void {
  const positions: number[] = []
  const uvs: number[] = []
  const n = el.vertices.length
  const cornerUv = (face: MeshElement['faces'][number], slot: number): [number, number] => {
    const aligned = face.uv.length === face.vertices.length
    if (aligned) {
      const c = face.uv[slot]
      if (c) return [c[0] / textureSize, 1 - c[1] / textureSize]
    }
    const t = face.vertices.length > 1 ? slot / (face.vertices.length - 1) : 0
    return [t, 1 - t]
  }
  for (const face of el.faces) {
    const vids = face.vertices.filter((vi) => vi >= 0 && vi < n)
    if (vids.length < 3) continue
    // 扇形三角化（与 mesh.ts triangulateFace 同策略：首顶点起扇）
    for (let t = 1; t + 1 < vids.length; t++) {
      for (const slot of [0, t, t + 1]) {
        const v = el.vertices[vids[slot]!]!
        positions.push(v[0] / 16, v[1] / 16, v[2] / 16)
        const uv = cornerUv(face, slot)
        uvs.push(uv[0], uv[1])
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.computeVertexNormals()
  // 顶点在父空间（已含绝对位置），故 mesh 局部需减去 origin
  geo.translate(-el.origin[0] / 16, -el.origin[1] / 16, -el.origin[2] / 16)

  const mesh = new THREE.Mesh(geo, makeFaceMaterial(texture))
  mesh.name = `preview-mesh:${index}`
  mesh.userData.elementIndex = index

  const pivot = new THREE.Group()
  pivot.name = `preview-pivot:${index}`
  pivot.userData.elementIndex = index
  pivot.position.set(mcToThree(el.origin[0]), mcToThree(el.origin[1]), mcToThree(el.origin[2]))
  const degToRad = (deg: number): number => (deg * Math.PI) / 180
  pivot.rotation.set(degToRad(el.rotation[0]), degToRad(el.rotation[1]), degToRad(el.rotation[2]))

  pivot.add(mesh)
  root.add(pivot)
}

/** 释放 group 内所有 geometry/material（共享贴图由调用方管理） */
export function disposeCubeGroup(group: THREE.Group | null): void {
  if (!group) return
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose()
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) m?.dispose()
    }
  })
  group.parent?.remove(group)
}

/** Group 世界包围盒（含旋转变换）；空 group 返回 null */
export function groupBounds(group: THREE.Group): THREE.Box3 | null {
  group.updateMatrixWorld(true)
  const box = new THREE.Box3()
  let has = false
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      box.expandByObject(obj)
      has = true
    }
  })
  return has ? box : null
}

/** 相机取景参数：目标点与建议距离（包围球完全入视，留 12% 余量） */
export function fitView(box: THREE.Box3, fovDeg: number): { target: THREE.Vector3; distance: number } {
  const target = box.isEmpty()
    ? new THREE.Vector3(0, 0, 0)
    : box.getCenter(new THREE.Vector3())
  const radius = box.isEmpty() ? 0.9 : Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-3)
  const fovRad = (fovDeg * Math.PI) / 180
  const distance = (radius / Math.sin(fovRad / 2)) * 1.12
  return { target, distance }
}
