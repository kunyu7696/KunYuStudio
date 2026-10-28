/**
 * 动画控制器测试（B1-2，v2）。
 *
 * 核心不变量：
 * - 读写：formatData 往返、upsert 按 name 替换、删除清键、非数组容错；
 * - 校验：初始状态缺失 / 状态重名 / 引用动画缺失 / 转移端点未知 / 条件越界逐条报告；
 * - resolveEntityController：合法返回、非法/无控制器回退 null（生成器回退语义）；
 * - 撤销栈契约：withControllers 更新 meta.updatedAt（diffDocument 可差分）。
 */
import { describe, expect, it } from 'vitest'
import {
  getControllers,
  removeController,
  resolveEntityController,
  upsertController,
  validateController,
  withControllers
} from '../controller'
import { addAnimation, createAnimation, createDocument } from '../document'
import type { ModelAnimationController } from '../types'

function docWithAnims() {
  let doc = createDocument({ name: 't', format: 'geckolib' })
  doc = addAnimation(doc, createAnimation('idle'))
  doc = addAnimation(doc, createAnimation('walk'))
  return doc
}

function idleWalkCtrl(doc: ReturnType<typeof docWithAnims>): ModelAnimationController {
  const [idle, walk] = Object.values(doc.animations)
  return {
    name: 'controller',
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

describe('控制器读写', () => {
  it('formatData 往返 + 空数组删键', () => {
    let doc = docWithAnims()
    const ctrl = idleWalkCtrl(doc)
    doc = upsertController(doc, ctrl)
    expect(getControllers(doc)).toEqual([ctrl])
    doc = withControllers(doc, [])
    expect(doc.formatData?.controllers).toBeUndefined()
  })

  it('upsert 按 name 替换，removeController 精准删除', () => {
    let doc = docWithAnims()
    const ctrl = idleWalkCtrl(doc)
    doc = upsertController(doc, ctrl)
    const renamed = { ...ctrl, initialState: 'walk' }
    doc = upsertController(doc, renamed)
    expect(getControllers(doc)).toHaveLength(1)
    expect(getControllers(doc)[0]!.initialState).toBe('walk')
    doc = removeController(doc, 'controller')
    expect(getControllers(doc)).toEqual([])
    // 删除不存在 → 原样返回（引用相等，命令栈不产生补丁）
    expect(removeController(doc, 'nope')).toBe(doc)
  })

  it('非数组 formatData.controllers 容错为空表', () => {
    const doc = docWithAnims()
    const bad = { ...doc, formatData: { controllers: 'oops' } }
    expect(getControllers(bad)).toEqual([])
  })
})

describe('validateController', () => {
  it('合法状态机零 issue', () => {
    const doc = docWithAnims()
    expect(validateController(doc, idleWalkCtrl(doc))).toEqual([])
  })

  it('初始状态缺失 / 状态重名 / 引用动画缺失 / 转移端点未知 / 条件越界逐条报告', () => {
    const doc = docWithAnims()
    const anyAnim = Object.keys(doc.animations)[0]!
    const ctrl: ModelAnimationController = {
      name: 'c',
      initialState: 'ghost',
      states: [
        { name: 's', animation: anyAnim },
        { name: 's', animation: 'missing-anim' }
      ],
      transitions: [{ from: 's', to: 'nowhere', condition: 'query.is_on_fire' as never }]
    }
    const codes = validateController(doc, ctrl).map((i) => i.code)
    expect(codes).toContain('initial_state_missing')
    expect(codes).toContain('duplicate_state')
    expect(codes).toContain('state_animation_missing')
    expect(codes).toContain('transition_endpoint_missing')
    expect(codes).toContain('condition_unknown')
  })
})

describe('resolveEntityController', () => {
  it('合法控制器返回，无控制器 / 非法控制器回退 null', () => {
    let doc = docWithAnims()
    expect(resolveEntityController(doc)).toBe(null)
    doc = upsertController(doc, idleWalkCtrl(doc))
    expect(resolveEntityController(doc)?.name).toBe('controller')
    // 弄坏：初始状态指向不存在
    const broken: ModelAnimationController = { ...idleWalkCtrl(doc), initialState: 'ghost' }
    doc = upsertController(doc, broken)
    expect(resolveEntityController(doc)).toBe(null)
  })

  it('withControllers 更新 updatedAt（命令栈差分可见）', () => {
    const doc = docWithAnims()
    const before = doc.meta.updatedAt
    const next = upsertController(doc, idleWalkCtrl(doc))
    expect(next.meta.updatedAt).toBeGreaterThanOrEqual(before)
    expect(next).not.toBe(doc)
  })
})
