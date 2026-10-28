/**
 * 世界生成双子类表单测试：
 * - configured_feature 按 type 裁剪不适用 config 字段；tree 复杂字段保留
 * - placed_feature 修饰符标量裁剪 + 复杂对象（height_range）保留
 * - 旧扁平 worldgen 类别为源码模式（null 表单）
 */
import { describe, expect, it } from 'vitest'
import {
  CONFIGURED_FEATURE_FORM,
  PLACED_FEATURE_FORM,
  createConfiguredOreDefault,
  createConfiguredPatchDefault,
  createPlacedFeatureDefault
} from '../datapack/worldgen.schema'
import { datapackForm } from '../datapack/forms'

describe('configured_feature 表单', () => {
  it('矿石默认值序列化保留矿石三件套', () => {
    const def = createConfiguredOreDefault()
    const text = CONFIGURED_FEATURE_FORM.serialize(def, {})
    const json = JSON.parse(text) as {
      type: string
      config: { size: number; discard_chance_on_air_exposure: number; targets: unknown[] }
    }
    expect(json.type).toBe('minecraft:ore')
    expect(json.config.size).toBe(9)
    expect(json.config.targets).toHaveLength(1)
    expect(json.config).not.toHaveProperty('tries')
  })

  it('矿石 JSON 中残留的随机簇字段在保存时被裁掉', () => {
    const doc = {
      type: 'minecraft:ore',
      config: {
        size: 5,
        targets: [],
        tries: 96,
        xz_spread: 7,
        feature: 'minecraft:flower'
      }
    }
    const json = JSON.parse(CONFIGURED_FEATURE_FORM.serialize(doc, {})) as {
      config: Record<string, unknown>
    }
    expect(json.config).toEqual({ size: 5, targets: [] })
  })

  it('随机簇默认值只保留簇字段', () => {
    const def = createConfiguredPatchDefault()
    const json = JSON.parse(CONFIGURED_FEATURE_FORM.serialize(def, {})) as {
      config: Record<string, unknown>
    }
    expect(json.config).toEqual({
      tries: 96,
      xz_spread: 7,
      y_spread: 3,
      feature: 'minecraft:flower_forest_flowers'
    })
  })

  it('tree 的复杂 config（trunk/foliage placer）原样保留', () => {
    const tree = {
      type: 'minecraft:tree',
      config: {
        trunk_placer: { type: 'minecraft:straight_trunk_placer', base_height: 4 }
      }
    }
    const json = JSON.parse(CONFIGURED_FEATURE_FORM.serialize(tree, tree)) as {
      config: Record<string, unknown>
    }
    expect(json.config['trunk_placer']).toEqual({
      type: 'minecraft:straight_trunk_placer',
      base_height: 4
    })
  })

  it('parse 合法 JSON 成功，非对象文本返回 null', () => {
    const text = JSON.stringify(createConfiguredOreDefault())
    expect(CONFIGURED_FEATURE_FORM.parse(text)?.value['type']).toBe('minecraft:ore')
    expect(CONFIGURED_FEATURE_FORM.parse('[1,2,3]')).toBeNull()
    expect(CONFIGURED_FEATURE_FORM.parse('{bad')).toBeNull()
  })
})

describe('placed_feature 表单', () => {
  it('默认值引用 configured_feature 且含 height_range 复杂对象', () => {
    const json = JSON.parse(PLACED_FEATURE_FORM.serialize(createPlacedFeatureDefault(), {})) as {
      feature: string
      placement: Array<Record<string, unknown>>
    }
    expect(json.feature).toBe('mymod:ruby_ore')
    expect(json.placement[0]).toEqual({ type: 'minecraft:count', count: 8 })
    expect(json.placement.find((p) => p['type'] === 'minecraft:height_range')?.['height']).toBeTruthy()
  })

  it('按修饰符类型裁掉不适用标量，复杂字段保留', () => {
    const doc = {
      feature: 'mymod:x',
      placement: [
        { type: 'minecraft:rarity_filter', chance: 0.1, count: 3 },
        { type: 'minecraft:in_square', count: 2, chance: 0.5 },
        { type: 'minecraft:height_range', height: { type: 'minecraft:uniform' }, count: 1 }
      ]
    }
    const json = JSON.parse(PLACED_FEATURE_FORM.serialize(doc, {})) as {
      placement: Array<Record<string, unknown>>
    }
    expect(json.placement[0]).toEqual({ type: 'minecraft:rarity_filter', chance: 0.1 })
    expect(json.placement[1]).toEqual({ type: 'minecraft:in_square' })
    expect(json.placement[2]).toEqual({
      type: 'minecraft:height_range',
      height: { type: 'minecraft:uniform' }
    })
  })
})

describe('表单注册表', () => {
  it('旧扁平 worldgen 为源码模式，两个地物子类有表单', () => {
    expect(datapackForm('worldgen')).toBeNull()
    expect(datapackForm('worldgen_configured_feature')).toBe(CONFIGURED_FEATURE_FORM)
    expect(datapackForm('worldgen_placed_feature')).toBe(PLACED_FEATURE_FORM)
  })
})
