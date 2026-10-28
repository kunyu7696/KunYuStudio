/**
 * 资源包字体表单（assets/<ns>/font/<id>.json）。
 * 结构为 providers 数组，每项一个字体提供器；表单覆盖常用类型与参数。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

const PROVIDER_TYPES = ['bitmap', 'ttf', 'legacy_unicode', 'space', 'reference']

function buildFontSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  const providerSchema: JsonSchema = {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        title: t('schema.rp.font.providerType'),
        enum: PROVIDER_TYPES,
        enumLabels: [
          t('schema.rp.font.provBitmap'),
          t('schema.rp.font.provTtf'),
          t('schema.rp.font.provLegacyUnicode'),
          t('schema.rp.font.provSpace'),
          t('schema.rp.font.provReference')
        ]
      },
      file: { type: 'string', title: t('schema.rp.font.file'), hint: t('schema.rp.font.fileHint') },
      template: { type: 'string', title: t('schema.rp.font.template'), hint: t('schema.rp.font.templateHint') },
      sizes: { type: 'string', title: t('schema.rp.font.sizes'), hint: t('schema.rp.font.sizesHint') },
      height: { type: 'number', title: t('schema.rp.font.height'), hint: t('schema.rp.font.heightHint') },
      ascent: { type: 'number', title: t('schema.rp.font.ascent'), hint: t('schema.rp.font.ascentHint') },
      chars: {
        type: 'array',
        title: t('schema.rp.font.chars'),
        description: t('schema.rp.font.charsDesc'),
        items: { type: 'string', title: t('schema.rp.font.charRow') }
      },
      advances: {
        type: 'object',
        title: t('schema.rp.font.advances'),
        description: t('schema.rp.font.advancesDesc'),
        keyValue: {
          keyTitle: t('schema.rp.font.char'),
          valueTitle: t('schema.rp.font.width'),
          keyPlaceholder: ' ',
          valuePlaceholder: '4'
        }
      }
    },
    required: ['type']
  }
  return {
    type: 'object',
    title: t('schema.rp.font.title'),
    properties: {
      providers: { type: 'array', title: t('schema.rp.font.providers'), items: providerSchema }
    },
    required: ['providers']
  }
}

export const FONT_SCHEMA: JsonSchema = buildFontSchema()

/** 按语言重建字体 Schema（语言切换时由消费侧 computed 调用） */
export function getFontSchema(locale?: SharedLocale): JsonSchema {
  return buildFontSchema(locale)
}

export function createFontDefault(): Record<string, unknown> {
  return { providers: [] }
}

function buildFontForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: buildFontSchema(locale),
    createDefault: createFontDefault,
    formHint: t('schema.rp.font.formHint'),
    sourceHint: t('schema.rp.font.sourceHint')
  })
}

export const FONT_FORM: CategoryForm = buildFontForm()

/** 按语言重建字体表单（语言切换时由消费侧 computed 调用） */
export function getFontForm(locale?: SharedLocale): CategoryForm {
  return buildFontForm(locale)
}
