/**
 * 数据包物品修饰器 JSON 表单（data/<ns>/item_modifiers/<id>.json）。
 * 物品修饰器为「函数名 + 参数」的平铺结构，表单覆盖常用函数；
 * 条件（conditions）与函数链的复杂组合请使用源码模式。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

const FUNCTIONS = [
  'minecraft:set_count',
  'minecraft:set_damage',
  'minecraft:set_name',
  'minecraft:set_nbt',
  'minecraft:set_lore',
  'minecraft:enchant_randomly',
  'minecraft:enchant_with_levels',
  'minecraft:looting_enchant',
  'minecraft:furnace_smelt',
  'minecraft:explosion_decay',
  'minecraft:limit_count',
  'minecraft:apply_bonus',
  'minecraft:copy_name',
  'minecraft:set_potion'
]

function buildItemModifierSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    type: 'object',
    title: t('schema.datapack.itemModifier.title'),
    properties: {
      function: {
        type: 'string',
        title: t('schema.datapack.itemModifier.function'),
        enum: FUNCTIONS,
        enumLabels: [
          t('schema.datapack.itemModifier.fnSetCount'),
          t('schema.datapack.itemModifier.fnSetDamage'),
          t('schema.datapack.itemModifier.fnSetName'),
          t('schema.datapack.itemModifier.fnSetNbt'),
          t('schema.datapack.itemModifier.fnSetLore'),
          t('schema.datapack.itemModifier.fnEnchantRandomly'),
          t('schema.datapack.itemModifier.fnEnchantWithLevels'),
          t('schema.datapack.itemModifier.fnLootingEnchant'),
          t('schema.datapack.itemModifier.fnFurnaceSmelt'),
          t('schema.datapack.itemModifier.fnExplosionDecay'),
          t('schema.datapack.itemModifier.fnLimitCount'),
          t('schema.datapack.itemModifier.fnApplyBonus'),
          t('schema.datapack.itemModifier.fnCopyName'),
          t('schema.datapack.itemModifier.fnSetPotion')
        ]
      },
      count: { type: 'integer', title: t('schema.datapack.itemModifier.count'), hint: t('schema.datapack.itemModifier.countHint') },
      damage: { type: 'number', title: t('schema.datapack.itemModifier.damage'), hint: t('schema.datapack.itemModifier.damageHint') },
      name: { type: 'string', title: t('schema.datapack.itemModifier.name'), hint: t('schema.datapack.itemModifier.nameHint') },
      nbt: { type: 'string', title: t('schema.datapack.itemModifier.nbt'), hint: t('schema.datapack.itemModifier.nbtHint') },
      enchantments: {
        type: 'array',
        title: t('schema.datapack.itemModifier.enchantments'),
        items: { type: 'string', title: t('schema.datapack.itemModifier.enchantmentId') }
      },
      levels: {
        type: 'object',
        title: t('schema.datapack.itemModifier.levels'),
        properties: {
          min: { type: 'integer', title: t('schema.datapack.itemModifier.levelMin') },
          max: { type: 'integer', title: t('schema.datapack.itemModifier.levelMax') }
        }
      },
      limit: {
        type: 'object',
        title: t('schema.datapack.itemModifier.limit'),
        properties: {
          min: { type: 'integer', title: t('schema.datapack.itemModifier.limitMin') },
          max: { type: 'integer', title: t('schema.datapack.itemModifier.limitMax') }
        }
      },
      conditions: {
        type: 'array',
        title: t('schema.datapack.itemModifier.conditions'),
        description: t('schema.datapack.itemModifier.conditionsDesc'),
        items: {
          type: 'object',
          properties: {
            condition: { type: 'string', title: t('schema.datapack.itemModifier.conditionType') },
            chance: { type: 'number', title: t('schema.datapack.itemModifier.chance') }
          }
        }
      }
    },
    required: ['function']
  }
}

export const ITEM_MODIFIER_SCHEMA: JsonSchema = buildItemModifierSchema()

/** 按语言重建物品修饰器 Schema（语言切换时由消费侧 computed 调用） */
export function getItemModifierSchema(locale?: SharedLocale): JsonSchema {
  return buildItemModifierSchema(locale)
}

export function createItemModifierDefault(): Record<string, unknown> {
  return { function: 'minecraft:set_count', count: 1 }
}

function buildItemModifierForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: buildItemModifierSchema(locale),
    createDefault: createItemModifierDefault,
    formHint: t('schema.datapack.itemModifier.formHint'),
    sourceHint: t('schema.datapack.itemModifier.sourceHint')
  })
}

export const ITEM_MODIFIER_FORM: CategoryForm = buildItemModifierForm()

/** 按语言重建物品修饰器表单（语言切换时由消费侧 computed 调用） */
export function getItemModifierForm(locale?: SharedLocale): CategoryForm {
  return buildItemModifierForm(locale)
}
