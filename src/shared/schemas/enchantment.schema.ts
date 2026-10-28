/**
 * 附魔语义 Schema（统一内容体系的第 4 种对象）。
 *
 * 版本路线差异（由 contentGenerator 按工程 loader/version 编译）：
 * - Fabric / Forge 1.20.1：附魔仍是 Java 类，编译为 ModEnchantments.java
 *   （Yarn：EnchantmentTarget/EquipmentSlot/isTreasure/isCursed/getAttackDamage；
 *    Mojmap：EnchantmentCategory/EquipmentSlot/isTreasureOnly/isCurse/getDamageBonus）；
 * - NeoForge 1.21.1：附魔数据驱动，编译为 data/<ns>/enchantment/<id>.json，零 Java。
 *
 * 语义字段刻意取两条路线的最大公约集；1.20.1 不支持的效果（如 effects 组件）
 * 由生成器忽略并在需要时提示用 AI/源码扩展。
 */
import { validateContentId } from '../types/content'
import { sharedT } from '../i18n'

/** 附魔稀有度（Java Enchantment.Rarity 同名） */
export type EnchantmentRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'VERY_RARE'

/**
 * 适用物品类别（语义化枚举，与加载器映射解耦）。
 * 生成时：Yarn 映射 TOOL→TOOL、Mojmap 映射 TOOL→DIGGER；其余枚举 1.20.1 两侧同名。
 */
export type EnchantmentItemTarget =
  | 'ALL'
  | 'ARMOR'
  | 'ARMOR_FEET'
  | 'ARMOR_LEGS'
  | 'ARMOR_CHEST'
  | 'ARMOR_HEAD'
  | 'WEAPON'
  | 'TOOL'
  | 'BOW'
  | 'CROSSBOW'
  | 'TRIDENT'
  | 'FISHING_ROD'
  | 'WEARABLE'
  | 'BREAKABLE'
  | 'VANISHABLE'

/** 生效装备槽（Java EquipmentSlot 与 1.21 JSON slots 共用同一套小写 id） */
export type EnchantmentSlot = 'mainhand' | 'offhand' | 'head' | 'chest' | 'legs' | 'feet'

/** 攻击伤害加成曲线（getAttackDamage / minecraft:damage） */
export interface EnchantmentDamageBonus {
  /** 1 级基础加成 */
  base: number
  /** 每高一级追加的加成 */
  perLevel: number
}

export interface EnchantmentSchema {
  kind: 'enchantment'
  /** 注册名（全小写下划线），如 life_steal */
  id: string
  displayName: { en_us: string; zh_cn: string }
  /** 附魔说明（语言键 enchantment.ns.id.desc） */
  description: { en_us: string; zh_cn: string }

  rarity: EnchantmentRarity
  target: EnchantmentItemTarget
  /** 生效槽位，至少 1 个 */
  slots: EnchantmentSlot[]

  /** 最大等级（1..255） */
  maxLevel: number
  /** 仅宝箱/钓鱼等宝藏途径获得（Java isTreasure / 1.21 treasure_only） */
  treasure: boolean
  /** 诅咒附魔（Java isCursed / 1.21 curse 标签语义） */
  curse: boolean

  /** 附魔台最小消耗：base + (level-1) * perLevel */
  minCostBase: number
  minCostPerLevel: number
  /** 最大消耗 = 同等级最小消耗 + 该增量（Java getMaxPower 语义） */
  maxCostExtra: number
  /** 铁砧消耗等级（主要用于 1.21 JSON，Java 路线忽略） */
  anvilCost: number

  /** 可选：攻击伤害加成曲线 */
  damageBonus?: EnchantmentDamageBonus | null

  createdAt: number
  updatedAt: number
}

export const ENCHANTMENT_RARITIES: readonly EnchantmentRarity[] = [
  'COMMON',
  'UNCOMMON',
  'RARE',
  'VERY_RARE'
]

export const ENCHANTMENT_TARGETS: readonly EnchantmentItemTarget[] = [
  'ALL',
  'ARMOR',
  'ARMOR_FEET',
  'ARMOR_LEGS',
  'ARMOR_CHEST',
  'ARMOR_HEAD',
  'WEAPON',
  'TOOL',
  'BOW',
  'CROSSBOW',
  'TRIDENT',
  'FISHING_ROD',
  'WEARABLE',
  'BREAKABLE',
  'VANISHABLE'
]

export const ENCHANTMENT_SLOTS: readonly EnchantmentSlot[] = [
  'mainhand',
  'offhand',
  'head',
  'chest',
  'legs',
  'feet'
]

/** 新建附魔的工厂默认值（稀有攻击附魔风格起步） */
export function createDefaultEnchantment(id: string): EnchantmentSchema {
  const now = Date.now()
  return {
    kind: 'enchantment',
    id,
    displayName: { en_us: id, zh_cn: id },
    description: { en_us: '', zh_cn: '' },
    rarity: 'RARE',
    target: 'WEAPON',
    slots: ['mainhand'],
    maxLevel: 3,
    treasure: false,
    curse: false,
    minCostBase: 10,
    minCostPerLevel: 15,
    maxCostExtra: 50,
    anvilCost: 2,
    damageBonus: null,
    createdAt: now,
    updatedAt: now
  }
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback
  return Math.min(max, Math.max(min, n))
}

/** 读取层归一化：宽容脏数据，输出字段完整的 EnchantmentSchema */
export function normalizeEnchantmentSchema(raw: unknown): EnchantmentSchema {
  const e = (raw ?? {}) as Partial<EnchantmentSchema>
  const id = typeof e.id === 'string' ? e.id.trim() : ''
  const rarity = ENCHANTMENT_RARITIES.includes(e.rarity as EnchantmentRarity)
    ? (e.rarity as EnchantmentRarity)
    : 'RARE'
  const target = ENCHANTMENT_TARGETS.includes(e.target as EnchantmentItemTarget)
    ? (e.target as EnchantmentItemTarget)
    : 'WEAPON'
  const slots = Array.isArray(e.slots)
    ? [...new Set(e.slots.filter((s): s is EnchantmentSlot => ENCHANTMENT_SLOTS.includes(s)))]
    : []
  const damageBonus =
    e.damageBonus &&
    typeof e.damageBonus === 'object' &&
    typeof (e.damageBonus as EnchantmentDamageBonus).base === 'number'
      ? {
          base: (e.damageBonus as EnchantmentDamageBonus).base,
          perLevel:
            typeof (e.damageBonus as EnchantmentDamageBonus).perLevel === 'number'
              ? (e.damageBonus as EnchantmentDamageBonus).perLevel
              : 0
        }
      : null
  return {
    kind: 'enchantment',
    id,
    displayName: {
      en_us: (e.displayName?.en_us ?? '').trim(),
      zh_cn: (e.displayName?.zh_cn ?? '').trim()
    },
    description: {
      en_us: (e.description?.en_us ?? '').trim(),
      zh_cn: (e.description?.zh_cn ?? '').trim()
    },
    rarity,
    target,
    slots: slots.length > 0 ? slots : ['mainhand'],
    maxLevel: num(e.maxLevel, 3, 1, 255),
    treasure: e.treasure === true,
    curse: e.curse === true,
    minCostBase: num(e.minCostBase, 10, 0, 255),
    minCostPerLevel: num(e.minCostPerLevel, 15, 0, 255),
    maxCostExtra: num(e.maxCostExtra, 50, 0, 255),
    anvilCost: num(e.anvilCost, 2, 0, 255),
    damageBonus,
    createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
    updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : Date.now()
  }
}

/** 保存层校验；通过返回 null，否则返回中文错误消息 */
export function validateEnchantmentSchema(e: EnchantmentSchema): string | null {
  if (!validateContentId(e.id)) {
    return sharedT('schema.common.errRegistryName')
  }
  if (!e.displayName.en_us.trim() && !e.displayName.zh_cn.trim()) {
    return sharedT('schema.common.errDisplayName')
  }
  if (!ENCHANTMENT_RARITIES.includes(e.rarity)) return sharedT('schema.enchantment.errRarityInvalid')
  if (!ENCHANTMENT_TARGETS.includes(e.target)) return sharedT('schema.enchantment.errTargetInvalid')
  if (!Array.isArray(e.slots) || e.slots.length === 0) {
    return sharedT('schema.enchantment.errSlotsRequired')
  }
  for (const s of e.slots) {
    if (!ENCHANTMENT_SLOTS.includes(s)) {
      return sharedT('schema.enchantment.errSlotInvalid', { slot: s })
    }
  }
  if (!Number.isInteger(e.maxLevel) || e.maxLevel < 1 || e.maxLevel > 255) {
    return sharedT('schema.enchantment.errMaxLevel')
  }
  if (e.damageBonus) {
    if (
      !Number.isFinite(e.damageBonus.base) ||
      !Number.isFinite(e.damageBonus.perLevel) ||
      e.damageBonus.base < 0
    ) {
      return sharedT('schema.enchantment.errDamageBonus')
    }
  }
  return null
}
