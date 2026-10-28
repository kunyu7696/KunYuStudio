/**
 * 生物群系 JSON 表单（data/<ns>/worldgen/biome/<id>.json）。
 *
 * 表单覆盖气候（温度/降水/降水类型）与效果颜色（天空/雾/水/植被）等
 * 表单可承载字段；spawners / spawn_costs / features / carvers 等复杂
 * 字段不进表单，保存时经 CategoryForm.serialize 的 {...context, ...value}
 * 语义自动保留，可在源码模式编辑。
 *
 * 字段对齐 MC 1.20.1+ worldgen/biome JSON。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

const TEMPERATURE_MODIFIERS = ['none', 'frozen']
const GRASS_MODIFIERS = ['none', 'dark_forest', 'swamp']

function buildBiomeSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    type: 'object',
    title: t('schema.datapack.biome.title'),
    properties: {
      temperature: {
        type: 'number',
        title: t('schema.datapack.biome.temperature'),
        hint: t('schema.datapack.biome.temperatureHint')
      },
      downfall: {
        type: 'number',
        title: t('schema.datapack.biome.downfall'),
        hint: t('schema.datapack.biome.downfallHint')
      },
      has_precipitation: {
        type: 'boolean',
        title: t('schema.datapack.biome.hasPrecipitation'),
        hint: t('schema.datapack.biome.hasPrecipitationHint')
      },
      temperature_modifier: {
        type: 'string',
        title: t('schema.datapack.biome.temperatureModifier'),
        enum: TEMPERATURE_MODIFIERS,
        enumLabels: [t('schema.datapack.biome.modNone'), t('schema.datapack.biome.tempModFrozen')],
        hint: t('schema.datapack.biome.temperatureModifierHint')
      },
      effects: {
        type: 'object',
        title: t('schema.datapack.biome.effects'),
        properties: {
          sky_color: {
            type: 'string',
            title: t('schema.datapack.biome.skyColor'),
            hint: t('schema.datapack.biome.hexColorHint')
          },
          fog_color: {
            type: 'string',
            title: t('schema.datapack.biome.fogColor'),
            hint: t('schema.datapack.biome.hexColorHint')
          },
          water_color: {
            type: 'string',
            title: t('schema.datapack.biome.waterColor'),
            hint: t('schema.datapack.biome.hexColorHint')
          },
          water_fog_color: {
            type: 'string',
            title: t('schema.datapack.biome.waterFogColor'),
            hint: t('schema.datapack.biome.hexColorHint')
          },
          grass_color: {
            type: 'string',
            title: t('schema.datapack.biome.grassColor'),
            hint: t('schema.datapack.biome.grassColorHint')
          },
          foliage_color: {
            type: 'string',
            title: t('schema.datapack.biome.foliageColor'),
            hint: t('schema.datapack.biome.foliageColorHint')
          },
          grass_color_modifier: {
            type: 'string',
            title: t('schema.datapack.biome.grassColorModifier'),
            enum: GRASS_MODIFIERS,
            enumLabels: [
              t('schema.datapack.biome.modNone'),
              t('schema.datapack.biome.grassModDarkForest'),
              t('schema.datapack.biome.grassModSwamp')
            ],
            hint: t('schema.datapack.biome.grassColorModifierHint')
          },
          mood_sound: {
            type: 'object',
            title: t('schema.datapack.biome.moodSound'),
            description: t('schema.datapack.biome.moodSoundDesc'),
            properties: {
              sound: { type: 'string', title: t('schema.datapack.biome.sound') },
              tick_delay: { type: 'integer', title: t('schema.datapack.biome.tickDelay') },
              block_search_extent: { type: 'integer', title: t('schema.datapack.biome.blockSearchExtent') },
              offset: { type: 'number', title: t('schema.datapack.biome.offset') }
            }
          }
        },
        required: ['sky_color', 'fog_color', 'water_color', 'water_fog_color']
      }
    },
    required: ['temperature', 'downfall', 'has_precipitation', 'effects']
  }
}

export const BIOME_SCHEMA: JsonSchema = buildBiomeSchema()

/** 按语言重建生物群系 Schema（语言切换时由消费侧 computed 调用） */
export function getBiomeSchema(locale?: SharedLocale): JsonSchema {
  return buildBiomeSchema(locale)
}

/** plains 风格默认值 */
export function createBiomeDefault(): Record<string, unknown> {
  return {
    temperature: 0.8,
    downfall: 0.4,
    has_precipitation: true,
    effects: {
      sky_color: '#78A7FF',
      fog_color: '#C0D8FF',
      water_color: '#3F76E4',
      water_fog_color: '#050533'
    },
    spawners: {},
    features: []
  }
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/**
 * 校验 biome 文档必填键与字段合法性。
 * 通过返回 null，否则返回错误消息（跟随当前共享语言）。
 */
export function validateBiomeDoc(doc: Record<string, unknown>): string | null {
  const t = doc.temperature
  if (typeof t !== 'number' || t < -2 || t > 2) {
    return sharedT('schema.datapack.biome.errTemperature')
  }
  const d = doc.downfall
  if (typeof d !== 'number' || d < 0 || d > 1) {
    return sharedT('schema.datapack.biome.errDownfall')
  }
  if (typeof doc.has_precipitation !== 'boolean') {
    return sharedT('schema.datapack.biome.errHasPrecipitation')
  }
  const tm = doc.temperature_modifier
  if (tm !== undefined && !TEMPERATURE_MODIFIERS.includes(tm as string)) {
    return sharedT('schema.datapack.biome.errTemperatureModifier', { v: TEMPERATURE_MODIFIERS.join(' / ') })
  }
  const effects = doc.effects
  if (typeof effects !== 'object' || effects === null || Array.isArray(effects)) {
    return sharedT('schema.datapack.biome.errEffectsRequired')
  }
  const eff = effects as Record<string, unknown>
  for (const key of ['sky_color', 'fog_color', 'water_color', 'water_fog_color']) {
    const v = eff[key]
    if (typeof v !== 'string' || !HEX_RE.test(v)) {
      return sharedT('schema.datapack.biome.errColorRequired', { k: key })
    }
  }
  for (const key of ['grass_color', 'foliage_color']) {
    const v = eff[key]
    // 空串视为「留空」（表单文本框清空场景），normalize 阶段会删除该键
    if (v !== undefined && v !== '' && (typeof v !== 'string' || !HEX_RE.test(v))) {
      return sharedT('schema.datapack.biome.errColorInvalid', { k: key })
    }
  }
  const gm = eff.grass_color_modifier
  if (gm !== undefined && !GRASS_MODIFIERS.includes(gm as string)) {
    return sharedT('schema.datapack.biome.errGrassModifier', { v: GRASS_MODIFIERS.join(' / ') })
  }
  return null
}

/**
 * 存盘前归一化：删除空串可选键（表单留空时不写入产物 JSON），
 * 深拷贝避免改动调用方对象。
 */
export function normalizeBiomeDoc(doc: Record<string, unknown>): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>
  const eff = out.effects
  if (typeof eff === 'object' && eff !== null && !Array.isArray(eff)) {
    const e = eff as Record<string, unknown>
    for (const key of ['grass_color', 'foliage_color', 'grass_color_modifier']) {
      if (e[key] === '' || e[key] === undefined) delete e[key]
    }
    // mood_sound 为空对象或 sound 为空串时整个移除
    const ms = e.mood_sound
    if (typeof ms === 'object' && ms !== null && !Array.isArray(ms)) {
      const m = ms as Record<string, unknown>
      if (!m.sound || m.sound === '') delete e.mood_sound
    }
  }
  if (out.temperature_modifier === '' || out.temperature_modifier === undefined) {
    delete out.temperature_modifier
  }
  return out
}

function buildBiomeForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return createJsonForm({
    schema: buildBiomeSchema(locale),
    createDefault: createBiomeDefault,
    formHint: t('schema.datapack.biome.formHint'),
    sourceHint: t('schema.datapack.sourceHintJson')
  })
}

export const BIOME_FORM: CategoryForm = buildBiomeForm()

/** 按语言重建生物群系表单（语言切换时由消费侧 computed 调用） */
export function getBiomeForm(locale?: SharedLocale): CategoryForm {
  return buildBiomeForm(locale)
}
