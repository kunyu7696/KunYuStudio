/**
 * 可视化编辑器语义资产服务。
 * 语义 JSON 存于 <project>/.kunyu/content/{blocks,items}/<id>.json，
 * 与加载器无关；由 contentGenerator 转换为 Fabric 产物。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ContentDefinition,
  ContentKind,
  ContentSummary,
  EnchantmentSchema,
  GenerateOptions,
  GenerationPlan,
  GenerateResult,
  ItemSchema,
  RecipeDefinition
} from '../../shared/types/content'
import { validateContentId } from '../../shared/types/content'
import type { BlockSchema } from '../../shared/schemas/block.schema'
import {
  createDefaultBlock,
  migrateLegacyBlock,
  normalizeBlockSchema,
  validateBlockSchema
} from '../../shared/schemas/block.schema'
import type { EntitySchema } from '../../shared/schemas/entity.schema'
import {
  normalizeEntitySchema,
  validateEntitySchema
} from '../../shared/schemas/entity.schema'
import {
  normalizeModelSchema,
  validateModelSchema
} from '../../shared/schemas/model.schema'
import type { TextureSchema } from '../../shared/schemas/texture.schema'
import {
  normalizeTextureSchema,
  validateTextureSchema
} from '../../shared/schemas/texture.schema'
import {
  contentDisplayName,
  createDefaultItem,
  migrateLegacyItem,
  normalizeItemSchema,
  validateItemSchema
} from '../../shared/schemas/item.schema'
import {
  normalizeEnchantmentSchema,
  validateEnchantmentSchema
} from '../../shared/schemas/enchantment.schema'
import {
  normalizeBiomeDoc,
  validateBiomeDoc
} from '../../shared/schemas/datapack/biome.schema'
import {
  normalizeAdvancementDoc,
  validateAdvancementDoc
} from '../../shared/schemas/datapack/advancement.schema'
import type { BiomeDefinition, AdvancementDefinition } from '../../shared/types/content'
import {
  PACK_FORMATS,
  dataPackEntryPath,
  type McVersion
} from '../../shared/schemas/datapack.schema'
import { readDataPackMeta } from './datapackService'
import { assertWithinRoot, writeBinaryFile, writeFile } from './fsService'
import { generateContent, planGeneration, protectForeignPlannedFiles, readModBlocksJava, resolveModContext } from './contentGenerator'
import { parseBlockJava } from '../../shared/schemas/javaReverse'
import { pixelsToPng, pixelsToPngRect } from './modelCompiler'

/** .kunyu/content/ 下各类型目录名 */
const CONTENT_DIRS: Record<ContentKind, string> = {
  block: 'blocks',
  entity: 'entities',
  model: 'models',
  recipe: 'recipes',
  texture: 'textures',
  enchantment: 'enchantments',
  biome: 'biomes',
  advancement: 'advancements',
  item: 'items',
  gametest: 'gametest'
}

function contentDir(root: string, kind: ContentKind): string {
  return join(root, '.kunyu', 'content', CONTENT_DIRS[kind])
}

function contentFile(root: string, kind: ContentKind, id: string): string {
  return join(contentDir(root, kind), `${id}.json`)
}

/** 计划用词（含复数/别名）→ 语义资产 kind 的归一化映射。
 *  gui/mixin/command 等以 .java 直写、无独立语义目录，不在此表（完整性核对跳过，不误报）。 */
const PLAN_TYPE_TO_KIND: Record<string, ContentKind> = {
  block: 'block', blocks: 'block',
  item: 'item', items: 'item',
  recipe: 'recipe', recipes: 'recipe',
  entity: 'entity', entities: 'entity',
  enchantment: 'enchantment', enchantments: 'enchantment',
  biome: 'biome', biomes: 'biome',
  advancement: 'advancement', advancements: 'advancement'
}

/** 数据驱动类型 → 数据包产物目录段（含版本变体）。
 *  1.20.x 用复数目录名，1.21+ 用与注册表同名的单数目录名；
 *  biome 固定在 worldgen/biome 子树。两个版本名都检查以兼容未知 mcVersion。 */
const DATA_PACK_DIRS: Partial<Record<ContentKind, string[]>> = {
  recipe: ['recipes', 'recipe'],
  advancement: ['advancements', 'advancement'],
  biome: ['worldgen/biome'],
  enchantment: ['enchantments', 'enchantment']
}

/** 递归检查目录下是否存在至少一个 .json 文件 */
function hasJsonFileRecursive(dir: string): boolean {
  if (!existsSync(dir)) return false
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (hasJsonFileRecursive(full)) return true
    } else if (e.isFile() && e.name.endsWith('.json')) {
      return true
    }
  }
  return false
}

/** 某语义类型是否已在项目中落盘：
 *  ① 语义资产目录（.kunyu/content/<dir>/）存在且含 ≥1 个 JSON（generated.json 占位不算）；
 *  ② 或数据包产物目录（src/main/resources/data/<ns>/<type>/）含 JSON（版本感知双目录名）。
 *  F4-02：模型用 write_project_file 写数据包产物时也应被完整性门认可。 */
function kindContentPresent(root: string, kind: ContentKind): boolean {
  const semanticDir = join(root, '.kunyu', 'content', CONTENT_DIRS[kind])
  if (existsSync(semanticDir)) {
    try {
      if (readdirSync(semanticDir).some((f) => f.endsWith('.json') && f !== 'generated.json')) return true
    } catch {
      /* 读失败忽略 */
    }
  }
  const typeDirs = DATA_PACK_DIRS[kind]
  if (typeDirs) {
    const dataRoot = join(root, 'src', 'main', 'resources', 'data')
    if (existsSync(dataRoot)) {
      let namespaces: string[]
      try {
        namespaces = readdirSync(dataRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
      } catch {
        namespaces = []
      }
      for (const ns of namespaces) {
        for (const sub of typeDirs) {
          if (hasJsonFileRecursive(join(dataRoot, ns, sub))) return true
        }
      }
    }
  }
  return false
}

/**
 * 完整性核对：给定计划承诺的 contentTypes，
 * 返回项目中实际缺失的、可检测的类型（去重，返回规范 kind 名）。
 * 无独立语义目录的类型（gui）跳过（由 orchestrator 的 java 启发式检查兜底）。
 */
export function findMissingContentTypes(root: string, planned: string[]): string[] {
  const missing: string[] = []
  const checked = new Set<ContentKind>()
  for (const raw of planned) {
    const kind = PLAN_TYPE_TO_KIND[String(raw).toLowerCase().trim()]
    if (!kind || checked.has(kind)) continue
    checked.add(kind)
    if (!kindContentPresent(root, kind)) missing.push(kind)
  }
  return missing
}

// ---------------------------------------------------------------------------
// A-04：understand 可承诺但无独立语义资产的类型的轻量检测器。
// 约定/标记（不靠类型解析，避免误报）：
//  - tag:      src/main/resources/data/<ns>/tags/** 下有 JSON
//  - worldgen: src/main/resources/data/<ns>/worldgen/** 下有 JSON
//  - mixin:    资源根存在 mixin 配置（*.mixins.json / mixins.json），
//              或 src/main/java 下有 .java 含 @Mixin 注解
//  - command:  src/main/java 下有 .java 含各加载器命令注册标记
// ---------------------------------------------------------------------------

/** 递归收集目录下符合谓词的文件（浅层优先，命中即止，项目规模小可接受） */
function walkFiles(dir: string, pred: (abs: string, name: string) => boolean): boolean {
  if (!existsSync(dir)) return false
  let entries: import('node:fs').Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const e of entries) {
    const abs = join(dir, e.name)
    if (e.isDirectory()) {
      if (walkFiles(abs, pred)) return true
    } else if (e.isFile() && pred(abs, e.name)) {
      return true
    }
  }
  return false
}

/** 任意命名空间下的 data 子目录是否含 JSON（tag→tags/，worldgen→worldgen/） */
function hasDataSubdirJson(root: string, subdir: string): boolean {
  const dataRoot = join(root, 'src', 'main', 'resources', 'data')
  if (!existsSync(dataRoot)) return false
  let namespaces: string[]
  try {
    namespaces = readdirSync(dataRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return false
  }
  return namespaces.some((ns) => hasJsonFileRecursive(join(dataRoot, ns, subdir)))
}

/** mixin 配置（Fabric/Forge/NeoForge 约定：<modid>.mixins.json / mixins.json 等，置于资源根） */
function hasMixinArtifact(root: string): boolean {
  const resourcesRoot = join(root, 'src', 'main', 'resources')
  const configHit = walkFiles(
    resourcesRoot,
    (_abs, name) => /\.mixins?\.json$/i.test(name) || /^mixins\..*\.json$/i.test(name)
  )
  if (configHit) return true
  // 直接写的 Mixin 类（无配置的中间轮也认）
  const javaRoot = join(root, 'src', 'main', 'java')
  return walkFiles(javaRoot, (abs, name) => {
    if (!name.endsWith('.java')) return false
    try {
      return /@Mixin\s*\(/.test(readFileSync(abs, 'utf8'))
    } catch {
      return false
    }
  })
}

/** 命令注册：Fabric CommandRegistrationCallback / Forge·NeoForge RegisterCommandsEvent / 原生 Brigadier */
function hasCommandRegistration(root: string): boolean {
  const javaRoot = join(root, 'src', 'main', 'java')
  return walkFiles(javaRoot, (abs, name) => {
    if (!name.endsWith('.java')) return false
    try {
      const text = readFileSync(abs, 'utf8')
      return (
        text.includes('CommandRegistrationCallback') ||
        text.includes('RegisterCommandsEvent') ||
        /Commands\.literal\s*\(/.test(text) ||
        /dispatcher\.register\s*\(/.test(text)
      )
    } catch {
      return false
    }
  })
}

const EXTRA_CONTENT_DETECTORS: Record<string, (root: string) => boolean> = {
  tag: (root) => hasDataSubdirJson(root, 'tags'),
  worldgen: (root) => hasDataSubdirJson(root, 'worldgen'),
  mixin: hasMixinArtifact,
  command: hasCommandRegistration
}

/**
 * A-04：检测 tag/worldgen/mixin/command 等"无独立语义资产"承诺类型的缺口。
 * 返回缺失的规范类型名（去重，忽略未知类型）。
 */
export function findExtraMissingContentTypes(root: string, planned: string[]): string[] {
  const missing: string[] = []
  const seen = new Set<string>()
  for (const raw of planned) {
    const kind = String(raw).toLowerCase().trim()
    const detect = EXTRA_CONTENT_DETECTORS[kind]
    if (!detect || seen.has(kind)) continue
    seen.add(kind)
    if (!detect(root)) missing.push(kind)
  }
  return missing
}

function parseJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')) as T
}

/** 列出项目中的全部方块/物品摘要 */
export function listContent(root: string): ContentSummary[] {
  assertWithinRoot(root)
  const result: ContentSummary[] = []
  for (const kind of ['block', 'entity', 'item', 'model', 'recipe', 'texture', 'enchantment', 'biome', 'advancement'] as const) {
    const dir = contentDir(root, kind)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json') || name === 'generated.json') continue
      const abs = join(dir, name)
      try {
        const parsed = parseJsonFile<ContentDefinition>(abs)
        if (parsed.kind !== kind || typeof parsed.id !== 'string') continue
        // 旧版扁平方块 JSON 列表场景同样走迁移，摘要名取双语回落链
        const migrated =
          kind === 'block' && !('blockType' in parsed)
            ? migrateLegacyBlock(parsed as unknown as Record<string, unknown>)
            : parsed
        result.push({
          kind,
          id: migrated.id,
          // 方块/实体/物品 displayName 为多语言对象，取中文→英文→id 回落链
          displayName: contentDisplayName(migrated),
          path: abs,
          updatedAt: migrated.updatedAt ?? statSync(abs).mtimeMs
        })
      } catch {
        // 跳过损坏的语义文件
      }
    }
  }
  return result.sort((a, b) => a.id.localeCompare(b.id))
}

/** 读取单个语义对象（旧版扁平物品 JSON 在此自动迁移为 ItemSchema） */
export function loadContent(root: string, kind: ContentKind, id: string): ContentDefinition {
  assertWithinRoot(root)
  const p = contentFile(root, kind, id)
  if (!existsSync(p)) throw new Error(`对象不存在: ${id}`)
  const def = parseJsonFile<ContentDefinition>(p)
  if (def.kind !== kind) throw new Error(`对象类型不匹配: ${id}`)
  if (kind === 'item' && !('itemType' in def)) {
    return migrateLegacyItem(def as unknown as Record<string, unknown>)
  }
  // 旧版扁平方块 JSON（无 blockType 判别字段）读取时一次性迁移
  if (kind === 'block' && !('blockType' in def)) {
    return migrateLegacyBlock(def as unknown as Record<string, unknown>)
  }
  return def
}

function validate(def: ContentDefinition, root: string, selfPath: string): void {
  if (!validateContentId(def.id)) {
    throw new Error('注册名不合法：小写字母开头，仅含小写字母、数字、下划线，最长 64 字符')
  }
  if (def.kind === 'block') {
    const blockErr = validateBlockSchema(def as BlockSchema)
    if (blockErr) throw new Error(blockErr)
  } else if (def.kind === 'entity') {
    const entityErr = validateEntitySchema(def as EntitySchema)
    if (entityErr) throw new Error(entityErr)
  } else if (def.kind === 'item') {
    const itemErr = validateItemSchema(def as ItemSchema)
    if (itemErr) throw new Error(itemErr)
  } else if (def.kind === 'model') {
    const modelErr = validateModelSchema(def)
    if (modelErr) throw new Error(modelErr)
  } else if (def.kind === 'texture') {
    const texErr = validateTextureSchema(def as TextureSchema)
    if (texErr) throw new Error(texErr)
  } else if (def.kind === 'enchantment') {
    const enchErr = validateEnchantmentSchema(def as EnchantmentSchema)
    if (enchErr) throw new Error(enchErr)
  } else if (def.kind === 'biome') {
    const biomeErr = validateBiomeDoc((def as BiomeDefinition).doc)
    if (biomeErr) throw new Error(biomeErr)
    if (!(def.displayName || '').trim()) throw new Error('显示名称不能为空')
  } else if (def.kind === 'advancement') {
    const advErr = validateAdvancementDoc((def as AdvancementDefinition).doc)
    if (advErr) throw new Error(advErr)
    if (!(def.displayName || '').trim()) throw new Error('显示名称不能为空')
  } else if (!(def.displayName || '').trim()) {
    throw new Error('显示名称不能为空')
  }
  // 同类型 ID 唯一（排除自身文件）
  const dir = contentDir(root, def.kind)
  if (existsSync(dir)) {
    const clash = readdirSync(dir).find((f) => {
      const abs = join(dir, f)
      return abs !== selfPath && f === `${def.id}.json`
    })
    if (clash) throw new Error(`注册名已存在: ${def.id}`)
  }
  if (def.kind === 'recipe') {
    const r = def as RecipeDefinition
    if (r.recipeType !== 'shaped' && r.recipeType !== 'shapeless' && r.recipeType !== 'smelting') {
      throw new Error('配方类型不合法：仅支持 shaped / shapeless / smelting')
    }
    if (!r.result || !r.result.item || typeof r.result.item !== 'string') {
      throw new Error('配方结果物品不能为空')
    }
    if (r.result.count < 1 || r.result.count > 64) {
      throw new Error('配方结果数量必须在 1-64 之间')
    }
    if (r.recipeType === 'shaped') {
      if (!Array.isArray(r.pattern) || r.pattern.length !== 3 || r.pattern.some((row) => typeof row !== 'string' || row.length !== 3)) {
        throw new Error('shaped 配方的 pattern 必须是 3 行 3 字符')
      }
      if (!r.key || typeof r.key !== 'object') {
        throw new Error('shaped 配方的 key 映射缺失')
      }
    } else if (r.recipeType === 'shapeless') {
      if (!Array.isArray(r.ingredients) || r.ingredients.length === 0) {
        throw new Error('shapeless 配方的 ingredients 不能为空')
      }
      if (r.ingredients.length > 9) {
        throw new Error('shapeless 配方的 ingredients 最多 9 项')
      }
    } else {
      // smelting
      if (!r.input || typeof r.input !== 'string' || !r.input.trim()) {
        throw new Error('smelting 配方的输入物品不能为空')
      }
      if (typeof r.experience !== 'number' || r.experience < 0 || r.experience > 1) {
        throw new Error('smelting 配方的经验奖励必须在 0-1 之间')
      }
      if (typeof r.cookingTime !== 'number' || r.cookingTime < 1 || r.cookingTime > 32000) {
        throw new Error('smelting 配方的烧制时间必须在 1-32000 ticks 之间')
      }
    }
  }
}

/**
 * 保存语义对象（新建或覆盖）。
 * @param prevId 重命名前的旧 ID，用于删除旧语义文件；新建时省略
 */
export function saveContent(
  root: string,
  def: ContentDefinition,
  prevId?: string
): ContentSummary {
  assertWithinRoot(root)
  const target = contentFile(root, def.kind, def.id)
  validate(def, root, target)

  // 覆盖保护——同 id 语义资产已存在时，备份旧内容到 .bak
  const overwritten = existsSync(target)
  if (overwritten) {
    const bakPath = target + '.bak'
    try {
      const oldContent = readFileSync(target, 'utf8')
      writeFile(bakPath, oldContent)
    } catch {
      /* 备份失败不阻塞写入 */
    }
  }

  const normalized: ContentDefinition =
    def.kind === 'block'
      ? normalizeBlockSchema(def as BlockSchema)
      : def.kind === 'entity'
        ? normalizeEntitySchema(def as EntitySchema)
        : def.kind === 'model'
          ? normalizeModelSchema(def)
          : def.kind === 'recipe'
            ? normalizeRecipe(def as RecipeDefinition)
            : def.kind === 'texture'
              ? normalizeTextureSchema(def as TextureSchema)
              : def.kind === 'enchantment'
                ? normalizeEnchantmentSchema(def as EnchantmentSchema)
                : def.kind === 'biome'
                  ? normalizeBiome(def as BiomeDefinition)
                  : def.kind === 'advancement'
                    ? normalizeAdvancement(def as AdvancementDefinition)
                    : normalizeItemSchema(def as ItemSchema)
  normalized.updatedAt = Date.now()

  writeFile(target, JSON.stringify(normalized, null, 2) + '\n')

  // biome/advancement 双写产物到数据包目录（语义文件是 source of truth，保存即覆盖产物）
  if (normalized.kind === 'biome' || normalized.kind === 'advancement') {
    writeDatapackProduct(root, normalized as BiomeDefinition | AdvancementDefinition)
  }

  if (prevId && prevId !== def.id) {
    const old = contentFile(root, def.kind, prevId)
    if (existsSync(old)) rmSync(old, { force: true })
    // 重命名时同步删除旧产物
    if (def.kind === 'biome' || def.kind === 'advancement') {
      deleteDatapackProduct(root, def.kind, prevId)
    }
  }

  return {
    kind: normalized.kind,
    id: normalized.id,
    // 物品 displayName 为多语言对象，走回落链取展示名
    displayName: contentDisplayName(normalized),
    path: target,
    updatedAt: normalized.updatedAt,
    overwritten
  }
}

/** 删除语义对象（仅删除 .kunyu 下的描述；生成产物在下次生成时清理） */
export function deleteContent(root: string, kind: ContentKind, id: string): boolean {
  assertWithinRoot(root)
  const p = contentFile(root, kind, id)
  if (!existsSync(p)) return false
  rmSync(p, { force: true })
  // biome/advancement 同步删除数据包产物（失败仅告警，不阻断删除）
  if (kind === 'biome' || kind === 'advancement') {
    deleteDatapackProduct(root, kind, id)
  }
  return true
}

/* ------------------------------------------------------------------ */
/* biome / advancement：归一化 + 数据包产物双写                           */
/* ------------------------------------------------------------------ */

function normalizeBiome(def: BiomeDefinition): BiomeDefinition {
  return {
    ...def,
    id: def.id.trim(),
    displayName: def.displayName.trim(),
    description: def.description ?? '',
    doc: normalizeBiomeDoc(def.doc ?? {})
  }
}

function normalizeAdvancement(def: AdvancementDefinition): AdvancementDefinition {
  return {
    ...def,
    id: def.id.trim(),
    displayName: def.displayName.trim(),
    description: def.description ?? '',
    doc: normalizeAdvancementDoc(def.doc ?? {})
  }
}

/**
 * 解析产物落盘上下文：namespace 优先取数据包元数据，
 * 无元数据时回落到模组 modId；mcVersion 缺失时取 1.20.1（复数目录）。
 * 返回 null 表示当前项目不是模组工程且未初始化数据包（无法落产物）。
 */
function resolveDatapackProductContext(
  root: string
): { namespace: string; mcVersion: McVersion; packBase: string } | null {
  const meta = readDataPackMeta(root)
  if (meta) {
    // standalone（项目根存在 pack.mcmeta）产物落项目根，否则落 src/main/resources
    const standalone = existsSync(join(root, 'pack.mcmeta'))
    return {
      namespace: meta.namespace,
      mcVersion: meta.mcVersion,
      packBase: standalone ? root : join(root, 'src', 'main', 'resources')
    }
  }
  try {
    const ctx = resolveModContext(root)
    const mcVersion = (Object.keys(PACK_FORMATS).includes(ctx.mcVersion)
      ? ctx.mcVersion
      : '1.20.1') as McVersion
    return { namespace: ctx.modId, mcVersion, packBase: ctx.resourcesDir }
  } catch {
    return null
  }
}

/** biome/advancement 产物绝对路径 */
function datapackProductAbsPath(
  root: string,
  kind: 'biome' | 'advancement',
  id: string
): string | null {
  const ctx = resolveDatapackProductContext(root)
  if (!ctx) return null
  const category = kind === 'biome' ? 'worldgen_biome' : 'advancement'
  const rel = dataPackEntryPath(ctx.namespace, category, ctx.mcVersion, id)
  return join(ctx.packBase, ...rel.split('/'))
}

/** 双写产物：语义文件保存后同步覆盖数据包产物（产物不写管理标记字段，保持纯净 JSON） */
function writeDatapackProduct(root: string, def: BiomeDefinition | AdvancementDefinition): void {
  const abs = datapackProductAbsPath(root, def.kind, def.id)
  if (!abs) {
    console.warn(`[content] ${def.kind}/${def.id}：项目无模组描述符且未初始化数据包，跳过产物落盘`)
    return
  }
  assertWithinRoot(abs)
  const dir = join(abs, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFile(abs, JSON.stringify(def.doc, null, 2) + '\n')
}

/** 删除产物（存在才删，失败仅告警不阻断） */
function deleteDatapackProduct(root: string, kind: 'biome' | 'advancement', id: string): void {
  try {
    const abs = datapackProductAbsPath(root, kind, id)
    if (abs && existsSync(abs)) rmSync(abs, { force: true })
  } catch (e) {
    console.warn(`[content] ${kind}/${id}：删除数据包产物失败`, e)
  }
}

/** 读取全部语义资产并执行代码/资源生成；overwritePaths 为用户确认覆盖的漂移文件 */
export function generateProjectContent(root: string, options?: GenerateOptions): GenerateResult {
  assertWithinRoot(root)
  const defs = listContent(root).map((s) => loadContent(root, s.kind, s.id))
  return generateContent(root, defs, options)
}

/** 生成预检（dry-run）：列出计划与手改冲突，不产生任何写入 */
export function planProjectContent(root: string): GenerationPlan {
  assertWithinRoot(root)
  const defs = listContent(root).map((s) => loadContent(root, s.kind, s.id))
  return planGeneration(root, defs)
}

/**
 * 反向同步：读取 ModBlocks.java 中该方块的声明段，
 * 解析为属性补丁回写到方块语义 JSON。
 * @returns 实际回写的字段数；找不到 Java 声明返回 0
 */
export function reverseSyncBlock(root: string, id: string): number {
  assertWithinRoot(root)
  const source = readModBlocksJava(root)
  if (!source) return 0
  const patch = parseBlockJava(source, id)
  if (!patch) return 0

  const block = loadContent(root, 'block', id) as BlockSchema
  const props = block.properties as unknown as Record<string, unknown>
  let applied = 0
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (props[key] !== value) {
      props[key] = value
      applied++
    }
  }
  if (applied > 0) saveContent(root, block)
  return applied
}

/* ------------------------------------------------------------------ */
/* 兼容性兜底：AI 直写产物 → 语义资产骨架反向导入                       */
/* ------------------------------------------------------------------ */

export interface ForeignStubResult {
  /** 新建方块骨架 id 列表 */
  blocks: string[]
  /** 新建物品骨架 id 列表 */
  items: string[]
  /** 登记为漂移保护的外来文件数 */
  protectedFiles: number
}

/**
 * 生成器全量重写型路径判定（与织入型相对）：
 * 注册类（ModBlocks/ModItems/ModEntities/ModEnchantments）与 assets/data 资源
 * 由生成器整文件重写，需要漂移保护；主类、fabric.mod.json 等织入型文件
 * 本就保留手写内容，无需登记。
 */
function isFullRewritePath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/')
  if (/\/(ModBlocks|ModItems|ModEntities|ModEnchantments)\.java$/.test(p)) return true
  // lang 与 tags 本来就是 merge 语义（syncLangFile / syncTagFile），不整文件保护
  if (p.includes('/lang/')) return false
  if (p.includes('/tags/')) return false
  return p.includes('/assets/') || p.includes('/data/')
}

const FOREIGN_STUB_NOTE =
  '由 AI 直写产物反向导入的骨架：属性均为默认值，请在编辑器中校正后再点「生成」。'

/**
 * 扫描项目资源目录，为「磁盘上存在产物但 .kunyu/content 缺语义资产」的
 * 方块/物品创建最小骨架（默认属性），并把它会重写的同名文件登记为漂移保护。
 *
 * 信号源（只读磁盘、零模型成本）：
 * - 方块：assets/<ns>/blockstates/<id>.json（有 blockstate 必有方块）
 * - 物品：assets/<ns>/models/item/<id>.json（排除 *_spawn_egg 与方块物品同名项）
 *
 * 已有同名语义资产的一律跳过；实体/配方等无法从资源可靠推断的类型不导入。
 * 非模组工程（resolveModContext 抛错）由调用方捕获。
 */
export function importForeignContentStubs(root: string): ForeignStubResult {
  assertWithinRoot(root)
  const ctx = resolveModContext(root)
  const existing = new Set(listContent(root).map((s) => `${s.kind}:${s.id}`))

  const blockIds = new Set<string>()
  const blockstatesDir = join(ctx.assetsDir, 'blockstates')
  if (existsSync(blockstatesDir)) {
    for (const name of readdirSync(blockstatesDir)) {
      const m = /^([a-z][a-z0-9_]*)\.json$/.exec(name)
      // 模板工程自带的 example_block 占位产物不是用户内容，导入会污染编辑器列表
      if (m && m[1] !== 'example_block') blockIds.add(m[1]!)
    }
  }

  const itemIds = new Set<string>()
  const itemModelsDir = join(ctx.assetsDir, 'models', 'item')
  if (existsSync(itemModelsDir)) {
    for (const name of readdirSync(itemModelsDir)) {
      const m = /^([a-z][a-z0-9_]*)\.json$/.exec(name)
      if (!m) continue
      const id = m[1]!
      // 刷怪蛋模型属实体（模板固定、无需编辑）；方块物品随方块骨架走；模板占位同方块排除
      if (id === 'example_block') continue
      if (id.endsWith('_spawn_egg')) continue
      if (blockIds.has(id)) continue
      itemIds.add(id)
    }
  }

  const createdBlocks: string[] = []
  for (const id of blockIds) {
    if (existing.has(`block:${id}`)) continue
    const stub = createDefaultBlock(id)
    stub.description = FOREIGN_STUB_NOTE
    saveContent(root, stub)
    createdBlocks.push(id)
  }

  const createdItems: string[] = []
  for (const id of itemIds) {
    if (existing.has(`item:${id}`)) continue
    const stub = createDefaultItem(id)
    stub.description = FOREIGN_STUB_NOTE
    saveContent(root, stub)
    createdItems.push(id)
  }

  let protectedFiles = 0
  if (createdBlocks.length + createdItems.length > 0) {
    // 用 dry-run 计划算出这些骨架会重写的路径，把磁盘上已存在的外来同名文件
    // 登记为漂移（哨兵 hash），用户首次「生成」时默认跳过、冲突对话框确认后才覆盖。
    const plan = planProjectContent(root)
    const candidates = plan.writes.map((w) => w.path).filter(isFullRewritePath)
    protectedFiles = protectForeignPlannedFiles(root, candidates)
  }

  return { blocks: createdBlocks, items: createdItems, protectedFiles }
}

/**
 * 保存模型像素画为 PNG 到 assets/<modid>/textures/model/<id>.png。
 * @returns assets 相对路径 textures/model/<id>.png
 */
export function saveModelTexture(
  root: string,
  modelId: string,
  pixels: string[],
  size: 16 | 32
): string {
  assertWithinRoot(root)
  if (!validateContentId(modelId)) throw new Error('注册名不合法，无法保存贴图')
  if (size !== 16 && size !== 32) throw new Error('贴图尺寸仅支持 16 或 32')
  if (!Array.isArray(pixels) || pixels.length !== size * size) {
    throw new Error(`像素数据长度必须为 ${size * size}`)
  }
  const ctx = resolveModContext(root)
  const destDir = join(ctx.assetsDir, 'textures', 'model')
  assertWithinRoot(destDir)
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, `${modelId}.png`)
  writeBinaryFile(dest, pixelsToPng(pixels, size))
  return `textures/model/${modelId}.png`
}

/**
 * 保存物品像素画为 PNG 到 assets/<modid>/textures/item/<id>.png。
 * @returns assets 相对路径 textures/item/<id>.png
 */
export function saveItemTexture(root: string, itemId: string, pixels: string[]): string {
  assertWithinRoot(root)
  if (!validateContentId(itemId)) throw new Error('注册名不合法，无法保存贴图')
  if (!Array.isArray(pixels) || pixels.length !== 256) {
    throw new Error('像素数据长度必须为 256')
  }
  const ctx = resolveModContext(root)
  const destDir = join(ctx.assetsDir, 'textures', 'item')
  assertWithinRoot(destDir)
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, `${itemId}.png`)
  writeBinaryFile(dest, pixelsToPng(pixels, 16))
  return `textures/item/${itemId}.png`
}

/** 材质导出类别 */
const TEXTURE_EXPORT_CATEGORIES = ['block', 'item', 'entity', 'gui'] as const

/**
 * 材质编辑器导出：把像素画写为 assets/<modid>/textures/<category>/<id>.png。
 * 支持非方形画布（GUI 176×166 等）。
 * @returns assets 相对路径 textures/<category>/<id>.png
 */
export function saveTextureAsset(
  root: string,
  textureId: string,
  category: string,
  pixels: string[],
  width: number,
  height: number
): string {
  assertWithinRoot(root)
  if (!validateContentId(textureId)) throw new Error('注册名不合法，无法导出贴图')
  if (!(TEXTURE_EXPORT_CATEGORIES as readonly string[]).includes(category)) {
    throw new Error(`贴图类别不合法: ${category}`)
  }
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    width > 1024 ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > 1024
  ) {
    throw new Error('画布尺寸必须在 1-1024 之间')
  }
  if (!Array.isArray(pixels) || pixels.length !== width * height) {
    throw new Error(`像素数据长度必须为 ${width * height}`)
  }
  const ctx = resolveModContext(root)
  const destDir = join(ctx.assetsDir, 'textures', category)
  assertWithinRoot(destDir)
  mkdirSync(destDir, { recursive: true })
  const dest = join(destDir, `${textureId}.png`)
  writeBinaryFile(dest, pixelsToPngRect(pixels, width, height))
  return `textures/${category}/${textureId}.png`
}

function clampNum(n: number, min: number, max: number, fallback: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 配方归一化：保证 schema 字段完整、范围合法 */
function normalizeRecipe(r: RecipeDefinition): RecipeDefinition {
  const recipeType: RecipeDefinition['recipeType'] =
    r.recipeType === 'shapeless' || r.recipeType === 'smelting' ? r.recipeType : 'shaped'
  const result = {
    item: typeof r.result?.item === 'string' ? r.result.item : '',
    count: Math.round(clampNum(r.result?.count ?? 1, 1, 64, 1))
  }
  const base = {
    ...r,
    id: r.id.trim(),
    displayName: r.displayName.trim(),
    description: r.description ?? '',
    recipeType,
    shared: Boolean(r.shared),
    group: typeof r.group === 'string' ? r.group : '',
    result,
    createdAt: r.createdAt ?? Date.now(),
    updatedAt: 0
  }
  if (recipeType === 'shaped') {
    const pattern: [string, string, string] = Array.isArray(r.pattern) && r.pattern.length === 3
      ? r.pattern.map((row) => {
          const s = typeof row === 'string' ? row : ''
          return (s + '   ').slice(0, 3)
        }) as [string, string, string]
      : ['   ', '   ', '   ']
    const key: Record<string, { item: string; count?: number }> = {}
    if (r.key && typeof r.key === 'object') {
      for (const [k, v] of Object.entries(r.key)) {
        if (v && typeof v.item === 'string') {
          key[k] = { item: v.item, ...(typeof v.count === 'number' ? { count: v.count } : {}) }
        }
      }
    }
    return { ...base, pattern, key, ingredients: undefined, input: undefined, experience: undefined, cookingTime: undefined }
  }
  if (recipeType === 'shapeless') {
    const ingredients = Array.isArray(r.ingredients)
      ? r.ingredients
          .filter((ing) => ing && typeof ing.item === 'string')
          .slice(0, 9)
          .map((ing) => ({
            item: (ing as { item: string }).item,
            ...(typeof ing.count === 'number' ? { count: ing.count } : {})
          }))
      : []
    return { ...base, ingredients, pattern: undefined, key: undefined, input: undefined, experience: undefined, cookingTime: undefined }
  }
  // smelting
  const input = typeof r.input === 'string' ? r.input : ''
  const experience = clampNum(r.experience ?? 0, 0, 1, 0)
  const cookingTime = Math.round(clampNum(r.cookingTime ?? 200, 1, 32000, 200))
  return {
    ...base,
    input,
    experience,
    cookingTime,
    pattern: undefined,
    key: undefined,
    ingredients: undefined
  }
}
