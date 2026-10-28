/**
 * 数据包进度 JSON 表单（data/<ns>/advancements/<id>.json）。
 * criteria 是「条件名 → 触发器」的动态键对象，由表单的键值编辑器承载；
 * conditions 等触发器细节保留在源码模式处理。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

const FRAMES = ['task', 'goal', 'challenge']

function buildAdvancementSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    type: 'object',
    title: t('schema.datapack.advancement.title'),
    properties: {
      parent: {
        type: 'string',
        title: t('schema.datapack.advancement.parent'),
        hint: t('schema.datapack.advancement.parentHint')
      },
      display: {
        type: 'object',
        title: t('schema.datapack.advancement.display'),
        properties: {
          icon: {
            type: 'object',
            title: t('schema.datapack.advancement.icon'),
            properties: {
              item: { type: 'string', title: t('schema.datapack.advancement.iconItem') },
              id: { type: 'string', title: t('schema.datapack.advancement.iconId') }
            }
          },
          title: {
            type: 'object',
            title: t('schema.datapack.advancement.displayTitle'),
            properties: { text: { type: 'string', title: t('schema.datapack.advancement.text') } }
          },
          description: {
            type: 'object',
            title: t('schema.datapack.advancement.description'),
            properties: { text: { type: 'string', title: t('schema.datapack.advancement.text') } }
          },
          frame: {
            type: 'string',
            title: t('schema.datapack.advancement.frame'),
            enum: FRAMES,
            enumLabels: [
              t('schema.datapack.advancement.frameTask'),
              t('schema.datapack.advancement.frameGoal'),
              t('schema.datapack.advancement.frameChallenge')
            ]
          },
          background: {
            type: 'string',
            title: t('schema.datapack.advancement.background'),
            hint: t('schema.datapack.advancement.backgroundHint')
          },
          show_toast: { type: 'boolean', title: t('schema.datapack.advancement.showToast') },
          announce_to_chat: { type: 'boolean', title: t('schema.datapack.advancement.announceToChat') },
          hidden: { type: 'boolean', title: t('schema.datapack.advancement.hidden') }
        }
      },
      criteria: {
        type: 'object',
        title: t('schema.datapack.advancement.criteria'),
        description: t('schema.datapack.advancement.criteriaDesc'),
        keyValue: {
          keyTitle: t('schema.datapack.advancement.criteriaKey'),
          valueTitle: t('schema.datapack.advancement.criteriaValue'),
          keyPlaceholder: 'has_iron',
          valueSchema: {
            type: 'object',
            properties: {
              trigger: {
                type: 'string',
                title: t('schema.datapack.advancement.trigger'),
                hint: t('schema.datapack.advancement.triggerHint')
              },
              conditions: {
                type: 'object',
                title: t('schema.datapack.advancement.conditions'),
                description: t('schema.datapack.advancement.conditionsDesc')
              }
            }
          }
        }
      },
      rewards: {
        type: 'object',
        title: t('schema.datapack.advancement.rewards'),
        properties: {
          experience: { type: 'integer', title: t('schema.datapack.advancement.experience') },
          recipes: {
            type: 'array',
            title: t('schema.datapack.advancement.recipes'),
            items: { type: 'string', title: t('schema.datapack.advancement.recipeId') }
          },
          loot: {
            type: 'array',
            title: t('schema.datapack.advancement.loot'),
            items: { type: 'string', title: t('schema.datapack.advancement.lootId') }
          }
        }
      }
    },
    required: ['criteria']
  }
}

export const ADVANCEMENT_SCHEMA: JsonSchema = buildAdvancementSchema()

/** 按语言重建进度 Schema（语言切换时由消费侧 computed 调用） */
export function getAdvancementSchema(locale?: SharedLocale): JsonSchema {
  return buildAdvancementSchema(locale)
}

export function createAdvancementDefault(): Record<string, unknown> {
  return {
    display: {
      icon: { item: 'minecraft:diamond' },
      title: { text: '新的进度' },
      description: { text: '获得一颗钻石' },
      frame: 'task',
      show_toast: true,
      announce_to_chat: true,
      hidden: false
    },
    criteria: { has_diamond: { trigger: 'minecraft:inventory_changed', conditions: {} } }
  }
}

/**
 * 校验 advancement 文档必填键。
 * 通过返回 null，否则返回错误消息（跟随当前共享语言）。
 */
export function validateAdvancementDoc(doc: Record<string, unknown>): string | null {
  const criteria = doc.criteria
  if (
    typeof criteria !== 'object' ||
    criteria === null ||
    Array.isArray(criteria) ||
    Object.keys(criteria as Record<string, unknown>).length === 0
  ) {
    return sharedT('schema.datapack.advancement.errCriteriaRequired')
  }
  if (doc.parent !== undefined && typeof doc.parent !== 'string') {
    return sharedT('schema.datapack.advancement.errParentType')
  }
  const display = doc.display
  if (display !== undefined) {
    if (typeof display !== 'object' || display === null || Array.isArray(display)) {
      return sharedT('schema.datapack.advancement.errDisplayType')
    }
    const frame = (display as Record<string, unknown>).frame
    if (frame !== undefined && !FRAMES.includes(frame as string)) {
      return sharedT('schema.datapack.advancement.errFrameInvalid', { v: FRAMES.join(' / ') })
    }
  }
  return null
}

/** 存盘前归一化：深拷贝避免改动调用方对象 */
export function normalizeAdvancementDoc(doc: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>
}

function buildAdvancementForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: buildAdvancementSchema(locale),
    createDefault: createAdvancementDefault,
    formHint: t('schema.datapack.advancement.formHint'),
    sourceHint: t('schema.datapack.sourceHintJson')
  })
}

export const ADVANCEMENT_FORM: CategoryForm = buildAdvancementForm()

/** 按语言重建进度表单（语言切换时由消费侧 computed 调用） */
export function getAdvancementForm(locale?: SharedLocale): CategoryForm {
  return buildAdvancementForm(locale)
}
