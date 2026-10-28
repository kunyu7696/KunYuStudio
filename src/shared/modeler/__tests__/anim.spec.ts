/**
 * 动画采样纯函数层 golden 测试（P4-a）。
 *
 * 核心不变量：
 * - 关键帧数组：排序稳定、同点位 upsert 替换、删除精确命中；
 * - 时间折返：loop 取模（含负时间）、once/hold 夹取、length ≤ 0 回退 0；
 * - 通道采样：端点夹取、linear 中点、step 阶跃、catmullrom 过关键帧且平滑、
 *   同点位叠帧取后帧；
 * - 整条动画采样：空通道剔除、结果数组不共享输入引用；
 * - 文档级动画 CRUD：新建/重命名/删除、关键帧 upsert/删除与空通道清理、
 *   全程通过 validateDocument 不变量校验。
 */
import { describe, expect, it } from 'vitest'
import {
  resolveAnimTime,
  removeKeyframeAt,
  sampleAnimation,
  sampleChannel,
  sortKeyframes,
  upsertKeyframe
} from '../anim'
import {
  addAnimation,
  createAnimation,
  createCubeNode,
  createDocument,
  createGroupNode,
  addNode,
  patchAnimation,
  removeAnimation,
  removeAnimationKeyframe,
  upsertAnimationKeyframe,
  validateDocument
} from '../document'
import type { Keyframe, ModelAnimation } from '../types'

const kf = (time: number, x: number, y = 0, z = 0, interpolation: Keyframe['interpolation'] = 'linear'): Keyframe => ({
  time,
  value: [x, y, z],
  interpolation
})

describe('sortKeyframes / upsertKeyframe / removeKeyframeAt', () => {
  it('排序按时间升序且不修改入参', () => {
    const input = [kf(1, 10), kf(0, 0), kf(0.5, 5)]
    const sorted = sortKeyframes(input)
    expect(sorted.map((k) => k.time)).toEqual([0, 0.5, 1])
    expect(input.map((k) => k.time)).toEqual([1, 0, 0.5]) // 入参不变
  })

  it('upsert 按时间插入并保持升序', () => {
    let keys = upsertKeyframe([], kf(1, 10))
    keys = upsertKeyframe(keys, kf(0, 0))
    keys = upsertKeyframe(keys, kf(0.5, 5))
    expect(keys.map((k) => k.time)).toEqual([0, 0.5, 1])
  })

  it('upsert 同点位（≤eps）替换值与插值，不新增帧', () => {
    let keys = upsertKeyframe([], kf(0.5, 5))
    keys = upsertKeyframe(keys, kf(0.5 + 1e-5, 99, 0, 0, 'step'))
    expect(keys).toHaveLength(1)
    expect(keys[0]!.value).toEqual([99, 0, 0])
    expect(keys[0]!.interpolation).toBe('step')
  })

  it('upsert 拒绝非法时间与非法数值', () => {
    expect(() => upsertKeyframe([], kf(-1, 0))).toThrow('时间非法')
    expect(() => upsertKeyframe([], kf(Number.NaN, 0))).toThrow('时间非法')
    expect(() => upsertKeyframe([], kf(0, Number.POSITIVE_INFINITY))).toThrow('数值非法')
  })

  it('removeKeyframeAt 精确命中并返回新数组；无命中返回原引用', () => {
    const keys = [kf(0, 0), kf(1, 10)]
    const next = removeKeyframeAt(keys, 1)
    expect(next.map((k) => k.time)).toEqual([0])
    expect(next).not.toBe(keys)
    expect(removeKeyframeAt(keys, 0.7)).toBe(keys)
  })
})

describe('resolveAnimTime 时间折返', () => {
  const base: ModelAnimation = { id: 'a', name: 'a', length: 2, loop: 'loop', channels: {} }

  it('loop 取模循环，负时间向正周期折返', () => {
    expect(resolveAnimTime(base, 0)).toBe(0)
    expect(resolveAnimTime(base, 2.5)).toBe(0.5)
    expect(resolveAnimTime(base, 4)).toBe(0)
    expect(resolveAnimTime(base, -0.5)).toBe(1.5)
  })

  it('once / hold 夹取到 [0, length]', () => {
    const once = { ...base, loop: 'once' as const }
    const hold = { ...base, loop: 'hold' as const }
    for (const a of [once, hold]) {
      expect(resolveAnimTime(a, -1)).toBe(0)
      expect(resolveAnimTime(a, 1)).toBe(1)
      expect(resolveAnimTime(a, 99)).toBe(2)
    }
  })

  it('length ≤ 0 或时间非法时回退 0', () => {
    expect(resolveAnimTime({ ...base, length: 0 }, 1)).toBe(0)
    expect(resolveAnimTime({ ...base, length: -3 }, 1)).toBe(0)
    expect(resolveAnimTime(base, Number.NaN)).toBe(0)
  })
})

describe('sampleChannel 插值采样', () => {
  it('空通道返回 null', () => {
    expect(sampleChannel([], 0)).toBeNull()
  })

  it('端点夹取：首帧前取首帧，末帧后取末帧', () => {
    const keys = [kf(1, 10), kf(3, 30)]
    expect(sampleChannel(keys, 0)).toEqual([10, 0, 0])
    expect(sampleChannel(keys, 99)).toEqual([30, 0, 0])
  })

  it('linear：区间中点取线性插值（逐分量）', () => {
    const keys = [kf(0, 0, 0, 0), kf(2, 10, 20, -4)]
    expect(sampleChannel(keys, 1)).toEqual([5, 10, -2])
    expect(sampleChannel(keys, 0.5)).toEqual([2.5, 5, -1])
  })

  it('step：区间内恒取前帧值', () => {
    const keys = [kf(0, 0, 0, 0, 'step'), kf(2, 10)]
    expect(sampleChannel(keys, 0)).toEqual([0, 0, 0])
    expect(sampleChannel(keys, 1.999)).toEqual([0, 0, 0])
    expect(sampleChannel(keys, 2)).toEqual([10, 0, 0])
  })

  it('catmullrom：精确过关键帧，中间平滑且受邻帧影响', () => {
    const keys = [
      kf(0, 0, 0, 0, 'catmullrom'),
      kf(1, 10, 0, 0, 'catmullrom'),
      kf(2, 0, 0, 0, 'catmullrom'),
      kf(3, -10, 0, 0, 'catmullrom')
    ]
    // 过关键帧（端点与中间帧）
    expect(sampleChannel(keys, 0)![0]).toBeCloseTo(0, 10)
    expect(sampleChannel(keys, 1)![0]).toBeCloseTo(10, 10)
    expect(sampleChannel(keys, 2)![0]).toBeCloseTo(0, 10)
    // 中点：CR 过 (1,10) 与 (2,0)，邻帧 0/-10 → 精确值 6.25（hand-computed）
    expect(sampleChannel(keys, 1.5)![0]).toBeCloseTo(6.25, 10)
    // 与 linear 的差异：0.25 处 CR 受 p0=0 影响，值 ≠ 线性 2.5
    const cr = sampleChannel(keys, 0.25)![0]
    expect(cr).not.toBeCloseTo(2.5, 6)
  })

  it('catmullrom 夹持端点：首段缺 p0 以首帧补齐', () => {
    const keys = [kf(0, 0, 0, 0, 'catmullrom'), kf(1, 10)]
    // p0 = p1 = 0, p2 = 10, p3 = 10（双端夹持）→ t=0.5 时值为 5
    expect(sampleChannel(keys, 0.5)![0]).toBeCloseTo(5, 10)
  })

  it('同点位叠帧：区间内取后帧值', () => {
    const keys = [kf(0, 0), kf(1, 10), kf(1, 20), kf(2, 30)]
    // t=1 落在叠帧区（1,10）→（1,20）之后、（2,30）之前：区间前帧 = 叠帧的后帧 20
    expect(sampleChannel(keys, 1)).toEqual([20, 0, 0])
    // 叠帧区之间（若有） span=0 取后帧；t=1.5 在 (1,20)→(2,30) 线性中点
    expect(sampleChannel(keys, 1.5)).toEqual([25, 0, 0])
  })

  it('未排序输入内部先排序', () => {
    const keys = [kf(2, 20), kf(0, 0), kf(1, 10)]
    expect(sampleChannel(keys, 0.5)).toEqual([5, 0, 0])
  })

  it('返回新数组，不共享输入引用', () => {
    const keys = [kf(0, 1)]
    const v = sampleChannel(keys, 0)!
    v[0] = 999
    expect(keys[0]!.value[0]).toBe(1)
  })
})

describe('sampleAnimation 整条采样', () => {
  const anim: ModelAnimation = {
    id: 'anim-1',
    name: 'idle',
    length: 2,
    loop: 'loop',
    channels: {
      body: {
        rotation: [kf(0, 0), kf(2, 10)],
        position: [kf(0, 0, 1, 0)]
      },
      head: { scale: [] }, // 空通道 → 剔除
      leg: {} // 无通道 → 剔除
    }
  }

  it('按节点产出三通道，空通道/无通道节点剔除', () => {
    const out = sampleAnimation(anim, 1)
    expect(out.has('body')).toBe(true)
    expect(out.has('head')).toBe(false)
    expect(out.has('leg')).toBe(false)
    const body = out.get('body')!
    expect(body.rotation).toEqual([5, 0, 0])
    expect(body.position).toEqual([0, 1, 0]) // 单帧 → 恒值
    expect(body.scale).toBeUndefined()
  })

  it('loop 时间折返后采样', () => {
    const out = sampleAnimation(anim, 3) // 折返到 1
    expect(out.get('body')!.rotation).toEqual([5, 0, 0])
  })
})

describe('文档级动画 CRUD', () => {
  function docWithBone() {
    let doc = createDocument({ name: 't', format: 'bedrock_entity', now: 1000 })
    const bone = createGroupNode('body')
    doc = addNode(doc, bone, null)
    const cube = createCubeNode('c')
    doc = addNode(doc, cube, bone.id)
    return { doc, bone, cube }
  }

  it('新建/重命名/改时长循环/删除，全程通过不变量校验', () => {
    let { doc } = docWithBone()
    const anim = createAnimation('idle', { length: 1.5, loop: 'once' })
    doc = addAnimation(doc, anim)
    expect(doc.animations[anim.id]!.length).toBe(1.5)
    expect(doc.animations[anim.id]!.loop).toBe('once')

    doc = patchAnimation(doc, anim.id, { name: 'walk', loop: 'loop' })
    expect(doc.animations[anim.id]!.name).toBe('walk')

    doc = removeAnimation(doc, anim.id)
    expect(doc.animations[anim.id]).toBeUndefined()
    expect(validateDocument(doc)).toEqual([])
    // 未知 id 为 no-op
    expect(removeAnimation(doc, 'nope')).toBe(doc)
    expect(patchAnimation(doc, 'nope', { name: 'x' })).toBe(doc)
  })

  it('addAnimation 重复 id 抛错', () => {
    let { doc } = docWithBone()
    const anim = createAnimation('idle')
    doc = addAnimation(doc, anim)
    expect(() => addAnimation(doc, anim)).toThrow('已存在')
  })

  it('upsertAnimationKeyframe 自动建通道并排序；删除后清理空通道与空节点条目', () => {
    let { doc, bone } = docWithBone()
    const anim = createAnimation('idle')
    doc = addAnimation(doc, anim)

    doc = upsertAnimationKeyframe(doc, anim.id, bone.id, 'rotation', kf(1, 10))
    doc = upsertAnimationKeyframe(doc, anim.id, bone.id, 'rotation', kf(0, 0))
    let channels = doc.animations[anim.id]!.channels[bone.id]!
    expect(channels.rotation!.map((k) => k.time)).toEqual([0, 1])
    expect(validateDocument(doc)).toEqual([])

    // 同点位替换
    doc = upsertAnimationKeyframe(doc, anim.id, bone.id, 'rotation', kf(0, 5))
    channels = doc.animations[anim.id]!.channels[bone.id]!
    expect(channels.rotation!).toHaveLength(2)
    expect(channels.rotation![0]!.value).toEqual([5, 0, 0])

    // 删空通道 → 节点条目一并移除
    doc = removeAnimationKeyframe(doc, anim.id, bone.id, 'rotation', 0)
    doc = removeAnimationKeyframe(doc, anim.id, bone.id, 'rotation', 1)
    expect(doc.animations[anim.id]!.channels[bone.id]).toBeUndefined()
    expect(validateDocument(doc)).toEqual([])
  })

  it('upsert/remove 对未知动画或节点抛错；删除无匹配帧为 no-op', () => {
    let { doc, bone } = docWithBone()
    const anim = createAnimation('idle')
    doc = addAnimation(doc, anim)
    expect(() => upsertAnimationKeyframe(doc, 'nope', bone.id, 'rotation', kf(0, 0))).toThrow('不存在')
    expect(() => upsertAnimationKeyframe(doc, anim.id, 'nope', 'rotation', kf(0, 0))).toThrow('不存在')
    expect(() => removeAnimationKeyframe(doc, 'nope', bone.id, 'rotation', 0)).toThrow('不存在')
    const before = doc
    const after = removeAnimationKeyframe(doc, anim.id, bone.id, 'rotation', 0)
    expect(after).toBe(before) // 通道不存在 → 原样返回
  })
})
