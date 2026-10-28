/**
 * Bedrock 实体几何格式编解码（方案 §4.7 formats/bedrock.ts，P3-a）。
 *
 * 产物契约：bedrock.dev 公开规范的 geometry 格式（format_version 1.12.0 子集）：
 * { format_version, "minecraft:geometry": [{ description, bones }] }。
 * clean-room 红线：仅依据 bedrock.dev / 官方 wiki 公开规范独立实现，
 * 不读取、不复制任何第三方编辑器（Blockbench 等）源码。
 *
 * 坐标换算约定（导入/导出对称，golden 测试锁定）：
 * - geo.json 立方体 origin = 最小角 → 文档 from；size → to = from + size；
 * - 骨骼 pivot（模型空间绝对坐标）→ 组 origin；bone.cubes / bone.locators
 *   挂到该骨骼组下作为子节点；
 * - 旋转语义：文档层锚定 three.js/Java 习惯，Bedrock 的 X/Y 轴角度取反
 *   （Z 不变）——社区公开记载的 Java↔Bedrock 旋转差异，导入导出对称互逆；
 * - 立方体 rotation.pivot 缺省 [0,0,0] → 文档 origin；
 * - identifier / format_version / texture_width / texture_height /
 *   visible_bounds_* 透传 formatData.bedrock，往返不丢。
 *
 * 已知不可表达项（导入/导出时逐条告警）：
 * - cube.mirror（贴图镜像）→ info 告警丢弃；
 * - 多 geometry 条目 → 取第一个并告警；
 * - per-face uv_size 为负（贴图翻转）→ 归一化为正尺寸并告警；
 * - 组 scale / 立方体 shade:false / 面旋转 / cullface / tint / display / 动画
 *   → 导出时告警丢弃（Bedrock 几何文件仅承载几何）。
 */
import type {
  CubeNode,
  FormatId,
  GroupNode,
  LocatorNode,
  ModelDocument,
  ModelNode,
  NodeId,
  Vec2,
  Vec3
} from '../types'
import { FACE_NAMES } from '../types'
import { MODELER_EDITOR_VERSION } from '../document'
import { boxUvFaces, cubeSize } from '../uv'
import type { UvRect } from '../uv'
import type {
  FormatCapabilities,
  FormatDefinition,
  FormatDowngrade,
  FormatExportResult,
  FormatImportResult
} from './types'

const FORMAT_ID: FormatId = 'bedrock_entity'

/* ------------------------------------------------------------------ */
/* geo.json 类型（1.12.0 公开规范子集）                                 */
/* ------------------------------------------------------------------ */

export interface BedrockCubeJson {
  origin?: number[]
  size?: number[]
  /** 数组 [u,v] = box-uv 十字左上角；对象 = 逐面 { uv, uv_size } */
  uv?: number[] | Record<string, { uv?: number[]; uv_size?: number[] }>
  rotation?: number | number[]
  pivot?: number[]
  inflate?: number
  mirror?: boolean
}

export interface BedrockBoneJson {
  name?: string
  parent?: string
  pivot?: number[]
  rotation?: number | number[]
  cubes?: BedrockCubeJson[]
  locators?: Record<string, number[]>
}

export interface BedrockGeometryJson {
  description?: {
    identifier?: string
    texture_width?: number
    texture_height?: number
    visible_bounds_width?: number
    visible_bounds_height?: number
    visible_bounds_offset?: number[]
  }
  bones?: BedrockBoneJson[]
}

export interface BedrockGeoJson {
  format_version?: string
  'minecraft:geometry'?: BedrockGeometryJson[]
}

/** formatData.bedrock 透传结构（导入→编辑→导出往返不丢） */
export interface BedrockFormatData {
  identifier?: string
  formatVersion?: string
  textureWidth?: number
  textureHeight?: number
  visibleBoundsWidth?: number
  visibleBoundsHeight?: number
  visibleBoundsOffset?: Vec3
}

/* ------------------------------------------------------------------ */
/* 能力矩阵                                                            */
/* ------------------------------------------------------------------ */

/** Bedrock 实体几何能力矩阵（UI 约束提示与导出降级裁决的唯一事实来源） */
export const BEDROCK_CAPABILITIES: FormatCapabilities = {
  nodes: { cube: true, group: true, locator: true, mesh: false },
  textures: { multi: false, maxSize: 512, squareOnly: false },
  uv: { perFace: true, box: true, faceRotation: false },
  rotation: { mode: 'free' },
  coordinateRange: null,
  hierarchy: true,
  pivots: true,
  animations: true,
  display: false
}

/**
 * 骨骼名分配：geo.json/.animation.json 均以名字引用骨骼，需全文档唯一
 * （冲突追加 _2/_3…）。几何导出与动画导出必须共用同一份映射，
 * 否则重名骨骼的动画通道会挂错目标（P4-b 抽取共享）。
 */
export function assignBoneNames(doc: ModelDocument): Map<NodeId, string> {
  const used = new Set<string>()
  const map = new Map<NodeId, string>()
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'group') continue
    let name = node.name || 'bone'
    let n = 2
    while (used.has(name)) name = `${node.name || 'bone'}_${n++}`
    used.add(name)
    map.set(node.id, name)
  }
  return map
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function vec3(raw: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(raw)) {
    return [num(raw[0], fallback[0]), num(raw[1], fallback[1]), num(raw[2], fallback[2])]
  }
  return [...fallback]
}

/** rotation 简写容忍：数字 → [n,0,0]；非法 → [0,0,0] */
function rotationArray(raw: number | number[] | undefined): Vec3 {
  if (typeof raw === 'number' && Number.isFinite(raw)) return [raw, 0, 0]
  if (Array.isArray(raw)) {
    return [num(raw[0], 0), num(raw[1], 0), num(raw[2], 0)]
  }
  return [0, 0, 0]
}

/** Bedrock 旋转 → 文档旋转：X/Y 取反（Z 不变），-0 归一为 0（动画 codec 共用） */
export function rotationToDoc(raw: number | number[] | undefined): Vec3 {
  const [x, y, z] = rotationArray(raw)
  return [x === 0 ? 0 : -x, y === 0 ? 0 : -y, z] as Vec3
}

/** 文档旋转 → Bedrock 旋转（与 rotationToDoc 互逆；动画 codec 共用） */
export function rotationToGeo(rotation: Vec3): Vec3 {
  return [
    rotation[0] === 0 ? 0 : -rotation[0],
    rotation[1] === 0 ? 0 : -rotation[1],
    rotation[2]
  ] as Vec3
}

/** 导出写法：仅 X 轴非零时输出数字简写（Bedrock 社区惯用形式），否则输出三轴数组 */
function rotationToGeoJson(rotation: Vec3): number | Vec3 {
  const g = rotationToGeo(rotation)
  return g[1] === 0 && g[2] === 0 ? g[0] : g
}

function hasNonZero(v: Vec3): boolean {
  return v.some((n) => n !== 0)
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

/* ------------------------------------------------------------------ */
/* 导入：geo.json → ModelDocument                                      */
/* ------------------------------------------------------------------ */

export interface BedrockImportOptions {
  /** 注入：固定 meta 时间戳（测试确定性） */
  now?: number
  /** 覆盖文档 format 标记（geckolib 薄壳复用同一 codec 时传 'geckolib'） */
  format?: FormatId
}

export function geoToDocument(
  input: string | BedrockGeoJson,
  options?: BedrockImportOptions
): FormatImportResult {
  let data: unknown = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input)
    } catch (e) {
      throw new Error(`geo.json 解析失败：${String(e)}`)
    }
  }
  if (!isRecord(data) || !Array.isArray(data['minecraft:geometry'])) {
    throw new Error('不是合法的 Bedrock 几何文件：缺少 minecraft:geometry 数组')
  }
  const geometries = data['minecraft:geometry'] as unknown[]
  if (geometries.length === 0) {
    throw new Error('minecraft:geometry 为空，无内容可导入')
  }

  const downgrades: FormatDowngrade[] = []
  const now = options?.now ?? Date.now()
  if (geometries.length > 1) {
    downgrades.push({
      severity: 'warning',
      code: 'multi_geometry',
      message: `文件含 ${geometries.length} 个 geometry 条目，已导入第 1 个，其余忽略`
    })
  }
  const geo = (geometries[0] ?? {}) as BedrockGeometryJson
  const desc = (isRecord(geo.description) ? geo.description : {}) as NonNullable<
    BedrockGeometryJson['description']
  >
  const identifier = typeof desc.identifier === 'string' && desc.identifier ? desc.identifier : undefined
  const bones = Array.isArray(geo.bones) ? geo.bones : []
  if (bones.length === 0) {
    downgrades.push({
      severity: 'info',
      code: 'empty_geometry',
      message: 'geometry 条目没有骨骼，导入为空文档'
    })
  }

  /* description 字段透传 formatData */
  const bedrock: BedrockFormatData = {
    ...(identifier ? { identifier } : {}),
    ...(typeof data.format_version === 'string' ? { formatVersion: data.format_version } : {}),
    ...(typeof desc.texture_width === 'number' ? { textureWidth: desc.texture_width } : {}),
    ...(typeof desc.texture_height === 'number' ? { textureHeight: desc.texture_height } : {}),
    ...(typeof desc.visible_bounds_width === 'number'
      ? { visibleBoundsWidth: desc.visible_bounds_width }
      : {}),
    ...(typeof desc.visible_bounds_height === 'number'
      ? { visibleBoundsHeight: desc.visible_bounds_height }
      : {}),
    ...(Array.isArray(desc.visible_bounds_offset)
      ? { visibleBoundsOffset: vec3(desc.visible_bounds_offset, [0, 0, 0]) }
      : {})
  }

  /* 第一遍：骨骼 → 组节点（id 从骨骼名确定性派生，重名取首个供父级引用解析） */
  const usedIds = new Set<string>()
  const idByName = new Map<string, NodeId>()
  const groups = new Map<NodeId, GroupNode>()
  const orderedGroupIds: NodeId[] = []
  let sawDuplicateName = false
  for (let bi = 0; bi < bones.length; bi++) {
    const bone = (isRecord(bones[bi]) ? bones[bi] : {}) as BedrockBoneJson
    const name = typeof bone.name === 'string' && bone.name ? bone.name : 'bone'
    if (idByName.has(name)) sawDuplicateName = true
    const id = uniqueId(safeIdPart(name, 'bone'), usedIds)
    if (!idByName.has(name)) idByName.set(name, id)
    groups.set(id, {
      id,
      type: 'group',
      name,
      parent: null,
      visible: true,
      locked: false,
      children: [],
      origin: vec3(bone.pivot, [0, 0, 0]),
      rotation: rotationToDoc(bone.rotation)
    })
    orderedGroupIds.push(id)
  }
  if (sawDuplicateName) {
    downgrades.push({
      severity: 'warning',
      code: 'duplicate_bone_name',
      message: '存在重名骨骼，已作为独立节点导入（父级引用解析到首个同名骨骼）'
    })
  }

  /* 父级名映射（成环检测用） */
  const parentNameByGroupId = new Map<NodeId, string | undefined>()
  orderedGroupIds.forEach((id, i) => {
    const bone = (isRecord(bones[i]) ? bones[i] : {}) as BedrockBoneJson
    parentNameByGroupId.set(id, typeof bone.parent === 'string' ? bone.parent : undefined)
  })

  /** 沿 parent 名链上行，检测 start 经 parentId 是否成环 */
  function cycleVia(startId: NodeId, parentId: NodeId): boolean {
    const seen = new Set<NodeId>([startId])
    let cur: NodeId | null = parentId
    while (cur !== null) {
      if (seen.has(cur)) return true
      seen.add(cur)
      const pn = parentNameByGroupId.get(cur)
      cur = pn !== undefined ? (idByName.get(pn) ?? null) : null
    }
    return false
  }

  /* 第二遍：父级解析 + cubes/locators 落地 */
  const nodes: Record<NodeId, ModelNode> = {}
  const root: NodeId[] = []
  let hasBox = false
  let hasPerFace = false

  for (let bi = 0; bi < bones.length; bi++) {
    const bone = (isRecord(bones[bi]) ? bones[bi] : {}) as BedrockBoneJson
    const groupId = orderedGroupIds[bi]!
    const group = groups.get(groupId)!

    let parentId: NodeId | null = null
    const parentName = parentNameByGroupId.get(groupId)
    if (parentName !== undefined) {
      const direct = idByName.get(parentName)
      if (direct === undefined) {
        downgrades.push({
          severity: 'warning',
          code: 'parent_missing',
          message: `骨骼「${group.name}」引用的父级「${parentName}」不存在，已作为顶层骨骼导入`
        })
      } else if (direct === groupId || cycleVia(groupId, direct)) {
        downgrades.push({
          severity: 'warning',
          code: 'parent_cycle',
          message: `骨骼「${group.name}」的父级链成环，已作为顶层骨骼导入`
        })
      } else {
        parentId = direct
      }
    }
    group.parent = parentId

    /* cubes → 立方体节点 */
    const cubes = Array.isArray(bone.cubes) ? bone.cubes : []
    for (let ci = 0; ci < cubes.length; ci++) {
      const cube = (isRecord(cubes[ci]) ? cubes[ci] : {}) as BedrockCubeJson
      const id = uniqueId(`${groupId}_cube_${ci + 1}`, usedIds)
      const from = vec3(cube.origin, [0, 0, 0])
      const size = vec3(cube.size, [0, 0, 0])
      const node: CubeNode = {
        id,
        type: 'cube',
        name: `${group.name}·立方体${ci + 1}`,
        parent: groupId,
        visible: true,
        locked: false,
        from,
        to: [from[0] + size[0], from[1] + size[1], from[2] + size[2]],
        origin: vec3(cube.pivot, [0, 0, 0]),
        rotation: rotationToDoc(cube.rotation),
        ...(typeof cube.inflate === 'number' && Number.isFinite(cube.inflate)
          ? { inflate: cube.inflate }
          : {}),
        faces: {}
      }

      /* UV：数组 = box-uv 十字；对象 = 逐面 */
      const uvRaw = cube.uv
      if (Array.isArray(uvRaw)) {
        const offset: Vec2 = [num(uvRaw[0], 0), num(uvRaw[1], 0)]
        node.boxUv = { uvOffset: offset }
        const abs: Vec3 = [Math.abs(size[0]), Math.abs(size[1]), Math.abs(size[2])]
        const cross = boxUvFaces(abs, offset)
        for (const face of FACE_NAMES) {
          node.faces[face] = { uv: [...cross[face]] as UvRect }
        }
        hasBox = true
      } else if (isRecord(uvRaw)) {
        hasPerFace = true
        for (const face of FACE_NAMES) {
          const rawFace = uvRaw[face]
          if (!isRecord(rawFace)) continue // 未声明的面 = 剔面
          const f = rawFace as { uv?: number[]; uv_size?: number[] }
          const fuv = Array.isArray(f.uv) ? f.uv : []
          const fsize = Array.isArray(f.uv_size) ? f.uv_size : []
          let u1 = num(fuv[0], 0)
          let v1 = num(fuv[1], 0)
          let w = num(fsize[0], 0)
          let h = num(fsize[1], 0)
          if (w < 0 || h < 0) {
            downgrades.push({
              severity: 'info',
              code: 'uv_size_negative',
              nodeId: id,
              message: `立方体「${node.name}」的 ${face} 面 uv_size 为负（贴图翻转），已归一化为正尺寸`
            })
            if (w < 0) {
              u1 += w
              w = -w
            }
            if (h < 0) {
              v1 += h
              h = -h
            }
          }
          node.faces[face] = { uv: [u1, v1, u1 + w, v1 + h] as UvRect }
        }
      } else if (uvRaw !== undefined) {
        downgrades.push({
          severity: 'info',
          code: 'uv_invalid',
          nodeId: id,
          message: `立方体「${node.name}」的 uv 字段类型无法识别，已忽略其 UV`
        })
      }

      if (cube.mirror === true) {
        downgrades.push({
          severity: 'info',
          code: 'mirror_dropped',
          nodeId: id,
          message: `立方体「${node.name}」的 mirror 字段无文档对应能力，已丢弃`
        })
      }
      nodes[id] = node
      group.children.push(id)
    }

    /* locators → 定位器节点 */
    const locators = isRecord(bone.locators) ? bone.locators : {}
    for (const [key, pos] of Object.entries(locators)) {
      if (!Array.isArray(pos)) continue
      const id = uniqueId(safeIdPart(key, 'locator'), usedIds)
      const node: LocatorNode = {
        id,
        type: 'locator',
        name: key,
        parent: groupId,
        visible: true,
        locked: false,
        position: vec3(pos, [0, 0, 0])
      }
      nodes[id] = node
      group.children.push(id)
    }

    nodes[groupId] = group
  }

  /* 父子装配（children 里骨骼排在 cubes/locators 之后） */
  for (const groupId of orderedGroupIds) {
    const group = groups.get(groupId)!
    if (group.parent !== null) {
      ;(nodes[group.parent] as GroupNode).children.push(groupId)
    } else {
      root.push(groupId)
    }
  }

  /* 全 box-uv 文件 → 文档默认 box 模式；混存或全 per-face → per_face */
  const uvMode: 'per_face' | 'box' = hasBox && !hasPerFace ? 'box' : 'per_face'
  const rawDocId = identifier ? identifier.replace(/^geometry\./i, '') : 'bedrock_model'
  const doc: ModelDocument = {
    schemaVersion: 1,
    id: safeIdPart(rawDocId, 'bedrock_model') || 'bedrock_model',
    name: identifier ?? 'Bedrock 模型',
    format: options?.format ?? FORMAT_ID,
    settings: { uvMode },
    nodes,
    root,
    textures: {},
    animations: {},
    formatData: { bedrock },
    meta: { createdAt: now, updatedAt: now, editorVersion: MODELER_EDITOR_VERSION }
  }
  return { doc, downgrades }
}

/* ------------------------------------------------------------------ */
/* 导出：ModelDocument → geo.json                                      */
/* ------------------------------------------------------------------ */

/** 纯 box-uv 判定：节点带 boxUv 且六面 uv 全部等于十字展开值 */
function isPureBoxUv(cube: CubeNode, absSize: Vec3): boolean {
  if (!cube.boxUv) return false
  const cross = boxUvFaces(absSize, cube.boxUv.uvOffset)
  return FACE_NAMES.every((face) => {
    const uv = cube.faces[face]?.uv
    return (
      !!uv &&
      uv[0] === cross[face]![0] &&
      uv[1] === cross[face]![1] &&
      uv[2] === cross[face]![2] &&
      uv[3] === cross[face]![3]
    )
  })
}

function cubeToJson(
  cube: CubeNode,
  downgrades: FormatDowngrade[]
): BedrockCubeJson {
  const abs = cubeSize(cube).map((n) => Math.abs(n)) as Vec3
  const json: BedrockCubeJson = {
    origin: [
      Math.min(cube.from[0], cube.to[0]),
      Math.min(cube.from[1], cube.to[1]),
      Math.min(cube.from[2], cube.to[2])
    ],
    size: [...abs]
  }
  if (hasNonZero(cube.rotation)) {
    json.rotation = rotationToGeoJson(cube.rotation)
    json.pivot = [...cube.origin]
  }
  if (cube.inflate !== undefined) json.inflate = cube.inflate
  if (cube.shade === false) {
    downgrades.push({
      severity: 'info',
      code: 'shade_dropped',
      nodeId: cube.id,
      message: `立方体「${cube.name}」的 shade:false（环境光遮蔽开关）不是 Bedrock 几何的表达能力，已丢弃`
    })
  }

  if (isPureBoxUv(cube, abs)) {
    json.uv = [...cube.boxUv!.uvOffset]
  } else {
    const uvJson: Record<string, { uv: number[]; uv_size: number[] }> = {}
    for (const face of FACE_NAMES) {
      const binding = cube.faces[face]
      if (!binding) continue
      if (binding.rotation !== undefined && binding.rotation !== 0) {
        downgrades.push({
          severity: 'info',
          code: 'face_rotation_dropped',
          nodeId: cube.id,
          message: `立方体「${cube.name}」的 ${face} 面贴图旋转不是 Bedrock 几何的表达能力，已丢弃`
        })
      }
      if (binding.cullface !== undefined || binding.tint !== undefined) {
        downgrades.push({
          severity: 'info',
          code: 'face_extra_dropped',
          nodeId: cube.id,
          message: `立方体「${cube.name}」的 ${face} 面 cullface/tint 不是 Bedrock 几何的表达能力，已丢弃`
        })
      }
      if (!binding.uv) continue // 未声明 UV 的面 = 剔面，不写入 uv 对象
      uvJson[face] = {
        uv: [binding.uv[0], binding.uv[1]],
        uv_size: [binding.uv[2] - binding.uv[0], binding.uv[3] - binding.uv[1]]
      }
    }
    if (Object.keys(uvJson).length > 0) json.uv = uvJson
  }
  return json
}

export function documentToGeo(doc: ModelDocument): FormatExportResult<BedrockGeoJson> {
  const downgrades: FormatDowngrade[] = []
  const prior = (isRecord(doc.formatData?.bedrock)
    ? doc.formatData!.bedrock
    : {}) as BedrockFormatData

  /* 骨骼名预分配：与动画导出共用 assignBoneNames，保证两侧重名处理一致 */
  const boneNameByNodeId = assignBoneNames(doc)
  const usedBoneNames = new Set(boneNameByNodeId.values())

  /* 根级散落立方体/定位器：Bedrock 立方体必须挂在骨骼下，自动包一层 root 骨骼 */
  const hasOrphans = Object.values(doc.nodes).some((n) => n.type !== 'group' && n.parent === null)
  const bones: BedrockBoneJson[] = []
  let orphanBone: BedrockBoneJson | null = null
  if (hasOrphans) {
    let name = 'root'
    let n = 2
    while (usedBoneNames.has(name)) name = `root_${n++}`
    usedBoneNames.add(name)
    orphanBone = { name, pivot: [0, 0, 0] }
    bones.push(orphanBone)
    downgrades.push({
      severity: 'info',
      code: 'orphan_wrapped',
      message: `存在不挂在任何骨骼下的立方体/定位器，已自动包入「${name}」骨骼`
    })
  }

  /* display / 动画不可表达 → 告警 */
  if (doc.display && Object.keys(doc.display).length > 0) {
    downgrades.push({
      severity: 'info',
      code: 'display_dropped',
      message: 'display 槽位变换不是 Bedrock 实体几何的表达能力，导出已丢弃'
    })
  }
  if (Object.keys(doc.animations).length > 0) {
    downgrades.push({
      severity: 'info',
      code: 'animations_dropped',
      message: '动画不在 geo.json 承载范围内（仅几何），已跳过'
    })
  }

  /* 深度优先导出：组 → 骨骼；cube/locator → 就近父骨骼 */
  const walk = (id: NodeId, bone: BedrockBoneJson): void => {
    const node = doc.nodes[id]
    if (!node) return
    if (node.type === 'group') {
      if (node.scale && node.scale.some((s) => s !== 1)) {
        downgrades.push({
          severity: 'info',
          code: 'group_scale_dropped',
          nodeId: node.id,
          message: `骨骼「${node.name}」的缩放不是 Bedrock 几何的表达能力（缩放属于动画），已丢弃`
        })
      }
      const next: BedrockBoneJson = {
        name: boneNameByNodeId.get(id)!,
        ...(node.parent && boneNameByNodeId.has(node.parent)
          ? { parent: boneNameByNodeId.get(node.parent)! }
          : {}),
        pivot: [...node.origin],
        ...(hasNonZero(node.rotation) ? { rotation: rotationToGeoJson(node.rotation) } : {})
      }
      bones.push(next)
      for (const c of node.children) walk(c, next)
      return
    }
    if (node.type === 'cube') {
      ;(bone.cubes ??= []).push(cubeToJson(node, downgrades))
      return
    }
    if (node.type === 'mesh') {
      downgrades.push({
        severity: 'warning',
        code: 'mesh_dropped',
        nodeId: node.id,
        message: `网格「${node.name}」不是 Bedrock 几何的表达能力（仅支持立方体），已跳过`
      })
      return
    }
    const locators = (bone.locators ??= {})
    let key = node.name || 'locator'
    let n = 2
    while (key in locators) key = `${node.name || 'locator'}_${n++}`
    locators[key] = [...node.position]
  }
  /* hasOrphans 为真时 orphanBone 必非空；根级 cube/locator 只会落入它 */
  const fallbackBone = orphanBone as BedrockBoneJson
  for (const id of doc.root) walk(id, fallbackBone)

  /* description：formatData 优先，缺省贴图尺寸回退首张贴图 */
  const description: NonNullable<BedrockGeometryJson['description']> = {
    identifier: prior.identifier ?? `geometry.${doc.id}`
  }
  const primary = Object.values(doc.textures)[0]
  const textureWidth = prior.textureWidth ?? primary?.uvSize?.[0] ?? primary?.width
  const textureHeight = prior.textureHeight ?? primary?.uvSize?.[1] ?? primary?.height
  if (typeof textureWidth === 'number') description.texture_width = textureWidth
  if (typeof textureHeight === 'number') description.texture_height = textureHeight
  if (typeof prior.visibleBoundsWidth === 'number') {
    description.visible_bounds_width = prior.visibleBoundsWidth
  }
  if (typeof prior.visibleBoundsHeight === 'number') {
    description.visible_bounds_height = prior.visibleBoundsHeight
  }
  if (prior.visibleBoundsOffset) {
    description.visible_bounds_offset = [...prior.visibleBoundsOffset]
  }

  const geo: BedrockGeoJson = {
    format_version: prior.formatVersion ?? '1.12.0',
    'minecraft:geometry': [{ description, bones }]
  }
  return { output: geo, downgrades }
}

/* ------------------------------------------------------------------ */
/* 格式定义                                                            */
/* ------------------------------------------------------------------ */

export const bedrockFormat: FormatDefinition<BedrockGeoJson, string | BedrockGeoJson> = {
  id: FORMAT_ID,
  name: 'Bedrock 实体几何',
  capabilities: BEDROCK_CAPABILITIES,
  exportDocument: (doc) => documentToGeo(doc),
  importDocument: (input) => geoToDocument(input as string | BedrockGeoJson)
}

/** Bedrock 方块几何（薄壳：复用 Bedrock Entity codec，仅 formatId 不同） */
export const bedrockBlockFormat: FormatDefinition<BedrockGeoJson, string | BedrockGeoJson> = {
  id: 'bedrock_block',
  name: 'Bedrock 方块几何',
  capabilities: BEDROCK_CAPABILITIES,
  exportDocument: (doc) => documentToGeo(doc),
  importDocument: (input) => geoToDocument(input as string | BedrockGeoJson, { format: 'bedrock_block' })
}
