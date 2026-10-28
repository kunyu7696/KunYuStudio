/**
 * 数据包配方 JSON 表单（data/<ns>/recipes/<id>.json）。
 * 字段为多种配方类型的并集：仅当前类型用到的字段会被填写。
 * 复杂结构（自定义 ingredients 嵌套、conditions 等）保留在源码模式处理。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

const RECIPE_TYPES = [
  'minecraft:crafting_shaped',
  'minecraft:crafting_shapeless',
  'minecraft:smelting',
  'minecraft:blasting',
  'minecraft:smoking',
  'minecraft:campfire_cooking',
  'minecraft:stonecutting',
  'minecraft:smithing_transform',
  'minecraft:smithing_trim'
]

function buildRecipeSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    type: 'object',
    title: t('schema.datapack.recipe.title'),
    properties: {
      type: {
        type: 'string',
        title: t('schema.datapack.recipe.type'),
        enum: RECIPE_TYPES,
        enumLabels: [
          t('schema.datapack.recipe.typeShaped'),
          t('schema.datapack.recipe.typeShapeless'),
          t('schema.datapack.recipe.typeSmelting'),
          t('schema.datapack.recipe.typeBlasting'),
          t('schema.datapack.recipe.typeSmoking'),
          t('schema.datapack.recipe.typeCampfire'),
          t('schema.datapack.recipe.typeStonecutting'),
          t('schema.datapack.recipe.typeSmithingTransform'),
          t('schema.datapack.recipe.typeSmithingTrim')
        ]
      },
      group: {
        type: 'string',
        title: t('schema.datapack.recipe.group'),
        hint: t('schema.datapack.recipe.groupHint')
      },
      pattern: {
        type: 'array',
        title: t('schema.datapack.recipe.pattern'),
        description: t('schema.datapack.recipe.patternDesc'),
        items: { type: 'string', title: t('schema.datapack.recipe.patternRow') }
      },
      key: {
        type: 'object',
        title: t('schema.datapack.recipe.keyMap'),
        description: t('schema.datapack.recipe.keyMapDesc'),
        keyValue: {
          keyTitle: t('schema.datapack.recipe.keyMapKey'),
          valueTitle: t('schema.datapack.recipe.keyMapValue'),
          keyPlaceholder: 'X',
          valuePlaceholder: t('schema.datapack.recipe.keyMapValuePlaceholder')
        }
      },
      ingredients: {
        type: 'array',
        title: t('schema.datapack.recipe.ingredients'),
        description: t('schema.datapack.recipe.ingredientsDesc'),
        items: {
          type: 'object',
          properties: { item: { type: 'string', title: t('schema.datapack.recipe.itemId') } }
        }
      },
      result: {
        type: 'object',
        title: t('schema.datapack.recipe.result'),
        properties: {
          item: { type: 'string', title: t('schema.datapack.recipe.resultItem') },
          id: { type: 'string', title: t('schema.datapack.recipe.resultId') },
          count: { type: 'integer', title: t('schema.datapack.recipe.count') }
        }
      },
      ingredient: {
        type: 'string',
        title: t('schema.datapack.recipe.ingredient'),
        hint: t('schema.datapack.recipe.ingredientHint')
      },
      template: {
        type: 'string',
        title: t('schema.datapack.recipe.template'),
        hint: t('schema.datapack.recipe.templateHint')
      },
      base: { type: 'string', title: t('schema.datapack.recipe.base'), hint: t('schema.datapack.recipe.templateHint') },
      addition: {
        type: 'string',
        title: t('schema.datapack.recipe.addition'),
        hint: t('schema.datapack.recipe.templateHint')
      },
      experience: {
        type: 'number',
        title: t('schema.datapack.recipe.experience'),
        hint: t('schema.datapack.recipe.experienceHint')
      },
      cookingtime: {
        type: 'integer',
        title: t('schema.datapack.recipe.cookingtime'),
        hint: t('schema.datapack.recipe.cookingtimeHint')
      },
      category: {
        type: 'string',
        title: t('schema.datapack.recipe.category'),
        enum: ['food', 'blocks', 'misc'],
        enumLabels: [
          t('schema.datapack.recipe.catFood'),
          t('schema.datapack.recipe.catBlocks'),
          t('schema.datapack.recipe.catMisc')
        ]
      }
    },
    required: ['type']
  }
}

export const RECIPE_SCHEMA: JsonSchema = buildRecipeSchema()

/** 按语言重建配方 Schema（语言切换时由消费侧 computed 调用） */
export function getRecipeSchema(locale?: SharedLocale): JsonSchema {
  return buildRecipeSchema(locale)
}

export function createRecipeDefault(): Record<string, unknown> {
  return {
    type: 'minecraft:crafting_shaped',
    pattern: ['XXX', 'XXX', 'XXX'],
    key: { X: 'minecraft:iron_ingot' },
    result: { item: 'minecraft:iron_ingot', count: 1 }
  }
}

function buildRecipeForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: buildRecipeSchema(locale),
    createDefault: createRecipeDefault,
    formHint: t('schema.datapack.recipe.formHint'),
    sourceHint: t('schema.datapack.sourceHintJson')
  })
}

export const RECIPE_FORM: CategoryForm = buildRecipeForm()

/** 按语言重建配方表单（语言切换时由消费侧 computed 调用） */
export function getRecipeForm(locale?: SharedLocale): CategoryForm {
  return buildRecipeForm(locale)
}
