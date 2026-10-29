/**
 * 场景节点构建纯逻辑（自 ModelerViewport.vue 抽离，行为保持逐字一致）：
 * 文档节点 → three 对象树。层级语义（父链连续空间）：
 * 组 = outer(pos=origin/16, rot, scale) > inner(pos=−origin/16) > 子节点(原始坐标/16)；
 * cube = outer(pos=origin/16, rot) > mesh(单位盒 scale=尺寸/16, pos=(center−origin)/16)；
 * mesh 节点按贴图分组逐三角写顶点（非索引化，computeVertexNormals 得平直法线）。
 * 共享几何/材质与 nodeObjects/pickMeshes/disposables 收集器由宿主注入，
 * 本模块不持有 Vue 响应式状态。
 */
import * as THREE from 'three'
import type { MeshNode, ModelDocument, ModelNode, NodeId, TextureId, Vec2, Vec3 } from '../../../../../shared/modeler/types'
import { isCubeNode, isGroupNode, isLocatorNode, isMeshNode } from '../../../../../shared/modeler/types'
import { triangulateFace } from '../../../../../shared/modeler/mesh'
import { effectiveFaceBindings, rotateUvCorners } from '../../../../../shared/modeler/uv'
import { BOX_FACE_BY_INDEX } from './paintTools'
import { ensureTextureEntry, textureMaterial, type TexCacheCtx } from './textureCache'

const DEG2RAD = Math.PI / 180

/** 节点构建依赖的宿主上下文（共享几何/材质与收集器由宿主注入；每轮重建新建快照） */
export interface NodeBuildCtx {
  nodeObjects: Map<NodeId, THREE.Object3D>
  pickMeshes: THREE.Mesh[]
  disposables: Array<THREE.BufferGeometry | THREE.Material>
  boxGeo: THREE.BoxGeometry
  markerGeo: THREE.OctahedronGeometry
  cubeMat: THREE.MeshLambertMaterial
  markerMat: THREE.MeshBasicMaterial
  tex: TexCacheCtx
}

/** 文档节点 → 场景对象（含父子层级映射，见模块头注释） */
export function buildNodeObject(ctx: NodeBuildCtx, d: ModelDocument, node: ModelNode): THREE.Object3D {
  const outer = new THREE.Group()
  outer.userData.nodeId = node.id
  outer.visible = node.visible
  ctx.nodeObjects.set(node.id, outer)

  if (isCubeNode(node)) {
    outer.position.set(node.origin[0] / 16, node.origin[1] / 16, node.origin[2] / 16)
    outer.rotation.set(
      node.rotation[0] * DEG2RAD,
      node.rotation[1] * DEG2RAD,
      node.rotation[2] * DEG2RAD
    )
    const mesh = buildCubeMesh(ctx, d, node)
    ctx.pickMeshes.push(mesh)
    outer.add(mesh)
  } else if (isMeshNode(node)) {
    outer.position.set(node.origin[0] / 16, node.origin[1] / 16, node.origin[2] / 16)
    outer.rotation.set(
      node.rotation[0] * DEG2RAD,
      node.rotation[1] * DEG2RAD,
      node.rotation[2] * DEG2RAD
    )
    for (const m of buildMeshMeshes(ctx, d, node)) {
      ctx.pickMeshes.push(m)
      outer.add(m)
    }
  } else if (isGroupNode(node)) {
    outer.position.set(node.origin[0] / 16, node.origin[1] / 16, node.origin[2] / 16)
    outer.rotation.set(
      node.rotation[0] * DEG2RAD,
      node.rotation[1] * DEG2RAD,
      node.rotation[2] * DEG2RAD
    )
    if (node.scale) outer.scale.set(node.scale[0], node.scale[1], node.scale[2])
    // inner 承担 T(−origin)，使子节点原始坐标直接映射（父链连续空间语义）
    const inner = new THREE.Group()
    inner.position.set(-node.origin[0] / 16, -node.origin[1] / 16, -node.origin[2] / 16)
    outer.add(inner)
    for (const cid of node.children) {
      const child = d.nodes[cid]
      if (child) inner.add(buildNodeObject(ctx, d, child))
    }
  } else if (isLocatorNode(node)) {
    outer.position.set(node.position[0] / 16, node.position[1] / 16, node.position[2] / 16)
    const marker = new THREE.Mesh(ctx.markerGeo, ctx.markerMat)
    marker.userData.nodeId = node.id
    ctx.pickMeshes.push(marker)
    outer.add(marker)
  }
  return outer
}

/**
 * 立方体 mesh：任一面绑定贴图 → per-cube 克隆 BoxGeometry 写 UV + 贴图材质数组；
 * 否则共享灰盒。UV 映射：面序 [+x,-x,+y,-y,+z,-z] = east/west/up/down/south/north；
 * rotateUvCorners 返回 [TL,TR,BR,BL] 像素坐标 → 面内顶点序 [TL,TR,BL,BR] 用 0,1,3,2 重排。
 */
export function buildCubeMesh(ctx: NodeBuildCtx, d: ModelDocument, node: ModelNode & { type: 'cube' }): THREE.Mesh {
  const cx = (node.from[0] + node.to[0]) / 2
  const cy = (node.from[1] + node.to[1]) / 2
  const cz = (node.from[2] + node.to[2]) / 2
  const position: Vec3 = [
    (cx - node.origin[0]) / 16,
    (cy - node.origin[1]) / 16,
    (cz - node.origin[2]) / 16
  ]
  const scale: Vec3 = [
    Math.abs(node.to[0] - node.from[0]) / 16,
    Math.abs(node.to[1] - node.from[1]) / 16,
    Math.abs(node.to[2] - node.from[2]) / 16
  ]

  const resolved = effectiveFaceBindings(node, d.settings.uvMode)
  const usedTexIds = new Set<TextureId>()
  for (const b of Object.values(resolved)) {
    if (b?.texture && d.textures[b.texture]) usedTexIds.add(b.texture)
  }

  if (usedTexIds.size === 0) {
    const mesh = new THREE.Mesh(ctx.boxGeo, ctx.cubeMat)
    mesh.position.set(position[0], position[1], position[2])
    mesh.scale.set(scale[0], scale[1], scale[2])
    mesh.userData.nodeId = node.id
    return mesh
  }

  const geo = ctx.boxGeo.clone()
  const uvAttr = geo.attributes.uv as THREE.BufferAttribute
  const faceMats: THREE.Material[] = []
  for (let fi = 0; fi < 6; fi++) {
    const faceName = BOX_FACE_BY_INDEX[fi]!
    const binding = resolved[faceName]
    const texId = binding?.texture && d.textures[binding.texture] ? binding.texture : null
    const texMeta = texId ? d.textures[texId] : undefined
    let corners: Vec2[] = [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0]
    ]
    if (texMeta && binding?.uv) {
      ensureTextureEntry(ctx.tex, texMeta)
      corners = rotateUvCorners(binding.uv, binding.rotation ?? 0)
    }
    // corners = [TL, TR, BR, BL]（像素坐标，v 向下）；BoxGeometry 面内顶点序 [TL, TR, BL, BR]
    const order = [0, 1, 3, 2]
    for (let vi = 0; vi < 4; vi++) {
      const p = corners[order[vi]!]!
      uvAttr.setXY(fi * 4 + vi, texMeta ? p[0] / texMeta.width : 0, texMeta ? 1 - p[1] / texMeta.height : 0)
    }
    faceMats.push((texId ? textureMaterial(ctx.tex, texId) : null) ?? ctx.cubeMat)
  }
  uvAttr.needsUpdate = true

  const mesh = new THREE.Mesh(geo, faceMats)
  mesh.position.set(position[0], position[1], position[2])
  mesh.scale.set(scale[0], scale[1], scale[2])
  mesh.userData.nodeId = node.id
  ctx.disposables.push(geo)
  return mesh
}

/**
 * 网格节点 → 场景 mesh 列表（B4-1）：按贴图分组，每组一个 BufferGeometry
 * （非索引化逐三角写顶点，computeVertexNormals 得平直法线）。
 * 顶点以「相对 origin 的父空间坐标 /16」存储——外层 Group 已承载 origin/rotation，
 * 与立方体 mesh 的「单位盒 scale + 相对 origin 偏移」同构。
 * userData.triToFace（B4-3）：三角序号 → node.faces 面下标（面模式 raycast 回映射用）。
 */
export function buildMeshMeshes(ctx: NodeBuildCtx, d: ModelDocument, node: MeshNode): THREE.Mesh[] {
  // 按贴图分组面下标（null = 无贴图灰面）
  const groups = new Map<TextureId | null, number[]>()
  node.faces.forEach((face, fi) => {
    const texId = face.texture && d.textures[face.texture] ? face.texture : null
    const list = groups.get(texId) ?? []
    list.push(fi)
    groups.set(texId, list)
  })

  const out: THREE.Mesh[] = []
  for (const [texId, faceIdxList] of groups) {
    const texMeta = texId ? d.textures[texId] : undefined
    if (texMeta) ensureTextureEntry(ctx.tex, texMeta)
    const positions: number[] = []
    const uvs: number[] = []
    const triToFace: number[] = []
    for (const fi of faceIdxList) {
      const face = node.faces[fi]!
      for (const tri of triangulateFace(face)) {
        triToFace.push(fi)
        for (const slot of tri) {
          const vi = face.vertices[slot]!
          const v = node.vertices[vi]
          if (!v) continue // 越界下标由文档校验报告，渲染层静默跳过
          positions.push(
            (v[0] - node.origin[0]) / 16,
            (v[1] - node.origin[1]) / 16,
            (v[2] - node.origin[2]) / 16
          )
          const uv = face.uv[slot]
          if (texMeta && uv) {
            uvs.push(uv[0] / texMeta.width, 1 - uv[1] / texMeta.height)
          } else {
            uvs.push(0, 0)
          }
        }
      }
    }
    if (positions.length === 0) continue
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.computeVertexNormals()
    const mat = (texId ? textureMaterial(ctx.tex, texId) : null) ?? ctx.cubeMat
    const mesh = new THREE.Mesh(geo, mat)
    mesh.userData.nodeId = node.id
    mesh.userData.triToFace = triToFace
    ctx.disposables.push(geo)
    out.push(mesh)
  }
  return out
}
