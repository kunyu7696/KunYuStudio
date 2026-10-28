/**
 * 资源包语言文件表单（assets/<ns>/lang/en_us.json 等）。
 * 结构为「翻译键 → 译文」的纯键值对象，键由用户自由输入。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

function buildLangSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    type: 'object',
    title: t('schema.rp.lang.title'),
    keyValue: {
      keyTitle: t('schema.rp.lang.keyTitle'),
      valueTitle: t('schema.rp.lang.valueTitle'),
      keyPlaceholder: 'item.mymod.ruby',
      valuePlaceholder: 'Ruby'
    }
  }
}

export const LANG_SCHEMA: JsonSchema = buildLangSchema()

/** 按语言重建语言文件 Schema（语言切换时由消费侧 computed 调用） */
export function getLangSchema(locale?: SharedLocale): JsonSchema {
  return buildLangSchema(locale)
}

export function createLangDefault(): Record<string, unknown> {
  return {}
}

function buildLangForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: buildLangSchema(locale),
    createDefault: createLangDefault,
    formHint: t('schema.rp.lang.formHint'),
    sourceHint: t('schema.rp.lang.sourceHint')
  })
}

export const LANG_FORM: CategoryForm = buildLangForm()

/** 按语言重建语言文件表单（语言切换时由消费侧 computed 调用） */
export function getLangForm(locale?: SharedLocale): CategoryForm {
  return buildLangForm(locale)
}
