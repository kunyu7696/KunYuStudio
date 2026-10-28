/**
 * 像素画笔核心（批次4，clean-room 自研）。
 *
 * 所有函数都是**纯数学**：不依赖 DOM/canvas，只返回要修改的像素坐标集合 [x, y][]。
 * 调用方负责把坐标映射回 ModelTexture.pixels（行优先，pixels[y*size + x]）。
 *
 * 坐标系：原点左上，x 向右，y 向下；画布边长 = size（正方形）。
 */

/* ------------------------------------------------------------------ */
/* 圆形笔刷：中心点 (cx, cy) + 半径 radius（像素），返回覆盖坐标      */
/* ------------------------------------------------------------------ */

/**
 * 圆形笔刷覆盖：圆心 (cx, cy)，半径 radius，画布边长 size。
 * 返回画布内所有满足 (x-cx)² + (y-cy)² ≤ radius² 的整数像素坐标。
 *
 * 边界处理：自动 clamp 到 [0, size-1]；radius ≤ 0 → 仅中心点。
 */
export function brushPixels(
  cx: number,
  cy: number,
  radius: number,
  size: number
): Array<[number, number]> {
  const r = Math.max(0, Math.floor(radius))
  const r2 = r * r
  const x0 = Math.max(0, Math.floor(cx) - r)
  const x1 = Math.min(size - 1, Math.floor(cx) + r)
  const y0 = Math.max(0, Math.floor(cy) - r)
  const y1 = Math.min(size - 1, Math.floor(cy) + r)
  const out: Array<[number, number]> = []
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy
    const dy2 = dy * dy
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx
      if (dx * dx + dy2 <= r2) out.push([x, y])
    }
  }
  if (out.length === 0 && radius <= 0) {
    // radius=0 兜底：至少一个像素
    const x = Math.max(0, Math.min(size - 1, Math.floor(cx)))
    const y = Math.max(0, Math.min(size - 1, Math.floor(cy)))
    out.push([x, y])
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Bresenham 线段：(x0,y0) → (x1,y1)，返回经过的像素坐标              */
/* ------------------------------------------------------------------ */

/**
 * Bresenham 线段算法。返回从 (x0,y0) 到 (x1,y1) 经过的整数像素坐标。
 * 端点自动 clamp 到 [0, size-1]。
 */
export function linePixels(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size: number
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let ix0 = Math.max(0, Math.min(size - 1, Math.round(x0)))
  let iy0 = Math.max(0, Math.min(size - 1, Math.round(y0)))
  const ix1 = Math.max(0, Math.min(size - 1, Math.round(x1)))
  const iy1 = Math.max(0, Math.min(size - 1, Math.round(y1)))

  const dx = Math.abs(ix1 - ix0)
  const dy = -Math.abs(iy1 - iy0)
  const sx = ix0 < ix1 ? 1 : -1
  const sy = iy0 < iy1 ? 1 : -1
  let err = dx + dy

  while (true) {
    out.push([ix0, iy0])
    if (ix0 === ix1 && iy0 === iy1) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; ix0 += sx }
    if (e2 <= dx) { err += dx; iy0 += sy }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 油漆桶：扫描线种子填充（4 连通）                                    */
/* ------------------------------------------------------------------ */

/**
 * 扫描线种子填充（4 连通）。从起点 (sx, sy) 出发，把所有与起点同色的相邻像素
 * 替换为 replacement，返回要修改的像素坐标集合。
 *
 * @param sx 种子 x（画布内）
 * @param sy 种子 y（画布内）
 * @param pixels 行优先像素串数组（'' = 透明）
 * @param size 画布边长（正方形）
 * @param colorEqual 颜色相等比较器（缺省 = 严格字符串相等）
 */
export function bucketFillPixels(
  sx: number,
  sy: number,
  pixels: string[],
  size: number,
  colorEqual: (a: string, b: string) => boolean = (a, b) => a === b
): Array<[number, number]> {
  // 边界 clamp
  sx = Math.max(0, Math.min(size - 1, sx | 0))
  sy = Math.max(0, Math.min(size - 1, sy | 0))
  const target = pixels[sy * size + sx]!
  const out: Array<[number, number]> = []
  if (colorEqual(target, '')) return out // 空区域不填充透明

  const visited = new Uint8Array(size * size)
  const stack: Array<[number, number]> = [[sx, sy]]

  while (stack.length > 0) {
    const [x, y] = stack.pop()!
    const idx = y * size + x
    if (visited[idx]) continue
    const c = pixels[idx]!
    if (!colorEqual(c, target)) continue
    visited[idx] = 1
    out.push([x, y])
    // 4 连通
    if (x > 0) stack.push([x - 1, y])
    if (x < size - 1) stack.push([x + 1, y])
    if (y > 0) stack.push([x, y - 1])
    if (y < size - 1) stack.push([x, y + 1])
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 椭圆笔刷（可选，用于柔和边缘）                                      */
/* ------------------------------------------------------------------ */

/**
 * 椭圆笔刷覆盖：圆心 (cx, cy)，rx/ry 半轴，画布边长 size。
 * 返回画布内满足 ((x-cx)/rx)² + ((y-cy)/ry)² ≤ 1 的整数像素坐标。
 */
export function ellipseBrushPixels(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  size: number
): Array<[number, number]> {
  if (rx <= 0 || ry <= 0) return brushPixels(cx, cy, 0, size)
  const rx2 = rx * rx
  const ry2 = ry * ry
  const out: Array<[number, number]> = []
  const x0 = Math.max(0, Math.floor(cx - rx))
  const x1 = Math.min(size - 1, Math.floor(cx + rx))
  const y0 = Math.max(0, Math.floor(cy - ry))
  const y1 = Math.min(size - 1, Math.floor(cy + ry))
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy
    const dyy = (dy * dy) / ry2
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx
      const dxx = (dx * dx) / rx2
      if (dxx + dyy <= 1) out.push([x, y])
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* 坐标 → pixels[] 索引                                                */
/* ------------------------------------------------------------------ */

/** 把 (x, y) 坐标转为行优先 pixels 数组下标 */
export function pixelIndex(x: number, y: number, size: number): number {
  return y * size + x
}
