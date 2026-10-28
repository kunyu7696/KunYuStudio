/**
 * 动画采样纯函数层（P4-a，方案 §4.9）。
 *
 * 职责：
 * - 关键帧数组操作：排序、插入/替换（同时间点去重）、删除；
 * - 时间折返：loop 取模循环、once/hold 夹取到 [0, length]（hold 的「定格末帧」
 *   语义即播放结束后停在 length）；
 * - 通道采样：linear / catmullrom /step 三种插值（插值方式记在前一帧上，
 *   与 Blockbench 一致：关键帧的 interpolation 管辖「本帧 → 下一帧」区间）；
 * - 整条动画采样：ModelAnimation × 时间 → 各节点三通道数值。
 *
 * 本层为纯数学：不依赖 DOM/three/Electron，文档/场景叠加由调用方负责
 * （播放器只把采样结果叠加到 three 场景对象，绝不回写文档，方案 §4.9 L267）。
 */
import { applyEasing } from './curve'
import type {
  AnimationChannelName,
  Keyframe,
  ModelAnimation,
  NodeId,
  Vec3
} from './types'

/** 单节点三通道采样结果（缺通道 = 该属性保持场景原值，播放器不叠加） */
export interface SampledNodeChannels {
  rotation?: Vec3
  position?: Vec3
  scale?: Vec3
}

/** 时间点判等容差（秒）：同一点位的新帧替换旧帧 */
export const KEYFRAME_TIME_EPS = 1e-4

/* ------------------------------------------------------------------ */
/* 关键帧数组操作（全部不可变，返回新数组）                                */
/* ------------------------------------------------------------------ */

/** 按时间升序排序（稳定排序，不修改入参） */
export function sortKeyframes(keys: readonly Keyframe[]): Keyframe[] {
  return keys.slice().sort((a, b) => a.time - b.time)
}

/**
 * 插入/替换关键帧：与已有帧时间差 ≤ eps 视为同一帧（原地替换值与插值），
 * 否则按时间升序插入。time/value 会被浅拷贝，非法数值（NaN/Infinity）抛错。
 */
export function upsertKeyframe(
  keys: readonly Keyframe[],
  kf: Keyframe,
  eps: number = KEYFRAME_TIME_EPS
): Keyframe[] {
  if (!Number.isFinite(kf.time) || kf.time < 0) {
    throw new Error(`关键帧时间非法：${kf.time}`)
  }
  if (!kf.value.every((n) => Number.isFinite(n))) {
    throw new Error(`关键帧数值非法：[${kf.value.join(', ')}]`)
  }
  const entry: Keyframe = { time: kf.time, value: [...kf.value] as Vec3, interpolation: kf.interpolation }
  if (kf.easing) entry.easing = { cp: [...kf.easing.cp] as [number, number, number, number] }
  const sorted = sortKeyframes(keys)
  for (let i = 0; i < sorted.length; i++) {
    if (Math.abs(sorted[i]!.time - kf.time) <= eps) {
      const next = sorted.slice()
      next[i] = entry
      return next
    }
  }
  const at = sorted.findIndex((k) => k.time > kf.time)
  if (at < 0) return [...sorted, entry]
  return [...sorted.slice(0, at), entry, ...sorted.slice(at)]
}

/** 删除指定时间点的关键帧（无匹配返回原数组引用） */
export function removeKeyframeAt(
  keys: readonly Keyframe[],
  time: number,
  eps: number = KEYFRAME_TIME_EPS
): Keyframe[] {
  const at = keys.findIndex((k) => Math.abs(k.time - time) <= eps)
  if (at < 0) return keys as Keyframe[]
  return [...keys.slice(0, at), ...keys.slice(at + 1)]
}

/* ------------------------------------------------------------------ */
/* 时间折返                                                              */
/* ------------------------------------------------------------------ */

/**
 * 把任意播放时间折算为采样时间：
 * - loop：对 length 取模（负时间向正周期折返）；
 * - once / hold：夹取到 [0, length]（hold_on_last_frame 即停在末帧）。
 * length ≤ 0 或时间非法时回退 0。
 */
export function resolveAnimTime(anim: ModelAnimation, time: number): number {
  const len = anim.length
  if (!Number.isFinite(time) || !(len > 0)) return 0
  if (anim.loop === 'loop') {
    const t = time % len
    return t < 0 ? t + len : t
  }
  return Math.min(Math.max(time, 0), len)
}

/* ------------------------------------------------------------------ */
/* 通道采样                                                              */
/* ------------------------------------------------------------------ */

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Catmull-Rom 样条（张力 0.5 标准形），t ∈ [0,1] 介于 p1/p2 之间 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3)
  )
}

/**
 * 单通道在指定时间的采样：
 * - 空通道 → null（该属性保持原值）；
 * - 时间越界 → 端点帧值（首帧前取首帧，末帧后取末帧）；
 * - 区间内：step 取前帧值；linear 线性插值；catmullrom 用相邻四帧样条
 *   （端点缺邻时以端点自身补齐，即「夹持端点」约定）。
 * 返回新数组，不共享输入引用。
 */
export function sampleChannel(keys: readonly Keyframe[], time: number): Vec3 | null {
  if (keys.length === 0) return null
  const sorted = sortKeyframes(keys)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  if (time <= first.time) return [...first.value] as Vec3
  if (time >= last.time) return [...last.value] as Vec3

  // 定位区间：sorted[i].time <= time < sorted[i+1].time
  let i = 0
  while (i < sorted.length - 2 && sorted[i + 1]!.time <= time) i++
  const k0 = sorted[i]!
  const k1 = sorted[i + 1]!

  if (k0.interpolation === 'step') return [...k0.value] as Vec3

  const span = k1.time - k0.time
  if (span <= 0) return [...k1.value] as Vec3 // 同点位叠帧：取后帧
  const t = (time - k0.time) / span

  if (k0.interpolation === 'catmullrom') {
    const p0 = i > 0 ? sorted[i - 1]!.value : k0.value
    const p3 = i + 2 < sorted.length ? sorted[i + 2]!.value : k1.value
    return [
      catmullRom(p0[0], k0.value[0], k1.value[0], p3[0], t),
      catmullRom(p0[1], k0.value[1], k1.value[1], p3[1], t),
      catmullRom(p0[2], k0.value[2], k1.value[2], p3[2], t)
    ]
  }

  // linear（缺省）：可选 Bezier 缓动先把区间进度 t 映射为缓动后进度
  const te = applyEasing(k0.easing, t)
  return [
    lerp(k0.value[0], k1.value[0], te),
    lerp(k0.value[1], k1.value[1], te),
    lerp(k0.value[2], k1.value[2], te)
  ]
}

/* ------------------------------------------------------------------ */
/* 整条动画采样                                                          */
/* ------------------------------------------------------------------ */

/**
 * 采样整条动画：返回「有任一通道产出的节点 id → 三通道数值」。
 * 通道缺失/为空 = 该属性不出现在结果里（播放器不叠加，保持场景原值）。
 */
export function sampleAnimation(anim: ModelAnimation, time: number): Map<NodeId, SampledNodeChannels> {
  const t = resolveAnimTime(anim, time)
  const out = new Map<NodeId, SampledNodeChannels>()
  for (const [nodeId, channels] of Object.entries(anim.channels)) {
    const sampled: SampledNodeChannels = {}
    const r = channels.rotation ? sampleChannel(channels.rotation, t) : null
    const p = channels.position ? sampleChannel(channels.position, t) : null
    const s = channels.scale ? sampleChannel(channels.scale, t) : null
    if (r) sampled.rotation = r
    if (p) sampled.position = p
    if (s) sampled.scale = s
    if (r || p || s) out.set(nodeId, sampled)
  }
  return out
}

/** 三通道名常量（UI 时间线轨道遍历/序列化共用） */
export const ANIMATION_CHANNELS: readonly AnimationChannelName[] = ['rotation', 'position', 'scale']
