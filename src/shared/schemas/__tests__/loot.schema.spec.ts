import { describe, expect, it } from 'vitest'
import {
  compileLootTable,
  createDefaultBlockLoot,
  lootFixed,
  validateLootTable
} from '../loot.schema'
import type { LootEntryDef, LootTableDef } from '../loot.schema'

function entry(partial: Partial<LootEntryDef> = {}): LootEntryDef {
  return { item: 'ruby', count: lootFixed(1), weight: 1, chance: 1, ...partial }
}

describe('loot.schema 编译器', () => {
  it('默认方块战利品表：掉落自身 + survives_explosion', () => {
    const json = compileLootTable(createDefaultBlockLoot('ruby_block'), 'mymod')
    expect(json.type).toBe('minecraft:block')
    const pools = json.pools as Array<Record<string, unknown>>
    expect(pools).toHaveLength(1)
    expect(pools[0].conditions).toEqual([{ condition: 'minecraft:survives_explosion' }])
    const e0 = (pools[0].entries as unknown[])[0] as Record<string, unknown>
    expect(e0.name).toBe('mymod:ruby_block')
    // 数量 1 时省略 set_count
    expect(e0.functions).toBeUndefined()
  })

  it('不含命名空间的物品 id 补当前模组；含命名空间原样保留', () => {
    const def: LootTableDef = {
      type: 'block',
      pools: [{ rolls: lootFixed(1), entries: [entry({ item: 'ruby' }), entry({ item: 'minecraft:diamond' })] }]
    }
    const json = compileLootTable(def, 'mymod')
    const names = ((json.pools as unknown[])[0] as { entries: Array<{ name: string }> }).entries.map((e) => e.name)
    expect(names).toEqual(['mymod:ruby', 'minecraft:diamond'])
  })

  it('数量固定非1 → set_count 整数；区间 → min/max', () => {
    const def: LootTableDef = {
      type: 'block',
      pools: [
        {
          rolls: lootFixed(1),
          entries: [
            entry({ item: 'a', count: { kind: 'fixed', value: 3 } }),
            entry({ item: 'b', count: { kind: 'range', min: 1, max: 4 } })
          ]
        }
      ]
    }
    const json = compileLootTable(def, 'mymod')
    const entries = ((json.pools as unknown[])[0] as { entries: Array<Record<string, unknown>> }).entries
    expect(entries[0].functions).toEqual([
      { function: 'minecraft:set_count', count: 3 }
    ])
    expect(entries[1].functions).toEqual([
      { function: 'minecraft:set_count', count: { min: 1, max: 4 } }
    ])
  })

  it('权重>1 写入 weight；概率<1 写 random_chance', () => {
    const def: LootTableDef = {
      type: 'block',
      pools: [
        {
          rolls: lootFixed(1),
          entries: [entry({ item: 'a', weight: 5, chance: 0.25 })]
        }
      ]
    }
    const json = compileLootTable(def, 'mymod')
    const e0 = ((json.pools as unknown[])[0] as { entries: Array<Record<string, unknown>> }).entries[0]
    expect(e0.weight).toBe(5)
    expect(e0.conditions).toEqual([{ condition: 'minecraft:random_chance', chance: 0.25 }])
  })

  it('抽取次数区间透传到池 rolls；空条目的池被剔除', () => {
    const def: LootTableDef = {
      type: 'block',
      pools: [
        { rolls: { kind: 'range', min: 1, max: 3 }, entries: [entry()] },
        { rolls: lootFixed(1), entries: [] }
      ]
    }
    const json = compileLootTable(def, 'mymod')
    const pools = json.pools as Array<Record<string, unknown>>
    expect(pools).toHaveLength(1)
    expect(pools[0].rolls).toEqual({ min: 1, max: 3 })
  })

  it('entity/chest 不写 type 与 survives_explosion', () => {
    for (const type of ['entity', 'chest'] as const) {
      const def: LootTableDef = {
        type,
        pools: [{ rolls: lootFixed(1), entries: [entry()] }]
      }
      const json = compileLootTable(def, 'mymod')
      expect(json.type).toBeUndefined()
      const pool = (json.pools as unknown[])[0] as Record<string, unknown>
      expect(pool.conditions).toBeUndefined()
    }
  })
})

describe('loot.schema 校验', () => {
  it('空池列表报错', () => {
    expect(validateLootTable({ type: 'block', pools: [] })).toMatch(/至少需要一个池/)
  })

  it('池内无掉落物报错', () => {
    const err = validateLootTable({
      type: 'block',
      pools: [{ rolls: lootFixed(1), entries: [] }]
    })
    expect(err).toMatch(/至少需要一条掉落物/)
  })

  it('空物品 id 报错；区间颠倒报错；概率越界报错', () => {
    expect(
      validateLootTable({ type: 'block', pools: [{ rolls: lootFixed(1), entries: [entry({ item: '   ' })] }] })
    ).toMatch(/id 不能为空/)
    expect(
      validateLootTable({
        type: 'block',
        pools: [{ rolls: lootFixed(1), entries: [entry({ count: { kind: 'range', min: 4, max: 1 } })] }]
      })
    ).toMatch(/上限不能小于下限/)
    expect(
      validateLootTable({
        type: 'block',
        pools: [{ rolls: lootFixed(1), entries: [entry({ chance: 2 })] }]
      })
    ).toMatch(/概率必须在 0~1/)
  })

  it('合法表返回 null', () => {
    expect(validateLootTable(createDefaultBlockLoot('x'))).toBeNull()
  })
})
