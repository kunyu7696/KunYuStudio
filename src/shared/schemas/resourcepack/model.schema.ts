/**
 * 资源包模型 JSON 表单（assets/<ns>/models/<子目录>/<id>.json）。
 * 覆盖 parent / 纹层变量 / 明暗等常见字段；
 * elements（自定义立方体几何）与 display（手持变换）保留在源码模式处理。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

function buildModelSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    type: 'object',
    title: t('schema.rp.model.title'),
    properties: {
      parent: {
        type: 'string',
        title: t('schema.rp.model.parent'),
        hint: t('schema.rp.model.parentHint')
      },
      ambientocclusion: {
        type: 'boolean',
        title: t('schema.rp.model.ambientOcclusion'),
        hint: t('schema.rp.model.ambientOcclusionHint')
      },
      gui_light: {
        type: 'string',
        title: t('schema.rp.model.guiLight'),
        enum: ['front', 'side'],
        enumLabels: [t('schema.rp.model.guiFront'), t('schema.rp.model.guiSide')]
      },
      textures: {
        type: 'object',
        title: t('schema.rp.model.textures'),
        description: t('schema.rp.model.texturesDesc'),
        keyValue: {
          keyTitle: t('schema.rp.model.texturesKey'),
          valueTitle: t('schema.rp.model.texturesValue'),
          keyPlaceholder: 'layer0 / particle / #side',
          valuePlaceholder: 'mymod:item/ruby'
        }
      },
      overrides: {
        type: 'array',
        title: t('schema.rp.model.overrides'),
        description: t('schema.rp.model.overridesDesc'),
        items: {
          type: 'object',
          properties: {
            model: { type: 'string', title: t('schema.rp.model.overrideModel') },
            predicate: {
              type: 'object',
              title: t('schema.rp.model.predicate'),
              keyValue: {
                keyTitle: t('schema.rp.model.predicateKey'),
                valueTitle: t('schema.rp.model.predicateValue'),
                keyPlaceholder: 'pulling / damage',
                valuePlaceholder: '1'
              }
            }
          }
        }
      }
    }
  }
}

export const MODEL_SCHEMA: JsonSchema = buildModelSchema()

/** 按语言重建模型 Schema（语言切换时由消费侧 computed 调用） */
export function getModelSchema(locale?: SharedLocale): JsonSchema {
  return buildModelSchema(locale)
}

export function createModelDefault(): Record<string, unknown> {
  return {
    parent: 'minecraft:item/generated',
    textures: { layer0: 'minecraft:item/iron_ingot' }
  }
}

function buildModelForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: buildModelSchema(locale),
    createDefault: createModelDefault,
    formHint: t('schema.rp.model.formHint'),
    sourceHint: t('schema.rp.model.sourceHint')
  })
}

export const MODEL_FORM: CategoryForm = buildModelForm()

/** 按语言重建模型表单（语言切换时由消费侧 computed 调用） */
export function getModelForm(locale?: SharedLocale): CategoryForm {
  return buildModelForm(locale)
}
