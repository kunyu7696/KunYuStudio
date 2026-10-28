/**
 * 生物群系文档 schema 测试（M17）。
 * 覆盖：默认值过校验、必填字段报错、颜色格式、归一化删空串可选键。
 */
import { describe, expect, it } from 'vitest'
import {
  BIOME_FORM,
  createBiomeDefault,
  normalizeBiomeDoc,
  validateBiomeDoc
} from '../datapack/biome.schema'

describe('biome.schema：默认值与校验', () => {
  it('createBiomeDefault 直接通过校验', () => {
    expect(validateBiomeDoc(createBiomeDefault())).toBeNull()
  })

  it('temperature 越界报错', () => {
    const doc = createBiomeDefault()
    doc.temperature = 5
    expect(validateBiomeDoc(doc)).toMatch(/temperature/)
    doc.temperature = 'hot'
    expect(validateBiomeDoc(doc)).toMatch(/temperature/)
  })

  it('downfall 越界报错', () => {
    const doc = createBiomeDefault()
    doc.downfall = 1.5
    expect(validateBiomeDoc(doc)).toMatch(/downfall/)
  })

  it('非法 has_precipitation 报错', () => {
    const doc = createBiomeDefault()
    doc.has_precipitation = 'rain' as unknown as boolean
    expect(validateBiomeDoc(doc)).toMatch(/has_precipitation/)
  })

  it('effects 必填颜色缺失/格式错误时报错', () => {
    const doc = createBiomeDefault()
    const effects = doc.effects as Record<string, unknown>
    effects.sky_color = '78A7FF' // 缺 # 前缀
    expect(validateBiomeDoc(doc)).toMatch(/sky_color/)
    effects.sky_color = '#78A7FF'
    delete effects.water_color
    expect(validateBiomeDoc(doc)).toMatch(/water_color/)
  })

  it('可选颜色：空串视为留空（过校验），非法格式报错', () => {
    const doc = createBiomeDefault()
    const effects = doc.effects as Record<string, unknown>
    effects.grass_color = ''
    expect(validateBiomeDoc(doc)).toBeNull()
    effects.grass_color = 'red'
    expect(validateBiomeDoc(doc)).toMatch(/grass_color/)
  })

  it('非法 grass_color_modifier / temperature_modifier 报错', () => {
    const doc = createBiomeDefault()
    ;(doc.effects as Record<string, unknown>).grass_color_modifier = 'weird'
    expect(validateBiomeDoc(doc)).toMatch(/grass_color_modifier/)
    const doc2 = createBiomeDefault()
    doc2.temperature_modifier = 'boiling'
    expect(validateBiomeDoc(doc2)).toMatch(/temperature_modifier/)
  })
})

describe('biome.schema：归一化', () => {
  it('删除空串可选键，保留已填可选键', () => {
    const doc = createBiomeDefault()
    const effects = doc.effects as Record<string, unknown>
    effects.grass_color = ''
    effects.foliage_color = '#59AE30'
    effects.mood_sound = { sound: '', tick_delay: 6000 }
    doc.temperature_modifier = ''
    const out = normalizeBiomeDoc(doc)
    const outEff = out.effects as Record<string, unknown>
    expect('grass_color' in outEff).toBe(false)
    expect(outEff.foliage_color).toBe('#59AE30')
    expect('mood_sound' in outEff).toBe(false)
    expect('temperature_modifier' in out).toBe(false)
    // 不改动原对象
    expect((doc.effects as Record<string, unknown>).grass_color).toBe('')
  })

  it('归一化不丢表单未覆盖字段（spawners/features 直透）', () => {
    const doc = createBiomeDefault()
    doc.spawners = { monster: [{ type: 'minecraft:zombie', weight: 95, minCount: 4, maxCount: 4 }] }
    doc.features = [['minecraft:ore_coal']]
    const out = normalizeBiomeDoc(doc)
    expect(out.spawners).toEqual(doc.spawners)
    expect(out.features).toEqual(doc.features)
  })
})

describe('biome.schema：BIOME_FORM 序列化保留表单未覆盖字段', () => {
  it('serialize 的 {...context, ...value} 语义保留 spawners', () => {
    const doc = createBiomeDefault()
    doc.spawners = { creature: [{ type: 'minecraft:sheep', weight: 12, minCount: 4, maxCount: 4 }] }
    const text = JSON.stringify(doc, null, 2)
    const parsed = BIOME_FORM.parse(text)
    expect(parsed).not.toBeNull()
    const out = JSON.parse(BIOME_FORM.serialize(parsed!.value, parsed!.context)) as Record<
      string,
      unknown
    >
    expect(out.spawners).toEqual(doc.spawners)
    expect(out.temperature).toBe(0.8)
  })
})
