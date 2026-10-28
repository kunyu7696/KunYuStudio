/**
 * 物品模型定义（Item Model Definitions，1.21.4+）语义层。
 *
 * assets/<ns>/items/<id>.json 顶层为 { "model": <definition> }，
 * definition 是递归判别结构：model / condition / select / range_dispatch /
 * composite 五种核心类型可任意互嵌（见知识库 mcwiki 14 篇）。
 *
 * 本文件只含纯类型与纯函数（无 Vue / 无 IPC），供：
 * - 树形表单编辑器（递归渲染 / 类型切换骨架）
 * - CategoryForm 的 parse / serialize（未识别字段与未知 type 原样保留）
 * - 新建文件的预置配方模板
 */
import { sharedT, type SharedLocale } from '../../i18n'

/** 物品模型定义节点（判别联合的宽松形态：未识别字段一律保留） */
export type ItemModelDefinition = Record<string, unknown> & { type?: string }

/** 树编辑器支持控件化编辑的类型；其余 type 原样保留并提示切源码 */
export const ITEM_MODEL_TYPES = [
  'minecraft:model',
  'minecraft:condition',
  'minecraft:select',
  'minecraft:range_dispatch',
  'minecraft:composite',
  'minecraft:empty'
] as const

function buildItemModelTypeLabels(locale?: SharedLocale): Record<string, string> {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    'minecraft:model': t('schema.rp.itemModel.typeModel'),
    'minecraft:condition': t('schema.rp.itemModel.typeCondition'),
    'minecraft:select': t('schema.rp.itemModel.typeSelect'),
    'minecraft:range_dispatch': t('schema.rp.itemModel.typeRangeDispatch'),
    'minecraft:composite': t('schema.rp.itemModel.typeComposite'),
    'minecraft:empty': t('schema.rp.itemModel.typeEmpty')
  }
}

export const ITEM_MODEL_TYPE_LABELS: Record<string, string> = buildItemModelTypeLabels()

/** 按语言重建类型标签表（语言切换时由消费侧 computed 调用） */
export function getItemModelTypeLabels(locale?: SharedLocale): Record<string, string> {
  return buildItemModelTypeLabels(locale)
}

/** condition 常用 property（可自由输入，下列为提示项） */
export const CONDITION_PROPERTIES = [
  'minecraft:using_item',
  'minecraft:has_component',
  'minecraft:selected',
  'minecraft:custom_model_data',
  'minecraft:broken',
  'minecraft:damaged',
  'minecraft:carried',
  'minecraft:shift_down',
  'minecraft:xmas',
  'minecraft:fishing_rod/cast',
  'minecraft:extended_view',
  'minecraft:keybind_down',
  'minecraft:view_entity',
  'minecraft:component',
  'minecraft:bundle/has_selected_item'
]

/** select 常用 property */
export const SELECT_PROPERTIES = [
  'minecraft:custom_name',
  'minecraft:component',
  'minecraft:custom_model_data',
  'minecraft:charge_type',
  'minecraft:trim_material',
  'minecraft:local_time',
  'minecraft:context_dimension',
  'minecraft:display_context',
  'minecraft:main_hand',
  'minecraft:context_entity_type',
  'minecraft:block_state'
]

/** range_dispatch 常用 property */
export const RANGE_DISPATCH_PROPERTIES = [
  'minecraft:damage',
  'minecraft:count',
  'minecraft:custom_model_data',
  'minecraft:time',
  'minecraft:compass',
  'minecraft:bundle/fullness',
  'minecraft:cooldown',
  'minecraft:crossbow/pull',
  'minecraft:use_duration',
  'minecraft:use_cycle'
]

/** 判定值是否为可编辑的定义节点（对象即可，字段透传） */
export function isItemModelDefinition(v: unknown): v is ItemModelDefinition {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 节点类型（缺省按 model 处理，与游戏缺省行为一致） */
export function itemModelTypeOf(def: ItemModelDefinition): string {
  return typeof def.type === 'string' && def.type ? def.type : 'minecraft:model'
}

/** 树编辑器是否有该类型的控件化编辑（未知类型只读保留） */
export function isKnownItemModelType(type: string): boolean {
  return (ITEM_MODEL_TYPES as readonly string[]).includes(type)
}

/** 各类型切换时的骨架（保留切换前已有的同名字段由编辑器层决定，此处给最小合法结构） */
export function createItemModelDefinition(type: string): ItemModelDefinition {
  switch (type) {
    case 'minecraft:condition':
      return {
        type,
        property: 'minecraft:using_item',
        on_true: { type: 'minecraft:model', model: 'mypack:item/example' },
        on_false: { type: 'minecraft:model', model: 'mypack:item/example' }
      }
    case 'minecraft:select':
      return {
        type,
        property: 'minecraft:custom_name',
        cases: [
          {
            when: [sharedT('schema.rp.itemModel.exampleName')],
            model: { type: 'minecraft:model', model: 'mypack:item/example' }
          }
        ],
        fallback: { type: 'minecraft:model', model: 'mypack:item/example' }
      }
    case 'minecraft:range_dispatch':
      return {
        type,
        property: 'minecraft:damage',
        scale: 1,
        entries: [
          { threshold: 0.5, model: { type: 'minecraft:model', model: 'mypack:item/example_worn' } }
        ],
        fallback: { type: 'minecraft:model', model: 'mypack:item/example' }
      }
    case 'minecraft:composite':
      return {
        type,
        models: [
          { type: 'minecraft:model', model: 'mypack:item/example_base' },
          { type: 'minecraft:model', model: 'mypack:item/example_overlay' }
        ]
      }
    case 'minecraft:empty':
      return { type }
    case 'minecraft:model':
    default:
      return { type: 'minecraft:model', model: 'mypack:item/example' }
  }
}

/** 顶层文档骨架：{ "model": <definition> } */
export function createItemModelDoc(def: ItemModelDefinition): Record<string, unknown> {
  return { model: def }
}

/**
 * 解析 items/<id>.json 文本为表单值。
 * 根必须是对象；缺 model 键时补一个空白模型节点（游戏缺省按约定找 models/item/）。
 */
export function parseItemModelDoc(text: string): { value: Record<string, unknown>; context: unknown } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isItemModelDefinition(parsed)) return null
  const value: Record<string, unknown> = { ...parsed }
  if (!isItemModelDefinition(value.model)) {
    value.model = createItemModelDefinition('minecraft:model')
  }
  return { value, context: parsed }
}

/** 表单值（+ 原文档上下文）→ 文本；顶层未覆盖字段（如 oversized_in_gui）合并保留 */
export function serializeItemModelDoc(value: Record<string, unknown>, context: unknown): string {
  const base = isItemModelDefinition(context) ? context : {}
  return `${JSON.stringify({ ...base, ...value }, null, 2)}\n`
}

/** 新建文件的预置配方模板 */
export interface ItemModelTemplate {
  id: string
  label: string
  hint: string
  build(): ItemModelDefinition
}

function buildItemModelTemplates(locale?: SharedLocale): ItemModelTemplate[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    {
      id: 'single',
      label: t('schema.rp.itemModel.tplSingle'),
      hint: t('schema.rp.itemModel.tplSingleHint'),
      build: () => createItemModelDefinition('minecraft:model')
    },
    {
      id: 'named',
      label: t('schema.rp.itemModel.tplNamed'),
      hint: t('schema.rp.itemModel.tplNamedHint'),
      build: () => ({
        type: 'minecraft:select',
        property: 'minecraft:custom_name',
        cases: [
          {
            when: [sharedT('schema.rp.itemModel.exampleGold')],
            model: { type: 'minecraft:model', model: 'mypack:item/example_gold' }
          }
        ],
        fallback: { type: 'minecraft:model', model: 'mypack:item/example' }
      })
    },
    {
      id: 'damage',
      label: t('schema.rp.itemModel.tplDamage'),
      hint: t('schema.rp.itemModel.tplDamageHint'),
      build: () => createItemModelDefinition('minecraft:range_dispatch')
    },
    {
      id: 'using',
      label: t('schema.rp.itemModel.tplUsing'),
      hint: t('schema.rp.itemModel.tplUsingHint'),
      build: () => ({
        type: 'minecraft:condition',
        property: 'minecraft:using_item',
        on_true: { type: 'minecraft:model', model: 'mypack:item/example_using' },
        on_false: { type: 'minecraft:model', model: 'mypack:item/example' }
      })
    },
    {
      id: 'composite',
      label: t('schema.rp.itemModel.tplComposite'),
      hint: t('schema.rp.itemModel.tplCompositeHint'),
      build: () => createItemModelDefinition('minecraft:composite')
    }
  ]
}

export const ITEM_MODEL_TEMPLATES: ItemModelTemplate[] = buildItemModelTemplates()

/** 按语言重建模板清单（语言切换时由消费侧 computed 调用） */
export function getItemModelTemplates(locale?: SharedLocale): ItemModelTemplate[] {
  return buildItemModelTemplates(locale)
}

export function itemModelTemplateById(id: string): ItemModelTemplate | undefined {
  return ITEM_MODEL_TEMPLATES.find((t) => t.id === id)
}

// ---- CategoryForm 注册 ----

import type { JsonSchema } from '../jsonSchema'
import type { CategoryForm } from '../forms'

function buildItemModelFormSchema(locale?: SharedLocale): JsonSchema {
  return { type: 'object', title: sharedT('schema.rp.itemModel.schemaTitle', undefined, locale) }
}

/**
 * 表单渲染由渲染层自定义树编辑器接管，此处 schema 仅用于保存前的
 * Ajv 结构校验（根为对象即通过，字段级校验在树编辑器内完成）。
 */
export const ITEM_MODEL_FORM_SCHEMA: JsonSchema = buildItemModelFormSchema()

function buildItemModelForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    schema: buildItemModelFormSchema(locale),
    createDefault: () => createItemModelDoc(createItemModelDefinition('minecraft:model')),
    parse: parseItemModelDoc,
    serialize: serializeItemModelDoc,
    formHint: t('schema.rp.itemModel.formHint'),
    sourceHint: t('schema.rp.itemModel.sourceHint')
  }
}

export const ITEM_MODEL_FORM: CategoryForm = buildItemModelForm()

/** 按语言重建物品模型表单（语言切换时由消费侧 computed 调用） */
export function getItemModelForm(locale?: SharedLocale): CategoryForm {
  return buildItemModelForm(locale)
}
