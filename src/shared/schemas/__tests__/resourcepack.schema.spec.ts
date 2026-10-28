/**
 * 资源包语义结构测试：元数据、pack_format、分类、路径与模板。
 */
import { describe, expect, it } from 'vitest'
import {
  buildResourcePackMcmeta,
  classifyResourceFile,
  createResourceFileTemplate,
  createResourcePackMeta,
  mcVersionFromPackFormat,
  RESOURCE_CATEGORIES,
  RESOURCE_PACK_FORMATS,
  RESOURCE_PACK_VERSIONS,
  resourceCategoryInfo,
  resourceFileRelPath,
  RESOURCE_TEXT_EXT,
  validateResourcePackMeta,
  type ResourceCategoryInfo
} from '../resourcepack.schema'

const baseInput = {
  packId: 'my_pack',
  name: 'My Pack',
  mcVersion: '1.20.1',
  description: '',
  namespace: 'mymod'
}

describe('RESOURCE_PACK_FORMATS', () => {
  it('覆盖矩阵 8 版本 + 1.21.4~1.21.9（官方资源包口径）', () => {
    expect(RESOURCE_PACK_FORMATS['1.20.1']).toBe(15)
    expect(RESOURCE_PACK_FORMATS['1.21.1']).toBe(34)
    expect(RESOURCE_PACK_FORMATS['1.20.4']).toBe(22)
    expect(RESOURCE_PACK_FORMATS['1.20.6']).toBe(32)
    expect(RESOURCE_PACK_FORMATS['1.21.3']).toBe(42)
    expect(RESOURCE_PACK_FORMATS['1.21.4']).toBe(46)
    expect(RESOURCE_PACK_FORMATS['1.21.5']).toBe(55)
    expect(RESOURCE_PACK_FORMATS['1.21.6']).toBe(63)
    expect(RESOURCE_PACK_FORMATS['1.21.7']).toBe(64)
    expect(RESOURCE_PACK_FORMATS['1.21.8']).toBe(64)
    expect(RESOURCE_PACK_FORMATS['1.21.9']).toBe(69)
    expect(RESOURCE_PACK_VERSIONS).toHaveLength(14)
  })
})

describe('createResourcePackMeta / validateResourcePackMeta', () => {
  it('pack_format 随版本匹配；合法通过', () => {
    const meta = createResourcePackMeta(baseInput)
    expect(meta.packFormat).toBe(15)
    expect(validateResourcePackMeta(meta)).toBeNull()
    expect(createResourcePackMeta({ ...baseInput, mcVersion: '1.21.1' }).packFormat).toBe(34)
  })

  it('name 缺省回退 packId；namespace 缺省 mymod', () => {
    expect(createResourcePackMeta({ ...baseInput, name: '' }).name).toBe('my_pack')
    expect(createResourcePackMeta({ ...baseInput, namespace: '' }).namespace).toBe('mymod')
  })

  it('非法 packId / 空名称 / 非法 namespace / 未知版本报错', () => {
    expect(validateResourcePackMeta(createResourcePackMeta({ ...baseInput, packId: 'Bad!' }))).toContain('包 ID')
    expect(validateResourcePackMeta(createResourcePackMeta({ ...baseInput, name: '  ' }))).toContain('名称')
    expect(validateResourcePackMeta(createResourcePackMeta({ ...baseInput, namespace: 'Bad-NS' }))).toContain('命名空间')
    const bad = createResourcePackMeta({ ...baseInput })
    ;(bad as { mcVersion: string }).mcVersion = '1.18.2'
    // 1.18.2 在映射表中存在（format 8），合法；改为真正未知版本
    ;(bad as { mcVersion: string }).mcVersion = '1.99.9'
    expect(validateResourcePackMeta(bad)).toContain('MC 版本')
  })
})

describe('RESOURCE_CATEGORIES', () => {
  it('8 个分组；sound 不可新建，texture/model/lang/item_model 可新建', () => {
    expect(RESOURCE_CATEGORIES).toHaveLength(8)
    expect(resourceCategoryInfo('texture')?.creatable).toBe(true)
    expect(resourceCategoryInfo('sound')?.creatable).toBe(false)
    expect(resourceCategoryInfo('model')?.creatable).toBe(true)
    expect(resourceCategoryInfo('item_model')?.creatable).toBe(true)
    expect(resourceCategoryInfo('item_model')?.dir).toBe('items')
    expect(resourceCategoryInfo('unknown')).toBeUndefined()
  })

  it('texture 有 4 个子目录，model 有 2 个', () => {
    expect(resourceCategoryInfo('texture')?.subDirs).toEqual(['block', 'item', 'entity', 'gui'])
    expect(resourceCategoryInfo('model')?.subDirs).toEqual(['block', 'item'])
  })
})

describe('classifyResourceFile', () => {
  it('按顶层段分类', () => {
    expect(classifyResourceFile('textures/block/a.png')).toBe('texture')
    expect(classifyResourceFile('models/block/a.json')).toBe('model')
    expect(classifyResourceFile('blockstates/a.json')).toBe('blockstate')
    expect(classifyResourceFile('sounds/a.ogg')).toBe('sound')
    expect(classifyResourceFile('font/default.json')).toBe('font')
    expect(classifyResourceFile('lang/en_us.json')).toBe('lang')
    expect(classifyResourceFile('items/iron_ingot.json')).toBe('item_model')
    expect(classifyResourceFile('custom/a.json')).toBe('other')
  })
})

describe('resourceFileRelPath', () => {
  it('按类别与子目录生成 assets 路径', () => {
    const model = resourceCategoryInfo('model') as ResourceCategoryInfo
    expect(resourceFileRelPath('mymod', model, 'block', 'a.json')).toBe(
      'assets/mymod/models/block/a.json'
    )
    const lang = resourceCategoryInfo('lang') as ResourceCategoryInfo
    expect(resourceFileRelPath('mymod', lang, '', 'zh_cn.json')).toBe(
      'assets/mymod/lang/zh_cn.json'
    )
    const tex = resourceCategoryInfo('texture') as ResourceCategoryInfo
    expect(resourceFileRelPath('mymod', tex, 'item', 'a.png')).toBe(
      'assets/mymod/textures/item/a.png'
    )
  })
})

describe('createResourceFileTemplate', () => {
  it('可新建类别的模板为合法 JSON', () => {
    for (const cat of ['model', 'blockstate', 'font', 'lang'] as const) {
      expect(() => JSON.parse(createResourceFileTemplate(cat))).not.toThrow()
    }
  })
})

describe('buildResourcePackMcmeta', () => {
  it('pack_format 与描述正确；空描述回退名称', () => {
    const parsed = JSON.parse(buildResourcePackMcmeta(createResourcePackMeta(baseInput))) as {
      pack: { pack_format: number; description: string }
    }
    expect(parsed.pack.pack_format).toBe(15)
    expect(parsed.pack.description).toBe('My Pack')
  })
})

describe('RESOURCE_TEXT_EXT', () => {
  it('json/mcmeta/txt 可编辑；png/ogg/ttf 不可', () => {
    expect(RESOURCE_TEXT_EXT.has('.json')).toBe(true)
    expect(RESOURCE_TEXT_EXT.has('.mcmeta')).toBe(true)
    expect(RESOURCE_TEXT_EXT.has('.png')).toBe(false)
    expect(RESOURCE_TEXT_EXT.has('.ogg')).toBe(false)
    expect(RESOURCE_TEXT_EXT.has('.ttf')).toBe(false)
  })
})

describe('mcVersionFromPackFormat', () => {
  it('已知 pack_format 反查版本', () => {
    expect(mcVersionFromPackFormat(15)).toBe('1.20.1')
    expect(mcVersionFromPackFormat(34)).toBe('1.21.1')
    expect(mcVersionFromPackFormat(42)).toBe('1.21.3')
    expect(mcVersionFromPackFormat(46)).toBe('1.21.4')
    expect(mcVersionFromPackFormat(69)).toBe('1.21.9')
  })

  it('未知 pack_format 兜底 1.20.1', () => {
    expect(mcVersionFromPackFormat(999)).toBe('1.20.1')
  })
})
