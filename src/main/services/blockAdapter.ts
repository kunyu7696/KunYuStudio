/**
 * BlockSchema → 生成器扁平方块（GeneratorBlock）适配层。
 *
 * contentGenerator / mojmapCodegen 的内部逻辑深度消费旧版扁平字段
 * （preset / collisionType / luminance / textureColor ...）。语义层升级为 BlockSchema（分区嵌套 + 双语名），生成器侧通过本适配器
 * 还原为旧扁平形状，内部零改动；仅新增 hasBlockItem 控制方块物品注册。
 *
 * 语义映射约定：
 * - translucent/cutout 或 opaque=false → preset='glass'（生成器据此输出 nonOpaque/noOcclusion）
 * - hasCollision=false → collisionType='none'；model.type=slab/stairs 透传（仍单变体）
 * - interaction.action → rightClickAction（仅语义，暂不生成交互代码）
 */
import { blockDisplayName } from '../../shared/schemas/block.schema'
import type {
  BlockPresetId,
  BlockSchema,
  CollisionType,
  MiningLevel,
  MiningTool,
  RightClickAction,
  SoundGroup
} from '../../shared/schemas/block.schema'
import type { LootTableDef } from '../../shared/schemas/loot.schema'

/** 生成器内部使用的扁平方块形状（= 旧 BlockDefinition + hasBlockItem） */
export interface GeneratorBlock {
  kind: 'block'
  id: string
  /** 注释/日志用显示名（优先中文，回落英文） */
  displayName: string
  /** 英文显示名（语言文件 en_us） */
  nameEn: string
  /** 中文显示名（语言文件 zh_cn） */
  nameZh: string
  description: string
  /** 仅作为生成器 nonOpaque 判定的兼容载体：非不透明方块标记为 'glass' */
  preset: BlockPresetId
  textureColor: string
  /** 像素画数据（存在时生成器落像素 PNG 而非纯色）；通常 256 项（16×16） */
  texturePixels?: string[]
  customTexture: string | null
  modelId?: string | null
  /** AI 自由代码路径自定义方块类全限定名；存在时生成器用 new CustomClass(settings) */
  customClass?: string | null
  hardness: number
  resistance: number
  miningTool: MiningTool
  miningLevel: MiningLevel
  luminance: number
  requiresTool: boolean
  dropsSelf: boolean
  pistonPushable: boolean
  collisionType: CollisionType
  rightClickAction: RightClickAction
  soundGroup: SoundGroup
  /** 是否注册 BlockItem 与物品侧资源（blockItem.enabled=false 时全部跳过） */
  hasBlockItem: boolean
  /** 自定义战利品表（存在时生成器优先编译，忽略 dropsSelf 自动产物） */
  lootTable?: LootTableDef
  createdAt: number
  updatedAt: number
}

/** 单个 BlockSchema → GeneratorBlock */
export function toGeneratorBlock(b: BlockSchema): GeneratorBlock {
  const p = b.properties
  const nonOpaque = !p.opaque || p.renderType !== 'solid'
  const collisionType: CollisionType = !p.hasCollision
    ? 'none'
    : b.model.type === 'slab'
      ? 'slab'
      : b.model.type === 'stairs'
        ? 'stairs'
        : 'full'
  return {
    kind: 'block',
    id: b.id,
    displayName: blockDisplayName(b, 'zh_cn'),
    nameEn: blockDisplayName(b, 'en_us'),
    nameZh: blockDisplayName(b, 'zh_cn'),
    description: b.description ?? '',
    preset: nonOpaque ? 'glass' : 'custom',
    textureColor: b.texture.color,
    ...(b.texture.pixels ? { texturePixels: b.texture.pixels } : {}),
    customTexture: b.texture.path || null,
    modelId: b.cubeModelId ?? null,
    customClass: b.customClass ?? null,
    hardness: p.hardness,
    resistance: p.resistance,
    miningTool: p.toolType,
    miningLevel: p.miningLevel,
    luminance: p.lightLevel,
    requiresTool: p.requiresTool,
    dropsSelf: p.dropsSelf,
    pistonPushable: p.canBePushed,
    collisionType,
    rightClickAction: b.interaction?.action ?? 'none',
    soundGroup: p.soundGroup,
    hasBlockItem: b.blockItem.enabled !== false,
    ...(b.lootTable ? { lootTable: b.lootTable } : {}),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt
  }
}

/** 批量适配（保持输入顺序） */
export function toGeneratorBlocks(blocks: BlockSchema[]): GeneratorBlock[] {
  return blocks.map(toGeneratorBlock)
}
