/**
 * 资源包 pack.mcmeta 表单（包根 pack.mcmeta）。
 * 覆盖 pack_format、描述与 supported_formats 兼容区间；filter 等高级字段保留在源码模式。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'
import { resourcePackFormatHint } from './formats'

function buildPackMetaSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    type: 'object',
    title: t('schema.rp.packMeta.title'),
    properties: {
      pack: {
        type: 'object',
        title: 'pack',
        properties: {
          pack_format: {
            type: 'integer',
            title: 'pack_format',
            hint: resourcePackFormatHint(locale)
          },
          description: {
            type: 'string',
            title: t('schema.rp.packMeta.description'),
            hint: t('schema.rp.packMeta.descriptionHint')
          },
          supported_formats: {
            type: 'object',
            title: t('schema.rp.packMeta.supportedFormats'),
            properties: {
              min_inclusive: { type: 'integer', title: t('schema.rp.packMeta.min') },
              max_inclusive: { type: 'integer', title: t('schema.rp.packMeta.max') }
            }
          }
        }
      }
    },
    required: ['pack']
  }
}

export const PACK_META_SCHEMA: JsonSchema = buildPackMetaSchema()

/** 按语言重建 pack.mcmeta Schema（语言切换时由消费侧 computed 调用） */
export function getPackMetaSchema(locale?: SharedLocale): JsonSchema {
  return buildPackMetaSchema(locale)
}

export function createPackMetaDefault(): Record<string, unknown> {
  return { pack: { pack_format: 15, description: sharedT('schema.rp.packMeta.defaultDescription') } }
}

function buildPackMetaForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: buildPackMetaSchema(locale),
    createDefault: createPackMetaDefault,
    formHint: t('schema.rp.packMeta.formHint'),
    sourceHint: t('schema.rp.packMeta.sourceHint')
  })
}

export const PACK_META_FORM: CategoryForm = buildPackMetaForm()

/** 按语言重建 pack.mcmeta 表单（语言切换时由消费侧 computed 调用） */
export function getPackMetaForm(locale?: SharedLocale): CategoryForm {
  return buildPackMetaForm(locale)
}
