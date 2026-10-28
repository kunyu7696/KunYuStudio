/**
 * biome / advancement 统一适配层往返测试（M17）。
 * doc 为完整数据包产物 JSON，适配层深拷贝直搬，不做字段级转换；
 * 重点验证 spawners / features 等表单未覆盖字段往返无损。
 */
import { describe, expect, it } from 'vitest'
import {
  biomeToUnified,
  unifiedToBiome,
  advancementToUnified,
  unifiedToAdvancement
} from '../unified.adapter'
import { createDefaultBiome, createDefaultAdvancementContent } from '../../types/content'
import type { BiomeDefinition, AdvancementDefinition } from '../../types/content'
import { createBiomeDefault } from '../datapack/biome.schema'
import { createAdvancementDefault } from '../datapack/advancement.schema'

function biomeFixture(): BiomeDefinition {
  const b = createDefaultBiome('crimson_grove')
  b.displayName = '绯红林地'
  b.description = '测试群系'
  b.doc = createBiomeDefault()
  b.doc.spawners = { monster: [{ type: 'minecraft:zombie', weight: 95, minCount: 4, maxCount: 4 }] }
  b.doc.features = [['minecraft:ore_iron'], ['minecraft:trees_birch']]
  b.doc.carvers = { air: ['minecraft:cave'] }
  return b
}

describe('统一适配层往返：Biome', () => {
  it('doc 往返无损（含 spawners/features/carvers）', () => {
    const b = biomeFixture()
    const unified = biomeToUnified(b)
    expect(unified.type).toBe('biome')
    expect(unified.displayName.zh_cn).toBe('绯红林地')

    const back = unifiedToBiome(unified)
    expect(back.kind).toBe('biome')
    expect(back.id).toBe('crimson_grove')
    expect(back.displayName).toBe('绯红林地')
    expect(back.doc).toEqual(b.doc)
  })

  it('displayName 回落链：zh 空取 en，双空取 id', () => {
    const b = biomeFixture()
    const unified = biomeToUnified(b)
    unified.displayName.zh_cn = '  '
    unified.displayName.en_us = 'Crimson Grove'
    expect(unifiedToBiome(unified).displayName).toBe('Crimson Grove')
    unified.displayName.en_us = ''
    expect(unifiedToBiome(unified).displayName).toBe('crimson_grove')
  })

  it('doc 深拷贝：改 unified 不影响原定义', () => {
    const b = biomeFixture()
    const unified = biomeToUnified(b)
    ;(unified.data.biomeDoc as Record<string, unknown>).temperature = -1.5
    expect(b.doc.temperature).toBe(0.8)
  })
})

describe('统一适配层往返：Advancement', () => {
  it('doc 往返无损（含 criteria/conditions 细节）', () => {
    const a = createDefaultAdvancementContent('mine_diamond') as AdvancementDefinition
    a.displayName = '钻石！'
    a.doc = createAdvancementDefault()
    ;(a.doc.criteria as Record<string, unknown>).has_diamond = {
      trigger: 'minecraft:inventory_changed',
      conditions: { items: [{ items: ['minecraft:diamond'] }] }
    }
    a.doc.parent = 'minecraft:story/root'

    const unified = advancementToUnified(a)
    expect(unified.type).toBe('advancement')
    const back = unifiedToAdvancement(unified)
    expect(back.kind).toBe('advancement')
    expect(back.displayName).toBe('钻石！')
    expect(back.doc).toEqual(a.doc)
  })
})
