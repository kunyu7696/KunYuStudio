/**
 * 权重绘制纯算法（自 ModelerViewport.vue 抽离，行为保持逐字一致）：
 * 预览权重（含 pending 增量）、球形笔刷落墨累积、位移节流。
 * 本模块不持有 Vue 响应式状态；pendingWeights 由宿主持有并按引用传入。
 */
import type { MeshNode, NodeId, Vec3 } from '../../../../../shared/modeler/types'
import { weightOf } from '../../../../../shared/modeler/weights'

export type WeightMode = 'add' | 'replace' | 'subtract'

export interface WeightCtx {
  /** 落笔模式：累加 / 替换 / 削减（对齐 weights.ts paintVertexWeights 的 mode） */
  mode: WeightMode
  /** 笔刷半径（模型空间单位，16 单位 = 1 方块；3D 距离衰减） */
  radius: number
  /** 笔刷强度（1–100 → 落笔量 0.01–1） */
  strength: number
  /** 本笔累积：顶点下标 → 落笔量（按 mode 语义累积）；抬起时一次性提交为单条命令 */
  pendingWeights: Map<number, number> | null
}

/** 顶点在当前目标组下的「预览权重」（含本笔 pending 增量；用于热力着色） */
export function previewWeight(
  ctx: WeightCtx,
  node: MeshNode,
  index: number,
  target: NodeId | null
): number {
  const base = target ? weightOf(node.weights?.[index], target) : 0
  const pending = ctx.pendingWeights?.get(index)
  if (pending === undefined) return base
  if (ctx.mode === 'replace') return pending
  if (ctx.mode === 'subtract') return Math.max(0, base - pending)
  return Math.min(1, base + pending)
}

/**
 * 落墨一笔（累积，不立即提交）：以模型空间球半径筛选目标顶点，按 1−d/r 线性衰减
 * 算出逐顶点量，按 mode 语义累积进 pendingWeights（add/subtract 累加饱和、replace 取大）。
 * 返回是否触及任何顶点（宿主据此刷新热力预览）。整笔在 pointerup 时一次性提交为单条命令。
 */
export function stampWeights(ctx: WeightCtx, node: MeshNode, target: NodeId | null, center: Vec3): boolean {
  if (!target) return false
  const r = Math.max(0.5, ctx.radius)
  const strength = Math.max(0.01, Math.min(1, ctx.strength / 100))
  if (!ctx.pendingWeights) ctx.pendingWeights = new Map()
  const pending = ctx.pendingWeights
  let touched = false
  for (let i = 0; i < node.vertices.length; i++) {
    const v = node.vertices[i]!
    const dist = Math.hypot(v[0] - center[0], v[1] - center[1], v[2] - center[2])
    if (dist > r) continue
    const amount = strength * (1 - dist / r)
    const prev = pending.get(i) ?? 0
    pending.set(i, ctx.mode === 'replace' ? Math.max(prev, amount) : Math.min(1, prev + amount))
    touched = true
  }
  return touched
}

/** 权重笔画移动的位移节流：距上次落墨点小于 threshold 像素时不采样 */
export function throttledWeightSample(
  last: { x: number; y: number } | null,
  x: number,
  y: number,
  threshold = 3
): { sample: boolean; last: { x: number; y: number } } {
  if (last && Math.hypot(x - last.x, y - last.y) < threshold) return { sample: false, last }
  return { sample: true, last: { x, y } }
}
