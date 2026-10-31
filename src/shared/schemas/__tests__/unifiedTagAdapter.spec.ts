/**
 * tag 统一适配层往返测试。
 * 标签是纯数据包类型：java/assets 端为空壳，JSON 本体（replace/values）承载于 data.tags[0]；
 * 重点验证 TagDef → UnifiedContent → TagDef 逐字段无损，以及注册表维度不丢。
 */
import { describe, expect, it } from 'vitest'
import { tagToUnified, unifiedToTag } from '../unified.adapter'
import {
  createTagDef,
  tagDefFromJson,
  tagJsonFromDef,
  validateTagDef
} from '../datapack/tag.schema'
import {
  createDefaultUnifiedTag,
  unifiedTagRegistry,
  validateUnifiedContent
} from '../unified.schema'
import type { TagDef } from '../datapack/tag.schema'

function tagFixture(): TagDef {
  const def = createTagDef('ores', 'block')
  def.displayName = '矿石'
  def.description = '测试标签'
  def.replace = true
  def.values = ['minecraft:iron_ore', '#minecraft:stone_ores']
  return def
}

describe('统一适配层往返：Tag', () => {
  it('TagDef → UnifiedContent → TagDef 深比较无损', () => {
    const def = tagFixture()
    const unified = tagToUnified(def)
    expect(unified.type).toBe('tag')
    expect(unified.java.className).toBe('')
    expect(unified.assets.textures).toEqual({})
    expect(unified.data.tags?.[0]).toEqual({
      registry: 'block',
      id: 'ores',
      replace: true,
      values: ['minecraft:iron_ore', '#minecraft:stone_ores']
    })

    const back = unifiedToTag(unified)
    expect(back).toEqual(def)
  })

  it('displayName 回落链：zh 空取 en，双空取 id', () => {
    const unified = tagToUnified(tagFixture())
    unified.displayName.zh_cn = '  '
    unified.displayName.en_us = 'Ores'
    expect(unifiedToTag(unified).displayName).toBe('Ores')
    unified.displayName.en_us = ''
    expect(unifiedToTag(unified).displayName).toBe('ores')
  })

  it('values 深拷贝：改 unified 不影响原定义', () => {
    const def = tagFixture()
    const unified = tagToUnified(def)
    unified.data.tags![0].values.push('minecraft:gold_ore')
    expect(def.values).toHaveLength(2)
  })

  it('默认标签对象带注册表维度，可通过统一校验', () => {
    const unified = createDefaultUnifiedTag('ores', 'mymod', 'fluid')
    expect(unifiedTagRegistry(unified)).toBe('fluid')
    expect(validateUnifiedContent(unified)).toBeNull()
  })

  it('非法注册表被统一校验拒绝', () => {
    const unified = createDefaultUnifiedTag('ores')
    unified.data.tags![0].registry = 'function' as never
    expect(validateUnifiedContent(unified)).not.toBeNull()
  })

  it('TagDef 与数据包 JSON 互转、校验', () => {
    const def = tagFixture()
    expect(tagJsonFromDef(def)).toEqual({
      replace: true,
      values: ['minecraft:iron_ore', '#minecraft:stone_ores']
    })
    const fromJson = tagDefFromJson('ores', 'block', tagJsonFromDef(def))
    expect(fromJson.registry).toBe('block')
    expect(fromJson.values).toEqual(def.values)
    expect(validateTagDef(def)).toBeNull()
    expect(validateTagDef({ ...def, values: [''] })).not.toBeNull()
  })
})
