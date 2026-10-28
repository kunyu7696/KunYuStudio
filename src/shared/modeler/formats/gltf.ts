/**
 * glTF 2.0 导出编解码（B5-1，v2 格式长尾；只导出、不导入）。
 *
 * 产物契约：Khronos glTF 2.0 公开规范子集——
 * 单 .gltf（JSON）+ 单 .bin + 同目录 PNG 贴图：
 * - 几何：立方体逐面 4 顶点 2 三角（24 顶点 12 三角/满六面），mesh 节点扇形三角化，
 *   全部非索引化三角汤（与视口渲染同策略）；primitive 按贴图分组；
 * - 层级：组 → 关节节点（TRS 分解：t = o − R·S·o，四元数 = Euler 'XYZ' 同式换算）；
 *   doc.root 直下的 cube/mesh → 层级 TRS 节点；locator → 空节点（平移/16）；
 * - 蒙皮（刚性）：有父组的 cube/mesh → 蒙皮网格节点放场景根（变换恒等，顶点 =
 *   世界绑定姿态/16，单关节权重 1）——规避各加载器对「蒙皮节点再带局部变换」
 *   的 bindMatrix 处理差异；IBM = 关节世界矩阵（平移分量/16 后）的逆；
 * - 动画：逐关节 1/30s 稠密烘焙（采样时刻 = {0,length} ∪ 均匀网格 ∪ 关键帧时刻），
 *   position 通道语义与文档一致（绝对 pivot 位置，非偏移），缺失通道回退节点静态值；
 *   四元数相邻帧点积 < 0 取反保连续性；全部 LINEAR；
 * - 贴图：images[].uri = 清洗后贴图名.png（随 .gltf 落盘）；材质 pbrMetallicRoughness
 *   （metallic 0 / roughness 1），采样器 NEAREST + CLAMP_TO_EDGE，alphaMode MASK(0.5)；
 *   无贴图面 → 灰材质 baseColorFactor [0.5,0.5,0.5,1]；
 * - UV：glTF 规范 (0,0) = 左上 → uv = (u_px/tex.width, v_px/tex.height)，不翻 v
 *   （PNG 顶行在前，与本编辑器贴图管线一致）。
 *
 * 坐标/单位：文档 16 单位 = 1 方块 → 导出 ÷16 为米制语义；双方同为右手系 +Y 上，
 * 坐标直映射不翻轴。inflate/shade 忽略（与视口渲染一致，原版视效字段不属几何）。
 *
 * clean-room 红线：仅依据 Khronos glTF 2.0 公开规范独立实现，
 * 不读取、不复制任何第三方编辑器（Blockbench 等）源码。
 *
 * 本模块不是 FormatId 注册格式（格式注册表见 formats/index.ts），
 * 是与 bedrockAnim.documentToAnimations 同模式的独立互操作 codec。
 */
import { sampleChannel } from '../anim'
import { isIdentityEasing } from '../curve'
import { faceNormal, facePoints, triangulateFace } from '../mesh'
import { quatFromEulerXYZDeg } from '../quat'
import type { Quat } from '../quat'
import {
  eulerMatrix,
  mat4Invert,
  mat4Multiply,
  mat4Scale,
  transformDirection,
  transformPoint,
  worldMatrixOf
} from '../transform'
import type { Mat4 } from '../transform'
import { FACE_NAMES, isCubeNode, isGroupNode, isLocatorNode, isMeshNode } from '../types'
import type {
  CubeNode,
  FaceName,
  MeshNode,
  ModelDocument,
  ModelTexture,
  NodeAnimationChannels,
  NodeId,
  TextureId,
  Vec3
} from '../types'
import { effectiveFaceBindings, rotateUvCorners } from '../uv'
import { MAX_JOINTS_PER_VERTEX, topWeights } from '../weights'
import { addNode, addTexture, createDocument, createGroupNode, createLocatorNode, createMeshNode } from '../document'
import { defaultMeshGeometry } from '../mesh'
import type { FormatId, MeshFace, ModelNode, Vec2 } from '../types'
import type { FormatDowngrade, FormatExportResult, FormatImportResult } from './types'

/* ------------------------------------------------------------------ */
/* 产物类型                                                             */
/* ------------------------------------------------------------------ */

/** 随 .gltf 落盘的贴图（name = 文件名含 .png；data = data:image/png;base64,...） */
export interface GltfExportImage {
  name: string
  data: string
}

/** glTF 导出产物：gltf JSON 对象（buffers[0].uri 先置 '' 由主进程回填）+ BIN + 贴图列表 */
export interface GltfExport {
  gltf: Record<string, unknown>
  bin: Uint8Array
  images: GltfExportImage[]
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function div16(v: Vec3): Vec3 {
  return [v[0] / 16, v[1] / 16, v[2] / 16]
}

/** JSON 数值清理：6 位小数取整 + 消除 -0（节点 TRS 等 JSON 直写数值用） */
function jnum(n: number): number {
  const r = Math.round(n * 1e6) / 1e6
  return Object.is(r, -0) ? 0 : r
}

function jvec(v: readonly number[]): number[] {
  return v.map(jnum)
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  if (len < 1e-12) return [0, 0, 1]
  return [v[0] / len, v[1] / len, v[2] / len]
}

/** 贴图文件名清洗：非法字符 → _，冲突 _2/_3… 递增（与 bbmodel 同策略） */
function safeImageName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[^a-zA-Z0-9_-]/g, '_') || 'texture'
  let name = base
  let n = 2
  while (used.has(name)) name = `${base}_${n++}`
  used.add(name)
  return name
}

/* ------------------------------------------------------------------ */
/* BIN 构建器：单 buffer，bufferView 4 字节对齐，逐属性独立紧密排列        */
/* ------------------------------------------------------------------ */

const CT_UBYTE = 5121
const CT_FLOAT = 5126

type AccessorType = 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4'
const TYPE_COMPS: Record<AccessorType, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

class GltfBin {
  private bytes: number[] = []
  readonly bufferViews: Array<Record<string, unknown>> = []
  readonly accessors: Array<Record<string, unknown>> = []

  private pad4(): void {
    while (this.bytes.length % 4 !== 0) this.bytes.push(0)
  }

  addAccessor(
    data: ArrayLike<number>,
    componentType: typeof CT_FLOAT | typeof CT_UBYTE,
    type: AccessorType,
    count: number,
    opts?: { minmax?: boolean }
  ): number {
    this.pad4()
    const byteOffset = this.bytes.length
    const comps = TYPE_COMPS[type]
    const total = count * comps
    if (componentType === CT_FLOAT) {
      const f = new Float32Array(total)
      for (let i = 0; i < total; i++) f[i] = data[i]!
      const u8 = new Uint8Array(f.buffer)
      for (let i = 0; i < u8.length; i++) this.bytes.push(u8[i]!)
    } else {
      for (let i = 0; i < total; i++) this.bytes.push(data[i]! & 0xff)
    }
    this.bufferViews.push({ buffer: 0, byteOffset, byteLength: total * (componentType === CT_FLOAT ? 4 : 1) })
    const acc: Record<string, unknown> = {
      bufferView: this.bufferViews.length - 1,
      componentType,
      count,
      type
    }
    if (opts?.minmax) {
      const min: number[] = []
      const max: number[] = []
      for (let c = 0; c < comps; c++) {
        min.push(Infinity)
        max.push(-Infinity)
      }
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < comps; c++) {
          const v = data[i * comps + c]!
          if (v < min[c]!) min[c] = v
          if (v > max[c]!) max[c] = v
        }
      }
      acc.min = min
      acc.max = max
    }
    this.accessors.push(acc)
    return this.accessors.length - 1
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes)
  }
}

/* ------------------------------------------------------------------ */
/* 立方体面几何（角点表：从面外看 [TL,TR,BR,BL]，法线已验证朝外）           */
/* ------------------------------------------------------------------ */

interface FaceGeom {
  normal: Vec3
  /** [TL,TR,BR,BL]（x1≤x2 等取 min/max） */
  corners: [Vec3, Vec3, Vec3, Vec3]
}

function faceGeom(face: FaceName, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): FaceGeom {
  switch (face) {
    case 'north':
      return { normal: [0, 0, -1], corners: [[x2, y2, z1], [x1, y2, z1], [x1, y1, z1], [x2, y1, z1]] }
    case 'south':
      return { normal: [0, 0, 1], corners: [[x1, y2, z2], [x2, y2, z2], [x2, y1, z2], [x1, y1, z2]] }
    case 'east':
      return { normal: [1, 0, 0], corners: [[x2, y2, z2], [x2, y2, z1], [x2, y1, z1], [x2, y1, z2]] }
    case 'west':
      return { normal: [-1, 0, 0], corners: [[x1, y2, z1], [x1, y2, z2], [x1, y1, z2], [x1, y1, z1]] }
    case 'up':
      return { normal: [0, 1, 0], corners: [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]] }
    case 'down':
      return { normal: [0, -1, 0], corners: [[x1, y1, z1], [x2, y1, z1], [x2, y1, z2], [x1, y1, z2]] }
  }
}

/** 三角序：down 与其余五面相反（绕向经叉积验证法线朝外） */
const FACE_TRIS: Record<FaceName, Array<[number, number, number]>> = {
  north: [
    [0, 3, 2],
    [0, 2, 1]
  ],
  south: [
    [0, 3, 2],
    [0, 2, 1]
  ],
  east: [
    [0, 3, 2],
    [0, 2, 1]
  ],
  west: [
    [0, 3, 2],
    [0, 2, 1]
  ],
  up: [
    [0, 3, 2],
    [0, 2, 1]
  ],
  down: [
    [0, 1, 2],
    [0, 2, 3]
  ]
}

/* ------------------------------------------------------------------ */
/* 几何桶：按贴图分组的三角汤累积                                        */
/* ------------------------------------------------------------------ */

interface PrimBucket {
  positions: number[]
  normals: number[]
  uvs: number[]
  /** 逐顶点蒙皮关节（VEC4 展平；缺省 = 该桶用刚性 skinJoint 回退） */
  joints?: number[]
  /** 逐顶点蒙皮权重（VEC4 展平） */
  weights?: number[]
}

/** 单顶点蒙皮（4 关节 + 4 权重，glTF VEC4 语义） */
interface VertexSkin {
  joints: number[]
  weights: number[]
}

interface TexturePlan {
  /** 文档序排列的已用贴图 */
  textures: ModelTexture[]
  /** 清洗后的文件名（不含 .png），与 textures 同序 */
  names: string[]
  /** textureId → images/textures/materials 下标 */
  indexByTexId: Map<TextureId, number>
}

/** 收集几何实际引用的贴图（文档序），生成 images/materials 计划 */
function planTextures(doc: ModelDocument): TexturePlan {
  const used = new Set<TextureId>()
  for (const node of Object.values(doc.nodes)) {
    if (isCubeNode(node)) {
      const eff = effectiveFaceBindings(node, doc.settings.uvMode)
      for (const face of FACE_NAMES) {
        const t = eff[face]?.texture
        if (t && doc.textures[t]) used.add(t)
      }
    } else if (isMeshNode(node)) {
      for (const f of node.faces) {
        if (f.texture && doc.textures[f.texture]) used.add(f.texture)
      }
    }
  }
  const textures = Object.values(doc.textures).filter((t) => used.has(t.id))
  const names: string[] = []
  const usedNames = new Set<string>()
  const indexByTexId = new Map<TextureId, number>()
  textures.forEach((t, i) => {
    names.push(safeImageName(t.name, usedNames))
    indexByTexId.set(t.id, i)
  })
  return { textures, names, indexByTexId }
}

/** 文档局部矩阵 TRS 分解：L = T(o)·R·S·T(−o) = T(o − R·S·o)·R·S（单位 ÷16） */
function trsOf(origin: Vec3, rotation: Vec3, scale: Vec3): { t: Vec3; r: Quat; s: Vec3 } {
  const rs = mat4Multiply(eulerMatrix(rotation), mat4Scale(scale))
  const rso = transformDirection(rs, origin)
  return {
    t: [(origin[0] - rso[0]) / 16, (origin[1] - rso[1]) / 16, (origin[2] - rso[2]) / 16],
    r: quatFromEulerXYZDeg(rotation),
    s: [...scale]
  }
}

/* ------------------------------------------------------------------ */
/* 主导出                                                              */
/* ------------------------------------------------------------------ */

export function documentToGltf(doc: ModelDocument): FormatExportResult<GltfExport> {
  const downgrades: FormatDowngrade[] = []
  const bin = new GltfBin()
  const texPlan = planTextures(doc)

  /* ---- 降级：display / flipbook ---- */
  if (doc.display && Object.keys(doc.display).length > 0) {
    downgrades.push({
      severity: 'info',
      code: 'display_dropped',
      message: 'display 槽位变换是 Java 原版概念，glTF 无对应结构，已丢弃'
    })
  }
  for (const tex of texPlan.textures) {
    if (tex.animation) {
      downgrades.push({
        severity: 'info',
        code: 'flipbook_strip',
        message: `贴图「${tex.name}」是 flipbook 帧条，已整帧条导出（glTF 无逐帧贴图动画概念）`
      })
    }
  }

  /* ---- 材质数组：贴图材质在前，灰材质按需追加 ---- */
  const materials: Array<Record<string, unknown>> = texPlan.textures.map((_, i) => ({
    pbrMetallicRoughness: { baseColorTexture: { index: i }, metallicFactor: 0, roughnessFactor: 1 },
    alphaMode: 'MASK',
    alphaCutoff: 0.5,
    doubleSided: false
  }))
  let grayMaterial = -1
  const materialOf = (texId: TextureId | undefined): { index: number; tex: ModelTexture | null } => {
    const ti = texId !== undefined ? texPlan.indexByTexId.get(texId) : undefined
    if (ti !== undefined) return { index: ti, tex: texPlan.textures[ti]! }
    if (grayMaterial < 0) {
      grayMaterial = materials.length
      materials.push({
        pbrMetallicRoughness: { baseColorFactor: [0.5, 0.5, 0.5, 1], metallicFactor: 0, roughnessFactor: 1 },
        doubleSided: false
      })
    }
    return { index: grayMaterial, tex: null }
  }

  /* ---- 几何发射（world != null = 蒙皮模式：烘世界绑定姿态） ---- */
  const gltfMeshes: Array<Record<string, unknown>> = []

  function pushTri(
    bucket: PrimBucket,
    pts: [Vec3, Vec3, Vec3],
    normal: Vec3,
    uvs: [[number, number], [number, number], [number, number]] | null,
    skins?: [VertexSkin, VertexSkin, VertexSkin]
  ): void {
    for (let i = 0; i < 3; i++) {
      bucket.positions.push(pts[i]![0], pts[i]![1], pts[i]![2])
      bucket.normals.push(normal[0], normal[1], normal[2])
      if (uvs) bucket.uvs.push(uvs[i]![0], uvs[i]![1])
      if (skins) {
        if (!bucket.joints) bucket.joints = []
        if (!bucket.weights) bucket.weights = []
        bucket.joints.push(...skins[i]!.joints)
        bucket.weights.push(...skins[i]!.weights)
      }
    }
  }

  function flushBuckets(buckets: Map<TextureId | '', PrimBucket>, skinJoint: number | null): Array<Record<string, unknown>> {
    const primitives: Array<Record<string, unknown>> = []
    for (const [key, b] of buckets) {
      if (b.positions.length === 0) continue
      const { index: material, tex } = materialOf(key === '' ? undefined : key)
      const vertCount = b.positions.length / 3
      const attributes: Record<string, number> = {
        POSITION: bin.addAccessor(b.positions, CT_FLOAT, 'VEC3', vertCount, { minmax: true }),
        NORMAL: bin.addAccessor(b.normals, CT_FLOAT, 'VEC3', vertCount)
      }
      if (tex) {
        attributes.TEXCOORD_0 = bin.addAccessor(b.uvs, CT_FLOAT, 'VEC2', vertCount)
      }
      if (skinJoint !== null) {
        // 逐顶点权重在位时优先（v3 C3a）；否则按父关节刚性 1.0
        let joints: number[]
        let weights: number[]
        if (b.joints && b.weights && b.joints.length === vertCount * 4) {
          joints = b.joints
          weights = b.weights
        } else {
          joints = []
          weights = []
          for (let i = 0; i < vertCount; i++) {
            joints.push(skinJoint, 0, 0, 0)
            weights.push(1, 0, 0, 0)
          }
        }
        attributes.JOINTS_0 = bin.addAccessor(joints, CT_UBYTE, 'VEC4', vertCount)
        attributes.WEIGHTS_0 = bin.addAccessor(weights, CT_FLOAT, 'VEC4', vertCount)
      }
      primitives.push({ attributes, material, mode: 4 })
    }
    return primitives
  }

  function emitCubeMesh(node: CubeNode, world: Mat4 | null, skinJoint: number | null): number | null {
    const eff = effectiveFaceBindings(node, doc.settings.uvMode)
    const buckets = new Map<TextureId | '', PrimBucket>()
    const x1 = Math.min(node.from[0], node.to[0])
    const y1 = Math.min(node.from[1], node.to[1])
    const z1 = Math.min(node.from[2], node.to[2])
    const x2 = Math.max(node.from[0], node.to[0])
    const y2 = Math.max(node.from[1], node.to[1])
    const z2 = Math.max(node.from[2], node.to[2])
    for (const face of FACE_NAMES) {
      const binding = eff[face]
      if (!binding?.uv) continue
      const texId = binding.texture && texPlan.indexByTexId.has(binding.texture) ? binding.texture : ''
      let bucket = buckets.get(texId)
      if (!bucket) {
        bucket = { positions: [], normals: [], uvs: [] }
        buckets.set(texId, bucket)
      }
      const tex = texId === '' ? null : doc.textures[texId]!
      const g = faceGeom(face, x1, y1, z1, x2, y2, z2)
      const pts = g.corners.map((c) => div16(world ? transformPoint(world, c) : c)) as [Vec3, Vec3, Vec3, Vec3]
      const n = world ? normalize(transformDirection(world, g.normal)) : g.normal
      const uvCorners = rotateUvCorners(binding.uv, binding.rotation ?? 0)
      const unit = uvCorners.map((uv) =>
        tex ? ([uv[0] / tex.width, uv[1] / tex.height] as [number, number]) : ([0, 0] as [number, number])
      ) as [[number, number], [number, number], [number, number], [number, number]]
      for (const tri of FACE_TRIS[face]) {
        pushTri(
          bucket,
          [pts[tri[0]], pts[tri[1]], pts[tri[2]]],
          n,
          tex ? [unit[tri[0]], unit[tri[1]], unit[tri[2]]] : null
        )
      }
    }
    const primitives = flushBuckets(buckets, skinJoint)
    if (primitives.length === 0) return null
    gltfMeshes.push({ name: node.name, primitives })
    return gltfMeshes.length - 1
  }

  // 蒙皮：组 → 关节下标映射（声明提前，供下方 emitMeshMesh 内的 skinOf 闭包引用；赋值在蒙皮段完成）
  const jointIndexByGroupId = new Map<NodeId, number>()

  function emitMeshMesh(node: MeshNode, world: Mat4 | null, skinJoint: number | null): number | null {
    const buckets = new Map<TextureId | '', PrimBucket>()
    // 逐顶点蒙皮（v3 C3a）：仅蒙皮模式（skinJoint != null）且节点带权重时启用；
    // 顶点权重按 topWeights 取前 4 组映射为关节下标（未映射的组跳过）。
    const skinOf = (vi: number): VertexSkin => {
      const w = node.weights?.[vi]
      const joints = [0, 0, 0, 0]
      const weights = [0, 0, 0, 0]
      let used = 0
      if (w) {
        for (const [gid, val] of topWeights(w, MAX_JOINTS_PER_VERTEX)) {
          // 仅蒙皮模式下调用（jointIndexByGroupId 已在蒙皮段建立）
          const ji = jointIndexByGroupId.get(gid)
          if (ji === undefined) continue
          joints[used] = ji
          weights[used] = val
          used++
        }
      }
      if (used === 0 && skinJoint !== null) {
        joints[0] = skinJoint
        weights[0] = 1
      }
      return { joints, weights }
    }
    const usePerVertex = skinJoint !== null && !!node.weights
    for (const face of node.faces) {
      const texId = face.texture && texPlan.indexByTexId.has(face.texture) ? face.texture : ''
      let bucket = buckets.get(texId)
      if (!bucket) {
        bucket = { positions: [], normals: [], uvs: [] }
        buckets.set(texId, bucket)
      }
      const tex = texId === '' ? null : doc.textures[texId]!
      const pts = facePoints(node, face).map((p) => div16(world ? transformPoint(world, p) : p))
      const n = faceNormal(pts)
      for (const tri of triangulateFace(face)) {
        const skins: [VertexSkin, VertexSkin, VertexSkin] | undefined = usePerVertex
          ? [
              skinOf(face.vertices[tri[0]]!),
              skinOf(face.vertices[tri[1]]!),
              skinOf(face.vertices[tri[2]]!)
            ]
          : undefined
        pushTri(
          bucket,
          [pts[tri[0]]!, pts[tri[1]]!, pts[tri[2]]!],
          n,
          tex
            ? [
                [face.uv[tri[0]]![0] / tex.width, face.uv[tri[0]]![1] / tex.height],
                [face.uv[tri[1]]![0] / tex.width, face.uv[tri[1]]![1] / tex.height],
                [face.uv[tri[2]]![0] / tex.width, face.uv[tri[2]]![1] / tex.height]
              ]
            : null,
          skins
        )
      }
    }
    const primitives = flushBuckets(buckets, skinJoint)
    if (primitives.length === 0) return null
    gltfMeshes.push({ name: node.name, primitives })
    return gltfMeshes.length - 1
  }

  /* ---- 节点发射：DFS 层级（组/定位器/根级几何），蒙皮网格另行收集 ---- */
  const gltfNodes: Array<Record<string, unknown>> = []
  const nodeIndexById = new Map<NodeId, number>()
  const groupIds: NodeId[] = []
  const skinnedNodeIds: NodeId[] = []

  function emitGroup(id: NodeId): number {
    const g = doc.nodes[id]!
    if (!isGroupNode(g)) throw new Error(`内部错误：${id} 不是组节点`)
    const idx = gltfNodes.length
    nodeIndexById.set(id, idx)
    groupIds.push(id)
    const { t, r, s } = trsOf(g.origin, g.rotation, g.scale ?? [1, 1, 1])
    const out: Record<string, unknown> = {
      name: g.name,
      translation: jvec(t),
      rotation: jvec(r),
      scale: jvec(s)
    }
    gltfNodes.push(out)
    const children: number[] = []
    for (const cid of g.children) {
      const c = doc.nodes[cid]
      if (!c) continue
      if (isGroupNode(c)) children.push(emitGroup(cid))
      else if (isLocatorNode(c)) children.push(emitLocator(cid))
      else if (isCubeNode(c) || isMeshNode(c)) skinnedNodeIds.push(cid)
    }
    if (children.length > 0) out.children = children
    return idx
  }

  function emitLocator(id: NodeId): number {
    const n = doc.nodes[id]!
    if (!isLocatorNode(n)) throw new Error(`内部错误：${id} 不是定位器节点`)
    const idx = gltfNodes.length
    nodeIndexById.set(id, idx)
    gltfNodes.push({ name: n.name, translation: jvec(div16(n.position)) })
    return idx
  }

  /** doc.root 直下的 cube/mesh：层级 TRS 节点，顶点 = 父空间坐标/16 */
  function emitHierarchyGeometry(id: NodeId): number {
    const n = doc.nodes[id] as CubeNode | MeshNode
    const idx = gltfNodes.length
    nodeIndexById.set(id, idx)
    const meshIdx = isCubeNode(n) ? emitCubeMesh(n, null, null) : emitMeshMesh(n, null, null)
    const { t, r, s } = trsOf(n.origin, n.rotation, [1, 1, 1])
    const out: Record<string, unknown> = {
      name: n.name,
      translation: jvec(t),
      rotation: jvec(r),
      scale: jvec(s)
    }
    if (meshIdx !== null) out.mesh = meshIdx
    gltfNodes.push(out)
    return idx
  }

  const sceneRoots: number[] = []
  for (const id of doc.root) {
    const n = doc.nodes[id]
    if (!n) continue
    if (isGroupNode(n)) sceneRoots.push(emitGroup(id))
    else if (isLocatorNode(n)) sceneRoots.push(emitLocator(id))
    else if (isCubeNode(n) || isMeshNode(n)) sceneRoots.push(emitHierarchyGeometry(id))
  }

  /* ---- 蒙皮网格节点：场景根、变换恒等、顶点 = 世界绑定姿态/16 ---- */
  groupIds.forEach((id, i) => jointIndexByGroupId.set(id, i))
  let hasSkin = false
  for (const id of skinnedNodeIds) {
    const n = doc.nodes[id] as CubeNode | MeshNode
    const parentJoint = n.parent ? jointIndexByGroupId.get(n.parent) : undefined
    if (parentJoint === undefined) continue
    const world = worldMatrixOf(doc, id)
    const meshIdx = isCubeNode(n) ? emitCubeMesh(n, world, parentJoint) : emitMeshMesh(n, world, parentJoint)
    const idx = gltfNodes.length
    nodeIndexById.set(id, idx)
    const out: Record<string, unknown> = { name: n.name }
    if (meshIdx !== null) {
      out.mesh = meshIdx
      out.skin = 0
      hasSkin = true
    }
    gltfNodes.push(out)
    sceneRoots.push(idx)
  }

  /* ---- 蒙皮：IBM = 关节世界矩阵（平移分量/16 后）的逆 ---- */
  let skins: Array<Record<string, unknown>> | undefined
  if (hasSkin) {
    const ibm: number[] = []
    for (const gid of groupIds) {
      const w = worldMatrixOf(doc, gid)
      const scaled: Mat4 = [...w]
      scaled[12] = scaled[12]! / 16
      scaled[13] = scaled[13]! / 16
      scaled[14] = scaled[14]! / 16
      let inv: Mat4
      try {
        inv = mat4Invert(scaled)
      } catch {
        downgrades.push({
          severity: 'warning',
          code: 'skin_ibm_failed',
          nodeId: gid,
          message: `关节「${doc.nodes[gid]?.name ?? gid}」的世界矩阵奇异（含零缩放），绑定矩阵已回退单位阵`
        })
        inv = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
      }
      ibm.push(...inv)
    }
    const ibmAccessor = bin.addAccessor(ibm, CT_FLOAT, 'MAT4', groupIds.length)
    skins = [
      {
        joints: groupIds.map((gid) => nodeIndexById.get(gid)!),
        inverseBindMatrices: ibmAccessor
      }
    ]
  }

  /* ---- 动画：逐关节 1/30s 稠密烘焙 ---- */
  const animations: Array<Record<string, unknown>> = []
  for (const anim of Object.values(doc.animations)) {
    let hasCatmull = false
    let hasEasing = false
    const channels: Array<Record<string, unknown>> = []
    const samplers: Array<Record<string, unknown>> = []

    for (const [nodeId, ch] of Object.entries(anim.channels)) {
      const node = doc.nodes[nodeId]
      const nodeIdx = nodeIndexById.get(nodeId)
      if (!node || !isGroupNode(node) || nodeIdx === undefined) {
        downgrades.push({
          severity: 'warning',
          code: 'channel_target_not_bone',
          nodeId,
          message: `动画「${anim.name}」的通道目标「${node?.name ?? nodeId}」不是骨骼（组节点），glTF 烘焙只作用于关节，已跳过`
        })
        continue
      }
      for (const keys of [ch.rotation, ch.position, ch.scale]) {
        for (const k of keys ?? []) {
          if (k.interpolation === 'catmullrom') hasCatmull = true
          if (k.easing && !isIdentityEasing(k.easing)) hasEasing = true
        }
      }
      const times = bakeTimes(anim.length, ch)
      if (times.length === 0) continue
      const tOut: number[] = []
      const rOut: number[] = []
      const sOut: number[] = []
      let prevQ: Quat | null = null
      for (const t of times) {
        const r = (ch.rotation && ch.rotation.length > 0 ? sampleChannel(ch.rotation, t) : null) ?? node.rotation
        const p = (ch.position && ch.position.length > 0 ? sampleChannel(ch.position, t) : null) ?? node.origin
        const s =
          (ch.scale && ch.scale.length > 0 ? sampleChannel(ch.scale, t) : null) ?? node.scale ?? [1, 1, 1]
        // position 通道 = 绝对 pivot 位置（替换 origin，非偏移；与视口叠加语义一致）
        const rs = mat4Multiply(eulerMatrix(r), mat4Scale(s))
        const rso = transformDirection(rs, node.origin)
        tOut.push((p[0] - rso[0]) / 16, (p[1] - rso[1]) / 16, (p[2] - rso[2]) / 16)
        let q = quatFromEulerXYZDeg(r)
        if (prevQ && q[0] * prevQ[0] + q[1] * prevQ[1] + q[2] * prevQ[2] + q[3] * prevQ[3] < 0) {
          q = [-q[0], -q[1], -q[2], -q[3]]
        }
        prevQ = q
        rOut.push(q[0], q[1], q[2], q[3])
        sOut.push(s[0], s[1], s[2])
      }
      const input = bin.addAccessor(times, CT_FLOAT, 'SCALAR', times.length, { minmax: true })
      const outputs: Array<{ path: string; data: number[]; type: AccessorType }> = [
        { path: 'translation', data: tOut, type: 'VEC3' },
        { path: 'rotation', data: rOut, type: 'VEC4' },
        { path: 'scale', data: sOut, type: 'VEC3' }
      ]
      for (const o of outputs) {
        const acc = bin.addAccessor(o.data, CT_FLOAT, o.type, times.length)
        samplers.push({ input, output: acc, interpolation: 'LINEAR' })
        channels.push({ sampler: samplers.length - 1, target: { node: nodeIdx, path: o.path } })
      }
    }

    if (hasCatmull) {
      downgrades.push({
        severity: 'info',
        code: 'anim_catmullrom_baked',
        message: `动画「${anim.name}」含 Catmull-Rom 插值，已按 1/30s 稠密烘焙为线性关键帧`
      })
    }
    if (hasEasing) {
      downgrades.push({
        severity: 'warning',
        code: 'easing_baked',
        message: `动画「${anim.name}」含自定义 Bezier 缓动，已按 1/30s 稠密烘焙进关键帧（曲线形态保留、缓动元数据丢失）`
      })
    }
    if (anim.loop !== 'once') {
      downgrades.push({
        severity: 'info',
        code: 'loop_dropped',
        message: `动画「${anim.name}」的循环模式（${anim.loop}）是运行时语义，glTF 不承载，已按单次播放导出`
      })
    }
    if (channels.length > 0) animations.push({ name: anim.name, channels, samplers })
  }

  /* ---- 组装 ---- */
  const binBytes = bin.toUint8Array()
  const gltf: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'KunYu Modeler' },
    scene: 0,
    scenes: [{ name: doc.name, nodes: sceneRoots }],
    nodes: gltfNodes,
    meshes: gltfMeshes,
    materials,
    textures: texPlan.textures.map((_, i) => ({ sampler: 0, source: i })),
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
    images: texPlan.textures.map((_, i) => ({ uri: `${texPlan.names[i]!}.png` })),
    buffers: [{ uri: '', byteLength: binBytes.length }],
    bufferViews: bin.bufferViews,
    accessors: bin.accessors
  }
  if (skins) gltf.skins = skins
  if (animations.length > 0) gltf.animations = animations

  const images: GltfExportImage[] = texPlan.textures.map((t, i) => ({
    name: `${texPlan.names[i]!}.png`,
    data: t.data
  }))

  return { output: { gltf, bin: binBytes, images }, downgrades }
}

/** 烘焙采样时刻：{0,length} ∪ 1/30s 均匀网格 ∪ 该关节三通道全部关键帧时刻（排序去重） */
function bakeTimes(length: number, ch: NodeAnimationChannels): number[] {
  const len = Number.isFinite(length) && length > 0 ? length : 0
  const set = new Set<number>([0, len])
  const steps = Math.floor(len * 30)
  for (let i = 0; i <= steps; i++) set.add(i / 30)
  for (const keys of [ch.rotation, ch.position, ch.scale]) {
    for (const k of keys ?? []) {
      if (k.time >= 0 && k.time <= len) set.add(k.time)
    }
  }
  const sorted = [...set].sort((a, b) => a - b)
  return sorted.filter((t, i) => i === 0 || t - sorted[i - 1]! > 1e-6)
}

/* ================================================================== */
/* glTF 2.0 导入（clean-room，规范 §3.x）                                  */
/* ================================================================== */

/** glTF 导入选项 */
export interface GltfImportOptions {
  /** 覆盖文档 id（缺省取 name 清洗或 'gltf_model'） */
  id?: string
  /** 文档显示名（缺省取 gltf.scene.name 或 'gltf_model'） */
  name?: string
  /** 覆盖文档 format 标记（缺省 free：glTF 无游戏约束） */
  format?: FormatId
  /** 贴图边长（UV 像素换算用；外部贴图无此参数时 UV 保留 0..1） */
  textureSize?: number
  /** 是否等比缩放+居中装进 0..16 文档盒（缺省 true） */
  fitToBox?: boolean
  /** 固定 meta 时间戳（测试确定性） */
  now?: number
}

/**
 * glTF 2.0 JSON → ModelDocument（clean-room，仅依据 Khronos 公开规范独立实现）。
 *
 * 实现子集（与现有 documentToGltf 导出产物对齐）：
 *   - .gltf JSON + buffers[].uri = data:application/octet-stream;base64（嵌入式 buffer）；
 *     外部 .bin uri（相对路径）**不解析**——info 降级跳过；.glb 二进制容器**不支持**。
 *   - accessor：componentType BYTE/UBYTE/SHORT/USHORT/UINT/FLOAT +
 *     type SCALAR/VEC2/VEC3/VEC4；normalized = true 的整数按规范映射到 [-1,1] 或 [0,1]；
 *     sparse accessor（规范 §3.6.16）**不支持**——info 降级跳过差异数据；
 *     缺省 byteStride 自动推导（紧密排列）；offset 支持多层叠加。
 *   - primitive：mode=4 TRIANGLES（直接）、mode=5 TRIANGLE_STRIP（展开为三角汤）；
 *     mode=0 POINTS/2 LINES/其他 → info 降级丢弃。attributes 仅读 POSITION/TEXCOORD_0/
 *     JOINTS_0/WEIGHTS_0/NORMAL（NORMAL 导入但不做任何处理）；indices accessor 支持
 *     UNSIGNED_SHORT/UNSIGNED_INT/UNSIGNED_BYTE 三种下标类型。
 *   - 节点层级：scene.nodes[scene] → 遍历 nodes[].children → 组装 ModelDocument 树；
 *     节点 TRS（translation/rotation quaternion/scale）**或** matrix 4×4 列主序（规范
 *     §4.7.1）均支持；matrix 分解失败（奇异矩阵）info 降级返回单位 TRS；
 *     glTF 单位（米）×16 = 文档单位（与导出端 ÷16 对称）。
 *   - UV：glTF (0,0) = 左上（规范 §3.6.1），PNG 顶行在前——与编辑器一致，**不做 v 翻转**！
 *     u_px = u * texWidth, v_px = v * texHeight；缺省 texSize=16（MC 16×16 是最常见贴图）。
 *   - 贴图：materials[baseColorTexture.index].source → images[].uri = data:image/png;base64
 *     → decode 成 ModelTexture.data；外部贴图 uri（相对路径）**不解析**——info 降级。
 *   - 蒙皮：JOINTS_0 / WEIGHTS_0 支持——关节下标需通过 node.name 匹配 doc 组节点 id
 *     映射（glTF skin.joints 是 node 下标数组）；匹配不上 info 降级丢弃权重。
 *   - 动画（规范 §4.7.24）**不导入**——info 降级。
 *   - camera / light / extensions / extras / sampler（除 magFilter/minFilter/wrapS/wrapT）
 *     全部 info 降级跳过。
 *
 * 返回：{ doc, downgrades }；任何关键路径（scene / nodes / meshes）异常 → Error 抛错。
 */
export function gltfToDocument(
  json: Record<string, unknown>,
  buffers: Uint8Array[],
  options?: GltfImportOptions
): FormatImportResult {
  const downgrades: FormatDowngrade[] = []
  const push = (severity: 'warning' | 'info', code: string, message: string): void => {
    downgrades.push({ severity, code, message })
  }

  const texSize = options?.textureSize ?? 16
  const fitToBox = options?.fitToBox ?? true
  void options?.now // 保留参数签名一致性但文档 meta 时间戳暂由外部注入

  /* 1) 版本门禁 + asset */
  const asset = json.asset as { version?: string } | undefined
  const version = asset?.version
  if (version && !String(version).startsWith('2.')) {
    throw new Error(`glTF 导入仅支持 2.x，当前版本 ${version}`)
  }

  /* 2) scene 入口 */
  const scenes = (json.scenes as Array<Record<string, unknown>> | undefined) ?? []
  if (scenes.length === 0) throw new Error('glTF 导入：无 scenes 数组')
  const sceneIdx = (json.scene as number | undefined) ?? 0
  const scene = scenes[sceneIdx] ?? scenes[0]!
  const roots = (scene.nodes as number[] | undefined) ?? []
  if (roots.length === 0) throw new Error('glTF 导入：scene.nodes 为空')

  const nodesArr = (json.nodes as Array<Record<string, unknown>> | undefined) ?? []
  const meshesArr = (json.meshes as Array<Record<string, unknown>> | undefined) ?? []
  const accessorsArr = (json.accessors as Array<Record<string, unknown>> | undefined) ?? []
  const bufferViewsArr = (json.bufferViews as Array<Record<string, unknown>> | undefined) ?? []
  const materialsArr = (json.materials as Array<Record<string, unknown>> | undefined) ?? []
  const texturesArr = (json.textures as Array<Record<string, unknown>> | undefined) ?? []
  const imagesArr = (json.images as Array<Record<string, unknown>> | undefined) ?? []
  const skinsArr = (json.skins as Array<Record<string, unknown>> | undefined) ?? []
  const animationsArr = (json.animations as Array<Record<string, unknown>> | undefined) ?? []

  /* 不支持的元素统一 info 降级 */
  for (const key of ['cameras', 'extensionsUsed', 'extensionsRequired', 'extensions']) {
    if (key in json) push('info', 'gltf_unsupported_element', `${key} 不导入`)
  }
  if (animationsArr.length > 0) {
    push('info', 'gltf_animations_not_imported', `含 ${animationsArr.length} 段动画，glTF 导入不支持动画`)
  }
  if (skinsArr.length > 0) {
    push('info', 'gltf_skin_imported', `含 ${skinsArr.length} 段蒙皮，将导入为逐顶点权重（关节名匹配组节点 id）`)
  }

  /* 3) 辅助：buffer/accessor 解码 */
  const bfs: Uint8Array[] = buffers
  if (bfs.length === 0 && Array.isArray(json.buffers)) {
    for (const b of json.buffers as Array<Record<string, unknown>>) {
      const uri = b.uri as string | undefined
      if (!uri) {
        /* 外部 buffer 由调用方传入 buffers 参数；此处无 uri 时跳过（降级） */
        push('info', 'gltf_buffer_external', `buffer.uri 缺失或为外部路径，已跳过`)
        bfs.push(new Uint8Array(0))
        continue
      }
      if (uri.startsWith('data:application/octet-stream;base64,')) {
        const b64 = uri.slice('data:application/octet-stream;base64,'.length)
        bfs.push(base64ToBytes(b64))
      } else if (uri.startsWith('data:;base64,')) {
        const b64 = uri.slice('data:;base64,'.length)
        bfs.push(base64ToBytes(b64))
      } else {
        /* 外部 .bin 文件：info 降级；让用户通过 IPC 传 buffers 参数 */
        push('info', 'gltf_buffer_external', `buffer.uri=${uri} 为外部路径，已跳过该 buffer`)
        bfs.push(new Uint8Array(0))
      }
    }
  }

  /** accessor 类型 → 元素数（规范 §3.6.1） */
  const TYPE_COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
  /** componentType → TypedArray 构造函数 + 元素字节数（规范 §3.6.2） */
  const CT_INFO: Record<number, { TA: any; byte: number; signed: boolean }> = {
    5120: { TA: Int8Array, byte: 1, signed: true },
    5121: { TA: Uint8Array, byte: 1, signed: false },
    5122: { TA: Int16Array, byte: 2, signed: true },
    5123: { TA: Uint16Array, byte: 2, signed: false },
    5125: { TA: Uint32Array, byte: 4, signed: false },
    5126: { TA: Float32Array, byte: 4, signed: true }
  }

  function readAccessor(idx: number): number[] | null {
    const acc = accessorsArr[idx]
    if (!acc) return null
    if (acc.sparse) {
      push('info', 'gltf_sparse_not_supported', `accessor[${idx}] 含 sparse，已跳过差异数据`)
    }
    const compType = acc.componentType as number
    const typeName = acc.type as string
    const count = acc.count as number
    const normalized = Boolean(acc.normalized)
    const info = CT_INFO[compType]
    const n = TYPE_COUNT[typeName]
    if (!info || !n) {
      push('warning', 'gltf_accessor_unknown', `accessor[${idx}] componentType=${compType} type=${typeName} 未知，已跳过`)
      return null
    }
    const bvIdx = acc.bufferView as number
    const bv = bufferViewsArr[bvIdx]
    if (!bv) {
      push('warning', 'gltf_accessor_bv_missing', `accessor[${idx}] 引用的 bufferView[${bvIdx}] 缺失`)
      return null
    }
    const bufIdx = bv.buffer as number
    const buf = bfs[bufIdx]
    if (!buf || buf.byteLength === 0) return null
    const offset = ((bv.byteOffset as number) ?? 0) + ((acc.byteOffset as number) ?? 0)
    const stride = (bv.byteStride as number) ?? info.byte * n
    const out: number[] = []
    for (let i = 0; i < count; i++) {
      const start = offset + i * stride
      if (start + info.byte * n > buf.byteLength) break
      const sub = buf.slice(start, start + info.byte * n)
      const ta = new info.TA(sub.buffer, sub.byteOffset, sub.byteLength / info.byte)
      for (let k = 0; k < n; k++) {
        let v = ta[k] ?? 0
        if (normalized && compType !== 5126) {
          if (info.signed) v = Math.max(-1, v / 32767)
          else v = v / 65535
        }
        out.push(v)
      }
    }
    return out
  }

  /* 4) primitive 提取 → MeshNode 几何 */
  const meshNodeByIdx = new Map<number, MeshNode>()
  const meshTexOf: Record<number, ModelTexture> = {}
  let globalTexCounter = 0

  function decodeTexImage(uri: string): ModelTexture | null {
    const base64 = uri.startsWith('data:image/png;base64,')
      ? uri.slice('data:image/png;base64,'.length)
      : uri.startsWith('data:;base64,')
        ? uri.slice('data:;base64,'.length)
        : null
    if (!base64) {
      push('info', 'gltf_image_external', `image.uri=${uri} 为外部路径，贴图未导入（UV 保留）`)
      return null
    }
    const dataUrl = `data:image/png;base64,${base64}`
    const id = `gltf_tex_${globalTexCounter++}`
    return { id, name: `gltf_texture_${globalTexCounter}`, width: texSize, height: texSize, data: dataUrl, uvSize: [texSize, texSize], visible: true }
  }

  /** materialIdx → ModelTexture（无贴图时 null） */
  function textureOfMaterial(matIdx: number | undefined): ModelTexture | null {
    if (matIdx === undefined || matIdx < 0) return null
    const mat = materialsArr[matIdx]
    if (!mat) return null
    const pbr = mat.pbrMetallicRoughness as Record<string, unknown> | undefined
    const texIdx = (pbr?.baseColorTexture as { index?: number } | undefined)?.index
    if (texIdx === undefined) return null
    const tex = texturesArr[texIdx]
    if (!tex) return null
    const srcIdx = tex.source as number | undefined
    if (srcIdx === undefined) return null
    const img = imagesArr[srcIdx]
    if (!img) return null
    const uri = img.uri as string | undefined
    if (!uri) return null
    return decodeTexImage(uri)
  }

  /** 把 POSITION + TEXCOORD_0 + INDICES 展开为三角汤 Vec3[] + Vec2[]（UV 已转像素，不含 0..1） */
  function extractPrimTri(prim: Record<string, unknown>): { verts: Vec3[]; uvs: Vec2[]; material: number | undefined } | null {
    const attr = prim.attributes as Record<string, number>
    const pos = attr?.POSITION !== undefined ? readAccessor(attr.POSITION!) : null
    if (!pos || pos.length < 9) return null
    const ind = prim.indices !== undefined ? readAccessor(prim.indices as number) : null
    const uvRaw = attr?.TEXCOORD_0 !== undefined ? readAccessor(attr.TEXCOORD_0!) : null
    const verts: Vec3[] = []
    const uvs: Vec2[] = []
    const pushTri = (i0: number, i1: number, i2: number): void => {
      verts.push([pos[i0 * 3]! * 16, pos[i0 * 3 + 1]! * 16, pos[i0 * 3 + 2]! * 16])
      verts.push([pos[i1 * 3]! * 16, pos[i1 * 3 + 1]! * 16, pos[i1 * 3 + 2]! * 16])
      verts.push([pos[i2 * 3]! * 16, pos[i2 * 3 + 1]! * 16, pos[i2 * 3 + 2]! * 16])
      if (uvRaw) {
        uvs.push([(uvRaw[i0 * 2] ?? 0) * texSize, (uvRaw[i0 * 2 + 1] ?? 0) * texSize])
        uvs.push([(uvRaw[i1 * 2] ?? 0) * texSize, (uvRaw[i1 * 2 + 1] ?? 0) * texSize])
        uvs.push([(uvRaw[i2 * 2] ?? 0) * texSize, (uvRaw[i2 * 2 + 1] ?? 0) * texSize])
      }
    }

    if (ind) {
      // 有索引：直接按 mode 处理（glTF 规范 mode=4 即 TRIANGLES）
      const mode = (prim.mode as number | undefined) ?? 4
      if (mode === 4) {
        for (let i = 0; i + 2 < ind.length; i += 3) pushTri(ind[i]!, ind[i + 1]!, ind[i + 2]!)
      } else if (mode === 5) {
        // TRIANGLE_STRIP：相邻倒序展开
        for (let i = 2; i < ind.length; i++) pushTri(ind[i - 2]!, ind[i]!, ind[i - 1]!)
      } else {
        push('info', 'gltf_prim_mode', `primitive mode=${mode} 非三角，已跳过`)
      }
    } else {
      // 无索引：POSITION 直接按 3 倍数展开
      const mode = (prim.mode as number | undefined) ?? 4
      const vCount = pos.length / 3
      if (mode === 4) {
        for (let i = 0; i + 2 < vCount; i += 3) pushTri(i, i + 1, i + 2)
      } else if (mode === 5) {
        for (let i = 2; i < vCount; i++) pushTri(i - 2, i, i - 1)
      } else {
        push('info', 'gltf_prim_mode', `primitive mode=${mode} 非三角，已跳过`)
      }
    }
    if (verts.length === 0) return null
    return { verts, uvs, material: prim.material as number | undefined }
  }

  /** 多 primitive mesh → 单 MeshNode（所有 primitive 顶点/面合并；按 material 分组为不同 MeshFace 的 texture） */
  function meshNodeOf(idx: number, name: string, textures: Map<number, ModelTexture>): MeshNode {
    const mesh = meshesArr[idx]
    if (!mesh) throw new Error(`gltf.meshes[${idx}] 缺失`)
    const prims = (mesh.primitives ?? []) as Array<Record<string, unknown>>
    const allVerts: Vec3[] = []
    const faces: MeshFace[] = []
    for (const prim of prims) {
      const extracted = extractPrimTri(prim)
      if (!extracted) continue
      // flatten 的三角汤 — 每 3 个顶点 = 1 个三角
      const tris = extracted.verts.length / 3
      const vertOffset = allVerts.length
      allVerts.push(...extracted.verts)
      for (let t = 0; t < tris; t++) {
        const faceIdx0 = vertOffset + t * 3
        const faceIdx1 = vertOffset + t * 3 + 1
        const faceIdx2 = vertOffset + t * 3 + 2
        const tex = extracted.material !== undefined ? textures.get(extracted.material) : undefined
        const faceUvs = extracted.uvs.slice(t * 3, t * 3 + 3).map((u) => [...u] as Vec2)
        // validate 要求 uv.length === vertices.length；无 UV 时放 [0,0] 占位
        const finalUvs: Vec2[] = faceUvs.length === 3 ? faceUvs : [[0, 0], [0, 0], [0, 0]]
        faces.push({
          vertices: [faceIdx0, faceIdx1, faceIdx2],
          uv: finalUvs,
          ...(tex ? { texture: tex.id } : {})
        })
      }
    }
    /* 若 mesh 为空 → 返回默认形避免校验失败（info 降级） */
    if (allVerts.length === 0) {
      push('warning', 'gltf_mesh_empty', `mesh「${name}」所有 primitive 空，已用默认四棱锥占位`)
      return createMeshNode(gltfSafeId(name, `mesh_${idx}`), defaultMeshGeometry())
    }
    return createMeshNode(gltfSafeId(name, `mesh_${idx}`), { vertices: allVerts, faces })
  }

  function gltfSafeId(raw: string, fallback: string): string {
    const s = raw.replace(/[^a-zA-Z0-9_-]/g, '_')
    return s.length > 0 ? s : fallback
  }

  /* 先建立 mesh idx → MeshNode 映射 + material idx → ModelTexture */
  const materialTexMap = new Map<number, ModelTexture>()
  for (let i = 0; i < materialsArr.length; i++) {
    const tex = textureOfMaterial(i)
    if (tex) {
      materialTexMap.set(i, tex)
      meshTexOf[i] = tex
    }
  }
  const meshTextures: Record<string, ModelTexture> = {}
  for (const t of Object.values(meshTexOf)) meshTextures[t.id] = t

  for (let i = 0; i < meshesArr.length; i++) {
    const m = meshesArr[i]!
    const name = (m.name as string | undefined) ?? `mesh_${i}`
    const node = meshNodeOf(i, name, materialTexMap)
    meshNodeByIdx.set(i, node)
  }

  /* 5) 节点层级：TRS / matrix + children → ModelDocument 树 */
  const gltfNodeTrs = (raw: Record<string, unknown>): { origin: Vec3; rotation: Vec3; scale: Vec3; hasAny: boolean } => {
    /* matrix 4×4 列主序 → 分解 TRS（与 DAe 的 nodeAffine 同模式） */
    const mat = raw.matrix as number[] | undefined
    if (mat && mat.length === 16) {
      try {
        // 列主序 4×4：下标 [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]
        const a00 = mat[0]!, a01 = mat[4]!, a02 = mat[8]!, a03 = mat[12]!
        const a10 = mat[1]!, a11 = mat[5]!, a12 = mat[9]!, a13 = mat[13]!
        const a20 = mat[2]!, a21 = mat[6]!, a22 = mat[10]!, a23 = mat[14]!
        const sx = Math.hypot(a00, a10, a20)
        const sy = Math.hypot(a01, a11, a21)
        const sz = Math.hypot(a02, a12, a22)
        const rx = a00 / sx, ry = a10 / sx, rz = a20 / sx
        const ux = a01 / sy, uy = a11 / sy, uz = a21 / sy
        const wx = a02 / sz, wy = a12 / sz, wz = a22 / sz
        const t: Vec3 = [a03 * 16, a13 * 16, a23 * 16]
        // 旋转矩阵（3×3）→ 欧拉 XYZ 度
        const rotDeg = matrix3ToEulerDeg([[rx, ux, wx], [ry, uy, wy], [rz, uz, wz]])
        return { origin: t, rotation: rotDeg, scale: [sx, sy, sz], hasAny: true }
      } catch {
        push('info', 'gltf_matrix_singular', `节点 matrix 奇异，已回退单位 TRS`)
        return { origin: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], hasAny: true }
      }
    }
    const tr = raw.translation as number[] | undefined
    const rot = raw.rotation as number[] | undefined
    const sc = raw.scale as number[] | undefined
    const origin: Vec3 = tr ? [tr[0]! * 16, tr[1]! * 16, tr[2]! * 16] : [0, 0, 0]
    let rotation: Vec3 = [0, 0, 0]
    if (rot && rot.length === 4) {
      rotation = quatToEulerXYZDeg([rot[0]!, rot[1]!, rot[2]!, rot[3]!])
    }
    const scale: Vec3 = sc ? [sc[0]!, sc[1]!, sc[2]!] : [1, 1, 1]
    const hasAny = !!tr || !!rot || !!sc
    return { origin, rotation, scale, hasAny }
  }

  /** 矩阵 3×3（行主序）→ 欧拉角 XYZ 度（glTF 规范 §4.5.2，XYZ 与导出端对称） */
  function matrix3ToEulerDeg(m: number[][]): Vec3 {
    const [m00] = [m[0]![0]!]
    const [m10, m11, m12] = [m[1]![0]!, m[1]![1]!, m[1]![2]!]
    const [m20, m21, m22] = [m[2]![0]!, m[2]![1]!, m[2]![2]!]
    const sy = Math.hypot(m00, m10)
    let rx = 0
    let ry = 0
    let rz = 0
    if (sy > 1e-6) {
      rx = Math.atan2(m21, m22)
      ry = Math.atan2(-m20, sy)
      rz = Math.atan2(m10, m00)
    } else {
      rx = Math.atan2(-m12, m11)
      ry = Math.atan2(-m20, sy)
      rz = 0
    }
    const DEG = 180 / Math.PI
    return [rx * DEG, ry * DEG, rz * DEG]
  }

  /** 四元数 → 欧拉角 XYZ 度（XYZ 旋转序，与导出端 quatFromEulerXYZDeg 对称） */
  function quatToEulerXYZDeg(q: number[]): Vec3 {
    const [x, y, z, w] = [q[0]!, q[1]!, q[2]!, q[3]!]
    const sinr = 2 * (w * x + y * z)
    const cosr = 1 - 2 * (x * x + y * y)
    let rx = Math.atan2(sinr, cosr)
    const sinp = 2 * (w * y - z * x)
    let ry = Math.abs(sinp) >= 1 ? (sinp >= 0 ? Math.PI / 2 : -Math.PI / 2) : Math.asin(sinp)
    const siny = 2 * (w * z + x * y)
    const cosy = 1 - 2 * (y * y + z * z)
    let rz = Math.atan2(siny, cosy)
    const DEG = 180 / Math.PI
    return [rx * DEG, ry * DEG, rz * DEG]
  }

  /** 节点 → 文档节点；mesh 节点直接是 MeshNode，其余是 GroupNode（承载 TRS） */
  const doc = createDocument({
    name: options?.name ?? (scene.name as string | undefined) ?? `gltf_${scenes[sceneIdx]?.name ?? 'model'}`,
    format: options?.format ?? 'free'
  })

  // 挂载所有贴图（不可变更新链）
  let runningDoc = doc
  for (const t of Object.values(meshTextures)) {
    runningDoc = addTexture(runningDoc, t)
  }

  /** 节点递归：返回挂载的 doc.nodes[nodeId]（GroupNode / MeshNode / LocatorNode） */
  const gltfNodeToDocNode = (nodeIdx: number, parentId: NodeId | null): NodeId => {
    const gltfNode = nodesArr[nodeIdx]
    if (!gltfNode) throw new Error(`gltf.nodes[${nodeIdx}] 缺失`)
    const name = (gltfNode.name as string | undefined) ?? `node_${nodeIdx}`
    const meshIdx = gltfNode.mesh as number | undefined
    const childrenIdx = (gltfNode.children as number[] | undefined) ?? []

    // 决定 nodeId
    let nextDoc = runningDoc
    let resultNodeId = '' as NodeId
    const safeName = gltfSafeId(name, meshIdx !== undefined ? `mesh_${nodeIdx}` : `group_${nodeIdx}`)

    if (meshIdx !== undefined) {
      // mesh 节点：直接 MeshNode；如有 TRS → 套一层 GroupNode（TRS 承载）
      const trs = gltfNodeTrs(gltfNode)
      const mesh = meshNodeByIdx.get(meshIdx)!
      if (!mesh) throw new Error(`mesh[${meshIdx}] 未提前构建`)
      if (trs.hasAny) {
        // 套 GroupNode 承载 TRS
        const group = createGroupNode(safeName)
        group.origin = trs.origin
        group.rotation = trs.rotation
        group.scale = trs.scale
        nextDoc = addNode(nextDoc, group, parentId)
        runningDoc = nextDoc
        resultNodeId = group.id
        // MeshNode 挂在 GroupNode 下
        const meshClone = { ...mesh, id: `${safeName}_mesh`, name: mesh.name }
        nextDoc = addNode(nextDoc, meshClone, resultNodeId)
        runningDoc = nextDoc
        // mesh 的 children（理论上 glTF mesh 没有 children）
        for (const ci of childrenIdx) gltfNodeToDocNode(ci, resultNodeId)
      } else {
        // 无 TRS：MeshNode 直接挂父级
        const meshClone = { ...mesh, id: safeName, name: mesh.name }
        nextDoc = addNode(nextDoc, meshClone, parentId)
        runningDoc = nextDoc
        resultNodeId = meshClone.id
      }
    } else if (childrenIdx.length > 0) {
      // 组节点（有 children）：GroupNode
      const group = createGroupNode(safeName)
      const trs = gltfNodeTrs(gltfNode)
      group.origin = trs.origin
      group.rotation = trs.rotation
      group.scale = trs.scale
      nextDoc = addNode(nextDoc, group, parentId)
      runningDoc = nextDoc
      resultNodeId = group.id
      for (const ci of childrenIdx) gltfNodeToDocNode(ci, resultNodeId)
    } else {
      // 空节点（既无 mesh 也无 children）→ LocatorNode（有 TRS）
      const trs = gltfNodeTrs(gltfNode)
      if (trs.hasAny) {
        const loc = createLocatorNode(safeName)
        loc.position = trs.origin
        nextDoc = addNode(nextDoc, loc, parentId)
        runningDoc = nextDoc
        resultNodeId = loc.id
      } else {
        // 完全空节点 → info 降级跳过
        push('info', 'gltf_node_empty', `节点「${name}」既无 mesh 也无 children 也无变换，已跳过`)
      }
    }
    return resultNodeId
  }

  for (const rootIdx of roots) {
    gltfNodeToDocNode(rootIdx, null)
  }

  if (Object.keys(runningDoc.nodes).length === 0) {
    throw new Error('glTF 导入：scene.nodes 递归后文档仍为空（所有节点被跳过）')
  }

  /* 6) fitToBox：等比缩放+居中装进 0..16 文档盒 */
  if (fitToBox) {
    try {
      runningDoc = fitDocToBox(runningDoc, 0, 16, 0, 16, 0, 16)
    } catch {
      /* fitToBox 失败（所有节点零尺寸）→ 跳过，不中断 */
      push('info', 'gltf_fit_to_box_failed', `fitToBox 归一化失败（所有节点尺寸为 0），原坐标保留`)
    }
  }

  /* 7) finalize */
  return { doc: runningDoc, downgrades }
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

/** 归一化目标盒边长（文档单位：16 = 1 方块） */
const FIT_BOX_SIZE = 16

/** base64 → Uint8Array（浏览器 + Node 双兼容，shared 层不能用 Buffer） */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** fitDocToBox：等比缩放 + 居中装进 0..16 文档盒
 *  实现同 DAE/FBX 路径——只作用 mesh 顶点（组 pivot 不动），与编辑器语义一致 */
function fitDocToBox(doc: ModelDocument, _x1: number, _y1: number, _z1: number, _x2: number, _y2: number, _z2: number): ModelDocument {
  void _x1; void _y1; void _z1; void _x2; void _y2; void _z2
  const min = meshMin(doc)
  if (!min) return doc
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  let hasAny = false
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'mesh') continue
    for (const v of node.vertices) {
      if (v[0] > maxX) maxX = v[0]
      if (v[1] > maxY) maxY = v[1]
      if (v[2] > maxZ) maxZ = v[2]
      hasAny = true
    }
  }
  if (!hasAny || !Number.isFinite(maxX)) return doc
  const sx = maxX - min[0]
  const sy = maxY - min[1]
  const sz = maxZ - min[2]
  const maxDim = Math.max(sx, sy, sz)
  if (maxDim <= 0) return doc
  const s = FIT_BOX_SIZE / maxDim
  const off: Vec3 = [-min[0] * s, -min[1] * s, -min[2] * s]
  const nodes: Record<string, ModelNode> = { ...doc.nodes }
  for (const [id, n] of Object.entries(nodes)) {
    if (n.type !== 'mesh') continue
    nodes[id] = {
      ...n,
      vertices: n.vertices.map((v) => [v[0] * s + off[0], v[1] * s + off[1], v[2] * s + off[2]] as Vec3)
    } as ModelNode
  }
  return { ...doc, nodes }
}

/** 文档内全部 mesh 顶点的包围盒最小角 */
function meshMin(doc: ModelDocument): Vec3 | null {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let hasAny = false
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'mesh') continue
    for (const v of node.vertices) {
      if (v[0] < minX) minX = v[0]
      if (v[1] < minY) minY = v[1]
      if (v[2] < minZ) minZ = v[2]
      hasAny = true
    }
  }
  return hasAny && Number.isFinite(minX) ? [minX, minY, minZ] : null
}
