/**
 * QuickCreate 快速创建模板（C5）。
 *
 * 8 个开箱即用模板：方块 / 物品 / 食物 / 实体 / Boss 首领 / 工具 / 护甲 / 配方。
 * 前 7 个直接产出字段已填好的 UnifiedContent（跳过需求理解阶段，用户只需微调表单），
 * 「配方」模板为当前编辑对象追加一份合法起步配方（方块=9 原料围成合成，
 * 物品类=单原料无序合成，实体不支持配方）。
 *
 * 纯函数模块，零 electron 依赖，可直接 vitest。
 */
import {
  createDefaultUnifiedBlock,
  createDefaultUnifiedItem,
  createDefaultUnifiedEntity,
  type EntityJavaProperties,
  type UnifiedContent
} from './unified.schema'
import { createDefaultCube } from '../types/content'
import { createAiGoal, createAiTarget } from './entity.schema'
import { lootFixed, type LootTableDef } from './loot.schema'
import type { RecipeDef } from './recipe.schema'
import { sharedT, type SharedLocale } from '../i18n'

export type QuickCreateTemplateId =
  | 'block'
  | 'item'
  | 'food'
  | 'entity'
  | 'boss'
  | 'tool'
  | 'armor'
  | 'recipe'

export interface QuickCreateInput {
  /** 注册名（小写下划线） */
  id: string
  namespace?: string
  /** 中文名（缺省=id） */
  zhName?: string
}

export interface QuickCreateTemplateMeta {
  id: QuickCreateTemplateId
  label: string
  hint: string
}

function buildQuickCreateTemplates(locale?: SharedLocale): QuickCreateTemplateMeta[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { id: 'block', label: t('schema.quickCreate.tplBlock'), hint: t('schema.quickCreate.tplBlockHint') },
    { id: 'item', label: t('schema.quickCreate.tplItem'), hint: t('schema.quickCreate.tplItemHint') },
    { id: 'food', label: t('schema.quickCreate.tplFood'), hint: t('schema.quickCreate.tplFoodHint') },
    { id: 'entity', label: t('schema.quickCreate.tplEntity'), hint: t('schema.quickCreate.tplEntityHint') },
    { id: 'boss', label: t('schema.quickCreate.tplBoss'), hint: t('schema.quickCreate.tplBossHint') },
    { id: 'tool', label: t('schema.quickCreate.tplTool'), hint: t('schema.quickCreate.tplToolHint') },
    { id: 'armor', label: t('schema.quickCreate.tplArmor'), hint: t('schema.quickCreate.tplArmorHint') },
    { id: 'recipe', label: t('schema.quickCreate.tplRecipe'), hint: t('schema.quickCreate.tplRecipeHint') }
  ]
}

/** 模板元数据（import 时按当前语言冻结；UI 侧请用 getQuickCreateTemplates 建立响应式） */
export const QUICK_CREATE_TEMPLATES: readonly QuickCreateTemplateMeta[] = buildQuickCreateTemplates()

/** 按语言取模板元数据（组件 computed 内传 locale.value 建立响应式依赖） */
export function getQuickCreateTemplates(locale?: SharedLocale): QuickCreateTemplateMeta[] {
  return buildQuickCreateTemplates(locale)
}

function applyName(obj: UnifiedContent, namespace: string, id: string, zhName?: string): void {
  const name = zhName?.trim() || id
  obj.displayName = { en_us: id, zh_cn: name }
  const key = `${obj.type}.${namespace}.${id}`
  obj.assets.lang = { [key]: name }
}

/** 快速创建方块 */
function quickBlock(id: string, namespace: string, zhName?: string): UnifiedContent {
  const obj = createDefaultUnifiedBlock(id, namespace)
  applyName(obj, namespace, id, zhName)
  return obj
}

/** 快速创建普通物品 */
function quickItem(id: string, namespace: string, zhName?: string): UnifiedContent {
  const obj = createDefaultUnifiedItem(id, namespace)
  applyName(obj, namespace, id, zhName)
  return obj
}

/** 快速创建食物：item/food 子类型，饱食度 6、饱和度 0.6 */
function quickFood(id: string, namespace: string, zhName?: string): UnifiedContent {
  const obj = createDefaultUnifiedItem(id, namespace)
  obj.java.itemType = 'food'
  obj.java.food = {
    hunger: 6,
    saturation: 0.6,
    meat: false,
    alwaysEdible: false,
    snack: false,
    effects: []
  }
  obj.assets.textures.item = { path: `item/${id}`, generated: true, color: '#c9763a' }
  applyName(obj, namespace, id, zhName ?? sharedT('schema.quickCreate.defaultFood'))
  return obj
}

/** 快速创建实体（被动型，复用默认工厂） */
function quickEntity(id: string, namespace: string, zhName?: string): UnifiedContent {
  const obj = createDefaultUnifiedEntity(id, namespace)
  applyName(obj, namespace, id, zhName)
  return obj
}

/**
 * 快速创建 Boss 首领（敌对型，Monster 基类）。
 * 高血量/高攻击/护甲+击退抗性/大碰撞箱/火焰免疫，近战 AI + 主动攻击玩家，
 * 单只低权重黑暗生成，暗红魔系刷怪蛋；携带实体战利品表（钻石 + 概率下界之星）。
 * 三阶段语义 schema 无专用字段，以 description 文案 + customLogic 阶段钩子注释播种，
 * 不新增 schema 字段（阶段逻辑由生成器在自定义片段中保留，用户在 Java 侧补实现）。
 */
function quickBoss(id: string, namespace: string, zhName?: string): UnifiedContent {
  const obj = createDefaultUnifiedEntity(id, namespace)
  obj.java.entityType = 'hostile'
  obj.java.baseClass = 'Monster'
  obj.java.attributes = {
    maxHealth: 200,
    movementSpeed: 0.3,
    attackDamage: 12,
    armor: 8,
    followRange: 40,
    knockbackResistance: 0.8
  }
  const props = obj.java.properties as EntityJavaProperties
  props.width = 1.4
  props.height = 2.8
  props.eyeHeight = 2.5
  props.trackingRange = 12
  props.fireImmune = true
  props.canSpawnFarFromPlayer = true
  props.spawnGroup = 'MONSTER'
  props.primaryColor = '#8b1a1a'
  props.secondaryColor = '#1a0606'
  obj.java.ai = {
    goals: [
      createAiGoal('melee_attack', 1),
      createAiGoal('wander', 2),
      createAiGoal('look_at', 3),
      createAiGoal('swim', 4)
    ],
    targets: [createAiTarget('attack_player', 1), createAiTarget('hurt_by_target', 2)]
  }
  obj.java.spawn = {
    naturalSpawn: true,
    biomes: ['#minecraft:is_overworld'],
    weight: 2,
    minGroupSize: 1,
    maxGroupSize: 1,
    lightLevel: 'dark'
  }
  obj.java.spawnEgg = { enabled: true, creativeTab: '' }
  const loot: LootTableDef = {
    type: 'entity',
    pools: [
      {
        rolls: lootFixed(1),
        entries: [
          { item: 'minecraft:diamond', count: { kind: 'range', min: 2, max: 5 }, weight: 1, chance: 1 },
          {
            item: 'minecraft:nether_star',
            count: lootFixed(1),
            weight: 1,
            chance: 0.25
          }
        ]
      }
    ]
  }
  obj.data.lootTable = loot
  obj.description =
    '三阶段 Boss：一阶段（血量 > 2/3）普通近战；二阶段（≤ 2/3）提速并召唤增援；' +
    '三阶段（≤ 1/3）狂暴，攻击提升并附带抗性。阶段切换钩子已在自定义代码片段中播种。'
  obj.java.customLogic = [
    '// === Boss 三阶段钩子种子（QuickCreate 播种，请在 Java 侧补全实现）===',
    '// 阶段判定阈值：phase1 = health > maxHealth*2/3；phase2 = <=2/3；phase3 = <=1/3',
    '// phase1：常规近战（MeleeAttackGoal 已注册）',
    '// phase2：mobTick 中给予 Speed 增益并按冷却召唤同系增援（SpawnHelper / 自定义实体）',
    '// phase3：攻击附加伤害提升 + Resistance 增益，可切换更大体型/播放怒吼音效',
    '// 建议重写 mobTick()/onDamaged() 切换 phase，并通过 BossBarS2CPacket（Yarn 为',
    '// BossBarS2CPacket）同步首领血条；死亡时掉落由 data.lootTable 自动生成。'
  ].join('\n')
  applyName(obj, namespace, id, zhName ?? sharedT('schema.quickCreate.defaultBoss'))
  return obj
}

/** 快速创建工具：铁镐（默认带 3D cube 模型：柄 + 镐头，可在建模器继续编辑） */
function quickTool(id: string, namespace: string, zhName?: string): UnifiedContent {
  const obj = createDefaultUnifiedItem(id, namespace)
  obj.java.itemType = 'tool'
  obj.java.tool = {
    toolKind: 'pickaxe',
    material: 'iron',
    attackDamage: 1,
    attackSpeed: -2.8,
    miningLevel: 2
  }
  // 工具有耐久，不可堆叠
  obj.java.properties = { ...obj.java.properties, maxCount: 1 }
  obj.assets.textures.item = { path: `item/${id}`, generated: true, color: '#d8d8d8' }
  // 默认 3D 镐：柄 + 镐头两 cube（六面 #all 映射，贴图走贴图编辑器/texture_paint 补齐）
  const handle = createDefaultCube('handle')
  handle.from = [7, 0, 7]
  handle.to = [9, 10, 9]
  const head = createDefaultCube('head')
  head.from = [3, 10, 7]
  head.to = [13, 13, 9]
  // pixels 长度必须为 textureSize²（ModelAsset 校验不变量），空白画布由贴图编辑器补齐
  obj.assets.model.cubeModel = {
    textureSize: 16,
    pixels: Array.from({ length: 256 }, () => ''),
    elements: [handle, head]
  }
  applyName(obj, namespace, id, zhName ?? sharedT('schema.quickCreate.defaultTool'))
  return obj
}

/** 快速创建护甲：铁胸甲 */
function quickArmor(id: string, namespace: string, zhName?: string): UnifiedContent {
  const obj = createDefaultUnifiedItem(id, namespace)
  obj.java.itemType = 'armor'
  obj.java.armor = {
    slot: 'chestplate',
    material: 'iron',
    protection: 6,
    durability: 240,
    toughness: 0,
    knockbackResistance: 0
  }
  obj.java.properties = { ...obj.java.properties, maxCount: 1 }
  obj.assets.textures.item = { path: `item/${id}`, generated: true, color: '#c0c0c0' }
  applyName(obj, namespace, id, zhName ?? sharedT('schema.quickCreate.defaultArmor'))
  return obj
}

/**
 * 按模板创建内容对象（recipe 模板不产出对象，请用 buildQuickRecipe）。
 */
export function createQuickContent(
  template: Exclude<QuickCreateTemplateId, 'recipe'>,
  input: QuickCreateInput
): UnifiedContent {
  const ns = input.namespace ?? 'mymod'
  switch (template) {
    case 'block':
      return quickBlock(input.id, ns, input.zhName)
    case 'item':
      return quickItem(input.id, ns, input.zhName)
    case 'food':
      return quickFood(input.id, ns, input.zhName)
    case 'entity':
      return quickEntity(input.id, ns, input.zhName)
    case 'boss':
      return quickBoss(input.id, ns, input.zhName)
    case 'tool':
      return quickTool(input.id, ns, input.zhName)
    case 'armor':
      return quickArmor(input.id, ns, input.zhName)
  }
}

/**
 * 为目标对象构造一份合法起步配方。
 * - block：3×3 填满铁锭的有序合成（9 → 1，用户可改原料）
 * - item（含食物/工具/护甲）：单铁锭无序合成（1 → 1，用户可改）
 * - entity：不支持，抛错
 * 配方 id 与结果均引用目标对象自身 id（不含命名空间，编译时补 ns）。
 */
export function buildQuickRecipe(target: UnifiedContent): RecipeDef {
  if (target.type === 'block') {
    return {
      id: target.id,
      kind: 'crafting_shaped',
      pattern: ['III', 'III', 'III'],
      key: { I: { item: 'minecraft:iron_ingot' } },
      result: { item: target.id, count: 1 }
    }
  }
  if (target.type === 'item') {
    return {
      id: target.id,
      kind: 'crafting_shapeless',
      ingredients: [{ item: 'minecraft:iron_ingot' }],
      result: { item: target.id, count: 1 }
    }
  }
  throw new Error(sharedT('schema.quickCreate.errEntityRecipe'))
}
