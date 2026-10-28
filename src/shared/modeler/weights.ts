/**
 * 逐顶点蒙皮权重纯函数（v3 C3a 权重绘制）。
 *
 * 权重语义：MeshNode.weights 与 vertices 等长，每项为 { 组节点 id: 权重 }。
 * 绘制后逐顶点归一化到和 1（未归一/和≠1 的输入由 normalizeVertexWeight 收拢）。
 * 本模块只做「权重事实计算」，不含 UI/命令栈；不依赖 DOM/three/Electron。
 * clean-room：权重=骨骼影响度是公开的通用蒙皮模型（glTF 2.0 规范 §5.5
 * JOINTS_0/WEIGHTS_0 定义），此处按该规范独立实现。
 */
import type { MeshNode, ModelNode, NodeId } from './types'
import { isGroupNode } from './types'

/** 单顶点权重表（组 id → 权重） */
export type VertexWeight = Record<NodeId, number>

/** 单顶点权重上限（对齐 glTF VEC4：每顶点最多 4 关节） */
export const MAX_JOINTS_PER_VERTEX = 4

/** 权重低于该值视为 0（避免浮点尘埃留下无意义键） */
const WEIGHT_EPS = 1e-4

/** 空权重表（不共享引用，避免调用方就地修改） */
export function emptyVertexWeight(): VertexWeight {
  return {}
}

/** 读取某顶点对某组的权重（缺省 0） */
export function weightOf(w: VertexWeight | undefined, groupId: NodeId): number {
  return w?.[groupId] ?? 0
}

/**
 * 单顶点权重表规范化：丢弃 ≤EPS 项、>1 收拢到 1、键按字典序（序列化稳定）。
 * 不归一化（归一化只在绘制时做——读取既有权重不应改写其数值语义）。
 */
export function normalizeVertexWeight(w: VertexWeight): VertexWeight {
  const keys = Object.keys(w)
    .filter((k) => w[k]! > WEIGHT_EPS)
    .sort()
  const out: VertexWeight = {}
  for (const k of keys) out[k] = Math.min(1, w[k]!)
  return out
}

/** 顶点权重表是否为空（全部 ≤EPS） */
export function isWeightEmpty(w: VertexWeight): boolean {
  return Object.keys(w).every((k) => w[k]! <= WEIGHT_EPS)
}

/**
 * 取权重最大的前 maxJoints 项（降序；并列按组 id 字典序保证确定性），
 * 返回 [组 id, 权重] 列表——供 glTF JOINTS_0/WEIGHTS_0 发射使用。
 */
export function topWeights(
  w: VertexWeight,
  maxJoints: number = MAX_JOINTS_PER_VERTEX
): Array<[NodeId, number]> {
  return Object.entries(w)
    .filter(([, v]) => v > WEIGHT_EPS)
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
    .slice(0, maxJoints)
}

/**
 * 权重表按「有效组集合」裁剪：组被删除后清掉其引用，并把剩余权重重新归一化到
 * 和 1（否则顶点会因权重和 <1 而被欠驱动/向原点收缩）；剩余全 ≤EPS → 空对象
 * （保留空对象以维持与 vertices 的等长关系）。未发生变化的顶点保持原引用。
 * 返回 undefined = 入参无权重（调用方无需写回）。
 */
export function pruneVertexWeights(
  weights: VertexWeight[] | undefined,
  validGroupIds: ReadonlySet<NodeId>
): VertexWeight[] | undefined {
  if (!weights) return undefined
  return weights.map((w) => {
    const keys = Object.keys(w)
    if (keys.every((k) => validGroupIds.has(k))) return w
    const kept = keys.filter((k) => validGroupIds.has(k))
    const sum = kept.reduce((s, k) => s + Math.max(0, w[k]!), 0)
    if (sum <= WEIGHT_EPS) return emptyVertexWeight()
    return normalizeVertexWeight(
      Object.fromEntries(kept.map((k) => [k, Math.max(0, w[k]!) / sum]))
    )
  })
}

/**
 * 顶点增删对齐：为新插入的顶点补空权重（环切/切刀插入顶点后调用）。
 * weights 缺省时返回 undefined（无权重体系，无需同步）；新下标越界忽略。
 */
export function growVertexWeights(
  weights: VertexWeight[] | undefined,
  vertexCount: number,
  newIndices: readonly number[]
): VertexWeight[] | undefined {
  if (!weights) return undefined
  const out = weights.slice()
  while (out.length < vertexCount) out.push(emptyVertexWeight())
  for (const i of newIndices) {
    if (i >= 0 && i < out.length) out[i] = emptyVertexWeight()
  }
  return out
}

/** 单笔权重绘制：目标组 + 模式 + 逐顶点落笔量（量由视口按笔刷衰减算出） */
export interface WeightStroke {
  groupId: NodeId
  /** add = 累加并归一；replace = 覆写该组权重（其余组按剩余比例缩放，无剩余则独占）；subtract = 削减该组 */
  mode: 'add' | 'replace' | 'subtract'
  /** 逐顶点落笔（index 为 vertices 下标；amount ∈ 0..1） */
  entries: Array<{ index: number; amount: number }>
}

/**
 * 施加一笔权重绘制：返回新权重数组（未落笔顶点保持原引用，命令差分最小）。
 * 逐顶点规则——先按 mode 改写目标组权重，再把该顶点全部权重归一化到和 1；
 * 归一后全部 ≤EPS（如 subtract 削到 0 且无其它组）→ 记空对象。
 * 落笔顶点集合去重（同一顶点多次落笔取首次）。
 */
export function paintVertexWeights(node: MeshNode, stroke: WeightStroke): VertexWeight[] {
  const base = node.weights ?? node.vertices.map(() => emptyVertexWeight())
  const byIndex = new Map<number, number>()
  for (const e of stroke.entries) {
    const i = e.index
    if (i < 0 || i >= node.vertices.length || byIndex.has(i)) continue
    byIndex.set(i, Math.max(0, Math.min(1, e.amount)))
  }
  return base.map((w, i) => {
    const amount = byIndex.get(i)
    if (amount === undefined) return w
    const next: VertexWeight = { ...w }
    if (stroke.mode === 'replace') {
      // 覆写目标组：其余组按 (1−amount) 比例缩放（amount=1 时独占）
      for (const k of Object.keys(next)) {
        if (k === stroke.groupId) continue
        next[k] = next[k]! * (1 - amount)
      }
      next[stroke.groupId] = amount
    } else if (stroke.mode === 'subtract') {
      next[stroke.groupId] = (next[stroke.groupId] ?? 0) - amount
    } else {
      next[stroke.groupId] = (next[stroke.groupId] ?? 0) + amount
    }
    const cleaned = normalizeVertexWeight(next)
    const sum = Object.values(cleaned).reduce((s, v) => s + v, 0)
    if (sum <= WEIGHT_EPS) return emptyVertexWeight()
    const out: VertexWeight = {}
    for (const k of Object.keys(cleaned)) out[k] = cleaned[k]! / sum
    return out
  })
}

/**
 * 权重 → 预览色（0 冷蓝 → 1 热红，公开的通用热力配色；便于视口着色与测试）。
 * 返回 0..1 的 [r,g,b]。
 */
export function weightPreviewColor(weight: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, weight))
  // 蓝 (0.20,0.45,0.95) → 青 (0.15,0.85,0.70) → 红 (0.95,0.25,0.25)
  if (t < 0.5) {
    const u = t * 2
    return [0.2 + (0.15 - 0.2) * u, 0.45 + (0.85 - 0.45) * u, 0.95 + (0.7 - 0.95) * u]
  }
  const u = (t - 0.5) * 2
  return [0.15 + (0.95 - 0.15) * u, 0.85 + (0.25 - 0.85) * u, 0.7 + (0.25 - 0.7) * u]
}

/** 文档内全部可作为权重目标的组节点 id（按 id 字典序，便于下拉稳定排序） */
export function weightGroupIds(allNodes: Record<NodeId, ModelNode>): NodeId[] {
  return Object.keys(allNodes)
    .filter((id) => {
      const n = allNodes[id]
      return !!n && isGroupNode(n)
    })
    .sort()
}
