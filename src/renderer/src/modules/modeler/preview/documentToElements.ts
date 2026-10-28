/**
 * ModelDocument → PreviewElement[] 适配：供 ModelPreview 按元素装配渲染新文档。
 *
 * 语义映射：
 * - 立方体（cube）：from/to/shade 直传；面绑定换算为 CubeFace { uv, texture:'all',
 *   rotation }；未绑贴图的已声明面 uv 直传（ModelPreview 以纯色/占位渲染）；
 * - 网格（mesh，v3 C4）：逐顶点几何 + 逐面 UV 直传（父空间坐标、像素 UV），
 *   origin/rotation 用于预览层的 T(o)·R·T(−o) 局部矩阵；
 * - 旋转：ModelDocument 支持三轴欧拉，旧 CubeElement 仅单轴——恰有一个非零轴时
 *   直传，多轴/零轴降级为不旋转（预览精度损失，导出适配层按格式能力另行裁决）；
 *   mesh 走完整三轴（模型预览层直接吃 Vec3 欧拉，无旧格式单轴约束）；
 * - 组与定位器不产生几何（预览层只装配可见几何）；
 * - 贴图引用统一折叠为单变量 'all'（ModelPreview 只持一张贴图）。
 * 纯函数：不依赖 Vue/DOM/three。
 */
import type { CubeElement, CubeFace, CubeFaceName, CubeRotation, RotationAxis } from '../../../../../shared/types/content'
import { FACE_NAMES, isMeshNode } from '../../../../../shared/modeler/types'
import type { MeshFace, MeshNode, ModelDocument, Vec3 } from '../../../../../shared/modeler/types'

/** 网格预览元素：逐顶点几何 + 逐面 UV（父空间），判别字段 kind 避免改动共享 CubeElement */
export interface MeshElement {
  kind: 'mesh'
  name: string
  /** 父空间顶点（文档 0..16 语义） */
  vertices: Vec3[]
  /** 逐面顶点索引 + 逐顶点 UV（像素坐标） */
  faces: MeshFace[]
  origin: Vec3
  rotation: Vec3
}

/** 预览元素：立方体（旧格式直传）或网格（v3 C4） */
export type PreviewElement = CubeElement | MeshElement

/** 判别：网格预览元素 */
export function isMeshElement(el: PreviewElement): el is MeshElement {
  return (el as MeshElement).kind === 'mesh'
}

/** 文档全部可见几何 → 预览元素装配列表（树序由 nodes 键序决定，预览不关心层级） */
export function documentToElements(doc: ModelDocument): PreviewElement[] {
  const out: PreviewElement[] = []
  for (const node of Object.values(doc.nodes)) {
    if (node.type === 'cube') out.push(cubeToElement(node))
    else if (isMeshNode(node)) out.push(meshToElement(node))
  }
  return out
}

/** 三轴欧拉 → 单轴旋转（恰好一个非零轴时有效；否则 undefined） */
function singleAxisRotation(rot: Vec3, origin: Vec3): CubeRotation | undefined {
  const axes: RotationAxis[] = ['x', 'y', 'z']
  const nonZero = axes.filter((_, i) => rot[i] !== 0)
  if (nonZero.length !== 1) return undefined
  return {
    origin: [origin[0], origin[1], origin[2]],
    axis: nonZero[0]!,
    angle: rot[axes.indexOf(nonZero[0]!)]
  }
}

/** 单个立方体 → CubeElement（faces 逐面换算，贴图统一 'all'） */
function cubeToElement(node: ModelDocument['nodes'][string] & { type: 'cube' }): CubeElement {
  const faces: Partial<Record<CubeFaceName, CubeFace>> = {}
  for (const face of FACE_NAMES) {
    const binding = node.faces[face]
    if (!binding) continue
    faces[face] = {
      uv: binding.uv ? [...binding.uv] : [0, 0, 16, 16],
      texture: 'all',
      ...(binding.rotation !== undefined ? { rotation: binding.rotation } : {})
    }
  }
  return {
    name: node.name,
    from: [...node.from],
    to: [...node.to],
    ...(node.rotation.some((r) => r !== 0)
      ? { rotation: singleAxisRotation(node.rotation, node.origin) }
      : {}),
    ...(node.shade === false ? { shade: false } : { shade: true }),
    faces
  }
}

/** 单个网格 → MeshElement（几何与 UV 直传；空 UV 面在装配层回退到按槽位展开） */
function meshToElement(node: MeshNode): MeshElement {
  return {
    kind: 'mesh',
    name: node.name,
    vertices: node.vertices.map((v) => [...v] as Vec3),
    faces: node.faces.map((f) => ({
      vertices: [...f.vertices],
      uv: f.uv.map((c) => [...c] as [number, number]),
      ...(f.texture !== undefined ? { texture: f.texture } : {})
    })),
    origin: [...node.origin] as Vec3,
    rotation: [...node.rotation] as Vec3
  }
}
