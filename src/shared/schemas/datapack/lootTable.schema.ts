/**
 * 数据包战利品表 JSON 表单（data/<ns>/loot_tables/<id>.json）。
 * 覆盖「来源类型 + 掉落池 + 池内条目」三层常见结构；
 * 条目函数（functions）与复杂条件保留在源码模式处理。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

const SOURCE_TYPES = [
  'minecraft:block',
  'minecraft:entity',
  'minecraft:chest',
  'minecraft:fishing',
  'minecraft:gift',
  'minecraft:advancement_reward',
  'minecraft:advancement_entity',
  'minecraft:generic'
]

const ENTRY_TYPES = [
  'minecraft:item',
  'minecraft:tag',
  'minecraft:loot_table',
  'minecraft:empty',
  'minecraft:alternatives',
  'minecraft:group',
  'minecraft:sequence'
]

function buildLootTableSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  /** 池内条目 */
  const entrySchema: JsonSchema = {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        title: t('schema.datapack.lootTable.entryType'),
        enum: ENTRY_TYPES,
        enumLabels: [
          t('schema.datapack.lootTable.entryItem'),
          t('schema.datapack.lootTable.entryTag'),
          t('schema.datapack.lootTable.entryLootTable'),
          t('schema.datapack.lootTable.entryEmpty'),
          t('schema.datapack.lootTable.entryAlternatives'),
          t('schema.datapack.lootTable.entryGroup'),
          t('schema.datapack.lootTable.entrySequence')
        ]
      },
      name: {
        type: 'string',
        title: t('schema.datapack.lootTable.entryName'),
        hint: t('schema.datapack.lootTable.entryNameHint')
      },
      weight: { type: 'integer', title: t('schema.datapack.lootTable.weight'), hint: t('schema.datapack.lootTable.weightHint') },
      quality: { type: 'integer', title: t('schema.datapack.lootTable.quality'), hint: t('schema.datapack.lootTable.qualityHint') },
      count: { type: 'integer', title: t('schema.datapack.lootTable.count'), hint: t('schema.datapack.lootTable.countHint') }
    },
    required: ['type']
  }
  /** 掉落池 */
  const poolSchema: JsonSchema = {
    type: 'object',
    properties: {
      rolls: { type: 'integer', title: t('schema.datapack.lootTable.rolls'), hint: t('schema.datapack.lootTable.rollsHint') },
      bonus_rolls: { type: 'number', title: t('schema.datapack.lootTable.bonusRolls') },
      entries: { type: 'array', title: t('schema.datapack.lootTable.entries'), items: entrySchema }
    },
    required: ['entries']
  }
  return {
    type: 'object',
    title: t('schema.datapack.lootTable.title'),
    properties: {
      type: {
        type: 'string',
        title: t('schema.datapack.lootTable.sourceType'),
        enum: SOURCE_TYPES,
        enumLabels: [
          t('schema.datapack.lootTable.srcBlock'),
          t('schema.datapack.lootTable.srcEntity'),
          t('schema.datapack.lootTable.srcChest'),
          t('schema.datapack.lootTable.srcFishing'),
          t('schema.datapack.lootTable.srcGift'),
          t('schema.datapack.lootTable.srcAdvancementReward'),
          t('schema.datapack.lootTable.srcAdvancementEntity'),
          t('schema.datapack.lootTable.srcGeneric')
        ]
      },
      pools: { type: 'array', title: t('schema.datapack.lootTable.pools'), items: poolSchema }
    },
    required: ['pools']
  }
}

export const LOOT_TABLE_SCHEMA: JsonSchema = buildLootTableSchema()

/** 按语言重建战利品表 Schema（语言切换时由消费侧 computed 调用） */
export function getLootTableSchema(locale?: SharedLocale): JsonSchema {
  return buildLootTableSchema(locale)
}

export function createLootTableDefault(): Record<string, unknown> {
  return {
    type: 'minecraft:block',
    pools: [
      {
        rolls: 1,
        entries: [{ type: 'minecraft:item', name: 'minecraft:stone' }]
      }
    ]
  }
}

function buildLootTableForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: buildLootTableSchema(locale),
    createDefault: createLootTableDefault,
    formHint: t('schema.datapack.lootTable.formHint'),
    sourceHint: t('schema.datapack.sourceHintJson')
  })
}

export const LOOT_TABLE_FORM: CategoryForm = buildLootTableForm()

/** 按语言重建战利品表表单（语言切换时由消费侧 computed 调用） */
export function getLootTableForm(locale?: SharedLocale): CategoryForm {
  return buildLootTableForm(locale)
}
