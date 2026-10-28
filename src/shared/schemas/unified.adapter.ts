/**
 * 统一内容对象适配层（UnifiedContent ↔ 现有扁平 schema）。
 *
 * 目标：验证三端分层结构能无损承载现有扁平 schema 的所有字段。
 * 每个方向的转换必须逐字段映射，不丢字段、不丢值。
 *
 * 往返测试：flat → unified → flat 后，用 normalize 后的结果做深比较。
 */
import type { BlockSchema, BlockTexture, BlockModelConfig } from './block.schema'
import type { ItemSchema, ItemTexture, ItemModel } from './item.schema'
import type { EntitySchema, EntityTexture, EntityRenderer } from './entity.schema'
import type {
  UnifiedContent,
  UnifiedJavaSide,
  UnifiedAssetsSide,
  UnifiedTextureRef,
  UnifiedModel,
  UnifiedDataSide
} from './unified.schema'
import type { LootTableDef } from './loot.schema'
import type { RecipeDef } from './recipe.schema'
import type { BiomeDefinition, AdvancementDefinition } from '../types/content'
import { deriveContentClassName } from './unified.schema'

/** 扁平 schema 的战利品表/配方 → unified data 端（缺省项省略，保持空对象最小化） */
function toUnifiedDataSide(
  lootTable: LootTableDef | undefined,
  recipes: RecipeDef[] | undefined
): UnifiedDataSide {
  const data: UnifiedDataSide = {}
  if (lootTable) data.lootTable = lootTable
  if (recipes && recipes.length) data.recipes = recipes
  return data
}

/* ================================================================== */
/* Block                                                                */
/* ================================================================== */

/** BlockTexture → UnifiedTextureRef */
function blockTextureToUnified(t: BlockTexture): UnifiedTextureRef {
  const ref: UnifiedTextureRef = {
    path: t.path,
    generated: t.generated,
    color: t.color
  }
  if (t.pixels) ref.pixels = t.pixels
  if (t.faces) ref.faces = { ...t.faces }
  return ref
}

/** UnifiedTextureRef → BlockTexture */
function unifiedToBlockTexture(ref: UnifiedTextureRef | undefined): BlockTexture {
  return {
    path: ref?.path ?? '',
    generated: ref?.generated ?? !ref?.path,
    color: ref?.color ?? '#7f848e',
    ...(ref?.pixels ? { pixels: ref.pixels } : {}),
    ...(ref?.faces ? { faces: { ...ref.faces } } : {})
  }
}

/** BlockModelConfig → UnifiedModel */
function blockModelToUnified(m: BlockModelConfig): UnifiedModel {
  return {
    type: m.type,
    customJson: m.customJson ?? null,
    ...(m.cubeModel ? { cubeModel: m.cubeModel } : {})
  }
}

/** UnifiedModel → BlockModelConfig */
function unifiedToBlockModel(m: UnifiedModel): BlockModelConfig {
  return {
    type: (m.type === 'item_generated' || m.type === 'entity' ? 'cube_all' : m.type) as BlockModelConfig['type'],
    customJson: m.customJson ?? null,
    ...(m.cubeModel ? { cubeModel: m.cubeModel } : {})
  }
}

/** BlockSchema → UnifiedContent */
export function blockToUnified(block: BlockSchema, namespace = 'mymod'): UnifiedContent {
  const java: UnifiedJavaSide = {
    className: deriveContentClassName(block.id, 'block'),
    packageName: `${namespace}.block`,
    properties: block.properties,
    customLogic: null,
    blockType: block.blockType,
    ...(block.blockStates ? {} : {}),
    ...(block.blockEntity ? { blockEntity: block.blockEntity } : {}),
    ...(block.interaction ? { interaction: block.interaction } : {}),
    cubeModelId: block.cubeModelId ?? null,
    blockItem: block.blockItem
  }

  const textures = blockTextureToUnified(block.texture)
  const assets: UnifiedAssetsSide = {
    textures: { block: [textures] },
    model: blockModelToUnified(block.model),
    ...(block.blockStates ? { blockstate: block.blockStates } : {}),
    lang: {
      [`block.${namespace}.${block.id}`]: block.displayName.en_us,
      ...(block.displayName.zh_cn && block.displayName.zh_cn !== block.displayName.en_us
        ? { [`block.${namespace}.${block.id}.zh_cn`]: block.displayName.zh_cn }
        : {})
    }
  }

  return {
    id: block.id,
    type: 'block',
    displayName: { ...block.displayName },
    description: block.description ?? '',
    java,
    assets,
    data: toUnifiedDataSide(block.lootTable, block.recipes),
    meta: {
      createdAt: block.createdAt,
      updatedAt: block.updatedAt,
      verified: false,
      buildStatus: 'pending'
    }
  }
}

/** UnifiedContent → BlockSchema */
export function unifiedToBlock(u: UnifiedContent): BlockSchema {
  const blockTex = u.assets.textures.block?.[0]
  return {
    kind: 'block',
    blockType: u.java.blockType ?? 'simple',
    id: u.id,
    displayName: { ...u.displayName },
    description: u.description ?? '',
    properties: u.java.properties as BlockSchema['properties'],
    ...(u.assets.blockstate ? { blockStates: u.assets.blockstate } : {}),
    ...(u.java.blockEntity ? { blockEntity: u.java.blockEntity } : {}),
    ...(u.java.interaction ? { interaction: u.java.interaction } : {}),
    texture: unifiedToBlockTexture(blockTex),
    model: unifiedToBlockModel(u.assets.model),
    ...(u.data.lootTable ? { lootTable: u.data.lootTable } : {}),
    ...(u.data.recipes?.length ? { recipes: u.data.recipes } : {}),
    cubeModelId: u.java.cubeModelId ?? null,
    blockItem: u.java.blockItem ?? { enabled: true, creativeTab: '' },
    createdAt: u.meta.createdAt,
    updatedAt: u.meta.updatedAt
  }
}

/* ================================================================== */
/* Item                                                                 */
/* ================================================================== */

/** ItemTexture → UnifiedTextureRef */
function itemTextureToUnified(t: ItemTexture): UnifiedTextureRef {
  const ref: UnifiedTextureRef = {
    path: t.path,
    generated: t.generated,
    color: t.color
  }
  if (t.pixels) ref.pixels = t.pixels
  return ref
}

/** UnifiedTextureRef → ItemTexture */
function unifiedToItemTexture(ref: UnifiedTextureRef | undefined): ItemTexture {
  return {
    path: ref?.path ?? '',
    generated: ref?.generated ?? !ref?.path,
    color: ref?.color ?? '#cbb37a',
    ...(ref?.pixels ? { pixels: ref.pixels } : {})
  }
}

/** ItemModel → UnifiedModel */
function itemModelToUnified(m: ItemModel): UnifiedModel {
  return {
    type: 'item_generated',
    customJson: null,
    parent: m.parent,
    layer0: m.layer0,
    ...(m.cubeModel ? { cubeModel: m.cubeModel } : {})
  }
}

/** UnifiedModel → ItemModel */
function unifiedToItemModel(m: UnifiedModel): ItemModel {
  return {
    parent: m.parent ?? 'item/generated',
    layer0: m.layer0 ?? '',
    ...(m.cubeModel ? { cubeModel: m.cubeModel } : {})
  }
}

/** ItemSchema → UnifiedContent */
export function itemToUnified(item: ItemSchema, namespace = 'mymod'): UnifiedContent {
  const java: UnifiedJavaSide = {
    className: deriveContentClassName(item.id, 'item'),
    packageName: `${namespace}.item`,
    properties: item.properties,
    customLogic: null,
    itemType: item.itemType,
    ...(item.tool ? { tool: item.tool } : {}),
    ...(item.armor ? { armor: item.armor } : {}),
    ...(item.food ? { food: item.food } : {}),
    ...(item.blockRef ? { blockRef: item.blockRef } : {}),
    cubeModelId: item.cubeModelId ?? null
  }

  const assets: UnifiedAssetsSide = {
    textures: { item: itemTextureToUnified(item.texture) },
    model: itemModelToUnified(item.model),
    lang: {
      [`item.${namespace}.${item.id}`]: item.displayName.en_us,
      ...(item.displayName.zh_cn && item.displayName.zh_cn !== item.displayName.en_us
        ? { [`item.${namespace}.${item.id}.zh_cn`]: item.displayName.zh_cn }
        : {})
    }
  }

  return {
    id: item.id,
    type: 'item',
    displayName: { ...item.displayName },
    description: item.description ?? '',
    java,
    assets,
    data: toUnifiedDataSide(item.lootTable, item.recipes),
    meta: {
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      verified: false,
      buildStatus: 'pending'
    }
  }
}

/** UnifiedContent → ItemSchema */
export function unifiedToItem(u: UnifiedContent): ItemSchema {
  return {
    kind: 'item',
    itemType: u.java.itemType ?? 'simple',
    id: u.id,
    displayName: { ...u.displayName },
    description: u.description ?? '',
    properties: u.java.properties as ItemSchema['properties'],
    ...(u.java.tool ? { tool: u.java.tool } : {}),
    ...(u.java.armor ? { armor: u.java.armor } : {}),
    ...(u.java.food ? { food: u.java.food } : {}),
    ...(u.java.blockRef ? { blockRef: u.java.blockRef } : {}),
    texture: unifiedToItemTexture(u.assets.textures.item),
    model: unifiedToItemModel(u.assets.model),
    cubeModelId: u.java.cubeModelId ?? null,
    ...(u.data.lootTable ? { lootTable: u.data.lootTable } : {}),
    ...(u.data.recipes?.length ? { recipes: u.data.recipes } : {}),
    createdAt: u.meta.createdAt,
    updatedAt: u.meta.updatedAt
  }
}

/* ================================================================== */
/* Entity                                                               */
/* ================================================================== */

/** EntityTexture → UnifiedTextureRef */
function entityTextureToUnified(t: EntityTexture): UnifiedTextureRef {
  return { path: t.path }
}

/** UnifiedTextureRef → EntityTexture */
function unifiedToEntityTexture(ref: UnifiedTextureRef | undefined): EntityTexture {
  return { path: ref?.path ?? '' }
}

/** EntityRenderer → UnifiedModel */
function entityRendererToUnified(r: EntityRenderer): UnifiedModel {
  return {
    type: 'entity',
    customJson: null,
    entityModelType: r.modelType,
    modelPath: r.modelPath ?? null,
    animationPath: r.animationPath ?? null,
    ...(r.cubeModel ? { cubeModel: r.cubeModel } : {})
  }
}

/** UnifiedModel → EntityRenderer */
function unifiedToEntityRenderer(m: UnifiedModel): EntityRenderer {
  return {
    modelType: m.entityModelType ?? 'custom',
    modelPath: m.modelPath ?? null,
    animationPath: m.animationPath ?? null,
    ...(m.cubeModel ? { cubeModel: m.cubeModel } : {})
  }
}

/** EntitySchema → UnifiedContent */
export function entityToUnified(entity: EntitySchema, namespace = 'mymod'): UnifiedContent {
  const java: UnifiedJavaSide = {
    className: deriveContentClassName(entity.id, 'entity'),
    packageName: `${namespace}.entity`,
    properties: entity.properties,
    customLogic: null,
    entityType: entity.entityType,
    baseClass: entity.baseClass,
    attributes: entity.attributes,
    ai: entity.ai,
    spawn: entity.spawn,
    spawnEgg: entity.spawnEgg,
    cubeModelId: entity.cubeModelId ?? null
  }

  const assets: UnifiedAssetsSide = {
    textures: { entity: entityTextureToUnified(entity.texture) },
    model: entityRendererToUnified(entity.renderer),
    lang: {
      [`entity.${namespace}.${entity.id}`]: entity.displayName.en_us,
      ...(entity.displayName.zh_cn && entity.displayName.zh_cn !== entity.displayName.en_us
        ? { [`entity.${namespace}.${entity.id}.zh_cn`]: entity.displayName.zh_cn }
        : {})
    }
  }

  return {
    id: entity.id,
    type: 'entity',
    displayName: { ...entity.displayName },
    description: entity.description ?? '',
    java,
    assets,
    data: toUnifiedDataSide(entity.lootTable, entity.recipes),
    meta: {
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      verified: false,
      buildStatus: 'pending'
    }
  }
}

/** UnifiedContent → EntitySchema */
export function unifiedToEntity(u: UnifiedContent): EntitySchema {
  return {
    kind: 'entity',
    entityType: u.java.entityType ?? 'passive',
    baseClass: u.java.baseClass ?? 'PathAwareEntity',
    id: u.id,
    displayName: { ...u.displayName },
    description: u.description ?? '',
    properties: u.java.properties as EntitySchema['properties'],
    attributes: u.java.attributes ?? {
      maxHealth: 20,
      movementSpeed: 0.25,
      attackDamage: 0,
      armor: 0,
      followRange: 16,
      knockbackResistance: 0
    },
    ai: u.java.ai ?? { goals: [], targets: [] },
    spawn: u.java.spawn ?? {
      naturalSpawn: false,
      biomes: [],
      weight: 10,
      minGroupSize: 2,
      maxGroupSize: 4,
      lightLevel: 'any'
    },
    spawnEgg: u.java.spawnEgg ?? { enabled: false, creativeTab: '' },
    texture: unifiedToEntityTexture(u.assets.textures.entity),
    renderer: unifiedToEntityRenderer(u.assets.model),
    ...(u.data.lootTable ? { lootTable: u.data.lootTable } : {}),
    ...(u.data.recipes?.length ? { recipes: u.data.recipes } : {}),
    createdAt: u.meta.createdAt,
    updatedAt: u.meta.updatedAt,
    // 与 normalizeEntitySchema 的键位保持一致（末尾），避免往返序列化仅因键序失败
    cubeModelId: u.java.cubeModelId ?? null
  }
}

/* ================================================================== */
/* Biome / Advancement（M17：纯数据包类型，doc 直搬不做字段级转换）        */
/* ================================================================== */

/** BiomeDefinition → UnifiedContent */
export function biomeToUnified(b: BiomeDefinition): UnifiedContent {
  return {
    id: b.id,
    type: 'biome',
    displayName: { en_us: b.displayName, zh_cn: b.displayName },
    description: b.description ?? '',
    java: { className: '', packageName: '', properties: {} as UnifiedJavaSide['properties'], customLogic: null },
    assets: { textures: {}, model: { type: 'custom', customJson: null }, lang: {} },
    data: { biomeDoc: JSON.parse(JSON.stringify(b.doc ?? {})) as Record<string, unknown> },
    meta: {
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      verified: false,
      buildStatus: 'pending'
    }
  }
}

/** UnifiedContent → BiomeDefinition */
export function unifiedToBiome(u: UnifiedContent): BiomeDefinition {
  return {
    kind: 'biome',
    id: u.id,
    displayName: u.displayName.zh_cn.trim() || u.displayName.en_us.trim() || u.id,
    description: u.description ?? '',
    doc: JSON.parse(JSON.stringify(u.data.biomeDoc ?? {})) as Record<string, unknown>,
    createdAt: u.meta.createdAt,
    updatedAt: u.meta.updatedAt
  }
}

/** AdvancementDefinition → UnifiedContent */
export function advancementToUnified(a: AdvancementDefinition): UnifiedContent {
  return {
    id: a.id,
    type: 'advancement',
    displayName: { en_us: a.displayName, zh_cn: a.displayName },
    description: a.description ?? '',
    java: { className: '', packageName: '', properties: {} as UnifiedJavaSide['properties'], customLogic: null },
    assets: { textures: {}, model: { type: 'custom', customJson: null }, lang: {} },
    data: { advancementDoc: JSON.parse(JSON.stringify(a.doc ?? {})) as Record<string, unknown> },
    meta: {
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      verified: false,
      buildStatus: 'pending'
    }
  }
}

/** UnifiedContent → AdvancementDefinition */
export function unifiedToAdvancement(u: UnifiedContent): AdvancementDefinition {
  return {
    kind: 'advancement',
    id: u.id,
    displayName: u.displayName.zh_cn.trim() || u.displayName.en_us.trim() || u.id,
    description: u.description ?? '',
    doc: JSON.parse(JSON.stringify(u.data.advancementDoc ?? {})) as Record<string, unknown>,
    createdAt: u.meta.createdAt,
    updatedAt: u.meta.updatedAt
  }
}
