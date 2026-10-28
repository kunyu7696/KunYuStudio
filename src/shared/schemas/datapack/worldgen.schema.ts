/**
 * 数据包世界生成 JSON 表单。
 *
 * 1.20.1 / 1.21.1 的世界生成注册表按子目录组织：
 * - data/<ns>/worldgen/configured_feature/<id>.json：地物「是什么」（矿石/树/花草簇…）
 * - data/<ns>/worldgen/placed_feature/<id>.json：地物「在哪、生成几次」
 *
 * 表单只覆盖最高频的简单形态：
 * - configured_feature：ore（矿脉）与 random_patch（花/草簇）；tree 等嵌套
 *   trunk/foliage placer 的复杂形态保留源码模式编辑（表单不覆盖字段不丢失）；
 * - placed_feature：count / in_square / biome / rarity_filter 等简单修饰符；
 *   height_range 等带内联 provider 的修饰符原样保留，请在源码模式微调。
 *
 * 保存时按地物类型裁剪「不适用于当前类型」的表单字段，避免把矿石参数写进花簇 JSON。
 */
import type { JsonSchema } from '../jsonSchema'
import { createJsonForm, isPlainObject, type CategoryForm } from '../forms'
import { sharedT, type SharedLocale } from '../../i18n'

const CONFIGURED_TYPES = ['minecraft:ore', 'minecraft:tree', 'minecraft:random_patch']

function buildConfiguredSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  /** 矿石替换目标：在哪些方块里生成 */
  const oreTargetSchema: JsonSchema = {
    type: 'object',
    properties: {
      target: {
        type: 'object',
        title: t('schema.datapack.worldgen.oreTarget'),
        properties: {
          predicate_type: {
            type: 'string',
            title: t('schema.datapack.worldgen.predicateType'),
            hint: t('schema.datapack.worldgen.predicateTypeHint')
          },
          tag: { type: 'string', title: t('schema.datapack.worldgen.tagId'), hint: t('schema.datapack.worldgen.tagIdHint') },
          block: { type: 'string', title: t('schema.datapack.worldgen.blockId'), hint: t('schema.datapack.worldgen.blockIdHint') }
        }
      },
      state: {
        type: 'object',
        title: t('schema.datapack.worldgen.state'),
        properties: {
          Name: { type: 'string', title: t('schema.datapack.worldgen.stateName'), hint: t('schema.datapack.worldgen.stateNameHint') },
          Properties: {
            type: 'object',
            title: t('schema.datapack.worldgen.properties'),
            keyValue: {
              keyTitle: t('schema.datapack.worldgen.propKey'),
              valueTitle: t('schema.datapack.worldgen.propValue'),
              keyPlaceholder: 'stage',
              valuePlaceholder: '0'
            }
          }
        }
      }
    }
  }
  return {
    type: 'object',
    title: t('schema.datapack.worldgen.configuredTitle'),
    properties: {
      type: {
        type: 'string',
        title: t('schema.datapack.worldgen.type'),
        enum: CONFIGURED_TYPES,
        enumLabels: [
          t('schema.datapack.worldgen.cfgOre'),
          t('schema.datapack.worldgen.cfgTree'),
          t('schema.datapack.worldgen.cfgRandomPatch')
        ]
      },
      config: {
        type: 'object',
        title: t('schema.datapack.worldgen.config'),
        properties: {
          size: { type: 'integer', title: t('schema.datapack.worldgen.size'), hint: t('schema.datapack.worldgen.sizeHint') },
          discard_chance_on_air_exposure: {
            type: 'number',
            title: t('schema.datapack.worldgen.discardChance'),
            hint: t('schema.datapack.worldgen.discardChanceHint')
          },
          targets: { type: 'array', title: t('schema.datapack.worldgen.targets'), items: oreTargetSchema },
          tries: { type: 'integer', title: t('schema.datapack.worldgen.tries'), hint: t('schema.datapack.worldgen.triesHint') },
          xz_spread: { type: 'integer', title: t('schema.datapack.worldgen.xzSpread'), hint: t('schema.datapack.worldgen.xzSpreadHint') },
          y_spread: { type: 'integer', title: t('schema.datapack.worldgen.ySpread'), hint: t('schema.datapack.worldgen.ySpreadHint') },
          feature: {
            type: 'string',
            title: t('schema.datapack.worldgen.feature'),
            hint: t('schema.datapack.worldgen.featureHint')
          }
        }
      }
    },
    required: ['type']
  }
}

/** 已配置地物表单：矿石字段与随机簇字段同屏，字段 hint 标注各自适用类型 */
export const WORLDGEN_CONFIGURED_SCHEMA: JsonSchema = buildConfiguredSchema()

/** 按语言重建已配置地物 Schema（语言切换时由消费侧 computed 调用） */
export function getWorldgenConfiguredSchema(locale?: SharedLocale): JsonSchema {
  return buildConfiguredSchema(locale)
}

/** 放置修饰符类型（表单覆盖简单标量形态；复杂内联 provider 保留源码） */
const PLACEMENT_TYPES = [
  'minecraft:count',
  'minecraft:count_on_every_layer',
  'minecraft:rarity_filter',
  'minecraft:in_square',
  'minecraft:biome',
  'minecraft:height_range',
  'minecraft:block_predicate_filter'
]

function buildPlacedSchema(locale?: SharedLocale): JsonSchema {
  const t = (key: string): string => sharedT(key, undefined, locale)
  const placementItemSchema: JsonSchema = {
    type: 'object',
    title: t('schema.datapack.worldgen.placementItem'),
    properties: {
      type: {
        type: 'string',
        title: t('schema.datapack.worldgen.placementType'),
        enum: PLACEMENT_TYPES,
        enumLabels: [
          t('schema.datapack.worldgen.plCount'),
          t('schema.datapack.worldgen.plCountOnEveryLayer'),
          t('schema.datapack.worldgen.plRarityFilter'),
          t('schema.datapack.worldgen.plInSquare'),
          t('schema.datapack.worldgen.plBiome'),
          t('schema.datapack.worldgen.plHeightRange'),
          t('schema.datapack.worldgen.plBlockPredicate')
        ]
      },
      count: { type: 'integer', title: t('schema.datapack.worldgen.count'), hint: t('schema.datapack.worldgen.countHint') },
      chance: { type: 'number', title: t('schema.datapack.worldgen.chance'), hint: t('schema.datapack.worldgen.chanceHint') }
    }
  }
  return {
    type: 'object',
    title: t('schema.datapack.worldgen.placedTitle'),
    properties: {
      feature: {
        type: 'string',
        title: t('schema.datapack.worldgen.placedFeature'),
        hint: t('schema.datapack.worldgen.placedFeatureHint')
      },
      placement: { type: 'array', title: t('schema.datapack.worldgen.placement'), items: placementItemSchema }
    },
    required: ['feature']
  }
}

/** 放置地物表单：引用一个 configured_feature + 顺序修饰符列表 */
export const WORLDGEN_PLACED_SCHEMA: JsonSchema = buildPlacedSchema()

/** 按语言重建放置地物 Schema（语言切换时由消费侧 computed 调用） */
export function getWorldgenPlacedSchema(locale?: SharedLocale): JsonSchema {
  return buildPlacedSchema(locale)
}

/** 矿石型已配置地物默认值（红宝石矿风格起步） */
export function createConfiguredOreDefault(): Record<string, unknown> {
  return {
    type: 'minecraft:ore',
    config: {
      size: 9,
      discard_chance_on_air_exposure: 0,
      targets: [
        {
          target: { predicate_type: 'minecraft:tag_match', tag: 'minecraft:stone_ore_replaceables' },
          state: { Name: 'minecraft:stone' }
        }
      ]
    }
  }
}

/** 随机簇型已配置地物默认值（花草地物起步） */
export function createConfiguredPatchDefault(): Record<string, unknown> {
  return {
    type: 'minecraft:random_patch',
    config: {
      tries: 96,
      xz_spread: 7,
      y_spread: 3,
      feature: 'minecraft:flower_forest_flowers'
    }
  }
}

/** 放置地物默认值：Y 0..64 均匀、每簇 8 个的经典矿石放置 */
export function createPlacedFeatureDefault(): Record<string, unknown> {
  return {
    feature: 'mymod:ruby_ore',
    placement: [
      { type: 'minecraft:count', count: 8 },
      { type: 'minecraft:in_square' },
      {
        type: 'minecraft:height_range',
        height: {
          type: 'minecraft:uniform',
          min_inclusive: { type: 'minecraft:constant', value: 0 },
          max_inclusive: { type: 'minecraft:constant', value: 64 }
        }
      },
      { type: 'minecraft:biome' }
    ]
  }
}

const ORE_CONFIG_KEYS = ['size', 'discard_chance_on_air_exposure', 'targets']
const PATCH_CONFIG_KEYS = ['tries', 'xz_spread', 'y_spread', 'feature']

/** 已配置地物序列化：按 type 删除不适用于当前类型的 config 表单字段 */
function serializeConfiguredFeature(value: Record<string, unknown>, context: unknown): string {
  const base = isPlainObject(context) ? structuredClone(context) : {}
  const doc = isPlainObject(value) ? structuredClone(value) : base
  const type = typeof doc['type'] === 'string' ? doc['type'] : ''
  const config = isPlainObject(doc['config']) ? doc['config'] : {}
  if (type === 'minecraft:ore') {
    for (const k of Object.keys(config)) if (!ORE_CONFIG_KEYS.includes(k)) delete config[k]
  } else if (type === 'minecraft:random_patch') {
    for (const k of Object.keys(config)) if (!PATCH_CONFIG_KEYS.includes(k)) delete config[k]
  }
  // tree 及其它复杂类型：表单不覆盖 config，原样保留
  doc['config'] = config
  return `${JSON.stringify(doc, null, 2)}\n`
}

/** 放置地物序列化：按修饰符类型删除不适用的标量字段（count/chance 之外的复杂对象原样保留） */
function serializePlacedFeature(value: Record<string, unknown>, context: unknown): string {
  const doc = isPlainObject(value)
    ? structuredClone(value)
    : isPlainObject(context)
      ? structuredClone(context)
      : {}
  const placement = Array.isArray(doc['placement']) ? doc['placement'] : []
  for (const item of placement) {
    if (!isPlainObject(item)) continue
    const t = typeof item['type'] === 'string' ? item['type'] : ''
    if (t !== 'minecraft:count' && t !== 'minecraft:count_on_every_layer') delete item['count']
    if (t !== 'minecraft:rarity_filter') delete item['chance']
    // height_range / block_predicate_filter 等复杂字段不在此列，原样保留
  }
  doc['placement'] = placement
  return `${JSON.stringify(doc, null, 2)}\n`
}

function buildConfiguredFeatureForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  const form = createJsonForm({
    schema: buildConfiguredSchema(locale),
    createDefault: createConfiguredOreDefault,
    formHint: t('schema.datapack.worldgen.configuredFormHint'),
    sourceHint: t('schema.datapack.worldgen.configuredSourceHint')
  })
  // 覆盖默认序列化：按地物类型裁剪表单字段
  form.serialize = serializeConfiguredFeature
  return form
}

/** 已配置地物类别表单（矿石/随机簇表单化，树走源码保留） */
export const CONFIGURED_FEATURE_FORM: CategoryForm = buildConfiguredFeatureForm()

/** 按语言重建已配置地物表单（语言切换时由消费侧 computed 调用） */
export function getConfiguredFeatureForm(locale?: SharedLocale): CategoryForm {
  return buildConfiguredFeatureForm(locale)
}

function buildPlacedFeatureForm(locale?: SharedLocale): CategoryForm {
  const t = (key: string): string => sharedT(key, undefined, locale)
  const form = createJsonForm({
    schema: buildPlacedSchema(locale),
    createDefault: createPlacedFeatureDefault,
    formHint: t('schema.datapack.worldgen.placedFormHint'),
    sourceHint: t('schema.datapack.worldgen.placedSourceHint')
  })
  form.serialize = serializePlacedFeature
  return form
}

/** 放置地物类别表单 */
export const PLACED_FEATURE_FORM: CategoryForm = buildPlacedFeatureForm()

/** 按语言重建放置地物表单（语言切换时由消费侧 computed 调用） */
export function getPlacedFeatureForm(locale?: SharedLocale): CategoryForm {
  return buildPlacedFeatureForm(locale)
}
