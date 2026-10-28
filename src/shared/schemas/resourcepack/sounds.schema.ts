/**
 * 资源包音效 events 表单（assets/<ns>/sounds.json）。
 * 结构为「音效事件名 → 事件定义」的动态键对象；
 * 事件定义内的 sounds 为数组，表单按对象形态编辑（字符串简写请用源码模式）。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

const CATEGORIES = ['master', 'music', 'record', 'weather', 'block', 'hostile', 'neutral', 'player', 'ambient', 'voice']

function buildSoundsSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  /** 事件定义 */
  const eventSchema: JsonSchema = {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        title: t('schema.rp.sounds.category'),
        enum: CATEGORIES,
        enumLabels: [
          t('schema.rp.sounds.catMaster'),
          t('schema.rp.sounds.catMusic'),
          t('schema.rp.sounds.catRecord'),
          t('schema.rp.sounds.catWeather'),
          t('schema.rp.sounds.catBlock'),
          t('schema.rp.sounds.catHostile'),
          t('schema.rp.sounds.catNeutral'),
          t('schema.rp.sounds.catPlayer'),
          t('schema.rp.sounds.catAmbient'),
          t('schema.rp.sounds.catVoice')
        ]
      },
      subtitle: { type: 'string', title: t('schema.rp.sounds.subtitle'), hint: t('schema.rp.sounds.subtitleHint') },
      sounds: {
        type: 'array',
        title: t('schema.rp.sounds.sounds'),
        description: t('schema.rp.sounds.soundsDesc'),
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', title: t('schema.rp.sounds.audioName'), hint: t('schema.rp.sounds.audioNameHint') },
            volume: { type: 'number', title: t('schema.rp.sounds.volume'), hint: t('schema.rp.sounds.volumeHint') },
            pitch: { type: 'number', title: t('schema.rp.sounds.pitch') },
            weight: { type: 'integer', title: t('schema.rp.sounds.weight'), hint: t('schema.rp.sounds.weightHint') },
            stream: { type: 'boolean', title: t('schema.rp.sounds.stream'), hint: t('schema.rp.sounds.streamHint') }
          }
        }
      },
      replace: { type: 'boolean', title: t('schema.rp.sounds.replace'), hint: t('schema.rp.sounds.replaceHint') }
    }
  }
  return {
    type: 'object',
    title: t('schema.rp.sounds.title'),
    keyValue: {
      keyTitle: t('schema.rp.sounds.eventKey'),
      valueTitle: t('schema.rp.sounds.eventValue'),
      keyPlaceholder: 'block.mymod.ruby_break',
      valueSchema: eventSchema
    }
  }
}

export const SOUNDS_SCHEMA: JsonSchema = buildSoundsSchema()

/** 按语言重建音效事件 Schema（语言切换时由消费侧 computed 调用） */
export function getSoundsSchema(locale?: SharedLocale): JsonSchema {
  return buildSoundsSchema(locale)
}

export function createSoundsDefault(): Record<string, unknown> {
  return {
    'block.mymod.ruby_break': {
      category: 'block',
      subtitle: 'subtitles.mymod.block.ruby_break',
      sounds: [{ name: 'mymod:block/ruby_break' }]
    }
  }
}

function buildSoundsForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: buildSoundsSchema(locale),
    createDefault: createSoundsDefault,
    formHint: t('schema.rp.sounds.formHint'),
    sourceHint: t('schema.rp.sounds.sourceHint')
  })
}

export const SOUNDS_FORM: CategoryForm = buildSoundsForm()

/** 按语言重建音效事件表单（语言切换时由消费侧 computed 调用） */
export function getSoundsForm(locale?: SharedLocale): CategoryForm {
  return buildSoundsForm(locale)
}
