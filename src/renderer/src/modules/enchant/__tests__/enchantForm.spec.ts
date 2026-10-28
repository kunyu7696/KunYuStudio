/**
 * 附魔视图纯逻辑测试：schema/表单模型互转与校验。
 */
import { describe, expect, it } from 'vitest'
import { createDefaultEnchantment } from '../../../../../shared/schemas/enchantment.schema'
import {
  ENCHANTMENT_FORM_SCHEMA,
  fromFormModel,
  newFormModel,
  toFormModel,
  validateForm
} from '../enchantForm'

describe('附魔表单模型互转', () => {
  it('新模型默认值：伤害开关关闭、数值归零', () => {
    const m = newFormModel('life_steal')
    expect(m.id).toBe('life_steal')
    expect(m.rarity).toBe('RARE')
    expect(m.slots).toEqual(['mainhand'])
    expect(m.damageEnabled).toBe(false)
    expect(m.damageBase).toBe(0)
    expect(m.damagePerLevel).toBe(0)
  })

  it('damageBonus 在表单中拍平为开关+数值，回转后还原为对象/null', () => {
    const withBonus = createDefaultEnchantment('soul_fire')
    withBonus.damageBonus = { base: 2, perLevel: 1 }
    const m1 = toFormModel(withBonus)
    expect(m1.damageEnabled).toBe(true)
    expect(m1.damageBase).toBe(2)
    expect(m1.damagePerLevel).toBe(1)
    expect(fromFormModel(m1).damageBonus).toEqual({ base: 2, perLevel: 1 })

    // 关闭开关后保存为 null
    m1.damageEnabled = false
    expect(fromFormModel(m1).damageBonus).toBeNull()
  })

  it('表单经保存校验：默认模型合法、坏 id 报错；空槽位在归一化时修复', () => {
    expect(validateForm(newFormModel('ok_id'))).toBeNull()

    const bad = newFormModel('BadId')
    expect(validateForm(bad)).toContain('注册名')

    // 空槽位由 normalizeEnchantmentSchema 兜底为 mainhand，保存模型始终合法
    const noSlots = newFormModel('no_slots')
    noSlots.slots = []
    expect(validateForm(noSlots)).toBeNull()
    expect(fromFormModel(noSlots).slots).toEqual(['mainhand'])
  })

  it('JsonSchema 覆盖全部核心字段且枚举带中文标签', () => {
    const props = ENCHANTMENT_FORM_SCHEMA.properties
    expect(props).toBeDefined()
    for (const key of [
      'displayName',
      'description',
      'rarity',
      'target',
      'slots',
      'maxLevel',
      'treasure',
      'curse',
      'minCostBase',
      'minCostPerLevel',
      'maxCostExtra',
      'anvilCost'
    ]) {
      expect(props?.[key]).toBeDefined()
    }
    expect(props?.rarity.enum).toEqual(['COMMON', 'UNCOMMON', 'RARE', 'VERY_RARE'])
    expect(props?.rarity.enumLabels?.[0]).toContain('常见')
    // 槽位数组为枚举下拉
    expect(props?.slots.items?.enum).toContain('mainhand')
  })
})
