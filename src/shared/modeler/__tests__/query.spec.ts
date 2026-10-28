import { describe, expect, it } from 'vitest'
import { documentSummary, isVisible, pickCubes, rayAabb, visibleNodeIds } from '../query'
import { addNode, createCubeNode, createDocument, createGroupNode, createLocatorNode, effectiveSelection } from '../document'
import type { ModelAnimation, ModelDocument, Vec3 } from '../types'

/** 固定测试文档：root: [cube1, group1[locator1, cube2], cube3] */
function fixture(): { doc: ModelDocument; ids: Record<string, string> } {
  let doc = createDocument({ id: 'doc-q', name: 'q', format: 'free', now: 1000 })
  const cube1 = createCubeNode('c1', { from: [0, 0, 0], to: [8, 8, 8] })
  const group1 = createGroupNode('g1')
  const locator1 = createLocatorNode('l1', [1, 2, 3])
  const cube2 = createCubeNode('c2')
  const cube3 = createCubeNode('c3', { from: [32, 0, 0], to: [40, 8, 8] })
  doc = addNode(doc, cube1, null)
  doc = addNode(doc, group1, null)
  doc = addNode(doc, locator1, group1.id)
  doc = addNode(doc, cube2, group1.id)
  doc = addNode(doc, cube3, null)
  return {
    doc,
    ids: { cube1: cube1.id, group1: group1.id, locator1: locator1.id, cube2: cube2.id, cube3: cube3.id }
  }
}

describe('modeler/query 可见性', () => {
  it('isVisible：继承祖先；父级隐藏连带隐藏；未知 id = false', () => {
    const { doc, ids } = fixture()
    expect(isVisible(doc, ids.cube2)).toBe(true)
    let next = { ...doc, nodes: { ...doc.nodes, [ids.cube2]: { ...doc.nodes[ids.cube2]!, visible: false } } }
    expect(isVisible(next, ids.cube2)).toBe(false)
    // 隐藏父级 → 子级不可见
    next = { ...doc, nodes: { ...doc.nodes, [ids.group1]: { ...doc.nodes[ids.group1]!, visible: false } } }
    expect(isVisible(next, ids.cube2)).toBe(false)
    expect(isVisible(next, ids.group1)).toBe(false)
    expect(isVisible(doc, 'nope')).toBe(false)
  })

  it('visibleNodeIds：只含实际可见节点', () => {
    const { doc, ids } = fixture()
    const next = {
      ...doc,
      nodes: { ...doc.nodes, [ids.cube3]: { ...doc.nodes[ids.cube3]!, visible: false } }
    }
    const idsVisible = visibleNodeIds(next)
    expect(idsVisible).toContain(ids.cube1)
    expect(idsVisible).not.toContain(ids.cube3)
  })
})

describe('modeler/query 顶层化', () => {
  it('effectiveSelection（document 导出）：父子同时选中取父；过滤未知', () => {
    const { doc, ids } = fixture()
    expect(effectiveSelection(doc, [ids.group1, ids.cube2])).toEqual([ids.group1])
    expect(effectiveSelection(doc, [ids.cube1, 'nope', ids.cube3])).toEqual([ids.cube1, ids.cube3])
  })
})

describe('modeler/query 射线-AABB', () => {
  it('命中：t 为进入距离', () => {
    const t = rayAabb([-10, 8, 8], [1, 0, 0], [0, 0, 0], [16, 16, 16])
    expect(t).toBeCloseTo(10, 9)
  })

  it('未命中：平行偏移 / 盒在射线后方', () => {
    expect(rayAabb([-10, 20, 8], [1, 0, 0], [0, 0, 0], [16, 16, 16])).toBeNull()
    expect(rayAabb([-10, 8, 8], [-1, 0, 0], [0, 0, 0], [16, 16, 16])).toBeNull()
  })

  it('起点在盒内：t = 0', () => {
    expect(rayAabb([8, 8, 8], [0, 0, 1], [0, 0, 0], [16, 16, 16])).toBe(0)
  })

  it('退化薄片盒：面内命中', () => {
    const t = rayAabb([0, 0, -5], [0, 0, 1], [0, 0, 0], [16, 16, 0])
    expect(t).toBeCloseTo(5, 9)
  })
})

describe('modeler/query pickCubes', () => {
  it('命中最近立方体并给出面名与命中点', () => {
    const { doc, ids } = fixture()
    const hit = pickCubes(doc, [-10, 4, 4], [1, 0, 0])!
    expect(hit.id).toBe(ids.cube1)
    expect(hit.distance).toBeCloseTo(10, 9)
    expect(hit.face).toBe('west')
    expect(hit.point[0]).toBeCloseTo(0, 9)
    expect(hit.point[1]).toBeCloseTo(4, 9)
    // 从下方 +Y 进入 → down 面
    const down = pickCubes(doc, [4, -10, 4], [0, 1, 0])!
    expect(down.face).toBe('down')
    // 从 +Z 向 −Z 进入 → south 面
    const south = pickCubes(doc, [4, 4, 100], [0, 0, -1])!
    expect(south.face).toBe('south')
    // 命中远处 cube3
    const far = pickCubes(doc, [36, -10, 4], [0, 1, 0])!
    expect(far.id).toBe(ids.cube3)
  })

  it('不可见跳过；锁定默认参与、可选排除', () => {
    const { doc, ids } = fixture()
    // cube3 独占 [32..40] 区间，隐藏后该射线不再命中任何立方体
    const hidden = {
      ...doc,
      nodes: { ...doc.nodes, [ids.cube3]: { ...doc.nodes[ids.cube3]!, visible: false } }
    }
    expect(pickCubes(hidden, [36, -10, 4], [0, 1, 0])).toBeNull()
    const locked = {
      ...doc,
      nodes: { ...doc.nodes, [ids.cube3]: { ...doc.nodes[ids.cube3]!, locked: true } }
    }
    expect(pickCubes(locked, [36, -10, 4], [0, 1, 0])!.id).toBe(ids.cube3)
    expect(pickCubes(locked, [36, -10, 4], [0, 1, 0], { includeLocked: false })).toBeNull()
  })

  it('自身旋转参与拾取：45° 旋转立方体在 AABB 角外不可命中', () => {
    let doc = createDocument({ name: 't', format: 'free' })
    const c = createCubeNode('c', { from: [4, 4, 0], to: [12, 12, 16] })
    c.rotation = [0, 0, 45]
    c.origin = [8, 8, 0]
    doc = addNode(doc, c, null)
    // AABB 角内、旋转后几何外 → 不命中
    expect(pickCubes(doc, [11.5, 11.5, -10], [0, 0, 1])).toBeNull()
    // 旋转后几何内 → 命中，t 与世界命中点正确
    const hit = pickCubes(doc, [11.5, 8, -10], [0, 0, 1])!
    expect(hit.distance).toBeCloseTo(10, 9)
    expect(hit.point[0]).toBeCloseTo(11.5, 9)
    expect(hit.point[2]).toBeCloseTo(0, 9)
  })
})

describe('modeler/query documentSummary', () => {
  it('计数、关键帧与包围盒', () => {
    const { doc, ids } = fixture()
    const kf = (t: number) => ({ time: t, value: [0, 0, 0] as Vec3, interpolation: 'linear' as const })
    const anim: ModelAnimation = {
      id: 'a1',
      name: 'anim',
      length: 2,
      loop: 'once',
      channels: { [ids.cube1]: { rotation: [kf(0), kf(1)], position: [kf(0)] } }
    }
    const withAnim: ModelDocument = { ...doc, animations: { a1: anim } }
    const s = documentSummary(withAnim)
    expect(s.cubeCount).toBe(3)
    expect(s.groupCount).toBe(1)
    expect(s.locatorCount).toBe(1)
    expect(s.textureCount).toBe(0)
    expect(s.animationCount).toBe(1)
    expect(s.keyframeCount).toBe(3)
    expect(s.bounds).not.toBeNull()
    expect(s.bounds!.min[2]).toBeCloseTo(0, 9)
    expect(s.bounds!.max[0]).toBeCloseTo(40, 9)
  })

  it('空文档：全 0 计数、bounds null', () => {
    const s = documentSummary(createDocument({ name: 'e', format: 'free' }))
    expect(s.cubeCount).toBe(0)
    expect(s.groupCount).toBe(0)
    expect(s.locatorCount).toBe(0)
    expect(s.animationCount).toBe(0)
    expect(s.keyframeCount).toBe(0)
    expect(s.bounds).toBeNull()
  })
})
