/**
 * 实体语义 Schema（实体编辑器重做 P0）。
 *
 * 表单（EntityEditor sections）与 AI Agent（content_* 工具）共用的契约：
 * - 与加载器无关：baseClass / goal 类型均为语义值，Yarn/Mojmap 差异由后续
 *   生成器侧 translateGoal() 等映射吸收（P0 不生成任何 Java/资源产物）
 * - 磁盘形态：.kunyu/content/entities/<id>.json
 * - 判别字段 `kind: 'entity'`，加入 ContentDefinition 联合
 */
import { validateContentId } from '../types/content'
import type { EmbeddedCubeModel } from '../types/content'
import { sharedT, type SharedLocale } from '../i18n'

/** 实体类型（5 种，驱动分区默认值与 AI 目录播种） */
export type EntityKindType = 'passive' | 'hostile' | 'neutral' | 'projectile' | 'plain'

/** 基类语义值（由生成器翻译为各加载器实际类名） */
export type EntityBaseClass = 'PathAwareEntity' | 'Monster' | 'Entity'

/** 自然生成分组（Yarn SpawnGroup 语义） */
export type EntitySpawnGroup = 'CREATURE' | 'MONSTER' | 'AMBIENT' | 'WATER_CREATURE' | 'MISC'

/** 光照生成条件 */
export type SpawnLightLevel = 'any' | 'day' | 'night' | 'dark'

/** AI 行为目标类型 */
export type AiGoalType =
  | 'melee_attack'
  | 'wander'
  | 'look_at'
  | 'follow_target'
  | 'swim'
  | 'avoid_water'
  | 'panic'
  | 'mate'
  | 'eat_grass'
  | 'follow_parent'

/** AI 目标选择器类型 */
export type AiTargetType = 'attack_player' | 'hurt_by_target' | 'revenge' | 'defend_owner'

/** AI 参数值（禁 any：参数仅允许数字/布尔/字符串） */
export type AiParamValue = string | number | boolean

export type AiParamType = 'number' | 'boolean' | 'string'

/** 单个 AI 参数的表单规格（驱动动态参数表单） */
export interface AiParamSpec {
  key: string
  label: string
  type: AiParamType
  default: AiParamValue
  /** number 参数范围与步长 */
  min?: number
  max?: number
  step?: number
}

/** AI 目录条目（goal / target 共用） */
export interface AiCatalogEntry<T extends string> {
  value: T
  label: string
  /** 语义说明（P0 提示文案；P2 代码生成时映射类名） */
  hint: string
  params: AiParamSpec[]
}

/** AI 条目（goal 与 target 同构） */
export interface AiEntry<T extends string> {
  type: T
  /** 优先级，数字越小越优先（0-99） */
  priority: number
  params: Record<string, AiParamValue>
}

export type AiGoal = AiEntry<AiGoalType>
export type AiTarget = AiEntry<AiTargetType>

/** 碰撞箱 / 追踪 / 生成分组 / 刷怪蛋颜色 */
export interface EntityProperties {
  /** 碰撞箱宽度（方块单位，0.1-16） */
  width: number
  /** 碰撞箱高度（方块单位，0.1-16） */
  height: number
  /** 眼睛高度（默认约 height * 0.85） */
  eyeHeight: number
  /** 客户端追踪距离（格） */
  trackingRange: number
  /** 位置同步间隔（tick） */
  updateInterval: number
  /** 抗火 */
  fireImmune: boolean
  /** 可在远离玩家处生成 */
  canSpawnFarFromPlayer: boolean
  spawnGroup: EntitySpawnGroup
  /** 刷怪蛋主色（hex） */
  primaryColor: string
  /** 刷怪蛋副色（hex） */
  secondaryColor: string
}

/** 战斗/生存属性（映射 DefaultAttributeContainer） */
export interface EntityAttributes {
  maxHealth: number
  movementSpeed: number
  attackDamage: number
  armor: number
  followRange: number
  knockbackResistance: number
}

export interface EntityAi {
  goals: AiGoal[]
  targets: AiTarget[]
}

/** 自然生成规则 */
export interface SpawnConfig {
  naturalSpawn: boolean
  /** 生物群系选择器（如 #minecraft:is_overworld / minecraft:plains） */
  biomes: string[]
  /** 生成权重 0-1000 */
  weight: number
  minGroupSize: number
  maxGroupSize: number
  lightLevel: SpawnLightLevel
}

/** 贴图：path 为空时 P0 无贴图（后续阶段补占位生成） */
export interface EntityTexture {
  /** assets 相对路径（textures/entity/x.png） */
  path: string
}

/** 渲染器配置 */
export interface EntityRenderer {
  modelType: 'custom' | 'blockbench_geo'
  /** blockbench_geo 时的 .geo.json / .bbmodel 路径 */
  modelPath?: string | null
  /** Blockbench 动画 .animation.json 路径 */
  animationPath?: string | null
  /**
   * blockbench_geo 内嵌几何 JSON 文本（Blockbench「GeckoLib 动画模型」导出的
   * .geo.json 原文；含 description.texture_width/height 与 bones）。
   * 生成时落盘 assets/<ns>/geo/entity/<id>.geo.json，动画按骨骼名参数化生成。
   */
  geoJson?: string | null
  /**
   * 工坊模型文档 id（P4-gen）：「应用到实体」写回 geoJson 时登记来源
   * .kunyu/modeler/<id>.json，生成器据此导出文档内已创作动画；
   * 空值 / 文档缺失时回退参数化模板动画。
   */
  modelerDocId?: string | null
  /**
   * 工坊骨骼文档主贴图直出（base64 PNG，无 data: 前缀）：
   * 「应用到实体」写回 geoJson 时同步文档第一张 textures 落地；
   * 生成器优先于 cube 像素画 / 主色铺底消费，空值走旧铺底链。
   */
  texturePng?: string | null
  /** 嵌入式 3D 建模器数据（与 block/item model.cubeModel 同构） */
  cubeModel?: EmbeddedCubeModel | null
}

/** 实体语义数据结构 */
export interface EntitySchema {
  kind: 'entity'
  entityType: EntityKindType
  /** 基类语义值，随类型派生（P0 不开放手动编辑） */
  baseClass: EntityBaseClass
  id: string
  displayName: { en_us: string; zh_cn: string }
  description?: string

  /** 绑定的 Cube 模型资产 id（3D 建模器导出的实体模型） */
  cubeModelId?: string | null
  /**
   * AI 自由代码路径写入的自定义实体类全限定名（如 com.kunyu.mymod.entity.DiamondThiefEntity）。
   * 存在时即使无 cube 模型也注册该实体（渲染器走默认占位 / 缺失模型，进游戏可见可召唤）；
   * 生成器用 CustomClass 作为 EntityType 的工厂类。
   */
  customClass?: string | null
  properties: EntityProperties
  attributes: EntityAttributes
  ai: EntityAi
  spawn: SpawnConfig
  spawnEgg: {
    enabled: boolean
    creativeTab: string
  }
  texture: EntityTexture
  renderer: EntityRenderer
  /**
   * 结构化战利品表（统一编辑器 P3.2）：编译为
   * data/<ns>/loot_tables/entities/<id>.json；实体类通过同路径引用死亡掉落。
   */
  lootTable?: import('./loot.schema').LootTableDef
  /** 配方列表（统一编辑器 P3.3）：编译为 data/<ns>/recipes/<id>.json */
  recipes?: import('./recipe.schema').RecipeDef[]

  createdAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ */
/* 选项清单                                                            */
/* ------------------------------------------------------------------ */

function buildEntityTypeOptions(locale?: SharedLocale): { value: EntityKindType; label: string; hint: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'passive', label: t('schema.entity.typePassive'), hint: t('schema.entity.typePassiveHint') },
    { value: 'hostile', label: t('schema.entity.typeHostile'), hint: t('schema.entity.typeHostileHint') },
    { value: 'neutral', label: t('schema.entity.typeNeutral'), hint: t('schema.entity.typeNeutralHint') },
    { value: 'projectile', label: t('schema.entity.typeProjectile'), hint: t('schema.entity.typeProjectileHint') },
    { value: 'plain', label: t('schema.entity.typePlain'), hint: t('schema.entity.typePlainHint') }
  ]
}

export const ENTITY_TYPE_OPTIONS: { value: EntityKindType; label: string; hint: string }[] =
  buildEntityTypeOptions()

/** 语言感知版本：组件内 computed(() => getEntityTypeOptions(locale.value)) 使用 */
export function getEntityTypeOptions(locale?: SharedLocale): typeof ENTITY_TYPE_OPTIONS {
  return buildEntityTypeOptions(locale)
}

function buildSpawnGroupOptions(locale?: SharedLocale): { value: EntitySpawnGroup; label: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'CREATURE', label: t('schema.entity.spawnCreature') },
    { value: 'MONSTER', label: t('schema.entity.spawnMonster') },
    { value: 'AMBIENT', label: t('schema.entity.spawnAmbient') },
    { value: 'WATER_CREATURE', label: t('schema.entity.spawnWaterCreature') },
    { value: 'MISC', label: t('schema.entity.spawnMisc') }
  ]
}

export const SPAWN_GROUP_OPTIONS: { value: EntitySpawnGroup; label: string }[] =
  buildSpawnGroupOptions()

export function getSpawnGroupOptions(locale?: SharedLocale): typeof SPAWN_GROUP_OPTIONS {
  return buildSpawnGroupOptions(locale)
}

function buildLightLevelOptions(locale?: SharedLocale): { value: SpawnLightLevel; label: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'any', label: t('schema.entity.lightAny') },
    { value: 'day', label: t('schema.entity.lightDay') },
    { value: 'night', label: t('schema.entity.lightNight') },
    { value: 'dark', label: t('schema.entity.lightDark') }
  ]
}

export const LIGHT_LEVEL_OPTIONS: { value: SpawnLightLevel; label: string }[] =
  buildLightLevelOptions()

export function getLightLevelOptions(locale?: SharedLocale): typeof LIGHT_LEVEL_OPTIONS {
  return buildLightLevelOptions(locale)
}

function buildRendererModelOptions(locale?: SharedLocale): {
  value: EntityRenderer['modelType']
  label: string
  hint: string
}[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'custom', label: t('schema.entity.modelCustom'), hint: t('schema.entity.modelCustomHint') },
    { value: 'blockbench_geo', label: t('schema.entity.modelBlockbenchGeo'), hint: t('schema.entity.modelBlockbenchGeoHint') }
  ]
}

export const RENDERER_MODEL_OPTIONS: {
  value: EntityRenderer['modelType']
  label: string
  hint: string
}[] = buildRendererModelOptions()

export function getRendererModelOptions(locale?: SharedLocale): typeof RENDERER_MODEL_OPTIONS {
  return buildRendererModelOptions(locale)
}

/* ------------------------------------------------------------------ */
/* AI 目录（驱动动态参数表单；params 规格也是归一化/校验的唯一依据）      */
/* ------------------------------------------------------------------ */

function buildAiGoalCatalog(locale?: SharedLocale): AiCatalogEntry<AiGoalType>[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  const num = (
    key: string,
    label: string,
    dflt: number,
    range?: { min?: number; max?: number; step?: number }
  ): AiParamSpec => ({
    key,
    label,
    type: 'number',
    default: dflt,
    ...(range ?? {})
  })

  const bool = (key: string, label: string, dflt: boolean): AiParamSpec => ({
    key,
    label,
    type: 'boolean',
    default: dflt
  })

  return [
    {
      value: 'melee_attack',
      label: t('schema.entity.goalMeleeAttack'),
      hint: t('schema.entity.goalMeleeAttackHint'),
      params: [
        num('speed', t('schema.entity.paramMoveSpeed'), 1.0, { min: 0.1, max: 5, step: 0.05 }),
        bool('pauseWhenIdle', t('schema.entity.paramPauseWhenIdle'), false)
      ]
    },
    {
      value: 'wander',
      label: t('schema.entity.goalWander'),
      hint: t('schema.entity.goalWanderHint'),
      params: [num('speed', t('schema.entity.paramWanderSpeed'), 0.8, { min: 0.1, max: 5, step: 0.05 })]
    },
    {
      value: 'look_at',
      label: t('schema.entity.goalLookAt'),
      hint: t('schema.entity.goalLookAtHint'),
      params: [num('range', t('schema.entity.paramSightRange'), 8.0, { min: 1, max: 64, step: 0.5 })]
    },
    {
      value: 'follow_target',
      label: t('schema.entity.goalFollowTarget'),
      hint: t('schema.entity.goalFollowTargetHint'),
      params: [
        num('speed', t('schema.entity.paramFollowSpeed'), 1.0, { min: 0.1, max: 5, step: 0.05 }),
        num('minDistance', t('schema.entity.paramMinDistance'), 3, { min: 1, max: 32, step: 1 }),
        num('maxDistance', t('schema.entity.paramMaxDistance'), 7, { min: 1, max: 64, step: 1 }),
        bool('canFly', t('schema.entity.paramCanFly'), false)
      ]
    },
    { value: 'swim', label: t('schema.entity.goalSwim'), hint: t('schema.entity.goalSwimHint'), params: [] },
    { value: 'avoid_water', label: t('schema.entity.goalAvoidWater'), hint: t('schema.entity.goalAvoidWaterHint'), params: [] },
    {
      value: 'panic',
      label: t('schema.entity.goalPanic'),
      hint: t('schema.entity.goalPanicHint'),
      params: [num('speed', t('schema.entity.paramFleeSpeed'), 1.5, { min: 0.1, max: 5, step: 0.05 })]
    },
    {
      value: 'mate',
      label: t('schema.entity.goalMate'),
      hint: t('schema.entity.goalMateHint'),
      params: [num('speed', t('schema.entity.paramBreedSpeed'), 1.0, { min: 0.1, max: 5, step: 0.05 })]
    },
    { value: 'eat_grass', label: t('schema.entity.goalEatGrass'), hint: t('schema.entity.goalEatGrassHint'), params: [] },
    {
      value: 'follow_parent',
      label: t('schema.entity.goalFollowParent'),
      hint: t('schema.entity.goalFollowParentHint'),
      params: [num('speed', t('schema.entity.paramFollowSpeed'), 1.0, { min: 0.1, max: 5, step: 0.05 })]
    }
  ]
}

export const AI_GOAL_CATALOG: AiCatalogEntry<AiGoalType>[] = buildAiGoalCatalog()

export function getAiGoalCatalog(locale?: SharedLocale): AiCatalogEntry<AiGoalType>[] {
  return buildAiGoalCatalog(locale)
}

function buildAiTargetCatalog(locale?: SharedLocale): AiCatalogEntry<AiTargetType>[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    {
      value: 'attack_player',
      label: t('schema.entity.targetAttackPlayer'),
      hint: t('schema.entity.targetAttackPlayerHint'),
      params: []
    },
    {
      value: 'hurt_by_target',
      label: t('schema.entity.targetHurtByTarget'),
      hint: t('schema.entity.targetHurtByTargetHint'),
      params: []
    },
    {
      value: 'revenge',
      label: t('schema.entity.targetRevenge'),
      hint: t('schema.entity.targetRevengeHint'),
      params: []
    },
    {
      value: 'defend_owner',
      label: t('schema.entity.targetDefendOwner'),
      hint: t('schema.entity.targetDefendOwnerHint'),
      params: []
    }
  ]
}

export const AI_TARGET_CATALOG: AiCatalogEntry<AiTargetType>[] = buildAiTargetCatalog()

export function getAiTargetCatalog(locale?: SharedLocale): AiCatalogEntry<AiTargetType>[] {
  return buildAiTargetCatalog(locale)
}

const GOAL_CATALOG_MAP: Record<AiGoalType, AiCatalogEntry<AiGoalType>> = Object.fromEntries(
  AI_GOAL_CATALOG.map((e) => [e.value, e])
) as Record<AiGoalType, AiCatalogEntry<AiGoalType>>

const TARGET_CATALOG_MAP: Record<AiTargetType, AiCatalogEntry<AiTargetType>> = Object.fromEntries(
  AI_TARGET_CATALOG.map((e) => [e.value, e])
) as Record<AiTargetType, AiCatalogEntry<AiTargetType>>

/** 是否为已注册的 goal / target 类型 */
export function isKnownGoal(type: string): type is AiGoalType {
  return type in GOAL_CATALOG_MAP
}
export function isKnownTarget(type: string): type is AiTargetType {
  return type in TARGET_CATALOG_MAP
}

function defaultParams(specs: AiParamSpec[]): Record<string, AiParamValue> {
  const params: Record<string, AiParamValue> = {}
  for (const spec of specs) params[spec.key] = spec.default
  return params
}

/** 按目录规格创建一个 goal 条目（priority 由调用方给序号） */
export function createAiGoal(type: AiGoalType, priority: number): AiGoal {
  return { type, priority, params: defaultParams(GOAL_CATALOG_MAP[type].params) }
}

/** 按目录规格创建一个 target 条目 */
export function createAiTarget(type: AiTargetType, priority: number): AiTarget {
  return { type, priority, params: defaultParams(TARGET_CATALOG_MAP[type].params) }
}

/* ------------------------------------------------------------------ */
/* 默认值 / 类型切换                                                    */
/* ------------------------------------------------------------------ */

function nowStamp(): { createdAt: number; updatedAt: number } {
  const now = Date.now()
  return { createdAt: now, updatedAt: now }
}

interface TypeDefaults {
  baseClass: EntityBaseClass
  spawnGroup: EntitySpawnGroup
  colors: { primary: string; secondary: string }
  dimensions: { width: number; height: number; eyeHeight: number }
  attributes: EntityAttributes
  goals: { type: AiGoalType; priority: number }[]
  targets: AiTargetType[]
  naturalSpawn: boolean
  lightLevel: SpawnLightLevel
  spawnEgg: boolean
}

const TYPE_DEFAULTS: Record<EntityKindType, TypeDefaults> = {
  passive: {
    baseClass: 'PathAwareEntity',
    spawnGroup: 'CREATURE',
    colors: { primary: '#a8c98f', secondary: '#6f8f5a' },
    dimensions: { width: 0.9, height: 1.4, eyeHeight: 1.2 },
    attributes: {
      maxHealth: 20,
      movementSpeed: 0.25,
      attackDamage: 0,
      armor: 0,
      followRange: 16,
      knockbackResistance: 0
    },
    goals: [
      { type: 'swim', priority: 1 },
      { type: 'panic', priority: 2 },
      { type: 'mate', priority: 3 },
      { type: 'follow_parent', priority: 4 },
      { type: 'wander', priority: 5 },
      { type: 'look_at', priority: 6 }
    ],
    targets: [],
    naturalSpawn: true,
    lightLevel: 'day',
    spawnEgg: true
  },
  hostile: {
    baseClass: 'Monster',
    spawnGroup: 'MONSTER',
    colors: { primary: '#c0564c', secondary: '#4a3a3a' },
    dimensions: { width: 0.6, height: 1.95, eyeHeight: 1.62 },
    attributes: {
      maxHealth: 20,
      movementSpeed: 0.25,
      attackDamage: 3,
      armor: 0,
      followRange: 16,
      knockbackResistance: 0
    },
    goals: [
      { type: 'melee_attack', priority: 1 },
      { type: 'wander', priority: 2 },
      { type: 'look_at', priority: 3 },
      { type: 'swim', priority: 4 }
    ],
    targets: ['attack_player', 'hurt_by_target'],
    naturalSpawn: true,
    lightLevel: 'dark',
    spawnEgg: true
  },
  neutral: {
    baseClass: 'PathAwareEntity',
    spawnGroup: 'CREATURE',
    colors: { primary: '#d8c98a', secondary: '#5a5330' },
    dimensions: { width: 0.6, height: 1.8, eyeHeight: 1.62 },
    attributes: {
      maxHealth: 20,
      movementSpeed: 0.25,
      attackDamage: 2,
      armor: 0,
      followRange: 16,
      knockbackResistance: 0
    },
    goals: [
      { type: 'swim', priority: 1 },
      { type: 'panic', priority: 2 },
      { type: 'wander', priority: 3 },
      { type: 'look_at', priority: 4 }
    ],
    targets: ['revenge'],
    naturalSpawn: true,
    lightLevel: 'any',
    spawnEgg: true
  },
  projectile: {
    baseClass: 'Entity',
    spawnGroup: 'MISC',
    colors: { primary: '#9aa7b0', secondary: '#4a5258' },
    dimensions: { width: 0.5, height: 0.5, eyeHeight: 0.25 },
    attributes: {
      maxHealth: 1,
      movementSpeed: 0,
      attackDamage: 0,
      armor: 0,
      followRange: 0,
      knockbackResistance: 0
    },
    goals: [],
    targets: [],
    naturalSpawn: false,
    lightLevel: 'any',
    spawnEgg: false
  },
  plain: {
    baseClass: 'Entity',
    spawnGroup: 'MISC',
    colors: { primary: '#b0b4bc', secondary: '#565b64' },
    dimensions: { width: 0.8, height: 0.6, eyeHeight: 0.4 },
    attributes: {
      maxHealth: 10,
      movementSpeed: 0,
      attackDamage: 0,
      armor: 0,
      followRange: 0,
      knockbackResistance: 0
    },
    goals: [],
    targets: [],
    naturalSpawn: false,
    lightLevel: 'any',
    spawnEgg: false
  }
}

/** 类型专属配置（属性 / AI / 生成 / 分组与配色） */
export function createEntityTypeConfig(entityType: EntityKindType): {
  baseClass: EntityBaseClass
  properties: Pick<EntityProperties, 'spawnGroup' | 'primaryColor' | 'secondaryColor'>
  attributes: EntityAttributes
  ai: EntityAi
  spawn: Pick<SpawnConfig, 'naturalSpawn' | 'lightLevel'>
  spawnEgg: { enabled: boolean }
} {
  const d = TYPE_DEFAULTS[entityType]
  return {
    baseClass: d.baseClass,
    properties: {
      spawnGroup: d.spawnGroup,
      primaryColor: d.colors.primary,
      secondaryColor: d.colors.secondary
    },
    attributes: { ...d.attributes },
    ai: {
      goals: d.goals.map((g) => createAiGoal(g.type, g.priority)),
      targets: d.targets.map((t, i) => createAiTarget(t, i + 1))
    },
    spawn: { naturalSpawn: d.naturalSpawn, lightLevel: d.lightLevel },
    spawnEgg: { enabled: d.spawnEgg }
  }
}

/** 创建默认实体（entityType 可选，默认 passive） */
export function createDefaultEntity(id: string, entityType: EntityKindType = 'passive'): EntitySchema {
  const d = TYPE_DEFAULTS[entityType]
  return {
    kind: 'entity',
    entityType,
    baseClass: d.baseClass,
    id,
    displayName: { en_us: id, zh_cn: id },
    description: '',
    properties: {
      width: d.dimensions.width,
      height: d.dimensions.height,
      eyeHeight: d.dimensions.eyeHeight,
      trackingRange: 8,
      updateInterval: 3,
      fireImmune: false,
      canSpawnFarFromPlayer: false,
      spawnGroup: d.spawnGroup,
      primaryColor: d.colors.primary,
      secondaryColor: d.colors.secondary
    },
    attributes: { ...d.attributes },
    ai: {
      goals: d.goals.map((g) => createAiGoal(g.type, g.priority)),
      targets: d.targets.map((t, i) => createAiTarget(t, i + 1))
    },
    spawn: {
      naturalSpawn: d.naturalSpawn,
      biomes: d.naturalSpawn ? ['#minecraft:is_overworld'] : [],
      weight: 10,
      minGroupSize: 2,
      maxGroupSize: 4,
      lightLevel: d.lightLevel
    },
    spawnEgg: { enabled: d.spawnEgg, creativeTab: '' },
    texture: { path: '' },
    renderer: { modelType: 'custom', modelPath: null, animationPath: null, geoJson: null },
    ...nowStamp()
  }
}

/**
 * 类型切换：保留通用字段（名称/描述/碰撞箱/追踪/贴图/渲染器），
 * 重播种基类、分组配色、属性、AI、生成规则与刷怪蛋开关。
 */
export function applyEntityType(entity: EntitySchema, next: EntityKindType): void {
  if (entity.entityType === next) return
  entity.entityType = next
  const cfg = createEntityTypeConfig(next)
  entity.baseClass = cfg.baseClass
  entity.properties.spawnGroup = cfg.properties.spawnGroup
  entity.properties.primaryColor = cfg.properties.primaryColor
  entity.properties.secondaryColor = cfg.properties.secondaryColor
  entity.attributes = cfg.attributes
  entity.ai = cfg.ai
  entity.spawn.naturalSpawn = cfg.spawn.naturalSpawn
  entity.spawn.lightLevel = cfg.spawn.lightLevel
  if (cfg.spawn.naturalSpawn && entity.spawn.biomes.length === 0) {
    entity.spawn.biomes = ['#minecraft:is_overworld']
  }
  if (!cfg.spawn.naturalSpawn) entity.spawn.biomes = []
  entity.spawnEgg.enabled = cfg.spawnEgg.enabled
}

/* ------------------------------------------------------------------ */
/* 归一化 / 校验                                                        */
/* ------------------------------------------------------------------ */

function clampNum(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function numericOf(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw)
  return NaN
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function normalizeParam(spec: AiParamSpec, raw: unknown): AiParamValue {
  const v = raw === undefined ? spec.default : raw
  if (spec.type === 'number') {
    const min = spec.min ?? -Infinity
    const max = spec.max ?? Infinity
    const clamped = clampNum(numericOf(v), min, max, spec.default as number)
    return spec.step && spec.step < 0.1 ? Math.round(clamped * 1000) / 1000 : round2(clamped)
  }
  if (spec.type === 'boolean') return v === true
  return typeof v === 'string' ? v.trim() : String(v ?? '').trim()
}

function normalizeGoals(raw: unknown): AiGoal[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((g): g is Record<string, unknown> => Boolean(g) && typeof g === 'object')
    .map((g) => {
      const type = String(g.type ?? '')
      if (!isKnownGoal(type)) return null
      const catalog = GOAL_CATALOG_MAP[type]
      const params: Record<string, AiParamValue> = {}
      const src = g.params && typeof g.params === 'object' ? (g.params as Record<string, unknown>) : {}
      for (const spec of catalog.params) params[spec.key] = normalizeParam(spec, src[spec.key])
      return {
        type,
        priority: Math.round(clampNum(numericOf(g.priority), 0, 99, 0)),
        params
      }
    })
    .filter((g): g is AiGoal => g !== null)
    .slice(0, 16)
}

function normalizeTargets(raw: unknown): AiTarget[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
    .map((t) => {
      const type = String(t.type ?? '')
      if (!isKnownTarget(type)) return null
      const catalog = TARGET_CATALOG_MAP[type]
      const params: Record<string, AiParamValue> = {}
      const src = t.params && typeof t.params === 'object' ? (t.params as Record<string, unknown>) : {}
      for (const spec of catalog.params) params[spec.key] = normalizeParam(spec, src[spec.key])
      return {
        type,
        priority: Math.round(clampNum(numericOf(t.priority), 0, 99, 0)),
        params
      }
    })
    .filter((t): t is AiTarget => t !== null)
    .slice(0, 8)
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/** 归一化：字段补全、范围收敛、AI 条目按目录合法化 */
export function normalizeEntitySchema(e: EntitySchema): EntitySchema {
  const entityType: EntityKindType = ENTITY_TYPE_OPTIONS.some((t) => t.value === e.entityType)
    ? e.entityType
    : 'passive'
  const defaults = TYPE_DEFAULTS[entityType]
  const p = e.properties ?? ({} as Partial<EntityProperties>)
  const a = e.attributes ?? ({} as Partial<EntityAttributes>)
  const s = e.spawn ?? ({} as Partial<SpawnConfig>)

  const width = round2(clampNum(numericOf(p.width), 0.1, 16, defaults.dimensions.width))
  const height = round2(clampNum(numericOf(p.height), 0.1, 16, defaults.dimensions.height))
  const eyeHeight = round2(clampNum(numericOf(p.eyeHeight), 0, 16, defaults.dimensions.eyeHeight))

  let minGroupSize = Math.round(clampNum(numericOf(s.minGroupSize), 1, 100, 2))
  let maxGroupSize = Math.round(clampNum(numericOf(s.maxGroupSize), 1, 100, 4))
  if (minGroupSize > maxGroupSize) {
    // 以 max 为基准交换，保证 min <= max
    const tmp = minGroupSize
    minGroupSize = maxGroupSize
    maxGroupSize = tmp
  }

  const biomes = Array.isArray(s.biomes)
    ? [...new Set(s.biomes.map((b) => String(b).trim()).filter(Boolean))].slice(0, 64)
    : []

  return {
    ...e,
    kind: 'entity',
    entityType,
    baseClass: defaults.baseClass,
    id: (e.id ?? '').trim(),
    displayName: {
      en_us: (e.displayName?.en_us ?? '').trim(),
      zh_cn: (e.displayName?.zh_cn ?? '').trim()
    },
    description: (e.description ?? '').trim(),
    properties: {
      width,
      height,
      eyeHeight,
      trackingRange: Math.round(clampNum(numericOf(p.trackingRange), 1, 256, 8)),
      updateInterval: Math.round(clampNum(numericOf(p.updateInterval), 1, 20, 3)),
      fireImmune: p.fireImmune === true,
      canSpawnFarFromPlayer: p.canSpawnFarFromPlayer === true,
      spawnGroup: SPAWN_GROUP_OPTIONS.some((g) => g.value === p.spawnGroup)
        ? p.spawnGroup
        : defaults.spawnGroup,
      primaryColor: HEX_RE.test(p.primaryColor ?? '') ? p.primaryColor : defaults.colors.primary,
      secondaryColor: HEX_RE.test(p.secondaryColor ?? '')
        ? p.secondaryColor
        : defaults.colors.secondary
    },
    attributes: {
      maxHealth: round2(clampNum(numericOf(a.maxHealth), 1, 1024, defaults.attributes.maxHealth)),
      movementSpeed:
        Math.round(clampNum(numericOf(a.movementSpeed), 0, 10, defaults.attributes.movementSpeed) * 10000) /
        10000,
      attackDamage: round2(clampNum(numericOf(a.attackDamage), 0, 1024, defaults.attributes.attackDamage)),
      armor: round2(clampNum(numericOf(a.armor), 0, 30, defaults.attributes.armor)),
      followRange: round2(clampNum(numericOf(a.followRange), 0, 2048, defaults.attributes.followRange)),
      knockbackResistance:
        Math.round(clampNum(numericOf(a.knockbackResistance), 0, 1, 0) * 100) / 100
    },
    ai: {
      goals: normalizeGoals(e.ai?.goals),
      targets: normalizeTargets(e.ai?.targets)
    },
    spawn: {
      naturalSpawn: s.naturalSpawn === true,
      biomes: s.naturalSpawn === true ? biomes : [],
      weight: Math.round(clampNum(numericOf(s.weight), 0, 1000, 10)),
      minGroupSize,
      maxGroupSize,
      lightLevel: LIGHT_LEVEL_OPTIONS.some((l) => l.value === s.lightLevel)
        ? s.lightLevel
        : defaults.lightLevel
    },
    spawnEgg: {
      enabled: e.spawnEgg?.enabled === true,
      creativeTab: (e.spawnEgg?.creativeTab ?? '').trim()
    },
    texture: { path: (e.texture?.path ?? '').trim() },
    renderer: {
      modelType: e.renderer?.modelType === 'blockbench_geo' ? 'blockbench_geo' : 'custom',
      modelPath: (e.renderer?.modelPath ?? '').toString().trim() || null,
      animationPath: (e.renderer?.animationPath ?? '').toString().trim() || null,
      geoJson: typeof e.renderer?.geoJson === 'string' && e.renderer.geoJson.trim()
        ? e.renderer.geoJson
        : null,
      modelerDocId: (e.renderer?.modelerDocId ?? '').toString().trim() || null,
      texturePng:
        typeof e.renderer?.texturePng === 'string' && e.renderer.texturePng.trim()
          ? e.renderer.texturePng
          : null,
      ...(e.renderer?.cubeModel ? { cubeModel: e.renderer.cubeModel } : {})
    },
    createdAt: e.createdAt ?? Date.now(),
    updatedAt: e.updatedAt ?? Date.now(),
    cubeModelId: e.cubeModelId ? e.cubeModelId : null,
    customClass: typeof e.customClass === 'string' && e.customClass.trim() ? e.customClass.trim() : null
  }
}

/** 保存层校验；通过返回 null，否则返回错误消息 */
export function validateEntitySchema(e: EntitySchema): string | null {
  if (!validateContentId(e.id)) {
    return sharedT('schema.common.errRegistryName')
  }
  if (!e.displayName.en_us.trim() && !e.displayName.zh_cn.trim()) {
    return sharedT('schema.common.errDisplayName')
  }
  if (!(e.properties.width > 0) || !(e.properties.height > 0)) {
    return sharedT('schema.entity.errBoxSize')
  }
  if (e.spawn.naturalSpawn) {
    if (e.spawn.biomes.length === 0) return sharedT('schema.entity.errBiomeRequired')
    if (e.spawn.minGroupSize > e.spawn.maxGroupSize) {
      return sharedT('schema.entity.errGroupRange')
    }
  }
  if (e.renderer.modelType === 'blockbench_geo' && !e.renderer.modelPath && !e.renderer.geoJson) {
    return sharedT('schema.entity.errGeoRequired')
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 展示辅助                                                             */
/* ------------------------------------------------------------------ */

/** 取指定语言的显示名称，缺省回落到另一语言再回落到 id */
export function entityDisplayName(e: EntitySchema, lang: 'en_us' | 'zh_cn' = 'zh_cn'): string {
  const primary = (e.displayName?.[lang] ?? '').trim()
  const fallback = (e.displayName?.[lang === 'zh_cn' ? 'en_us' : 'zh_cn'] ?? '').trim()
  return primary || fallback || e.id
}
