/**
 * 程序化像素画生成器（P6 贴图质量专项）。
 *
 * 背景：Agent 让 LLM 手写 256 项 pixels 产出过于简陋（细斜线剑）。
 * 这里把「形状模板 + 4 色配色」光栅化为 16x16 像素画：
 * - 11 种形状模板（剑/镐/斧/锹/锄/宝石/锭/食物/宝珠/法杖/通用）
 * - 从主色/点缀色/副色派生 轮廓/暗/中/亮/高光/点缀 三阶明暗
 * - 8 邻域自动描边，边缘干净
 * - 返回 ASCII 预览供模型自检（不满意换形状/配色重画）
 *
 * 纯函数无 IO；texture_paint 工具（toolRegistry）负责读写语义资产。
 */

export type PaintShape =
  | 'sword'
  | 'pickaxe'
  | 'axe'
  | 'shovel'
  | 'hoe'
  | 'gem'
  | 'ingot'
  | 'food'
  | 'orb'
  | 'rod'
  | 'blob'

export const PAINT_SHAPES: PaintShape[] = [
  'sword',
  'pickaxe',
  'axe',
  'shovel',
  'hoe',
  'gem',
  'ingot',
  'food',
  'orb',
  'rod',
  'blob'
]

export const PAINT_SHAPE_LABELS: Record<PaintShape, string> = {
  sword: '剑（对角刃+护手+缠柄）',
  pickaxe: '镐（弧形镐头）',
  axe: '斧（侧刃）',
  shovel: '锹（圆头铲）',
  hoe: '锄（顶弯钩）',
  gem: '宝石（菱形刻面）',
  ingot: '金属锭（立体条）',
  food: '食物（圆果+叶）',
  orb: '宝珠（球体高光）',
  rod: '法杖（细杆+顶珠）',
  blob: '通用物品（圆块+饰带）'
}

export interface PaintSpec {
  shape: PaintShape
  /** 主色 #rrggbb（刃/主体） */
  primary: string
  /** 点缀色 #rrggbb（宝石/护手/饰带，可省略默认琥珀） */
  accent?: string
  /** 副色 #rrggbb（握柄/杆，可省略默认深木色） */
  secondary?: string
}

export interface PaintResult {
  /** 256 项，"#rrggbb" 或 ""（透明） */
  pixels: string[]
  /** 16 行 ASCII 预览（o/d/m/l/h/a/A/g/G/.） */
  ascii: string
  painted: number
  tones: PaintTones
}

interface PaintTones {
  o: string
  d: string
  m: string
  l: string
  h: string
  a: string
  A: string
  g: string
  G: string
}

const SIZE = 16

// ---------------------------------------------------------------------------
// 颜色工具
// ---------------------------------------------------------------------------

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function isHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v)
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const to2 = (v: number): string => clamp(v).toString(16).padStart(2, '0')
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

/** pct<0 变暗（shade），pct>0 提亮（tint） */
function shift(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex)
  if (pct < 0) {
    const k = 1 + pct
    return rgbToHex(r * k, g * k, b * k)
  }
  const k = pct
  return rgbToHex(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k)
}

function normalizeColor(v: unknown, fallback: string): string {
  return typeof v === 'string' && isHex(v) ? v.toLowerCase() : fallback
}

function deriveTones(spec: PaintSpec): PaintTones {
  const primary = normalizeColor(spec.primary, '#8b8b8b')
  const accent = normalizeColor(spec.accent, '#d4a017')
  const secondary = normalizeColor(spec.secondary, '#5c4033')
  return {
    // 轮廓：主色大幅压暗（保持色相的深色描边，比纯黑更协调）
    o: shift(primary, -0.72),
    d: shift(primary, -0.28),
    m: primary,
    l: shift(primary, 0.22),
    h: shift(primary, 0.45),
    a: shift(accent, -0.3),
    A: accent,
    g: shift(secondary, -0.18),
    G: shift(secondary, 0.18)
  }
}

// ---------------------------------------------------------------------------
// 画布原语
// ---------------------------------------------------------------------------

type Grid = string[][]

function newGrid(): Grid {
  return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => '.'))
}

function set(grid: Grid, x: number, y: number, c: string): void {
  if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) grid[y][x] = c
}

function get(grid: Grid, x: number, y: number): string {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return '.'
  return grid[y][x]
}

function fillRect(grid: Grid, x0: number, y0: number, x1: number, y1: number, c: string): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) set(grid, x, y, c)
  }
}

/** 反对角线柄（左下 → 右上）：y 从 yBottom 到 yTop，x = 15 - y */
function diagHandle(grid: Grid, yTop: number, yBottom: number, dark: string, light: string): void {
  for (let y = yTop; y <= yBottom; y++) {
    set(grid, 15 - y, y, (y - yTop) % 2 === 0 ? light : dark)
  }
}

/** 8 邻域自动描边：空格相邻非空 → 轮廓色 */
function autoOutline(grid: Grid): void {
  const marks: [number, number][] = []
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (get(grid, x, y) !== '.') continue
      let touch = false
      for (let dy = -1; dy <= 1 && !touch; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (get(grid, x + dx, y + dy) !== '.') {
            touch = true
            break
          }
        }
      }
      if (touch) marks.push([x, y])
    }
  }
  for (const [x, y] of marks) set(grid, x, y, 'o')
}

// ---------------------------------------------------------------------------
// 形状模板（o 轮廓 d 暗色 m 中 l 亮 h 高光 / a 点缀暗 A 点缀 / g 副色暗 G 副色亮）
// ---------------------------------------------------------------------------

function drawSword(grid: Grid): void {
  // 对角刃：y=1..10 核心线 x=14-y，三阶明暗（上缘亮/核心中/下缘暗）
  for (let y = 1; y <= 10; y++) {
    const core = 14 - y
    set(grid, core + 1, y, 'd')
    set(grid, core, y, 'm')
    set(grid, core - 1, y, 'l')
  }
  set(grid, 15, 0, 'm') // 剑尖
  set(grid, 14, 0, 'l')
  // 护手（十字短档，点缀色）
  for (let x = 3; x <= 8; x++) set(grid, x, 11, x === 5 || x === 6 ? 'A' : 'a')
  set(grid, 2, 12, 'a')
  set(grid, 9, 10, 'a')
  // 缠柄 + 配重球（副色 + 点缀）
  set(grid, 4, 12, 'G')
  set(grid, 3, 13, 'g')
  set(grid, 2, 14, 'G')
  set(grid, 1, 15, 'a')
  set(grid, 0, 14, 'A')
}

function drawPickaxe(grid: Grid): void {
  diagHandle(grid, 4, 13, 'g', 'G')
  // 弧形镐头：顶横梁 + 两端下弯
  fillRect(grid, 4, 2, 13, 2, 'm')
  fillRect(grid, 6, 1, 11, 1, 'l')
  set(grid, 3, 3, 'm')
  set(grid, 14, 3, 'm')
  set(grid, 2, 4, 'd')
  set(grid, 15, 4, 'd')
  set(grid, 5, 3, 'd')
  set(grid, 12, 3, 'd')
  set(grid, 8, 0, 'h')
  set(grid, 9, 0, 'h')
}

function drawAxe(grid: Grid): void {
  diagHandle(grid, 4, 14, 'g', 'G')
  // 侧刃块（右上）：主体 + 亮刃口 + 暗背
  fillRect(grid, 8, 1, 13, 5, 'm')
  fillRect(grid, 9, 2, 12, 4, 'm')
  fillRect(grid, 13, 2, 14, 4, 'l')
  fillRect(grid, 8, 1, 8, 5, 'd')
  set(grid, 10, 1, 'h')
  set(grid, 11, 1, 'h')
}

function drawShovel(grid: Grid): void {
  diagHandle(grid, 6, 14, 'g', 'G')
  // 圆头铲（右上）：头 + 亮顶 + 暗侧
  fillRect(grid, 9, 1, 14, 5, 'm')
  fillRect(grid, 10, 1, 13, 1, 'l')
  fillRect(grid, 9, 5, 14, 5, 'd')
  set(grid, 10, 2, 'h')
  set(grid, 11, 2, 'h')
  set(grid, 15, 0, 'l')
}

function drawHoe(grid: Grid): void {
  diagHandle(grid, 4, 14, 'g', 'G')
  // 顶弯钩：横梁 + 下垂刃口
  fillRect(grid, 8, 2, 14, 3, 'm')
  fillRect(grid, 8, 2, 14, 2, 'l')
  fillRect(grid, 14, 4, 15, 5, 'm')
  set(grid, 15, 6, 'd')
  set(grid, 9, 3, 'd')
}

function drawGem(grid: Grid): void {
  // 菱形刻面宝石：外圈中调、内圈亮、左上高光、下缘暗
  const cx = 7.5
  const cy = 7.5
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dist = Math.abs(x - cx) + Math.abs(y - cy)
      if (dist <= 5.5) set(grid, x, y, 'm')
      if (dist <= 3.5) set(grid, x, y, 'l')
    }
  }
  set(grid, 6, 5, 'h')
  set(grid, 7, 5, 'h')
  set(grid, 6, 6, 'h')
  set(grid, 8, 10, 'd')
  set(grid, 9, 9, 'd')
  set(grid, 7, 11, 'd')
  // 中心点缀
  set(grid, 7, 7, 'A')
  set(grid, 8, 7, 'a')
}

function drawIngot(grid: Grid): void {
  // 立体金属锭：顶面亮/前脸中/右侧暗
  fillRect(grid, 4, 6, 12, 7, 'l')
  fillRect(grid, 5, 5, 11, 5, 'l')
  fillRect(grid, 2, 8, 12, 11, 'm')
  fillRect(grid, 13, 7, 14, 10, 'd')
  fillRect(grid, 3, 12, 12, 12, 'd')
  set(grid, 6, 6, 'h')
  set(grid, 7, 6, 'h')
  set(grid, 5, 9, 'A')
  set(grid, 6, 9, 'A')
  set(grid, 5, 10, 'a')
  set(grid, 6, 10, 'a')
}

function drawFood(grid: Grid): void {
  // 圆果：中调主体 + 左上亮 + 右下暗 + 茎叶点缀
  const cx = 8
  const cy = 9
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
      if (dist <= 4.6) set(grid, x, y, 'm')
      if (dist <= 3.2 && x <= cx && y <= cy) set(grid, x, y, 'l')
      if (dist <= 4.6 && x + y >= 18) set(grid, x, y, 'd')
    }
  }
  set(grid, 6, 6, 'h')
  set(grid, 7, 6, 'h')
  set(grid, 8, 3, 'g')
  set(grid, 8, 4, 'g')
  set(grid, 9, 3, 'A')
  set(grid, 10, 3, 'A')
  set(grid, 10, 2, 'a')
}

function drawOrb(grid: Grid): void {
  const cx = 7.5
  const cy = 7.5
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
      if (dist <= 5.4) set(grid, x, y, 'm')
      if (dist <= 4.2 && x <= cx && y <= cy) set(grid, x, y, 'l')
      if (dist <= 5.4 && x + y >= 17) set(grid, x, y, 'd')
    }
  }
  set(grid, 5, 5, 'h')
  set(grid, 6, 5, 'h')
  set(grid, 5, 6, 'h')
  set(grid, 6, 6, 'A')
  set(grid, 9, 6, 'a')
}

function drawRod(grid: Grid): void {
  // 细杆 + 顶端宝珠
  diagHandle(grid, 4, 13, 'g', 'G')
  fillRect(grid, 11, 1, 13, 3, 'm')
  set(grid, 12, 1, 'h')
  set(grid, 12, 2, 'A')
  set(grid, 14, 1, 'l')
  set(grid, 10, 2, 'd')
}

function drawBlob(grid: Grid): void {
  // 通用圆块 + 横向饰带
  const cx = 7.5
  const cy = 7.5
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
      if (dist <= 5.6) set(grid, x, y, 'm')
      if (dist <= 4.5 && y <= cy) set(grid, x, y, 'l')
    }
  }
  fillRect(grid, 4, 8, 11, 9, 'A')
  set(grid, 4, 8, 'a')
  set(grid, 11, 9, 'a')
  set(grid, 5, 4, 'h')
  set(grid, 6, 4, 'h')
  fillRect(grid, 5, 12, 10, 12, 'd')
}

const DRAWERS: Record<PaintShape, (grid: Grid) => void> = {
  sword: drawSword,
  pickaxe: drawPickaxe,
  axe: drawAxe,
  shovel: drawShovel,
  hoe: drawHoe,
  gem: drawGem,
  ingot: drawIngot,
  food: drawFood,
  orb: drawOrb,
  rod: drawRod,
  blob: drawBlob
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/** 把形状模板 + 配色光栅化为 16x16 像素画（含自动描边与 ASCII 预览） */
export function paintPixels(spec: PaintSpec): PaintResult {
  const tones = deriveTones(spec)
  const grid = newGrid()
  DRAWERS[spec.shape](grid)
  autoOutline(grid)

  const pixels: string[] = []
  const rows: string[] = []
  let painted = 0
  for (let y = 0; y < SIZE; y++) {
    let row = ''
    for (let x = 0; x < SIZE; x++) {
      const c = grid[y][x]
      row += c
      if (c === '.') {
        pixels.push('')
      } else {
        pixels.push(tones[c as keyof PaintTones])
        painted++
      }
    }
    rows.push(row)
  }
  return { pixels, ascii: rows.join('\n'), painted, tones }
}

/** 形状参数非法时返回中文错误信息（null 表示合法） */
export function validatePaintShape(v: unknown): PaintShape | null {
  return typeof v === 'string' && (PAINT_SHAPES as string[]).includes(v) ? (v as PaintShape) : null
}
