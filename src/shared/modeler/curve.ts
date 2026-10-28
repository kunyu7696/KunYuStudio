/**
 * 关键帧缓动（B1-1 曲线编辑器，v2）。
 *
 * 设计（clean-room，不读/不抄 Blockbench 源码）：
 * - 缓动记在前一帧上（`Keyframe.easing`），管辖「本帧 → 下一帧」区间，与既有
 *   interpolation 约定一致；仅对 linear 区间生效（catmullrom 自带平滑、step 无过渡，
 *   叠加缓动无意义，采样层忽略）；
 * - 数学模型采用 W3C CSS Easing 公开的 cubic-bezier(x1,y1,x2,y2) 定义
 *   （公开标准，非任何软件私有）：t 经牛顿迭代求曲线参数 u，再取 y(u) 作为
 *   插值进度。x 分量夹取到 [0,1]（进度不可倒退），y 分量允许越界（回弹类缓动）。
 */
import type { BezierEasing } from './types'

/** 命名缓动预设（UI 下拉与序列化推荐值；自定义控制点直接存 cp 四元组即可） */
export const EASING_PRESETS = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  /** 回弹近似（y 越界产生过冲） */
  easeOutBack: [0.34, 1.56, 0.64, 1]
} as const satisfies Record<string, readonly [number, number, number, number]>

export type EasingPresetName = keyof typeof EASING_PRESETS

export const EASING_PRESET_NAMES = Object.keys(EASING_PRESETS) as EasingPresetName[]

/** 控制点是否等于某预设（容差 1e-6，用于 UI 回显选中态） */
export function matchEasingPreset(cp: readonly [number, number, number, number]): EasingPresetName | null {
  for (const name of EASING_PRESET_NAMES) {
    const p = EASING_PRESETS[name]
    if (Math.abs(p[0] - cp[0]) < 1e-6 && Math.abs(p[1] - cp[1]) < 1e-6 && Math.abs(p[2] - cp[2]) < 1e-6 && Math.abs(p[3] - cp[3]) < 1e-6) {
      return name
    }
  }
  return null
}

/** 规范化用户输入的控制点：x 夹取 [0,1]，y 夹取 [-4,4]（防离谱输入打爆曲线），全部有限 */
export function normalizeEasing(cp: readonly [number, number, number, number]): BezierEasing {
  const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : lo)
  return { cp: [clamp(cp[0], 0, 1), clamp(cp[1], -4, 4), clamp(cp[2], 0, 1), clamp(cp[3], -4, 4)] }
}

/** 恒等缓动判定（linear：应用与否采样结果一致，写文档前可省去） */
export function isIdentityEasing(easing: BezierEasing | undefined): boolean {
  if (!easing) return true
  const [x1, y1, x2, y2] = easing.cp
  return Math.abs(x1 - y1) < 1e-6 && Math.abs(x2 - y2) < 1e-6 && x1 >= 0 && x2 <= 1
}

function sampleX(cp: readonly [number, number, number, number], u: number): number {
  const [x1, , x2] = cp
  const iu = 1 - u
  return 3 * iu * iu * u * x1 + 3 * iu * u * u * x2 + u * u * u
}

function sampleY(cp: readonly [number, number, number, number], u: number): number {
  const [, y1, , y2] = cp
  const iu = 1 - u
  return 3 * iu * iu * u * y1 + 3 * iu * u * u * y2 + u * u * u
}

function sampleXd(cp: readonly [number, number, number, number], u: number): number {
  const [x1, , x2] = cp
  const iu = 1 - u
  return 3 * iu * iu * x1 + 6 * iu * u * (x2 - x1) + 3 * u * u * (1 - x2)
}

/**
 * 缓动求值：把线性进度 t ∈ [0,1] 映射为缓动后的进度。
 * 牛顿迭代最多 8 次（|Δ| < 1e-6 收敛），退化（导数≈0）时二分一次兜底。
 */
export function applyEasing(easing: BezierEasing | undefined, t: number): number {
  if (!easing || t <= 0 || t >= 1) return t
  const cp = easing.cp
  let u = t
  for (let i = 0; i < 8; i++) {
    const x = sampleX(cp, u) - t
    if (Math.abs(x) < 1e-6) break
    const d = sampleXd(cp, u)
    if (Math.abs(d) < 1e-6) break
    u -= x / d
    if (u < 0) u = 0
    else if (u > 1) u = 1
  }
  return sampleY(cp, u)
}

/** 曲线采样点列（UI 预览用）：N+1 个 [x, y] 点，y 允许越界 */
export function sampleEasingCurve(easing: BezierEasing, segments = 24): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    out.push([t, applyEasing(easing, t)])
  }
  return out
}
