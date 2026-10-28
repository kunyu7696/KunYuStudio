/**
 * 物品语义 Schema（物品编辑器重做 P0-T0.1）。
 *
 * 表单（ItemEditor sections）、代码生成器（contentGenerator / mojmapCodegen）、
 * AI Agent（P5 ItemTools）三方共用的契约：
 * - 与加载器无关：不含任何 Fabric/Forge/NeoForge 特定字段，
 *   加载器差异全部由生成器侧的映射表 / 模板吸收
 * - 磁盘形态：.kunyu/content/items/<id>.json
 * - 判别字段沿用 `kind: 'item'`（对应规格中的 type），与 ContentDefinition
 *   联合类型及 contentService 的磁盘判别逻辑保持一致
 * - 与规格的差异扩展：
 *   · texture.color —— 占位纯色 PNG 生成所需（原 textureColor 能力保留）
 *   · cubeModelId —— M12 Cube 模型绑定能力保留，优先级高于 model
 *   · creativeTab —— P0 仅保存语义，注册到物品栏由 P1+ 生成
 */
import { validateContentId } from '../types/content'
import type { EmbeddedCubeModel } from '../types/content'
import { sharedT, type SharedLocale } from '../i18n'

/** 物品类型（5 种，驱动 ItemEditor 动态分区渲染） */
export type ItemKindType = 'simple' | 'tool' | 'armor' | 'food' | 'block_item'

/** 稀有度（决定游戏内名称颜色） */
export type ItemRarity = 'common' | 'uncommon' | 'rare' | 'epic'

/** 工具类型 */
export type ToolKind = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword'

/** 工具/盔甲共用材质枚举（生成器侧映射为 ToolMaterials/Tiers、ArmorMaterials） */
export type ToolMaterial = 'wood' | 'stone' | 'iron' | 'gold' | 'diamond' | 'netherite'
export type ArmorMaterial = 'leather' | 'chainmail' | 'iron' | 'gold' | 'diamond' | 'netherite'

/** 盔甲槽位 */
export type ArmorSlot = 'helmet' | 'chestplate' | 'leggings' | 'boots'

/** 工具专属配置 */
export interface ToolConfig {
  toolKind: ToolKind
  material: ToolMaterial
  /** 攻击力加成（传入 Item 构造器的增量，材质自身攻击力由材质决定） */
  attackDamage: number
  /** 攻击速度修正（负值，如 -2.4） */
  attackSpeed: number
  /** 挖掘等级 0-4（语义层，P0 暂存） */
  miningLevel: number
}

/** 盔甲专属配置 */
export interface ArmorConfig {
  slot: ArmorSlot
  material: ArmorMaterial
  /** 护甲值（语义层；P0 使用原版材质默认值） */
  protection: number
  /** 耐久（语义层；properties.maxDamage > 0 时以覆盖形式生成） */
  durability: number
  /** 盔甲韧性（语义层） */
  toughness: number
  /** 击退抗性 0.0-1.0（语义层） */
  knockbackResistance: number
}

/** 食物状态效果 */
export interface FoodEffect {
  /** 原版效果 ID，如 minecraft:speed */
  effect: string
  /** 持续时间（tick） */
  duration: number
  /** 效果等级 0 起 */
  amplifier: number
  /** 触发概率 0.0-1.0 */
  chance: number
}

/** 食物专属配置 */
export interface FoodConfig {
  /** 饱食度（饥饿值恢复量）1-20 */
  hunger: number
  /** 饱和度修正 0.0-1.0 */
  saturation: number
  /** 肉类（可被狼食用） */
  meat: boolean
  /** 始终可食用（不饿也能吃） */
  alwaysEdible: boolean
  /** 快速食品（可在战斗中进食，Fabric 专用语义） */
  snack: boolean
  effects: FoodEffect[]
}

/** 贴图资源：path 非空时优先使用（相对 assets 的路径），否则用 color 生成占位纯色 */
export interface ItemTexture {
  path: string
  /** true = 由工具生成占位贴图（color 纯色）；false = 使用 path 的自定义贴图 */
  generated: boolean
  /** 占位纯色（hex） */
  color: string
  /** 像素画数据（P4）：256 项（16×16），hex 或 ''=透明；语义 JSON 为编辑状态的 source of truth */
  pixels?: string[]
}

/** 物品模型：标准 item/generated 形态；cubeModelId 存在时以 Cube 模型直出 */
export interface ItemModel {
  parent: string
  layer0: string
  /** 统一编辑器的嵌入式可编辑模型（保存时导出独立模型并绑定） */
  cubeModel?: EmbeddedCubeModel | null
}

/** 物品语义数据结构（三方共用契约） */
export interface ItemSchema {
  kind: 'item'
  /** 物品类型，驱动表单分区与代码生成分支 */
  itemType: ItemKindType
  /** 注册名（全小写下划线），如 example_sword */
  id: string
  /** 多语言显示名称 */
  displayName: { en_us: string; zh_cn: string }
  description?: string

  /** 通用属性 */
  properties: {
    /** 最大堆叠数 1-64（maxDamage > 0 时固定 1） */
    maxCount: number
    /** 最大耐久；0 = 无耐久 */
    maxDamage: number
    rarity: ItemRarity
    /** 抗火（岩浆/火焰中不掉落焚毁） */
    fireproof: boolean
    /** 物品栏标签，如 minecraft:combat；P0 语义暂存 */
    creativeTab: string
  }

  tool?: ToolConfig
  armor?: ArmorConfig
  food?: FoodConfig
  /** block_item 专用：引用的方块注册名 */
  blockRef?: string

  texture: ItemTexture
  model: ItemModel
  /** 绑定的 Cube 模型资产 id（M12），优先于 model 生成 elements 模型 */
  cubeModelId?: string | null
  /**
   * AI 自由代码路径写入的自定义物品类全限定名（如 com.kunyu.mymod.item.KatanaItem）。
   * 存在时生成器用 new CustomClass(settings) 替代 new Item(...)，并自动完成注册；
   * 不存在则按 itemType 生成原版类（Item/ToolItem/ArmorItem 等）。
   */
  customClass?: string | null
  /**
   * 结构化战利品表（统一编辑器 P3.2）：编译为 data/<ns>/loot_tables/items/<id>.json。
   * 物品本身无原版死亡钩子，此表供自定义逻辑/命令引用。
   */
  lootTable?: import('./loot.schema').LootTableDef
  /** 配方列表（统一编辑器 P3.3）：编译为 data/<ns>/recipes/<id>.json */
  recipes?: import('./recipe.schema').RecipeDef[]

  createdAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ */
/* 选项清单（表单 + 校验共用）                                          */
/* ------------------------------------------------------------------ */

function buildItemTypeOptions(locale?: SharedLocale): { value: ItemKindType; label: string; hint: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'simple', label: t('schema.item.typeSimple'), hint: t('schema.item.typeSimpleHint') },
    { value: 'tool', label: t('schema.item.typeTool'), hint: t('schema.item.typeToolHint') },
    { value: 'armor', label: t('schema.item.typeArmor'), hint: t('schema.item.typeArmorHint') },
    { value: 'food', label: t('schema.item.typeFood'), hint: t('schema.item.typeFoodHint') },
    { value: 'block_item', label: t('schema.item.typeBlockItem'), hint: t('schema.item.typeBlockItemHint') }
  ]
}

export const ITEM_TYPE_OPTIONS: { value: ItemKindType; label: string; hint: string }[] =
  buildItemTypeOptions()

/** 语言感知版本：组件内 computed(() => getItemTypeOptions(locale.value)) 使用 */
export function getItemTypeOptions(locale?: SharedLocale): typeof ITEM_TYPE_OPTIONS {
  return buildItemTypeOptions(locale)
}

function buildRarityOptions(locale?: SharedLocale): { value: ItemRarity; label: string; color: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'common', label: t('schema.item.rarityCommon'), color: '#ffffff' },
    { value: 'uncommon', label: t('schema.item.rarityUncommon'), color: '#a6e3a1' },
    { value: 'rare', label: t('schema.item.rarityRare'), color: '#89dceb' },
    { value: 'epic', label: t('schema.item.rarityEpic'), color: '#cba6f7' }
  ]
}

export const RARITY_OPTIONS: { value: ItemRarity; label: string; color: string }[] =
  buildRarityOptions()

export function getRarityOptions(locale?: SharedLocale): typeof RARITY_OPTIONS {
  return buildRarityOptions(locale)
}

function buildToolKindOptions(locale?: SharedLocale): { value: ToolKind; label: string; yarnIntDamage: boolean }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'pickaxe', label: t('schema.block.toolPickaxe'), yarnIntDamage: true },
    { value: 'axe', label: t('schema.block.toolAxe'), yarnIntDamage: false },
    { value: 'shovel', label: t('schema.block.toolShovel'), yarnIntDamage: false },
    { value: 'hoe', label: t('schema.block.toolHoe'), yarnIntDamage: true },
    { value: 'sword', label: t('schema.block.toolSword'), yarnIntDamage: true }
  ]
}

export const TOOL_KIND_OPTIONS: { value: ToolKind; label: string; yarnIntDamage: boolean }[] =
  buildToolKindOptions()

export function getToolKindOptions(locale?: SharedLocale): typeof TOOL_KIND_OPTIONS {
  return buildToolKindOptions(locale)
}

function buildToolMaterialOptions(locale?: SharedLocale): { value: ToolMaterial; label: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'wood', label: t('schema.item.materialWood') },
    { value: 'stone', label: t('schema.item.materialStone') },
    { value: 'iron', label: t('schema.item.materialIron') },
    { value: 'gold', label: t('schema.item.materialGold') },
    { value: 'diamond', label: t('schema.item.materialDiamond') },
    { value: 'netherite', label: t('schema.item.materialNetherite') }
  ]
}

export const TOOL_MATERIAL_OPTIONS: { value: ToolMaterial; label: string }[] =
  buildToolMaterialOptions()

export function getToolMaterialOptions(locale?: SharedLocale): typeof TOOL_MATERIAL_OPTIONS {
  return buildToolMaterialOptions(locale)
}

function buildArmorSlotOptions(locale?: SharedLocale): { value: ArmorSlot; label: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'helmet', label: t('schema.item.slotHelmet') },
    { value: 'chestplate', label: t('schema.item.slotChestplate') },
    { value: 'leggings', label: t('schema.item.slotLeggings') },
    { value: 'boots', label: t('schema.item.slotBoots') }
  ]
}

export const ARMOR_SLOT_OPTIONS: { value: ArmorSlot; label: string }[] =
  buildArmorSlotOptions()

export function getArmorSlotOptions(locale?: SharedLocale): typeof ARMOR_SLOT_OPTIONS {
  return buildArmorSlotOptions(locale)
}

function buildArmorMaterialOptions(locale?: SharedLocale): { value: ArmorMaterial; label: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'leather', label: t('schema.item.armorLeather') },
    { value: 'chainmail', label: t('schema.item.armorChainmail') },
    { value: 'iron', label: t('schema.item.materialIron') },
    { value: 'gold', label: t('schema.item.materialGold') },
    { value: 'diamond', label: t('schema.item.materialDiamond') },
    { value: 'netherite', label: t('schema.item.materialNetherite') }
  ]
}

export const ARMOR_MATERIAL_OPTIONS: { value: ArmorMaterial; label: string }[] =
  buildArmorMaterialOptions()

export function getArmorMaterialOptions(locale?: SharedLocale): typeof ARMOR_MATERIAL_OPTIONS {
  return buildArmorMaterialOptions(locale)
}

/** 常用原版状态效果（表单下拉；id → Yarn StatusEffects / Mojmap MobEffects 常量） */
function buildCommonFoodEffects(locale?: SharedLocale): { id: string; label: string; yarn: string; mojmap: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { id: 'minecraft:speed', label: t('schema.item.effectSpeed'), yarn: 'SPEED', mojmap: 'MOVEMENT_SPEED' },
    { id: 'minecraft:slowness', label: t('schema.item.effectSlowness'), yarn: 'SLOWNESS', mojmap: 'MOVEMENT_SLOWDOWN' },
    { id: 'minecraft:haste', label: t('schema.item.effectHaste'), yarn: 'HASTE', mojmap: 'DIG_SPEED' },
    { id: 'minecraft:mining_fatigue', label: t('schema.item.effectMiningFatigue'), yarn: 'MINING_FATIGUE', mojmap: 'DIG_SLOWDOWN' },
    { id: 'minecraft:strength', label: t('schema.item.effectStrength'), yarn: 'STRENGTH', mojmap: 'DAMAGE_BOOST' },
    { id: 'minecraft:instant_health', label: t('schema.item.effectInstantHealth'), yarn: 'INSTANT_HEALTH', mojmap: 'HEAL' },
    { id: 'minecraft:instant_damage', label: t('schema.item.effectInstantDamage'), yarn: 'INSTANT_DAMAGE', mojmap: 'HARM' },
    { id: 'minecraft:jump_boost', label: t('schema.item.effectJumpBoost'), yarn: 'JUMP_BOOST', mojmap: 'JUMP' },
    { id: 'minecraft:regeneration', label: t('schema.item.effectRegeneration'), yarn: 'REGENERATION', mojmap: 'REGENERATION' },
    { id: 'minecraft:resistance', label: t('schema.item.effectResistance'), yarn: 'RESISTANCE', mojmap: 'DAMAGE_RESISTANCE' },
    { id: 'minecraft:fire_resistance', label: t('schema.item.effectFireResistance'), yarn: 'FIRE_RESISTANCE', mojmap: 'FIRE_RESISTANCE' },
    { id: 'minecraft:water_breathing', label: t('schema.item.effectWaterBreathing'), yarn: 'WATER_BREATHING', mojmap: 'WATER_BREATHING' },
    { id: 'minecraft:invisibility', label: t('schema.item.effectInvisibility'), yarn: 'INVISIBILITY', mojmap: 'INVISIBILITY' },
    { id: 'minecraft:night_vision', label: t('schema.item.effectNightVision'), yarn: 'NIGHT_VISION', mojmap: 'NIGHT_VISION' },
    { id: 'minecraft:absorption', label: t('schema.item.effectAbsorption'), yarn: 'ABSORPTION', mojmap: 'ABSORPTION' },
    { id: 'minecraft:saturation', label: t('schema.item.effectSaturation'), yarn: 'SATURATION', mojmap: 'SATURATION' },
    { id: 'minecraft:glowing', label: t('schema.item.effectGlowing'), yarn: 'GLOWING', mojmap: 'GLOWING' },
    { id: 'minecraft:levitation', label: t('schema.item.effectLevitation'), yarn: 'LEVITATION', mojmap: 'LEVITATION' },
    { id: 'minecraft:luck', label: t('schema.item.effectLuck'), yarn: 'LUCK', mojmap: 'LUCK' },
    { id: 'minecraft:slow_falling', label: t('schema.item.effectSlowFalling'), yarn: 'SLOW_FALLING', mojmap: 'SLOW_FALLING' },
    { id: 'minecraft:poison', label: t('schema.item.effectPoison'), yarn: 'POISON', mojmap: 'POISON' },
    { id: 'minecraft:wither', label: t('schema.item.effectWither'), yarn: 'WITHER', mojmap: 'WITHER' },
    { id: 'minecraft:weakness', label: t('schema.item.effectWeakness'), yarn: 'WEAKNESS', mojmap: 'WEAKNESS' },
    { id: 'minecraft:hunger', label: t('schema.item.effectHunger'), yarn: 'HUNGER', mojmap: 'HUNGER' },
    { id: 'minecraft:darkness', label: t('schema.item.effectDarkness'), yarn: 'DARKNESS', mojmap: 'DARKNESS' }
  ]
}

export const COMMON_FOOD_EFFECTS: { id: string; label: string; yarn: string; mojmap: string }[] =
  buildCommonFoodEffects()

export function getCommonFoodEffects(locale?: SharedLocale): typeof COMMON_FOOD_EFFECTS {
  return buildCommonFoodEffects(locale)
}

/** 效果 ID → 指定映射体系的常量名；未知 id 返回 null（生成侧跳过并注释） */
export function foodEffectConstant(effectId: string, flavor: 'yarn' | 'mojmap'): string | null {
  const hit = COMMON_FOOD_EFFECTS.find((e) => e.id === effectId)
  if (hit) return flavor === 'yarn' ? hit.yarn : hit.mojmap
  return null
}

/* ------------------------------------------------------------------ */
/* 默认值 / 类型切换 / 迁移                                             */
/* ------------------------------------------------------------------ */

function nowStamp(): { createdAt: number; updatedAt: number } {
  const now = Date.now()
  return { createdAt: now, updatedAt: now }
}

function defaultTool(kind: ToolKind): ToolConfig {
  // 攻击力/攻速参考原版铁质工具的增量
  const base: Record<ToolKind, { dmg: number; speed: number }> = {
    pickaxe: { dmg: 1, speed: -2.8 },
    axe: { dmg: 6, speed: -3.1 },
    shovel: { dmg: 1.5, speed: -3 },
    hoe: { dmg: -3, speed: 0 },
    sword: { dmg: 3, speed: -2.4 }
  }
  return {
    toolKind: kind,
    material: 'iron',
    attackDamage: base[kind].dmg,
    attackSpeed: base[kind].speed,
    miningLevel: 2
  }
}

/** 按物品类型构造类型专属配置默认值 */
export function createTypeConfig(itemType: ItemKindType, kind: ToolKind = 'sword'): {
  tool?: ToolConfig
  armor?: ArmorConfig
  food?: FoodConfig
  blockRef?: string
} {
  switch (itemType) {
    case 'tool':
      return { tool: defaultTool(kind) }
    case 'armor':
      return {
        armor: {
          slot: 'chestplate',
          material: 'iron',
          protection: 6,
          durability: 240,
          toughness: 0,
          knockbackResistance: 0
        }
      }
    case 'food':
      return {
        food: { hunger: 6, saturation: 0.6, meat: false, alwaysEdible: false, snack: false, effects: [] }
      }
    case 'block_item':
      return { blockRef: '' }
    default:
      return {}
  }
}

/** 创建默认物品（itemType 可选，默认 simple） */
export function createDefaultItem(id: string, itemType: ItemKindType = 'simple'): ItemSchema {
  return {
    kind: 'item',
    itemType,
    id,
    displayName: { en_us: id, zh_cn: id },
    description: '',
    properties: {
      maxCount: 64,
      maxDamage: 0,
      rarity: 'common',
      fireproof: false,
      creativeTab: ''
    },
    ...createTypeConfig(itemType),
    texture: { path: '', generated: true, color: '#cbb37a' },
    model: { parent: 'item/generated', layer0: `item/${id || 'new_item'}` },
    cubeModelId: null,
    ...nowStamp()
  }
}

/**
 * 类型切换：保留通用字段（基础信息 / 通用属性 / 贴图 / 模型），
 * 清空旧类型专属配置并填入新类型默认值。
 */
export function applyItemType(item: ItemSchema, next: ItemKindType): void {
  if (item.itemType === next) return
  item.itemType = next
  delete item.tool
  delete item.armor
  delete item.food
  delete item.blockRef
  Object.assign(item, createTypeConfig(next))
  // 有耐久/食物联动：食物与工具/盔甲互斥时保持堆叠语义一致
  if (next === 'food' && item.properties.maxDamage > 0) {
    item.properties.maxDamage = 0
    item.properties.maxCount = 64
  }
}

/**
 * 旧版扁平 ItemDefinition → 新版 ItemSchema 迁移。
 * 判定：磁盘 JSON 有 kind==='item' 但缺 itemType 字段。
 */
export function migrateLegacyItem(raw: Record<string, unknown>): ItemSchema {
  const id = typeof raw.id === 'string' ? raw.id : 'legacy_item'
  const name = typeof raw.displayName === 'string' ? raw.displayName : id
  const isFood = raw.food === true
  const customTexture = typeof raw.customTexture === 'string' ? raw.customTexture : ''
  const color = typeof raw.textureColor === 'string' && raw.textureColor ? raw.textureColor : '#cbb37a'
  const migrated: ItemSchema = {
    kind: 'item',
    itemType: isFood ? 'food' : 'simple',
    id,
    displayName: { en_us: name, zh_cn: name },
    description: typeof raw.description === 'string' ? raw.description : '',
    properties: {
      maxCount: typeof raw.maxStack === 'number' ? raw.maxStack : 64,
      maxDamage: typeof raw.maxDamage === 'number' ? raw.maxDamage : 0,
      rarity: 'common',
      fireproof: false,
      creativeTab: ''
    },
    ...(isFood
      ? {
          food: {
            hunger: typeof raw.foodHunger === 'number' ? raw.foodHunger : 6,
            saturation: typeof raw.foodSaturation === 'number' ? raw.foodSaturation : 0.6,
            meat: false,
            alwaysEdible: false,
            snack: false,
            effects: []
          }
        }
      : {}),
    texture: { path: customTexture, generated: !customTexture, color },
    model: { parent: 'item/generated', layer0: `item/${id}` },
    cubeModelId: typeof raw.modelId === 'string' && raw.modelId ? raw.modelId : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
  }
  return normalizeItemSchema(migrated)
}

/* ------------------------------------------------------------------ */
/* 归一化 / 校验                                                        */
/* ------------------------------------------------------------------ */

function clampNum(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNum(n, min, max, fallback))
}

/** 归一化：字段补全、范围收敛、类型专属配置合法化 */
export function normalizeItemSchema(i: ItemSchema): ItemSchema {
  const itemType: ItemKindType = ITEM_TYPE_OPTIONS.some((t) => t.value === i.itemType)
    ? i.itemType
    : 'simple'
  const rarity: ItemRarity = ['common', 'uncommon', 'rare', 'epic'].includes(i.properties?.rarity)
    ? i.properties.rarity
    : 'common'
  const maxDamage = clampInt(i.properties?.maxDamage, 0, 9999, 0)
  const maxDamageOn = maxDamage > 0

  const normalized: ItemSchema = {
    ...i,
    kind: 'item',
    itemType,
    id: i.id.trim(),
    displayName: {
      en_us: (i.displayName?.en_us ?? '').trim(),
      zh_cn: (i.displayName?.zh_cn ?? '').trim()
    },
    description: (i.description ?? '').trim(),
    properties: {
      maxCount: maxDamageOn ? 1 : clampInt(i.properties?.maxCount, 1, 64, 64),
      maxDamage,
      rarity,
      fireproof: Boolean(i.properties?.fireproof),
      creativeTab: (i.properties?.creativeTab ?? '').trim()
    },
    texture: {
      path: (i.texture?.path ?? '').trim(),
      generated: i.texture?.path ? false : i.texture?.generated !== false,
      color: /^#[0-9a-fA-F]{6}$/.test(i.texture?.color ?? '') ? i.texture.color : '#cbb37a'
    },
    model: {
      parent: (i.model?.parent ?? 'item/generated').trim() || 'item/generated',
      layer0: (i.model?.layer0 ?? '').trim()
    },
    cubeModelId: i.cubeModelId ? i.cubeModelId : null,
    customClass: typeof i.customClass === 'string' && i.customClass.trim() ? i.customClass.trim() : null,
    createdAt: i.createdAt ?? Date.now(),
    updatedAt: i.updatedAt ?? Date.now()
  }

  // 像素画数据透传（P4）：仅当为合法 256 项数组时保留，缺失/非法不强制生成
  if (Array.isArray(i.texture?.pixels) && i.texture.pixels.length === 256) {
    normalized.texture.pixels = i.texture.pixels
  }

  // 内嵌 Cube 模型透传（武器 3D 直出）：elements 非空才保留，结构校验由生成期 validateModel 负责
  if (
    i.model?.cubeModel &&
    Array.isArray(i.model.cubeModel.elements) &&
    i.model.cubeModel.elements.length > 0
  ) {
    normalized.model.cubeModel = i.model.cubeModel
  }

  if (itemType === 'tool' && i.tool) {
    const t = i.tool
    normalized.tool = {
      toolKind: TOOL_KIND_OPTIONS.some((k) => k.value === t.toolKind) ? t.toolKind : 'sword',
      material: TOOL_MATERIAL_OPTIONS.some((m) => m.value === t.material) ? t.material : 'iron',
      attackDamage: Math.round(clampNum(t.attackDamage, -10, 50, 3) * 10) / 10,
      attackSpeed: Math.round(clampNum(t.attackSpeed, -4, 4, -2.4) * 10) / 10,
      miningLevel: clampInt(t.miningLevel, 0, 4, 2)
    }
  } else if (itemType === 'armor' && i.armor) {
    const a = i.armor
    normalized.armor = {
      slot: ARMOR_SLOT_OPTIONS.some((s) => s.value === a.slot) ? a.slot : 'chestplate',
      material: ARMOR_MATERIAL_OPTIONS.some((m) => m.value === a.material) ? a.material : 'iron',
      protection: clampInt(a.protection, 0, 20, 6),
      durability: clampInt(a.durability, 0, 9999, 240),
      toughness: Math.round(clampNum(a.toughness, 0, 20, 0) * 10) / 10,
      knockbackResistance: Math.round(clampNum(a.knockbackResistance, 0, 1, 0) * 100) / 100
    }
  } else if (itemType === 'food' && i.food) {
    const f = i.food
    const effects = (Array.isArray(f.effects) ? f.effects : [])
      .slice(0, 8)
      .filter((e) => e && typeof e.effect === 'string' && e.effect)
      .map((e) => ({
        effect: e.effect,
        duration: clampInt(e.duration, 0, 20 * 60 * 60, 200),
        amplifier: clampInt(e.amplifier, 0, 255, 0),
        chance: Math.round(clampNum(e.chance, 0, 1, 1) * 100) / 100
      }))
    normalized.food = {
      hunger: clampInt(f.hunger, 1, 20, 6),
      saturation: Math.round(clampNum(f.saturation, 0, 1, 0.6) * 100) / 100,
      meat: Boolean(f.meat),
      alwaysEdible: Boolean(f.alwaysEdible),
      snack: Boolean(f.snack),
      effects
    }
  } else if (itemType === 'block_item') {
    normalized.blockRef = (i.blockRef ?? '').trim()
  }

  return normalized
}

/** 保存层校验；通过返回 null，否则返回错误消息 */
export function validateItemSchema(i: ItemSchema): string | null {
  if (!validateContentId(i.id)) {
    return sharedT('schema.common.errRegistryName')
  }
  if (!i.displayName.en_us.trim() && !i.displayName.zh_cn.trim()) {
    return sharedT('schema.common.errDisplayName')
  }
  if (i.properties.maxDamage > 0 && i.properties.maxCount !== 1) {
    return sharedT('schema.item.errDurableStack')
  }
  if (i.itemType === 'block_item') {
    if (!i.blockRef || !/^[a-z][a-z0-9_.:-]*$/.test(i.blockRef)) {
      return sharedT('schema.item.errBlockRefInvalid')
    }
  }
  if (i.itemType === 'tool' && !i.tool) return sharedT('schema.item.errToolMissing')
  if (i.itemType === 'armor' && !i.armor) return sharedT('schema.item.errArmorMissing')
  if (i.itemType === 'food' && !i.food) return sharedT('schema.item.errFoodMissing')
  return null
}

/* ------------------------------------------------------------------ */
/* 展示辅助                                                             */
/* ------------------------------------------------------------------ */

/** 取指定语言的显示名称，缺省回落到另一语言再回落到 id */
export function itemDisplayName(i: ItemSchema, lang: 'en_us' | 'zh_cn' = 'zh_cn'): string {
  const primary = (i.displayName?.[lang] ?? '').trim()
  const fallback = (i.displayName?.[lang === 'zh_cn' ? 'en_us' : 'zh_cn'] ?? '').trim()
  return primary || fallback || i.id
}

/** 任意语义对象的展示名（物品/方块/实体为多语言对象，其余为字符串） */
export function contentDisplayName(
  def: { kind: string; id: string; displayName: unknown }
): string {
  if (
    def.kind === 'item' ||
    def.kind === 'block' ||
    def.kind === 'entity' ||
    def.kind === 'enchantment'
  ) {
    const d = def.displayName as { en_us?: string; zh_cn?: string } | undefined
    return (d?.zh_cn ?? '').trim() || (d?.en_us ?? '').trim() || def.id
  }
  return typeof def.displayName === 'string' ? def.displayName || def.id : def.id
}

/** 稀有度颜色（预览边框 / 摘要用） */
export function rarityColor(rarity: ItemRarity): string {
  return RARITY_OPTIONS.find((r) => r.value === rarity)?.color ?? '#ffffff'
}
