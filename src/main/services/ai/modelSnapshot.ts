/**
 * modelSnapshot：离线三视角模型快照渲染器（视觉自审方案 A）。
 *
 * 不依赖游戏在线：直接解析项目内 MC 模型 JSON（elements/faces/uv/texture 引用），
 * 解析 textures 变量引用的贴图 PNG，用正交投影 + 画家算法 + 面平均色填充，
 * 输出 front / side / iso 三张 PNG（data URL），供视觉模型评审与数值指标计算。
 *
 * 设计要点：
 * - 纯函数，副作用仅经注入的 readFile（返回 Buffer 或 null），单测可全 mock；
 * - 贴图编解码复用 pixelize（pngjs，无原生依赖）；
 * - 支持元素 rotation（单轴、22.5° 倍数、rescale 近似）与 texture_size；
 * - 无 elements 但有 layer0（item/generated 系）时退化为薄板精灵渲染，
 *   让「扁平贴图杆」在评审图上如实呈现；
 * - 贴图缺失用品红兜底并在 warnings 中如实记录。
 */
import path from 'node:path'
import type { Raster } from './pixelize'
import { decodePng, encodePng } from './pixelize'

export type SnapshotViewName = 'front' | 'side' | 'iso'

export interface SnapshotView {
  view: SnapshotViewName
  raster: Raster
  dataUrl: string
}

export interface ModelSnapshotResult {
  views: SnapshotView[]
  /** 渲染过程中的如实告警（贴图缺失/无 elements 退化等） */
  warnings: string[]
}

/** 读取项目文件（模型 JSON / 贴图 PNG）；不存在返回 null */
export type SnapshotReadFile = (absPath: string) => Buffer | null

/* ------------------------------------------------------------------ */
/* 数值指标（纯像素，供硬门外的客观护栏）                                */
/* ------------------------------------------------------------------ */

export interface SnapshotMetrics {
  /** 三视角主体像素占比均值（期望 0.14~0.70） */
  occupancy: number
  /** 主体像素贴画布边缘比例（期望 ≤0.08） */
  clipping: number
  /** 亮度标准差归一（期望 ≥0.20） */
  contrast: number
  /** 邻域色差像素占比（期望 ≥0.015） */
  edgeDensity: number
  /** 正/侧视纵向剪影一致度 IoU（仅参考，不做一票否决） */
  viewConsistency: number
}

export const METRIC_RANGES = {
  occupancy: { min: 0.14, max: 0.70 },
  clipping: { max: 0.08 },
  contrast: { min: 0.2 },
  edgeDensity: { min: 0.015 }
} as const

/** 指标越界列表（viewConsistency 仅参考不参与）；空数组 = 全部达标 */
export function metricViolations(m: SnapshotMetrics): string[] {
  const out: string[] = []
  if (m.occupancy < METRIC_RANGES.occupancy.min) out.push(`主体占比过低（${m.occupancy.toFixed(3)} < ${METRIC_RANGES.occupancy.min}）`)
  if (m.occupancy > METRIC_RANGES.occupancy.max) out.push(`主体占比过高（${m.occupancy.toFixed(3)} > ${METRIC_RANGES.occupancy.max}）`)
  if (m.clipping > METRIC_RANGES.clipping.max) out.push(`主体贴边溢出（${m.clipping.toFixed(3)} > ${METRIC_RANGES.clipping.max}）`)
  if (m.contrast < METRIC_RANGES.contrast.min) out.push(`亮度对比不足（${m.contrast.toFixed(3)} < ${METRIC_RANGES.contrast.min}）`)
  if (m.edgeDensity < METRIC_RANGES.edgeDensity.min) out.push(`边缘细节过少（${m.edgeDensity.toFixed(4)} < ${METRIC_RANGES.edgeDensity.min}）`)
  return out
}

function forEachOpaque(r: Raster, fn: (i: number, x: number, y: number) => void): number {
  let n = 0
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const i = (y * r.width + x) * 4
      if (r.data[i + 3] >= 8) {
        n++
        fn(i, x, y)
      }
    }
  }
  return n
}

export function computeSnapshotMetrics(views: SnapshotView[]): SnapshotMetrics {
  const totalPx = views.reduce((s, v) => s + v.raster.width * v.raster.height, 0)
  let opaqueTotal = 0
  let borderOpaque = 0
  let edgePx = 0
  let lumSum = 0
  let lumSq = 0

  for (const v of views) {
    const r = v.raster
    opaqueTotal += forEachOpaque(r, (i, x, y) => {
      const d = r.data
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      lumSum += lum
      lumSq += lum * lum
      if (x < 2 || y < 2 || x >= r.width - 2 || y >= r.height - 2) borderOpaque++
      /* 4 邻域边缘检测：右/下邻居颜色距离超阈值记一次 */
      const right = (y * r.width + x + 1) * 4
      const down = ((y + 1) * r.width + x) * 4
      const dist = (j: number): number =>
        Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2])
      if (x + 1 < r.width && d[right + 3] >= 8 && dist(right) > 48) edgePx++
      else if (y + 1 < r.height && d[down + 3] >= 8 && dist(down) > 48) edgePx++
    })
  }

  const mean = opaqueTotal > 0 ? lumSum / opaqueTotal : 0
  const variance = opaqueTotal > 0 ? lumSq / opaqueTotal - mean * mean : 0

  /* 正/侧视纵向剪影一致度：逐行不透明占比向量的 min/max IoU */
  const rowProfile = (r: Raster): number[] => {
    const prof = new Array<number>(r.height).fill(0)
    forEachOpaque(r, (_i, _x, y) => {
      prof[y] += 1 / r.width
    })
    return prof
  }
  let viewConsistency = 0
  const front = views.find((v) => v.view === 'front')
  const side = views.find((v) => v.view === 'side')
  if (front && side && front.raster.height === side.raster.height) {
    const pf = rowProfile(front.raster)
    const ps = rowProfile(side.raster)
    let inter = 0
    let union = 0
    for (let i = 0; i < pf.length; i++) {
      inter += Math.min(pf[i], ps[i])
      union += Math.max(pf[i], ps[i])
    }
    viewConsistency = union > 0 ? inter / union : 0
  }

  return {
    occupancy: totalPx > 0 ? opaqueTotal / totalPx : 0,
    clipping: opaqueTotal > 0 ? borderOpaque / opaqueTotal : 0,
    contrast: Math.sqrt(Math.max(0, variance)) / 128,
    edgeDensity: opaqueTotal > 0 ? edgePx / opaqueTotal : 0,
    viewConsistency
  }
}

/* ------------------------------------------------------------------ */
/* 模型 JSON 解析                                                       */
/* ------------------------------------------------------------------ */

type Vec3 = [number, number, number]

interface ModelRotation {
  origin: Vec3
  axis: 'x' | 'y' | 'z'
  angle: number
  rescale?: boolean
}

interface ModelFace {
  uv: [number, number, number, number]
  /** 已解引用的贴图变量名（去 # 前缀） */
  texture: string
}

interface ModelElement {
  from: Vec3
  to: Vec3
  rotation?: ModelRotation
  shade: boolean
  faces: Partial<Record<string, ModelFace>>
}

interface ParsedModel {
  elements: ModelElement[]
  /** 贴图变量 → 磁盘绝对路径（未解析成功的变量缺席） */
  textureFiles: Record<string, string>
  /** uv 空间尺寸（默认 16×16） */
  texSize: [number, number]
  warnings: string[]
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum)

const FACE_NAMES = ['north', 'south', 'east', 'west', 'up', 'down'] as const
type FaceName = (typeof FACE_NAMES)[number]

/** 模型绝对路径 → assets 根（…/assets）与命名空间；路径不含 /assets/ 返回 null */
function splitAssetsRoot(modelAbsPath: string): { assetsRoot: string; namespace: string } | null {
  const norm = modelAbsPath.replace(/\\/g, '/')
  const m = /^(.*\/assets)\/([^/]+)\/models\//.exec(norm)
  if (!m) return null
  return { assetsRoot: m[1], namespace: m[2] }
}

/** 贴图引用（"ns:path" / "path"）→ 磁盘绝对路径 */
function resolveTextureRef(assetsRoot: string, ownNs: string, ref: string): string {
  const colon = ref.indexOf(':')
  const ns = colon >= 0 ? ref.slice(0, colon) : ownNs
  const p = colon >= 0 ? ref.slice(colon + 1) : ref
  return path.join(assetsRoot, ns, 'textures', `${p}.png`)
}

/** 解析模型 JSON；无法解析返回 null */
export function parseModelJson(readFile: SnapshotReadFile, modelAbsPath: string): ParsedModel | null {
  const buf = readFile(modelAbsPath)
  if (!buf) return null
  let json: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(buf.toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    json = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const warnings: string[] = []
  const loc = splitAssetsRoot(modelAbsPath)

  /* textures 变量表：值可能是 "ns:path" 或 "#other" 链式引用 */
  const rawTextures =
    typeof json['textures'] === 'object' && json['textures'] !== null && !Array.isArray(json['textures'])
      ? (json['textures'] as Record<string, unknown>)
      : {}
  const deref = (name: string): string | null => {
    let cur: unknown = rawTextures[name]
    const seen = new Set<string>([name])
    while (typeof cur === 'string' && cur.startsWith('#')) {
      const next = cur.slice(1)
      if (seen.has(next)) return null
      seen.add(next)
      cur = rawTextures[next]
    }
    return typeof cur === 'string' ? cur : null
  }

  const textureFiles: Record<string, string> = {}
  if (loc) {
    for (const name of Object.keys(rawTextures)) {
      const ref = deref(name)
      if (!ref) continue
      if (ref.startsWith('minecraft:')) continue // 原版内置贴图不在项目内
      textureFiles[name] = resolveTextureRef(loc.assetsRoot, loc.namespace, ref)
    }
  } else if (Object.keys(rawTextures).length > 0) {
    warnings.push('模型路径不含 /assets/ 段，贴图引用无法定位')
  }

  /* texture_size（默认 16×16） */
  let texSize: [number, number] = [16, 16]
  const ts = json['texture_size']
  if (Array.isArray(ts) && ts.length === 2 && ts.every(isNum)) texSize = [ts[0], ts[1]]

  /* elements */
  const elements: ModelElement[] = []
  const rawElements = Array.isArray(json['elements']) ? (json['elements'] as unknown[]) : []
  for (const raw of rawElements) {
    if (typeof raw !== 'object' || raw === null) continue
    const el = raw as Record<string, unknown>
    if (!isVec3(el['from']) || !isVec3(el['to'])) continue
    const out: ModelElement = {
      from: [...el['from']] as Vec3,
      to: [...el['to']] as Vec3,
      shade: el['shade'] !== false,
      faces: {}
    }
    const rot = el['rotation']
    if (typeof rot === 'object' && rot !== null) {
      const r = rot as Record<string, unknown>
      if (isVec3(r['origin']) && (r['axis'] === 'x' || r['axis'] === 'y' || r['axis'] === 'z') && isNum(r['angle'])) {
        out.rotation = {
          origin: [...r['origin']] as Vec3,
          axis: r['axis'],
          angle: r['angle'],
          ...(r['rescale'] === true ? { rescale: true } : {})
        }
      }
    }
    const faces = el['faces']
    if (typeof faces === 'object' && faces !== null) {
      for (const face of FACE_NAMES) {
        const f = (faces as Record<string, unknown>)[face]
        if (typeof f !== 'object' || f === null) continue
        const fo = f as Record<string, unknown>
        const texRaw = typeof fo['texture'] === 'string' ? fo['texture'] : ''
        const tex = texRaw.startsWith('#') ? texRaw.slice(1) : texRaw
        if (!tex) continue
        const uv = Array.isArray(fo['uv']) && fo['uv'].length === 4 && fo['uv'].every(isNum)
          ? ([...fo['uv']] as [number, number, number, number])
          : null
        out.faces[face] = {
          /* 无 uv 的面按整幅贴图渲染（MC 会按 from/to 推导，平均色填充下差异可忽略） */
          uv: uv ?? [0, 0, 16, 16],
          texture: tex
        }
      }
    }
    elements.push(out)
  }

  /* item/generated 退化：无 elements 但有 layer0 → 薄板精灵如实呈现 */
  if (elements.length === 0 && textureFiles['layer0']) {
    warnings.push('模型无 elements（item/generated 扁平贴图），按薄板精灵渲染')
    elements.push({
      from: [0, 0, 7.5],
      to: [16, 16, 8.5],
      shade: false,
      faces: {
        north: { uv: [0, 0, 16, 16], texture: 'layer0' },
        south: { uv: [0, 0, 16, 16], texture: 'layer0' }
      }
    })
  }

  return { elements, textureFiles, texSize, warnings }
}

/* ------------------------------------------------------------------ */
/* 贴图采样                                                             */
/* ------------------------------------------------------------------ */

/** 缺失贴图品红（MC missing texture 观感） */
const MISSING_COLOR: [number, number, number] = [248, 0, 248]

/** 贴图 uv 区域平均色（uv 为 0..textureSize 空间）；全透明返回 null */
function averageFaceColor(
  tex: Raster,
  uv: [number, number, number, number],
  texSize: [number, number]
): [number, number, number] | null {
  const sx = tex.width / texSize[0]
  const sy = tex.height / texSize[1]
  const x0 = Math.max(0, Math.floor(Math.min(uv[0], uv[2]) * sx))
  const x1 = Math.min(tex.width, Math.ceil(Math.max(uv[0], uv[2]) * sx))
  const y0 = Math.max(0, Math.floor(Math.min(uv[1], uv[3]) * sy))
  const y1 = Math.min(tex.height, Math.ceil(Math.max(uv[1], uv[3]) * sy))
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * tex.width + x) * 4
      if (tex.data[i + 3] < 8) continue
      r += tex.data[i]
      g += tex.data[i + 1]
      b += tex.data[i + 2]
      n++
    }
  }
  if (n === 0) return null
  return [r / n, g / n, b / n]
}

/* ------------------------------------------------------------------ */
/* 几何与投影                                                           */
/* ------------------------------------------------------------------ */

const FACE_NORMALS: Record<FaceName, Vec3> = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  west: [-1, 0, 0],
  east: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0]
}

/** 面四角（世界坐标，未旋转）；顺序保证边相邻 */
function faceCorners(el: ModelElement, face: FaceName): Vec3[] {
  const [x1, y1, z1] = el.from
  const [x2, y2, z2] = el.to
  switch (face) {
    case 'north': return [[x1, y1, z1], [x2, y1, z1], [x2, y2, z1], [x1, y2, z1]]
    case 'south': return [[x2, y1, z2], [x1, y1, z2], [x1, y2, z2], [x2, y2, z2]]
    case 'west': return [[x1, y1, z2], [x1, y1, z1], [x1, y2, z1], [x1, y2, z2]]
    case 'east': return [[x2, y1, z1], [x2, y1, z2], [x2, y2, z2], [x2, y2, z1]]
    case 'up': return [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]]
    case 'down': return [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]]
  }
}

/**
 * 元素旋转：绕 origin、单轴。MC 语义为正角 = 从轴正端朝原点看顺时针，
 * 即右手系下取负角；rescale 在垂直平面放大 |cos|+|sin| 近似。
 */
function rotateVec(p: Vec3, rot: ModelRotation): Vec3 {
  const rad = (-rot.angle * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const dx = p[0] - rot.origin[0]
  const dy = p[1] - rot.origin[1]
  const dz = p[2] - rot.origin[2]
  let r: Vec3
  if (rot.axis === 'x') r = [dx, dy * c - dz * s, dy * s + dz * c]
  else if (rot.axis === 'y') r = [dx * c + dz * s, dy, -dx * s + dz * c]
  else r = [dx * c - dy * s, dx * s + dy * c, dz]
  if (rot.rescale) {
    const f = Math.abs(c) + Math.abs(s)
    if (rot.axis === 'x') { r[1] *= f; r[2] *= f }
    else if (rot.axis === 'y') { r[0] *= f; r[2] *= f }
    else { r[0] *= f; r[1] *= f }
  }
  return [r[0] + rot.origin[0], r[1] + rot.origin[1], r[2] + rot.origin[2]]
}

interface CameraBasis {
  /** 视线方向（相机 → 场景） */
  d: Vec3
  /** 屏幕右 */
  u: Vec3
  /** 屏幕上 */
  v: Vec3
}

const normalize = (v: Vec3): Vec3 => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const CAMERAS: Record<SnapshotViewName, CameraBasis> = (() => {
  const mk = (d: Vec3): CameraBasis => {
    const dn = normalize(d)
    const u = normalize(cross(dn, [0, 1, 0]))
    const v = normalize(cross(u, dn))
    return { d: dn, u, v }
  }
  return {
    /* 正面：从北（-z）看向南 */
    front: mk([0, 0, 1]),
    /* 侧面：从东（+x）看向西 */
    side: mk([-1, 0, 0]),
    /* 等轴：相机在西北上方，朝东南下看（见 north+up+west 三面） */
    iso: mk([1, -1, 1])
  }
})()

/** 面明暗系数（MC 观感：顶亮底暗、南北中、东西次） */
function shadeFactor(normal: Vec3): number {
  const ax = Math.abs(normal[0])
  const ay = Math.abs(normal[1])
  const az = Math.abs(normal[2])
  if (ay >= ax && ay >= az) return normal[1] > 0 ? 1.0 : 0.5
  if (ax >= az) return 0.6
  return 0.8
}

/* ------------------------------------------------------------------ */
/* 光栅化                                                               */
/* ------------------------------------------------------------------ */

interface FlatQuad {
  /** 屏幕坐标（未缩放） */
  sx: number[]
  sy: number[]
  depth: number
  color: [number, number, number]
}

function fillTriangle(
  ras: Raster,
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  color: [number, number, number]
): void {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)))
  const maxX = Math.min(ras.width - 1, Math.ceil(Math.max(x0, x1, x2)))
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)))
  const maxY = Math.min(ras.height - 1, Math.ceil(Math.max(y0, y1, y2)))
  if (minX > maxX || minY > maxY) return
  const edge = (ax: number, ay: number, bx: number, by: number, px: number, py: number): number =>
    (px - ax) * (by - ay) - (py - ay) * (bx - ax)
  const area = edge(x0, y0, x1, y1, x2, y2)
  if (Math.abs(area) < 1e-9) return
  const sign = area > 0 ? 1 : -1
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5
      const py = y + 0.5
      if (sign * edge(x0, y0, x1, y1, px, py) < -1e-6) continue
      if (sign * edge(x1, y1, x2, y2, px, py) < -1e-6) continue
      if (sign * edge(x2, y2, x0, y0, px, py) < -1e-6) continue
      const i = (y * ras.width + x) * 4
      ras.data[i] = Math.round(color[0])
      ras.data[i + 1] = Math.round(color[1])
      ras.data[i + 2] = Math.round(color[2])
      ras.data[i + 3] = 255
    }
  }
}

const CANVAS = 192
const FIT = 160

/* ------------------------------------------------------------------ */
/* 主入口                                                               */
/* ------------------------------------------------------------------ */

/**
 * 渲染模型三视角快照。模型文件不可读 / 无可渲染内容返回 null。
 */
export function renderModelSnapshot(
  readFile: SnapshotReadFile,
  modelAbsPath: string
): ModelSnapshotResult | null {
  const parsed = parseModelJson(readFile, modelAbsPath)
  if (!parsed) return null
  if (parsed.elements.length === 0) return null

  const warnings = [...parsed.warnings]

  /* 加载贴图（缺失记录一次告警） */
  const textures = new Map<string, Raster | null>()
  for (const [name, absPath] of Object.entries(parsed.textureFiles)) {
    const buf = readFile(absPath)
    if (!buf) {
      textures.set(name, null)
      warnings.push(`贴图缺失：${name} → ${absPath}`)
      continue
    }
    try {
      textures.set(name, decodePng(buf))
    } catch {
      textures.set(name, null)
      warnings.push(`贴图解码失败：${name} → ${absPath}`)
    }
  }

  /* 收集所有可见面（世界空间） */
  interface WorldQuad {
    corners: Vec3[]
    normal: Vec3
    color: [number, number, number]
  }
  const worldQuads: WorldQuad[] = []
  for (const el of parsed.elements) {
    for (const face of FACE_NAMES) {
      const f = el.faces[face]
      if (!f) continue
      const tex = textures.get(f.texture)
      let color: [number, number, number] | null
      if (tex === undefined) {
        /* 变量未在 textures 表中定义：MC 会显示 missing texture */
        color = MISSING_COLOR
      } else if (tex === null) {
        color = MISSING_COLOR
      } else {
        color = averageFaceColor(tex, f.uv, parsed.texSize)
      }
      if (color === null) continue // uv 区域全透明，如实剔除
      let corners = faceCorners(el, face)
      let normal = FACE_NORMALS[face]
      if (el.rotation) {
        corners = corners.map((c) => rotateVec(c, el.rotation!))
        normal = rotateVec(normal, { ...el.rotation, origin: [0, 0, 0] })
      }
      if (el.shade) {
        const k = shadeFactor(normal)
        color = [color[0] * k, color[1] * k, color[2] * k]
      }
      worldQuads.push({ corners, normal, color })
    }
  }
  if (worldQuads.length === 0) return null

  /* 逐视角投影 + 画家算法填充 */
  const views: SnapshotView[] = []
  for (const viewName of ['front', 'side', 'iso'] as const) {
    const cam = CAMERAS[viewName]
    const flats: FlatQuad[] = []
    let minSx = Infinity
    let maxSx = -Infinity
    let minSy = Infinity
    let maxSy = -Infinity
    for (const q of worldQuads) {
      /* 背面剔除：法线背向视线 */
      if (dot(q.normal, cam.d) >= -1e-9) continue
      const sx: number[] = []
      const sy: number[] = []
      let depth = 0
      for (const c of q.corners) {
        const px = dot(c, cam.u)
        const py = dot(c, cam.v)
        sx.push(px)
        sy.push(py)
        depth += dot(c, cam.d)
      }
      depth /= q.corners.length
      for (const v of sx) { minSx = Math.min(minSx, v); maxSx = Math.max(maxSx, v) }
      for (const v of sy) { minSy = Math.min(minSy, v); maxSy = Math.max(maxSy, v) }
      flats.push({ sx, sy, depth, color: q.color })
    }
    if (flats.length === 0) {
      warnings.push(`${viewName} 视角无可见面`)
      continue
    }

    const spanX = Math.max(1e-6, maxSx - minSx)
    const spanY = Math.max(1e-6, maxSy - minSy)
    const scale = Math.min(FIT / spanX, FIT / spanY)
    const offX = (CANVAS - spanX * scale) / 2
    const offY = (CANVAS - spanY * scale) / 2
    const toPix = (sx: number, sy: number): [number, number] => [
      (sx - minSx) * scale + offX,
      (maxSy - sy) * scale + offY
    ]

    const raster: Raster = {
      width: CANVAS,
      height: CANVAS,
      data: new Uint8ClampedArray(CANVAS * CANVAS * 4)
    }
    /* 远 → 近 */
    flats.sort((a, b) => b.depth - a.depth)
    for (const q of flats) {
      const [x0, y0] = toPix(q.sx[0], q.sy[0])
      const [x1, y1] = toPix(q.sx[1], q.sy[1])
      const [x2, y2] = toPix(q.sx[2], q.sy[2])
      const [x3, y3] = toPix(q.sx[3], q.sy[3])
      fillTriangle(raster, x0, y0, x1, y1, x2, y2, q.color)
      fillTriangle(raster, x0, y0, x2, y2, x3, y3, q.color)
    }
    const png = encodePng(raster)
    views.push({
      view: viewName,
      raster,
      dataUrl: `data:image/png;base64,${png.toString('base64')}`
    })
  }

  if (views.length === 0) return null
  return { views, warnings }
}
