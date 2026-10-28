/**
 * 逐顶点蒙皮权重规范（v3 C3a）。
 *
 * 覆盖：权重表规范化/顶层取用、绘制（add/replace/subtract + 归一化）、
 * 顶点增删对齐、组删除裁剪、文档校验（glTF 导出消费见 gltf.spec.ts）。
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_JOINTS_PER_VERTEX,
  emptyVertexWeight,
  growVertexWeights,
  isWeightEmpty,
  normalizeVertexWeight,
  paintVertexWeights,
  pruneVertexWeights,
  topWeights,
  weightOf,
  weightPreviewColor
} from '../weights'
import type { VertexWeight } from '../weights'
import {
  addNode,
  createDocument,
  createGroupNode,
  createMeshNode,
  patchNode,
  removeNodes,
  validateDocument
} from '../document'
import { defaultMeshGeometry } from '../mesh'
import type { MeshNode, ModelDocument } from '../types'

/** 四顶点网格 + 两个骨骼组（g1 为 g2 父组），g1 挂网格 */
function docWithMeshGroups(): { doc: ModelDocument; meshId: string; g1: string; g2: string } {
  let doc = createDocument({ name: 'd', format: 'free' })
  const g1 = createGroupNode('root-bone')
  doc = addNode(doc, g1, null)
  const g2 = createGroupNode('tip-bone')
  doc = addNode(doc, g2, g1.id)
  const mesh = createMeshNode('mesh', defaultMeshGeometry())
  doc = addNode(doc, mesh, g1.id)
  return { doc, meshId: mesh.id, g1: g1.id, g2: g2.id }
}

describe('权重表基础（v3 C3a）', () => {
  it('weightOf：缺省 0；命中返回数值', () => {
    expect(weightOf(undefined, 'g')).toBe(0)
    expect(weightOf({ g: 0.5 }, 'g')).toBe(0.5)
    expect(weightOf({ g: 0.5 }, 'x')).toBe(0)
  })

  it('normalizeVertexWeight：丢 ≤EPS 项、>1 收拢、键字典序', () => {
    const w = normalizeVertexWeight({ b: 0.00001, a: 1.5, c: 0.25 })
    expect(Object.keys(w)).toEqual(['a', 'c'])
    expect(w.a).toBe(1)
    expect(w.c).toBe(0.25)
  })

  it('isWeightEmpty：全 ≤EPS 为真', () => {
    expect(isWeightEmpty({})).toBe(true)
    expect(isWeightEmpty({ a: 0 })).toBe(true)
    expect(isWeightEmpty({ a: 0.01 })).toBe(false)
  })

  it('emptyVertexWeight：每次调用返回独立对象', () => {
    expect(emptyVertexWeight()).not.toBe(emptyVertexWeight())
  })

  it('topWeights：降序、并列按 id 字典序、上限 4', () => {
    const top = topWeights({ b: 0.2, a: 0.2, c: 0.9, d: 0.4, e: 0.3, f: 0.1 })
    expect(top).toHaveLength(MAX_JOINTS_PER_VERTEX)
    expect(top[0]).toEqual(['c', 0.9])
    expect(top[1]).toEqual(['d', 0.4])
    expect(top[2]).toEqual(['e', 0.3])
    expect(top[3]).toEqual(['a', 0.2])
  })

  it('weightPreviewColor：0 偏蓝、1 偏红、区间有界', () => {
    const cold = weightPreviewColor(0)
    const hot = weightPreviewColor(1)
    expect(cold[2]).toBeGreaterThan(cold[0])
    expect(hot[0]).toBeGreaterThan(hot[2])
    for (const t of [-1, 0, 0.5, 1, 2]) {
      const [r, g, b] = weightPreviewColor(t)
      for (const c of [r, g, b]) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('权重绘制（v3 C3a）', () => {
  const nodeWithVerts = (): MeshNode =>
    createMeshNode('m', {
      vertices: [
        [0, 0, 0],
        [4, 0, 0],
        [8, 0, 0]
      ],
      faces: [{ vertices: [0, 1, 2], uv: [[0, 0], [4, 0], [0, 4]] }]
    })

  it('add：累加后逐顶点归一化到和 1；未落笔顶点保持原引用', () => {
    const node = nodeWithVerts()
    const next = paintVertexWeights(node, {
      groupId: 'g1',
      mode: 'add',
      entries: [
        { index: 0, amount: 1 },
        { index: 1, amount: 0.5 }
      ]
    })
    expect(next).toHaveLength(3)
    expect(next[0]).toEqual({ g1: 1 })
    expect(next[1]).toEqual({ g1: 1 }) // 单组时归一化为 1
    expect(node.weights).toBeUndefined()
  })

  it('add：与既有权重混合后归一化', () => {
    const node: MeshNode = { ...nodeWithVerts(), weights: [{ g1: 1 }, {}, {}] }
    const next = paintVertexWeights(node, {
      groupId: 'g2',
      mode: 'add',
      entries: [{ index: 0, amount: 0.5 }]
    })
    // g1=1, g2=0.5 → 归一化 2/3 : 1/3
    expect(next[0]!.g1).toBeCloseTo(2 / 3, 6)
    expect(next[0]!.g2).toBeCloseTo(1 / 3, 6)
    expect(next[1]).toBe(node.weights![1]) // 未落笔保持原引用
  })

  it('replace：覆写目标组，其余组按剩余比例缩放', () => {
    const node: MeshNode = { ...nodeWithVerts(), weights: [{ g1: 1 }, {}, {}] }
    const next = paintVertexWeights(node, {
      groupId: 'g2',
      mode: 'replace',
      entries: [{ index: 0, amount: 0.75 }]
    })
    expect(next[0]!.g1).toBeCloseTo(0.25, 6)
    expect(next[0]!.g2).toBeCloseTo(0.75, 6)
  })

  it('replace：amount=1 独占（其余组清零）', () => {
    const node: MeshNode = { ...nodeWithVerts(), weights: [{ g1: 1 }, {}, {}] }
    const next = paintVertexWeights(node, {
      groupId: 'g2',
      mode: 'replace',
      entries: [{ index: 0, amount: 1 }]
    })
    expect(next[0]).toEqual({ g2: 1 })
  })

  it('subtract：削减到 0 且无其它组 → 记空对象', () => {
    const node: MeshNode = { ...nodeWithVerts(), weights: [{ g1: 0.4 }, {}, {}] }
    const next = paintVertexWeights(node, {
      groupId: 'g1',
      mode: 'subtract',
      entries: [{ index: 0, amount: 0.5 }]
    })
    expect(next[0]).toEqual({})
  })

  it('subtract：削减后仍有其它组 → 归一化保留比例', () => {
    const node: MeshNode = { ...nodeWithVerts(), weights: [{ g1: 0.5, g2: 0.5 }, {}, {}] }
    const next = paintVertexWeights(node, {
      groupId: 'g1',
      mode: 'subtract',
      entries: [{ index: 0, amount: 0.25 }]
    })
    expect(next[0]!.g1).toBeCloseTo(1 / 3, 6)
    expect(next[0]!.g2).toBeCloseTo(2 / 3, 6)
  })

  it('落笔越界下标忽略；同顶点重复落笔取首次', () => {
    const node = nodeWithVerts()
    const next = paintVertexWeights(node, {
      groupId: 'g1',
      mode: 'add',
      entries: [
        { index: 9, amount: 1 },
        { index: 0, amount: 0.3 },
        { index: 0, amount: 0.9 }
      ]
    })
    expect(next).toHaveLength(3)
    expect(next[0]).toEqual({ g1: 1 })
    expect(next[2]).toEqual({})
  })
})

describe('权重对齐与裁剪（v3 C3a）', () => {
  it('growVertexWeights：无权重体系返回 undefined（不引入 weights 键）', () => {
    expect(growVertexWeights(undefined, 3, [2])).toBeUndefined()
  })

  it('growVertexWeights：新顶点补空权重并补齐长度', () => {
    const w: VertexWeight[] = [{ g1: 1 }, {}]
    const next = growVertexWeights(w, 4, [2, 3])!
    expect(next).toHaveLength(4)
    expect(next[2]).toEqual({})
    expect(next[3]).toEqual({})
    expect(next[0]).toBe(w[0]) // 原有项保持原引用
  })

  it('pruneVertexWeights：剔除失效组；全空记空对象；未变保持原引用', () => {
    const valid = new Set(['g1'])
    const w: VertexWeight[] = [{ g1: 0.5, gone: 0.5 }, { gone: 1 }, { g1: 1 }]
    const next = pruneVertexWeights(w, valid)!
    expect(next[0]).toEqual({ g1: 1 })
    expect(next[1]).toEqual({})
    expect(next[2]).toBe(w[2])
  })

  it('pruneVertexWeights：入参 undefined 原样返回 undefined', () => {
    expect(pruneVertexWeights(undefined, new Set())).toBeUndefined()
  })
})

describe('权重文档集成（v3 C3a）', () => {
  it('校验：权重项数与顶点数一致 + 组引用存在 → 无问题', () => {
    const { doc, meshId, g1 } = docWithMeshGroups()
    const m = doc.nodes[meshId] as MeshNode
    const weights = m.vertices.map((_, i) => (i === 0 ? { [g1]: 1 } : {}))
    const next = patchNode(doc, meshId, { weights })
    expect(validateDocument(next)).toEqual([])
  })

  it('校验：权重项数与顶点数不一致 → mesh_weights_invalid', () => {
    const { doc, meshId, g1 } = docWithMeshGroups()
    const next = patchNode(doc, meshId, { weights: [{ [g1]: 1 }] })
    const codes = validateDocument(next).map((i) => i.code)
    expect(codes).toContain('mesh_weights_invalid')
  })

  it('校验：权重引用非组节点（mesh 自身）→ mesh_weights_invalid', () => {
    const { doc, meshId, g1 } = docWithMeshGroups()
    const m = doc.nodes[meshId] as MeshNode
    // 合法：全部引用 g1
    const ok = patchNode(doc, meshId, { weights: m.vertices.map(() => ({ [g1]: 1 })) })
    expect(validateDocument(ok)).toEqual([])
    // 非法：把网格自身当目标组（mesh 不是组）→ 应报错
    const bad = patchNode(doc, meshId, { weights: m.vertices.map(() => ({ [meshId]: 1 })) })
    expect(validateDocument(bad).map((i) => i.code)).toContain('mesh_weights_invalid')
  })

  it('删除组 → 网格权重中该组引用被裁剪', () => {
    const { doc, meshId, g1, g2 } = docWithMeshGroups()
    const m = doc.nodes[meshId] as MeshNode
    const weights = m.vertices.map(() => ({ [g1]: 0.5, [g2]: 0.5 }))
    const painted = patchNode(doc, meshId, { weights })
    const after = removeNodes(painted, [g2])
    const m2 = after.nodes[meshId] as MeshNode
    expect(m2.weights![0]).toEqual({ [g1]: 1 })
    expect(validateDocument(after)).toEqual([])
  })

  it('patchNode 传 weights: undefined → 移除该键（回到全刚性缺省）', () => {
    const { doc, meshId, g1 } = docWithMeshGroups()
    const m = doc.nodes[meshId] as MeshNode
    const weights = m.vertices.map(() => ({ [g1]: 1 }))
    const painted = patchNode(doc, meshId, { weights })
    expect((painted.nodes[meshId] as MeshNode).weights).toBeDefined()
    const cleared = patchNode(painted, meshId, { weights: undefined })
    expect((cleared.nodes[meshId] as MeshNode).weights).toBeUndefined()
    expect(validateDocument(cleared)).toEqual([])
  })
})
