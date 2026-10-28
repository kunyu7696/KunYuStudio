/**
 * 光影包配置表单（shaders/<packId>/shaders/shaders.properties）。
 * 文件为 key=value 文本，注释行在保存时原样保留；
 * 复杂选项（sliders/screen 等结构化声明）建议使用源码模式。
 */
import type { JsonSchema } from '../jsonSchema'
import { createKeyValueTextForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

function buildShaderConfigSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    type: 'object',
    title: t('schema.shaderpack.configTitle'),
    keyValue: {
      keyTitle: t('schema.shaderpack.configKey'),
      valueTitle: t('schema.shaderpack.configValue'),
      keyPlaceholder: 'shadowMapResolution',
      valuePlaceholder: '2048'
    }
  }
}

export const SHADER_CONFIG_SCHEMA: JsonSchema = buildShaderConfigSchema()

/** 按语言重建光影配置 Schema（语言切换时由消费侧 computed 调用） */
export function getShaderConfigSchema(locale?: SharedLocale): JsonSchema {
  return buildShaderConfigSchema(locale)
}

export function createShaderConfigDefault(): Record<string, unknown> {
  return { name: 'My Shaders' }
}

function buildShaderConfigForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createKeyValueTextForm({
    schema: buildShaderConfigSchema(locale),
    createDefault: createShaderConfigDefault,
    formHint: t('schema.shaderpack.configFormHint'),
    sourceHint: t('schema.shaderpack.configSourceHint')
  })
}

export const SHADER_CONFIG_FORM: CategoryForm = buildShaderConfigForm()

/** 按语言重建光影配置表单（语言切换时由消费侧 computed 调用） */
export function getShaderConfigForm(locale?: SharedLocale): CategoryForm {
  return buildShaderConfigForm(locale)
}
