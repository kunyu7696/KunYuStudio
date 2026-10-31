/**
 * 物品标签 JSON 结构（data/<ns>/tags/items/<id>.json）。
 * TAG_SCHEMA 是 SchemaForm 表单框架的首个消费者；保存时与原文档合并以保留未知字段。
 */
import type { JsonSchema } from '../jsonSchema'
import { sharedT, type SharedLocale } from '../../i18n'
import type { TagRegistryKind } from '../../dataPath'

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

/**
 * 标签语义定义（统一编辑器与数据包编辑器共用的扁平形态）。
 * 产物路径：data/<ns>/tags/<registry 目录>/<id>.json，registry 目录由 tagRegistryPath 计算。
 * displayName / description 仅用于编辑器展示，不写入产物 JSON。
 */
export interface TagDef {
  kind: 'tag'
  id: string
  displayName: string
  description: string
  registry: TagRegistryKind
  replace: boolean
  values: string[]
  createdAt: number
  updatedAt: number
}

/** 新建标签语义定义（默认物品标签，与数据包编辑器 P0 口径一致） */
export function createTagDef(id: string, registry: TagRegistryKind = 'item'): TagDef {
  const now = Date.now()
  return {
    kind: 'tag',
    id: id || 'new_tag',
    displayName: id || 'new_tag',
    description: '',
    registry,
    replace: false,
    values: [],
    createdAt: now,
    updatedAt: now
  }
}

/** 从数据包 JSON 构造语义定义（displayName 回落到 id） */
export function tagDefFromJson(
  id: string,
  registry: TagRegistryKind,
  json: TagJson,
  updatedAt = Date.now()
): TagDef {
  return {
    kind: 'tag',
    id,
    displayName: id,
    description: '',
    registry,
    replace: json.replace,
    values: [...json.values],
    createdAt: updatedAt,
    updatedAt
  }
}

/** 语义定义 → 数据包产物 JSON（只保留标签本体字段） */
export function tagJsonFromDef(def: TagDef): TagJson {
  return { replace: def.replace, values: [...def.values] }
}

/** 校验标签语义定义；返回错误消息，合法返回 null */
export function validateTagDef(def: TagDef): string | null {
  if (!Array.isArray(def.values)) return sharedT('schema.datapack.tag.errValuesRequired')
  if (def.values.some((v) => typeof v !== 'string' || !v.trim())) {
    return sharedT('schema.datapack.tag.errValuesRequired')
  }
  return null
}
