/**
 * 资源包方块状态 JSON 表单（assets/<ns>/blockstates/<id>.json）。
 * 两种写法：variants（条件 → 单个模型）与 multipart（条件 → 叠加模型）。
 * 表单覆盖 variants；multipart 请使用源码模式。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

function buildBlockstateSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  /** 单个模型引用 */
  const applySchema: JsonSchema = {
    type: 'object',
    properties: {
      model: { type: 'string', title: t('schema.rp.blockstate.modelId'), hint: t('schema.rp.blockstate.modelIdHint') },
      x: { type: 'integer', title: t('schema.rp.blockstate.rotX'), hint: t('schema.rp.blockstate.rotHint') },
      y: { type: 'integer', title: t('schema.rp.blockstate.rotY'), hint: t('schema.rp.blockstate.rotHint') },
      uvlock: { type: 'boolean', title: t('schema.rp.blockstate.uvlock') },
      weight: { type: 'integer', title: t('schema.rp.blockstate.weight'), hint: t('schema.rp.blockstate.weightHint') }
    }
  }
  return {
    type: 'object',
    title: t('schema.rp.blockstate.title'),
    properties: {
      variants: {
        type: 'object',
        title: t('schema.rp.blockstate.variants'),
        description: t('schema.rp.blockstate.variantsDesc'),
        keyValue: {
          keyTitle: t('schema.rp.blockstate.condition'),
          valueTitle: t('schema.rp.blockstate.model'),
          keyPlaceholder: t('schema.rp.blockstate.variantKeyPlaceholder'),
          valueSchema: applySchema
        }
      },
      multipart: {
        type: 'array',
        title: 'multipart',
        description: t('schema.rp.blockstate.multipartDesc'),
        items: {
          type: 'object',
          properties: {
            when: {
              type: 'object',
              title: t('schema.rp.blockstate.condition'),
              description: t('schema.rp.blockstate.whenDesc')
            },
            apply: { ...applySchema, title: t('schema.rp.blockstate.apply') }
          }
        }
      }
    }
  }
}

export const BLOCKSTATE_SCHEMA: JsonSchema = buildBlockstateSchema()

/** 按语言重建方块状态 Schema（语言切换时由消费侧 computed 调用） */
export function getBlockstateSchema(locale?: SharedLocale): JsonSchema {
  return buildBlockstateSchema(locale)
}

export function createBlockstateDefault(): Record<string, unknown> {
  return { variants: { '': { model: 'minecraft:block/cube_all' } } }
}

function buildBlockstateForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: buildBlockstateSchema(locale),
    createDefault: createBlockstateDefault,
    formHint: t('schema.rp.blockstate.formHint'),
    sourceHint: t('schema.rp.blockstate.sourceHint')
  })
}

export const BLOCKSTATE_FORM: CategoryForm = buildBlockstateForm()

/** 按语言重建方块状态表单（语言切换时由消费侧 computed 调用） */
export function getBlockstateForm(locale?: SharedLocale): CategoryForm {
  return buildBlockstateForm(locale)
}
