/**
 * 程序化贴图合成器：用语义信息（颜色 + 物品/工具/盔甲/方块种类）
 * 在 16×16 画布上生成带明暗层次的像素画，替代原来的纯色占位 PNG。
 *
 * 输出统一为 256 项 hex 数组（'' = 透明），可直接喂给 modelCompiler.pixelsToPng。
 * 纯函数、无第三方依赖；工具/宝石形状以字符掩码维护，盔甲按跨度程序化绘制。
 */

export type ItemSpriteKind =
  | { type: 'simple'; id: string }
  | { type: 'tool'; toolKind: 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' }
  | { type: 'armor'; slot: 'helmet' | 'chestplate' | 'leggings' | 'boots' }
  | { type: 'food' }
  | { type: 'block_item' }

export type BlockSpritePattern = 'generic' | 'gem' | 'bricks' | 'lamp' | 'ore'

const SIZE = 16

/* ------------------------------------------------------------------ */
/* 颜色工具                                                            */
/* ------------------------------------------------------------------ */

interface Rgb {
  r: number
  g: number
  b: number
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  const n = m ? parseInt(m[1], 16) : 0xcbb37a
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function toHex(c: Rgb): string {
  return (
    '#' +
    [c.r, c.g, c.b].map((v) => clampByte(v).toString(16).padStart(2, '0')).join('')
  )
}

/** 线性明暗：f<1 变暗，f>1 提亮（超 255 截断） */
function shade(hex: string, f: number): string {
  const c = hexToRgb(hex)
  return toHex({ r: c.r * f, g: c.g * f, b: c.b * f })
}

/** 固定木柄配色（与 MC 木棍色调接近） */
const WOOD = { light: '#a07744', dark: '#6e4c28' }

/* ------------------------------------------------------------------ */
/* 画布原语                                                            */
/* ------------------------------------------------------------------ */

type Grid = string[]

function emptyGrid(): Grid {
  return Array<string>(SIZE * SIZE).fill('')
}

function idx(x: number, y: number): number {
  return y * SIZE + x
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < SIZE && y < SIZE
}

function paint(grid: Grid, x: number, y: number, color: string): void {
  if (inBounds(x, y)) grid[idx(x, y)] = color
}

/**
 * 把字符掩码画到画布。
 * 约定：'.' 透明；其余字符经 palette 映射为颜色。
 * 每个字符串必须恰为 16 字符（由本文件常量自检保证）。
 */
function stamp(grid: Grid, rows: readonly string[], palette: Record<string, string>): void {
  for (let y = 0; y < rows.length && y < SIZE; y++) {
    const row = rows[y]
    for (let x = 0; x < row.length && x < SIZE; x++) {
      const ch = row[x]
      if (ch === '.') continue
      const color = palette[ch]
      if (color) paint(grid, x, y, color)
    }
  }
}

/** 实心圆盘（用于矿斑等） */
function disc(grid: Grid, cx: number, cy: number, radius: number, color: string): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy) * (y - cy)
      if (d2 <= radius * radius + 1) paint(grid, x, y, color)
    }
  }
}

/**
 * 按跨度填充盔甲类轮廓：左/右边缘描边，内侧左亮右暗，中间主色。
 * highlights 为额外高光像素。
 */
function paintSpans(
  grid: Grid,
  spans: ReadonlyArray<readonly [number, number, number]>,
  pal: Record<string, string>,
  highlights: ReadonlyArray<readonly [number, number]> = []
): void {
  for (const [y, x0, x1] of spans) {
    for (let x = x0; x <= x1; x++) {
      let c = pal.m
      if (x === x0 || x === x1) c = pal.o
      else if (x === x0 + 1) c = pal.l
      else if (x === x1 - 1) c = pal.d
      paint(grid, x, y, c)
    }
  }
  for (const [x, y] of highlights) paint(grid, x, y, pal.h)
}

/* ------------------------------------------------------------------ */
/* 物品形状掩码（每行严格 16 字符）                                     */
/* 字符：o 描边 d 暗部 m 主色 l 亮部 h 高光 W 木柄亮 w 木柄暗           */
/* 宝石/锭为跨度程序化绘制（paintGem / paintIngot）                     */
/* ------------------------------------------------------------------ */

// 剑：刀尖右上，木柄左下
const SWORD_MASK = [
  '................',
  '.............mh.',
  '............mh..',
  '...........mh...',
  '..........mh....',
  '.........mh.....',
  '.....d.mh.......',
  '......dmh.......',
  '......W..d......',
  '.....W....d.....',
  '....W...........',
  '...Ww...........',
  '..wW............',
  '.w..............',
  '................',
  '................'
] as const

// 镐：加粗倒 V 镐头 + 斜木柄
const PICKAXE_MASK = [
  '................',
  '.......hh.......',
  '......lmml......',
  '.....lm..ml.....',
  '....lm.W..ml....',
  '...lm.W....ml...',
  '..lm.W......ml..',
  '..m.W........m..',
  '.dmW..........md',
  '..w.............',
  '.w..............',
  '................',
  '................',
  '................',
  '................',
  '................'
] as const

// 斧：宽厚斧头 + 斜木柄
const AXE_MASK = [
  '................',
  '............ohh.',
  '..........lmmhh.',
  '.........lmmmlld',
  '........lmmmmdd.',
  '.......lmmmmdd..',
  '......lmmmdd....',
  '.....lmmmdd.....',
  '....Wwmd........',
  '...Ww...........',
  '..Ww............',
  '.Ww.............',
  'W...............',
  '................',
  '................',
  '................'
] as const

// 锹：饱满锹头 + 斜木柄
const SHOVEL_MASK = [
  '................',
  '..........ohhh..',
  '.........olllhd.',
  '.........omllmd.',
  '.........ommmd..',
  '.........ommd...',
  '........ommd....',
  '.......omd......',
  '....Wwmo........',
  '...Ww...........',
  '..Ww............',
  '.Ww.............',
  'W...............',
  '................',
  '................',
  '................'
] as const

// 锄：钩形锄头 + 斜木柄
const HOE_MASK = [
  '................',
  '..........ohhhh.',
  '.........omlllh.',
  '........oml.....',
  '.......oml......',
  '......omd.......',
  '.....omd........',
  '....Wmo.........',
  '...Ww...........',
  '..Ww............',
  '.Ww.............',
  'W...............',
  '................',
  '................',
  '................',
  '................'
] as const

/* ------------------------------------------------------------------ */
/* 合成入口                                                            */
/* ------------------------------------------------------------------ */

function materialPalette(base: string): Record<string, string> {
  return {
    o: shade(base, 0.42),
    d: shade(base, 0.7),
    m: shade(base, 1),
    l: shade(base, 1.28),
    h: shade(base, 1.55),
    W: WOOD.light,
    w: WOOD.dark
  }
}

/** block_item 用：斜面方块图标（l=左上受光，d=右下背光，m=主色，o=描边） */
const CUBE_MASK = [
  '................',
  '................',
  '..oooooooooooo..',
  '..ollllllllllo..',
  '..olmmmmmmmmdo..',
  '..olmmmmmmmmdo..',
  '..olmmmmmmmmdo..',
  '..olmmmmmmmmdo..',
  '..olmmmmmmmmdo..',
  '..olmmmmmmmmdo..',
  '..olmmmmmmmmdo..',
  '..olmmmmmmmmdo..',
  '..oddddddddddo..',
  '..oooooooooooo..',
  '................',
  '................'
] as const

/** 合成物品贴图（256 项；透明为 ''） */
export function synthesizeItemTexture(base: string, kind: ItemSpriteKind): string[] {
  const grid = emptyGrid()
  const pal = materialPalette(base)

  if (kind.type === 'block_item') {
    // 独立方块物品：斜面方块图标（左上受光 / 右下背光 / 描边）
    stamp(grid, CUBE_MASK, { o: pal.o, l: pal.l, d: pal.d, m: pal.m })
    return grid
  }

  if (kind.type === 'tool') {
    const masks = {
      sword: SWORD_MASK,
      pickaxe: PICKAXE_MASK,
      axe: AXE_MASK,
      shovel: SHOVEL_MASK,
      hoe: HOE_MASK
    } as const
    stamp(grid, masks[kind.toolKind], pal)
    return grid
  }

  if (kind.type === 'armor') {
    paintArmor(grid, kind.slot, pal)
    return grid
  }

  if (kind.type === 'food') {
    paintApple(grid, base)
    return grid
  }

  // simple：按 id 猜锭/碎粒，缺省为宝石切面
  if (kind.type === 'simple' && /ingot|nugget/i.test(kind.id)) {
    paintIngot(grid, pal)
    return grid
  }
  paintGem(grid, pal)
  return grid
}

/* ------------------------------------------------------------------ */
/* 宝石 / 锭（多边形跨度绘制）                                          */
/* ------------------------------------------------------------------ */

type Span = readonly [number, number, number]

function shapeAt(spans: readonly Span[], x: number, y: number): boolean {
  for (const [sy, x0, x1] of spans) {
    if (sy === y && x >= x0 && x <= x1) return true
  }
  return false
}

/** 用跨度填充多边形：内部主色，4 邻接有空缺的像素压成描边色 */
function fillPolygon(grid: Grid, spans: readonly Span[], pal: Record<string, string>): void {
  for (const [y, x0, x1] of spans) {
    for (let x = x0; x <= x1; x++) {
      const edge =
        !shapeAt(spans, x - 1, y) ||
        !shapeAt(spans, x + 1, y) ||
        !shapeAt(spans, x, y - 1) ||
        !shapeAt(spans, x, y + 1)
      paint(grid, x, y, edge ? pal.o : pal.m)
    }
  }
}

/** 八边形切面宝石（明亮台面 + 高光 + 亭部暗线） */
function paintGem(grid: Grid, pal: Record<string, string>): void {
  const spans: readonly Span[] = [
    [2, 6, 9],
    [3, 4, 11],
    [4, 3, 12],
    [5, 3, 12],
    [6, 3, 12],
    [7, 3, 12],
    [8, 3, 12],
    [9, 4, 11],
    [10, 5, 10],
    [11, 6, 9]
  ]
  fillPolygon(grid, spans, pal)
  const inside = (x: number, y: number): boolean => shapeAt(spans, x, y) && grid[idx(x, y)] !== pal.o
  // 台面高光带
  for (let x = 5; x <= 10; x++) if (inside(x, 3)) paint(grid, x, 3, pal.l)
  paint(grid, 7, 3, pal.h)
  paint(grid, 8, 3, pal.h)
  // 冠部左上亮面
  for (let y = 4; y <= 6; y++) {
    for (let x = 4; x <= 6; x++) if (inside(x, y)) paint(grid, x, y, pal.l)
  }
  paint(grid, 5, 4, pal.h)
  paint(grid, 6, 4, pal.h)
  paint(grid, 5, 5, pal.h)
  // 亭部右下暗面与 V 形收尖暗线
  for (let y = 7; y <= 10; y++) {
    for (let x = 9; x <= 11; x++) if (inside(x, y)) paint(grid, x, y, pal.d)
  }
  for (const [x, y] of [
    [5, 8],
    [6, 9],
    [7, 10],
    [10, 8],
    [9, 9],
    [8, 10]
  ]) {
    if (inside(x, y)) paint(grid, x, y, pal.d)
  }
}

/** 梯形锭（顶亮底暗、描边收角） */
function paintIngot(grid: Grid, pal: Record<string, string>): void {
  const spans: readonly Span[] = [
    [3, 5, 10],
    [4, 3, 12],
    [5, 2, 13],
    [6, 2, 13],
    [7, 3, 12],
    [8, 4, 11]
  ]
  fillPolygon(grid, spans, pal)
  const inside = (x: number, y: number): boolean => shapeAt(spans, x, y) && grid[idx(x, y)] !== pal.o
  for (let x = 6; x <= 9; x++) if (inside(x, 3)) paint(grid, x, 3, pal.h)
  for (let x = 4; x <= 6; x++) if (inside(x, 4)) paint(grid, x, 4, pal.l)
  for (let y = 5; y <= 6; y++) {
    for (let x = 3; x <= 4; x++) if (inside(x, y)) paint(grid, x, y, pal.l)
  }
  for (let x = 5; x <= 10; x++) if (inside(x, 8)) paint(grid, x, 8, pal.d)
  for (let x = 10; x <= 11; x++) {
    for (let y = 5; y <= 7; y++) if (inside(x, y)) paint(grid, x, y, pal.d)
  }
}

/* ------------------------------------------------------------------ */
/* 盔甲（跨度程序化绘制）                                               */
/* ------------------------------------------------------------------ */

function paintArmor(
  grid: Grid,
  slot: 'helmet' | 'chestplate' | 'leggings' | 'boots',
  pal: Record<string, string>
): void {
  if (slot === 'helmet') {
    paintSpans(
      grid,
      [
        [2, 4, 11],
        [3, 3, 12],
        [4, 3, 12],
        [5, 3, 12],
        [6, 3, 6],
        [6, 9, 12],
        [7, 3, 6],
        [7, 9, 12],
        [8, 3, 5],
        [8, 10, 12],
        [9, 3, 4],
        [9, 11, 12]
      ],
      pal,
      [
        [5, 3],
        [6, 3],
        [5, 4]
      ]
    )
    return
  }

  if (slot === 'chestplate') {
    paintSpans(
      grid,
      [
        [1, 3, 12],
        [2, 3, 6],
        [2, 9, 12],
        [3, 2, 13],
        [4, 1, 14],
        [5, 2, 13],
        [6, 2, 13],
        [7, 2, 13],
        [8, 2, 13],
        [9, 2, 13],
        [10, 2, 13],
        [11, 3, 12],
        [12, 4, 7],
        [12, 9, 12],
        [13, 5, 7],
        [13, 9, 11]
      ],
      pal,
      [
        [4, 4],
        [5, 4],
        [4, 5]
      ]
    )
    return
  }

  if (slot === 'leggings') {
    paintSpans(
      grid,
      [
        [1, 3, 12],
        [2, 3, 12],
        [3, 3, 12],
        [4, 3, 12],
        [5, 3, 12],
        [6, 3, 12],
        [7, 3, 7],
        [7, 9, 12],
        [8, 3, 7],
        [8, 9, 12],
        [9, 3, 7],
        [9, 9, 12],
        [10, 3, 7],
        [10, 9, 12],
        [11, 3, 7],
        [11, 9, 12],
        [12, 3, 7],
        [12, 9, 12],
        [13, 4, 7],
        [13, 9, 11]
      ],
      pal,
      [
        [5, 3],
        [5, 4]
      ]
    )
    // 腰带压一条暗色
    for (let x = 4; x <= 11; x++) paint(grid, x, 2, pal.d)
    return
  }

  // boots：侧视单靴
  paintSpans(
    grid,
    [
      [3, 11, 13],
      [4, 10, 13],
      [5, 2, 3],
      [5, 10, 13],
      [6, 2, 3],
      [6, 10, 13],
      [7, 2, 12],
      [8, 2, 12],
      [9, 2, 12],
      [10, 1, 13]
    ],
    pal,
    [
      [3, 7],
      [3, 8]
    ]
  )
}

/* ------------------------------------------------------------------ */
/* 食物（苹果形）                                                       */
/* ------------------------------------------------------------------ */

/** 苹果形食物：茎 + 叶 + 带高光的圆果体 */
function paintApple(grid: Grid, base: string): void {
  const o = shade(base, 0.42)
  const d = shade(base, 0.72)
  const m = shade(base, 1)
  const l = shade(base, 1.3)
  const h = shade(base, 1.6)
  const rows: Array<[number, number, number]> = [
    [3, 6, 10],
    [4, 4, 12],
    [5, 3, 13],
    [6, 3, 13],
    [7, 3, 13],
    [8, 3, 13],
    [9, 3, 13],
    [10, 3, 13],
    [11, 4, 12],
    [12, 6, 10]
  ]
  for (const [y, x0, x1] of rows) {
    for (let x = x0; x <= x1; x++) {
      let c = m
      if (x === x0 || x === x1 || y === 3 || y === 12) c = d
      if ((x === x0 + 1 && y <= 7) || (x === 6 && y === 4)) c = l
      if ((x === 5 && y === 5) || (x === 6 && y === 6) || (x === 5 && y === 6)) c = h
      paint(grid, x, y, c)
    }
  }
  const outlinePts: Array<[number, number]> = [
    [5, 2],
    [11, 2],
    [2, 5],
    [14, 5],
    [2, 11],
    [14, 11],
    [5, 13],
    [11, 13]
  ]
  for (const [x, y] of outlinePts) paint(grid, x, y, o)
  // 茎与叶
  paint(grid, 8, 1, '#6e4c28')
  paint(grid, 8, 2, '#6e4c28')
  paint(grid, 9, 2, '#5d9c3f')
  paint(grid, 10, 2, '#6fb84c')
  paint(grid, 10, 3, '#5d9c3f')
}

/* ------------------------------------------------------------------ */
/* 方块贴图                                                            */
/* ------------------------------------------------------------------ */

/** 按方块 id 猜贴图花纹 */
export function resolveBlockPattern(id: string): BlockSpritePattern {
  const s = id.toLowerCase()
  if (/ore/.test(s)) return 'ore'
  if (/brick/.test(s)) return 'bricks'
  if (/lamp|glow|light|lantern/.test(s)) return 'lamp'
  if (/ruby|gem|crystal|diamond|emerald|sapphire|topaz|amethyst|jade|opal/.test(s)) {
    return 'gem'
  }
  return 'generic'
}

/** 确定性伪随机（0-1），让噪点纹理稳定可复现 */
function hash2(x: number, y: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return v - Math.floor(v)
}

/** 合成方块贴图（满幅不透明，256 项） */
export function synthesizeBlockTexture(base: string, pattern: BlockSpritePattern): string[] {
  const grid = emptyGrid()
  const o = shade(base, 0.45)
  const d = shade(base, 0.72)
  const m = shade(base, 1)
  const l = shade(base, 1.25)
  const h = shade(base, 1.5)

  if (pattern === 'ore') {
    paintStone(grid)
    const spots: Array<[number, number]> = [
      [4, 4],
      [11, 5],
      [7, 9],
      [12, 12],
      [3, 12]
    ]
    for (const [cx, cy] of spots) {
      disc(grid, cx, cy, 2, o)
      disc(grid, cx, cy, 1, m)
      paint(grid, cx, cy - 1, h)
      paint(grid, cx - 1, cy, l)
    }
    return grid
  }

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let c = m
      const edge = x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1
      const n = hash2(x, y)
      if (pattern === 'bricks') {
        const mortarRow = y % 4 === 3
        const rowBand = Math.floor(y / 4)
        const mortarCol = (x + (rowBand % 2 === 0 ? 0 : 4)) % 8 === 7
        if (mortarRow || mortarCol) {
          c = o
        } else {
          c = n > 0.82 ? l : n < 0.16 ? d : m
          if (y % 4 === 0) c = l
        }
      } else if (pattern === 'lamp') {
        const core = x >= 5 && x <= 10 && y >= 5 && y <= 10
        const frame = x <= 2 || x >= 13 || y <= 2 || y >= 13
        const screw =
          (x === 2 && y === 2) ||
          (x === 13 && y === 2) ||
          (x === 2 && y === 13) ||
          (x === 13 && y === 13)
        if (edge) c = o
        else if (screw) c = l
        else if (frame) c = d
        else if (core) c = h
        else c = n > 0.5 ? l : shade(base, 1.35)
      } else if (pattern === 'gem') {
        if (edge) c = o
        else if (x === 7 || x === 8 || y === 7 || y === 8) c = d
        else {
          const upperLeft = x < 7 && y < 7
          const lowerRight = x > 8 && y > 8
          c = upperLeft ? l : lowerRight ? d : m
          if ((x === 2 && y === 2) || (x === 13 && y === 2)) c = h
        }
      } else {
        // generic：边框 + 细噪点 + 斜向光泽
        if (edge) {
          c = o
        } else if (n > 0.9) {
          c = l
        } else if (n < 0.08) {
          c = d
        } else if (x + y === 9 || x + y === 22) {
          c = l
        }
      }
      paint(grid, x, y, c)
    }
  }
  return grid
}

/** 矿石用的石质地底 */
function paintStone(grid: Grid): void {
  const stone = '#8b8b8b'
  const o = shade(stone, 0.7)
  const d = shade(stone, 0.88)
  const l = shade(stone, 1.12)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const n = hash2(x + 40, y + 7)
      let c = stone
      if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1) c = o
      else if (n > 0.85) c = l
      else if (n < 0.12) c = d
      paint(grid, x, y, c)
    }
  }
}
