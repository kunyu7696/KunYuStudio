/**
 * 可视化编辑器语义资产模型（M4，设计文档 3.4 + 第 9 章"版无关核心"）。
 * 渲染层只读写这些与加载器无关的 JSON 描述（存于项目 .kunyu/content/ 下），
 * 再由主进程的 Fabric 适配层转换为 Java 注册代码与资源文件。
 */
import type { ItemSchema } from '../schemas/item.schema'
import type { EntitySchema } from '../schemas/entity.schema'
import type { ModelTemplate } from '../schemas/model.schema'
import { createTemplateModel } from '../schemas/model.schema'
import type { TextureSchema } from '../schemas/texture.schema'
import type { GameTestSchema } from '../schemas/gametest.schema'
import type { EnchantmentSchema } from '../schemas/enchantment.schema'
import type { TextureAnimation } from '../modeler/types'

/* TextureAnimation 唯一定义在 modeler/types.ts（底层纯数据层），此处转出口径保持调用方兼容 */
export type { TextureAnimation } from '../modeler/types'

export type ContentKind =
  | 'block'
  | 'item'
  | 'model'
  | 'recipe'
  | 'entity'
  | 'texture'
  | 'gametest'
  | 'enchantment'
  | 'biome'
  | 'advancement'

/* ------------------------------------------------------------------ */
/* M17 纯数据包内容类型（biome / advancement）                           */
/* 语义文件即完整数据包 JSON 文档：doc 字段承载落盘产物内容，表单只覆盖   */
/* doc 子集，保存时 merge 回 doc（spawners/features 等复杂字段天然保留） */
/* ------------------------------------------------------------------ */

/** 生物群系语义定义（产物：data/<ns>/worldgen/biome/<id>.json） */
export interface BiomeDefinition {
  kind: 'biome'
  id: string
  displayName: string
  description: string
  /** 完整 worldgen/biome JSON 文档（见 schemas/datapack/biome.schema.ts） */
  doc: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

/** 进度语义定义（产物：data/<ns>/advancements/<id>.json，1.21.1+ 单数目录） */
export interface AdvancementDefinition {
  kind: 'advancement'
  id: string
  displayName: string
  description: string
  /** 完整 advancements JSON 文档（见 schemas/datapack/advancement.schema.ts） */
  doc: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export function createDefaultBiome(id: string): BiomeDefinition {
  const now = Date.now()
  return {
    kind: 'biome',
    id: id || 'new_biome',
    displayName: id || '新生物群系',
    description: '',
    doc: {},
    createdAt: now,
    updatedAt: now
  }
}

export function createDefaultAdvancementContent(id: string): AdvancementDefinition {
  const now = Date.now()
  return {
    kind: 'advancement',
    id: id || 'new_advancement',
    displayName: id || '新进度',
    description: '',
    doc: {},
    createdAt: now,
    updatedAt: now
  }
}

export type {
  EnchantmentSchema,
  EnchantmentRarity,
  EnchantmentItemTarget,
  EnchantmentSlot,
  EnchantmentDamageBonus
} from '../schemas/enchantment.schema'
export {
  createDefaultEnchantment,
  normalizeEnchantmentSchema,
  validateEnchantmentSchema,
  ENCHANTMENT_RARITIES,
  ENCHANTMENT_TARGETS,
  ENCHANTMENT_SLOTS
} from '../schemas/enchantment.schema'

/**
 * 方块语义结构（方块编辑器重做后由 schemas/block.schema.ts 提供）。
 * 旧版扁平 BlockDefinition 已移除；磁盘旧 JSON 由 migrateLegacyBlock 在读取时迁移。
 *
 * 注意：`BlockDefinition` 别名仅为迁移期兼容旧 import，新代码一律使用 BlockSchema。
 * 代码生成器不直接消费 BlockSchema，而由主进程 blockAdapter 适配为 GeneratorBlock。
 */
export type {
  BlockSchema,
  BlockSchema as BlockDefinition,
  BlockType,
  MiningTool,
  MiningLevel,
  CollisionType,
  RightClickAction,
  SoundGroup,
  BlockRenderType,
  BlockModelType,
  BlockPresetId,
  BlockStateConfig,
  BlockEntityConfig,
  BlockEntityField,
  BlockEntityFieldType,
  InteractionConfig,
  BlockProperties,
  BlockTexture,
  BlockModelConfig
} from '../schemas/block.schema'
export {
  createDefaultBlock,
  applyBlockType,
  normalizeBlockSchema,
  validateBlockSchema,
  migrateLegacyBlock,
  blockDisplayName,
  BLOCK_TYPE_OPTIONS,
  BLOCK_PRESETS,
  BLOCK_PRESET_OPTIONS,
  MINING_TOOL_OPTIONS,
  MINING_LEVEL_OPTIONS,
  SOUND_GROUP_OPTIONS,
  RENDER_TYPE_OPTIONS,
  BLOCK_MODEL_OPTIONS,
  COLLISION_OPTIONS,
  RIGHT_CLICK_OPTIONS
} from '../schemas/block.schema'

/** 实体语义结构（实体编辑器 P0：仅语义存取，不参与代码生成） */
export type { EntitySchema } from '../schemas/entity.schema'

/**
 * 材质语义结构（材质编辑器 P0：单层像素画 + PNG 导出；生成器不消费本类型）。
 */
export type { TextureSchema, TextureCategory } from '../schemas/texture.schema'
export {
  createDefaultTexture,
  normalizeTextureSchema,
  validateTextureSchema,
  resizePixels,
  normalizePixel,
  TEXTURE_CATEGORY_OPTIONS,
  TEXTURE_SIZE_OPTIONS,
  TEXTURE_ZOOM_MIN,
  TEXTURE_ZOOM_MAX,
  TEXTURE_ZOOM_DEFAULT
} from '../schemas/texture.schema'
export {
  createDefaultEntity,
  applyEntityType,
  normalizeEntitySchema,
  validateEntitySchema,
  entityDisplayName,
  ENTITY_TYPE_OPTIONS
} from '../schemas/entity.schema'

/**
 * 物品语义结构（物品编辑器重做后由 schemas/item.schema.ts 提供）。
 * 旧版扁平 ItemDefinition 已移除；磁盘旧 JSON 由 migrateLegacyItem 在读取时迁移。
 */
export type { ItemSchema } from '../schemas/item.schema'

/**
 * 特性④ GameTest 语义结构（结构化 Arrange→Act→Assert JSON，gameTestGenerator 转 Java）。
 * 生成器消费本类型产出 Fabric 1.20.1 GameTest 类（使用 fabric:empty_3x3_3 内置模板，无需手编 .nbt）。
 */
export type { GameTestSchema, GameTestStep, GameTestAssertion, GameTestPhase, GameTestActionKind } from '../schemas/gametest.schema'
export {
  createDefaultGameTest,
  normalizeGameTestSchema,
  validateGameTestSchema,
  parseGameTestDoc,
  validateGameTestId,
  GAME_TEST_DEFAULT_SIZE,
  GAME_TEST_DEFAULT_TIMEOUT_TICKS,
  GAME_TEST_TEMPLATE
} from '../schemas/gametest.schema'

/* ------------------------------------------------------------------ */
/* M14 配方（Recipe）——Fabric 三种主要类型的 JSON schema 生成 */
/* ------------------------------------------------------------------ */

/** 配方类型 */
export type RecipeType = 'shaped' | 'shapeless' | 'smelting'

/** 物品槽位：引用 ID（原版 minecraft:xxx 或模组 modid:xxx）+ 可选 count */
export interface RecipeIngredient {
  item: string
  count?: number
}

/** 结果槽位 */
export interface RecipeResult {
  item: string
  count: number
}

/** 单个 RecipeDefinition——语义层；JSON 生成由 buildRecipeJson 完成 */
export interface RecipeDefinition {
  kind: 'recipe'
  id: string
  displayName: string
  description: string
  /** fabric:recipe/shaped | shapeless | smelting */
  recipeType: RecipeType
  /** shared true 写入 data/<modid>/recipes/shared/（多语言/多环境共享），false 直接 recipes/ */
  shared: boolean

  /* -------- shaped -------- */
  /** 3x3 grid 的 3 行，每行 3 字符，'#' 表示该槽占位（对应 key 映射），' ' 表示空 */
  pattern?: [string, string, string]
  /** key 映射：单字符 → 物品引用 */
  key?: Record<string, RecipeIngredient>

  /* -------- shapeless -------- */
  ingredients?: RecipeIngredient[]

  /* -------- smelting -------- */
  /** 熔炉输入物品 */
  input?: string
  /** 熔炉经验奖励 */
  experience?: number
  /** 熔炉烧制时间（ticks，默认 200 = 10 秒） */
  cookingTime?: number

  /* -------- 三种共有 -------- */
  result: RecipeResult
  /** 分组分类（optional） */
  group?: string

  createdAt: number
  updatedAt: number
}

/**
 * 把 RecipeDefinition 转成 Fabric recipe JSON。
 * 只负责字段映射与校验，不处理文件 IO。
 */
export function buildRecipeJson(def: RecipeDefinition, namespace: string): Record<string, unknown> {
  const typePrefix = def.recipeType === 'smelting' ? 'minecraft' : 'fabric:recipe'
  const typeField = `${typePrefix}/${def.recipeType}`
  const base: Record<string, unknown> = {
    type: typeField
  }
  if (def.group) base['group'] = def.group
  if (def.recipeType === 'shaped') {
    base['pattern'] = def.pattern ?? ['   ', '   ', '   ']
    const keyMap: Record<string, { item: string }> = {}
    for (const [k, v] of Object.entries(def.key ?? {})) {
      keyMap[k] = { item: v.item.startsWith(':') ? namespace + v.item : v.item }
    }
    base['key'] = keyMap
    base['result'] = def.result.item.startsWith(':')
      ? { item: namespace + def.result.item, count: def.result.count }
      : { item: def.result.item, count: def.result.count }
  } else if (def.recipeType === 'shapeless') {
    base['ingredients'] = (def.ingredients ?? []).map((ing) => ({
      item: ing.item.startsWith(':') ? namespace + ing.item : ing.item
    }))
    base['result'] = def.result.item.startsWith(':')
      ? { item: namespace + def.result.item, count: def.result.count }
      : { item: def.result.item, count: def.result.count }
  } else {
    // smelting
    base['ingredient'] = {
      item: (def.input ?? '').startsWith(':') ? namespace + (def.input ?? '') : (def.input ?? '')
    }
    base['result'] = def.result.item.startsWith(':')
      ? namespace + def.result.item
      : def.result.item
    base['experience'] = def.experience ?? 0
    base['cookingtime'] = def.cookingTime ?? 200
  }
  return base
}

/* ------------------------------------------------------------------ */
/* M12 Cube 模型资产（结构对齐 Minecraft 原版模型 JSON，导出只做字段映射） */
/* ------------------------------------------------------------------ */

/** 立方体六个面（原版命名） */
export type CubeFaceName = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'

/** 旋转轴 */
export type RotationAxis = 'x' | 'y' | 'z'

/** 面级 UV：[u1,v1,u2,v2] 贴图像素坐标 */
export type FaceUv = [number, number, number, number]

/** 单个面的贴图绑定（faces 中缺键 = 该面剔除不渲染） */
export interface CubeFace {
  uv: FaceUv
  /** 贴图变量名（不含 # 前缀），对应 ModelAsset.textures 的键，如 'all' */
  texture: string
  /** 面内贴图旋转（90° 倍数） */
  rotation?: 0 | 90 | 180 | 270
}

/** 立方体旋转：单轴、22.5° 倍数、±45° 内（原版限制） */
export interface CubeRotation {
  origin: [number, number, number]
  axis: RotationAxis
  angle: number
  rescale?: boolean
}

/** Cube 立方体元素 */
export interface CubeElement {
  name: string
  /** 起点坐标（0..16），各轴 ≤ to */
  from: [number, number, number]
  /** 终点坐标（0..16） */
  to: [number, number, number]
  rotation?: CubeRotation
  /** 是否接受环境光遮蔽明暗（原版 shade） */
  shade?: boolean
  faces: Partial<Record<CubeFaceName, CubeFace>>
}

/** 原版 display 槽位变换 */
export interface ModelDisplayTransform {
  rotation?: [number, number, number]
  translation?: [number, number, number]
  scale?: [number, number, number]
}

/**
 * 嵌入式 Cube 模型（统一编辑器）。
 * 与 ModelAsset 的区别：随内容对象 JSON 一起保存，不是独立模型资产；
 * 保存到项目时可导出为独立 ModelAsset 并通过 cubeModelId 绑定。
 */
export interface EmbeddedCubeModel {
  /** 正方形贴图画布边长（16/32） */
  textureSize: 16 | 32
  /** 行优先像素，长度 textureSize²；'' = 透明 */
  pixels: string[]
  /** Cube 立方体元素 */
  elements: CubeElement[]
  /** 原版 display 槽位变换（武器放大等；物品内嵌时与手持 parent 叠加生效） */
  display?: {
    gui?: ModelDisplayTransform
    ground?: ModelDisplayTransform
    fixed?: ModelDisplayTransform
    thirdperson_righthand?: ModelDisplayTransform
    thirdperson_lefthand?: ModelDisplayTransform
    firstperson_righthand?: ModelDisplayTransform
    firstperson_lefthand?: ModelDisplayTransform
    head?: ModelDisplayTransform
  }
}

/**
 * Cube 模型语义资产（M12）。
 * pixels 为行优先像素值（每行 textureSize 个），'' 表示透明，#rrggbb 不透明，#rrggbbaa 带透明度。
 */
export interface ModelAsset {
  kind: 'model'
  id: string
  displayName: string
  description: string
  /** 正方形贴图画布边长（MVP 仅 16/32；flipbook 帧条时为帧边长） */
  textureSize: 16 | 32
  /** 行优先像素，长度 textureSize²；'' = 透明。B2-1：textureAnimation 存在时可为竖直帧条（长度 = textureSize² × 帧数） */
  pixels: string[]
  /** 贴图变量 → assets 相对路径（textures/model/<id>.png）；MVP 仅 all 一张 */
  textures: Record<string, string>
  /** 主贴图动画元数据（存在 → 生成器按帧条落盘 PNG 并旁写同名 .png.mcmeta） */
  textureAnimation?: TextureAnimation
  elements: CubeElement[]
  ambientOcclusion?: boolean
  /** 原版 display 槽位变换（武器常用 thirdperson/firstperson 放大撑出大武器感） */
  display?: {
    gui?: ModelDisplayTransform
    ground?: ModelDisplayTransform
    fixed?: ModelDisplayTransform
    thirdperson_righthand?: ModelDisplayTransform
    thirdperson_lefthand?: ModelDisplayTransform
    firstperson_righthand?: ModelDisplayTransform
    firstperson_lefthand?: ModelDisplayTransform
    head?: ModelDisplayTransform
  }
  /** 建模器模板标记（model.schema.ts；缺省时由 inferTemplate 推断） */
  template?: ModelTemplate
  createdAt: number
  updatedAt: number
}

export type ContentDefinition =
  | import('../schemas/block.schema').BlockSchema
  | ItemSchema
  | ModelAsset
  | RecipeDefinition
  | EntitySchema
  | TextureSchema
  | GameTestSchema
  | EnchantmentSchema
  | BiomeDefinition
  | AdvancementDefinition

/** 列表项摘要 */
export interface ContentSummary {
  kind: ContentKind
  id: string
  displayName: string
  /** 语义文件绝对路径 */
  path: string
  updatedAt: number
  /** P1-1：本次保存是否覆盖了既有语义资产（true=旧内容已备份至 .bak） */
  overwritten?: boolean
}

/** 内容资源体检单条问题（content:doctor） */
export interface ContentDoctorIssue {
  level: 'error' | 'warn'
  /** corrupt_json / missing_texture / dangling_model / unknown_recipe_ref */
  kind: string
  id: string
  message: string
}

/** 内容资源体检报告（只读检查，不生成/修改任何文件） */
export interface ContentDoctorReport {
  ok: boolean
  issues: ContentDoctorIssue[]
  /** 成功加载的语义对象总数 */
  objectCount: number
  errorCount: number
  warningCount: number
  /** ok=false 时的总体失败原因（如不是模组工程） */
  error?: string
}

/** 生成器写入的单个文件结果 */
export interface GeneratedFile {
  /** 相对项目根的路径 */
  path: string
  /** 写入动作：新建 / 覆盖 / 删除 */
  action: 'write' | 'delete'
}

export interface GenerateResult {
  /** 本次写入/清理的文件清单 */
  files: GeneratedFile[]
  /** 方块注册名 */
  blockIds: string[]
  /** 物品注册名 */
  itemIds: string[]
  /**
   * 漂移文件（相对根路径）：磁盘内容与工具上次生成不一致，
   * 本轮按"跳过"策略未覆盖。用户可在冲突对话框选择覆盖。
   */
  diverged: string[]
  /** 实际入口包与 maven_group 不一致时给出两包名，UI 提示修复 */
  packageDivergence?: { packageName: string; mavenGroup: string } | null
}

/** 单个计划写入/删除文件的预检结果（M12 漂移检测） */
export interface PlannedFile {
  /** 相对项目根路径 */
  path: string
  action: 'write' | 'delete'
  /** 磁盘上当前是否存在 */
  exists: boolean
  /** 是否检测到用户手动改动（磁盘 sha1 ≠ 工具上次产物 sha1） */
  drifted: boolean
  /** 默认策略下本轮是否真正落盘（漂移文件默认跳过 = false） */
  willWrite: boolean
}

export interface GenerationPlan {
  /** 需要用户决策（已漂移且存在）的文件 */
  conflicts: PlannedFile[]
  /** 全部写入计划（含将被跳过的漂移文件） */
  writes: PlannedFile[]
  /** 计划删除（旧产物） */
  deletes: PlannedFile[]
  /** 截止上轮已记录的漂移文件（含本轮仍未解决者） */
  diverged: string[]
}

/** 生成选项：overwritePaths 列出用户明确选择覆盖的漂移文件（相对路径） */
export interface GenerateOptions {
  overwritePaths?: string[]
}

/** 注册名规则：小写字母开头，仅小写字母/数字/下划线 */
const CONTENT_ID_RE = /^[a-z][a-z0-9_]*$/

export function validateContentId(id: string): boolean {
  return CONTENT_ID_RE.test(id) && id.length <= 64
}

/* ------------------------------------------------------------------ */
/* M12 Cube 模型工厂与常量                                              */
/* ------------------------------------------------------------------ */

/** 六面规范顺序（UI 面板/遍历使用） */
export const CUBE_FACES: CubeFaceName[] = ['north', 'south', 'east', 'west', 'up', 'down']

/** 面的中文标签 */
export const CUBE_FACE_LABELS: Record<CubeFaceName, string> = {
  north: '北',
  south: '南',
  east: '东',
  west: '西',
  up: '上',
  down: '下'
}

/** 旋转角允许值（22.5° 倍数，±45°） */
export const CUBE_ROTATION_ANGLES: number[] = [-45, -22.5, 0, 22.5, 45]

/** 构造一个占满 16³ 的默认立方体，六面绑定 all 变量且 UV 覆盖整张贴图 */
export function createDefaultCube(name: string): CubeElement {
  const faces = {} as Record<CubeFaceName, CubeFace>
  for (const face of CUBE_FACES) {
    faces[face] = { uv: [0, 0, 16, 16], texture: 'all' }
  }
  return {
    name,
    from: [0, 0, 0],
    to: [16, 16, 16],
    shade: true,
    faces
  }
}

/** 新建模型的默认 display.gui（等轴展示视角，对齐原版 block/gui 惯例） */
export function defaultGuiDisplay(): ModelDisplayTransform {
  return {
    rotation: [30, 225, 0],
    translation: [0, 0, 0],
    scale: [0.625, 0.625, 0.625]
  }
}

/** 新建模型默认采用 cube_all 模板（与建模器模板系统同源） */
export function createDefaultModel(id: string): ModelAsset {
  return createTemplateModel(id, 'cube_all')
}

/** 创建一个空的新配方（默认 shaped 合成铁镐） */
export function createDefaultRecipe(id: string): RecipeDefinition {
  const now = Date.now()
  return {
    kind: 'recipe',
    id: id || 'new_recipe',
    displayName: id || '新配方',
    description: '',
    recipeType: 'shaped',
    shared: true,
    pattern: ['   ', '   ', '   '],
    key: {},
    ingredients: [],
    input: '',
    experience: 0,
    cookingTime: 200,
    result: { item: ':ruby_pickaxe', count: 1 },
    createdAt: now,
    updatedAt: now
  }
}

/** hex(#rrggbb) → rgb 三元组；非法输入回退灰色 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return { r: 128, g: 128, b: 128 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
