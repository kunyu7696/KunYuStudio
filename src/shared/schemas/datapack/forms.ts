/**
 * 数据包各类别的表单注册表：类别 → 表单定义。
 * function 类别为 mcfunction 命令文本，无表单结构，返回 null（编辑器只提供源码模式）。
 */
import type { DataPackCategory } from '../datapack.schema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'
import { createTagTemplate, getTagSchema, TAG_SCHEMA } from './tag.schema'
import { getRecipeForm, RECIPE_FORM } from './recipe.schema'
import { getLootTableForm, LOOT_TABLE_FORM } from './lootTable.schema'
import { ADVANCEMENT_FORM, getAdvancementForm } from './advancement.schema'
import { BIOME_FORM, getBiomeForm } from './biome.schema'
import {
  CONFIGURED_FEATURE_FORM,
  getConfiguredFeatureForm,
  getPlacedFeatureForm,
  PLACED_FEATURE_FORM
} from './worldgen.schema'
import { getPredicateForm, PREDICATE_FORM } from './predicate.schema'
import { getItemModifierForm, ITEM_MODIFIER_FORM } from './itemModifier.schema'

function buildTagForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: locale ? getTagSchema(locale) : TAG_SCHEMA,
    createDefault: () => ({ ...createTagTemplate() }),
    formHint: t('schema.datapack.tag.formHint'),
    sourceHint: t('schema.datapack.sourceHintShort')
  })
}

/** 物品标签（数据包 P0 首个表单化类别） */
export const TAG_FORM: CategoryForm = buildTagForm()

const FORMS: Record<DataPackCategory, CategoryForm | null> = {
  tag: TAG_FORM,
  recipe: RECIPE_FORM,
  loot_table: LOOT_TABLE_FORM,
  advancement: ADVANCEMENT_FORM,
  // 旧的扁平 worldgen 目录仅作源码模式入口（生物群系/结构等）；地物走两个正确的子目录
  worldgen: null,
  worldgen_configured_feature: CONFIGURED_FEATURE_FORM,
  worldgen_placed_feature: PLACED_FEATURE_FORM,
  worldgen_biome: BIOME_FORM,
  predicate: PREDICATE_FORM,
  item_modifier: ITEM_MODIFIER_FORM,
  function: null
}

/** 取某类别的表单定义；null 表示该类内容无法表单化 */
export function datapackForm(category: DataPackCategory): CategoryForm | null {
  return FORMS[category] ?? null
}

/** 按语言重建某类别的表单定义（语言切换时由消费侧 computed 调用）；zh-CN/缺省回落冻结常量 */
export function getDatapackForm(category: DataPackCategory, locale?: SharedLocale): CategoryForm | null {
  if (!locale || locale === 'zh-CN') return datapackForm(category)
  switch (category) {
    case 'tag':
      return buildTagForm(locale)
    case 'recipe':
      return getRecipeForm(locale)
    case 'loot_table':
      return getLootTableForm(locale)
    case 'advancement':
      return getAdvancementForm(locale)
    case 'worldgen_configured_feature':
      return getConfiguredFeatureForm(locale)
    case 'worldgen_placed_feature':
      return getPlacedFeatureForm(locale)
    case 'worldgen_biome':
      return getBiomeForm(locale)
    case 'predicate':
      return getPredicateForm(locale)
    case 'item_modifier':
      return getItemModifierForm(locale)
    default:
      return null
  }
}

/** 新建条目的默认对象（无表单的类别返回空对象，由调用方回落模板） */
export function createDatapackDefault(category: DataPackCategory): Record<string, unknown> {
  return datapackForm(category)?.createDefault() ?? {}
}
