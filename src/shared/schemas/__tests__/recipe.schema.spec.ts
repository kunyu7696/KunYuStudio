import { describe, expect, it } from 'vitest'
import {
  compileRecipe,
  createDefaultRecipe,
  validateRecipe
} from '../recipe.schema'
import type { RecipeDef } from '../recipe.schema'

describe('recipe.schema 工厂', () => {
  it('createDefaultRecipe：有序、id=自身、结果为自身×1', () => {
    const r = createDefaultRecipe('ruby_block')
    expect(r.kind).toBe('crafting_shaped')
    expect(r.id).toBe('ruby_block')
    expect(r.result).toEqual({ item: 'ruby_block', count: 1 })
    expect(r.pattern).toEqual(['   ', '   ', '   '])
    expect(r.key).toEqual({})
  })
})

describe('compileRecipe', () => {
  it('有序：pattern/key 原样编译，无命名空间物品补 ns，count 保留', () => {
    const def: RecipeDef = {
      id: 'ruby_from_dust',
      kind: 'crafting_shaped',
      pattern: ['RR', 'RR', '   '],
      key: { R: { item: 'ruby_dust' } },
      result: { item: 'ruby', count: 2 }
    }
    const json = compileRecipe(def, 'testmod')
    expect(json.type).toBe('minecraft:crafting_shaped')
    expect(json.pattern).toEqual(['RR', 'RR', '   '])
    expect(json.key).toEqual({ R: { item: 'testmod:ruby_dust' } })
    expect(json.result).toEqual({ item: 'testmod:ruby', count: 2 })
  })

  it('有序：含命名空间的物品 id 原样保留；count 向下取整且至少 1', () => {
    const def: RecipeDef = {
      id: 'x',
      kind: 'crafting_shaped',
      pattern: ['A', ' ', ' '],
      key: { A: { item: 'minecraft:stick' } },
      result: { item: 'minecraft:diamond', count: 0 }
    }
    const json = compileRecipe(def, 'testmod')
    expect((json.key as Record<string, unknown>).A).toEqual({ item: 'minecraft:stick' })
    expect(json.result).toEqual({ item: 'minecraft:diamond', count: 1 })
  })

  it('无序：ingredients 数组 + result count', () => {
    const def: RecipeDef = {
      id: 'gem_pack',
      kind: 'crafting_shapeless',
      ingredients: [{ item: 'ruby' }, { item: 'minecraft:emerald' }],
      result: { item: 'gem_pack', count: 1 }
    }
    const json = compileRecipe(def, 'testmod')
    expect(json.type).toBe('minecraft:crafting_shapeless')
    expect(json.ingredients).toEqual([
      { item: 'testmod:ruby' },
      { item: 'minecraft:emerald' }
    ])
    expect(json.result).toEqual({ item: 'testmod:gem_pack', count: 1 })
  })

  it('熔炉（1.20.x）：result 为字符串 id，ingredient 为物品对象，cookingtime 默认 200 / 经验 0', () => {
    const def: RecipeDef = {
      id: 'ruby_smelt',
      kind: 'smelting',
      input: 'ruby_ore',
      result: { item: 'ruby', count: 1 }
    }
    const json = compileRecipe(def, 'testmod', '1.20.1')
    expect(json.type).toBe('minecraft:smelting')
    expect(json.ingredient).toEqual({ item: 'testmod:ruby_ore' })
    expect(json.result).toBe('testmod:ruby')
    expect(json.experience).toBe(0)
    expect(json.cookingtime).toBe(200)
    expect('cookingTime' in json).toBe(false)
    expect('cooking_time' in json).toBe(false)
  })

  it('熔炉：不传版本时按 1.20.x 口径输出 cookingtime', () => {
    const def: RecipeDef = {
      id: 'ruby_smelt',
      kind: 'smelting',
      input: 'ruby_ore',
      result: { item: 'ruby', count: 1 }
    }
    expect(compileRecipe(def, 'testmod').cookingtime).toBe(200)
  })

  it('熔炉（1.21+）：cookingtime 全版本统一，自定义时间向下取整、至少 1', () => {
    const def: RecipeDef = {
      id: 'ruby_smelt',
      kind: 'smelting',
      input: 'minecraft:iron_ore',
      experience: 0.7,
      cookingTime: 99.9,
      result: { item: 'ruby', count: 3 }
    }
    const json = compileRecipe(def, 'testmod', '1.21.1')
    expect(json.result).toBe('testmod:ruby')
    expect(json.experience).toBe(0.7)
    expect(json.cookingtime).toBe(99)
    expect('cooking_time' in json).toBe(false)
  })

  it('1.20.5+：仅 crafting result 用 id 而非 item；key/ingredient 保持 {"item":…}（P0-7）', () => {
    const def: RecipeDef = {
      id: 'shaped_id',
      kind: 'crafting_shaped',
      pattern: ['A  ', '   ', '   '],
      key: { A: { item: 'minecraft:stick' } },
      result: { item: 'minecraft:diamond', count: 1 }
    }
    const json = compileRecipe(def, 'testmod', '1.20.6')
    expect((json.key as Record<string, unknown>).A).toEqual({ item: 'minecraft:stick' })
    expect(json.result).toEqual({ id: 'minecraft:diamond', count: 1 })
    expect('item' in (json.result as Record<string, unknown>)).toBe(false)
  })

  it('1.21.1（core 档）：ingredient 与 result 全量黄金快照（对齐 mcmeta 官方 cake.json）', () => {
    const shaped: RecipeDef = {
      id: 'blade',
      kind: 'crafting_shaped',
      pattern: ['A  ', '   ', '   '],
      key: { A: { item: 'minecraft:iron_ingot' } },
      result: { item: 'blade', count: 2 }
    }
    const j1 = compileRecipe(shaped, 'mymod', '1.21.1')
    expect(j1.key).toEqual({ A: { item: 'minecraft:iron_ingot' } })
    expect(j1.result).toEqual({ id: 'mymod:blade', count: 2 })

    const shapeless: RecipeDef = {
      id: 'mix',
      kind: 'crafting_shapeless',
      ingredients: [{ item: 'raw' }, { item: 'minecraft:emerald' }],
      result: { item: 'mix', count: 1 }
    }
    const j2 = compileRecipe(shapeless, 'mymod', '1.21.1')
    expect(j2.ingredients).toEqual([{ item: 'mymod:raw' }, { item: 'minecraft:emerald' }])
    expect(j2.result).toEqual({ id: 'mymod:mix', count: 1 })

    const smelt: RecipeDef = {
      id: 'ingot',
      kind: 'smelting',
      input: 'raw',
      result: { item: 'ingot', count: 1 }
    }
    const j3 = compileRecipe(smelt, 'mymod', '1.21.1')
    expect(j3.ingredient).toEqual({ item: 'mymod:raw' })
    expect(j3.result).toBe('mymod:ingot')
  })

  it('1.20.6：result 用 id、smelting ingredient 用 item 对象（1.21.2 前不改）', () => {
    const def: RecipeDef = {
      id: 'smelt_id',
      kind: 'smelting',
      input: 'minecraft:raw_iron',
      result: { item: 'minecraft:iron_ingot', count: 1 }
    }
    const json = compileRecipe(def, 'testmod', '1.20.6')
    expect(json.ingredient).toEqual({ item: 'minecraft:raw_iron' })
    expect(json.result).toBe('minecraft:iron_ingot')
    expect(json.cookingtime).toBe(200)
  })

  it('1.21.2+：ingredient/key/ingredients 为纯字符串', () => {
    const shaped: RecipeDef = {
      id: 'shaped_str',
      kind: 'crafting_shaped',
      pattern: ['A  ', '   ', '   '],
      key: { A: { item: 'minecraft:stick' } },
      result: { item: 'minecraft:diamond', count: 1 }
    }
    const j1 = compileRecipe(shaped, 'testmod', '1.21.3')
    expect((j1.key as Record<string, unknown>).A).toBe('minecraft:stick')
    expect(j1.result).toEqual({ id: 'minecraft:diamond', count: 1 })

    const shapeless: RecipeDef = {
      id: 'shapeless_str',
      kind: 'crafting_shapeless',
      ingredients: [{ item: 'minecraft:diamond' }, { item: 'minecraft:emerald' }],
      result: { item: 'testmod:gem', count: 1 }
    }
    const j2 = compileRecipe(shapeless, 'testmod', '1.21.3')
    expect(j2.ingredients).toEqual(['minecraft:diamond', 'minecraft:emerald'])

    const smelt: RecipeDef = {
      id: 'smelt_str',
      kind: 'smelting',
      input: 'minecraft:raw_iron',
      result: { item: 'minecraft:iron_ingot', count: 1 }
    }
    const j3 = compileRecipe(smelt, 'testmod', '1.21.3')
    expect(j3.ingredient).toBe('minecraft:raw_iron')
    expect(j3.result).toBe('minecraft:iron_ingot')
  })

  it('group 仅在非空时出现', () => {
    const withGroup = compileRecipe(
      { ...createDefaultRecipe('a'), group: 'gems' },
      'ns'
    )
    expect(withGroup.group).toBe('gems')
    const noGroup = compileRecipe(createDefaultRecipe('a'), 'ns')
    expect('group' in noGroup).toBe(false)
  })
})

describe('validateRecipe', () => {
  it('id 非法', () => {
    expect(validateRecipe({ ...createDefaultRecipe('1bad') })).toMatch(/id 不合法/)
    expect(validateRecipe({ ...createDefaultRecipe('BadId') })).toMatch(/id 不合法/)
    expect(validateRecipe({ ...createDefaultRecipe('a-b') })).toMatch(/id 不合法/)
  })

  it('结果为空', () => {
    const r = createDefaultRecipe('ok')
    r.result.item = '  '
    r.pattern = ['A  ', '   ', '   ']
    r.key = { A: { item: 'minecraft:stone' } }
    expect(validateRecipe(r)).toMatch(/结果物品不能为空/)
  })

  it('有序：空网格报错', () => {
    expect(validateRecipe(createDefaultRecipe('ok'))).toMatch(/至少需要/)
  })

  it('有序：网格字符未映射 key 报错', () => {
    const r = createDefaultRecipe('ok')
    r.pattern = ['A  ', '   ', '   ']
    r.key = {}
    expect(validateRecipe(r)).toMatch(/字符「A」/)
  })

  it('有序：行超过 3 格报错', () => {
    const r = createDefaultRecipe('ok')
    r.pattern = ['AAAA', '   ', '   ']
    r.key = { A: { item: 'minecraft:stone' } }
    expect(validateRecipe(r)).toMatch(/不能超过 3 格/)
  })

  it('有序：合法配置返回 null', () => {
    const r = createDefaultRecipe('ok')
    r.pattern = ['AA ', 'AA ', '   ']
    r.key = { A: { item: 'minecraft:stone' } }
    expect(validateRecipe(r)).toBeNull()
  })

  it('无序：无原料报错；空物品原料报错；合法返回 null', () => {
    const base: RecipeDef = {
      id: 'ok',
      kind: 'crafting_shapeless',
      ingredients: [],
      result: { item: 'mymod:x', count: 1 }
    }
    expect(validateRecipe(base)).toMatch(/至少需要一种原料/)
    expect(
      validateRecipe({ ...base, ingredients: [{ item: '  ' }] })
    ).toMatch(/未选择物品/)
    expect(
      validateRecipe({ ...base, ingredients: [{ item: 'minecraft:stick' }] })
    ).toBeNull()
  })

  it('熔炉：无输入报错；有输入合法', () => {
    const base: RecipeDef = {
      id: 'ok',
      kind: 'smelting',
      result: { item: 'mymod:x', count: 1 }
    }
    expect(validateRecipe(base)).toMatch(/必须指定输入/)
    expect(validateRecipe({ ...base, input: 'minecraft:iron_ore' })).toBeNull()
  })
})
