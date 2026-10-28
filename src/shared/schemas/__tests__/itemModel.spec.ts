/**
 * 物品模型定义（1.21.4+ items/）语义层单测。
 * 重点：parse/serialize 回环、未知 type 与未覆盖字段透传、模板合法性。
 */
import { describe, expect, it } from 'vitest'
import type { ItemModelDefinition } from '../resourcepack/itemModel'
import {
  ITEM_MODEL_FORM,
  ITEM_MODEL_TEMPLATES,
  createItemModelDefinition,
  createItemModelDoc,
  isItemModelDefinition,
  isKnownItemModelType,
  itemModelTemplateById,
  itemModelTypeOf,
  parseItemModelDoc,
  serializeItemModelDoc
} from '../resourcepack/itemModel'
import { resourcepackForm } from '../resourcepack/forms'

describe('itemModelTypeOf / isKnownItemModelType', () => {
  it('缺省 type 按 model 处理', () => {
    expect(itemModelTypeOf({})).toBe('minecraft:model')
    expect(itemModelTypeOf({ model: 'a:b' })).toBe('minecraft:model')
  })

  it('显式 type 原样返回', () => {
    expect(itemModelTypeOf({ type: 'minecraft:composite' })).toBe('minecraft:composite')
  })

  it('五种核心类型 + empty 为已知，其余未知', () => {
    for (const t of [
      'minecraft:model',
      'minecraft:condition',
      'minecraft:select',
      'minecraft:range_dispatch',
      'minecraft:composite',
      'minecraft:empty'
    ]) {
      expect(isKnownItemModelType(t)).toBe(true)
    }
    expect(isKnownItemModelType('minecraft:special')).toBe(false)
    expect(isKnownItemModelType('minecraft:bundle/selected_item')).toBe(false)
  })
})

describe('createItemModelDefinition 骨架', () => {
  it('各类型骨架合法且带 type', () => {
    for (const t of [
      'minecraft:model',
      'minecraft:condition',
      'minecraft:select',
      'minecraft:range_dispatch',
      'minecraft:composite',
      'minecraft:empty'
    ]) {
      const def = createItemModelDefinition(t)
      expect(def.type).toBe(t)
      expect(isItemModelDefinition(def)).toBe(true)
    }
  })

  it('condition 骨架含 property/on_true/on_false 且子节点为定义', () => {
    const def = createItemModelDefinition('minecraft:condition')
    expect(def.property).toBe('minecraft:using_item')
    expect(isItemModelDefinition(def.on_true)).toBe(true)
    expect(isItemModelDefinition(def.on_false)).toBe(true)
  })
})

describe('parseItemModelDoc / serializeItemModelDoc', () => {
  it('完整回环：condition 嵌套 range_dispatch 不丢字段', () => {
    const src = JSON.stringify(
      {
        model: {
          type: 'minecraft:condition',
          property: 'minecraft:using_item',
          on_true: {
            type: 'minecraft:range_dispatch',
            property: 'minecraft:use_duration',
            scale: 0.5,
            entries: [
              { threshold: 0.5, model: { type: 'minecraft:model', model: 'mypack:item/bow_1' } }
            ],
            fallback: { type: 'minecraft:model', model: 'mypack:item/bow_0' }
          },
          on_false: { type: 'minecraft:model', model: 'mypack:item/bow' }
        }
      },
      null,
      2
    )
    const doc = parseItemModelDoc(src)
    expect(doc).not.toBeNull()
    expect(serializeItemModelDoc(doc!.value, doc!.context)).toBe(`${src}\n`)
  })

  it('顶层未覆盖字段（如 oversized_in_gui）合并保留', () => {
    const src = JSON.stringify({
      oversized_in_gui: true,
      model: { type: 'minecraft:model', model: 'mypack:item/big' }
    })
    const doc = parseItemModelDoc(src)!
    expect(doc.value.oversized_in_gui).toBe(true)
    const out = JSON.parse(serializeItemModelDoc(doc.value, doc.context))
    expect(out.oversized_in_gui).toBe(true)
    expect(out.model.model).toBe('mypack:item/big')
  })

  it('未知 type 节点原样保留', () => {
    const src = JSON.stringify({
      model: {
        type: 'minecraft:special',
        model: { type: 'minecraft:shulker_box', texture: 'mypack:box' },
        tints: [{ type: 'minecraft:dye', default: 16711680 }]
      }
    })
    const doc = parseItemModelDoc(src)!
    const out = JSON.parse(serializeItemModelDoc(doc.value, doc.context))
    expect(out.model.type).toBe('minecraft:special')
    expect(out.model.tints).toEqual([{ type: 'minecraft:dye', default: 16711680 }])
  })

  it('缺 model 键时补空白模型节点', () => {
    const doc = parseItemModelDoc('{}')!
    expect(isItemModelDefinition(doc.value.model)).toBe(true)
    expect((doc.value.model as ItemModelDefinition).type).toBe('minecraft:model')
  })

  it('非法 JSON / 非对象根返回 null', () => {
    expect(parseItemModelDoc('{oops')).toBeNull()
    expect(parseItemModelDoc('[]')).toBeNull()
    expect(parseItemModelDoc('"x"')).toBeNull()
  })
})

describe('预置模板', () => {
  it('五个模板均可构建且产物可序列化', () => {
    expect(ITEM_MODEL_TEMPLATES.map((t) => t.id)).toEqual([
      'single',
      'named',
      'damage',
      'using',
      'composite'
    ])
    for (const t of ITEM_MODEL_TEMPLATES) {
      const def = t.build()
      expect(isKnownItemModelType(itemModelTypeOf(def))).toBe(true)
      const text = serializeItemModelDoc(createItemModelDoc(def), {})
      expect(JSON.parse(text).model.type).toBe(def.type)
    }
  })

  it('命名变材质模板为 select + custom_name', () => {
    const def = itemModelTemplateById('named')!.build()
    expect(def.type).toBe('minecraft:select')
    expect(def.property).toBe('minecraft:custom_name')
    expect(Array.isArray(def.cases)).toBe(true)
    expect(isItemModelDefinition(def.fallback)).toBe(true)
  })

  it('itemModelTemplateById 未命中返回 undefined', () => {
    expect(itemModelTemplateById('nope')).toBeUndefined()
  })
})

describe('CategoryForm 注册', () => {
  it('item_model 类别的 .json 有表单，其余扩展名回落源码', () => {
    expect(resourcepackForm('item_model', 'assets/mypack/items/ruby.json')).toBe(ITEM_MODEL_FORM)
    expect(resourcepackForm('item_model', '')).toBe(ITEM_MODEL_FORM)
    expect(resourcepackForm('item_model', 'assets/mypack/items/readme.txt')).toBeNull()
  })

  it('createDefault 为单一模型文档', () => {
    const def = ITEM_MODEL_FORM.createDefault()
    expect(isItemModelDefinition(def.model)).toBe(true)
    expect((def.model as ItemModelDefinition).type).toBe('minecraft:model')
  })
})
