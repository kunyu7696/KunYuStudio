/**
 * 方块语义 Schema（方块编辑器重做 P0）。
 *
 * 表单（BlockEditor sections）、代码生成器（经主进程 blockAdapter 适配为
 * GeneratorBlock 旧扁平形状后进入 contentGenerator / mojmapCodegen）、
 * AI Agent（content_* 工具）三方共用的契约：
 * - 与加载器无关：不含任何 Fabric/Forge/NeoForge 特定字段
 * - 磁盘形态：.kunyu/content/blocks/<id>.json
 * - 判别字段沿用 `kind: 'block'`，与 ContentDefinition 联合类型一致
 * - 旧版扁平 BlockDefinition 磁盘 JSON 由 migrateLegacyBlock 在读取时一次性迁移
 * - P0 边界：blockStates / blockEntity / interaction 仅保存语义，变体与方块实体
 *   代码生成在后续阶段开放（当前生成仍为单变体方块）
 */
import { validateContentId } from '../types/content'
import type { CubeFaceName, EmbeddedCubeModel } from '../types/content'
import { sharedT, type SharedLocale } from '../i18n'

/** 方块类型（5 种，驱动 BlockEditor 动态分区渲染与默认配置播种） */
export type BlockType = 'simple' | 'directional' | 'toggle' | 'interactive' | 'entity'

/** 挖掘工具（对应 Minecraft mineable/<tool> 标签；hand/sword 不打标签） */
export type MiningTool = 'hand' | 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword'

/** 挖掘等级：0 徒手/木，1 石，2 铁，3 钻石，4 下界合金（对应 needs_*_tool 标签） */
export type MiningLevel = 0 | 1 | 2 | 3 | 4

/** 碰撞箱形态（旧版字段，迁移与适配层使用；UI 新数据以 hasCollision + model.type 表达） */
export type CollisionType = 'full' | 'slab' | 'stairs' | 'none'

/** 右键交互行为（旧版字段，迁移映射到 InteractionConfig.action） */
export type RightClickAction = 'none' | 'gui' | 'event' | 'sound'

/** 音效组（映射 Fabric BlockSoundGroup） */
export type SoundGroup = 'stone' | 'wood' | 'gravel' | 'metal' | 'glass' | 'wool'

/** 渲染层：solid 不透明 / cutout 镂空（alpha 测试）/ translucent 半透明 */
export type BlockRenderType = 'solid' | 'cutout' | 'translucent'

/** 方块模型形态（slab/stairs 为语义保留位，P0 生成仍按 cube_all 产出） */
export type BlockModelType = 'cube_all' | 'cube' | 'cross' | 'slab' | 'stairs' | 'custom'

/** 旧版方块类型预设（旧 UI 迁移期保留；新表单不使用） */
export type BlockPresetId =
  | 'custom'
  | 'ore'
  | 'log'
  | 'planks'
  | 'dirt'
  | 'stone'
  | 'metal'
  | 'glass'
  | 'machine'
  | 'glowing'

/** 方块状态定义 */
export interface BlockStateConfig {
  /** 状态名（小写蛇形），如 facing / powered / lit */
  name: string
  type: 'boolean' | 'enum'
  /** boolean 固定 ['true','false']；enum 为枚举取值列表 */
  values: string[]
  /** 默认值，必须属于 values */
  defaultValue: string
}

/** 方块实体字段类型 */
export type BlockEntityFieldType = 'int' | 'float' | 'string' | 'boolean' | 'itemstack'

/** 方块实体 NBT 字段（P0 仅语义） */
export interface BlockEntityField {
  name: string
  type: BlockEntityFieldType
  /** int/float 为数字，boolean 为布尔，string/itemstack 为字符串（itemstack 存物品 id） */
  defaultValue: string | number | boolean
  /** 是否同步到客户端 */
  sync: boolean
}

/** 方块实体配置（P0 仅语义，代码生成后续开放） */
export interface BlockEntityConfig {
  /** 是否需要服务器 tick */
  tickable: boolean
  /** 是否持久化 NBT */
  persistent: boolean
  /** 是否同步到客户端 */
  syncToClient: boolean
  fields: BlockEntityField[]
  /** 破坏时是否掉落物品栏内容 */
  dropInventory: boolean
}

/** 右键交互配置（P0 仅语义） */
export interface InteractionConfig {
  action: RightClickAction
  /** action=event 时的服务端事件名 */
  eventName: string
  /** action=sound 时的音效事件（语义 id，如 mymod:machine_click） */
  soundEvent: string
}

/** 方块贴图：path 非空优先用自定义 PNG，否则用 color 生成占位纯色；pixels 为像素画源数据 */
export interface BlockTexture {
  /** assets 相对路径（textures/block/x.png），空 = 未使用自定义贴图 */
  path: string
  /** true = 由工具生成占位贴图；false = 使用 path 的自定义贴图 */
  generated: boolean
  /** 占位纯色（hex） */
  color: string
  /** 像素画数据：256 项（16×16），hex 或 ''=透明 */
  pixels?: string[]
  /** model.type='cube' 时六面各自的贴图路径，缺键回落到 path/color */
  faces?: Partial<Record<CubeFaceName, string>>
}

/** 方块模型配置 */
export interface BlockModelConfig {
  type: BlockModelType
  /** type='custom' 时的原版模型 JSON（P0 原样保存，生成时直出） */
  customJson?: Record<string, unknown> | null
  /** 统一编辑器的嵌入式可编辑模型（保存时导出独立模型并绑定） */
  cubeModel?: EmbeddedCubeModel | null
}

/** 方块物理 / 渲染 / 行为属性 */
export interface BlockProperties {
  /** 硬度（挖掘时间基准，映射 strength 第一参数），0-50 */
  hardness: number
  /** 抗爆性（映射 strength 第二参数），0-100 */
  resistance: number
  /** 是否需要正确工具才能掉落 */
  requiresTool: boolean
  toolType: MiningTool
  miningLevel: MiningLevel
  /** 发光等级 0-15 */
  lightLevel: number
  /** 是否阻挡光线（false 映射 nonOpaque） */
  opaque: boolean
  renderType: BlockRenderType
  soundGroup: SoundGroup
  /** 是否有碰撞箱 */
  hasCollision: boolean
  /** 是否可被活塞推动 */
  canBePushed: boolean
  /** 被破坏时是否掉落自身 */
  dropsSelf: boolean
  /** 是否可燃 */
  flammable: boolean
}

/** 方块语义数据结构（三方共用契约） */
export interface BlockSchema {
  kind: 'block'
  blockType: BlockType
  /** 注册名（全小写下划线），如 ruby_ore */
  id: string
  /** 多语言显示名称 */
  displayName: { en_us: string; zh_cn: string }
  description?: string

  properties: BlockProperties

  /** 方块状态定义（P0 仅语义；directional/toggle 切换时自动播种） */
  blockStates?: BlockStateConfig[]
  /** 方块实体配置（blockType='entity' 时存在；P0 仅语义） */
  blockEntity?: BlockEntityConfig
  /** 右键交互配置（blockType='interactive' 时存在；P0 仅语义） */
  interaction?: InteractionConfig

  texture: BlockTexture
  model: BlockModelConfig
  /**
   * 结构化战利品表（统一编辑器 P2.3）：存在时生成器优先编译它，
   * 不再按 properties.dropsSelf 自动派生；缺省（undefined）保持旧行为。
   */
  lootTable?: import('./loot.schema').LootTableDef
  /** 配方列表（统一编辑器 P3.3）：编译为 data/<ns>/recipes/<id>.json */
  recipes?: import('./recipe.schema').RecipeDef[]
  /** 绑定的 Cube 模型资产 id（.kunyu/content/models/<id>.json），优先于 model 生成 */
  cubeModelId?: string | null
  /**
   * AI 自由代码路径写入的自定义方块类全限定名（如 com.kunyu.mymod.block.CustomFurnaceBlock）。
   * 存在时生成器用 new CustomClass(settings) 替代 new Block(...)；
   * 不存在则按原版 Block 生成。
   */
  customClass?: string | null
  /** 关联 BlockItem 配置（enabled=false 时不注册方块物品） */
  blockItem: {
    enabled: boolean
    /** 物品栏标签，如 minecraft:building_blocks；P0 语义暂存 */
    creativeTab: string
  }

  createdAt: number
  updatedAt: number
}

/* ------------------------------------------------------------------ */
/* 选项清单（表单 + 校验共用）                                          */
/* ------------------------------------------------------------------ */

function buildBlockTypeOptions(locale?: SharedLocale): { value: BlockType; label: string; hint: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'simple', label: t('schema.block.typeSimple'), hint: t('schema.block.typeSimpleHint') },
    { value: 'directional', label: t('schema.block.typeDirectional'), hint: t('schema.block.typeDirectionalHint') },
    { value: 'toggle', label: t('schema.block.typeToggle'), hint: t('schema.block.typeToggleHint') },
    { value: 'interactive', label: t('schema.block.typeInteractive'), hint: t('schema.block.typeInteractiveHint') },
    { value: 'entity', label: t('schema.block.typeEntity'), hint: t('schema.block.typeEntityHint') }
  ]
}

export const BLOCK_TYPE_OPTIONS: { value: BlockType; label: string; hint: string }[] =
  buildBlockTypeOptions()

/** 语言感知版本：组件内 computed(() => getBlockTypeOptions(locale.value)) 使用 */
export function getBlockTypeOptions(locale?: SharedLocale): typeof BLOCK_TYPE_OPTIONS {
  return buildBlockTypeOptions(locale)
}

function buildMiningToolOptions(locale?: SharedLocale): { value: MiningTool; label: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'hand', label: t('schema.block.toolHand') },
    { value: 'pickaxe', label: t('schema.block.toolPickaxe') },
    { value: 'axe', label: t('schema.block.toolAxe') },
    { value: 'shovel', label: t('schema.block.toolShovel') },
    { value: 'hoe', label: t('schema.block.toolHoe') },
    { value: 'sword', label: t('schema.block.toolSword') }
  ]
}

export const MINING_TOOL_OPTIONS: { value: MiningTool; label: string }[] =
  buildMiningToolOptions()

export function getMiningToolOptions(locale?: SharedLocale): typeof MINING_TOOL_OPTIONS {
  return buildMiningToolOptions(locale)
}

function buildMiningLevelOptions(locale?: SharedLocale): { value: MiningLevel; label: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 0, label: t('schema.block.level0') },
    { value: 1, label: t('schema.block.level1') },
    { value: 2, label: t('schema.block.level2') },
    { value: 3, label: t('schema.block.level3') },
    { value: 4, label: t('schema.block.level4') }
  ]
}

export const MINING_LEVEL_OPTIONS: { value: MiningLevel; label: string }[] =
  buildMiningLevelOptions()

export function getMiningLevelOptions(locale?: SharedLocale): typeof MINING_LEVEL_OPTIONS {
  return buildMiningLevelOptions(locale)
}

function buildSoundGroupOptions(locale?: SharedLocale): { value: SoundGroup; label: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'stone', label: t('schema.block.soundStone') },
    { value: 'wood', label: t('schema.block.soundWood') },
    { value: 'gravel', label: t('schema.block.soundGravel') },
    { value: 'metal', label: t('schema.block.soundMetal') },
    { value: 'glass', label: t('schema.block.soundGlass') },
    { value: 'wool', label: t('schema.block.soundWool') }
  ]
}

export const SOUND_GROUP_OPTIONS: { value: SoundGroup; label: string }[] =
  buildSoundGroupOptions()

export function getSoundGroupOptions(locale?: SharedLocale): typeof SOUND_GROUP_OPTIONS {
  return buildSoundGroupOptions(locale)
}

function buildRenderTypeOptions(locale?: SharedLocale): { value: BlockRenderType; label: string; hint: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'solid', label: t('schema.block.renderSolid'), hint: t('schema.block.renderSolidHint') },
    { value: 'cutout', label: t('schema.block.renderCutout'), hint: t('schema.block.renderCutoutHint') },
    { value: 'translucent', label: t('schema.block.renderTranslucent'), hint: t('schema.block.renderTranslucentHint') }
  ]
}

export const RENDER_TYPE_OPTIONS: { value: BlockRenderType; label: string; hint: string }[] =
  buildRenderTypeOptions()

export function getRenderTypeOptions(locale?: SharedLocale): typeof RENDER_TYPE_OPTIONS {
  return buildRenderTypeOptions(locale)
}

function buildBlockModelOptions(locale?: SharedLocale): { value: BlockModelType; label: string; hint: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'cube_all', label: t('schema.block.modelCubeAll'), hint: t('schema.block.modelCubeAllHint') },
    { value: 'cube', label: t('schema.block.modelCube'), hint: t('schema.block.modelCubeHint') },
    { value: 'cross', label: t('schema.block.modelCross'), hint: t('schema.block.modelCrossHint') },
    { value: 'slab', label: t('schema.block.modelSlab'), hint: t('schema.block.modelSlabHint') },
    { value: 'stairs', label: t('schema.block.modelStairs'), hint: t('schema.block.modelStairsHint') },
    { value: 'custom', label: t('schema.block.modelCustom'), hint: t('schema.block.modelCustomHint') }
  ]
}

export const BLOCK_MODEL_OPTIONS: { value: BlockModelType; label: string; hint: string }[] =
  buildBlockModelOptions()

export function getBlockModelOptions(locale?: SharedLocale): typeof BLOCK_MODEL_OPTIONS {
  return buildBlockModelOptions(locale)
}

function buildCollisionOptions(locale?: SharedLocale): { value: CollisionType; label: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'full', label: t('schema.block.collisionFull') },
    { value: 'slab', label: t('schema.block.collisionSlab') },
    { value: 'stairs', label: t('schema.block.collisionStairs') },
    { value: 'none', label: t('schema.block.collisionNone') }
  ]
}

export const COLLISION_OPTIONS: { value: CollisionType; label: string }[] =
  buildCollisionOptions()

export function getCollisionOptions(locale?: SharedLocale): typeof COLLISION_OPTIONS {
  return buildCollisionOptions(locale)
}

function buildRightClickOptions(locale?: SharedLocale): { value: RightClickAction; label: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'none', label: t('schema.block.clickNone') },
    { value: 'gui', label: t('schema.block.clickGui') },
    { value: 'event', label: t('schema.block.clickEvent') },
    { value: 'sound', label: t('schema.block.clickSound') }
  ]
}

export const RIGHT_CLICK_OPTIONS: { value: RightClickAction; label: string }[] =
  buildRightClickOptions()

export function getRightClickOptions(locale?: SharedLocale): typeof RIGHT_CLICK_OPTIONS {
  return buildRightClickOptions(locale)
}

export const INTERACTION_ACTION_OPTIONS = RIGHT_CLICK_OPTIONS

function buildBlockStateTypeOptions(locale?: SharedLocale): { value: 'boolean' | 'enum'; label: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'boolean', label: t('schema.block.stateBoolean') },
    { value: 'enum', label: t('schema.block.stateEnum') }
  ]
}

export const BLOCK_STATE_TYPE_OPTIONS: { value: 'boolean' | 'enum'; label: string }[] =
  buildBlockStateTypeOptions()

export function getBlockStateTypeOptions(locale?: SharedLocale): typeof BLOCK_STATE_TYPE_OPTIONS {
  return buildBlockStateTypeOptions(locale)
}

function buildBlockEntityFieldTypeOptions(locale?: SharedLocale): { value: BlockEntityFieldType; label: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'int', label: t('schema.block.fieldInt') },
    { value: 'float', label: t('schema.block.fieldFloat') },
    { value: 'string', label: t('schema.block.fieldString') },
    { value: 'boolean', label: t('schema.block.fieldBoolean') },
    { value: 'itemstack', label: t('schema.block.fieldItemstack') }
  ]
}

export const BLOCK_ENTITY_FIELD_TYPE_OPTIONS: { value: BlockEntityFieldType; label: string }[] =
  buildBlockEntityFieldTypeOptions()

export function getBlockEntityFieldTypeOptions(locale?: SharedLocale): typeof BLOCK_ENTITY_FIELD_TYPE_OPTIONS {
  return buildBlockEntityFieldTypeOptions(locale)
}

/* ------------------------------------------------------------------ */
/* 旧版预设（迁移期保留，供旧 BlockForm 与旧磁盘数据使用）               */
/* ------------------------------------------------------------------ */

interface PresetMeta {
  label: string
  color: string
  defaults: Partial<{
    hardness: number
    resistance: number
    miningTool: MiningTool
    miningLevel: MiningLevel
    requiresTool: boolean
    luminance: number
    collisionType: CollisionType
    soundGroup: SoundGroup
  }>
}

function buildBlockPresets(locale?: SharedLocale): Record<BlockPresetId, PresetMeta> {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return {
    custom: {
      label: t('schema.block.presetCustom'),
      color: '#7f848e',
      defaults: { hardness: 2, resistance: 2, soundGroup: 'stone' }
    },
    ore: {
      label: t('schema.block.presetOre'),
      color: '#9aa0a8',
      defaults: {
        hardness: 3,
        resistance: 3,
        miningTool: 'pickaxe',
        miningLevel: 1,
        requiresTool: true,
        soundGroup: 'stone'
      }
    },
    log: {
      label: t('schema.block.presetLog'),
      color: '#8a6a3f',
      defaults: {
        hardness: 2,
        resistance: 2,
        miningTool: 'axe',
        miningLevel: 0,
        soundGroup: 'wood'
      }
    },
    planks: {
      label: t('schema.block.presetPlanks'),
      color: '#b08a4f',
      defaults: {
        hardness: 2,
        resistance: 3,
        miningTool: 'axe',
        miningLevel: 0,
        soundGroup: 'wood'
      }
    },
    dirt: {
      label: t('schema.block.presetDirt'),
      color: '#8a5f3c',
      defaults: {
        hardness: 0.5,
        resistance: 0.5,
        miningTool: 'shovel',
        miningLevel: 0,
        soundGroup: 'gravel'
      }
    },
    stone: {
      label: t('schema.block.presetStone'),
      color: '#8f9397',
      defaults: {
        hardness: 1.5,
        resistance: 6,
        miningTool: 'pickaxe',
        miningLevel: 0,
        requiresTool: true,
        soundGroup: 'stone'
      }
    },
    metal: {
      label: t('schema.block.presetMetal'),
      color: '#d8c98a',
      defaults: {
        hardness: 5,
        resistance: 6,
        miningTool: 'pickaxe',
        miningLevel: 2,
        requiresTool: true,
        soundGroup: 'metal'
      }
    },
    glass: {
      label: t('schema.block.presetGlass'),
      color: '#a7d8e8',
      defaults: {
        hardness: 0.3,
        resistance: 0.3,
        collisionType: 'full',
        soundGroup: 'glass'
      }
    },
    machine: {
      label: t('schema.block.presetMachine'),
      color: '#6f7a86',
      defaults: {
        hardness: 3.5,
        resistance: 6,
        miningTool: 'pickaxe',
        miningLevel: 1,
        requiresTool: true,
        soundGroup: 'metal'
      }
    },
    glowing: {
      label: t('schema.block.presetGlowing'),
      color: '#b9e678',
      defaults: {
        hardness: 1.5,
        resistance: 1.5,
        luminance: 12,
        soundGroup: 'stone'
      }
    }
  }
}

export const BLOCK_PRESETS: Record<BlockPresetId, PresetMeta> = buildBlockPresets()

export function getBlockPresets(locale?: SharedLocale): Record<BlockPresetId, PresetMeta> {
  return buildBlockPresets(locale)
}

function buildBlockPresetOptions(
  locale?: SharedLocale
): { value: BlockPresetId; label: string; color: string }[] {
  return Object.entries(buildBlockPresets(locale)).map(([value, meta]) => ({
    value: value as BlockPresetId,
    label: meta.label,
    color: meta.color
  }))
}

export const BLOCK_PRESET_OPTIONS: { value: BlockPresetId; label: string; color: string }[] =
  buildBlockPresetOptions()

export function getBlockPresetOptions(locale?: SharedLocale): typeof BLOCK_PRESET_OPTIONS {
  return buildBlockPresetOptions(locale)
}

/* ------------------------------------------------------------------ */
/* 默认值 / 类型切换                                                    */
/* ------------------------------------------------------------------ */

function nowStamp(): { createdAt: number; updatedAt: number } {
  const now = Date.now()
  return { createdAt: now, updatedAt: now }
}

/** 定向方块默认状态：四朝向 */
export function createFacingState(): BlockStateConfig {
  return {
    name: 'facing',
    type: 'enum',
    values: ['north', 'east', 'south', 'west'],
    defaultValue: 'north'
  }
}

/** 开关方块默认状态：通电/未通电 */
export function createPoweredState(): BlockStateConfig {
  return { name: 'powered', type: 'boolean', values: ['true', 'false'], defaultValue: 'false' }
}

/** 方块类型专属配置（可选三件套） */
export function createBlockTypeConfig(blockType: BlockType): {
  blockStates?: BlockStateConfig[]
  blockEntity?: BlockEntityConfig
  interaction?: InteractionConfig
} {
  switch (blockType) {
    case 'directional':
      return { blockStates: [createFacingState()] }
    case 'toggle':
      return { blockStates: [createPoweredState()] }
    case 'interactive':
      return { interaction: { action: 'gui', eventName: '', soundEvent: '' } }
    case 'entity':
      return {
        blockEntity: {
          tickable: true,
          persistent: true,
          syncToClient: true,
          fields: [],
          dropInventory: false
        }
      }
    default:
      return {}
  }
}

/** 创建默认方块（blockType 可选，默认 simple） */
export function createDefaultBlock(id: string, blockType: BlockType = 'simple'): BlockSchema {
  return {
    kind: 'block',
    blockType,
    id,
    displayName: { en_us: id, zh_cn: id },
    description: '',
    properties: {
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
    },
    ...createBlockTypeConfig(blockType),
    texture: { path: '', generated: true, color: '#7f848e' },
    model: { type: 'cube_all', customJson: null },
    cubeModelId: null,
    blockItem: { enabled: true, creativeTab: '' },
    ...nowStamp()
  }
}

/**
 * 类型切换：保留通用字段（基础信息 / 属性 / 贴图 / 模型 / BlockItem），
 * 清空旧类型专属配置（状态 / 方块实体 / 交互）并填入新类型默认值。
 */
export function applyBlockType(block: BlockSchema, next: BlockType): void {
  if (block.blockType === next) return
  block.blockType = next
  delete block.blockStates
  delete block.blockEntity
  delete block.interaction
  Object.assign(block, createBlockTypeConfig(next))
}

/* ------------------------------------------------------------------ */
/* 旧版扁平 BlockDefinition → BlockSchema 迁移                          */
/* ------------------------------------------------------------------ */

/**
 * 旧版磁盘方块迁移。判定：kind==='block' 但缺 blockType 字段。
 * 语义保留映射：
 * - displayName 字符串 → 双语双填
 * - textureColor/customTexture/modelId → texture.color / texture.path / cubeModelId
 * - collisionType=none → properties.hasCollision=false
 * - collisionType=slab/stairs → model.type 保留语义位
 * - rightClickAction=gui/event/sound → interaction + blockType='interactive'
 * - preset=glass → renderType='translucent' + opaque=false
 * - preset 字段本身不保留（生成时由适配层按 renderType/hasCollision 派生）
 */
export function migrateLegacyBlock(raw: Record<string, unknown>): BlockSchema {
  const id = typeof raw.id === 'string' ? raw.id : 'legacy_block'
  const name = typeof raw.displayName === 'string' ? raw.displayName : id
  const preset = typeof raw.preset === 'string' ? (raw.preset as BlockPresetId) : 'custom'
  const collision: CollisionType =
    raw.collisionType === 'slab' || raw.collisionType === 'stairs' || raw.collisionType === 'none'
      ? raw.collisionType
      : 'full'
  const rightClick: RightClickAction =
    raw.rightClickAction === 'gui' ||
    raw.rightClickAction === 'event' ||
    raw.rightClickAction === 'sound'
      ? raw.rightClickAction
      : 'none'
  const customTexture = typeof raw.customTexture === 'string' ? raw.customTexture : ''
  const linkedModel = typeof raw.modelId === 'string' && raw.modelId ? raw.modelId : null
  const isGlass = preset === 'glass'

  const blockType: BlockType = rightClick === 'none' ? 'simple' : 'interactive'
  const migrated: BlockSchema = {
    kind: 'block',
    blockType,
    id,
    displayName: { en_us: name, zh_cn: name },
    description: typeof raw.description === 'string' ? raw.description : '',
    properties: {
      hardness: typeof raw.hardness === 'number' ? raw.hardness : 2,
      resistance: typeof raw.resistance === 'number' ? raw.resistance : 2,
      requiresTool: raw.requiresTool === true,
      toolType:
        typeof raw.miningTool === 'string' &&
        ['hand', 'pickaxe', 'axe', 'shovel', 'hoe', 'sword'].includes(raw.miningTool)
          ? (raw.miningTool as MiningTool)
          : 'hand',
      miningLevel:
        typeof raw.miningLevel === 'number' && [0, 1, 2, 3, 4].includes(raw.miningLevel)
          ? (raw.miningLevel as MiningLevel)
          : 0,
      lightLevel: typeof raw.luminance === 'number' ? raw.luminance : 0,
      opaque: !isGlass && collision === 'full',
      renderType: isGlass ? 'translucent' : 'solid',
      soundGroup:
        typeof raw.soundGroup === 'string' &&
        ['stone', 'wood', 'gravel', 'metal', 'glass', 'wool'].includes(raw.soundGroup)
          ? (raw.soundGroup as SoundGroup)
          : 'stone',
      hasCollision: collision !== 'none',
      canBePushed: raw.pistonPushable !== false,
      dropsSelf: raw.dropsSelf !== false,
      flammable: false
    },
    ...(rightClick !== 'none'
      ? { interaction: { action: rightClick, eventName: '', soundEvent: '' } }
      : {}),
    texture: {
      path: customTexture,
      generated: !customTexture,
      color:
        typeof raw.textureColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.textureColor)
          ? raw.textureColor
          : BLOCK_PRESETS[preset]?.color ?? '#7f848e'
    },
    model: {
      // 绑定 Cube 模型时保持 cube_all（生成走 linkedModel 直出）；slab/stairs 仅在无绑定模型时保留
      type: linkedModel ? 'cube_all' : collision === 'slab' ? 'slab' : collision === 'stairs' ? 'stairs' : 'cube_all',
      customJson: null
    },
    cubeModelId: linkedModel,
    blockItem: { enabled: true, creativeTab: '' },
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()
  }
  return normalizeBlockSchema(migrated)
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

const STATE_NAME_RE = /^[a-z][a-z0-9_]*$/

function normalizeBlockStates(states: unknown): BlockStateConfig[] | undefined {
  if (!Array.isArray(states)) return undefined
  const list = states
    .slice(0, 4)
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s): BlockStateConfig => {
      const name = typeof s.name === 'string' ? s.name.trim().toLowerCase() : ''
      if (s.type === 'boolean') {
        const rawDefault = String(s.defaultValue ?? 'false')
        return {
          name,
          type: 'boolean',
          values: ['true', 'false'],
          defaultValue: rawDefault === 'true' ? 'true' : 'false'
        }
      }
      const rawValues = Array.isArray(s.values) ? s.values : []
      const values = [...new Set(
        rawValues
          .map((v) => String(v).trim())
          .filter((v) => v.length > 0 && v.length <= 32)
      )].slice(0, 16)
      const safeValues = values.length > 0 ? values : ['']
      const defaultValue = safeValues.includes(String(s.defaultValue ?? ''))
        ? String(s.defaultValue)
        : safeValues[0]
      return { name, type: 'enum', values: safeValues, defaultValue }
    })
    .filter((s) => STATE_NAME_RE.test(s.name))
  // 同名状态去重（保留先出现者）
  const seen = new Set<string>()
  const deduped = list.filter((s) => {
    if (seen.has(s.name)) return false
    seen.add(s.name)
    return true
  })
  return deduped.length > 0 ? deduped : undefined
}

/** 数字或数字字符串 → 有限数字，其余 → NaN（兼容 AI upsert 的字符串数值） */
function numericOf(raw: unknown): number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw)
  return NaN
}

function normalizeFieldDefault(type: BlockEntityFieldType, raw: unknown): string | number | boolean {
  switch (type) {
    case 'int':
      return clampInt(numericOf(raw), -999999, 999999, 0)
    case 'float':
      return Math.round(clampNum(numericOf(raw), -999999, 999999, 0) * 1000) / 1000
    case 'boolean':
      return raw === true
    case 'itemstack':
    case 'string':
    default:
      return typeof raw === 'string' ? raw : raw == null ? '' : String(raw)
  }
}

function normalizeBlockEntity(raw: unknown): BlockEntityConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const fields = (Array.isArray(r.fields) ? r.fields : [])
    .slice(0, 16)
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
    .map((f) => {
      const type: BlockEntityFieldType =
        typeof f.type === 'string' &&
        ['int', 'float', 'string', 'boolean', 'itemstack'].includes(f.type)
          ? (f.type as BlockEntityFieldType)
          : 'string'
      return {
        name: typeof f.name === 'string' ? f.name.trim().toLowerCase() : '',
        type,
        defaultValue: normalizeFieldDefault(type, f.defaultValue),
        sync: f.sync === true
      }
    })
    .filter((f) => STATE_NAME_RE.test(f.name))
  const seen = new Set<string>()
  const dedupedFields = fields.filter((f) => {
    if (seen.has(f.name)) return false
    seen.add(f.name)
    return true
  })
  return {
    tickable: r.tickable === true,
    persistent: r.persistent !== false,
    syncToClient: r.syncToClient === true,
    fields: dedupedFields,
    dropInventory: r.dropInventory === true
  }
}

function normalizeInteraction(raw: unknown): InteractionConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const action: RightClickAction =
    r.action === 'gui' || r.action === 'event' || r.action === 'sound' ? r.action : 'none'
  return {
    action,
    eventName: typeof r.eventName === 'string' ? r.eventName.trim() : '',
    soundEvent: typeof r.soundEvent === 'string' ? r.soundEvent.trim() : ''
  }
}

/** 归一化：字段补全、范围收敛、枚举合法化 */
export function normalizeBlockSchema(b: BlockSchema): BlockSchema {
  const p = b.properties ?? ({} as Partial<BlockProperties>)
  const blockType: BlockType = BLOCK_TYPE_OPTIONS.some((t) => t.value === b.blockType)
    ? b.blockType
    : 'simple'
  const modelType: BlockModelType = BLOCK_MODEL_OPTIONS.some((m) => m.value === b.model?.type)
    ? b.model.type
    : 'cube_all'

  const normalized: BlockSchema = {
    ...b,
    kind: 'block',
    blockType,
    id: (b.id ?? '').trim(),
    displayName: {
      en_us: (b.displayName?.en_us ?? '').trim(),
      zh_cn: (b.displayName?.zh_cn ?? '').trim()
    },
    description: (b.description ?? '').trim(),
    properties: {
      hardness: Math.round(clampNum(p.hardness, 0, 50, 2) * 100) / 100,
      resistance: Math.round(clampNum(p.resistance, 0, 100, 2) * 100) / 100,
      requiresTool: p.requiresTool === true,
      toolType: MINING_TOOL_OPTIONS.some((t) => t.value === p.toolType) ? p.toolType : 'hand',
      miningLevel: clampInt(p.miningLevel, 0, 4, 0) as MiningLevel,
      lightLevel: clampInt(p.lightLevel, 0, 15, 0),
      opaque: p.opaque !== false,
      renderType: RENDER_TYPE_OPTIONS.some((r) => r.value === p.renderType)
        ? p.renderType
        : 'solid',
      soundGroup: SOUND_GROUP_OPTIONS.some((s) => s.value === p.soundGroup)
        ? p.soundGroup
        : 'stone',
      hasCollision: p.hasCollision !== false,
      canBePushed: p.canBePushed !== false,
      dropsSelf: p.dropsSelf !== false,
      flammable: p.flammable === true
    },
    texture: {
      path: (b.texture?.path ?? '').trim(),
      generated: b.texture?.path ? false : b.texture?.generated !== false,
      color: /^#[0-9a-fA-F]{6}$/.test(b.texture?.color ?? '') ? b.texture.color : '#7f848e'
    },
    model: {
      type: modelType,
      customJson:
        modelType === 'custom' &&
        b.model?.customJson &&
        typeof b.model.customJson === 'object' &&
        !Array.isArray(b.model.customJson)
          ? b.model.customJson
          : null
    },
    cubeModelId: b.cubeModelId ? b.cubeModelId : null,
    customClass: typeof b.customClass === 'string' && b.customClass.trim() ? b.customClass.trim() : null,
    blockItem: {
      enabled: b.blockItem?.enabled !== false,
      creativeTab: (b.blockItem?.creativeTab ?? '').trim()
    },
    createdAt: b.createdAt ?? Date.now(),
    updatedAt: b.updatedAt ?? Date.now()
  }

  // 像素画数据透传：仅合法 256 项数组保留
  if (Array.isArray(b.texture?.pixels) && b.texture.pixels.length === 256) {
    normalized.texture.pixels = b.texture.pixels
  }
  // 六面贴图路径清理（仅保留非空字符串）
  if (b.texture?.faces && typeof b.texture.faces === 'object') {
    const faces: Partial<Record<CubeFaceName, string>> = {}
    for (const face of ['north', 'south', 'east', 'west', 'up', 'down'] as CubeFaceName[]) {
      const v = b.texture.faces[face]
      if (typeof v === 'string' && v.trim()) faces[face] = v.trim()
    }
    if (Object.keys(faces).length > 0) normalized.texture.faces = faces
  }

  const states = normalizeBlockStates(b.blockStates)
  if (states) normalized.blockStates = states
  else delete normalized.blockStates

  const blockEntity = normalizeBlockEntity(b.blockEntity)
  if (blockEntity) normalized.blockEntity = blockEntity
  else delete normalized.blockEntity

  const interaction = normalizeInteraction(b.interaction)
  if (interaction && interaction.action !== 'none') normalized.interaction = interaction
  else delete normalized.interaction

  return normalized
}

/** 保存层校验；通过返回 null，否则返回错误消息 */
export function validateBlockSchema(b: BlockSchema): string | null {
  if (!validateContentId(b.id)) {
    return sharedT('schema.common.errRegistryName')
  }
  if (!b.displayName.en_us.trim() && !b.displayName.zh_cn.trim()) {
    return sharedT('schema.common.errDisplayName')
  }
  if (b.blockStates) {
    const names = new Set<string>()
    for (const state of b.blockStates) {
      if (!STATE_NAME_RE.test(state.name)) {
        return sharedT('schema.block.errStateNameInvalid', {
          name: state.name || sharedT('schema.block.stateEmpty')
        })
      }
      if (names.has(state.name)) {
        return sharedT('schema.block.errStateNameDuplicate', { name: state.name })
      }
      names.add(state.name)
      if (state.type === 'boolean') {
        if (state.values.length !== 2 || state.values[0] !== 'true' || state.values[1] !== 'false') {
          return sharedT('schema.block.errBoolValues', { name: state.name })
        }
      } else {
        if (!state.values.length) return sharedT('schema.block.errEnumEmpty', { name: state.name })
        if (new Set(state.values).size !== state.values.length) {
          return sharedT('schema.block.errEnumDuplicate', { name: state.name })
        }
      }
      if (!state.values.includes(state.defaultValue)) {
        return sharedT('schema.block.errDefaultNotInValues', { name: state.name })
      }
    }
  }
  if (b.blockEntity) {
    const fieldNames = new Set<string>()
    for (const field of b.blockEntity.fields) {
      if (!STATE_NAME_RE.test(field.name)) {
        return sharedT('schema.block.errFieldNameInvalid', {
          name: field.name || sharedT('schema.block.stateEmpty')
        })
      }
      if (fieldNames.has(field.name)) {
        return sharedT('schema.block.errFieldNameDuplicate', { name: field.name })
      }
      fieldNames.add(field.name)
    }
  }
  if (b.model.type === 'custom' && !b.model.customJson) {
    return sharedT('schema.block.errCustomModelJson')
  }
  if (b.interaction?.action === 'event' && !b.interaction.eventName.trim()) {
    return sharedT('schema.block.errEventNameRequired')
  }
  if (b.interaction?.action === 'sound' && !b.interaction.soundEvent.trim()) {
    return sharedT('schema.block.errSoundEventRequired')
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 展示辅助                                                             */
/* ------------------------------------------------------------------ */

/** 取指定语言的显示名称，缺省回落到另一语言再回落到 id */
export function blockDisplayName(b: BlockSchema, lang: 'en_us' | 'zh_cn' = 'zh_cn'): string {
  const primary = (b.displayName?.[lang] ?? '').trim()
  const fallback = (b.displayName?.[lang === 'zh_cn' ? 'en_us' : 'zh_cn'] ?? '').trim()
  return primary || fallback || b.id
}
