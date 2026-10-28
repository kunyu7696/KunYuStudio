/**
 * 数据包语义结构测试：元数据、pack.mcmeta、路径生成、条目模板与物品标签。
 */
import { describe, expect, it } from 'vitest'
import {
  buildPackMcmeta,
  createDataPackMeta,
  createEntryTemplate,
  dataPackCategory,
  dataPackEntryPath,
  DATA_PACK_CATEGORIES,
  mcVersionFromPackFormat,
  PACK_FORMATS,
  validateDataPackMeta,
  type DataPackCategory
} from '../datapack.schema'
import { createTagTemplate, isTagJson, TAG_SCHEMA } from '../datapack/tag.schema'

describe('createDataPackMeta / validateDataPackMeta', () => {
  it('默认锁定 1.20.1 fabric，pack_format 15', () => {
    const meta = createDataPackMeta('mymod', '测试')
    expect(meta.mcVersion).toBe('1.20.1')
    expect(meta.loader).toBe('fabric')
    expect(meta.packFormat).toBe(15)
    expect(validateDataPackMeta(meta)).toBeNull()
  })

  it('命名空间为空兜底 mymod；非法命名空间报错', () => {
    expect(createDataPackMeta('', '').namespace).toBe('mymod')
    const bad = createDataPackMeta('Bad-NS', '')
    expect(validateDataPackMeta(bad)).toContain('命名空间')
  })
})

describe('buildPackMcmeta', () => {
  it('输出含 pack_format 与描述的 JSON', () => {
    const meta = createDataPackMeta('mymod', '我的数据包')
    const text = buildPackMcmeta(meta)
    const parsed = JSON.parse(text) as { pack: { pack_format: number; description: string } }
    expect(parsed.pack.pack_format).toBe(15)
    expect(parsed.pack.description).toBe('我的数据包')
  })

  it('空描述兜底为命名空间描述', () => {
    const parsed = JSON.parse(buildPackMcmeta(createDataPackMeta('mymod', ''))) as {
      pack: { description: string }
    }
    expect(parsed.pack.description).toContain('mymod')
  })
})

describe('dataPackEntryPath', () => {
  it('1.20.1 复数目录', () => {
    expect(dataPackEntryPath('mymod', 'recipe', '1.20.1', 'ruby_sword')).toBe(
      'data/mymod/recipes/ruby_sword.json'
    )
    expect(dataPackEntryPath('mymod', 'loot_table', '1.20.1', 'a')).toBe(
      'data/mymod/loot_tables/a.json'
    )
    expect(dataPackEntryPath('mymod', 'function', '1.20.1', 'a')).toBe(
      'data/mymod/functions/a.mcfunction'
    )
  })

  it('1.21.1 单数目录', () => {
    expect(dataPackEntryPath('mymod', 'recipe', '1.21.1', 'a')).toBe('data/mymod/recipe/a.json')
  })

  it('tag 使用 tags/items 子目录', () => {
    expect(dataPackEntryPath('mymod', 'tag', '1.20.1', 'my_ores')).toBe(
      'data/mymod/tags/items/my_ores.json'
    )
    expect(dataPackEntryPath('mymod', 'tag', '1.21.1', 'my_ores')).toBe(
      'data/mymod/tags/item/my_ores.json'
    )
  })

  it('未知类别抛错', () => {
    expect(() => dataPackEntryPath('mymod', 'nope' as DataPackCategory, '1.20.1', 'a')).toThrow()
  })
})

describe('DATA_PACK_CATEGORIES / createEntryTemplate', () => {
  it('11 个类别均有目录生成器', () => {
    expect(DATA_PACK_CATEGORIES).toHaveLength(11)
    for (const cat of DATA_PACK_CATEGORIES) {
      expect(cat.dir('1.20.1').length).toBeGreaterThan(0)
      expect(cat.dir('1.21.1').length).toBeGreaterThan(0)
    }
  })

  it('世界生成地物目录写入正确的子目录（两版本一致）', () => {
    const cf = dataPackCategory('worldgen_configured_feature')
    const pf = dataPackCategory('worldgen_placed_feature')
    expect(cf?.dir('1.20.1')).toBe('worldgen/configured_feature')
    expect(pf?.dir('1.21.1')).toBe('worldgen/placed_feature')
    expect(
      dataPackEntryPath('mymod', 'worldgen_configured_feature', '1.20.1', 'ruby_ore')
    ).toBe('data/mymod/worldgen/configured_feature/ruby_ore.json')
  })

  it('JSON 类别模板均可解析；function 为 mcfunction 文本', () => {
    for (const cat of DATA_PACK_CATEGORIES) {
      const tpl = createEntryTemplate(cat.key, 'demo', 'mymod')
      expect(tpl.trim().length).toBeGreaterThan(0)
      if (cat.key === 'function') {
        expect(tpl).toContain('tellraw')
      } else {
        expect(() => JSON.parse(tpl)).not.toThrow()
      }
    }
  })

  it('tag 模板为最小合法结构', () => {
    const parsed = JSON.parse(createEntryTemplate('tag', 'demo', 'mymod')) as {
      replace: boolean
      values: string[]
    }
    expect(parsed.replace).toBe(false)
    expect(parsed.values).toEqual([])
  })
})

describe('tag.schema', () => {
  it('createTagTemplate / isTagJson', () => {
    const tag = createTagTemplate()
    expect(isTagJson(tag)).toBe(true)
    expect(isTagJson({ values: [] })).toBe(false)
    expect(isTagJson(null)).toBe(false)
  })

  it('TAG_SCHEMA required 含 values，不含 replace', () => {
    expect(TAG_SCHEMA.required).toEqual(['values'])
    expect(TAG_SCHEMA.properties?.values?.type).toBe('array')
  })

  it('按 key 查询类别注册表', () => {
    expect(dataPackCategory('recipe')?.dir('1.20.1')).toBe('recipes')
    expect(dataPackCategory('unknown')).toBeUndefined()
  })
})

describe('mcVersionFromPackFormat', () => {
  it('已知 pack_format 反查版本', () => {
    expect(mcVersionFromPackFormat(15)).toBe('1.20.1')
    expect(mcVersionFromPackFormat(48)).toBe('1.21.1')
  })

  it('未知 pack_format 兜底 1.20.1', () => {
    expect(mcVersionFromPackFormat(999)).toBe('1.20.1')
  })
})

describe('PACK_FORMATS 全版本（矩阵 8 版本官方数据包口径）', () => {
  it('1.20.4=26 / 1.20.6=41 / 1.21.3=57；legacy 版本也在表内', () => {
    expect(PACK_FORMATS['1.16.5']).toBe(6)
    expect(PACK_FORMATS['1.18.2']).toBe(9)
    expect(PACK_FORMATS['1.19.2']).toBe(10)
    expect(PACK_FORMATS['1.20.4']).toBe(26)
    expect(PACK_FORMATS['1.20.6']).toBe(41)
    expect(PACK_FORMATS['1.21.3']).toBe(57)
  })

  it('单复数目录：仅 1.21.x 单数，其余复数', () => {
    expect(dataPackEntryPath('mymod', 'recipe', '1.20.6', 'a')).toBe('data/mymod/recipes/a.json')
    expect(dataPackEntryPath('mymod', 'recipe', '1.21.3', 'a')).toBe('data/mymod/recipe/a.json')
    expect(dataPackEntryPath('mymod', 'recipe', '1.19.2', 'a')).toBe('data/mymod/recipes/a.json')
  })
})
