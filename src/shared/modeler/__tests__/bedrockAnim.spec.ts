/**
 * .animation.json 编解码 golden 测试（P4-b）。
 *
 * 核心不变量：
 * - 导出→导入 往返全等：三通道关键帧值/插值/loop 三态/animation_length/
 *   动画全名（animation.<ns>.<name>）逐项不丢；骨骼名映射与几何导出同源；
 * - 旋转语义与几何一致（Bedrock X/Y 取反，Z 不变）；
 * - step 插值经对象形 lerp_mode + pre 续值编码，自有文件往返无损且静默；
 * - 超集内容逐条告警：molang 关键帧、pre/post 不连续跳变、未知骨骼、
 *   非骨骼通道目标、重名骨骼。
 */
import { describe, expect, it } from 'vitest'
import {
  addAnimation,
  addNode,
  createAnimation,
  createCubeNode,
  createGroupNode,
  upsertAnimationKeyframe,
  validateDocument
} from '../document'
import { documentToGeo, geoToDocument } from '../formats/bedrock'
import type { BedrockGeoJson } from '../formats/bedrock'
import { documentToAnimations, mergeAnimationsIntoDocument } from '../formats/bedrockAnim'
import type { BedrockAnimationFileJson } from '../formats/bedrockAnim'
import type { ModelDocument } from '../types'

/** 基准几何：body→head 两骨骼 + body 下一个立方体 */
function baseGeo(): BedrockGeoJson {
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: { identifier: 'geometry.kunyu.beast', texture_width: 64, texture_height: 64 },
        bones: [
          { name: 'body', pivot: [0, 12, 0], cubes: [{ origin: [-4, 0, -2], size: [8, 12, 4], uv: [0, 0] }] },
          { name: 'head', parent: 'body', pivot: [0, 24, 0] }
        ]
      }
    ]
  }
}

function baseDoc(): ModelDocument {
  return geoToDocument(baseGeo(), { now: 1000 }).doc
}

/** 基准动画文件：idle(loop/catmullrom) + attack(once/对象形混合) + hold 示例 */
function baseAnimFile(): BedrockAnimationFileJson {
  return {
    format_version: '1.8.0',
    animations: {
      'animation.kunyu.beast.idle': {
        loop: true,
        animation_length: 2,
        bones: {
          body: {
            lerp_mode: 'catmullrom',
            rotation: { '0': [0, 0, 0], '1': [4, 0, 0], '2': [0, 0, 0] },
            position: { '0': [0, 0, 0], '1': [0, -0.4, 0], '2': [0, 0, 0] }
          },
          head: { rotation: { '0': [0, 0, 0], '0.5': [-10, 5, 0] } }
        }
      },
      'animation.kunyu.beast.attack': {
        animation_length: 0.5,
        bones: {
          body: {
            rotation: {
              '0': [0, 0, 0],
              '0.2': { post: [-45, 0, 0], lerp_mode: 'linear' },
              '0.35': { post: [10, 0, 0], lerp_mode: 'catmullrom' },
              '0.5': [0, 0, 0]
            }
          }
        }
      },
      'animation.kunyu.beast.pose': {
        loop: 'hold_on_last_frame',
        bones: { head: { scale: { '0': [1, 1, 1], '1': [1.5, 1.5, 1.5] } } }
      }
    }
  }
}

describe('mergeAnimationsIntoDocument 导入', () => {
  it('三通道/三态 loop/长度/旋转取反/插值逐项落地，文档通过不变量校验', () => {
    const doc = baseDoc()
    const { doc: next, downgrades } = mergeAnimationsIntoDocument(baseAnimFile(), doc)
    expect(validateDocument(next)).toEqual([])
    expect(downgrades).toEqual([])

    const anims = Object.values(next.animations)
    expect(anims).toHaveLength(3)
    const byName = new Map(anims.map((a) => [a.name, a]))

    const idle = byName.get('animation.kunyu.beast.idle')!
    expect(idle.loop).toBe('loop')
    expect(idle.length).toBe(2)
    const body = idle.channels['body']!
    // 通道级 catmullrom → 所有简写帧均为 catmullrom
    expect(body.rotation!.map((k) => [k.time, k.value[0]])).toEqual([
      [0, 0],
      [1, -4], // Bedrock X 取反
      [2, 0]
    ])
    expect(body.rotation!.every((k) => k.interpolation === 'catmullrom')).toBe(true)
    expect(body.position!.map((k) => [k.time, k.value[1]])).toEqual([
      [0, 0],
      [1, -0.4], // position 直通
      [2, 0]
    ])
    const head = idle.channels['head']!
    expect(head.rotation![1]!.value).toEqual([10, -5, 0]) // X/Y 取反，Z 不变

    const attack = byName.get('animation.kunyu.beast.attack')!
    expect(attack.loop).toBe('once') // loop 缺省 = 播放一次
    expect(attack.length).toBe(0.5)
    const atkBody = attack.channels['body']!
    expect(atkBody.rotation!.map((k) => [k.time, k.value[0], k.interpolation])).toEqual([
      [0, 0, 'linear'],
      [0.2, 45, 'linear'], // 对象形 post + lerp_mode linear；X 取反
      [0.35, -10, 'catmullrom'],
      [0.5, 0, 'linear']
    ])

    const pose = byName.get('animation.kunyu.beast.pose')!
    expect(pose.loop).toBe('hold') // hold_on_last_frame → hold
    expect(pose.length).toBe(1) // 无 animation_length → 取最大关键帧时间
    expect(pose.channels['head']!.scale![1]!.value).toEqual([1.5, 1.5, 1.5])
  })

  it('未知骨骼跳过通道并告警；molang/非法关键帧跳过并告警', () => {
    const doc = baseDoc()
    const file: BedrockAnimationFileJson = {
      format_version: '1.8.0',
      animations: {
        'animation.kunyu.beast.bad': {
          bones: {
            wing: { rotation: { '0': [0, 0, 0] } }, // 不存在
            body: {
              rotation: {
                '0': 'math.sin(query.anim_time)',
                '1': { post: ['query.x', 0, 0] },
                t: [10, 0, 0] // 非法时间键被静默过滤
              } as never
            }
          }
        }
      }
    }
    const { doc: next, downgrades } = mergeAnimationsIntoDocument(file, doc)
    expect(validateDocument(next)).toEqual([])
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('bone_missing')
    expect(codes).toContain('keyframe_molang')
    expect(codes).toContain('keyframe_invalid')
    const anim = Object.values(next.animations)[0]!
    expect(anim.channels['body']).toBeUndefined() // 全被跳过 → 无通道
  })

  it('pre≠post 的外来不连续跳变：取 post 并告警；重名骨骼挂首个并告警', () => {
    let doc = baseDoc()
    const dup = createGroupNode('body') // 与导入的 body 重名
    doc = addNode(doc, dup, null)
    const file: BedrockAnimationFileJson = {
      format_version: '1.8.0',
      animations: {
        'animation.x.jump': {
          bones: { body: { rotation: { '0': { pre: [0, 0, 0], post: [90, 0, 0] } } } }
        }
      }
    }
    const { doc: next, downgrades } = mergeAnimationsIntoDocument(file, doc)
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('duplicate_bone_name')
    expect(codes).toContain('keyframe_discontinuous')
    const anim = Object.values(next.animations)[0]!
    // 首个同名 body（几何导入的），值 = post 经 X 取反
    expect(anim.channels['body']!.rotation![0]!.value).toEqual([-90, 0, 0])
  })

  it('非法输入抛错', () => {
    const doc = baseDoc()
    expect(() => mergeAnimationsIntoDocument('{bad json', doc)).toThrow('解析失败')
    expect(() => mergeAnimationsIntoDocument({}, doc)).toThrow('animations')
  })
})

describe('documentToAnimations 导出', () => {
  it('loop 三态/长度/命名空间/旋转取反/通道级 lerp_mode 正确编码', () => {
    const { doc } = (() => {
      const d = mergeAnimationsIntoDocument(baseAnimFile(), baseDoc())
      return { doc: d.doc }
    })()
    const { output, downgrades } = documentToAnimations(doc)
    expect(downgrades).toEqual([])
    expect(output.format_version).toBe('1.8.0')

    // 命名空间缺省派生自 identifier：geometry.kunyu.beast → kunyu.beast
    const idle = output.animations['animation.kunyu.beast.idle']!
    expect(idle.loop).toBe(true)
    expect(idle.animation_length).toBe(2)
    expect(idle.bones!.body!.lerp_mode).toBe('catmullrom')
    expect(idle.bones!.body!.rotation!['1']).toEqual([4, 0, 0]) // 导出回 Bedrock 空间
    expect(idle.bones!.body!.position!['1']).toEqual([0, -0.4, 0])

    const attack = output.animations['animation.kunyu.beast.attack']!
    expect(attack.loop).toBeUndefined() // once → 省略 loop 字段
    const atkRot = attack.bones!.body!.rotation!
    // 混合插值 → 全通道对象形；linear 帧省略 lerp_mode 字段
    expect(atkRot['0']).toEqual({ post: [0, 0, 0] })
    expect(atkRot['0.2']).toEqual({ post: [-45, 0, 0] })
    expect(atkRot['0.35']).toEqual({ post: [10, 0, 0], lerp_mode: 'catmullrom' })

    const pose = output.animations['animation.kunyu.beast.pose']!
    expect(pose.loop).toBe('hold_on_last_frame')
  })

  it('显式 namespace 覆盖缺省派生；短名自动补全 animation.<ns>. 前缀', () => {
    let doc = baseDoc()
    let anim = createAnimation('walk', { length: 1, loop: 'loop' })
    anim = { ...anim, name: 'walk' }
    doc = addAnimation(doc, anim)
    doc = upsertAnimationKeyframe(doc, anim.id, 'body', 'rotation', { time: 0, value: [0, 0, 0], interpolation: 'linear' })
    const { output } = documentToAnimations(doc, { namespace: 'my_mod' })
    expect(Object.keys(output.animations)).toEqual(['animation.my_mod.walk'])
  })

  it('step 插值：对象形 lerp_mode=step + 下一帧 pre 续值，往返无损且静默', () => {
    let doc = baseDoc()
    const anim = createAnimation('blink', { length: 1, loop: 'once' })
    doc = addAnimation(doc, anim)
    doc = upsertAnimationKeyframe(doc, anim.id, 'head', 'rotation', { time: 0, value: [0, 0, 0], interpolation: 'step' })
    doc = upsertAnimationKeyframe(doc, anim.id, 'head', 'rotation', { time: 0.5, value: [30, 0, 0], interpolation: 'step' })
    doc = upsertAnimationKeyframe(doc, anim.id, 'head', 'rotation', { time: 1, value: [0, 0, 0], interpolation: 'linear' })

    const { output, downgrades } = documentToAnimations(doc)
    expect(downgrades).toEqual([])
    const rot = output.animations['animation.kunyu.beast.blink']!.bones!.head!.rotation!
    expect(rot['0']).toEqual({ post: [0, 0, 0], lerp_mode: 'step' })
    // 下一帧 pre 续 step 帧值（Bedrock 保持语义）
    expect(rot['0.5']).toEqual({ pre: [0, 0, 0], post: [-30, 0, 0], lerp_mode: 'step' })
    expect(rot['1']).toEqual({ pre: [-30, 0, 0], post: [0, 0, 0] })

    // 往返：step 标记与续值静默还原，插值与值逐项全等
    const back = mergeAnimationsIntoDocument(output, baseDoc())
    expect(back.downgrades).toEqual([])
    const animBack = Object.values(back.doc.animations)[0]!
    const keys = animBack.channels['head']!.rotation!
    expect(keys.map((k) => [k.time, k.value[0], k.interpolation])).toEqual([
      [0, 0, 'step'],
      [0.5, 30, 'step'],
      [1, 0, 'linear']
    ])
  })

  it('非骨骼通道目标跳过并告警；重名骨骼与几何导出同名映射', () => {
    let doc = baseDoc()
    const dup = createGroupNode('body') // 重名骨骼
    doc = addNode(doc, dup, null)
    const cube = createCubeNode('free-cube') // 非骨骼节点
    doc = addNode(doc, cube, null)
    const anim = createAnimation('x', { length: 1 })
    doc = addAnimation(doc, anim)
    doc = upsertAnimationKeyframe(doc, anim.id, cube.id, 'position', { time: 0, value: [0, 1, 0], interpolation: 'linear' })
    doc = upsertAnimationKeyframe(doc, anim.id, dup.id, 'rotation', { time: 0, value: [10, 0, 0], interpolation: 'linear' })

    const { output, downgrades } = documentToAnimations(doc)
    expect(downgrades.map((d) => d.code)).toEqual(['channel_target_not_bone'])
    const bones = output.animations['animation.kunyu.beast.x']!.bones!
    // 重名 body → 第二个改名 body_2，与几何导出同源
    expect(Object.keys(bones)).toEqual(['body_2'])
    const geo = documentToGeo(doc).output
    const geoNames = (geo['minecraft:geometry']![0]!.bones ?? []).map((b) => b.name)
    expect(geoNames).toContain('body_2')
  })
})

describe('导出→导入 往返全等', () => {
  it('基准三动画全量往返：loop/长度/通道/插值/值逐项一致', () => {
    const doc0 = baseDoc()
    const once = mergeAnimationsIntoDocument(baseAnimFile(), doc0).doc
    const { output, downgrades } = documentToAnimations(once)
    expect(downgrades).toEqual([])
    const twice = mergeAnimationsIntoDocument(output, baseDoc()).doc

    const a = Object.values(once.animations)
    const b = Object.values(twice.animations)
    expect(a.map((x) => x.name).sort()).toEqual(b.map((x) => x.name).sort())
    for (const animA of a) {
      const animB = b.find((x) => x.name === animA.name)!
      expect(animB.loop).toBe(animA.loop)
      expect(animB.length).toBe(animA.length)
      for (const [nodeId, chA] of Object.entries(animA.channels)) {
        const chB = animB.channels[nodeId]!
        for (const channel of ['rotation', 'position', 'scale'] as const) {
          expect(chB[channel] ?? []).toEqual(chA[channel] ?? [])
        }
      }
    }
  })
})
