/**
 * 附魔编辑视图的纯逻辑层：SchemaForm 消费的 JsonSchema 与
 * EnchantmentSchema（磁盘形态）↔ 表单模型（damageBonus 拍平为开关+两数值）互转。
 * 抽离为无 Vue 依赖的函数，便于单测。
 */
import type { JsonSchema } from '../../../../shared/schemas/jsonSchema'
import { sharedT } from '../../../../shared/i18n'
import {
  ENCHANTMENT_RARITIES,
  ENCHANTMENT_SLOTS,
  ENCHANTMENT_TARGETS,
  createDefaultEnchantment,
  normalizeEnchantmentSchema,
  validateEnchantmentSchema,
  type EnchantmentItemTarget,
  type EnchantmentRarity,
  type EnchantmentSchema,
  type EnchantmentSlot
} from '../../../../shared/schemas/enchantment.schema'

/** 表单模型：与 SchemaForm 逐字段绑定；可空对象 damageBonus 拍平为开关 + 两标量 */
export interface EnchantFormModel {
  id: string
  displayName: { en_us: string; zh_cn: string }
  description: { en_us: string; zh_cn: string }
  rarity: EnchantmentRarity
  target: EnchantmentItemTarget
  slots: EnchantmentSlot[]
  maxLevel: number
  treasure: boolean
  curse: boolean
  minCostBase: number
  minCostPerLevel: number
  maxCostExtra: number
  anvilCost: number
  damageEnabled: boolean
  damageBase: number
  damagePerLevel: number
}

const RARITY_KEYS: Record<EnchantmentRarity, string> = {
  COMMON: 'schema.enchantment.rarityCommon',
  UNCOMMON: 'schema.enchantment.rarityUncommon',
  RARE: 'schema.enchantment.rarityRare',
  VERY_RARE: 'schema.enchantment.rarityVeryRare'
}

const TARGET_KEYS: Record<EnchantmentItemTarget, string> = {
  ALL: 'schema.enchantment.targetAll',
  ARMOR: 'schema.enchantment.targetArmor',
  ARMOR_FEET: 'schema.enchantment.targetArmorFeet',
  ARMOR_LEGS: 'schema.enchantment.targetArmorLegs',
  ARMOR_CHEST: 'schema.enchantment.targetArmorChest',
  ARMOR_HEAD: 'schema.enchantment.targetArmorHead',
  WEAPON: 'schema.enchantment.targetWeapon',
  TOOL: 'schema.enchantment.targetTool',
  BOW: 'schema.enchantment.targetBow',
  CROSSBOW: 'schema.enchantment.targetCrossbow',
  TRIDENT: 'schema.enchantment.targetTrident',
  FISHING_ROD: 'schema.enchantment.targetFishingRod',
  WEARABLE: 'schema.enchantment.targetWearable',
  BREAKABLE: 'schema.enchantment.targetBreakable',
  VANISHABLE: 'schema.enchantment.targetVanishable'
}

const SLOT_KEYS: Record<EnchantmentSlot, string> = {
  mainhand: 'schema.enchantment.slotMainhand',
  offhand: 'schema.enchantment.slotOffhand',
  head: 'schema.enchantment.slotHead',
  chest: 'schema.enchantment.slotChest',
  legs: 'schema.enchantment.slotLegs',
  feet: 'schema.enchantment.slotFeet'
}

/** 新建表单模型（id 由调用方先行 prompt 获取） */
export function newFormModel(id: string): EnchantFormModel {
  return toFormModel(createDefaultEnchantment(id))
}

/** 磁盘 schema → 表单模型（容忍缺字段） */
export function toFormModel(raw: EnchantmentSchema): EnchantFormModel {
  const e = normalizeEnchantmentSchema(raw)
  return {
    id: e.id,
    displayName: { ...e.displayName },
    description: { ...e.description },
    rarity: e.rarity,
    target: e.target,
    slots: [...e.slots],
    maxLevel: e.maxLevel,
    treasure: e.treasure,
    curse: e.curse,
    minCostBase: e.minCostBase,
    minCostPerLevel: e.minCostPerLevel,
    maxCostExtra: e.maxCostExtra,
    anvilCost: e.anvilCost,
    damageEnabled: e.damageBonus !== null,
    damageBase: e.damageBonus?.base ?? 0,
    damagePerLevel: e.damageBonus?.perLevel ?? 0
  }
}

/** 表单模型 → 可保存的磁盘 schema（经归一化补齐时间戳等） */
export function fromFormModel(m: EnchantFormModel): EnchantmentSchema {
  return normalizeEnchantmentSchema({
    kind: 'enchantment',
    id: m.id,
    displayName: m.displayName,
    description: m.description,
    rarity: m.rarity,
    target: m.target,
    slots: m.slots,
    maxLevel: m.maxLevel,
    treasure: m.treasure,
    curse: m.curse,
    minCostBase: m.minCostBase,
    minCostPerLevel: m.minCostPerLevel,
    maxCostExtra: m.maxCostExtra,
    anvilCost: m.anvilCost,
    damageBonus: m.damageEnabled
      ? { base: m.damageBase, perLevel: m.damagePerLevel }
      : null
  })
}

/** 表单校验；通过返回 null，否则中文错误（与 saveContent 同源校验） */
export function validateForm(m: EnchantFormModel): string | null {
  return validateEnchantmentSchema(fromFormModel(m))
}

/** SchemaForm 表单描述（id 与伤害加成开关由视图手工渲染） */
function buildEnchantmentFormSchema(): JsonSchema {
  return {
  type: 'object',
  properties: {
    displayName: {
      type: 'object',
      title: sharedT('schema.enchantment.formDisplayName'),
      required: ['en_us', 'zh_cn'],
      properties: {
        en_us: { type: 'string', title: sharedT('schema.enchantment.formNameEn') },
        zh_cn: { type: 'string', title: sharedT('schema.enchantment.formNameZh') }
      }
    },
    description: {
      type: 'object',
      title: sharedT('schema.enchantment.formDescription'),
      required: ['en_us', 'zh_cn'],
      properties: {
        en_us: { type: 'string', title: sharedT('schema.enchantment.formDescEn') },
        zh_cn: { type: 'string', title: sharedT('schema.enchantment.formDescZh') }
      }
    },
    rarity: {
      type: 'string',
      title: sharedT('schema.enchantment.formRarity'),
      enum: [...ENCHANTMENT_RARITIES],
      enumLabels: ENCHANTMENT_RARITIES.map((r) => sharedT(RARITY_KEYS[r]))
    },
    target: {
      type: 'string',
      title: sharedT('schema.enchantment.formTarget'),
      enum: [...ENCHANTMENT_TARGETS],
      enumLabels: ENCHANTMENT_TARGETS.map((x) => sharedT(TARGET_KEYS[x]))
    },
    slots: {
      type: 'array',
      title: sharedT('schema.enchantment.formSlots'),
      items: {
        type: 'string',
        enum: [...ENCHANTMENT_SLOTS],
        enumLabels: ENCHANTMENT_SLOTS.map((s) => sharedT(SLOT_KEYS[s]))
      }
    },
    maxLevel: { type: 'integer', title: sharedT('schema.enchantment.formMaxLevel') },
    treasure: { type: 'boolean', title: sharedT('schema.enchantment.formTreasure') },
    curse: { type: 'boolean', title: sharedT('schema.enchantment.formCurse') },
    minCostBase: { type: 'integer', title: sharedT('schema.enchantment.formMinCostBase') },
    minCostPerLevel: { type: 'integer', title: sharedT('schema.enchantment.formMinCostPerLevel') },
    maxCostExtra: { type: 'integer', title: sharedT('schema.enchantment.formMaxCostExtra') },
    anvilCost: { type: 'integer', title: sharedT('schema.enchantment.formAnvilCost') }
  }
  }
}

/** 冻结快照：供 spec 断言与结构用途；UI 请用 getEnchantmentFormSchema() */
export const ENCHANTMENT_FORM_SCHEMA: JsonSchema = buildEnchantmentFormSchema()

/** 按当前语言重建表单 schema（sharedT 读全局语言；调用方以 computed 包裹并依赖 locale 以触发重算） */
export function getEnchantmentFormSchema(): JsonSchema {
  return buildEnchantmentFormSchema()
}
