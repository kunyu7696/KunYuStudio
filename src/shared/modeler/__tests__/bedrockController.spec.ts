/**
 * Bedrock 动画控制器编解码测试（B5-2，v2）。
 *
 * 核心不变量：
 * - 导出结构：format_version 1.10.0、controller.animation.<ns>.<name> 键、
 *   状态 animations 引用 Bedrock 动画名（与 bedrockAnim 同命名规则）、
 *   initial_state 与按表序的 transitions；
 * - 条件映射：always/is_moving/is_attacking/is_hurt → 四个规范 molang 形；
 * - 降级：无控制器 / 多控制器仅导首个 / 引用动画缺失跳状态 / 端点缺失跳转移；
 * - 导入：动画名解析（全名 + 裸短名后缀）、molang 反向映射（空白归一）、
 *   upsert 置顶为激活控制器、未知表达式/端点缺失/附加字段逐条告警；
 * - 语义往返：导出 → 导入，状态与转移（含条件）无损，名称落为 Bedrock 键。
 */
import { describe, expect, it } from 'vitest'
import { upsertController } from '../controller'
import { addAnimation, createAnimation, createDocument } from '../document'
import { documentToAnimationControllers, mergeControllerIntoDocument } from '../formats/bedrockController'
import type { ModelDocument, ModelAnimationController } from '../types'

function docWithAnims(): ModelDocument {
  let doc = createDocument({ name: 't', format: 'geckolib' })
  doc = addAnimation(doc, createAnimation('idle'))
  doc = addAnimation(doc, createAnimation('walk'))
  return doc
}

/** 动画名已是 Bedrock 全名（animation.kunyu.<name>）的文档：覆盖短名后缀解析 */
function docWithFullAnims(): ModelDocument {
  let doc = createDocument({ name: 't', format: 'geckolib' })
  doc = addAnimation(doc, createAnimation('animation.kunyu.idle'))
  doc = addAnimation(doc, createAnimation('animation.kunyu.walk'))
  return doc
}

function bedrockDoc(doc: ModelDocument): ModelDocument {
  return { ...doc, formatData: { ...doc.formatData, bedrock: { identifier: 'geometry.kunyu:demo' } } }
}

function idleWalkCtrl(doc: ModelDocument, name = 'controller'): ModelAnimationController {
  const [idle, walk] = Object.values(doc.animations)
  return {
    name,
    initialState: 'idle',
    states: [
      { name: 'idle', animation: idle!.id },
      { name: 'walk', animation: walk!.id }
    ],
    transitions: [
      { from: 'idle', to: 'walk', condition: 'is_moving' },
      { from: 'walk', to: 'idle', condition: 'always' }
    ]
  }
}

describe('导出', () => {
  it('结构：1.10.0 + controller.animation.<ns>.<name> + 状态动画名 + 转移 molang', () => {
    let doc = bedrockDoc(docWithAnims())
    doc = upsertController(doc, idleWalkCtrl(doc))
    const { output, downgrades } = documentToAnimationControllers(doc)
    expect(downgrades).toEqual([])
    expect(output.format_version).toBe('1.10.0')
    const [key, ctrl] = Object.entries(output.animation_controllers)[0]!
    expect(key).toBe('controller.animation.kunyu_demo.controller')
    expect(ctrl.initial_state).toBe('idle')
    expect(ctrl.states).toEqual({
      idle: { animations: ['animation.kunyu_demo.idle'], transitions: [{ walk: 'query.is_moving' }] },
      walk: { animations: ['animation.kunyu_demo.walk'], transitions: [{ idle: '1.0' }] }
    })
  })

  it('四个条件谓词 → 规范 molang 形', () => {
    let doc = docWithAnims()
    doc = addAnimation(doc, createAnimation('attack'))
    doc = addAnimation(doc, createAnimation('hurt'))
    const [idle, walk, attack, hurt] = Object.values(doc.animations)
    doc = upsertController(doc, {
      name: 'c',
      initialState: 'idle',
      states: [
        { name: 'idle', animation: idle!.id },
        { name: 'walk', animation: walk!.id },
        { name: 'attack', animation: attack!.id },
        { name: 'hurt', animation: hurt!.id }
      ],
      transitions: [
        { from: 'idle', to: 'walk', condition: 'is_moving' },
        { from: 'walk', to: 'attack', condition: 'is_attacking' },
        { from: 'attack', to: 'hurt', condition: 'is_hurt' },
        { from: 'hurt', to: 'idle', condition: 'always' }
      ]
    })
    const { output } = documentToAnimationControllers(doc)
    const ctrl = Object.values(output.animation_controllers)[0]!
    expect(ctrl.states!.idle!.transitions).toEqual([{ walk: 'query.is_moving' }])
    expect(ctrl.states!.walk!.transitions).toEqual([{ attack: 'variable.attack_time > 0' }])
    expect(ctrl.states!.attack!.transitions).toEqual([{ hurt: 'query.hurt_time > 0' }])
    expect(ctrl.states!.hurt!.transitions).toEqual([{ idle: '1.0' }])
  })

  it('控制器/动画名含点 → 键直用；多控制器仅导首个（info）', () => {
    let doc = docWithAnims()
    doc = upsertController(doc, idleWalkCtrl(doc, 'my.ctrl'))
    doc = upsertController(doc, { ...idleWalkCtrl(doc), name: 'second' })
    const { output, downgrades } = documentToAnimationControllers(doc)
    expect(Object.keys(output.animation_controllers)).toEqual(['my.ctrl'])
    expect(downgrades.some((d) => d.code === 'only_first_controller' && d.severity === 'info')).toBe(true)
  })

  it('降级：引用动画缺失跳状态并连带跳转移；无控制器 → info + 空产物', () => {
    let doc = docWithAnims()
    const ghost: ModelAnimationController = {
      name: 'c',
      initialState: 'idle',
      states: [{ name: 'idle', animation: 'missing' }],
      transitions: [{ from: 'idle', to: 'walk', condition: 'always' }]
    }
    doc = upsertController(doc, ghost)
    const { output, downgrades } = documentToAnimationControllers(doc)
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('state_animation_missing')
    expect(codes).toContain('transition_endpoint_missing')
    expect(codes).toContain('initial_state_missing')
    const ctrl = Object.values(output.animation_controllers)[0]!
    expect(ctrl.states).toEqual({})
    expect(ctrl.initial_state).toBeUndefined()

    const empty = documentToAnimationControllers(docWithAnims())
    expect(empty.output.animation_controllers).toEqual({})
    expect(empty.downgrades.map((d) => d.code)).toEqual(['no_controller'])
  })
})

describe('导入', () => {
  const FILE = {
    format_version: '1.10.0',
    animation_controllers: {
      'controller.animation.kunyu.demo': {
        initial_state: 'idle',
        states: {
          idle: { animations: ['animation.kunyu.idle'], transitions: [{ walk: 'query.is_moving' }] },
          walk: { animations: ['walk'], transitions: [{ idle: ' 1.0 ' }] }
        }
      },
      'controller.animation.other': { states: { a: { animations: ['animation.kunyu.idle'] } } }
    }
  }

  it('解析：全名/裸短名动画、molang 空白归一、upsert 置顶、多余条目 info', () => {
    let doc = docWithFullAnims()
    doc = upsertController(doc, { name: 'old', initialState: 's', states: [], transitions: [] })
    const { doc: merged, downgrades } = mergeControllerIntoDocument(FILE, doc)
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('only_first_controller')
    const list = merged.formatData?.controllers as ModelAnimationController[]
    expect(list).toHaveLength(2)
    expect(list[0]!.name).toBe('controller.animation.kunyu.demo')
    expect(list[1]!.name).toBe('old')
    expect(list[0]!.initialState).toBe('idle')
    const [fullIdle, fullWalk] = Object.values(merged.animations)
    // idle 按全名精确命中；walk 按裸短名后缀命中
    expect(list[0]!.states).toEqual([
      { name: 'idle', animation: fullIdle!.id },
      { name: 'walk', animation: fullWalk!.id }
    ])
    expect(list[0]!.transitions).toEqual([
      { from: 'idle', to: 'walk', condition: 'is_moving' },
      { from: 'walk', to: 'idle', condition: 'always' }
    ])
  })

  it('降级：未知 molang / 端点未导入 / 动画缺失 / 附加字段 / initial_state 兜底', () => {
    const doc = docWithAnims()
    const { doc: merged, downgrades } = mergeControllerIntoDocument(
      {
        format_version: '1.10.0',
        animation_controllers: {
          c: {
            initial_state: 'ghost',
            states: {
              idle: {
                animations: ['animation.kunyu.idle'],
                on_entry: ['/say hi'],
                transitions: [{ walk: 'query.is_moving' }, { sit: 'query.all_animations_finished' }]
              },
              walk: { animations: ['missing-anim'] },
              sit: { animations: ['animation.kunyu.walk'] }
            }
          }
        }
      },
      doc
    )
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('condition_unsupported')
    expect(codes).toContain('state_animation_missing')
    expect(codes).toContain('state_extras_dropped')
    expect(codes).toContain('initial_state_missing')
    expect(codes).toContain('transition_endpoint_missing')
    const ctrl = (merged.formatData?.controllers as ModelAnimationController[])[0]!
    expect(ctrl.initialState).toBe('idle')
    expect(ctrl.transitions).toEqual([])
    const [idle, walk] = Object.values(doc.animations)
    expect(ctrl.states).toEqual([
      { name: 'idle', animation: idle!.id },
      { name: 'sit', animation: walk!.id }
    ])
  })

  it('非法输入：坏 JSON / 缺 animation_controllers 抛错；空产物原样返回', () => {
    const doc = docWithAnims()
    expect(() => mergeControllerIntoDocument('{oops', doc)).toThrow()
    expect(() => mergeControllerIntoDocument({ format_version: '1.10.0' }, doc)).toThrow()
    const empty = mergeControllerIntoDocument({ format_version: '1.10.0', animation_controllers: {} }, doc)
    expect(empty.doc).toBe(doc)
    expect(empty.downgrades.map((d) => d.code)).toEqual(['no_controller'])
  })
})

describe('语义往返', () => {
  it('导出 → 导入：状态与转移无损（名称落为 Bedrock 键）', () => {
    let doc = bedrockDoc(docWithAnims())
    const original = idleWalkCtrl(doc)
    doc = upsertController(doc, original)
    const { output } = documentToAnimationControllers(doc)
    const fresh = docWithAnims()
    const { doc: merged, downgrades } = mergeControllerIntoDocument(JSON.parse(JSON.stringify(output)), fresh)
    expect(downgrades).toEqual([])
    const ctrl = (merged.formatData?.controllers as ModelAnimationController[])[0]!
    expect(ctrl.name).toBe('controller.animation.kunyu_demo.controller')
    expect(ctrl.initialState).toBe(original.initialState)
    const [idle, walk] = Object.values(fresh.animations)
    expect(ctrl.states).toEqual([
      { name: 'idle', animation: idle!.id },
      { name: 'walk', animation: walk!.id }
    ])
    expect(ctrl.transitions).toEqual(original.transitions)
  })
})
