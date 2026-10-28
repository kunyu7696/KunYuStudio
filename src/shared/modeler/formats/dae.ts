/**
 * Collada (.dae) 导入编解码（方案 §4.1 formats/dae.ts，C5）。
 *
 * 实现依据（clean-room）：仅依据 Khronos **Collada 1.4.1 / 1.5 公开规范**独立实现——
 *   - `<library_geometries><geometry><mesh>` 的 `<source><float_array>` + `<accessor>`
 *     （count / stride / offset，支持交错 stride）；
 *   - `<vertices>` 的 `<input semantic="POSITION">` 间接指向位置 source；
 *   - `<triangles>` / `<polylist>` / `<polygons>` 的 `<input>`（按 offset 交错）与 `<p>`
 *     索引表、`<polylist>` 的 `<vcount>`；
 *   - `<asset><unit meter>` 与 `<up_axis>`；
 *   - `<library_visual_scenes>` 的 `<node>`（`<translate>` / `<rotate>` / `<scale>` /
 *     `<matrix>`）与 `<instance_geometry url="#id">`。
 * 仅参考公开格式规范，未阅读/未抄袭任何第三方编辑器（Blockbench、Blender、
 * three.js ColladaLoader 等）的源码。
 *
 * 子集边界：
 *   - 只导入几何 + 逐顶点 UV；**不导入材质/贴图像素**（面不绑定 texture）、不导入动画/
 *     骨骼蒙皮/形变（`library_controllers`、`skin`、`morph`、`instance_controller`、
 *     `library_animations`、`library_effects`、`library_materials`、`library_images` 一律
 *     跳过并 info 降级）；
 *   - 面数约束：编辑器 MeshFace 仅支持 3/4 顶点，`<vcount> > 4` 的多边形用**扇形三角化**
 *     切分（warning 降级），`< 3` 跳过；
 *   - **节点变换烘焙**：文档的组局部矩阵是 `T(origin)·R·S·T(−origin)`（绕 pivot 变换），
 *     无法一般性地表达「纯平移」「多层旋转缩放」链。因此本 codec 采取两条精确路径：
 *     ① 链上所有节点均为纯平移（无旋转/缩放）→ 平移量直接烘焙进顶点，组仅保留结构；
 *     ② 链上存在旋转/缩放 → 整条链的仿射（`M·v + t`）**整体烘焙进顶点**，组仅保留结构，
 *        并推 info 降级 `dae_transforms_baked`（pivot 不可再编辑，但几何完全保真）。
 *     两条路径都使世界坐标与 Collada 语义**精确一致**；
 *   - `<matrix>` 按 Collada 规范的**行主序**解释（平移分量取下标 3/7/11）。
 *
 * 本层为纯函数层：不依赖 DOM/three/Electron（自带极简 XML 解析器，不用 DOMParser）。
 */
import { addNode, createDocument, createGroupNode, createMeshNode } from '../document'
import type { FormatId, ModelDocument, NodeId, Vec2, Vec3 } from '../types'
import type { FormatDowngrade, FormatImportResult } from './types'

/* ------------------------------------------------------------------ */
/* 常量与类型                                                          */
/* ------------------------------------------------------------------ */

/** 缺省贴图边长（UV 像素换算用） */
const DEFAULT_TEXTURE_SIZE = 16
/** 归一化目标盒边长（文档单位：16 = 1 方块） */
const FIT_BOX_SIZE = 16

export interface DaeImportOptions {
  /** 覆盖文档 id（缺省取 name 清洗，或 'dae_model'） */
  id?: string
  /** 文档显示名（缺省同 id） */
  name?: string
  /** 覆盖文档 format 标记（缺省 free：Collada 无游戏约束） */
  format?: FormatId
  /** UV 像素换算的贴图边长（缺省 16） */
  textureSize?: number
  /** 是否把模型等比缩放+居中装进 0..16 文档盒（缺省 true） */
  fitToBox?: boolean
  /** 固定 meta 时间戳（测试确定性） */
  now?: number
}

/** XML 解析节点：本地名 + 属性 + 子节点 + 文本 */
interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

/** Collada `<source>`：原始浮点串 + accessor 交错参数 */
interface DaeSource {
  id: string
  floats: number[]
  /** 元组间步长（accessor stride，缺省 = 参数个数） */
  stride: number
  /** 元组内起始偏移（accessor offset，缺省 0） */
  offset: number
  /** 元组个数（accessor count） */
  count: number
}

/** 抽取后的单个几何（尚未组装为 MeshNode） */
interface DaeGeometry {
  id: string
  name: string
  /** 顶点池（几何局部空间，未去重） */
  vertices: Vec3[]
  /** 面（顶点索引 + 逐角 UV 像素坐标） */
  faces: { vertices: number[]; uv: Vec2[] }[]
}

/** 单轴旋转（`<rotate>` 的轴 + 角度） */
interface DaeRotate {
  axis: Vec3
  angle: number
}

/** 场景节点（`<node>`） */
interface DaeSceneNode {
  id: string
  name: string
  translation: Vec3
  rotations: DaeRotate[]
  scale: Vec3
  /** `<matrix>` 显式矩阵（存在时覆盖 translate/rotate/scale） */
  matrix?: DaeAffine
  /** `<instance_geometry url>` 引用的几何 id 列表 */
  instances: string[]
  children: DaeSceneNode[]
}

/** 仿射（3×3 行主序线性部分 + 平移） */
interface DaeAffine {
  m: number[]
  t: Vec3
}

/* ------------------------------------------------------------------ */
/* 极简 XML 解析器（手写，无第三方依赖）                                 */
/* ------------------------------------------------------------------ */

/** 去命名空间前缀：`ns:geometry` → `geometry` */
function localName(raw: string): string {
  const i = raw.indexOf(':')
  return i >= 0 ? raw.slice(i + 1) : raw
}

/** 找到标签结束的 `>`（跳过引号内的 `>`） */
function findTagEnd(src: string, from: number): number {
  let i = from
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i] as string
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '>') {
      return i
    }
    i++
  }
  throw new Error('XML 标签未闭合')
}

const ATTR_RE = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/**
 * 解析 XML 文本为节点树。支持：声明 `<?...?>`、注释 `<!-- -->`、CDATA、DOCTYPE、
 * 自闭合标签、命名空间前缀（保留本地名）、单双引号属性。
 * 结构非法（标签未闭合 / 结束标签不匹配）抛 Error。
 */
function parseXml(src: string): XmlNode[] {
  const roots: XmlNode[] = []
  const stack: XmlNode[] = []
  const n = src.length
  let i = 0

  const appendText = (text: string): void => {
    const top = stack[stack.length - 1]
    if (top) top.text += text
  }

  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      appendText(src.slice(i))
      break
    }
    if (lt > i) appendText(src.slice(i, lt))

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt)
      if (end < 0) throw new Error('XML 注释未闭合')
      i = end + 3
      continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt)
      if (end < 0) throw new Error('CDATA 未闭合')
      appendText(src.slice(lt + 9, end))
      i = end + 3
      continue
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt)
      if (end < 0) throw new Error('XML 声明未闭合')
      i = end + 2
      continue
    }
    if (src.startsWith('<!', lt)) {
      const end = findTagEnd(src, lt)
      i = end + 1
      continue
    }

    const gt = findTagEnd(src, lt)
    const inner = src.slice(lt + 1, gt)

    /* 结束标签 */
    if (inner.startsWith('/')) {
      const name = localName(inner.slice(1).trim())
      const top = stack[stack.length - 1]
      if (!top || top.name !== name) throw new Error(`XML 结束标签 </${name}> 不匹配`)
      stack.pop()
      i = gt + 1
      continue
    }

    /* 起始标签（可能自闭合） */
    const selfClosing = inner.endsWith('/')
    const head = selfClosing ? inner.slice(0, -1) : inner
    const spaceIdx = head.search(/\s/)
    const rawName = spaceIdx >= 0 ? head.slice(0, spaceIdx) : head
    const node: XmlNode = { name: localName(rawName), attrs: {}, children: [], text: '' }
    const attrSrc = spaceIdx >= 0 ? head.slice(spaceIdx + 1) : ''
    ATTR_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = ATTR_RE.exec(attrSrc)) !== null) {
      node.attrs[localName(m[1] as string)] = (m[2] ?? m[3] ?? '') as string
    }

    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else roots.push(node)
    if (!selfClosing) stack.push(node)
    i = gt + 1
  }

  if (stack.length > 0) throw new Error(`XML 标签 <${stack[stack.length - 1]!.name}> 未闭合`)
  return roots
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function safeIdPart(raw: string, fallback: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_-]/g, '_')
  return s.length > 0 ? s : fallback
}

function fmtNum(x: number): string {
  return String(Math.round(x * 1000) / 1000)
}

/** 按空白/逗号切分浮点串 */
function parseFloats(text: string): number[] {
  const out: number[] = []
  for (const tok of text.split(/[\s,]+/)) {
    if (tok.length === 0) continue
    const v = Number(tok)
    if (Number.isFinite(v)) out.push(v)
  }
  return out
}

/** 取子元素（本地名）中第一个 */
function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name)
}

/** 取全部同名子元素 */
function childrenOf(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : []
}

/** 深度优先查找首个同名后代 */
function findDescendant(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined
  for (const c of node.children) {
    if (c.name === name) return c
    const d = findDescendant(c, name)
    if (d) return d
  }
  return undefined
}

/** 属性 `#id` → 去掉 `#` */
function idRef(attr: string | undefined): string {
  if (!attr) return ''
  return attr.startsWith('#') ? attr.slice(1) : attr
}

/* ------------------------------------------------------------------ */
/* 仿射数学（3×3 行主序 + 平移）                                         */
/* ------------------------------------------------------------------ */

function affineIdentity(): DaeAffine {
  return { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] }
}

/** 3×3 行主序矩阵乘 */
function mat3Mul(a: number[], b: number[]): number[] {
  const out = new Array<number>(9).fill(0)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0
      for (let k = 0; k < 3; k++) s += (a[r * 3 + k] as number) * (b[k * 3 + c] as number)
      out[r * 3 + c] = s
    }
  }
  return out
}

function mat3Apply(m: number[], v: Vec3): Vec3 {
  return [
    (m[0] as number) * v[0] + (m[1] as number) * v[1] + (m[2] as number) * v[2],
    (m[3] as number) * v[0] + (m[4] as number) * v[1] + (m[5] as number) * v[2],
    (m[6] as number) * v[0] + (m[7] as number) * v[1] + (m[8] as number) * v[2]
  ]
}

const IDENT3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

function mat3IsIdentity(m: number[], eps = 1e-9): boolean {
  for (let i = 0; i < 9; i++) if (Math.abs((m[i] as number) - (IDENT3[i] as number)) > eps) return false
  return true
}

/** 仿射复合：a ∘ b（先 b 后 a） */
function affineMul(a: DaeAffine, b: DaeAffine): DaeAffine {
  return { m: mat3Mul(a.m, b.m), t: mat3Apply(a.m, b.t).map((x, i) => x + (a.t[i] as number)) as Vec3 }
}

function affineApply(a: DaeAffine, v: Vec3): Vec3 {
  const p = mat3Apply(a.m, v)
  return [p[0] + a.t[0], p[1] + a.t[1], p[2] + a.t[2]]
}

/** 轴角（度）→ 3×3 旋转矩阵（行主序） */
function axisAngleMatrix3(axis: Vec3, angleDeg: number): number[] {
  const len = Math.hypot(axis[0], axis[1], axis[2])
  if (len < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const x = axis[0] / len
  const y = axis[1] / len
  const z = axis[2] / len
  const rad = (angleDeg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const t = 1 - c
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c
  ]
}

/* ------------------------------------------------------------------ */
/* `<source>` / accessor 解析                                           */
/* ------------------------------------------------------------------ */

/**
 * 收集几何内全部 `<source>`。元组步长取 accessor 的 `stride`（缺省 = `<param>` 个数），
 * 支持交错 stride（stride > 元组长度）。
 */
function collectSources(root: XmlNode): Map<string, DaeSource> {
  const map = new Map<string, DaeSource>()
  for (const src of childrenOf(root, 'source')) {
    const id = src.attrs.id
    if (!id) continue
    const fa = child(src, 'float_array')
    if (!fa) continue
    const floats = parseFloats(fa.text)
    const accessor = findDescendant(src, 'accessor')
    const params = accessor ? childrenOf(accessor, 'param').length : 0
    const strideAttr = accessor?.attrs.stride ? Number(accessor.attrs.stride) : NaN
    const stride = Number.isFinite(strideAttr) && strideAttr > 0 ? strideAttr : params || 1
    const offset = accessor?.attrs.offset ? Number(accessor.attrs.offset) : 0
    const countAttr = accessor?.attrs.count ? Number(accessor.attrs.count) : NaN
    const count = Number.isFinite(countAttr) && countAttr > 0 ? countAttr : Math.floor(floats.length / stride)
    map.set(id, { id, floats, stride, offset: Number.isFinite(offset) ? offset : 0, count })
  }
  return map
}

/** 按 accessor 交错参数读出 `count` 个长度为 `tupleSize` 的元组 */
function readTuples(src: DaeSource, tupleSize: number): number[][] {
  const out: number[][] = []
  for (let i = 0; i < src.count; i++) {
    const base = src.offset + i * src.stride
    const tuple: number[] = []
    for (let k = 0; k < tupleSize; k++) tuple.push(src.floats[base + k] ?? 0)
    out.push(tuple)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 几何抽取                                                             */
/* ------------------------------------------------------------------ */

interface DaePrimitivePoly {
  /** 位置索引（每个角） */
  pos: number[]
  /** UV 索引（每个角；无 UV 输入时为 null） */
  uv: number[] | null
}

/**
 * 解析一个图元元素（`<triangles>` / `<polylist>` / `<polygons>`）为多边形列表。
 * `<p>` 按各 `<input>` 的 offset 交错排布；`<polylist>` 用 `<vcount>` 切分；
 * `<polygons>` 的每个 `<p>` 子元素为一个多边形。
 */
function parsePrimitive(el: XmlNode): DaePrimitivePoly[] {
  const inputs = childrenOf(el, 'input')
  let offVertex = -1
  let offUv = -1
  for (const inp of inputs) {
    const off = inp.attrs.offset ? Number(inp.attrs.offset) : 0
    if (inp.attrs.semantic === 'VERTEX') offVertex = off
    else if (inp.attrs.semantic === 'TEXCOORD') offUv = off
  }
  if (offVertex < 0) return []
  const stride = Math.max(offVertex, offUv, 0) + 1

  const pLists = childrenOf(el, 'p').map((p) => parseFloats(p.text))
  if (pLists.length === 0) return []
  const vcount = childrenOf(el, 'vcount').flatMap((vc) => parseFloats(vc.text))

  /* 每元素一个多边形（`<triangles>` = 3 角固定；`<polygons>` = 每个 `<p>` 一个） */
  const polys: DaePrimitivePoly[] = []
  const pushPoly = (indices: number[]): void => {
    const pos: number[] = []
    const uv: number[] | null = offUv >= 0 ? [] : null
    for (let j = 0; j < indices.length / stride; j++) {
      const base = j * stride
      pos.push(indices[base + offVertex] ?? -1)
      if (uv) uv.push(indices[base + offUv] ?? -1)
    }
    if (pos.length >= 3) polys.push({ pos, uv })
  }

  if (vcount.length > 0) {
    /* `<polylist>`：单个 `<p>` + `<vcount>` 逐面切分 */
    const flat = pLists[0] as number[]
    let corner = 0
    for (const n of vcount) {
      const c = Math.max(0, Math.floor(n))
      if (c === 0) continue
      pushPoly(flat.slice(corner * stride, (corner + c) * stride))
      corner += c
    }
    return polys
  }

  if (el.name === 'polygons') {
    for (const flat of pLists) pushPoly(flat)
    return polys
  }

  /* `<triangles>` / 无 vcount 的 `<polylist>`：每 3 角一组 */
  const flat = pLists[0] as number[]
  const cornerCount = Math.floor(flat.length / stride)
  for (let c = 0; c + 3 <= cornerCount; c += 3) {
    pushPoly(flat.slice(c * stride, (c + 3) * stride))
  }
  return polys
}

/** 单个 `<geometry>` → 几何（位置池 + 面） */
function extractGeometry(
  geoNode: XmlNode,
  texSize: number,
  mark: (k: 'fan' | 'noUv') => void
): DaeGeometry | null {
  const meshNode = child(geoNode, 'mesh')
  if (!meshNode) return null
  const id = geoNode.attrs.id || geoNode.attrs.name || 'geometry'
  const name = geoNode.attrs.name || id
  const sources = collectSources(meshNode)

  /* `<vertices>`：semantic POSITION → 位置 source id */
  const verticesPos = new Map<string, string>()
  for (const v of childrenOf(meshNode, 'vertices')) {
    const vid = v.attrs.id
    if (!vid) continue
    for (const inp of childrenOf(v, 'input')) {
      if (inp.attrs.semantic === 'POSITION') verticesPos.set(vid, idRef(inp.attrs.source))
    }
  }

  const primEls = [...childrenOf(meshNode, 'triangles'), ...childrenOf(meshNode, 'polylist'), ...childrenOf(meshNode, 'polygons')]
  if (primEls.length === 0) return null

  let vertices: Vec3[] = []
  const faces: { vertices: number[]; uv: Vec2[] }[] = []
  let uvResolved = false

  for (const prim of primEls) {
    const polys = parsePrimitive(prim)
    if (polys.length === 0) continue

    /* 该图元的位置 / UV source */
    const inputs = childrenOf(prim, 'input')
    const vertexInput = inputs.find((i) => i.attrs.semantic === 'VERTEX')
    const uvInput = inputs.find((i) => i.attrs.semantic === 'TEXCOORD')
    const vertexRef = idRef(vertexInput?.attrs.source)
    const posSourceId = verticesPos.get(vertexRef) ?? vertexRef
    const posSource = sources.get(posSourceId)
    if (!posSource) continue
    const posTuples = readTuples(posSource, 3)
    if (vertices.length < posTuples.length) {
      vertices = posTuples.map((p) => [p[0] as number, p[1] as number, p[2] as number] as Vec3)
    }

    const uvSource = uvInput ? sources.get(idRef(uvInput.attrs.source)) : undefined
    const uvTuples = uvSource ? readTuples(uvSource, 2) : []
    if (uvTuples.length > 0) uvResolved = true

    for (const poly of polys) {
      /* 越界索引过滤；<3 有效顶点跳过 */
      const pos: number[] = []
      const uvIdx: number[] = []
      for (let j = 0; j < poly.pos.length; j++) {
        const vi = poly.pos[j] as number
        if (!Number.isInteger(vi) || vi < 0 || vi >= vertices.length) continue
        pos.push(vi)
        uvIdx.push(poly.uv ? (poly.uv[j] as number) : -1)
      }
      if (pos.length < 3) continue

      /** 逐角 UV：Collada 为 0..1、左下原点 → 编辑器像素坐标、左上原点 */
      const cornerUv = (slot: number, count: number): Vec2 => {
        const ui = uvIdx[slot]
        const pair = ui !== undefined && ui >= 0 && ui < uvTuples.length ? uvTuples[ui] : undefined
        if (!pair) {
          const t = count > 1 ? slot / (count - 1) : 0
          return [t * texSize, t * texSize]
        }
        return [(pair[0] as number) * texSize, (1 - (pair[1] as number)) * texSize]
      }

      if (pos.length <= 4) {
        faces.push({ vertices: pos, uv: pos.map((_, j) => cornerUv(j, pos.length)) })
        continue
      }
      /* >4 顶点：扇形三角化 */
      for (let i = 1; i < pos.length - 1; i++) {
        faces.push({
          vertices: [pos[0] as number, pos[i] as number, pos[i + 1] as number],
          uv: [cornerUv(0, 3), cornerUv(i, 3), cornerUv(i + 1, 3)]
        })
      }
      mark('fan')
    }
  }

  if (faces.length === 0) return null
  if (!uvResolved) mark('noUv')
  return { id, name, vertices, faces }
}

/* ------------------------------------------------------------------ */
/* 场景抽取                                                             */
/* ------------------------------------------------------------------ */

/** `<node>` → 场景节点（变换 + 实例 + 嵌套子节点） */
function parseSceneNode(node: XmlNode): DaeSceneNode {
  const translation: Vec3 = [0, 0, 0]
  const scale: Vec3 = [1, 1, 1]
  const rotations: DaeRotate[] = []
  let matrix: DaeAffine | undefined

  const tr = child(node, 'translate')
  if (tr) {
    const f = parseFloats(tr.text)
    if (f.length >= 3) {
      translation[0] = f[0] as number
      translation[1] = f[1] as number
      translation[2] = f[2] as number
    }
  }
  const sc = child(node, 'scale')
  if (sc) {
    const f = parseFloats(sc.text)
    if (f.length >= 3) {
      scale[0] = f[0] as number
      scale[1] = f[1] as number
      scale[2] = f[2] as number
    }
  }
  for (const rot of childrenOf(node, 'rotate')) {
    const f = parseFloats(rot.text)
    if (f.length >= 4) {
      rotations.push({ axis: [f[0] as number, f[1] as number, f[2] as number], angle: f[3] as number })
    }
  }
  const mx = child(node, 'matrix')
  if (mx) {
    const f = parseFloats(mx.text)
    if (f.length >= 16) {
      matrix = {
        m: [f[0] as number, f[1] as number, f[2] as number, f[4] as number, f[5] as number, f[6] as number, f[8] as number, f[9] as number, f[10] as number],
        t: [f[3] as number, f[7] as number, f[11] as number]
      }
    }
  }

  const instances: string[] = []
  for (const inst of childrenOf(node, 'instance_geometry')) {
    const ref = idRef(inst.attrs.url)
    if (ref) instances.push(ref)
  }

  return {
    id: node.attrs.id ?? '',
    name: node.attrs.name ?? node.attrs.id ?? '',
    translation,
    rotations,
    scale,
    matrix,
    instances,
    children: childrenOf(node, 'node').map(parseSceneNode)
  }
}

/** 场景节点 → 仿射（`<matrix>` 优先；否则 T ∘ R ∘ S） */
function nodeAffine(node: DaeSceneNode): DaeAffine {
  if (node.matrix) return node.matrix
  let m = IDENT3
  for (const rot of node.rotations) m = mat3Mul(m, axisAngleMatrix3(rot.axis, rot.angle))
  const s = node.scale
  if (s[0] !== 1 || s[1] !== 1 || s[2] !== 1) {
    m = mat3Mul(m, [s[0], 0, 0, 0, s[1], 0, 0, 0, s[2]])
  }
  return { m, t: [node.translation[0], node.translation[1], node.translation[2]] }
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/**
 * Collada (.dae) 文本 → ModelDocument。
 *
 * - 无几何 → 返回空文档并 `dae_no_geometry` 告警（不抛错）；
 * - XML 结构非法抛 Error（调用方按软失败展示）。
 */
export function daeToDocument(xml: string, options?: DaeImportOptions): FormatImportResult {
  const texSize = options?.textureSize ?? DEFAULT_TEXTURE_SIZE
  const downgrades: FormatDowngrade[] = []
  const push = (severity: 'warning' | 'info', code: string, message: string): void => {
    downgrades.push({ severity, code, message })
  }

  const roots = parseXml(xml)
  const collada = roots.find((r) => r.name === 'COLLADA') ?? roots[0]
  if (!collada) throw new Error('不是有效的 Collada 文档（缺少 COLLADA 根元素）')

  /* 1) asset：单位与 up_axis */
  const asset = child(collada, 'asset')
  const unitMeter = asset ? child(asset, 'unit')?.attrs.meter : undefined
  const upAxis = (child(asset ?? collada, 'up_axis')?.text ?? '').trim().toUpperCase()

  /* 2) 不支持的元素（动画/材质/蒙皮等）统一 info 降级 */
  const unsupported = new Set<string>()
  for (const lib of ['library_controllers', 'library_animations', 'library_effects', 'library_materials', 'library_images']) {
    if (child(collada, lib)) unsupported.add(lib)
  }
  const hasSkin =
    !!findDescendant(child(collada, 'library_geometries'), 'skin') ||
    !!findDescendant(child(collada, 'library_visual_scenes'), 'instance_controller')
  if (hasSkin) unsupported.add('skin')
  if (unsupported.size > 0) {
    push(
      'info',
      'dae_unsupported_element',
      `已跳过 Collada 中不支持的部分：${[...unsupported].join('、')}（本次不导入材质/贴图/动画/骨骼）`
    )
  }
  if (child(collada, 'library_materials') || child(collada, 'library_images')) {
    push('info', 'dae_texture_not_imported', 'Collada 材质/贴图引用未导入（面不绑定贴图，逐顶点 UV 已保留）')
  }

  /* 3) 几何抽取 */
  const geoNodes = childrenOf(child(collada, 'library_geometries'), 'geometry')
  let fanTriangulated = false
  let missingUv = false
  const geometries = new Map<string, DaeGeometry>()
  for (const g of geoNodes) {
    const geo = extractGeometry(g, texSize, (k) => {
      if (k === 'fan') fanTriangulated = true
      else missingUv = true
    })
    if (geo) geometries.set(geo.id, geo)
  }

  /* 4) 场景抽取 */
  const sceneRoot = findDescendant(child(collada, 'library_visual_scenes'), 'visual_scene')
    ?? child(collada, 'library_visual_scenes')
  const sceneNodes = sceneRoot ? childrenOf(sceneRoot, 'node').map(parseSceneNode) : []

  /* 5) 组装文档 */
  const now = options?.now ?? Date.now()
  const docId = safeIdPart(options?.id ?? options?.name ?? '', 'dae_model') || 'dae_model'
  let doc: ModelDocument = createDocument({
    id: docId,
    name: options?.name || docId,
    format: options?.format ?? 'free',
    settings: { uvMode: 'per_face', textureSize: [texSize, texSize] },
    now
  })

  /** 链上是否存在非恒等线性部分（触发整链烘焙告警） */
  let baked = false
  /** 实例化几何 → MeshNode（顶点按仿射规则写入） */
  const attach = (
    parentId: NodeId | null,
    geo: DaeGeometry,
    acc: DaeAffine,
    chainIdentity: boolean,
    seq: number
  ): NodeId => {
    const worldVerts: Vec3[] = chainIdentity
      ? geo.vertices.map((v) => [v[0] + acc.t[0], v[1] + acc.t[1], v[2] + acc.t[2]] as Vec3)
      : geo.vertices.map((v) => affineApply(acc, v))
    if (!chainIdentity) baked = true
    const mesh = createMeshNode(geo.name, { vertices: worldVerts, faces: geo.faces })
    mesh.id = `dae_geo_${safeIdPart(geo.id, 'g')}_${seq}`
    doc = addNode(doc, mesh, parentId)
    return mesh.id
  }

  let meshCount = 0
  const usedGeos = new Set<string>()
  const walk = (
    node: DaeSceneNode,
    parentId: NodeId | null,
    parentAff: DaeAffine,
    parentIdentity: boolean
  ): void => {
    const own = nodeAffine(node)
    const acc = affineMul(parentAff, own)
    const chainIdentity = parentIdentity && mat3IsIdentity(own.m)
    const hasChildren = node.children.length > 0
    const inst = node.instances.filter((ref) => geometries.has(ref))
    if (inst.length === 0 && !hasChildren) return

    const group = createGroupNode(node.name || 'node')
    group.id = `dae_node_${safeIdPart(node.id || node.name, 'n')}`
    doc = addNode(doc, group, parentId)

    for (const ref of inst) {
      const geo = geometries.get(ref)
      if (!geo) continue
      usedGeos.add(ref)
      attach(group.id, geo, acc, chainIdentity, ++meshCount)
    }
    for (const ch of node.children) walk(ch, group.id, acc, chainIdentity)
  }

  for (const sn of sceneNodes) walk(sn, null, affineIdentity(), true)

  /* 场景里没有可用实例 → 几何平铺到根 */
  if (usedGeos.size === 0 && geometries.size > 0) {
    for (const geo of geometries.values()) {
      attach(null, geo, affineIdentity(), true, ++meshCount)
      usedGeos.add(geo.id)
    }
    push('info', 'dae_no_scene_flat', 'Collada 场景未提供可用的几何实例，几何已平铺为根级网格节点')
  }

  /* 6) up_axis：Z_UP / X_UP → +Y 向上（全局旋转，烘焙进顶点） */
  let upRotated = false
  const upMatrix = (): number[] | null => {
    if (upAxis === 'Z_UP') return axisAngleMatrix3([1, 0, 0], -90)
    if (upAxis === 'X_UP') return axisAngleMatrix3([0, 0, 1], 90)
    return null
  }
  const um = upMatrix()
  if (um) {
    const rot: DaeAffine = { m: um, t: [0, 0, 0] }
    doc = applyToAllMeshes(doc, (v) => affineApply(rot, v))
    upRotated = true
    push('info', 'dae_up_axis_converted', `Collada up_axis=${upAxis}，已旋转使 +Y 向上`)
  }

  /* 7) fitToBox：整模型等比缩放+居中装进 0..16 */
  const fit = options?.fitToBox ?? true
  let boxSize: Vec3 | null = null
  if (fit && usedGeos.size > 0) {
    boxSize = meshBounds(doc)
    if (boxSize) {
      const [sx, sy, sz] = boxSize
      const maxDim = Math.max(sx, sy, sz)
      const min = meshMin(doc)
      if (min && Number.isFinite(maxDim) && maxDim > 0) {
        const s = FIT_BOX_SIZE / maxDim
        const off: Vec3 = [-min[0] * s, -min[1] * s, -min[2] * s]
        doc = applyToAllMeshes(doc, (v) => [v[0] * s + off[0], v[1] * s + off[1], v[2] * s + off[2]] as Vec3)
        push(
          'info',
          'dae_scale_normalized',
          `已将模型按包围盒等比归一化到 0..16（原始尺寸 ${fmtNum(sx)}×${fmtNum(sy)}×${fmtNum(sz)}）`
        )
      }
    }
  }

  /* 8) 其余降级 */
  if (baked) {
    push(
      'info',
      'dae_transforms_baked',
      'Collada 节点含旋转/缩放，节点变换已整体烘焙进网格顶点（几何保真，组仅保留结构，pivot 不可再编辑）'
    )
  }
  if (fanTriangulated) {
    push('warning', 'dae_polygon_fan_triangulated', 'Collada 存在 >4 顶点多边形，已用扇形三角化切分为三角面')
  }
  if (missingUv) {
    push('info', 'dae_no_uv', '部分几何缺少 TEXCOORD，面 UV 已按 0..16 对角线兜底展开')
  }
  if (geometries.size === 0) {
    push('warning', 'dae_no_geometry', 'Collada 中未找到任何可用几何（library_geometries 无有效 mesh）')
  }

  doc = {
    ...doc,
    formatData: {
      dae: {
        geometries: geometries.size,
        nodes: meshCount,
        polygons: [...geometries.values()].reduce((sum, g) => sum + g.faces.length, 0),
        ...(unitMeter !== undefined ? { unitMeter } : {}),
        ...(upAxis ? { upAxis } : {}),
        ...(upRotated ? { upRotated: true } : {}),
        ...(boxSize ? { sourceBox: [fmtNum(boxSize[0]), fmtNum(boxSize[1]), fmtNum(boxSize[2])] } : {})
      }
    }
  }

  return { doc, downgrades }
}

/* ------------------------------------------------------------------ */
/* 文档级顶点变换辅助（up_axis / fitToBox 共用）                          */
/* ------------------------------------------------------------------ */

/** 对文档内全部 mesh 节点的顶点施加变换（返回新文档，不可变更新） */
function applyToAllMeshes(doc: ModelDocument, fn: (v: Vec3) => Vec3): ModelDocument {
  const nodes: Record<NodeId, ModelDocument['nodes'][string]> = { ...doc.nodes }
  for (const id of Object.keys(nodes)) {
    const node = nodes[id]!
    if (node.type !== 'mesh') continue
    nodes[id] = { ...node, vertices: node.vertices.map((v) => fn([...v] as Vec3)) }
  }
  return { ...doc, nodes }
}

/** 文档内全部 mesh 顶点的包围盒尺寸 */
function meshBounds(doc: ModelDocument): Vec3 | null {
  const min = meshMin(doc)
  if (!min) return null
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'mesh') continue
    for (const v of node.vertices) {
      if (v[0] > maxX) maxX = v[0]
      if (v[1] > maxY) maxY = v[1]
      if (v[2] > maxZ) maxZ = v[2]
    }
  }
  if (!Number.isFinite(maxX)) return null
  return [maxX - min[0], maxY - min[1], maxZ - min[2]]
}

/** 文档内全部 mesh 顶点的包围盒最小角 */
function meshMin(doc: ModelDocument): Vec3 | null {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'mesh') continue
    for (const v of node.vertices) {
      if (v[0] < minX) minX = v[0]
      if (v[1] < minY) minY = v[1]
      if (v[2] < minZ) minZ = v[2]
    }
  }
  return Number.isFinite(minX) ? [minX, minY, minZ] : null
}
