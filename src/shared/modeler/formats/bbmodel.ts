/**
 * .bbmodel 互操作编解码（方案 §4.1 formats/bbmodel.ts，P5-bbmodel）。
 *
 * 产物契约：Blockbench 项目文件（.bbmodel）的文档化子集——
 * meta.format_version / meta.model_format、box_uv、resolution、
 * elements（立方体 + mesh 网格）、outliner（组/骨骼树）、textures（内嵌 data URL）、
 * animations（骨骼三通道关键帧）、display（java_block 槽位）。
 * clean-room 红线：仅依据公开格式规范与社区公开记载独立实现，
 * 不读取、不复制任何第三方编辑器源码。
 *
 * 与旧 src/shared/utils/bbmodel.ts 的关系：旧模块是「内容管线一次性有损转换」
 * （bbmodel → ModelAsset，丢组/多贴图/动画）；本模块是「建模器文档层双向互操作」，
 * 组/骨骼/多贴图/动画子集全保留。旧链路维持不变（B1 导入资产仍在用）。
 *
 * 坐标/旋转语义：bbmodel 与 Minecraft 模型 JSON 同体系（16 单位 = 1 方块、
 * Y 轴向上、角度制三轴欧拉），与文档模型一致，全部直通，无 Bedrock 式取反。
 *
 * UV 语义：bbmodel 逐面 uv 以项目 resolution 为坐标空间；文档 FaceBinding.uv
 * 为贴图像素坐标、ModelTexture.uvSize 记录 UV 画布尺寸。导入时 uv 原样保留并
 * 把 resolution 记到每张贴图的 uvSize，导出时按 resolution 原样写回，往返不丢。
 *
 * 版本门禁（meta.format_version）：
 * - 缺失 → info 告警继续（早期文件可解析子集不变）；
 * - < 3.6 → 拒绝（3.6 前 outliner/动画结构不同，静默错读比报错更糟）；
 * - 3.6–4.x → 接受（本实现覆盖的文档化子集）；
 * - ≥ 5.0 → warning 告警继续（子集字段稳定，新字段透传不进文档，提示可能有损失）。
 */
import { MODELER_EDITOR_VERSION } from '../document'
import { isIdentityEasing } from '../curve'
import type {
  CubeNode,
  FaceRotation,
  FormatId,
  GroupNode,
  Interpolation,
  Keyframe,
  MeshFace,
  MeshNode,
  ModelAnimation,
  ModelDocument,
  ModelNode,
  ModelTexture,
  NodeId,
  Vec2,
  Vec3
} from '../types'
import { FACE_NAMES } from '../types'
import { boxUvFaces, cubeSize } from '../uv'
import type { UvRect } from '../uv'
import type { FormatDowngrade, FormatExportResult, FormatImportResult } from './types'

/* ------------------------------------------------------------------ */
/* .bbmodel 类型（文档化子集；导入侧全部字段可选，运行时校验）              */
/* ------------------------------------------------------------------ */

export interface BbmodelFaceJson {
  uv?: number[]
  /** textures 数组下标；null/缺省 = 无贴图面 */
  texture?: number | null
  rotation?: number
}

/** mesh 元素面（命名面表值；与立方体逐面结构不同体系） */
export interface BbmodelMeshFaceJson {
  /** 顶点 uuid → uv（贴图像素坐标，与 resolution 同空间） */
  uv?: Record<string, number[]>
  /** 顶点 uuid 列表；子集支持 3/4，ngon 导入侧扇形三角化 */
  vertices?: string[]
  /** textures 数组下标；null/缺省 = 无贴图面 */
  texture?: number | null
}

export interface BbmodelElementJson {
  uuid?: string
  name?: string
  type?: string
  from?: number[]
  to?: number[]
  /** 旋转中心（缺省立方体中心由导出方保证；导入缺省回退 [8,8,8]） */
  origin?: number[]
  /** 三轴角度（度） */
  rotation?: number[]
  inflate?: number
  shade?: boolean
  /** 元素级 box-uv 开关（全局 box_uv 的补充） */
  box_uv?: boolean
  /** box-uv 十字左上角 */
  uv_offset?: number[]
  /** 立方体逐面（键=面名）或 mesh 命名面表（键=面 uuid），按 type 分派 */
  faces?: Record<string, BbmodelFaceJson | BbmodelMeshFaceJson | null>
  /** mesh 元素：顶点 uuid → 相对 origin 的偏移坐标（公开格式规范） */
  vertices?: Record<string, number[]>
}

/** outliner 树条目：字符串 = 元素 uuid；对象 = 组/骨骼 */
export type BbmodelOutlinerEntry = string | BbmodelOutlinerGroupJson

export interface BbmodelOutlinerGroupJson {
  uuid?: string
  name?: string
  origin?: number[]
  rotation?: number[]
  children?: BbmodelOutlinerEntry[]
}

export interface BbmodelTextureJson {
  uuid?: string
  id?: string
  path?: string
  name?: string
  /** data:image/png;base64,...（内嵌贴图） */
  origin?: string
  width?: number
  height?: number
  visible?: boolean
}

export interface BbmodelKeyframeJson {
  channel?: string
  time?: number
  interpolation?: string
  data_points?: unknown[]
}

export interface BbmodelAnimatorJson {
  name?: string
  type?: string
  keyframes?: BbmodelKeyframeJson[]
}

export interface BbmodelAnimationJson {
  uuid?: string
  name?: string
  loop?: string
  length?: number
  animators?: Record<string, BbmodelAnimatorJson | null>
}

export interface BbmodelDocJson {
  meta?: { format_version?: string; model_format?: string }
  name?: string
  box_uv?: boolean
  resolution?: { width?: number; height?: number }
  elements?: BbmodelElementJson[]
  outliner?: BbmodelOutlinerEntry[]
  textures?: BbmodelTextureJson[]
  animations?: BbmodelAnimationJson[]
  display?: Record<string, unknown>
}

/** formatData.bbmodel 透传结构（导入→编辑→导出往返不丢） */
export interface BbmodelFormatData {
  formatVersion?: string
  modelFormat?: string
  boxUv?: boolean
}

/* ------------------------------------------------------------------ */
/* 小工具（编解码模块自包含约定，与 bedrock.ts 同形）                       */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

function vec3(raw: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(raw)) {
    return [num(raw[0], fallback[0]), num(raw[1], fallback[1]), num(raw[2], fallback[2])]
  }
  return [...fallback]
}

function safeIdPart(raw: string, fallback: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_-]/g, '_')
  return s.length > 0 ? s : fallback
}

/** 全局唯一 id：冲突时追加 _2/_3…（导入产物的 id 全部确定性可重放） */
function uniqueId(base: string, used: Set<string>): string {
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}_${n++}`
  used.add(id)
  return id
}

function hasNonZero(v: Vec3): boolean {
  return v.some((n) => n !== 0)
}

/** 关键帧数据点 → 数值三元组（molang 字符串/非数值返回 null） */
function dataPointVec3(raw: unknown): Vec3 | null {
  if (!isRecord(raw)) return null
  const x = Number(raw.x)
  const y = Number(raw.y)
  const z = Number(raw.z)
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return [round3(x), round3(y), round3(z)]
}

/* ------------------------------------------------------------------ */
/* 版本门禁                                                              */
/* ------------------------------------------------------------------ */

/**
 * meta.format_version 门禁（见文件头注释）。拒绝时抛错，接受/降级返回告警。
 */
function gateFormatVersion(
  meta: BbmodelDocJson['meta'],
  downgrades: FormatDowngrade[]
): void {
  const raw = meta?.format_version
  if (typeof raw !== 'string' || raw.trim() === '') {
    downgrades.push({
      severity: 'info',
      code: 'version_unknown',
      message: '文件缺少 meta.format_version，按 4.x 文档化子集解析'
    })
    return
  }
  const m = /^(\d+)(?:\.(\d+))?/.exec(raw.trim())
  const major = m ? Number(m[1]) : NaN
  const minor = m?.[2] !== undefined ? Number(m[2]) : 0
  if (!Number.isFinite(major)) {
    downgrades.push({
      severity: 'info',
      code: 'version_unknown',
      message: `meta.format_version「${raw}」无法解析，按 4.x 文档化子集解析`
    })
    return
  }
  if (major < 3 || (major === 3 && minor < 6)) {
    throw new Error(
      `bbmodel 格式版本 ${raw} 过旧（< 3.6），outliner/动画结构不兼容，请用新版 Blockbench 另存后导入`
    )
  }
  if (major >= 5) {
    downgrades.push({
      severity: 'warning',
      code: 'version_too_new',
      message: `bbmodel 格式版本 ${raw} 高于已验证范围（3.6–4.x），按文档化子集解析，新增字段可能丢失`
    })
  }
}

/** model_format → 文档 FormatId（options.format 显式覆盖优先） */
function docFormatOf(modelFormat: string | undefined): FormatId {
  switch (modelFormat) {
    case 'java_block':
      return 'java_block'
    case 'geckolib':
      return 'geckolib'
    case 'bedrock':
    case 'bedrock_block':
    case 'modded_entity':
      return 'bedrock_entity'
    default:
      return 'free'
  }
}

/* ------------------------------------------------------------------ */
/* 导入：.bbmodel → ModelDocument                                       */
/* ------------------------------------------------------------------ */

export interface BbmodelImportOptions {
  /** 注入：固定 meta 时间戳（测试确定性） */
  now?: number
  /** 覆盖文档 format 标记（缺省按 meta.model_format 推导） */
  format?: FormatId
  /** 覆盖文档 id（缺省取文件 name 字段清洗） */
  id?: string
}

export function bbmodelToDocument(
  input: string | BbmodelDocJson,
  options?: BbmodelImportOptions
): FormatImportResult {
  let data: unknown = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input)
    } catch (e) {
      throw new Error(`.bbmodel 解析失败：${String(e)}`)
    }
  }
  if (!isRecord(data) || (!Array.isArray(data.elements) && !Array.isArray(data.outliner))) {
    throw new Error('不是合法的 .bbmodel 文件：缺少 elements/outliner')
  }
  const src = data as BbmodelDocJson
  const downgrades: FormatDowngrade[] = []
  gateFormatVersion(src.meta, downgrades)

  const now = options?.now ?? Date.now()
  const resW = num(src.resolution?.width, 16) || 16
  const resH = num(src.resolution?.height, 16) || 16
  const boxUvGlobal = src.box_uv === true

  /* ---- 贴图：数组下标 → TextureId（uuid/id/tex_N 确定性派生） ---- */
  const usedIds = new Set<string>()
  const textures: Record<string, ModelTexture> = {}
  const texIdByIndex: string[] = []
  const rawTextures = Array.isArray(src.textures) ? src.textures : []
  rawTextures.forEach((raw, i) => {
    const t = isRecord(raw) ? raw : {}
    const id = uniqueId(
      safeIdPart(typeof t.uuid === 'string' ? t.uuid : typeof t.id === 'string' ? t.id : '', `tex_${i}`),
      usedIds
    )
    const name = typeof t.name === 'string' && t.name ? t.name.replace(/\.png$/i, '') : `贴图 ${i + 1}`
    const embedded = typeof t.origin === 'string' && t.origin.startsWith('data:')
    // 独立 PNG 引用（path）保留为 file 元数据（POSIX 规范化），导出写回往返不丢；
    // 未内嵌的外链贴图由主进程导入前预解引用，走到这里仍无 data 说明读盘失败
    const file =
      typeof t.path === 'string' && t.path.trim() !== '' ? t.path.trim().replace(/\\/g, '/') : undefined
    if (file && !embedded) {
      downgrades.push({
        severity: 'warning',
        code: 'texture_file_unresolved',
        message: `贴图「${name}」引用的外部文件「${file}」未能读取，已按空白贴图导入`
      })
    }
    textures[id] = {
      id,
      name,
      width: num(t.width, resW) || resW,
      height: num(t.height, resH) || resH,
      data: embedded ? (t.origin as string) : '',
      ...(file ? { file } : {}),
      uvSize: [resW, resH],
      visible: t.visible !== false
    }
    texIdByIndex.push(id)
  })

  /* ---- 元素（立方体/网格）：uuid → 节点 id，outliner 引用同键 ---- */
  const nodes: Record<NodeId, ModelNode> = {}
  // cube 与 mesh 共用同一张 uuid→id 表（outliner 字符串引用不区分元素类型）
  const cubeIdByUuid = new Map<string, NodeId>()
  const rawElements = Array.isArray(src.elements) ? src.elements : []
  rawElements.forEach((raw, i) => {
    const el = isRecord(raw) ? raw : {}

    /* mesh 元素：命名顶点表（相对 origin 偏移）→ MeshNode 父空间顶点 */
    if (el.type === 'mesh') {
      const uuid = typeof el.uuid === 'string' && el.uuid ? el.uuid : `mesh_${i}`
      const id = uniqueId(safeIdPart(uuid, `mesh_${i}`), usedIds)
      const name = typeof el.name === 'string' && el.name ? el.name : `网格 ${i + 1}`
      const origin = vec3(el.origin, [0, 0, 0])
      const rawVerts = isRecord(el.vertices) ? el.vertices : {}
      const indexByKey = new Map<string, number>()
      const vertices: Vec3[] = []
      for (const [key, off] of Object.entries(rawVerts)) {
        const o = vec3(off, [0, 0, 0])
        indexByKey.set(key, vertices.length)
        vertices.push([origin[0] + o[0], origin[1] + o[1], origin[2] + o[2]])
      }
      const faces: MeshFace[] = []
      const rawMeshFaces = isRecord(el.faces) ? el.faces : {}
      for (const [faceKey, rawFace] of Object.entries(rawMeshFaces)) {
        if (!isRecord(rawFace)) continue
        const vertKeys = (Array.isArray(rawFace.vertices) ? rawFace.vertices : []).filter(
          (v): v is string => typeof v === 'string'
        )
        const mapped: number[] = []
        let missingRef = false
        for (const key of vertKeys) {
          const idx = indexByKey.get(key)
          if (idx === undefined) {
            missingRef = true
            break
          }
          mapped.push(idx)
        }
        if (missingRef) {
          downgrades.push({
            severity: 'warning',
            code: 'mesh_face_vertex_missing',
            nodeId: id,
            message: `网格「${name}」的面「${faceKey}」引用了不存在的顶点，该面已跳过`
          })
          continue
        }
        if (mapped.length < 3) {
          downgrades.push({
            severity: 'warning',
            code: 'mesh_face_invalid',
            nodeId: id,
            message: `网格「${name}」的面「${faceKey}」顶点数 ${mapped.length} 不足 3，该面已跳过`
          })
          continue
        }
        const rawUv = isRecord(rawFace.uv) ? rawFace.uv : {}
        const uvOf = (key: string): Vec2 => {
          const u = rawUv[key]
          return [num(Array.isArray(u) ? u[0] : undefined, 0), num(Array.isArray(u) ? u[1] : undefined, 0)]
        }
        const texIndex =
          typeof rawFace.texture === 'number' && rawFace.texture >= 0 ? Math.floor(rawFace.texture) : null
        const texture = texIndex !== null ? texIdByIndex[texIndex] : undefined
        if (texIndex !== null && texture === undefined) {
          downgrades.push({
            severity: 'warning',
            code: 'texture_index_missing',
            nodeId: id,
            message: `网格「${name}」的面「${faceKey}」引用贴图下标 ${texIndex}，超出贴图数组范围，已按无贴图导入`
          })
        }
        const texField = texture !== undefined ? { texture } : {}
        if (mapped.length <= 4) {
          faces.push({ vertices: mapped, uv: vertKeys.map(uvOf), ...texField })
        } else {
          // ngon 超出三角/四边子集：扇形三角化保留几何，拓扑降级告知
          downgrades.push({
            severity: 'info',
            code: 'mesh_ngon_triangulated',
            nodeId: id,
            message: `网格「${name}」的面「${faceKey}」含 ${mapped.length} 顶点（ngon），已扇形三角化为 ${mapped.length - 2} 个三角面`
          })
          for (let k = 1; k + 1 < mapped.length; k++) {
            faces.push({
              vertices: [mapped[0]!, mapped[k]!, mapped[k + 1]!],
              uv: [uvOf(vertKeys[0]!), uvOf(vertKeys[k]!), uvOf(vertKeys[k + 1]!)],
              ...texField
            })
          }
        }
      }
      const node: MeshNode = {
        id,
        type: 'mesh',
        name,
        parent: null,
        visible: true,
        locked: false,
        vertices,
        faces,
        origin,
        rotation: vec3(el.rotation, [0, 0, 0])
      }
      nodes[id] = node
      cubeIdByUuid.set(uuid, id)
      return
    }

    if (el.type !== undefined && el.type !== 'cube') {
      downgrades.push({
        severity: 'warning',
        code: 'element_type_skipped',
        message: `元素「${typeof el.name === 'string' ? el.name : i + 1}」类型 ${String(el.type)} 不在立方体/网格子集内，已跳过`
      })
      return
    }
    const uuid = typeof el.uuid === 'string' && el.uuid ? el.uuid : `cube_${i}`
    const id = uniqueId(safeIdPart(uuid, `cube_${i}`), usedIds)
    const from = vec3(el.from, [0, 0, 0])
    const to = vec3(el.to, [0, 0, 0])
    const node: CubeNode = {
      id,
      type: 'cube',
      name: typeof el.name === 'string' && el.name ? el.name : `立方体 ${i + 1}`,
      parent: null,
      visible: true,
      locked: false,
      from,
      to,
      origin: vec3(el.origin, [8, 8, 8]),
      rotation: vec3(el.rotation, [0, 0, 0]),
      ...(typeof el.inflate === 'number' && Number.isFinite(el.inflate) ? { inflate: el.inflate } : {}),
      ...(el.shade === false ? { shade: false } : {}),
      faces: {}
    }

    /* UV：逐面直通；box-uv 模式下面缺 uv 时按十字展开补齐 */
    const useBox = el.box_uv === true || (boxUvGlobal && el.box_uv !== false)
    const size = cubeSize(node).map((n) => Math.abs(n)) as Vec3
    if (useBox) {
      const offset: Vec2 = [
        num(Array.isArray(el.uv_offset) ? el.uv_offset[0] : undefined, 0),
        num(Array.isArray(el.uv_offset) ? el.uv_offset[1] : undefined, 0)
      ]
      node.boxUv = { uvOffset: offset }
      const cross = boxUvFaces(size, offset)
      for (const face of FACE_NAMES) {
        node.faces[face] = { uv: [...cross[face]] as UvRect }
      }
    }
    const rawFaces = isRecord(el.faces) ? el.faces : {}
    let hasFaceUv = false
    for (const face of FACE_NAMES) {
      const rf = rawFaces[face]
      if (!isRecord(rf)) {
        // box 模式已补六面；per-face 模式缺键 = 剔面
        if (!useBox) delete node.faces[face]
        continue
      }
      hasFaceUv = true
      const uvRaw = Array.isArray(rf.uv) ? rf.uv : []
      const uv: UvRect = [num(uvRaw[0], 0), num(uvRaw[1], 0), num(uvRaw[2], 0), num(uvRaw[3], 0)]
      const texIndex = typeof rf.texture === 'number' && rf.texture >= 0 ? Math.floor(rf.texture) : null
      const texture = texIndex !== null ? texIdByIndex[texIndex] : undefined
      if (texIndex !== null && texture === undefined) {
        downgrades.push({
          severity: 'warning',
          code: 'texture_index_missing',
          nodeId: id,
          message: `立方体「${node.name}」的 ${face} 面引用贴图下标 ${texIndex}，超出贴图数组范围，已按无贴图导入`
        })
      }
      const rot = rf.rotation
      node.faces[face] = {
        uv,
        ...(texture !== undefined ? { texture } : {}),
        ...(rot === 90 || rot === 180 || rot === 270 ? { rotation: rot as FaceRotation } : {})
      }
    }
    // box 模式但文件里写了逐面 uv：以文件为准，boxUv 仅作编辑模式提示
    if (useBox && hasFaceUv) {
      for (const face of FACE_NAMES) {
        const rf = rawFaces[face]
        if (!isRecord(rf)) delete node.faces[face]
      }
    }

    nodes[id] = node
    cubeIdByUuid.set(uuid, id)
  })

  /* ---- outliner：组/骨骼树（字符串 = 立方体引用，对象 = 组） ---- */
  const root: NodeId[] = []
  const placed = new Set<NodeId>()
  const groupIdByUuid = new Map<string, NodeId>()

  const placeCubeRef = (uuid: string, parentId: NodeId | null, siblings: NodeId[]): void => {
    const cubeId = cubeIdByUuid.get(uuid)
    if (!cubeId) {
      downgrades.push({
        severity: 'warning',
        code: 'outliner_ref_missing',
        message: `outliner 引用的元素 uuid「${uuid}」不存在，已跳过`
      })
      return
    }
    if (placed.has(cubeId)) return // 重复引用取首个位置
    const cube = nodes[cubeId]!
    cube.parent = parentId
    siblings.push(cubeId)
    placed.add(cubeId)
  }

  const walkOutliner = (entries: BbmodelOutlinerEntry[], parentId: NodeId | null, siblings: NodeId[]): void => {
    for (const entry of entries) {
      if (typeof entry === 'string') {
        placeCubeRef(entry, parentId, siblings)
        continue
      }
      if (!isRecord(entry)) continue
      const name = typeof entry.name === 'string' && entry.name ? entry.name : '组'
      const uuid = typeof entry.uuid === 'string' && entry.uuid ? entry.uuid : ''
      const id = uniqueId(safeIdPart(uuid || name, 'group'), usedIds)
      const group: GroupNode = {
        id,
        type: 'group',
        name,
        parent: parentId,
        visible: true,
        locked: false,
        children: [],
        origin: vec3(entry.origin, [0, 0, 0]),
        rotation: vec3(entry.rotation, [0, 0, 0])
      }
      nodes[id] = group
      siblings.push(id)
      if (uuid) groupIdByUuid.set(uuid, id)
      if (Array.isArray(entry.children)) walkOutliner(entry.children, id, group.children)
    }
  }
  if (Array.isArray(src.outliner)) walkOutliner(src.outliner, null, root)

  /* 未被 outliner 引用的立方体 → 顶层兜底（容忍残缺文件） */
  for (const cubeId of cubeIdByUuid.values()) {
    if (!placed.has(cubeId)) {
      root.push(cubeId)
      placed.add(cubeId)
    }
  }

  /* ---- 动画：animators 键 = 组 uuid → 组节点 id ---- */
  const animations: Record<string, ModelAnimation> = {}
  const rawAnims = Array.isArray(src.animations) ? src.animations : []
  for (const rawAnim of rawAnims) {
    if (!isRecord(rawAnim)) continue
    const animName = typeof rawAnim.name === 'string' && rawAnim.name ? rawAnim.name : 'animation'
    const ctx = `动画「${animName}」`
    const channels: ModelAnimation['channels'] = {}
    let maxKeyTime = 0
    const rawAnimators = isRecord(rawAnim.animators) ? rawAnim.animators : {}
    for (const [animatorKey, rawAnimator] of Object.entries(rawAnimators)) {
      if (!isRecord(rawAnimator)) continue
      const nodeId = groupIdByUuid.get(animatorKey)
      if (!nodeId) {
        downgrades.push({
          severity: 'warning',
          code: 'animator_target_missing',
          message: `${ctx} 的动画目标「${rawAnimator.name ?? animatorKey}」在 outliner 中不存在，其通道已跳过`
        })
        continue
      }
      const nodeChannels: ModelAnimation['channels'][string] = {}
      const keyframes = Array.isArray(rawAnimator.keyframes) ? rawAnimator.keyframes : []
      for (const kf of keyframes) {
        if (!isRecord(kf)) continue
        const channel = kf.channel
        if (channel !== 'rotation' && channel !== 'position' && channel !== 'scale') continue
        const t = typeof kf.time === 'number' && Number.isFinite(kf.time) ? kf.time : 0
        const points = Array.isArray(kf.data_points) ? kf.data_points : []
        if (points.length === 0) continue
        if (points.length > 1) {
          downgrades.push({
            severity: 'info',
            code: 'keyframe_multi_points',
            message: `${ctx} 骨骼「${(nodes[nodeId] as GroupNode).name}」的 ${channel} 通道含多数据点关键帧，仅取首点`
          })
        }
        const vec = dataPointVec3(points[0])
        if (!vec) {
          downgrades.push({
            severity: 'warning',
            code: 'keyframe_molang',
            message: `${ctx} 骨骼「${(nodes[nodeId] as GroupNode).name}」的 ${channel} 通道含 molang/非数值关键帧，已跳过`
          })
          continue
        }
        let interpolation: Interpolation = 'linear'
        if (kf.interpolation === 'catmullrom' || kf.interpolation === 'step') {
          interpolation = kf.interpolation
        } else if (typeof kf.interpolation === 'string' && kf.interpolation !== 'linear') {
          downgrades.push({
            severity: 'info',
            code: 'interpolation_degraded',
            message: `${ctx} 骨骼「${(nodes[nodeId] as GroupNode).name}」的 ${channel} 通道插值 ${kf.interpolation} 不在子集内，已按 linear 导入`
          })
        }
        const key: Keyframe = { time: round3(t), value: vec, interpolation }
        ;(nodeChannels[channel] ??= []).push(key)
        if (key.time > maxKeyTime) maxKeyTime = key.time
      }
      for (const ch of Object.keys(nodeChannels) as (keyof typeof nodeChannels)[]) {
        nodeChannels[ch]!.sort((a, b) => a.time - b.time)
      }
      if (Object.keys(nodeChannels).length > 0) channels[nodeId] = nodeChannels
    }

    const animId = uniqueId(
      safeIdPart(typeof rawAnim.uuid === 'string' && rawAnim.uuid ? rawAnim.uuid : animName, 'anim'),
      usedIds
    )
    const loop = rawAnim.loop === 'loop' || rawAnim.loop === 'hold' ? rawAnim.loop : 'once'
    animations[animId] = {
      id: animId,
      name: animName,
      length:
        typeof rawAnim.length === 'number' && Number.isFinite(rawAnim.length)
          ? round3(rawAnim.length)
          : round3(maxKeyTime),
      loop,
      channels
    }
  }

  /* ---- 文档装配 ---- */
  const bbmodelData: BbmodelFormatData = {
    ...(typeof src.meta?.format_version === 'string' ? { formatVersion: src.meta.format_version } : {}),
    ...(typeof src.meta?.model_format === 'string' ? { modelFormat: src.meta.model_format } : {}),
    ...(boxUvGlobal ? { boxUv: true } : {})
  }
  const docId = options?.id ?? safeIdPart(typeof src.name === 'string' ? src.name : '', 'bbmodel')
  const doc: ModelDocument = {
    schemaVersion: 1,
    id: docId || 'bbmodel',
    name: typeof src.name === 'string' && src.name ? src.name : docId || 'bbmodel 模型',
    format: options?.format ?? docFormatOf(src.meta?.model_format),
    settings: {
      uvMode: boxUvGlobal ? 'box' : 'per_face',
      textureSize: [resW, resH],
      ...(boxUvGlobal ? { boxUv: { width: resW, height: resH } } : {})
    },
    nodes,
    root,
    textures,
    animations,
    ...(isRecord(src.display) && Object.keys(src.display).length > 0
      ? { display: src.display as ModelDocument['display'] }
      : {}),
    formatData: { bbmodel: bbmodelData },
    meta: { createdAt: now, updatedAt: now, editorVersion: MODELER_EDITOR_VERSION }
  }
  return { doc, downgrades }
}

/* ------------------------------------------------------------------ */
/* 导出：ModelDocument → .bbmodel                                       */
/* ------------------------------------------------------------------ */

export function documentToBbmodel(doc: ModelDocument): FormatExportResult<BbmodelDocJson> {
  const downgrades: FormatDowngrade[] = []

  /* 贴图数组 + 下标映射 */
  const texList = Object.values(doc.textures)
  const texIndexById = new Map<string, number>()
  const textures: BbmodelTextureJson[] = texList.map((tex, i) => {
    texIndexById.set(tex.id, i)
    return {
      uuid: tex.id,
      id: tex.id,
      // 独立 PNG 引用随导出写回（主进程据此把 PNG 物化到导出目录，随格式导出落地）
      path: tex.file ?? '',
      name: `${tex.name}.png`,
      origin: tex.data,
      width: tex.width,
      height: tex.height,
      visible: tex.visible
    }
  })

  /* 元素 */
  const elements: BbmodelElementJson[] = []
  for (const node of Object.values(doc.nodes)) {
    if (node.type === 'locator') {
      downgrades.push({
        severity: 'info',
        code: 'locator_dropped',
        nodeId: node.id,
        message: `定位器「${node.name}」不在 .bbmodel 文档化子集内，已跳过`
      })
      continue
    }
    if (node.type === 'mesh') {
      /* MeshNode 父空间顶点 → 命名顶点表（相对 origin 偏移，公开格式规范）；
         顶点/面键确定性派生（节点id_vN / _fN），往返不丢 */
      const vertKey = (vi: number): string => `${node.id}_v${vi}`
      const vertices: Record<string, number[]> = {}
      node.vertices.forEach((v, vi) => {
        vertices[vertKey(vi)] = [
          round3(v[0] - node.origin[0]),
          round3(v[1] - node.origin[1]),
          round3(v[2] - node.origin[2])
        ]
      })
      const meshFaces: Record<string, BbmodelMeshFaceJson> = {}
      node.faces.forEach((face, fi) => {
        const uv: Record<string, number[]> = {}
        face.vertices.forEach((vi, k) => {
          const u = face.uv[k] ?? ([0, 0] as Vec2)
          uv[vertKey(vi)] = [round3(u[0]), round3(u[1])]
        })
        meshFaces[`${node.id}_f${fi}`] = {
          uv,
          vertices: face.vertices.map(vertKey),
          texture: face.texture !== undefined ? (texIndexById.get(face.texture) ?? null) : null
        }
      })
      elements.push({
        uuid: node.id,
        name: node.name,
        type: 'mesh',
        origin: [...node.origin],
        ...(hasNonZero(node.rotation) ? { rotation: [...node.rotation] } : {}),
        vertices,
        faces: meshFaces
      })
      continue
    }
    if (node.type !== 'cube') continue
    if (node.boxUv) {
      downgrades.push({
        severity: 'info',
        code: 'box_uv_flattened',
        nodeId: node.id,
        message: `立方体「${node.name}」的 box-uv 绑定已按逐面 UV 展开导出（视觉不变，编辑模式降级）`
      })
    }
    const faces: Record<string, BbmodelFaceJson> = {}
    for (const face of FACE_NAMES) {
      const binding = node.faces[face]
      if (!binding) continue // 缺键 = 剔面
      faces[face] = {
        ...(binding.uv ? { uv: [...binding.uv] } : {}),
        texture: binding.texture !== undefined ? (texIndexById.get(binding.texture) ?? null) : null,
        ...(binding.rotation !== undefined && binding.rotation !== 0 ? { rotation: binding.rotation } : {})
      }
    }
    const el: BbmodelElementJson = {
      uuid: node.id,
      name: node.name,
      type: 'cube',
      from: [...node.from],
      to: [...node.to],
      origin: [...node.origin],
      ...(hasNonZero(node.rotation) ? { rotation: [...node.rotation] } : {}),
      ...(node.inflate !== undefined ? { inflate: node.inflate } : {}),
      ...(node.shade === false ? { shade: false } : {}),
      faces
    }
    elements.push(el)
  }

  /* outliner：root/children 递归还原（组对象 + 元素 uuid 字符串） */
  const buildEntry = (nodeId: NodeId): BbmodelOutlinerEntry | null => {
    const node = doc.nodes[nodeId]
    if (!node) return null
    if (node.type === 'locator') return null // 已整体告警
    if (node.type === 'mesh') return node.id // 与立方体同：字符串引用入 outliner
    if (node.type === 'cube') return node.id
    const children: BbmodelOutlinerEntry[] = []
    for (const childId of node.children) {
      const entry = buildEntry(childId)
      if (entry !== null) children.push(entry)
    }
    return {
      uuid: node.id,
      name: node.name,
      origin: [...node.origin],
      ...(hasNonZero(node.rotation) ? { rotation: [...node.rotation] } : {}),
      children
    }
  }
  const outliner: BbmodelOutlinerEntry[] = []
  for (const nodeId of doc.root) {
    const entry = buildEntry(nodeId)
    if (entry !== null) outliner.push(entry)
  }

  /* 动画：组节点 → animator（键 = 组 uuid）；非骨骼目标告警跳过 */
  const animations: BbmodelAnimationJson[] = Object.values(doc.animations).map((anim) => {
    const animators: Record<string, BbmodelAnimatorJson> = {}
    for (const [nodeId, nodeChannels] of Object.entries(anim.channels)) {
      const node = doc.nodes[nodeId]
      if (!node || node.type !== 'group') {
        downgrades.push({
          severity: 'warning',
          code: 'channel_target_not_bone',
          nodeId,
          message: `动画「${anim.name}」的通道目标「${node?.name ?? nodeId}」不是骨骼（组节点），已跳过`
        })
        continue
      }
      const keyframes: BbmodelKeyframeJson[] = []
      for (const channel of ['rotation', 'position', 'scale'] as const) {
        const keys = nodeChannels[channel]
        if (!keys) continue
        if (keys.some((k) => k.easing && !isIdentityEasing(k.easing))) {
          downgrades.push({
            severity: 'warning',
            code: 'easing_dropped',
            nodeId,
            message: `动画「${anim.name}」骨骼「${node.name}」的 ${channel} 通道含自定义缓动，.bbmodel 子集不支持，导出后该区间按线性插值`
          })
        }
        for (const k of keys) {
          keyframes.push({
            channel,
            time: round3(k.time),
            interpolation: k.interpolation,
            data_points: [{ x: round3(k.value[0]), y: round3(k.value[1]), z: round3(k.value[2]) }]
          })
        }
      }
      keyframes.sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
      animators[node.id] = { name: node.name, type: 'bone', keyframes }
    }
    return {
      uuid: anim.id,
      name: anim.name,
      loop: anim.loop,
      length: round3(anim.length),
      animators
    }
  })

  const resW = doc.settings.textureSize?.[0] ?? texList[0]?.width ?? 16
  const resH = doc.settings.textureSize?.[1] ?? texList[0]?.height ?? 16
  const modelFormat = doc.format === 'java_block' ? 'java_block' : 'free'
  const output: BbmodelDocJson = {
    meta: { format_version: '4.5', model_format: modelFormat },
    name: doc.name || doc.id,
    box_uv: false,
    resolution: { width: resW, height: resH },
    elements,
    outliner,
    textures,
    ...(animations.length > 0 ? { animations } : {}),
    ...(doc.display && Object.keys(doc.display).length > 0 ? { display: { ...doc.display } } : {})
  }
  return { output, downgrades }
}
