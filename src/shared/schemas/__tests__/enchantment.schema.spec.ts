/**
 * 附魔语义 Schema 测试：工厂默认值、脏数据归一化、保存层校验。
 */
import { describe, expect, it } from 'vitest'
import {
  createDefaultEnchantment,
  normalizeEnchantmentSchema,
  validateEnchantmentSchema
} from '../enchantment.schema'

describe('附魔 Schema 工厂与归一化', () => {
  it('createDefaultEnchantment 提供完整可用的默认值', () => {
    const e = createDefaultEnchantment('life_steal')
    expect(e).toMatchObject({
      kind: 'enchantment',
      id: 'life_steal',
      rarity: 'RARE',
      target: 'WEAPON',
      slots: ['mainhand'],
      maxLevel: 3,
      treasure: false,
      curse: false
    })
    expect(e.minCostBase).toBe(10)
    expect(e.minCostPerLevel).toBe(15)
    expect(e.maxCostExtra).toBe(50)
    expect(e.anvilCost).toBe(2)
    expect(e.damageBonus).toBeNull()
    expect(e.createdAt).toBe(e.updatedAt)
  })

  it('归一化宽容脏数据：非法枚举回落、数值夹取、槽位去重过滤', () => {
    const n = normalizeEnchantmentSchema({
      kind: 'enchantment',
      id: 'frost',
      displayName: { en_us: 'Frost' },
      rarity: 'NONSENSE',
      target: 42,
      slots: ['mainhand', 'mainhand', 'tail', 'head'],
      maxLevel: 9999,
      minCostBase: -5,
      maxCostExtra: '50',
      curse: true,
      damageBonus: { base: 1.5 }
    })
    expect(n.rarity).toBe('RARE')
    expect(n.target).toBe('WEAPON')
    expect(n.slots).toEqual(['mainhand', 'head'])
    expect(n.maxLevel).toBe(255)
    expect(n.minCostBase).toBe(0)
    // 非有限数值字符串回落默认
    expect(n.maxCostExtra).toBe(50)
    // 严格布尔：1 不算 true；true 原样保留
    expect(n.treasure).toBe(false)
    expect(n.curse).toBe(true)
    expect(n.damageBonus).toEqual({ base: 1.5, perLevel: 0 })
  })

  it('槽位全非法时回落 mainhand，描述双语缺省为空串', () => {
    const n = normalizeEnchantmentSchema({ id: 'x', slots: ['nope'] })
    expect(n.slots).toEqual(['mainhand'])
    expect(n.description).toEqual({ en_us: '', zh_cn: '' })
  })
})

describe('附魔 Schema 校验', () => {
  it('默认对象通过校验', () => {
    expect(validateEnchantmentSchema(createDefaultEnchantment('sharp_edge'))).toBeNull()
  })

  it('非法 id / 缺名 / 空槽 / 越界等级返回中文错误', () => {
    const badId = createDefaultEnchantment('Bad-Name')
    expect(validateEnchantmentSchema(badId)).toContain('注册名')

    const noName = createDefaultEnchantment('no_name')
    noName.displayName = { en_us: '', zh_cn: '' }
    expect(validateEnchantmentSchema(noName)).toContain('显示名称')

    const noSlots = createDefaultEnchantment('no_slots')
    ;(noSlots as { slots: string[] }).slots = []
    expect(validateEnchantmentSchema(noSlots)).toContain('装备槽')

    const badLevel = createDefaultEnchantment('bad_level')
    badLevel.maxLevel = 0
    expect(validateEnchantmentSchema(badLevel)).toContain('最大等级')
  })

  it('伤害加成为负数时报错', () => {
    const e = createDefaultEnchantment('weak_strike')
    e.damageBonus = { base: -1, perLevel: 0 }
    expect(validateEnchantmentSchema(e)).toContain('伤害加成')
  })
})
