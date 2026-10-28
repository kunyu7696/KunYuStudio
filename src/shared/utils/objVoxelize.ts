/**
 * OBJ → 体素 → 嵌入式 Cube 模型（建模工坊 B2，借鉴 automods/newstarbar 的 image-to-3D 思路）。
 *
 * 管线（全部纯函数，主进程/渲染进程/单测同源）：
 *   1. parseObj/parseMtl：解析顶点、三角面（n 边形扇面三角化）与 usemtl/Kd 颜色；
 *   2. voxelize：网格归一化到 0..16 MC 空间（保持比例、XZ 居中、Y 落地），
 *      逐体素中心做射线奇偶判定（inside），六向最近表面取材质色；
 *   3. mergeBoxes：同色体素按「X 行 → Z 排 → Y 竖直延伸」合并为 AABB，
 *      仅保留暴露面，UV 指向 1×1 调色板像素（同色面共享，避免十字展开撑爆贴图）。
 */
import type { CubeElement, CubeFaceName, EmbeddedCubeModel, FaceUv } from '../types/content'

export type Vec3 = [number, number, number]

export interface ObjTriangle {
  a: number
  b: number
  c: number
  material?: string
}

export interface ObjMesh {
  vertices: Vec3[]
  triangles: ObjTriangle[]
  /** 材质名 → #rrggbb（来自 .mtl 的 Kd） */
  materials: Record<string, string>
}

export interface VoxelizeOptions {
  /** 最长轴体素分辨率（8..32，默认 16） */
  resolution?: number
  /** 调色板贴图画布（默认 32，可容纳 1024 色） */
  textureSize?: 16 | 32
  /** 无材质/未命中材质时的兜底色 */
  defaultColor?: string
}

export interface VoxelModelResult {
  model: EmbeddedCubeModel
  stats: { voxels: number; boxes: number; colors: number; grid: [number, number, number] }
  warnings: string[]
}

/* ------------------------------------------------------------------ */
/* OBJ / MTL 解析                                                      */
/* ------------------------------------------------------------------ */

/** 解析 .mtl 文本：newmtl 段内取 Kd 为 #rrggbb（sRGB 0..1） */
export function parseMtl(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  let current = ''
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const tag = parts[0]
    if (tag === 'newmtl') {
      current = parts.slice(1).join(' ').trim()
    } else if (tag === 'Kd' && current) {
      const rgb = parts.slice(1, 4).map(Number)
      if (rgb.length === 3 && rgb.every((n) => Number.isFinite(n))) {
        const hex = rgb
          .map((n) => Math.max(0, Math.min(1, n)))
          .map((n) => Math.round(n * 255).toString(16).padStart(2, '0'))
          .join('')
        out[current] = `#${hex}`
      }
    }
  }
  return out
}

/**
 * 解析 OBJ。支持：v 顶点、f 面（v / vt / vn 任意组合，负索引相对当前顶点数）、
 * usemtl、mtllib（仅记录，材质内容由调用方一并传入，通常已读到 mtlText）。
 * n 边形按扇形三角化。
 */
export function parseObj(objText: string, mtlText?: string): ObjMesh {
  const vertices: Vec3[] = []
  const triangles: ObjTriangle[] = []
  const materials = mtlText ? parseMtl(mtlText) : {}
  let currentMaterial: string | undefined

  const resolveIndex = (token: string): number => {
    const n = parseInt(token.split('/')[0] ?? '0', 10)
    return n < 0 ? vertices.length + n : n - 1
  }

  for (const rawLine of objText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const tag = parts[0]
    if (tag === 'v') {
      const nums = parts.slice(1, 4).map(Number)
      if (nums.length === 3 && nums.every(Number.isFinite)) vertices.push(nums as Vec3)
    } else if (tag === 'usemtl') {
      currentMaterial = parts.slice(1).join(' ').trim() || undefined
    } else if (tag === 'f' && parts.length >= 4) {
      const idx = parts.slice(1).map(resolveIndex)
      for (let i = 1; i < idx.length - 1; i++) {
        const tri: ObjTriangle = { a: idx[0]!, b: idx[i]!, c: idx[i + 1]! }
        if (currentMaterial) tri.material = currentMaterial
        triangles.push(tri)
      }
    }
  }
  return { vertices, triangles, materials }
}

/* ------------------------------------------------------------------ */
/* 几何工具                                                            */
/* ------------------------------------------------------------------ */

interface BBox {
  min: Vec3
  max: Vec3
  extent: Vec3
}

function bboxOf(mesh: ObjMesh): BBox {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const v of mesh.vertices) {
    for (let i = 0; i < 3; i++) {
      if (v[i] < min[i]) min[i] = v[i]
      if (v[i] > max[i]) max[i] = v[i]
    }
  }
  return { min, max, extent: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }
}

/** Möller–Trumbore；命中且 t≥0 返回距离，否则 null */
function rayTri(
  origin: Vec3,
  dir: Vec3,
  p0: Vec3,
  p1: Vec3,
  p2: Vec3
): number | null {
  const EPS = 1e-9
  const e1: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
  const e2: Vec3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]
  const h: Vec3 = [
    dir[1] * e2[2] - dir[2] * e2[1],
    dir[2] * e2[0] - dir[0] * e2[2],
    dir[0] * e2[1] - dir[1] * e2[0]
  ]
  const a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]
  if (Math.abs(a) < EPS) return null
  const f = 1 / a
  const s: Vec3 = [origin[0] - p0[0], origin[1] - p0[1], origin[2] - p0[2]]
  const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2])
  if (u < -EPS || u > 1 + EPS) return null
  const q: Vec3 = [
    s[1] * e1[2] - s[2] * e1[1],
    s[2] * e1[0] - s[0] * e1[2],
    s[0] * e1[1] - s[1] * e1[0]
  ]
  const v = f * (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2])
  if (v < -EPS || u + v > 1 + EPS) return null
  const t = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2])
  return t >= EPS ? t : null
}

/* ------------------------------------------------------------------ */
/* 体素化                                                              */
/* ------------------------------------------------------------------ */

const FACES: CubeFaceName[] = ['north', 'east', 'south', 'west', 'up', 'down']

/** 六向射线（inside 判定只取 +X；上色取六向最近表面，保证侧面也有颜色） */
const RAY_DIRS: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
]

interface OccupiedCell {
  ix: number
  iy: number
  iz: number
  color: string
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * 体素化主入口。空网格/异常输入抛错（调用方按软失败展示）。
 */
export function voxelizeObj(mesh: ObjMesh, options: VoxelizeOptions = {}): VoxelModelResult {
  const warnings: string[] = []
  if (mesh.vertices.length < 3 || mesh.triangles.length === 0) {
    throw new Error('OBJ 没有可用的三角面（至少需要 3 个顶点与 1 个面）')
  }
  const resolution = Math.max(8, Math.min(32, Math.floor(options.resolution ?? 16)))
  const textureSize = options.textureSize ?? 32
  const defaultColor = options.defaultColor ?? '#8b8b8b'

  const bb = bboxOf(mesh)
  if (!bb.extent.every(Number.isFinite) || bb.extent.some((e) => e <= 0)) {
    throw new Error('OBJ 包围盒异常（共面/重合顶点），无法体素化')
  }

  // 1) 等比缩放到最长轴占 16 MC 单位
  const maxExtent = Math.max(bb.extent[0], bb.extent[1], bb.extent[2])
  const scale = 16 / maxExtent
  const scaled: Vec3 = [bb.extent[0] * scale, bb.extent[1] * scale, bb.extent[2] * scale]
  // 每轴网格数（最长轴 = resolution）
  const gx = Math.max(1, Math.round((scaled[0] / 16) * resolution))
  const gy = Math.max(1, Math.round((scaled[1] / 16) * resolution))
  const gz = Math.max(1, Math.round((scaled[2] / 16) * resolution))
  const cell: Vec3 = [scaled[0] / gx, scaled[1] / gy, scaled[2] / gz]
  // XZ 居中，Y 落地
  const origin: Vec3 = [(16 - scaled[0]) / 2, 0, (16 - scaled[2]) / 2]

  // OBJ 坐标 → MC 坐标
  const toMc = (v: Vec3): Vec3 => [
    origin[0] + (v[0] - bb.min[0]) * scale,
    origin[1] + (v[1] - bb.min[1]) * scale,
    origin[2] + (v[2] - bb.min[2]) * scale
  ]
  const mcVerts = mesh.vertices.map(toMc)

  // 体素中心（MC 坐标）→ OBJ 网格坐标无需反推：inside 直接在 MC 空间打三角形（仿射变换保持内外关系）
  const occupied: OccupiedCell[] = []
  const grid = new Uint8Array(gx * gy * gz)
  const idx = (x: number, y: number, z: number): number => x + gx * (y + gy * z)
  const inGrid = (x: number, y: number, z: number): boolean =>
    x >= 0 && y >= 0 && z >= 0 && x < gx && y < gy && z < gz

  const triCache = mesh.triangles.map((t) => {
    const p0 = mcVerts[t.a]!
    const p1 = mcVerts[t.b]!
    const p2 = mcVerts[t.c]!
    const color = (t.material && mesh.materials[t.material]) || defaultColor
    return { p0, p1, p2, color }
  })

  for (let iz = 0; iz < gz; iz++) {
    for (let iy = 0; iy < gy; iy++) {
      for (let ix = 0; ix < gx; ix++) {
        const center: Vec3 = [
          origin[0] + (ix + 0.5) * cell[0],
          origin[1] + (iy + 0.5) * cell[1],
          origin[2] + (iz + 0.5) * cell[2]
        ]
        // inside：+X 方向奇数穿面；扇形共享边/顶点会让同一交点被两个三角形重复计入，按 t 去重
        const hits: number[] = []
        for (const tri of triCache) {
          const t = rayTri(center, RAY_DIRS[0]!, tri.p0, tri.p1, tri.p2)
          if (t !== null) hits.push(t)
        }
        hits.sort((a, b) => a - b)
        let crossings = 0
        let lastT = -1
        for (const t of hits) {
          if (t - lastT > 1e-6) crossings++
          lastT = t
        }
        if (crossings % 2 !== 1) continue
        grid[idx(ix, iy, iz)] = 1

        // 上色：六向最近表面的三角形材质色
        let bestColor = defaultColor
        let bestT = Infinity
        for (const tri of triCache) {
          for (const dir of RAY_DIRS) {
            const t = rayTri(center, dir, tri.p0, tri.p1, tri.p2)
            if (t !== null && t < bestT) {
              bestT = t
              bestColor = tri.color
            }
          }
        }
        occupied.push({ ix, iy, iz, color: bestColor })
      }
    }
  }

  if (occupied.length === 0) throw new Error('体素化结果为空：网格可能不封闭（请在 OBJ 中补全所有面）')

  // 2) 合并盒子：逐 (z,y) 层扫 X 连续同色段，再沿 Y 合并完全重合的段
  const boxes = mergeBoxes(occupied, gx, gy, gz)
  if (boxes.length > 300) {
    warnings.push(`生成了 ${boxes.length} 个立方体，模型可能偏重；可调小分辨率（当前 ${resolution}）`)
  }

  // 3) 调色板：同色 → 1×1 贴图单元
  const palette = new Map<string, number>()
  for (const b of boxes) {
    if (!palette.has(b.color)) palette.set(b.color, palette.size)
  }
  if (palette.size > textureSize * textureSize) {
    throw new Error(`颜色数 ${palette.size} 超过 ${textureSize}×${textureSize} 调色板上限，请换用 32 画布或减少材质`)
  }
  const pixels: string[] = Array.from({ length: textureSize * textureSize }, () => '')
  for (const [color, i] of palette) {
    pixels[i] = color
  }

  // 4) 输出 CubeElement（只留暴露面，UV 指向调色板格）
  const elements: CubeElement[] = boxes.map((b, i) => {
    const from: Vec3 = [
      round2(origin[0] + b.ix0 * cell[0]),
      round2(origin[1] + b.iy0 * cell[1]),
      round2(origin[2] + b.iz0 * cell[2])
    ]
    const to: Vec3 = [
      round2(origin[0] + (b.ix1 + 1) * cell[0]),
      round2(origin[1] + (b.iy1 + 1) * cell[1]),
      round2(origin[2] + (b.iz1 + 1) * cell[2])
    ]
    const cellIndex = palette.get(b.color)!
    const u0 = cellIndex % textureSize
    const v0 = Math.floor(cellIndex / textureSize)
    const uv: FaceUv = [u0, v0, u0 + 1, v0 + 1]
    const faces = {} as Partial<Record<CubeFaceName, NonNullable<CubeElement['faces'][CubeFaceName]>>>
    const exposed = (face: CubeFaceName): boolean => {
      for (let iy = b.iy0; iy <= b.iy1; iy++) {
        for (let iz = b.iz0; iz <= b.iz1; iz++) {
          for (let ix = b.ix0; ix <= b.ix1; ix++) {
            const [nx, ny, nz] = neighborOf(face, ix, iy, iz)
            if (!inGrid(nx, ny, nz) || grid[idx(nx, ny, nz)] === 0) return true
          }
        }
      }
      return false
    }
    for (const face of FACES) {
      if (exposed(face)) faces[face] = { uv, texture: 'all' }
    }
    return { name: `voxel_${i + 1}`, from, to, shade: true, faces }
  })

  return {
    model: { textureSize, pixels, elements },
    stats: { voxels: occupied.length, boxes: boxes.length, colors: palette.size, grid: [gx, gy, gz] },
    warnings
  }
}

function neighborOf(face: CubeFaceName, x: number, y: number, z: number): Vec3 {
  switch (face) {
    case 'north':
      return [x, y, z - 1]
    case 'south':
      return [x, y, z + 1]
    case 'west':
      return [x - 1, y, z]
    case 'east':
      return [x + 1, y, z]
    case 'down':
      return [x, y - 1, z]
    case 'up':
      return [x, y + 1, z]
  }
}

interface VoxelBox {
  ix0: number
  ix1: number
  iy0: number
  iy1: number
  iz0: number
  iz1: number
  color: string
}

/** X 连续同色段 */
interface Run {
  ix0: number
  ix1: number
  color: string
}

/**
 * 合并：
 * - 每个 (z, y) 层把占据格按 X 扫成同色连续段；
 * - 段键 = `${z}:${ix0}:${ix1}:${color}`，跨连续 Y 层存在即向上长高；
 *   中间断一层则收口成盒（体素模型内部一般连续，断口多为镂空）。
 */
function mergeBoxes(
  occupied: OccupiedCell[],
  gx: number,
  gy: number,
  gz: number
): VoxelBox[] {
  const cellColor = new Map<number, string>()
  for (const c of occupied) cellColor.set(c.ix + gx * (c.iy + gy * c.iz), c.color)

  // key → 当前正在向上生长的盒子
  const growing = new Map<string, VoxelBox>()
  const done: VoxelBox[] = []

  for (let iy = 0; iy < gy; iy++) {
    const layerKeys = new Set<string>()
    for (let iz = 0; iz < gz; iz++) {
      const runs: Run[] = []
      let runStart = -1
      let runColor = ''
      for (let ix = 0; ix <= gx; ix++) {
        const color = ix < gx ? cellColor.get(ix + gx * (iy + gy * iz)) : undefined
        if (color !== undefined) {
          if (runStart < 0) {
            runStart = ix
            runColor = color
          } else if (color !== runColor) {
            runs.push({ ix0: runStart, ix1: ix - 1, color: runColor })
            runStart = ix
            runColor = color
          }
        } else if (runStart >= 0) {
          runs.push({ ix0: runStart, ix1: ix - 1, color: runColor })
          runStart = -1
        }
      }
      for (const r of runs) {
        const key = `${iz}:${r.ix0}:${r.ix1}:${r.color}`
        layerKeys.add(key)
        const existing = growing.get(key)
        if (existing && existing.iy1 === iy - 1) {
          existing.iy1 = iy
        } else {
          if (existing) done.push(existing)
          growing.set(key, { ix0: r.ix0, ix1: r.ix1, iy0: iy, iy1: iy, iz0: iz, iz1: iz, color: r.color })
        }
      }
    }
    // 本层缺席的生长盒收口
    for (const [key, box] of growing) {
      if (!layerKeys.has(key)) {
        done.push(box)
        growing.delete(key)
      }
    }
  }
  for (const box of growing.values()) done.push(box)
  return done
}
