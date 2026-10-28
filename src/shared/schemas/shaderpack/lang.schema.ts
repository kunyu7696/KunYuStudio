/**
 * 光影包多语言表单（shaders/<packId>/shaders/lang/*.lang）。
 * 文件为 key=value 文本，键通常为 option.<选项名> 与 value.<选项值>。
 */
import type { JsonSchema } from '../jsonSchema'
import { createKeyValueTextForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

function buildShaderLangSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    type: 'object',
    title: t('schema.shaderpack.langFormTitle'),
    keyValue: {
      keyTitle: t('schema.shaderpack.langFormKey'),
      valueTitle: t('schema.shaderpack.langFormValue'),
      keyPlaceholder: 'option.SHADOW_QUALITY',
      valuePlaceholder: t('schema.shaderpack.langFormValuePlaceholder')
    }
  }
}

export const SHADER_LANG_SCHEMA: JsonSchema = buildShaderLangSchema()

/** 按语言重建多语言 Schema（语言切换时由消费侧 computed 调用） */
export function getShaderLangSchema(locale?: SharedLocale): JsonSchema {
  return buildShaderLangSchema(locale)
}

export function createShaderLangDefault(): Record<string, unknown> {
  return { 'option.EXAMPLE': sharedT('schema.shaderpack.langExampleValue') }
}

function buildShaderLangForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createKeyValueTextForm({
    schema: buildShaderLangSchema(locale),
    createDefault: createShaderLangDefault,
    formHint: t('schema.shaderpack.langFormHint'),
    sourceHint: t('schema.shaderpack.langFormSourceHint')
  })
}

export const SHADER_LANG_FORM: CategoryForm = buildShaderLangForm()

/** 按语言重建多语言表单（语言切换时由消费侧 computed 调用） */
export function getShaderLangForm(locale?: SharedLocale): CategoryForm {
  return buildShaderLangForm(locale)
}
