/**
 * OptiFine CEM（Custom Entity Models）格式编解码（B5-3，v2 格式长尾）。
 *
 * 产物契约：OptiFine 官方文档公开规范（optifine.readthedocs.io/cem_models.html、
 * cem_parts.html）文档化子集：
 * - .jem（整实体模型）：{ texture?, textureSize?[w,h], shadowSize?, models:[ 模型项 ] }；
 *   模型项 = { part（挂载的实体部位，必需）, id?, baseId?, model?（外部 .jpm 引用）,
 *   attach?, scale? } ∪ 部件定义（见下）；
 * - .jpm（单个部件）：{ invertAxis?, translate?[x,y,z], rotate?[ax,ay,az],
 *   mirrorTexture?, boxes?[], sprites?[], submodel? / submodels?[] }；同一部件定义
 *   亦可内联进 .jem 的模型项（当该模型的 model 字段缺省时）。
 * clean-room 红线：仅依据 OptiFine 官方公开文档独立实现，不读取、不复制任何第三方
 * 编辑器（Blockbench 等）源码。
 *
 * 坐标/旋转语义（导入/导出对称，golden 测试锁定）：
 * - boxes.coordinates = [x, y, z, width, height, depth]（最小角 + 尺寸）→ 文档
 *   from = [x,y,z]、to = [x+w, y+h, z+d]；导出取 min 角与 |尺寸|（容忍换向书写）；
 * - 部件 translate → 组 origin（枢轴），rotate → 组 rotation。OptiFine 属 Java 生态
 *   mod，其 rotate 采用 Java/Minecraft 模型旋转约定，与文档层（同为 Java 锚定）
 *   一致，故直接映射、不取反（Bedrock 的 X/Y 取反约定仅适用于 Bedrock 侧）；
 * - 部件层级：submodel / submodels → 子组节点（随父级移动/旋转，语义一致）；
 * - box UV：textureOffset = 原版盒式十字展开左上角（复用 uv.boxUvFaces）；
 *   uv<Face> = 逐面 [u1,v1,u2,v2]（North=Front、South=Back、West=Left、East=Right）。
 *
 * 不可表达项（导入/导出逐条告警，风格对齐 bedrock codec）：
 * - 几何镜像 invertAxis / mirrorTexture：文档层无镜像能力 → 告警丢弃；
 * - 外部 .jpm 引用（模型项的 model 字段）：导入不解析文件系统 → 告警（仅读内联定义）；
 * - baseId 继承：不展开父属性 → 告警（父属性不并入）；
 * - sprites（3D 精灵）/ sizeAdd / sizesAdd / animations / attach / scale：非几何或超
 *   子集 → 告警逐条丢弃；
 * - 立方体逐盒旋转 / inflate / shade / 面旋转 / cullface / tint / 组缩放 / display /
 *   动画 → 导出告警丢弃（JEM/JPM 盒子无逐盒旋转，仅部件级 rotate）。
 *
 * 与格式注册表的关系：JEM/JPM 无对应 FormatId，与 bedrockAnim/gltf 同为独立互操作
 * codec（见 formats/index.ts）；导入产出 format='free' 的整文档，导出直接读写 JSON。
 */
import { MODELER_EDITOR_VERSION } from '../document'
import { boxUvFaces, cubeSize } from '../uv'
import type { UvRect } from '../uv'
import { FACE_NAMES } from '../types'
import type {
  CubeNode,
  FaceName,
  GroupNode,
  ModelDocument,
  ModelNode,
  NodeId,
  Vec2,
  Vec3
} from '../types'
import type { FormatDowngrade, FormatExportResult, FormatImportResult } from './types'

/* ------------------------------------------------------------------ */
/* JEM / JPM JSON 类型（官方公开规范子集）                               */
/* ------------------------------------------------------------------ */

export interface OptifineBoxJson {
  /** 盒式 UV 十字左上角 [u, v]（与逐面 UV 互斥） */
  textureOffset?: number[]
  /** 逐面 UV [u1,v1,u2,v2]；键 = uv<Face>（Down/Up/North/South/West/East） */
  uvDown?: number[]
  uvUp?: number[]
  uvNorth?: number[]
  uvSouth?: number[]
  uvWest?: number[]
  uvEast?: number[]
  /** 盒位置与尺寸 [x, y, z, width, height, depth]（必需） */
  coordinates?: number[]
  /** 三轴统一尺寸增量（超子集，丢弃） */
  sizeAdd?: number
  /** 逐轴尺寸增量（超子集，丢弃） */
  sizesAdd?: number[]
}

export interface OptifinePartJson {
  /** 部件用贴图路径（.jpm 亦允许携带；往返透传） */
  texture?: string
  /** 贴图尺寸 [width, height]（往返透传） */
  textureSize?: number[]
  /** 要镜像的轴（"xyz" 的子集；文档无镜像能力，丢弃） */
  invertAxis?: string
  /** 部件平移（模型空间整数） */
  translate?: number[]
  /** 部件旋转（度）[angle_x, angle_y, angle_z] */
  rotate?: number[]
  /** 要镜像的贴图轴（"uv" 的子集；丢弃） */
  mirrorTexture?: string
  /** 盒子列表 */
  boxes?: OptifineBoxJson[]
  /** 3D 精灵列表（超子集，丢弃） */
  sprites?: unknown[]
  /** 单个子部件（随父级移动/旋转） */
  submodel?: OptifinePartJson
  /** 子部件列表（随父级移动/旋转） */
  submodels?: OptifinePartJson[]
}

export interface OptifineModelJson extends OptifinePartJson {
  /** 挂载的实体部位（必需） */
  part?: string
  /** 模型 id（可被引用为父级） */
  id?: string
  /** 父模型 id（属性继承；不展开，告警） */
  baseId?: string
  /** 外部 .jpm 部件文件路径（不解析，告警） */
  model?: string
  /** 是否叠加到实体部位而非替换（丢弃） */
  attach?: boolean
  /** 渲染缩放，缺省 1.0（丢弃） */
  scale?: number
  /** 动画列表（超子集，丢弃） */
  animations?: unknown[]
}

export interface OptifineJemJson {
  texture?: string
  textureSize?: number[]
  shadowSize?: number
  models?: OptifineModelJson[]
}

/** formatData.optifine 透传结构（文档级、无节点对应的字段，往返不丢） */
export interface OptifineFormatData {
  /** 源文件类型（导入时区分 jem/jpm；导出不写） */
  kind?: 'jem' | 'jpm'
  texture?: string
  textureSize?: Vec2
  shadowSize?: number
}

/* ------------------------------------------------------------------ */
/* 小工具（编解码模块自包含约定，与 bedrock 同形）                        */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function vec3(raw: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(raw)) return [num(raw[0], fallback[0]), num(raw[1], fallback[1]), num(raw[2], fallback[2])]
  return [...fallback]
}

function hasNonZero(v: Vec3): boolean {
  return v.some((n) => n !== 0)
}

function safeIdPart(raw: string, fallback: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_-]/g, '_')
  return s.length > 0 ? s : fallback
}

/** 全局唯一 id：冲突时追加 _2/_3…（导入产物 id 确定性可重放） */
function uniqueId(base: string, used: Set<string>): string {
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}_${n++}`
  used.add(id)
  return id
}

/** 文档面名 ↔ OptiFine 逐面 UV 键 */
const FACE_TO_UV_KEY: Record<FaceName, string> = {
  down: 'uvDown',
  up: 'uvUp',
  north: 'uvNorth',
  south: 'uvSouth',
  west: 'uvWest',
  east: 'uvEast'
}
const UV_KEY_TO_FACE: Record<string, FaceName> = {
  uvDown: 'down',
  uvUp: 'up',
  uvNorth: 'north',
  uvSouth: 'south',
  uvWest: 'west',
  uvEast: 'east'
}

/** 逐面 UV 键（uv<Face>）集合，用于导入判定是否走逐面模式 */
const PER_FACE_UV_KEYS = Object.keys(UV_KEY_TO_FACE)

/* ------------------------------------------------------------------ */
/* 导入：部件定义 → 组节点子树                                           */
/* ------------------------------------------------------------------ */

interface ImportCtx {
  nodes: Record<NodeId, ModelNode>
  used: Set<string>
  downgrades: FormatDowngrade[]
  /** 见过盒式 UV（textureOffset）的盒子 */
  sawBoxUv: boolean
  /** 见过逐面 UV（uv<Face>）的盒子 */
  sawPerFaceUv: boolean
}

/**
 * UV 模式裁决：全盒式 → 'box'，否则 'per_face'。
 * 文档 uvMode 只是"新建面默认走向"的提示；逐节点绑定（boxUv / faces）始终是事实来源。
 */
function resolveUvMode(ctx: ImportCtx): 'per_face' | 'box' {
  return ctx.sawBoxUv && !ctx.sawPerFaceUv ? 'box' : 'per_face'
}

/** 解析部件子节点的名称候选（JEM 用 part，JPM 用具名参数） */
function partNameOf(part: OptifinePartJson, fallback: string): string {
  const model = part as OptifineModelJson
  const raw = (typeof model.part === 'string' && model.part) || (typeof model.id === 'string' && model.id) || ''
  return raw || fallback
}

/**
 * 导入单个部件定义：递归构建组节点（translate→origin / rotate→rotation /
 * submodel(s)→子组 / boxes→立方体），返回该组 id。
 */
function buildPart(part: OptifinePartJson, name: string, parentId: NodeId | null, ctx: ImportCtx): NodeId {
  const model = part as OptifineModelJson
  const id = uniqueId(safeIdPart(name, 'part'), ctx.used)
  const group: GroupNode = {
    id,
    type: 'group',
    name,
    parent: parentId,
    visible: true,
    locked: false,
    children: [],
    origin: vec3(part.translate, [0, 0, 0]),
    rotation: vec3(part.rotate, [0, 0, 0])
  }
  ctx.nodes[id] = group

  /* 不可表达字段告警 */
  if (typeof part.invertAxis === 'string' && part.invertAxis) {
    ctx.downgrades.push({
      severity: 'warning',
      code: 'invert_axis_dropped',
      nodeId: id,
      message: `部件「${name}」的 invertAxis（几何镜像「${part.invertAxis}」）无文档对应能力，已丢弃`
    })
  }
  if (typeof part.mirrorTexture === 'string' && part.mirrorTexture) {
    ctx.downgrades.push({
      severity: 'info',
      code: 'mirror_texture_dropped',
      nodeId: id,
      message: `部件「${name}」的 mirrorTexture（贴图镜像「${part.mirrorTexture}」）无文档对应能力，已丢弃`
    })
  }
  if (Array.isArray(part.sprites) && part.sprites.length > 0) {
    ctx.downgrades.push({
      severity: 'warning',
      code: 'sprites_dropped',
      nodeId: id,
      message: `部件「${name}」的 ${part.sprites.length} 个 3D 精灵（sprites）不在 v2 子集内，已跳过`
    })
  }
  if (typeof model.baseId === 'string' && model.baseId) {
    ctx.downgrades.push({
      severity: 'info',
      code: 'base_id_inherit_ignored',
      nodeId: id,
      message: `部件「${name}」继承父模型「${model.baseId}」，父属性未并入（需在文件中显式给出）`
    })
  }
  if (typeof model.model === 'string' && model.model) {
    ctx.downgrades.push({
      severity: 'warning',
      code: 'external_part_ref',
      nodeId: id,
      message: `部件「${name}」引用了外部 .jpm「${model.model}」，导入不解析文件系统（仅读取内联定义）`
    })
  }
  if (model.attach !== undefined || model.scale !== undefined) {
    ctx.downgrades.push({
      severity: 'info',
      code: 'model_flag_dropped',
      nodeId: id,
      message: `部件「${name}」的 attach/scale 渲染旗标不在 v2 子集内，已丢弃`
    })
  }
  if (Array.isArray(model.animations) && model.animations.length > 0) {
    ctx.downgrades.push({
      severity: 'info',
      code: 'animations_dropped',
      nodeId: id,
      message: `部件「${name}」内联的 ${model.animations.length} 段动画不在 v2 子集内，已跳过`
    })
  }

  /* 盒子 → 立方体节点 */
  const boxes = Array.isArray(part.boxes) ? part.boxes : []
  for (let bi = 0; bi < boxes.length; bi++) {
    const box = (isRecord(boxes[bi]) ? boxes[bi] : {}) as OptifineBoxJson
    const coords = Array.isArray(box.coordinates) ? box.coordinates : null
    if (!coords || coords.length < 6) {
      ctx.downgrades.push({
        severity: 'warning',
        code: 'box_no_coordinates',
        message: `部件「${name}」的第 ${bi + 1} 个盒子缺少合法的 coordinates [x,y,z,w,h,d]，已跳过`
      })
      continue
    }
    const x = num(coords[0], 0)
    const y = num(coords[1], 0)
    const z = num(coords[2], 0)
    const w = num(coords[3], 0)
    const h = num(coords[4], 0)
    const d = num(coords[5], 0)
    const cid = uniqueId(`${id}_cube_${bi + 1}`, ctx.used)
    const cube: CubeNode = {
      id: cid,
      type: 'cube',
      name: `${name}·盒${bi + 1}`,
      parent: id,
      visible: true,
      locked: false,
      from: [x, y, z],
      to: [x + w, y + h, z + d],
      origin: [0, 0, 0],
      rotation: [0, 0, 0],
      faces: {}
    }

    /* UV：textureOffset（盒式）优先；否则逐面 uv<Face> */
    if (Array.isArray(box.textureOffset)) {
      ctx.sawBoxUv = true
      const offset: Vec2 = [num(box.textureOffset[0], 0), num(box.textureOffset[1], 0)]
      cube.boxUv = { uvOffset: offset }
      const abs: Vec3 = [Math.abs(w), Math.abs(h), Math.abs(d)]
      const cross = boxUvFaces(abs, offset)
      for (const face of FACE_NAMES) cube.faces[face] = { uv: [...cross[face]] as UvRect }
      for (const key of PER_FACE_UV_KEYS) {
        if (Array.isArray((box as Record<string, unknown>)[key])) {
          ctx.downgrades.push({
            severity: 'info',
            code: 'uv_both_spec',
            nodeId: cid,
            message: `部件「${name}」的盒${bi + 1}同时给出 textureOffset 与 ${key}，已按盒式 UV 处理`
          })
          break
        }
      }
    } else {
      let sawFace = false
      for (const key of PER_FACE_UV_KEYS) {
        const raw = (box as Record<string, unknown>)[key]
        if (!Array.isArray(raw) || raw.length < 4) continue
        cube.faces[UV_KEY_TO_FACE[key]!] = {
          uv: [num(raw[0], 0), num(raw[1], 0), num(raw[2], 0), num(raw[3], 0)] as UvRect
        }
        sawFace = true
      }
      if (sawFace) ctx.sawPerFaceUv = true
      if (!sawFace) {
        ctx.downgrades.push({
          severity: 'warning',
          code: 'box_no_uv',
          nodeId: cid,
          message: `部件「${name}」的盒${bi + 1}没有 textureOffset 或逐面 UV，已按空面导入`
        })
      }
    }

    if (box.sizeAdd !== undefined || box.sizesAdd !== undefined) {
      ctx.downgrades.push({
        severity: 'info',
        code: 'size_add_dropped',
        nodeId: cid,
        message: `部件「${name}」的盒${bi + 1}使用 sizeAdd/sizesAdd 尺寸增量，不在 v2 子集内，已丢弃`
      })
    }

    ctx.nodes[cid] = cube
    group.children.push(cid)
  }

  /* 子部件（submodel 单数 / submodels 复数） */
  const subs: OptifinePartJson[] = []
  if (isRecord(part.submodel)) subs.push(part.submodel as OptifinePartJson)
  if (Array.isArray(part.submodels)) {
    for (const s of part.submodels) if (isRecord(s)) subs.push(s as OptifinePartJson)
  }
  for (let si = 0; si < subs.length; si++) {
    const subName = partNameOf(subs[si]!, `${name}_sub${si + 1}`)
    group.children.push(buildPart(subs[si]!, subName, id, ctx))
  }

  return id
}

/* ------------------------------------------------------------------ */
/* 导入：.jem / .jpm → ModelDocument                                    */
/* ------------------------------------------------------------------ */

export interface OptifineImportOptions {
  /** 注入：固定 meta 时间戳（测试确定性） */
  now?: number
  /** 建议文档 id（缺省按 .jem texture/id 或 'optifine_model' 合成） */
  id?: string
  /** 建议文档名（.jpm 无名称字段时用作根部件名；.jem 缺省 'OptiFine 模型'） */
  name?: string
}

function readCommonMeta(data: Record<string, unknown>): OptifineFormatData {
  const out: OptifineFormatData = {}
  if (typeof data.texture === 'string' && data.texture) out.texture = data.texture
  if (Array.isArray(data.textureSize) && data.textureSize.length >= 2) {
    out.textureSize = [num(data.textureSize[0], 16), num(data.textureSize[1], 16)]
  }
  if (typeof data.shadowSize === 'number' && Number.isFinite(data.shadowSize)) {
    out.shadowSize = data.shadowSize
  }
  return out
}

function finalizeDoc(
  nodes: Record<NodeId, ModelNode>,
  root: NodeId[],
  uvMode: 'per_face' | 'box',
  id: string,
  name: string,
  optifine: OptifineFormatData,
  now: number
): ModelDocument {
  return {
    schemaVersion: 1,
    id,
    name,
    format: 'free',
    settings: { uvMode },
    nodes,
    root,
    textures: {},
    animations: {},
    formatData: { optifine },
    meta: { createdAt: now, updatedAt: now, editorVersion: MODELER_EDITOR_VERSION }
  }
}

/** .jem → ModelDocument（整文档模式：模型项 → 顶层组） */
export function jemToDocument(input: string | OptifineJemJson, options?: OptifineImportOptions): FormatImportResult {
  let data: unknown = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input)
    } catch (e) {
      throw new Error(`.jem 解析失败：${String(e)}`)
    }
  }
  if (!isRecord(data) || !Array.isArray(data.models)) {
    throw new Error('不是合法的 .jem 文件：缺少 models 数组')
  }

  const downgrades: FormatDowngrade[] = []
  const now = options?.now ?? Date.now()
  const ctx: ImportCtx = { nodes: {}, used: new Set<string>(), downgrades, sawBoxUv: false, sawPerFaceUv: false }
  const root: NodeId[] = []
  const models = data.models as unknown[]
  if (models.length === 0) {
    downgrades.push({ severity: 'info', code: 'empty_model', message: '.jem 的 models 为空，导入为空文档' })
  }

  for (let mi = 0; mi < models.length; mi++) {
    const model = (isRecord(models[mi]) ? models[mi] : {}) as OptifineModelJson
    const rawName = partNameOf(model, `part${mi + 1}`)
    root.push(buildPart(model, rawName, null, ctx))
  }

  const optifine = { ...readCommonMeta(data), kind: 'jem' as const }
  const rawId = options?.id ?? (optifine.texture ? optifine.texture.replace(/^.*[/\\]/, '').replace(/\.png$/i, '') : '')
  const doc = finalizeDoc(
    ctx.nodes,
    root,
    resolveUvMode(ctx),
    safeIdPart(rawId || 'optifine_model', 'optifine_model'),
    options?.name ?? 'OptiFine 模型',
    optifine,
    now
  )
  return { doc, downgrades }
}

/** .jpm → ModelDocument（单个部件 → 一个顶层组） */
export function jpmToDocument(input: string | OptifinePartJson, options?: OptifineImportOptions): FormatImportResult {
  let data: unknown = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input)
    } catch (e) {
      throw new Error(`.jpm 解析失败：${String(e)}`)
    }
  }
  if (!isRecord(data)) throw new Error('不是合法的 .jpm 文件：根必须是对象')

  const downgrades: FormatDowngrade[] = []
  const now = options?.now ?? Date.now()
  const ctx: ImportCtx = { nodes: {}, used: new Set<string>(), downgrades, sawBoxUv: false, sawPerFaceUv: false }
  const name = options?.name ?? 'part'
  const rootId = buildPart(data as OptifinePartJson, name, null, ctx)
  const root = [rootId]
  if (Object.keys(ctx.nodes).length <= 1 && (ctx.nodes[rootId] as GroupNode).children.length === 0) {
    downgrades.push({ severity: 'info', code: 'empty_model', message: '.jpm 部件没有盒子或子部件，导入为空文档' })
  }

  const optifine = { ...readCommonMeta(data), kind: 'jpm' as const }
  const doc = finalizeDoc(
    ctx.nodes,
    root,
    resolveUvMode(ctx),
    safeIdPart(options?.id ?? 'optifine_part', 'optifine_part'),
    name,
    optifine,
    now
  )
  return { doc, downgrades }
}

/* ------------------------------------------------------------------ */
/* 导出：ModelDocument → 部件定义 / .jem / .jpm                          */
/* ------------------------------------------------------------------ */

/** 纯盒式 UV 判定：节点带 boxUv 且六面 uv 全部等于十字展开值 */
function isPureBoxUv(cube: CubeNode, absSize: Vec3): boolean {
  if (!cube.boxUv) return false
  const cross = boxUvFaces(absSize, cube.boxUv.uvOffset)
  return FACE_NAMES.every((face) => {
    const uv = cube.faces[face]?.uv
    return !!uv && uv[0] === cross[face]![0] && uv[1] === cross[face]![1] && uv[2] === cross[face]![2] && uv[3] === cross[face]![3]
  })
}

function boxJsonFromCube(cube: CubeNode, downgrades: FormatDowngrade[]): OptifineBoxJson {
  const abs = cubeSize(cube).map((n) => Math.abs(n)) as Vec3
  const out: OptifineBoxJson = {
    coordinates: [
      Math.min(cube.from[0], cube.to[0]),
      Math.min(cube.from[1], cube.to[1]),
      Math.min(cube.from[2], cube.to[2]),
      abs[0],
      abs[1],
      abs[2]
    ]
  }

  if (isPureBoxUv(cube, abs)) {
    out.textureOffset = [...cube.boxUv!.uvOffset]
  } else {
    let wrote = false
    for (const face of FACE_NAMES) {
      const binding = cube.faces[face]
      if (!binding) continue
      if (binding.rotation !== undefined && binding.rotation !== 0) {
        downgrades.push({
          severity: 'info',
          code: 'face_rotation_dropped',
          nodeId: cube.id,
          message: `立方体「${cube.name}」的 ${face} 面贴图旋转不是 JEM/JPM 的表达能力，已丢弃`
        })
      }
      if (binding.cullface !== undefined || binding.tint !== undefined) {
        downgrades.push({
          severity: 'info',
          code: 'face_extra_dropped',
          nodeId: cube.id,
          message: `立方体「${cube.name}」的 ${face} 面 cullface/tint 不是 JEM/JPM 的表达能力，已丢弃`
        })
      }
      if (!binding.uv) continue
      ;(out as Record<string, unknown>)[FACE_TO_UV_KEY[face]] = [...binding.uv]
      wrote = true
    }
    if (!wrote) {
      downgrades.push({
        severity: 'warning',
        code: 'box_no_uv',
        nodeId: cube.id,
        message: `立方体「${cube.name}」没有任何可用 UV，产物的盒将无贴图`
      })
    }
  }

  if (hasNonZero(cube.rotation)) {
    downgrades.push({
      severity: 'warning',
      code: 'cube_rotation_dropped',
      nodeId: cube.id,
      message: `立方体「${cube.name}」的逐盒旋转不是 JEM/JPM 的表达能力（仅部件级 rotate），已丢弃`
    })
  }
  if (cube.inflate !== undefined && cube.inflate !== 0) {
    downgrades.push({
      severity: 'info',
      code: 'inflate_dropped',
      nodeId: cube.id,
      message: `立方体「${cube.name}」的 inflate 不是 JEM/JPM 的表达能力，已丢弃`
    })
  }
  if (cube.shade === false) {
    downgrades.push({
      severity: 'info',
      code: 'shade_dropped',
      nodeId: cube.id,
      message: `立方体「${cube.name}」的 shade:false 不是 JEM/JPM 的表达能力，已丢弃`
    })
  }
  return out
}

/** 组节点 → 部件定义（translate/rotate/boxes/submodels，递归） */
function partJsonOfNode(doc: ModelDocument, groupId: NodeId, downgrades: FormatDowngrade[]): OptifinePartJson {
  const g = doc.nodes[groupId] as GroupNode
  const out: OptifinePartJson = {}
  if (hasNonZero(g.origin)) out.translate = [...g.origin]
  if (hasNonZero(g.rotation)) out.rotate = [...g.rotation]
  if (g.scale && g.scale.some((s) => s !== 1)) {
    downgrades.push({
      severity: 'info',
      code: 'group_scale_dropped',
      nodeId: g.id,
      message: `部件「${g.name}」的缩放不是 JEM/JPM 几何的表达能力，已丢弃`
    })
  }
  const boxes: OptifineBoxJson[] = []
  const submodels: OptifinePartJson[] = []
  for (const cid of g.children) {
    const c = doc.nodes[cid]
    if (!c) continue
    if (c.type === 'cube') boxes.push(boxJsonFromCube(c, downgrades))
    else if (c.type === 'group') submodels.push(partJsonOfNode(doc, cid, downgrades))
    else if (c.type === 'locator') {
      downgrades.push({
        severity: 'info',
        code: 'locator_dropped',
        nodeId: cid,
        message: `定位器「${c.name}」不是 JEM/JPM 的表达能力，已跳过`
      })
    } else {
      downgrades.push({
        severity: 'warning',
        code: 'mesh_dropped',
        nodeId: cid,
        message: `网格「${c.name}」不是 JEM/JPM 的表达能力（仅支持立方体），已跳过`
      })
    }
  }
  if (boxes.length > 0) out.boxes = boxes
  if (submodels.length > 0) out.submodels = submodels
  return out
}

function commonMetaOut(doc: ModelDocument): { texture?: string; textureSize?: Vec2; shadowSize?: number } {
  const prior = (isRecord(doc.formatData?.optifine) ? doc.formatData!.optifine : {}) as OptifineFormatData
  const primary = Object.values(doc.textures)[0]
  const size = prior.textureSize ?? (primary ? ([primary.uvSize?.[0] ?? primary.width, primary.uvSize?.[1] ?? primary.height] as Vec2) : undefined)
  return {
    texture: prior.texture ?? `textures/entity/${safeIdPart(doc.id, 'model')}.png`,
    ...(size ? { textureSize: size } : {}),
    ...(prior.shadowSize !== undefined ? { shadowSize: prior.shadowSize } : {})
  }
}

/** ModelDocument → .jem（顶层组 → 模型项，根级散件归入一个合成部位） */
export function documentToJem(doc: ModelDocument): FormatExportResult<OptifineJemJson> {
  const downgrades: FormatDowngrade[] = []
  const models: OptifineModelJson[] = []
  const orphanBoxes: OptifineBoxJson[] = []

  for (const id of doc.root) {
    const n = doc.nodes[id]
    if (!n) continue
    if (n.type === 'group') {
      models.push({ part: safeIdPart(n.name, 'part'), ...partJsonOfNode(doc, id, downgrades) })
    } else if (n.type === 'cube') {
      orphanBoxes.push(boxJsonFromCube(n, downgrades))
    } else if (n.type === 'mesh') {
      downgrades.push({
        severity: 'warning',
        code: 'mesh_dropped',
        nodeId: id,
        message: `网格「${n.name}」不是 JEM/JPM 的表达能力（仅支持立方体），已跳过`
      })
    } else {
      downgrades.push({
        severity: 'info',
        code: 'locator_dropped',
        nodeId: id,
        message: `定位器「${n.name}」不是 JEM/JPM 的表达能力，已跳过`
      })
    }
  }

  if (orphanBoxes.length > 0) {
    models.push({ part: safeIdPart(doc.name || doc.id, 'root'), boxes: orphanBoxes })
    downgrades.push({
      severity: 'info',
      code: 'orphan_wrapped',
      message: `存在不挂在任何部件下的立方体，已归入合成部位「${safeIdPart(doc.name || doc.id, 'root')}」`
    })
  }
  if (models.length === 0) {
    downgrades.push({ severity: 'warning', code: 'empty_model', message: '文档没有可导出的部件（无组或立方体）' })
  }
  if (doc.display && Object.keys(doc.display).length > 0) {
    downgrades.push({
      severity: 'info',
      code: 'display_dropped',
      message: 'display 槽位变换不是 JEM/JPM 的表达能力，已丢弃'
    })
  }
  if (Object.keys(doc.animations).length > 0) {
    downgrades.push({
      severity: 'info',
      code: 'animations_dropped',
      message: '动画不由 JEM/JPM 几何文件承载（见 OptiFine CEM 动画文件），已跳过'
    })
  }

  const out: OptifineJemJson = { ...commonMetaOut(doc), models }
  return { output: out, downgrades }
}

/** ModelDocument → .jpm（单个顶层组视为该部件本体：其 boxes/submodels 落在顶层） */
export function documentToJpm(doc: ModelDocument): FormatExportResult<OptifinePartJson> {
  const downgrades: FormatDowngrade[] = []
  const rootNodes = doc.root.map((id) => doc.nodes[id]).filter((n): n is ModelNode => !!n)

  /* 单顶层组：该组即部件本体（导入→导出→再导入全等的关键） */
  const singleGroup = rootNodes.length === 1 && rootNodes[0]!.type === 'group' ? rootNodes[0]! : null
  if (singleGroup) {
    const g = singleGroup as GroupNode
    const meta = commonMetaOut(doc)
    const out: OptifinePartJson = {
      ...(meta.texture ? { texture: meta.texture } : {}),
      ...(meta.textureSize ? { textureSize: [...meta.textureSize] } : {}),
      ...partJsonOfNode(doc, g.id, downgrades)
    }
    if (doc.display && Object.keys(doc.display).length > 0) {
      downgrades.push({ severity: 'info', code: 'display_dropped', message: 'display 槽位变换不是 JEM/JPM 的表达能力，已丢弃' })
    }
    if (Object.keys(doc.animations).length > 0) {
      downgrades.push({ severity: 'info', code: 'animations_dropped', message: '动画不由 JEM/JPM 几何文件承载，已跳过' })
    }
    if (!out.boxes && !out.submodels) {
      downgrades.push({ severity: 'warning', code: 'empty_model', message: '文档没有可导出的盒子或部件' })
    }
    return { output: out, downgrades }
  }

  /* 多顶层项 / 顶层散件：顶层 boxes 收拢散件、顶层 groups 归入 submodels */
  const boxes: OptifineBoxJson[] = []
  const submodels: OptifinePartJson[] = []
  for (const n of rootNodes) {
    if (n.type === 'group') submodels.push(partJsonOfNode(doc, n.id, downgrades))
    else if (n.type === 'cube') boxes.push(boxJsonFromCube(n, downgrades))
    else if (n.type === 'mesh') {
      downgrades.push({
        severity: 'warning',
        code: 'mesh_dropped',
        nodeId: n.id,
        message: `网格「${n.name}」不是 JEM/JPM 的表达能力（仅支持立方体），已跳过`
      })
    } else {
      downgrades.push({
        severity: 'info',
        code: 'locator_dropped',
        nodeId: n.id,
        message: `定位器「${n.name}」不是 JEM/JPM 的表达能力，已跳过`
      })
    }
  }

  if (doc.display && Object.keys(doc.display).length > 0) {
    downgrades.push({ severity: 'info', code: 'display_dropped', message: 'display 槽位变换不是 JEM/JPM 的表达能力，已丢弃' })
  }
  if (Object.keys(doc.animations).length > 0) {
    downgrades.push({ severity: 'info', code: 'animations_dropped', message: '动画不由 JEM/JPM 几何文件承载，已跳过' })
  }
  if (boxes.length === 0 && submodels.length === 0) {
    downgrades.push({ severity: 'warning', code: 'empty_model', message: '文档没有可导出的盒子或部件' })
  }

  const meta = commonMetaOut(doc)
  const out: OptifinePartJson = {
    ...(meta.texture ? { texture: meta.texture } : {}),
    ...(meta.textureSize ? { textureSize: [...meta.textureSize] } : {}),
    ...(boxes.length > 0 ? { boxes } : {}),
    ...(submodels.length > 0 ? { submodels } : {})
  }
  return { output: out, downgrades }
}
