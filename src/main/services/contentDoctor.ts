/**
 * 内容资源体检（content:doctor）：只读扫描语义层与工程产物之间的引用一致性。
 *
 * saveContent 的 schema 校验只能保证单个对象自洽，无法发现跨对象/跨文件问题；
 * 本服务在「不生成、不修改」前提下汇总以下问题，供用户在统一编辑器一键自检：
 * - corrupt_json：.kunyu/content 下损坏/类型非法的语义文件（listContent 会静默跳过它们）
 * - missing_texture：对象声明使用自定义 PNG，但 assets 下找不到对应文件
 * - dangling_model：cubeModelId 指向不存在的模型资产
 * - unknown_recipe_ref：配方引用了本模组不存在的方块/物品（原版/其他模组 id 不报）
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { listContent, loadContent } from './contentService'
import { resolveModContext } from './contentGenerator'
import type {
  BlockSchema,
  ContentDefinition,
  ContentKind,
  EntitySchema,
  ItemSchema
} from '../../shared/types/content'
import type { RecipeDef } from '../../shared/schemas/recipe.schema'

export type DoctorLevel = 'error' | 'warn'
export type DoctorIssueKind =
  | 'corrupt_json'
  | 'missing_texture'
  | 'dangling_model'
  | 'unknown_recipe_ref'

export interface DoctorIssue {
  level: DoctorLevel
  kind: DoctorIssueKind
  /** 相关语义对象 id；损坏文件取其文件名 */
  id: string
  message: string
}

export interface DoctorReport {
  ok: boolean
  issues: DoctorIssue[]
  /** 成功加载的语义对象总数 */
  objectCount: number
  errorCount: number
  warningCount: number
  /** ok=false 时的总体失败原因（如不是模组工程） */
  error?: string
}

const CONTENT_KIND_DIRS: ReadonlyArray<{ kind: ContentKind; dir: string }> = [
  { kind: 'block', dir: 'blocks' },
  { kind: 'item', dir: 'items' },
  { kind: 'entity', dir: 'entities' },
  { kind: 'model', dir: 'models' },
  { kind: 'recipe', dir: 'recipes' },
  { kind: 'texture', dir: 'textures' },
  { kind: 'enchantment', dir: 'enchantments' }
]

const KNOWN_KINDS: readonly string[] = CONTENT_KIND_DIRS.map((d) => d.kind)

/**
 * 把贴图引用规整为 assets/<ns>/textures 下的相对路径，与 contentGenerator 的
 * `${modId}:${path.replace(/^textures\//,'').replace(/\.png$/,'')}` 规则同源。
 * @returns 相对 textures 目录的路径（无扩展名）；空引用返回 null
 */
function textureRelNoExt(rawPath: string): string | null {
  const p = rawPath.trim().replace(/^textures[\\/]/, '').replace(/\.png$/i, '')
  return p || null
}

/** 收集配方中所有被引用的物品 id（含命名空间原样） */
function collectRecipeRefs(recipe: RecipeDef): string[] {
  const refs: string[] = [recipe.result.item]
  if (recipe.key) for (const v of Object.values(recipe.key)) refs.push(v.item)
  if (recipe.ingredients) for (const v of recipe.ingredients) refs.push(v.item)
  if (recipe.input) refs.push(recipe.input)
  return refs.filter((s) => typeof s === 'string' && s.trim())
}

/** 引用是否指向「本模组」对象（无命名空间或命名空间==modId）；是则返回裸 id，否则 null */
function localRefId(ref: string, modId: string): string | null {
  const trimmed = ref.trim()
  if (trimmed.includes(':')) {
    const [ns, id] = trimmed.split(':')
    return ns === modId ? id : null
  }
  return trimmed
}

/** 扫描 .kunyu/content 下无法解析为合法语义对象的 JSON 文件 */
function findCorruptFiles(root: string): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const base = join(root, '.kunyu', 'content')
  for (const { dir } of CONTENT_KIND_DIRS) {
    const dirAbs = join(base, dir)
    if (!existsSync(dirAbs)) continue
    for (const name of readdirSync(dirAbs)) {
      if (!name.endsWith('.json')) continue
      const abs = join(dirAbs, name)
      let parsed: unknown
      try {
        parsed = JSON.parse(readFileSync(abs, 'utf-8').replace(/^\uFEFF/, ''))
      } catch {
        issues.push({
          level: 'error',
          kind: 'corrupt_json',
          id: name,
          message: `${dir}/${name} 不是合法 JSON，列表与生成器均会跳过它`
        })
        continue
      }
      const obj = parsed as { kind?: unknown; id?: unknown } | null
      if (
        !obj ||
        typeof obj !== 'object' ||
        typeof obj.kind !== 'string' ||
        !KNOWN_KINDS.includes(obj.kind) ||
        typeof obj.id !== 'string' ||
        !obj.id
      ) {
        issues.push({
          level: 'error',
          kind: 'corrupt_json',
          id: name,
          message: `${dir}/${name} 缺少合法的 kind/id 字段，无法识别为语义对象`
        })
      }
    }
  }
  return issues
}

/** 执行体检；只读，不生成任何文件 */
export function runContentDoctor(root: string): DoctorReport {
  let modId: string
  let assetsDir: string
  try {
    const ctx = resolveModContext(root)
    modId = ctx.modId
    assetsDir = ctx.assetsDir
  } catch (e) {
    return {
      ok: false,
      issues: [],
      objectCount: 0,
      errorCount: 0,
      warningCount: 0,
      error: e instanceof Error ? e.message : '无法解析模组工程上下文'
    }
  }

  const issues = findCorruptFiles(root)

  const summaries = listContent(root)
  const defs: ContentDefinition[] = []
  for (const s of summaries) {
    try {
      defs.push(loadContent(root, s.kind, s.id))
    } catch {
      // 单文件读取失败已由 findCorruptFiles/列表层覆盖，这里不阻断整体检
    }
  }

  const modelIds = new Set(defs.filter((d) => d.kind === 'model').map((d) => d.id))
  const localObjectIds = new Set(
    defs.filter((d) => d.kind === 'block' || d.kind === 'item').map((d) => d.id)
  )

  const textureExists = (rawPath: string): boolean => {
    const rel = textureRelNoExt(rawPath)
    if (!rel) return true
    return existsSync(join(assetsDir, 'textures', `${rel}.png`))
  }

  const checkCubeModel = (id: string, cubeModelId?: string | null): void => {
    if (cubeModelId && !modelIds.has(cubeModelId)) {
      issues.push({
        level: 'error',
        kind: 'dangling_model',
        id,
        message: `绑定的 Cube 模型「${cubeModelId}」不存在，请重新绑定或在建模器中创建`
      })
    }
  }

  const checkRecipes = (id: string, recipes?: RecipeDef[]): void => {
    for (const recipe of recipes ?? []) {
      for (const ref of collectRecipeRefs(recipe)) {
        const localId = localRefId(ref, modId)
        if (localId !== null && !localObjectIds.has(localId)) {
          issues.push({
            level: 'warn',
            kind: 'unknown_recipe_ref',
            id,
            message: `配方「${recipe.id}」引用了本模组不存在的对象 ${ref}，生成进游戏后该配方将无法合成`
          })
        }
      }
    }
  }

  for (const def of defs) {
    if (def.kind === 'block') {
      const b = def as BlockSchema
      // path 非空且非程序化生成 = 依赖用户提供的真实 PNG
      if (b.texture.path && b.texture.generated === false && !textureExists(b.texture.path)) {
        issues.push({
          level: 'error',
          kind: 'missing_texture',
          id: b.id,
          message: `方块自定义贴图缺失：assets/${modId}/textures/${
            textureRelNoExt(b.texture.path) ?? b.texture.path
          }.png`
        })
      }
      checkCubeModel(b.id, b.cubeModelId)
      checkRecipes(b.id, b.recipes)
    } else if (def.kind === 'item') {
      const i = def as ItemSchema
      if (i.texture.path && i.texture.generated === false && !textureExists(i.texture.path)) {
        issues.push({
          level: 'error',
          kind: 'missing_texture',
          id: i.id,
          message: `物品自定义贴图缺失：assets/${modId}/textures/${
            textureRelNoExt(i.texture.path) ?? i.texture.path
          }.png`
        })
      }
      checkCubeModel(i.id, i.cubeModelId)
      checkRecipes(i.id, i.recipes)
    } else if (def.kind === 'entity') {
      const e = def as EntitySchema
      if (e.texture.path && !textureExists(e.texture.path)) {
        issues.push({
          level: 'warn',
          kind: 'missing_texture',
          id: e.id,
          message: `实体自定义贴图缺失：assets/${modId}/textures/${
            textureRelNoExt(e.texture.path) ?? e.texture.path
          }.png`
        })
      }
    }
  }

  const errorCount = issues.filter((i) => i.level === 'error').length
  const warningCount = issues.filter((i) => i.level === 'warn').length
  return {
    ok: true,
    issues: issues.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)),
    objectCount: defs.length,
    errorCount,
    warningCount
  }
}
