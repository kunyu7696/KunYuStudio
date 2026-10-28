/**
 * 数据包谓词 JSON 表单（data/<ns>/predicates/<id>.json）。
 * 谓词为递归结构（any_of / all_of / inverted 可嵌套），表单只覆盖
 * 顶层 condition 与最常用的判据参数，组合谓词请使用源码模式。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

const CONDITIONS = [
  'minecraft:weather_check',
  'minecraft:random_chance',
  'minecraft:random_chance_with_looting',
  'minecraft:entity_properties',
  'minecraft:location_check',
  'minecraft:block_state_property',
  'minecraft:match_tool',
  'minecraft:inverted',
  'minecraft:any_of',
  'minecraft:all_of',
  'minecraft:alternative'
]

const ENTITY_TARGETS = ['this', 'killer', 'killer_player', 'direct_killer', 'player_killer']

function buildPredicateSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    type: 'object',
    title: t('schema.datapack.predicate.title'),
    properties: {
      condition: {
        type: 'string',
        title: t('schema.datapack.predicate.condition'),
        enum: CONDITIONS,
        enumLabels: [
          t('schema.datapack.predicate.condWeather'),
          t('schema.datapack.predicate.condRandom'),
          t('schema.datapack.predicate.condRandomLooting'),
          t('schema.datapack.predicate.condEntityProps'),
          t('schema.datapack.predicate.condLocation'),
          t('schema.datapack.predicate.condBlockState'),
          t('schema.datapack.predicate.condMatchTool'),
          t('schema.datapack.predicate.condInverted'),
          t('schema.datapack.predicate.condAnyOf'),
          t('schema.datapack.predicate.condAllOf'),
          t('schema.datapack.predicate.condAlternative')
        ]
      },
      chance: { type: 'number', title: t('schema.datapack.predicate.chance'), hint: t('schema.datapack.predicate.chanceHint') },
      raining: { type: 'boolean', title: t('schema.datapack.predicate.raining'), hint: t('schema.datapack.predicate.weatherHint') },
      thundering: { type: 'boolean', title: t('schema.datapack.predicate.thundering'), hint: t('schema.datapack.predicate.weatherHint') },
      value: { type: 'boolean', title: t('schema.datapack.predicate.value'), hint: t('schema.datapack.predicate.valueHint') },
      looting_multiplier: {
        type: 'number',
        title: t('schema.datapack.predicate.lootingMultiplier'),
        hint: t('schema.datapack.predicate.lootingMultiplierHint')
      },
      entity: {
        type: 'string',
        title: t('schema.datapack.predicate.entity'),
        enum: ENTITY_TARGETS,
        enumLabels: [
          t('schema.datapack.predicate.entityThis'),
          t('schema.datapack.predicate.entityKiller'),
          t('schema.datapack.predicate.entityKillerPlayer'),
          t('schema.datapack.predicate.entityDirectKiller'),
          t('schema.datapack.predicate.entityPlayerKiller')
        ]
      },
      predicate: {
        type: 'string',
        title: t('schema.datapack.predicate.predicateType'),
        hint: t('schema.datapack.predicate.predicateTypeHint')
      },
      terms: {
        type: 'array',
        title: t('schema.datapack.predicate.terms'),
        description: t('schema.datapack.predicate.termsDesc'),
        items: {
          type: 'object',
          properties: { condition: { type: 'string', title: t('schema.datapack.predicate.condition') } }
        }
      }
    },
    required: ['condition']
  }
}

export const PREDICATE_SCHEMA: JsonSchema = buildPredicateSchema()

/** 按语言重建谓词 Schema（语言切换时由消费侧 computed 调用） */
export function getPredicateSchema(locale?: SharedLocale): JsonSchema {
  return buildPredicateSchema(locale)
}

export function createPredicateDefault(): Record<string, unknown> {
  return { condition: 'minecraft:weather_check', raining: false, thundering: false }
}

function buildPredicateForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: buildPredicateSchema(locale),
    createDefault: createPredicateDefault,
    formHint: t('schema.datapack.predicate.formHint'),
    sourceHint: t('schema.datapack.predicate.sourceHint')
  })
}

export const PREDICATE_FORM: CategoryForm = buildPredicateForm()

/** 按语言重建谓词表单（语言切换时由消费侧 computed 调用） */
export function getPredicateForm(locale?: SharedLocale): CategoryForm {
  return buildPredicateForm(locale)
}
