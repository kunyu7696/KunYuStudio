/**
 * 物品标签 JSON 结构（data/<ns>/tags/items/<id>.json）。
 * TAG_SCHEMA 是 SchemaForm 表单框架的首个消费者；保存时与原文档合并以保留未知字段。
 */
import type { JsonSchema } from '../jsonSchema'
import { sharedT, type SharedLocale } from '../../i18n'

/** 物品标签 JSON 的表单覆盖范围 */
export interface TagJson {
  replace: boolean
  values: string[]
}

function buildTagSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    type: 'object',
    title: t('schema.datapack.tag.title'),
    properties: {
      replace: {
        type: 'boolean',
        title: t('schema.datapack.tag.replace'),
        description: t('schema.datapack.tag.replaceDesc')
      },
      values: {
        type: 'array',
        title: t('schema.datapack.tag.values'),
        description: t('schema.datapack.tag.valuesDesc'),
        items: { type: 'string', title: t('schema.datapack.tag.itemId') }
      }
    },
    required: ['values']
  }
}

/** 物品标签 JSON Schema（draft-07 子集，冻结常量为 zh-CN 文案） */
export const TAG_SCHEMA: JsonSchema = buildTagSchema()

/** 按语言重建物品标签 Schema（语言切换时由消费侧 computed 调用） */
export function getTagSchema(locale?: SharedLocale): JsonSchema {
  return buildTagSchema(locale)
}

/** 新建物品标签的默认值 */
export function createTagTemplate(): TagJson {
  return { replace: false, values: [] }
}

/** 判断解析出的 JSON 是否具备 TagJson 形态（用于读取容错） */
export function isTagJson(v: unknown): v is TagJson {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Partial<TagJson>
  return typeof t.replace === 'boolean' && Array.isArray(t.values)
}
