/**
 * 关键帧 Bezier 缓动测试（B1-1 曲线编辑器，v2）。
 *
 * 核心不变量：
 * - applyEasing：恒等/端点直通；easeIn 前半慢、easeOut 前半快、easeInOut 中点 0.5；
 *   回弹预设存在 y>1 过冲区间；t 非法/越界原样返回；
 * - normalizeEasing：x 夹取 [0,1]、y 夹取 [-4,4]、非有限值回退下界；
 * - 采样集成：easing 仅对 linear 区间生效（catmullrom/step 忽略）；easing 经
 *   upsertKeyframe / 文档层 upsertAnimationKeyframe 保留；
 * - 导出降级：bedrockAnim / bbmodel 导出含非恒等 easing 的通道时逐条告警（easing_dropped）。
 */
import { describe, expect, it } from 'vitest'
import {
  applyEasing,
  EASING_PRESETS,
  isIdentityEasing,
  matchEasingPreset,
  normalizeEasing,
  sampleEasingCurve
} from '../curve'
import { sampleChannel, upsertKeyframe } from '../anim'
import { addAnimation, addNode, createAnimation, createDocument, createGroupNode, upsertAnimationKeyframe } from '../document'
import { documentToAnimations } from '../formats/bedrockAnim'
import { documentToBbmodel } from '../formats/bbmodel'
import type { Keyframe } from '../types'

const easeIn = { cp: [...EASING_PRESETS.easeIn] as [number, number, number, number] }
const easeOut = { cp: [...EASING_PRESETS.easeOut] as [number, number, number, number] }
const easeInOut = { cp: [...EASING_PRESETS.easeInOut] as [number, number, number, number] }
const easeOutBack = { cp: [...EASING_PRESETS.easeOutBack] as [number, number, number, number] }

describe('applyEasing', () => {
  it('无 easing / 端点原样直通', () => {
    expect(applyEasing(undefined, 0.37)).toBe(0.37)
    expect(applyEasing(easeIn, 0)).toBe(0)
    expect(applyEasing(easeIn, 1)).toBe(1)
    expect(applyEasing(easeIn, -0.2)).toBe(-0.2)
    expect(applyEasing(easeIn, 1.2)).toBe(1.2)
  })

  it('linear 预设是恒等映射', () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(applyEasing({ cp: [...EASING_PRESETS.linear] }, t)).toBeCloseTo(t, 5)
    }
  })

  it('easeIn 前半慢 / easeOut 前半快 / easeInOut 中点对称', () => {
    expect(applyEasing(easeIn, 0.25)).toBeLessThan(0.15)
    expect(applyEasing(easeOut, 0.25)).toBeGreaterThan(0.33)
    expect(applyEasing(easeInOut, 0.5)).toBeCloseTo(0.5, 5)
  })

  it('回弹预设存在 y>1 过冲区间', () => {
    const curve = sampleEasingCurve(easeOutBack, 48)
    expect(curve.some(([, y]) => y > 1)).toBe(true)
    // 端点仍然钉在 0/1
    expect(curve[0]![1]).toBe(0)
    expect(curve[curve.length - 1]![1]).toBe(1)
  })
})

describe('normalizeEasing / isIdentityEasing / matchEasingPreset', () => {
  it('x 夹取 [0,1]，y 夹取 [-4,4]，非有限回退', () => {
    const n = normalizeEasing([-1, 99, 2, Number.NaN])
    expect(n.cp).toEqual([0, 4, 1, -4])
  })

  it('恒等判定：undefined / linear 预设为恒等，easeIn 不是', () => {
    expect(isIdentityEasing(undefined)).toBe(true)
    expect(isIdentityEasing({ cp: [...EASING_PRESETS.linear] })).toBe(true)
    expect(isIdentityEasing(easeIn)).toBe(false)
  })

  it('预设匹配：精确命中返回名字，自定义返回 null', () => {
    expect(matchEasingPreset(easeOut.cp)).toBe('easeOut')
    expect(matchEasingPreset([0.1, 0.2, 0.3, 0.4])).toBe(null)
  })
})

describe('easing 集成：通道采样', () => {
  const linearKeys: Keyframe[] = [
    { time: 0, value: [0, 0, 0], interpolation: 'linear' },
    { time: 1, value: [10, 10, 10], interpolation: 'linear' }
  ]

  it('linear + easeIn：前段值低于线性', () => {
    const keys = upsertKeyframe(linearKeys, { ...linearKeys[0]!, easing: easeIn })
    const v = sampleChannel(keys, 0.25)!
    // 线性应为 2.5；easeIn 后显著更小
    expect(v[0]).toBeLessThan(1.5)
    expect(v[0]).toBeGreaterThan(0)
  })

  it('catmullrom 区间忽略 easing', () => {
    const keys: Keyframe[] = [
      { time: 0, value: [0, 0, 0], interpolation: 'catmullrom', easing: easeIn },
      { time: 1, value: [10, 10, 10], interpolation: 'catmullrom' }
    ]
    const withEasing = sampleChannel(keys, 0.5)!
    const withoutEasing = sampleChannel(keys.map((k) => ({ ...k, easing: undefined })), 0.5)!
    expect(withEasing[0]).toBeCloseTo(withoutEasing[0], 10)
  })

  it('step 区间忽略 easing', () => {
    const keys: Keyframe[] = [
      { time: 0, value: [0, 0, 0], interpolation: 'step', easing: easeIn },
      { time: 1, value: [10, 10, 10], interpolation: 'linear' }
    ]
    expect(sampleChannel(keys, 0.999)![0]).toBe(0)
  })

  it('easing 经 upsertKeyframe 与文档层 upsertAnimationKeyframe 保留', () => {
    const keys = upsertKeyframe([], { time: 0, value: [0, 0, 0], interpolation: 'linear', easing: easeInOut })
    expect(keys[0]!.easing).toEqual(easeInOut)
    // 深拷贝：改输入不影响已存帧
    ;(easeInOut.cp[0] as number) = 9
    expect(keys[0]!.easing!.cp[0]).toBeCloseTo(0.42)

    let doc = createDocument({ name: 't', format: 'free' })
    const bone = createGroupNode('bone')
    doc = addNode(doc, bone, null)
    const anim = createAnimation('a')
    doc = addAnimation(doc, anim)
    doc = upsertAnimationKeyframe(doc, anim.id, bone.id, 'rotation', {
      time: 0,
      value: [0, 0, 0],
      interpolation: 'linear',
      easing: { cp: [0.42, 0, 0.58, 1] }
    })
    expect(doc.animations[anim.id]!.channels[bone.id]!.rotation![0]!.easing).toEqual({ cp: [0.42, 0, 0.58, 1] })
  })
})

describe('easing 导出降级告警', () => {
  function docWithEasing() {
    let doc = createDocument({ name: 't', format: 'geckolib' })
    const bone = createGroupNode('bone')
    doc = addNode(doc, bone, null)
    const anim = createAnimation('walk')
    doc = addAnimation(doc, anim)
    doc = upsertAnimationKeyframe(doc, anim.id, bone.id, 'rotation', {
      time: 0,
      value: [0, 0, 0],
      interpolation: 'linear',
      easing: { cp: [0.42, 0, 1, 1] }
    })
    doc = upsertAnimationKeyframe(doc, anim.id, bone.id, 'rotation', {
      time: 1,
      value: [10, 0, 0],
      interpolation: 'linear'
    })
    return doc
  }

  it('bedrockAnim 导出：含 easing 的通道逐条告警，数值仍按线性导出', () => {
    const { output, downgrades } = documentToAnimations(docWithEasing())
    expect(downgrades.some((d) => d.code === 'easing_dropped')).toBe(true)
    const animJson = Object.values(output.animations)[0]!
    expect(animJson.bones!['bone']!.rotation).toBeDefined()
  })

  it('bbmodel 导出：含 easing 的通道逐条告警', () => {
    const { downgrades } = documentToBbmodel(docWithEasing())
    expect(downgrades.some((d) => d.code === 'easing_dropped')).toBe(true)
  })

  it('恒等 easing 不触发告警', () => {
    let doc = createDocument({ name: 't', format: 'geckolib' })
    const bone = createGroupNode('bone')
    doc = addNode(doc, bone, null)
    const anim = createAnimation('idle')
    doc = addAnimation(doc, anim)
    doc = upsertAnimationKeyframe(doc, anim.id, bone.id, 'rotation', {
      time: 0,
      value: [0, 0, 0],
      interpolation: 'linear',
      easing: { cp: [0, 0, 1, 1] }
    })
    doc = upsertAnimationKeyframe(doc, anim.id, bone.id, 'rotation', {
      time: 1,
      value: [5, 0, 0],
      interpolation: 'linear'
    })
    const { downgrades } = documentToAnimations(doc)
    expect(downgrades.filter((d) => d.code === 'easing_dropped')).toEqual([])
  })
})
