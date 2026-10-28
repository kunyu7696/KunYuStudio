/**
 * FBX（ASCII）导入编解码（方案 §4.1 formats/fbx.ts，P5-fbx）。
 *
 * 实现依据（clean-room）：仅依据 Autodesk 公开的 FBX ASCII 文件格式说明独立实现——
 *   - 嵌套块语法 `名字: 属性列表 { 子块 }`，数组以 `*N` 标注长度、数据行名 `a`；
 *   - `PolygonVertexIndex` 负值表示多边形闭合：index = (v < 0) ? (-v - 1) : v；
 *   - `LayerElementUV` 的 MappingInformationType（ByPolygonVertex / ByControlPoint）与
 *     ReferenceInformationType（IndexToDirect / Direct）；
 *   - `Connections` 的 `C: "OO",<child>,<parent>` 关系；
 *   - `GlobalSettings.Properties70` 中的 UnitScaleFactor / OriginalUnitScaleFactor。
 * 仅参考公开格式规范，未阅读/未抄袭任何第三方编辑器（Blockbench、Blender、
 * three.js FBXLoader 等）的源码。
 *
 * 子集边界：
 *   - 仅 ASCII FBX；二进制 FBX（magic：`Kaydara FBX Binary  \0`）明确抛错；
 *   - 不导入材质/贴图像素（面不绑定 texture）、不导入动画/形变器/骨骼蒙皮；
 *   - 层级仅支持简化的 Model→Geometry 分组，解析不到 Connections 则平铺为根级 MeshNode；
 *   - 坐标不翻轴（FBX 与文档同为 Y-up 右手系），单位不按 cm 换算，改为可选的 0..16 归一化。
 *
 * 本层为纯函数层：不依赖 DOM/three/Electron。
 */
import { addNode, createDocument, createGroupNode, createMeshNode } from '../document'
import type { FormatId, ModelDocument, Vec2, Vec3 } from '../types'
import type { FormatDowngrade, FormatImportResult } from './types'

/* ------------------------------------------------------------------ */
/* 常量与类型                                                          */
/* ------------------------------------------------------------------ */

/** 缺省贴图尺寸（UV 像素换算用） */
const DEFAULT_TEXTURE_SIZE = 16
/** 归一化目标盒边长（文档单位：16 = 1 方块） */
const FIT_BOX_SIZE = 16
/** 二进制 FBX 文件头 magic（后接两个空格与 \0） */
const BIN_MAGIC = 'Kaydara FBX Binary'

export interface FbxImportOptions {
  /** 覆盖文档 id（缺省取 name 清洗，或 'fbx_model'） */
  id?: string
  /** 文档显示名（缺省同 id） */
  name?: string
  /** 覆盖文档 format 标记（缺省 free：FBX 无游戏约束） */
  format?: FormatId
  /** UV 像素换算的贴图边长（缺省 16） */
  textureSize?: number
  /** 是否把模型等比缩放+居中装进 0..16 文档盒（缺省 true） */
  fitToBox?: boolean
  /** 固定 meta 时间戳（测试确定性） */
  now?: number
}

/** ASCII FBX 解析节点：名字 + 属性列表 + 子块 + 可选的 `*N` 数组数据 */
interface FbxNode {
  name: string
  props: (string | number)[]
  children: FbxNode[]
  /** 存在 `a:` 数据行且全为数字时填充（`*N` 数组的实际数值） */
  array?: number[]
}

/** 抽取后的单个几何（尚未组装为 MeshNode） */
interface FbxGeometry {
  id: number
  name: string
  /** 顶点池（几何局部空间，未做去重）；fitToBox 前为 FBX 原始坐标 */
  vertices: Vec3[]
  /** 面（顶点索引 + 逐角 UV 像素坐标） */
  faces: { vertices: number[]; uv: Vec2[] }[]
}

/* ------------------------------------------------------------------ */
/* ASCII FBX 语法解析器（手写，无第三方依赖）                            */
/* ------------------------------------------------------------------ */

/**
 * 解析 ASCII FBX 文本为节点树。支持：
 * - `名字: 值列表 { 子块... }` 与 `名字: 值列表`（单行/多行，靠换行终止）；
 * - 值：字符串 `"..."`、数字（负号/小数/科学计数法）、`*N` 数组长度前缀；
 * - `a: v1, v2, ...` 数组数据行（逗号 + 换行分隔，允许跨行，需以逗号续行）；
 * - 行注释 `;` 至行尾；时间戳头部行按注释忽略。
 * 解析失败/结构非法抛 Error。
 */
export function parseFbxAscii(text: string): FbxNode[] {
  let pos = 0
  const n = text.length
  const atEnd = (): boolean => pos >= n
  const isInlineWs = (c: string): boolean =>
    c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v'

  /** 跳过空白与注释；返回是否跨过换行 */
  function skipWs(): boolean {
    let newline = false
    while (pos < n) {
      const c = text[pos] as string
      if (c === ';') {
        while (pos < n && text[pos] !== '\n') pos++
        continue
      }
      if (c === '\n') {
        newline = true
        pos++
        continue
      }
      if (isInlineWs(c)) {
        pos++
        continue
      }
      break
    }
    return newline
  }

  /** 仅跳行内空白（不跨行） */
  function skipInline(): void {
    while (pos < n && isInlineWs(text[pos] as string)) pos++
  }

  function readNumber(): number {
    const start = pos
    while (pos < n && /[-+0-9.eE]/.test(text[pos] as string)) pos++
    const tok = text.slice(start, pos)
    const v = Number(tok)
    if (tok.length === 0 || !Number.isFinite(v)) {
      throw new Error(`FBX 解析失败：非法数值 "${tok}"`)
    }
    return v
  }

  function readString(): string {
    pos++ // 开引号
    let out = ''
    while (pos < n) {
      const c = text[pos] as string
      if (c === '\\') {
        pos++
        out += text[pos] ?? ''
        pos++
        continue
      }
      if (c === '"') {
        pos++
        return out
      }
      out += c
      pos++
    }
    throw new Error('FBX 解析失败：字符串未闭合')
  }

  /** 读到 `:`/`{`/`}`/换行前的文本并去空白 */
  function readName(): string {
    const start = pos
    while (pos < n && !':{}\n'.includes(text[pos] as string)) pos++
    return text.slice(start, pos).trim()
  }

  /** 解析属性列表：以 `{`/`}`/无逗号续行的换行终止 */
  function parseProps(): (string | number)[] {
    const props: (string | number)[] = []
    let pendingComma = false
    for (;;) {
      const crossedNewline = skipWs()
      if (atEnd()) break
      const c = text[pos] as string
      if (c === '{' || c === '}') break
      if (crossedNewline && props.length > 0 && !pendingComma) break
      if (c === '*') {
        pos++
        props.push(readNumber())
      } else if (c === '"') {
        props.push(readString())
      } else {
        props.push(readNumber())
      }
      pendingComma = false
      skipInline()
      if (text[pos] === ',') {
        pos++
        pendingComma = true
        skipInline()
      }
    }
    return props
  }

  function parseNode(): FbxNode {
    const name = readName()
    if (!name) throw new Error('FBX 解析失败：缺少节点名')
    skipInline()
    if (text[pos] !== ':') throw new Error(`FBX 解析失败：节点 ${name} 缺少冒号`)
    pos++
    const node: FbxNode = { name, props: parseProps(), children: [] }
    skipWs()
    if (text[pos] === '{') {
      pos++
      for (;;) {
        skipWs()
        if (atEnd()) throw new Error(`FBX 解析失败：块 ${name} 未闭合`)
        if (text[pos] === '}') {
          pos++
          break
        }
        node.children.push(parseNode())
      }
    }
    const a = node.children.find((c) => c.name === 'a')
    if (a && a.props.length > 0 && a.props.every((p) => typeof p === 'number')) {
      node.array = a.props as number[]
    }
    return node
  }

  const roots: FbxNode[] = []
  for (;;) {
    skipWs()
    if (atEnd()) break
    roots.push(parseNode())
  }
  if (roots.length === 0) throw new Error('FBX 解析失败：未解析到任何节点')
  return roots
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function safeIdPart(raw: string, fallback: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_-]/g, '_')
  return s.length > 0 ? s : fallback
}

function childOf(node: FbxNode | undefined, name: string): FbxNode | undefined {
  return node?.children.find((c) => c.name === name)
}

function arrayOf(node: FbxNode | undefined, name: string): number[] | undefined {
  return childOf(node, name)?.array
}

/** 取节点首个字符串属性（缺省 ''） */
function firstStringProp(node: FbxNode | undefined): string {
  const p = node?.props[0]
  return typeof p === 'string' ? p : ''
}

/** `"Geometry::Cube"` → `"Cube"`（取 `::` 之后部分） */
function nameAfterColon(p: string | number | undefined): string {
  if (typeof p !== 'string') return ''
  const idx = p.lastIndexOf('::')
  return idx >= 0 ? p.slice(idx + 2) : p
}

function fmtNum(x: number): string {
  return String(Math.round(x * 1000) / 1000)
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/**
 * ASCII FBX 文本 → ModelDocument。
 *
 * - 二进制 FBX 直接抛 Error；
 * - `Objects` 无任何 Mesh 几何 → 返回空文档并告警（不抛错）；
 * - 解析失败/结构非法抛 Error。
 */
export function fbxTextToDocument(text: string, options?: FbxImportOptions): FormatImportResult {
  /* 1) 二进制 FBX 明确拒绝（先检测后解析） */
  if (
    text.startsWith(BIN_MAGIC) ||
    text.charCodeAt(21) === 0x1a ||
    text.slice(0, 64).includes('\u0000')
  ) {
    throw new Error('二进制 FBX 暂不支持，请在导出时选择 ASCII FBX')
  }

  const roots = parseFbxAscii(text)
  const texSize = options?.textureSize ?? DEFAULT_TEXTURE_SIZE
  const downgrades: FormatDowngrade[] = []
  const push = (severity: 'warning' | 'info', code: string, message: string): void => {
    downgrades.push({ severity, code, message })
  }

  /* 2) GlobalSettings：单位（仅记录，不换算坐标） */
  let unitScaleFactor: number | undefined
  const gsProps = childOf(roots.find((r) => r.name === 'GlobalSettings'), 'Properties70')
  if (gsProps) {
    for (const p of gsProps.children) {
      if (p.name !== 'P' || p.props[0] !== 'UnitScaleFactor') continue
      const nums = p.props.filter((x): x is number => typeof x === 'number')
      if (nums.length > 0) unitScaleFactor = nums[nums.length - 1]
    }
  }

  /* 3) Objects 分拣：Geometry / Model 之外一律跳过并 info 降级 */
  const objectChildren = roots.find((r) => r.name === 'Objects')?.children ?? []
  const geometryNodes = objectChildren.filter((c) => c.name === 'Geometry')
  const modelNodes = objectChildren.filter((c) => c.name === 'Model')
  const unsupported = new Set<string>()
  for (const c of objectChildren) {
    if (c.name !== 'Geometry' && c.name !== 'Model') unsupported.add(c.name)
  }
  if (unsupported.size > 0) {
    push(
      'info',
      'fbx_unsupported_object',
      `已跳过 FBX 中不支持的对象类型：${[...unsupported].join('、')}（本次不导入材质/贴图/动画/骨骼）`
    )
  }

  /* 4) 几何抽取 */
  const geoms: FbxGeometry[] = []
  let hasUvLayer = false
  let hasMaterialLayer = false
  let fanTriangulated = false

  geometryNodes.forEach((gnode, gi) => {
    const idRaw = gnode.props[0]
    const id = typeof idRaw === 'number' ? idRaw : NaN
    const key = Number.isFinite(id) ? String(id) : `g${gi}`
    const name = nameAfterColon(gnode.props[1]) || `geo_${key}`

    const vArr = arrayOf(gnode, 'Vertices') ?? []
    const pviArr = arrayOf(gnode, 'PolygonVertexIndex') ?? []
    const vertices: Vec3[] = []
    for (let k = 0; k + 2 < vArr.length; k += 3) {
      vertices.push([vArr[k] as number, vArr[k + 1] as number, vArr[k + 2] as number])
    }

    /* LayerElementUV（可选）：UV 数组 + 逐角/逐点索引 */
    const uvNode = childOf(gnode, 'LayerElementUV')
    let uvPairs: Vec2[] = []
    let uvIndex: number[] | null = null
    let uvMapping = ''
    let uvRef = ''
    if (uvNode) {
      hasUvLayer = true
      uvMapping = firstStringProp(childOf(uvNode, 'MappingInformationType'))
      uvRef = firstStringProp(childOf(uvNode, 'ReferenceInformationType'))
      const uvArr = arrayOf(uvNode, 'UV') ?? []
      for (let k = 0; k + 1 < uvArr.length; k += 2) {
        uvPairs.push([uvArr[k] as number, uvArr[k + 1] as number])
      }
      uvIndex = arrayOf(uvNode, 'UVIndex') ?? null
    }
    if (childOf(gnode, 'LayerElementMaterial')) hasMaterialLayer = true

    /**
     * 逐角 UV 解析：FBX 归一化 UV（左下原点）→ 编辑器像素 UV（左上原点，v 向下）：
     * u_px = u * texW；v_px = (1 - v) * texH。
     */
    const resolveUv = (corner: number, slot: number, count: number, vertexIndex: number): Vec2 => {
      if (!uvNode) {
        // 无 UV 层：按面顶点槽位在 0..16 对角线上兜底展开
        const t = count > 1 ? slot / (count - 1) : 0
        return [t * texSize, t * texSize]
      }
      let pairIndex: number
      if (uvMapping === 'ByControlPoint') {
        // 逐控制点：直接用顶点索引取 UV
        pairIndex = vertexIndex
      } else {
        // 逐多边形角（缺省）：用多边形角累计序号（或经 UVIndex 转间接）取值
        const idx = uvIndex && uvRef !== 'Direct' ? uvIndex[corner] : corner
        pairIndex = typeof idx === 'number' ? idx : -1
      }
      const pair: Vec2 =
        pairIndex >= 0 && pairIndex < uvPairs.length ? (uvPairs[pairIndex] as Vec2) : [0, 0]
      return [pair[0] * texSize, (1 - pair[1]) * texSize]
    }

    /* 多边形：>4 顶点扇形三角化，<3 跳过 */
    const faces_out: { vertices: number[]; uv: Vec2[] }[] = []
    const emit = (poly: number[], start: number): void => {
      if (poly.length < 3) return
      if (poly.some((vi) => !Number.isInteger(vi) || vi < 0 || vi >= vertices.length)) return
      if (poly.length <= 4) {
        faces_out.push({
          vertices: [...poly],
          uv: poly.map((vi, j) => resolveUv(start + j, j, poly.length, vi))
        })
        return
      }
      for (let i = 1; i < poly.length - 1; i++) {
        faces_out.push({
          vertices: [poly[0] as number, poly[i] as number, poly[i + 1] as number],
          uv: [
            resolveUv(start, 0, 3, poly[0] as number),
            resolveUv(start + i, 1, 3, poly[i] as number),
            resolveUv(start + i + 1, 2, 3, poly[i + 1] as number)
          ]
        })
      }
      fanTriangulated = true
    }

    let cursor = 0
    let poly: number[] = []
    let polyStart = 0
    for (const raw of pviArr) {
      if (poly.length === 0) polyStart = cursor
      poly.push(raw < 0 ? -raw - 1 : raw)
      cursor++
      if (raw < 0) {
        emit(poly, polyStart)
        poly = []
      }
    }
    if (poly.length > 0) emit(poly, polyStart)

    geoms.push({ id, name, vertices, faces: faces_out })
  })

  /* 5) Model 节点（层级 pivots）与 Connections 关系 */
  const models: { id: number; name: string; translation: Vec3; rotation: Vec3; scale: Vec3 }[] = []
  for (const mnode of modelNodes) {
    const idRaw = mnode.props[0]
    const id = typeof idRaw === 'number' ? idRaw : NaN
    const name = nameAfterColon(mnode.props[1]) || `model_${Number.isFinite(id) ? id : 'x'}`
    const translation: Vec3 = [0, 0, 0]
    const rotation: Vec3 = [0, 0, 0]
    const scale: Vec3 = [1, 1, 1]
    const p70 = childOf(mnode, 'Properties70')
    if (p70) {
      for (const p of p70.children) {
        if (p.name !== 'P') continue
        const key = p.props[0]
        if (typeof key !== 'string') continue
        const nums = p.props.filter((x): x is number => typeof x === 'number')
        if (nums.length < 3) continue
        const tail = nums.slice(-3)
        const dst =
          key === 'Lcl Translation'
            ? translation
            : key === 'Lcl Rotation'
              ? rotation
              : key === 'Lcl Scale' || key === 'Lcl Scaling'
                ? scale
                : null
        if (!dst) continue
        dst[0] = tail[0] as number
        dst[1] = tail[1] as number
        dst[2] = tail[2] as number
      }
    }
    models.push({ id, name, translation, rotation, scale })
  }

  const ooParent = new Map<number, number>()
  const connRoot = roots.find((r) => r.name === 'Connections')
  if (connRoot) {
    for (const c of connRoot.children) {
      if (c.name !== 'C') continue
      const kind = c.props[0]
      const childId = c.props[1]
      const parentId = c.props[2]
      if (kind === 'OO' && typeof childId === 'number' && typeof parentId === 'number') {
        ooParent.set(childId, parentId)
      }
    }
  }

  const modelById = new Map(models.map((m) => [m.id, m]))
  const geoParent = new Map<number, number>()
  let grouped = models.length > 0 && geoms.length > 0
  if (grouped) {
    for (const g of geoms) {
      const pid = ooParent.get(g.id)
      if (pid === undefined || !modelById.has(pid)) {
        grouped = false
        break
      }
      geoParent.set(g.id, pid)
    }
  }
  if (geoms.length > 0 && !grouped) {
    push(
      'info',
      'fbx_no_scene_flat',
      '未能解析 Model→Geometry 连接（Connections 缺失或引用的 Model 不存在），几何已平铺为根级网格节点'
    )
  }

  /* 6) 层级烘焙：Model 变换折进几何顶点（v = S·v + T），原点取 T 作 pivot */
  if (grouped) {
    for (const g of geoms) {
      const m = modelById.get(geoParent.get(g.id) as number)
      if (!m) continue
      for (const v of g.vertices) {
        v[0] = v[0] * m.scale[0] + m.translation[0]
        v[1] = v[1] * m.scale[1] + m.translation[1]
        v[2] = v[2] * m.scale[2] + m.translation[2]
      }
    }
  }

  /* 7) fitToBox：整模型等比缩放+居中装进 0..16（变换同时作用于顶点与组 pivot） */
  const fit = options?.fitToBox ?? true
  if (fit && geoms.length > 0) {
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    const consider = (v: Vec3): void => {
      if (v[0] < minX) minX = v[0]
      if (v[1] < minY) minY = v[1]
      if (v[2] < minZ) minZ = v[2]
      if (v[0] > maxX) maxX = v[0]
      if (v[1] > maxY) maxY = v[1]
      if (v[2] > maxZ) maxZ = v[2]
    }
    for (const g of geoms) for (const v of g.vertices) consider(v)
    const usedModels = grouped
      ? models.filter((m) => geoms.some((g) => geoParent.get(g.id) === m.id))
      : []
    for (const m of usedModels) consider(m.translation)

    const sizeX = maxX - minX
    const sizeY = maxY - minY
    const sizeZ = maxZ - minZ
    const maxDim = Math.max(sizeX, sizeY, sizeZ)
    if (Number.isFinite(maxDim) && maxDim > 0) {
      const s = FIT_BOX_SIZE / maxDim
      const off: Vec3 = [-minX * s, -minY * s, -minZ * s]
      const apply = (v: Vec3): void => {
        v[0] = v[0] * s + off[0]
        v[1] = v[1] * s + off[1]
        v[2] = v[2] * s + off[2]
      }
      for (const g of geoms) for (const v of g.vertices) apply(v)
      for (const m of usedModels) apply(m.translation)
      push(
        'info',
        'fbx_scale_normalized',
        `已将模型按包围盒等比归一化到 0..16（原始尺寸 ${fmtNum(sizeX)}×${fmtNum(sizeY)}×${fmtNum(sizeZ)}）`
      )
    }
  }

  /* 8) 其余降级 */
  if (geoms.length > 0 && !hasUvLayer) {
    push(
      'info',
      'fbx_no_uv',
      'FBX 几何缺少 LayerElementUV，面 UV 已按 0..16 对角线兜底展开'
    )
  }
  if (fanTriangulated) {
    push('warning', 'fbx_polygon_fan_triangulated', 'FBX 存在 >4 顶点多边形，已用扇形三角化切分为三角面')
  }
  if (
    hasMaterialLayer ||
    unsupported.has('Material') ||
    unsupported.has('Texture') ||
    unsupported.has('Video')
  ) {
    push(
      'info',
      'fbx_texture_not_imported',
      'FBX 材质/贴图引用未导入（面不绑定贴图，UV 已保留）'
    )
  }
  if (geoms.length === 0) {
    push('warning', 'fbx_no_geometry', 'FBX 中未找到任何 Mesh 几何（Objects 无 Geometry 节点）')
  }

  /* 9) 组装文档 */
  const now = options?.now ?? Date.now()
  const docId = safeIdPart(options?.id ?? options?.name ?? '', 'fbx_model') || 'fbx_model'
  let doc: ModelDocument = createDocument({
    id: docId,
    name: options?.name || docId,
    format: options?.format ?? 'free',
    settings: { uvMode: 'per_face', textureSize: [texSize, texSize] },
    now
  })

  let meshNodeCount = 0
  if (!grouped) {
    for (const g of geoms) {
      const mesh = createMeshNode(g.name, { vertices: g.vertices, faces: g.faces })
      mesh.id = `fbx_geo_${Number.isFinite(g.id) ? g.id : g.name}`
      doc = addNode(doc, mesh, null)
      meshNodeCount++
    }
  } else {
    for (const m of models) {
      const kids = geoms.filter((g) => geoParent.get(g.id) === m.id)
      if (kids.length === 0) continue
      const group = createGroupNode(m.name)
      group.id = `fbx_model_${Number.isFinite(m.id) ? m.id : m.name}`
      group.origin = [m.translation[0], m.translation[1], m.translation[2]]
      group.rotation = [m.rotation[0], m.rotation[1], m.rotation[2]]
      doc = addNode(doc, group, null)
      for (const g of kids) {
        const mesh = createMeshNode(g.name, { vertices: g.vertices, faces: g.faces })
        mesh.id = `fbx_geo_${Number.isFinite(g.id) ? g.id : g.name}`
        doc = addNode(doc, mesh, group.id)
        meshNodeCount++
      }
    }
  }

  doc = {
    ...doc,
    formatData: {
      fbx: {
        geometries: geoms.length,
        nodes: meshNodeCount,
        polygons: geoms.reduce((sum, g) => sum + g.faces.length, 0),
        ...(unitScaleFactor !== undefined ? { unitScaleFactor } : {})
      }
    }
  }

  return { doc, downgrades }
}
