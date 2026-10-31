/**
 * 统一内容对象适配层往返测试：Enchantment。
 * 验证 EnchantmentSchema → UnifiedContent → EnchantmentSchema 后数据无损。
 * 比较时对两端都调用 normalizeEnchantmentSchema，消除默认值填充差异。
 */
import { describe, it, expect } from 'vitest'
import { createDefaultEnchantment, normalizeEnchantmentSchema } from '../enchantment.schema'
import { enchantmentToUnified, unifiedToEnchantment } from '../unified.adapter'
import type { EnchantmentJavaProperties } from '../unified.schema'

/** 深比较前先 JSON 序列化，消除 undefined 字段差异 */
function stable<T>(v: T): string {
  return JSON.stringify(v, null, 0)
}

describe('统一适配层往返：Enchantment', () => {
  it('默认附魔往返无损', () => {
    const ench = createDefaultEnchantment('life_steal')
    ench.displayName = { en_us: 'Life Steal', zh_cn: '生命窃取' }
    ench.description = { en_us: 'Heal on hit', zh_cn: '攻击时恢复生命' }

    const unified = enchantmentToUnified(ench, 'testmod')
    const back = normalizeEnchantmentSchema(unifiedToEnchantment(unified))
    const expected = normalizeEnchantmentSchema(ench)

    expect(stable(back)).toBe(stable(expected))
  })

  it('含伤害加成与多槽位的附魔往返无损', () => {
    const ench = createDefaultEnchantment('thunder_blade')
    ench.rarity = 'VERY_RARE'
    ench.target = 'WEAPON'
    ench.slots = ['mainhand', 'offhand']
    ench.maxLevel = 5
    ench.treasure = true
    ench.curse = true
    ench.minCostBase = 20
    ench.minCostPerLevel = 10
    ench.maxCostExtra = 60
    ench.anvilCost = 4
    ench.damageBonus = { base: 2, perLevel: 1.5 }
    ench.displayName = { en_us: 'Thunder Blade', zh_cn: '雷霆之刃' }
    ench.description = { en_us: 'Strikes lightning', zh_cn: '攻击时召唤闪电' }

    const unified = enchantmentToUnified(ench, 'testmod')
    const back = normalizeEnchantmentSchema(unifiedToEnchantment(unified))
    const expected = normalizeEnchantmentSchema(ench)

    expect(back.damageBonus).toEqual(expected.damageBonus)
    expect(back.slots).toEqual(expected.slots)
    expect(stable(back)).toBe(stable(expected))
  })

  it('仅英文描述的附魔往返无损', () => {
    const ench = createDefaultEnchantment('frost_touch')
    ench.description = { en_us: 'Freezes water', zh_cn: '' }

    const unified = enchantmentToUnified(ench, 'testmod')
    const back = normalizeEnchantmentSchema(unifiedToEnchantment(unified))
    const expected = normalizeEnchantmentSchema(ench)

    expect(stable(back)).toBe(stable(expected))
  })

  it('三端字段分布：语义字段在 java.properties，assets/data 端为空', () => {
    const ench = createDefaultEnchantment('sharp_edge')
    ench.description = { en_us: 'Sharp', zh_cn: '锋利' }
    const u = enchantmentToUnified(ench, 'testmod')

    expect(u.type).toBe('enchantment')
    expect(u.java.className).toBe('')
    expect(u.java.packageName).toBe('')
    expect(u.assets.textures).toEqual({})
    expect(u.data).toEqual({})

    const p = u.java.properties as EnchantmentJavaProperties
    expect(p.rarity).toBe(ench.rarity)
    expect(p.target).toBe(ench.target)
    expect(p.slots).toEqual(ench.slots)
    expect(p.maxLevel).toBe(ench.maxLevel)
    expect(p.description).toEqual(ench.description)
    expect(p.damageBonus).toBeNull()
    expect(u.assets.lang['enchantment.testmod.sharp_edge']).toBe('sharp_edge')
  })
})
