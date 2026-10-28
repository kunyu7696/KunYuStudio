/**
 * 统一内容对象 Schema（统一编辑器 P0）。
 *
 * 核心转变：从「按文件类型分编辑器」→「按内容对象分编辑器」。
 * 一个方块/物品/实体在内存里是一份 UnifiedContent，包含 java/assets/data 三端的
 * 全部信息。用户改任意一边，另外两边通过生成器同步。
 *
 * 与现有 schema 的关系：
 * - 本文件定义的是统一编辑器的契约，不替换 block.schema.ts / item.schema.ts 等
 *   （现有方块/物品编辑器仍依赖扁平 schema）
 * - 现有 BlockSchema 的 properties/blockEntity/interaction 对应本文件 java 端；
 *   texture/model/blockStates 对应 assets 端；data 端是新增的
 * - 后续 P1 做适配层：UnifiedContent ↔ 现有扁平 schema 双向转换
 *
 * 磁盘形态：.kunyu/content/<type>s/<id>.json（与现有扁平 schema 共存，迁移期两套）
 */
import type { BlockProperties, BlockEntityConfig, InteractionConfig, BlockStateConfig, BlockModelType, BlockType } from './block.schema'
import type { ItemRarity, ItemKindType, ToolConfig, ArmorConfig, FoodConfig } from './item.schema'
import { createTypeConfig } from './item.schema'
import type {
  EntityKindType,
  EntityBaseClass,
  EntityProperties,
  EntityAttributes,
  EntityAi,
  SpawnConfig
} from './entity.schema'
import type { LootTableDef } from './loot.schema'
import type { RecipeDef } from './recipe.schema'
import { createBiomeDefault, validateBiomeDoc } from './datapack/biome.schema'
import { createAdvancementDefault, validateAdvancementDoc } from './datapack/advancement.schema'
import type { CubeFaceName, EmbeddedCubeModel } from '../types/content'
import { validateContentId } from '../types/content'
import { sharedT, type SharedLocale } from '../i18n'

/* ------------------------------------------------------------------ */
/* 类型与三端结构                                                        */
/* ------------------------------------------------------------------ */

/** 内容对象类型（统一编辑器支持的可编辑对象） */
export type UnifiedContentType = 'block' | 'item' | 'entity' | 'biome' | 'recipe' | 'advancement'

/** 语言键 */
export type LangKey = 'en_us' | 'zh_cn'

/** 多语言名称 */
export type DisplayName = Record<LangKey, string>

/* ---------------- Java 代码端 ---------------- */

/** 方块专属属性（复用 block.schema 的 BlockProperties） */
export type BlockJavaProperties = BlockProperties

/** 物品专属属性 */
export interface ItemJavaProperties {
  maxCount: number
  maxDamage: number
  rarity: ItemRarity
  fireproof: boolean
  creativeTab: string
}

/** 实体专属属性（复用 entity.schema 的 EntityProperties） */
export type EntityJavaProperties = EntityProperties

/** Java 端属性联合 */
export type ContentJavaProperties = BlockJavaProperties | ItemJavaProperties | EntityJavaProperties

/** 方块物品注册配置（是否生成 BlockItem 及物品栏标签） */
export interface BlockItemConfig {
  enabled: boolean
  creativeTab: string
}

/** Java 代码端 */
export interface UnifiedJavaSide {
  /** 生成的 Java 类名，如 ExampleBlock */
  className: string
  /** 包名，如 com.example.examplemod.block */
  packageName: string
  /** 物理/行为属性（按 type 不同为不同子类型） */
  properties: ContentJavaProperties
  /** 自定义代码片段（null = 无自定义；非空时生成器保留此片段，反向同步锁定表单） */
  customLogic: string | null
  /** 方块实体配置（仅 block 且需要时存在） */
  blockEntity?: BlockEntityConfig
  /** 右键交互配置（仅 block interactive 时存在） */
  interaction?: InteractionConfig

  /* ---- block 专属 ---- */
  /** 方块子类型（simple/directional/toggle/interactive/entity） */
  blockType?: BlockType
  /** 绑定的 Cube 模型资产 id（block/entity：优先于 model 生成） */
  cubeModelId?: string | null
  /** BlockItem 注册配置（仅 block） */
  blockItem?: BlockItemConfig

  /* ---- item 专属 ---- */
  /** 物品子类型（simple/tool/armor/food/block_item） */
  itemType?: ItemKindType
  tool?: ToolConfig
  armor?: ArmorConfig
  food?: FoodConfig
  /** block_item 专用：引用的方块注册名 */
  blockRef?: string

  /* ---- entity 专属 ---- */
  entityType?: EntityKindType
  baseClass?: EntityBaseClass
  attributes?: EntityAttributes
  ai?: EntityAi
  spawn?: SpawnConfig
  spawnEgg?: { enabled: boolean; creativeTab: string }
}

/* ---------------- 资源包端 ---------------- */

/**
 * 贴图引用：path 为 assets 相对路径；generated/color/pixels/faces 为贴图编辑器
 * 的编辑态元数据（source of truth），落盘 PNG 时由这些字段生成。
 * 适配层需要完整保留这些字段以保证 BlockSchema/ItemSchema ↔ UnifiedContent 无损。
 */
export interface UnifiedTextureRef {
  /** assets 相对路径（textures/block/x.png），空 = 未使用自定义贴图 */
  path: string
  /** true = 由工具生成占位贴图；false = 使用 path 的自定义贴图 */
  generated?: boolean
  /** 占位纯色（hex） */
  color?: string
  /** 像素画数据（16×16 = 256 项，hex 或 ''=透明） */
  pixels?: string[]
  /** model.type='cube' 时六面各自的贴图路径 */
  faces?: Partial<Record<CubeFaceName, string>>
}

/** 贴图资源引用（保留编辑态元数据以支持无损往返） */
export interface UnifiedTextures {
  /** 方块贴图列表（通常 1 张；cube 模型六面时多张） */
  block?: UnifiedTextureRef[]
  /** 物品贴图 */
  item?: UnifiedTextureRef
  /** 实体贴图 */
  entity?: UnifiedTextureRef
  /** GUI 贴图 */
  gui?: UnifiedTextureRef
}

/** 模型配置（承载 block/item/entity 三种模型形态） */
export interface UnifiedModel {
  type: BlockModelType | 'item_generated' | 'entity'
  /** type='custom' 时的原版模型 JSON */
  customJson?: Record<string, unknown> | null
  /* ---- item 模型 ---- */
  /** item/generated 的父模型 */
  parent?: string
  /** item 模型第 0 层贴图变量 */
  layer0?: string
  /* ---- entity 渲染器 ---- */
  /** entity 模型类型：原版 Java 模型 / Blockbench */
  entityModelType?: 'custom' | 'blockbench_geo'
  /** blockbench_geo 时的模型文件路径 */
  modelPath?: string | null
  /** Blockbench 动画文件路径 */
  animationPath?: string | null
  /** 嵌入式可编辑 Cube 模型（three.js 建模器直接编辑） */
  cubeModel?: EmbeddedCubeModel | null
}

/** 资源包端 */
export interface UnifiedAssetsSide {
  textures: UnifiedTextures
  model: UnifiedModel
  /** 方块状态定义（仅 block） */
  blockstate?: BlockStateConfig[]
  /** 语言键值对：lang key → 翻译文本 */
  lang: Record<string, string>
  /** 音效条目（P0 语义占位） */
  sounds?: Array<{ id: string; category: string; subtitle?: string }>
  /** 字体条目（P0 语义占位） */
  font?: Array<{ id: string; type: string; file: string }>
}

/* ---------------- 数据包端 ---------------- */

/** 战利品表条目（复用 loot.schema 的语义模型；路径由对象类型/id 推导） */
export type { LootTableDef } from './loot.schema'

/** 进度条目 */
export interface UnifiedAdvancementEntry {
  id: string
  parent?: string
  display: { title: string; description: string; icon: string }
  criteria: Record<string, unknown>
}

/** 标签条目 */
export interface UnifiedTagEntry {
  /** 标签 id，如 minecraft:mineable/pickaxe */
  id: string
  /** 标签下的条目 id 列表 */
  values: string[]
}

/** 世界生成条目（P0 占位） */
export interface UnifiedWorldgenEntry {
  id: string
  type: 'feature' | 'placed_feature' | 'biome' | 'configured_carver'
}

/** 函数条目 */
export interface UnifiedFunctionEntry {
  /** 函数 id（相对 data/<ns>/functions/，不含 .mcfunction） */
  id: string
  /** 命令行 */
  commands: string[]
}

/** 数据包端 */
export interface UnifiedDataSide {
  /** 配方列表（编译为 data/<ns>/recipes/<id>.json） */
  recipes?: RecipeDef[]
  /** 战利品表（语义模型，编译为 data/<ns>/loot_tables/...） */
  lootTable?: LootTableDef
  advancement?: UnifiedAdvancementEntry[]
  tags?: UnifiedTagEntry[]
  worldgen?: UnifiedWorldgenEntry[]
  function?: UnifiedFunctionEntry[]
  /** M17：biome 完整 JSON 文档（type='biome' 时使用；表单覆盖子集，保存时 merge） */
  biomeDoc?: Record<string, unknown>
  /** M17：advancement 完整 JSON 文档（type='advancement' 时使用；同上） */
  advancementDoc?: Record<string, unknown>
}

/* ---------------- 元数据 ---------------- */

/** 构建状态 */
export type BuildStatus = 'pending' | 'pass' | 'fail'

/** 内容对象元数据 */
export interface UnifiedContentMeta {
  createdAt: number
  updatedAt: number
  /** 是否通过编译验证 */
  verified: boolean
  buildStatus: BuildStatus
}

/* ---------------- 顶层对象 ---------------- */

/**
 * 统一内容对象——三端数据在内存里是同一个对象。
 * 用户改任意一边，另外两边实时同步（通过生成器）。
 */
export interface UnifiedContent {
  /** 注册名（全小写下划线），如 ruby_ore */
  id: string
  /** 内容类型 */
  type: UnifiedContentType
  /** 多语言显示名称 */
  displayName: DisplayName
  description?: string

  /** Java 代码端 */
  java: UnifiedJavaSide
  /** 资源包端 */
  assets: UnifiedAssetsSide
  /** 数据包端 */
  data: UnifiedDataSide

  /** 元数据 */
  meta: UnifiedContentMeta
}

/* ------------------------------------------------------------------ */
/* 工厂函数                                                              */
/* ------------------------------------------------------------------ */

function nowStamp(): { createdAt: number; updatedAt: number } {
  const now = Date.now()
  return { createdAt: now, updatedAt: now }
}

function defaultMeta(): UnifiedContentMeta {
  return { ...nowStamp(), verified: false, buildStatus: 'pending' }
}

/** 方块默认属性（与 block.schema createDefaultBlock 对齐） */
function defaultBlockProperties(): BlockJavaProperties {
  return {
    hardness: 2,
    resistance: 2,
    requiresTool: false,
    toolType: 'hand',
    miningLevel: 0,
    lightLevel: 0,
    opaque: true,
    renderType: 'solid',
    soundGroup: 'stone',
    hasCollision: true,
    canBePushed: true,
    dropsSelf: true,
    flammable: false
  }
}

/** 物品默认属性（与 item.schema createDefaultItem 对齐） */
function defaultItemProperties(): ItemJavaProperties {
  return {
    maxCount: 64,
    maxDamage: 0,
    rarity: 'common',
    fireproof: false,
    creativeTab: ''
  }
}

/** 实体默认属性（与 entity.schema createDefaultEntity passive 对齐） */
function defaultEntityProperties(): EntityJavaProperties {
  return {
    width: 0.9,
    height: 1.4,
    eyeHeight: 1.2,
    trackingRange: 8,
    updateInterval: 3,
    fireImmune: false,
    canSpawnFarFromPlayer: false,
    spawnGroup: 'CREATURE',
    primaryColor: '#a8c98f',
    secondaryColor: '#6f8f5a'
  }
}

/**
 * 由 id 确定性派生 Java 类名（唯一权威规则）：
 * goblin_knight → GoblinKnight + 类型后缀（block→Block / item→Item / entity→无后缀）。
 * 工厂默认值与适配层（unified.adapter）共用，保证扁平 ↔ 统一双向转换往返一致。
 */
export function deriveContentClassName(
  id: string,
  type: 'block' | 'item' | 'entity'
): string {
  const base = id
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
  return type === 'block' ? `${base}Block` : type === 'item' ? `${base}Item` : base
}

/** 创建默认方块内容对象 */
export function createDefaultUnifiedBlock(id: string, namespace = 'mymod'): UnifiedContent {
  const className = deriveContentClassName(id, 'block')
  return {
    id,
    type: 'block',
    displayName: { en_us: id, zh_cn: id },
    description: '',
    java: {
      className,
      packageName: `${namespace}.block`,
      properties: defaultBlockProperties(),
      customLogic: null,
      blockType: 'simple',
      cubeModelId: null,
      blockItem: { enabled: true, creativeTab: '' }
    },
    assets: {
      textures: { block: [{ path: `block/${id}`, generated: true, color: '#7f848e' }] },
      model: { type: 'cube_all', customJson: null },
      blockstate: undefined,
      lang: { [`block.${namespace}.${id}`]: id }
    },
    data: {},
    meta: defaultMeta()
  }
}

/** 创建默认物品内容对象 */
export function createDefaultUnifiedItem(id: string, namespace = 'mymod'): UnifiedContent {
  const className = deriveContentClassName(id, 'item')
  return {
    id,
    type: 'item',
    displayName: { en_us: id, zh_cn: id },
    description: '',
    java: {
      className,
      packageName: `${namespace}.item`,
      properties: defaultItemProperties(),
      customLogic: null,
      itemType: 'simple',
      cubeModelId: null
    },
    assets: {
      textures: { item: { path: `item/${id}`, generated: true, color: '#cbb37a' } },
      model: { type: 'item_generated', customJson: null, parent: 'item/generated', layer0: `item/${id}` },
      lang: { [`item.${namespace}.${id}`]: id }
    },
    data: {},
    meta: defaultMeta()
  }
}

/**
 * 切换统一对象的物品子类型（功能完整性：物品类型切换 UI 的语义层）。
 * 语义与 item.schema 的 applyItemType 对齐：保留基础信息/通用属性/贴图/模型，
 * 清空旧类型专属配置（tool/armor/food/blockRef）并填入新类型默认值；
 * 切到 food 时耐久归零、堆叠恢复 64（食物与耐久互斥的堆叠语义）。
 * 非物品对象或类型未变化时为空操作。
 */
export function applyUnifiedItemType(u: UnifiedContent, next: ItemKindType): void {
  if (u.type !== 'item' || u.java.itemType === next) return
  u.java.itemType = next
  delete u.java.tool
  delete u.java.armor
  delete u.java.food
  delete u.java.blockRef
  Object.assign(u.java, createTypeConfig(next))
  if (next === 'food') {
    const p = u.java.properties as ItemJavaProperties
    if (p.maxDamage > 0) {
      p.maxDamage = 0
      p.maxCount = 64
    }
  }
}

/** 创建默认实体内容对象 */
export function createDefaultUnifiedEntity(id: string, namespace = 'mymod'): UnifiedContent {
  const className = deriveContentClassName(id, 'entity')
  return {
    id,
    type: 'entity',
    displayName: { en_us: id, zh_cn: id },
    description: '',
    java: {
      className,
      packageName: `${namespace}.entity`,
      properties: defaultEntityProperties(),
      customLogic: null,
      entityType: 'passive',
      baseClass: 'PathAwareEntity',
      attributes: {
        maxHealth: 20,
        movementSpeed: 0.25,
        attackDamage: 0,
        armor: 0,
        followRange: 16,
        knockbackResistance: 0
      },
      ai: { goals: [], targets: [] },
      spawn: {
        naturalSpawn: true,
        biomes: ['#minecraft:is_overworld'],
        weight: 10,
        minGroupSize: 2,
        maxGroupSize: 4,
        lightLevel: 'day'
      },
      spawnEgg: { enabled: true, creativeTab: '' }
    },
    assets: {
      textures: { entity: { path: `entity/${id}` } },
      model: { type: 'entity', customJson: null, entityModelType: 'custom', modelPath: null, animationPath: null },
      lang: { [`entity.${namespace}.${id}`]: id }
    },
    data: {},
    meta: defaultMeta()
  }
}

/** 纯数据包类型（biome/advancement）的三端骨架：java 空壳 + 最小 assets，doc 承载产物 JSON */
function createDefaultUnifiedDatapackContent(
  type: 'biome' | 'advancement',
  id: string
): UnifiedContent {
  const doc = type === 'biome' ? createBiomeDefault() : createAdvancementDefault()
  return {
    id,
    type,
    displayName: { en_us: id, zh_cn: id },
    description: '',
    java: {
      className: '',
      packageName: '',
      properties: {} as ContentJavaProperties,
      customLogic: null
    },
    assets: { textures: {}, model: { type: 'custom', customJson: null }, lang: {} },
    data: type === 'biome' ? { biomeDoc: doc } : { advancementDoc: doc },
    meta: defaultMeta()
  }
}

/** 按类型创建默认内容对象 */
export function createDefaultUnifiedContent(
  type: UnifiedContentType,
  id: string,
  namespace = 'mymod'
): UnifiedContent {
  switch (type) {
    case 'block':
      return createDefaultUnifiedBlock(id, namespace)
    case 'item':
      return createDefaultUnifiedItem(id, namespace)
    case 'entity':
      return createDefaultUnifiedEntity(id, namespace)
    case 'biome':
    case 'advancement':
      return createDefaultUnifiedDatapackContent(type, id)
    default:
      // recipe P0 暂用空结构占位
      return {
        id,
        type,
        displayName: { en_us: id, zh_cn: id },
        description: '',
        java: {
          className: id,
          packageName: namespace,
          properties: {} as ContentJavaProperties,
          customLogic: null
        },
        assets: { textures: {}, model: { type: 'custom', customJson: null }, lang: {} },
        data: {},
        meta: defaultMeta()
      }
  }
}

/* ------------------------------------------------------------------ */
/* 校验                                                                  */
/* ------------------------------------------------------------------ */

/** 保存层校验；通过返回 null，否则返回错误消息 */
export function validateUnifiedContent(c: UnifiedContent): string | null {
  if (!validateContentId(c.id)) {
    return sharedT('schema.common.errRegistryName')
  }
  if (!c.displayName.en_us.trim() && !c.displayName.zh_cn.trim()) {
    return sharedT('schema.common.errDisplayName')
  }
  // M17：biome/advancement 是纯数据包类型，无 Java 类，校验 data 端文档必填键
  if (c.type === 'biome') {
    if (!c.data.biomeDoc) return sharedT('schema.unified.errBiomeDocRequired')
    return validateBiomeDoc(c.data.biomeDoc)
  }
  if (c.type === 'advancement') {
    if (!c.data.advancementDoc) return sharedT('schema.unified.errAdvancementDocRequired')
    return validateAdvancementDoc(c.data.advancementDoc)
  }
  if (!c.java.className.trim()) {
    return sharedT('schema.unified.errClassNameRequired')
  }
  if (!/^[A-Z][A-Za-z0-9]*$/.test(c.java.className)) {
    return sharedT('schema.unified.errClassNameFormat')
  }
  if (c.type === 'block' && !c.assets.textures.block?.length) {
    return sharedT('schema.unified.errBlockTextureRequired')
  }
  if (c.type === 'item' && !c.assets.textures.item) {
    return sharedT('schema.unified.errItemTextureRequired')
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 展示辅助                                                             */
/* ------------------------------------------------------------------ */

/** 取指定语言的显示名称 */
export function unifiedDisplayName(
  c: UnifiedContent,
  lang: LangKey = 'zh_cn'
): string {
  const primary = (c.displayName[lang] ?? '').trim()
  const fallback = (c.displayName[lang === 'zh_cn' ? 'en_us' : 'zh_cn'] ?? '').trim()
  return primary || fallback || c.id
}

/** 内容类型标签（builder：常量在 import 时按当前语言冻结，getter 支持按语言重建） */
function buildUnifiedTypeLabels(locale?: SharedLocale): Record<UnifiedContentType, string> {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    block: t('schema.unified.typeBlock'),
    item: t('schema.unified.typeItem'),
    entity: t('schema.unified.typeEntity'),
    biome: t('schema.unified.typeBiome'),
    recipe: t('schema.unified.typeRecipe'),
    advancement: t('schema.unified.typeAdvancement')
  }
}

export const UNIFIED_TYPE_LABELS: Record<UnifiedContentType, string> = buildUnifiedTypeLabels()

/** 按语言取内容类型标签（组件 computed 内传 locale.value 建立响应式依赖） */
export function getUnifiedTypeLabels(locale?: SharedLocale): Record<UnifiedContentType, string> {
  return buildUnifiedTypeLabels(locale)
}
