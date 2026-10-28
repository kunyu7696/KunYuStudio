/**
 * 特性④ GameTest 生成器单测。
 *
 * 覆盖：generateGameTestClasses 纯函数——空数组、单 schema、多 schema、各 action 类型映射、
 * 未知 id 降级、pos 字面量、方法名/类名/包名派生、相对路径。
 */
import { describe, expect, it } from 'vitest'

import { generateGameTestClasses, gameTestJavaRelPath, listGameTestImports } from '../gameTestGenerator'
import {
  createDefaultGameTest,
  normalizeGameTestSchema,
  parseGameTestDoc,
  validateGameTestId,
  validateGameTestSchema,
  GAME_TEST_DEFAULT_SIZE,
  GAME_TEST_DEFAULT_TIMEOUT_TICKS,
  GAME_TEST_TEMPLATE
} from '../../../shared/schemas/gametest.schema'
import type { GameTestActionKind, GameTestPhase, GameTestSchema } from '../../../shared/schemas/gametest.schema'
import type { ModContext } from '../contentGenerator'

function makeCtx(overrides: Partial<ModContext> = {}): ModContext {
  return {
    loader: 'fabric',
    mcVersion: '1.20.1',
    modId: 'mymod',
    modClassName: 'MymodMod',
    packageName: 'com.kunyu.mymod',
    mavenGroup: 'com.kunyu.mymod',
    packageDiverged: false,
    pkgPath: 'com/kunyu/mymod',
    javaDir: '/root/src/main/java/com/kunyu/mymod',
    registryDir: '/root/src/main/java/com/kunyu/mymod/registry',
    resourcesDir: '/root/src/main/resources',
    assetsDir: '/root/src/main/resources/assets/mymod',
    dataDir: '/root/src/main/resources/data',
    ...overrides
  }
}

function makeSchema(overrides: Partial<GameTestSchema> = {}): GameTestSchema {
  const base = createDefaultGameTest('ruby_block_registry')
  return { ...base, ...overrides }
}

describe('validateGameTestId', () => {
  it('合法 snake_case id 通过', () => {
    expect(validateGameTestId('ruby_block')).toBe(true)
    expect(validateGameTestId('test_1')).toBe(true)
    expect(validateGameTestId('a')).toBe(true)
  })
  it('非法 id 被拒', () => {
    expect(validateGameTestId('RubyBlock')).toBe(false)
    expect(validateGameTestId('1abc')).toBe(false)
    expect(validateGameTestId('has-dash')).toBe(false)
    expect(validateGameTestId('')).toBe(false)
    expect(validateGameTestId('a'.repeat(65))).toBe(false)
  })
})

describe('constants', () => {
  it('GAME_TEST_DEFAULT_SIZE 是 [3,3,3]', () => {
    expect(GAME_TEST_DEFAULT_SIZE).toEqual([3, 3, 3])
  })
  it('GAME_TEST_DEFAULT_TIMEOUT_TICKS 是 200', () => {
    expect(GAME_TEST_DEFAULT_TIMEOUT_TICKS).toBe(200)
  })
  it('GAME_TEST_TEMPLATE 指向 fabric 内置空模板', () => {
    expect(GAME_TEST_TEMPLATE).toBe('fabric:empty_3x3_3')
  })
})

describe('createDefaultGameTest', () => {
  it('含 kind/id/displayName/size/steps/createdAt/updatedAt', () => {
    const g = createDefaultGameTest('foo')
    expect(g.kind).toBe('gametest')
    expect(g.id).toBe('foo')
    expect(g.displayName).toBe('foo')
    expect(g.size).toEqual([3, 3, 3])
    expect(g.timeoutTicks).toBe(200)
    expect(g.steps.length).toBeGreaterThan(0)
    expect(typeof g.createdAt).toBe('number')
    expect(typeof g.updatedAt).toBe('number')
  })
})

describe('normalizeGameTestSchema', () => {
  it('size 越界被 clamp', () => {
    const g = normalizeGameTestSchema({ ...makeSchema(), size: [100, 0, -5] })
    expect(g.size).toEqual([32, 1, 1])
  })
  it('size 非数组走默认', () => {
    const g = normalizeGameTestSchema({ ...makeSchema(), size: undefined as unknown as [number, number, number] })
    expect(g.size).toEqual(GAME_TEST_DEFAULT_SIZE)
  })
  it('timeoutTicks 越界被 clamp', () => {
    const g = normalizeGameTestSchema({ ...makeSchema(), timeoutTicks: 99999 })
    expect(g.timeoutTicks).toBe(6000)
  })
  it('timeoutTicks 非法走默认', () => {
    const g = normalizeGameTestSchema({ ...makeSchema(), timeoutTicks: NaN })
    expect(g.timeoutTicks).toBe(GAME_TEST_DEFAULT_TIMEOUT_TICKS)
  })
  it('未知 phase 降级为 assert', () => {
    const s = {
      ...makeSchema(),
      steps: [{ name: 'a', phase: 'foo' as unknown as GameTestPhase, action: 'delay' as GameTestActionKind, args: { ticks: 1 } }]
    } as unknown as GameTestSchema
    const g = normalizeGameTestSchema(s)
    expect(g.steps[0].phase).toBe('assert')
  })
  it('未知 action 降级为 groovy', () => {
    const s = {
      ...makeSchema(),
      steps: [{ name: 'a', phase: 'act' as GameTestPhase, action: 'teleport' as unknown as GameTestActionKind, args: {} }]
    } as unknown as GameTestSchema
    const g = normalizeGameTestSchema(s)
    expect(g.steps[0].action).toBe('groovy')
  })
  it('pos 越界被 clamp', () => {
    const s = {
      ...makeSchema(),
      steps: [{
        name: 'a',
        phase: 'arrange' as GameTestPhase,
        action: 'place-block' as GameTestActionKind,
        pos: [99, -1, 2] as [number, number, number],
        args: { block: 'minecraft:stone' }
      }]
    } as GameTestSchema
    const g = normalizeGameTestSchema(s)
    expect(g.steps[0].pos).toEqual([2, 0, 2])
  })
  it('非数组 assertions 转空', () => {
    const g = normalizeGameTestSchema({ ...makeSchema(), assertions: 'nope' as never } as unknown as GameTestSchema)
    expect(g.assertions).toBeUndefined()
  })
})

describe('validateGameTestSchema', () => {
  it('合法 schema 返回 null', () => {
    expect(validateGameTestSchema(makeSchema())).toBeNull()
  })
  it('空 steps 报错', () => {
    expect(validateGameTestSchema({ ...makeSchema(), steps: [] })).toContain('步骤')
  })
  it('空 displayName 报错', () => {
    expect(validateGameTestSchema({ ...makeSchema(), displayName: '' })).toContain('显示名')
  })
})

describe('parseGameTestDoc', () => {
  it('kind !== gametest 拒绝', () => {
    const r = parseGameTestDoc({ kind: 'block' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('kind')
  })
  it('非对象拒绝', () => {
    expect(parseGameTestDoc('foo').ok).toBe(false)
    expect(parseGameTestDoc(null).ok).toBe(false)
  })
  it('合法对象接受', () => {
    const r = parseGameTestDoc(makeSchema())
    expect(r.ok).toBe(true)
    expect(r.def?.id).toBe('ruby_block_registry')
  })
})

describe('generateGameTestClasses', () => {
  it('空 schemas 数组返回空串', () => {
    expect(generateGameTestClasses([], makeCtx())).toBe('')
  })

  it('单 schema 生成正确包名/类名/方法名', () => {
    const java = generateGameTestClasses([makeSchema()], makeCtx())
    expect(java).toContain('package com.kunyu.mymod.gametest')
    expect(java).toContain('public class MymodModGameTests')
    expect(java).toContain('@GameTest(template = "fabric:empty_3x3_3", timeoutTicks = 200)')
    expect(java).toContain('public static void test_ruby_block_registry(TestContext ctx)')
    expect(java).toContain('ctx.complete();')
  })

  it('多 schema 生成多方法', () => {
    const s1 = makeSchema()
    const s2 = makeSchema()
    s2.id = 'second_test'
    s2.displayName = 'Second'
    const java = generateGameTestClasses([s1, s2], makeCtx())
    expect(java).toContain('test_ruby_block_registry')
    expect(java).toContain('test_second_test')
  })

  it('place-block 动作生成 setBlockState 调用', () => {
    const s = makeSchema()
    s.steps = [{ name: '放石头', phase: 'arrange', action: 'place-block', pos: [0, 0, 0], args: { block: 'minecraft:stone' } }]
    const java = generateGameTestClasses([s], makeCtx())
    expect(java).toContain('Blocks.STONE.getDefaultState()')
    expect(java).toContain('new BlockPos(0, 0, 0)')
  })

  it('place-block 未知 id 降级为注释占位', () => {
    const s = makeSchema()
    s.steps = [{ name: '放未知', phase: 'arrange', action: 'place-block', pos: [0, 0, 0], args: { block: 'mymod:ruby_block' } }]
    const java = generateGameTestClasses([s], makeCtx())
    expect(java).toContain('TODO')
    expect(java).toContain('mymod:ruby_block')
    expect(java).not.toContain('setBlockState')
  })

  it('assert-block 动作生成 expectBlock 调用', () => {
    const s = makeSchema()
    s.steps = [{ name: '验证石头', phase: 'assert', action: 'assert-block', pos: [1, 1, 1], args: { block: 'minecraft:dirt' } }]
    const java = generateGameTestClasses([s], makeCtx())
    expect(java).toContain('ctx.expectBlock(Blocks.DIRT')
    expect(java).toContain('new BlockPos(1, 1, 1)')
  })

  it('summon-entity 动作生成 spawnEntity 调用（vanilla cow）', () => {
    const s = makeSchema()
    s.steps = [{ name: '召牛', phase: 'act', action: 'summon-entity', pos: [2, 0, 0], args: { entity: 'minecraft:cow' } }]
    const java = generateGameTestClasses([s], makeCtx())
    expect(java).toContain('ctx.spawnEntity(EntityType.COW')
  })

  it('summon-entity 未知 id 降级为注释', () => {
    const s = makeSchema()
    s.steps = [{ name: '召自定义', phase: 'act', action: 'summon-entity', pos: [0, 0, 0], args: { entity: 'mymod:custom_mob' } }]
    const java = generateGameTestClasses([s], makeCtx())
    expect(java).toContain('TODO')
    expect(java).toContain('mymod:custom_mob')
  })

  it('delay 动作生成 waitTicks 调用', () => {
    const s = makeSchema()
    s.steps = [{ name: '等', phase: 'act', action: 'delay', args: { ticks: 50 } }]
    const java = generateGameTestClasses([s], makeCtx())
    expect(java).toContain('ctx.waitTicks(50)')
  })

  it('delay 无 ticks 走默认 10', () => {
    const s = makeSchema()
    s.steps = [{ name: '等', phase: 'act', action: 'delay', args: {} }]
    const java = generateGameTestClasses([s], makeCtx())
    expect(java).toContain('ctx.waitTicks(10)')
  })

  it('groovy 动作转译为注释（不带运行时 Groovy）', () => {
    const s = makeSchema()
    s.steps = [{ name: '脚本', phase: 'act', action: 'groovy', args: { code: 'player.teleport(0, 0, 0)' } }]
    const java = generateGameTestClasses([s], makeCtx())
    expect(java).toContain('groovy 转译占位')
    expect(java).toContain('player.teleport')
  })

  it('use-item / assert-entity MVP 占位', () => {
    const s = makeSchema()
    s.steps = [
      { name: 'use', phase: 'act', action: 'use-item', args: { item: 'minecraft:diamond' } },
      { name: 'assert-ent', phase: 'assert', action: 'assert-entity', args: { entity: 'minecraft:cow' } }
    ]
    const java = generateGameTestClasses([s], makeCtx())
    expect(java).toContain('use-item: MVP')
    expect(java).toContain('assert-entity: MVP')
  })

  it('Arrange/Act/Assert 段落注释分段', () => {
    const s = makeSchema()
    s.steps = [
      { name: '放块', phase: 'arrange', action: 'place-block', pos: [0, 0, 0], args: { block: 'minecraft:stone' } },
      { name: '等', phase: 'act', action: 'delay', args: { ticks: 5 } },
      { name: '验证', phase: 'assert', action: 'assert-block', pos: [0, 0, 0], args: { block: 'minecraft:stone' } }
    ]
    const java = generateGameTestClasses([s], makeCtx())
    expect(java).toContain('// Arrange')
    expect(java).toContain('// Act')
    expect(java).toContain('// Assert')
  })

  it('auto-generated banner 出现', () => {
    const java = generateGameTestClasses([makeSchema()], makeCtx())
    expect(java).toContain('AUTO-GENERATED by KunYu Studio')
  })
})

describe('gameTestJavaRelPath', () => {
  it('路径在 src/test/java/<pkg>/gametest/ 下', () => {
    const rel = gameTestJavaRelPath(makeCtx())
    expect(rel).toBe('src/test/java/com/kunyu/mymod/gametest/MymodModGameTests.java')
  })
  it('不同 modId 派生不同类名', () => {
    const rel = gameTestJavaRelPath(makeCtx({ modId: 'demo', modClassName: 'DemoMod', pkgPath: 'com/kunyu/demo' }))
    expect(rel).toBe('src/test/java/com/kunyu/demo/gametest/DemoModGameTests.java')
  })
})

describe('listGameTestImports', () => {
  it('返回五个 import', () => {
    const imports = listGameTestImports()
    expect(imports).toContain('net.minecraft.test.GameTest')
    expect(imports).toContain('net.minecraft.test.TestContext')
    expect(imports).toContain('net.minecraft.block.Blocks')
    expect(imports).toContain('net.minecraft.util.math.BlockPos')
    expect(imports).toContain('net.minecraft.entity.EntityType')
    expect(imports.length).toBe(5)
  })
})
