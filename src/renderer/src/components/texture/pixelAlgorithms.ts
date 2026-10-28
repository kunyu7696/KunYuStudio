/**
 * 材质编辑器像素算法纯函数（P0）。
 * 全部为行优先像素数组的原地/拷贝变换，不依赖 DOM，可直接 vitest。
 * 约定：'' = 透明，'#rrggbb' = 不透明；坐标越界静默忽略。
 */

export interface PixelPoint {
  x: number
  y: number
}

/** 写像素（越界忽略） */
function put(pixels: string[], width: number, height: number, x: number, y: number, color: string): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  pixels[y * width + x] = color
}

/** Bresenham 直线光栅化（含两端点） */
export function linePoints(x0: number, y0: number, x1: number, y1: number): PixelPoint[] {
  const points: PixelPoint[] = []
  let dx = Math.abs(x1 - x0)
  let dy = -Math.abs(y1 - y0)
  let sx = x0 < x1 ? 1 : -1
  let sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  let x = x0
  let y = y0
  for (;;) {
    points.push({ x, y })
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
  }
  return points
}

/** 矩形边界点（描边） */
export function rectOutlinePoints(x0: number, y0: number, x1: number, y1: number): PixelPoint[] {
  const points: PixelPoint[] = []
  const minX = Math.min(x0, x1)
  const maxX = Math.max(x0, x1)
  const minY = Math.min(y0, y1)
  const maxY = Math.max(y0, y1)
  for (let x = minX; x <= maxX; x++) {
    points.push({ x, y: minY })
    if (maxY !== minY) points.push({ x, y: maxY })
  }
  for (let y = minY + 1; y < maxY; y++) {
    points.push({ x: minX, y })
    if (maxX !== minX) points.push({ x: maxX, y })
  }
  return points
}

/** 矩形填充点 */
export function rectFillPoints(x0: number, y0: number, x1: number, y1: number): PixelPoint[] {
  const points: PixelPoint[] = []
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      points.push({ x, y })
    }
  }
  return points
}

/**
 * 椭圆光栅化（中点算法，四象限对称；端点矩形内切）。
 * 点可能重复，调用方写入像素天然幂等。
 */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number): PixelPoint[] {
  const points: PixelPoint[] = []
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const a = Math.abs(x1 - x0) / 2
  const b = Math.abs(y1 - y0) / 2
  if (a < 0.5 || b < 0.5) return rectOutlinePoints(x0, y0, x1, y1)
  const a2 = a * a
  const b2 = b * b
  const push = (px: number, py: number): void => {
    points.push({ x: Math.round(cx + px), y: Math.round(cy + py) })
  }
  // 区域 1：|斜率| < 1
  let x = 0
  let y = b
  let d1 = b2 - a2 * b + a2 / 4
  let dx = 2 * b2 * x
  let dy = 2 * a2 * y
  while (dx < dy) {
    push(x, y)
    push(-x, y)
    push(x, -y)
    push(-x, -y)
    if (d1 < 0) {
      x += 1
      dx += 2 * b2
      d1 += dx + b2
    } else {
      x += 1
      y -= 1
      dx += 2 * b2
      dy -= 2 * a2
      d1 += dx - dy + b2
    }
  }
  // 区域 2：|斜率| > 1
  let d2 = b2 * (x + 0.5) * (x + 0.5) + a2 * (y - 1) * (y - 1) - a2 * b2
  while (y >= 0) {
    push(x, y)
    push(-x, y)
    push(x, -y)
    push(-x, -y)
    if (d2 > 0) {
      y -= 1
      dy -= 2 * a2
      d2 += a2 - dy
    } else {
      y -= 1
      x += 1
      dx += 2 * b2
      dy -= 2 * a2
      d2 += dx - dy + a2
    }
  }
  return points
}

/**
 * 迭代洪水填充（4-连通，显式栈，杜绝 256×256 大画布递归栈溢出）。
 * 返回被改写的坐标数；目标色 == 替换色时返回 0。
 */
export function floodFill(
  pixels: string[],
  width: number,
  height: number,
  startX: number,
  startY: number,
  color: string
): number {
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return 0
  const target = pixels[startY * width + startX] ?? ''
  if (target === color) return 0
  const stack: PixelPoint[] = [{ x: startX, y: startY }]
  let changed = 0
  while (stack.length > 0) {
    const p = stack.pop() as PixelPoint
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) continue
    const i = p.y * width + p.x
    if (pixels[i] !== target) continue
    pixels[i] = color
    changed++
    stack.push({ x: p.x + 1, y: p.y })
    stack.push({ x: p.x - 1, y: p.y })
    stack.push({ x: p.x, y: p.y + 1 })
    stack.push({ x: p.x, y: p.y - 1 })
  }
  return changed
}

/** 把点集按工具写入像素数组（新数组，避免直接改 props） */
export function applyPoints(
  pixels: string[],
  width: number,
  height: number,
  points: PixelPoint[],
  color: string
): string[] {
  const next = pixels.slice()
  for (const p of points) put(next, width, height, p.x, p.y, color)
  return next
}
