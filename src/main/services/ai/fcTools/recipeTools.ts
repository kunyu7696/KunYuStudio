/**
 * P1 配方 FC 工具三件套（语义层，统一走 shared/schemas/recipe.schema）：
 *
 * - recipe_validate：校验语义配方并预览编译后的原版 JSON（不落盘，无需打开项目）
 * - recipe_create：把语义配方幂等挂到 item/block/entity 内容定义（.kunyu/content）
 * - recipe_generate：中文/口语原料 → minecraft-data 注册名解析 → 语义配方，
 *   可直接落盘；附带原版同产物配方参考，帮助模型自检形状/材料
 *
 * 落盘产物由 contentGenerator 统一编译为 data/<ns>/recipes/<id>.json，
 * 本模块不直接写数据包文件（单一事实源 = .kunyu/content）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  compileRecipe,
  validateRecipe,
  type RecipeDef,
  type RecipeKind
} from '../../../../shared/schemas/recipe.schema'
import { dataPath } from '../../../../shared/dataPath'
import { loadContent, saveContent } from '../../contentService'
import type { McDataService } from '../../mcDataService'
import type { RegisteredTool, ToolRegistryDeps, ToolResult } from '../toolRegistry'

const CLIP = 8000
function clip(text: string): string {
  return text.length <= CLIP ? text : `${text.slice(0, CLIP)}…（已截断）`
}

type OwnerKind = 'item' | 'block' | 'entity'

/** 读取项目 mod id（与 contentGenerator.resolveModContext 的 fabric 分支同源，轻量内联避免重依赖）。 */
function readProjectModId(root: string): string {
  const p = join(root, 'src', 'main', 'resources', 'fabric.mod.json')
  if (!existsSync(p)) throw new Error('未找到 src/main/resources/fabric.mod.json（配方工具需要 Fabric 项目）')
  const modJson = JSON.parse(readFileSync(p, 'utf-8')) as { id?: unknown }
  if (typeof modJson.id !== 'string' || !modJson.id) throw new Error('fabric.mod.json 缺少 id')
  return modJson.id
}

/** 读取项目 MC 版本（gradle.properties 的 minecraft_version）；缺失返回空串。 */
function readProjectMcVersion(root: string): string {
  const p = join(root, 'gradle.properties')
  if (!existsSync(p)) return ''
  const m = /^minecraft_version\s*=\s*(.+)$/m.exec(readFileSync(p, 'utf-8'))
  return m ? m[1]!.trim() : ''
}

function asOwnerKind(v: unknown): OwnerKind | null {
  return v === 'item' || v === 'block' || v === 'entity' ? v : null
}

/** 物品名解析结果。bare=无命名空间裸名（编译时补项目 mod id）。 */
interface ResolvedItem {
  /** 编译用 id：含命名空间原样；裸名保留原样交给 compileRecipe 补 ns */
  id: string
  /** 是否经 mcdata 核实存在 */
  verified: boolean
  /** 解析途径说明 */
  via: 'literal' | 'mcdata' | 'bare'
}

const BARE_ID = /^[a-z0-9_.-]+$/
const FULL_ID = /^[a-z0-9_.-]+:[a-z0-9_/.-]+$/

/** 把中文/英文/注册名解析为物品 id；无法判定返回候选建议。 */
function resolveItemName(
  svc: McDataService | null,
  query: string
): { value: ResolvedItem; suggestions?: string[] } | { value: null; suggestions: string[] } {
  const q = query.trim()
  if (FULL_ID.test(q)) {
    return { value: { id: q, verified: true, via: 'literal' } }
  }
  if (svc) {
    // 铁矿石/金块等「方块物品」在语义上以物品身份入配方，注册名与方块一致，故 item 未命中回退 block
    const hit =
      svc.resolve(q, 'item') ??
      svc.resolve(q, 'block') ??
      svc.lookup(q, ['item', 'block'], 1).entries[0]
    if (hit) {
      // McDataEntry.name 无命名空间且默认 minecraft:，带前缀后 compileRecipe 会原样保留，
      // 避免在模组项目里被误补成 <modid>:diamond
      return { value: { id: `minecraft:${hit.name}`, verified: true, via: 'mcdata' } }
    }
  }
  if (BARE_ID.test(q)) {
    // 可能是本模组物品：保留裸名，编译时补项目命名空间
    return { value: { id: q, verified: false, via: 'bare' } }
  }
  const suggestions = svc ? svc.lookup(q, ['item'], 5).entries.map((e) => e.name) : []
  return { value: null, suggestions }
}

/**
 * 规范化形状：补齐为 3 行且各行等宽（取最大行长，右侧填空格）。
 * 单列配方宽=1 时自然得到 ["X","X","Y"]（与原版数据一致）。
 */
function normalizePattern(rows: string[]): [string, string, string] {
  const width = Math.max(...rows.map((r) => r.length), 1)
  const fixed = rows.slice(0, 3).map((r) => r.padEnd(width, ' '))
  while (fixed.length < 3) fixed.push(' '.repeat(width))
  return [fixed[0]!, fixed[1]!, fixed[2]!]
}

function asRecipeDef(raw: unknown): { def?: RecipeDef; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: 'recipe 必须是语义配方对象' }
  const o = raw as Record<string, unknown>
  const kind = o['kind']
  if (kind !== 'crafting_shaped' && kind !== 'crafting_shapeless' && kind !== 'smelting') {
    return { error: 'recipe.kind 必须是 crafting_shaped / crafting_shapeless / smelting' }
  }
  if (typeof o['result'] !== 'object' || o['result'] === null) {
    return { error: 'recipe.result 必须是 {item, count}' }
  }
  return { def: raw as RecipeDef }
}

/** 生成稳定的配方文件 id（output 短名 → 合法 id）。 */
function idFromItem(item: string): string {
  const short = item.includes(':') ? item.split(':')[1]! : item
  const id = short.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '')
  return /^[a-z]/.test(id) ? id : `recipe_${id || 'x'}`
}

export function builtinRecipeTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  /* ---------------- recipe_validate ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'recipe_validate',
        description:
          '校验语义配方（crafting_shaped/shapeless/smelting）并预览编译后的原版 1.20.1 配方 JSON。' +
          '只读不落盘；写配方前或排查配方不生效时使用。物品 id 不含命名空间时按项目 mod id 补全。',
        parameters: {
          type: 'object',
          properties: {
            recipe: {
              type: 'object',
              description:
                '语义配方：{id,kind,result:{item,count},pattern?:["xx"," x"],key?:{x:{item}},ingredients?:[{item}],input?:string,experience?,cookingTime?}'
            },
            namespace: { type: 'string', description: '可选命名空间（无打开项目时必填，用于裸名补全预览）' }
          },
          required: ['recipe']
        }
      }
    },
    execute: (args) => {
      const parsed = asRecipeDef(args['recipe'])
      if (parsed.error || !parsed.def) return { ok: false, text: '', error: parsed.error ?? 'recipe 非法' }
      const root = deps.projectRoot?.()
      let namespace = typeof args['namespace'] === 'string' ? args['namespace'] : ''
      if (!namespace) {
        if (!root) return { ok: false, text: '', error: '没有打开的项目且未提供 namespace，无法补全裸名' }
        try {
          namespace = readProjectModId(root)
        } catch (e) {
          return { ok: false, text: '', error: (e as Error).message }
        }
      }
      const def = parsed.def
      if (!def.id?.trim()) def.id = idFromItem(def.result.item)
      if (def.kind === 'crafting_shaped' && Array.isArray(def.pattern)) {
        def.pattern = normalizePattern(def.pattern)
      }
      const firstError = validateRecipe(def)
      const warnings: string[] = []
      if (def.kind === 'crafting_shaped' && def.key) {
        const used = new Set<string>(def.pattern?.join('').replace(/ /g, '').split('') ?? [])
        for (const ch of Object.keys(def.key)) {
          if (!used.has(ch)) warnings.push(`key 中「${ch}」未在 pattern 中使用（无效映射，将被编译进 JSON）`)
        }
        if ((def.result.count ?? 1) > 64) warnings.push('产物数量超过 64，超出常规堆叠上限')
      }
      if (def.kind === 'crafting_shapeless' && (def.ingredients?.length ?? 0) > 9) {
        return { ok: false, text: '', error: '无序合成原料不能超过 9 个' }
      }
      const mcVersion = root ? readProjectMcVersion(root) : ''
      const vanilla = compileRecipe(def, namespace, mcVersion || undefined)
      const lines = [
        firstError ? `校验未通过：${firstError}` : `校验通过 ✓（${warnings.length} 条警告）`,
        ...warnings.map((w) => `⚠️ ${w}`),
        '',
        `将产出：data/${namespace}/${dataPath('recipe', mcVersion)}/${def.id}.json`,
        '```json',
        JSON.stringify(vanilla, null, 2),
        '```'
      ]
      return {
        ok: !firstError,
        text: clip(lines.join('\n')),
        data: { valid: !firstError, warnings, recipeId: def.id, vanilla }
      }
    }
  })

  /* ---------------- recipe_create ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'recipe_create',
        description:
          '把一个语义配方幂等写入指定物品/方块/实体内容定义的 recipes 列表（.kunyu/content，与编辑器同源）。' +
          '同 recipe.id 覆盖、不同 id 追加；校验不通过拒绝写入；写入后由「生成代码与资源」编译为数据包文件。' +
          '配方 id 缺省用归属对象 id。',
        parameters: {
          type: 'object',
          properties: {
            ownerKind: { type: 'string', enum: ['item', 'block', 'entity'], description: '配方归属对象类型' },
            ownerId: { type: 'string', description: '归属对象 id（须已存在，先 content_list 确认）' },
            recipe: { type: 'object', description: '完整语义配方（同 recipe_validate 的 recipe）' }
          },
          required: ['ownerKind', 'ownerId', 'recipe']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const ownerKind = asOwnerKind(args['ownerKind'])
      if (!ownerKind) return { ok: false, text: '', error: 'ownerKind 必须是 item/block/entity' }
      const ownerId = typeof args['ownerId'] === 'string' ? args['ownerId'] : ''
      if (!ownerId) return { ok: false, text: '', error: 'ownerId 不能为空' }
      const parsed = asRecipeDef(args['recipe'])
      if (parsed.error || !parsed.def) return { ok: false, text: '', error: parsed.error ?? 'recipe 非法' }
      const def = parsed.def
      if (!def.id?.trim()) def.id = ownerId
      if (def.kind === 'crafting_shaped' && Array.isArray(def.pattern)) {
        def.pattern = normalizePattern(def.pattern)
      }
      const error = validateRecipe(def)
      if (error) return { ok: false, text: '', error: `配方校验未通过：${error}` }
      let modId: string
      try {
        modId = readProjectModId(root)
      } catch (e) {
        return { ok: false, text: '', error: (e as Error).message }
      }
      let content: ReturnType<typeof loadContent>
      try {
        content = loadContent(root, ownerKind, ownerId)
      } catch (e) {
        return { ok: false, text: '', error: `归属对象不存在：${(e as Error).message}（请先用 content_upsert 创建）` }
      }
      const owner = content as unknown as { recipes?: RecipeDef[] }
      const list = Array.isArray(owner.recipes) ? owner.recipes : []
      const idx = list.findIndex((r) => r.id === def.id)
      const replaced = idx >= 0
      if (replaced) list[idx] = def
      else list.push(def)
      owner.recipes = list
      try {
        saveContent(root, content)
      } catch (e) {
        return { ok: false, text: '', error: `保存失败：${(e as Error).message}` }
      }
      const mcVersion = readProjectMcVersion(root)
      const vanilla = compileRecipe(def, modId, mcVersion || undefined)
      return {
        ok: true,
        text: clip(
          `配方 ${def.id} 已${replaced ? '覆盖更新' : '追加'}到 ${ownerKind}/${ownerId}（现有 ${list.length} 条配方）。\n` +
            `生成代码与资源后产出：data/${modId}/${dataPath('recipe', mcVersion)}/${def.id}.json\n` +
            '```json\n' +
            JSON.stringify(vanilla, null, 2) +
            '\n```'
        ),
        data: { ownerKind, ownerId, recipeId: def.id, replaced, total: list.length, vanilla }
      }
    }
  })

  /* ---------------- recipe_generate ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'recipe_generate',
        description:
          '按自然描述生成语义配方：自动把中文/英文原料名解析为 1.20.1 标准注册名（离线 minecraft-data），' +
          '组装 shaped/shapeless/smelting 语义对象，校验并预览原版 JSON；给 ownerKind/ownerId 时直接幂等落盘。' +
          '同时回传原版同产物配方作对照，避免编造材料或摆法。例：output="钻石剑"，' +
          'ingredients=[{item:"钻石",char:"D"},{item:"木棍",char:"S"}]，rows=["D","D","S"]。',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['crafting_shaped', 'crafting_shapeless', 'smelting'] },
            output: { type: 'string', description: '产物名称或注册名（中文/英文均可）' },
            count: { type: 'number', description: '产物数量，默认 1（smelting 忽略）' },
            ingredients: {
              type: 'array',
              description:
                '原料：shaped 用 {item,char} 且 rows 引用这些 char；shapeless 用 {item,amount?}（amount 为同种原料重复格数）',
              items: { type: 'object' }
            },
            rows: { type: 'array', items: { type: 'string' }, description: 'crafting_shaped：1~3 行网格（空格留空）' },
            input: { type: 'string', description: 'smelting：输入物品名' },
            experience: { type: 'number', description: 'smelting：烧炼经验' },
            cookingTime: { type: 'number', description: 'smelting：ticks，默认 200' },
            recipeId: { type: 'string', description: '配方文件 id，缺省取产物短名（落盘到 owner 时缺省用 ownerId）' },
            namespace: { type: 'string', description: '不落盘时用于裸名补全的命名空间，默认 minecraft' },
            ownerKind: { type: 'string', enum: ['item', 'block', 'entity'], description: '给出则直接落盘' },
            ownerId: { type: 'string', description: '落盘归属对象 id' }
          },
          required: ['kind', 'output']
        }
      }
    },
    execute: (args) => {
      const kind = args['kind'] as RecipeKind
      const outputQuery = typeof args['output'] === 'string' ? args['output'] : ''
      if (!outputQuery.trim()) return { ok: false, text: '', error: 'output 不能为空' }
      const svc = deps.mcData?.() ?? null
      const outRes = resolveItemName(svc, outputQuery)
      if (!outRes.value) {
        return {
          ok: false,
          text: '',
          error: `无法识别产物「${outputQuery}」。候选：${outRes.suggestions.join(' / ') || '无'}（也可直接给注册名如 minecraft:diamond）`
        }
      }
      const resolution: string[] = [`${outputQuery} → ${outRes.value.id}（${outRes.value.via}）`]
      const count = Math.max(1, Math.floor(typeof args['count'] === 'number' ? args['count'] : 1))

      const def: RecipeDef = {
        id: '',
        kind,
        result: { item: outRes.value.id, count }
      }

      const rawIngredients = Array.isArray(args['ingredients']) ? args['ingredients'] : []

      if (kind === 'crafting_shaped') {
        const rows = Array.isArray(args['rows']) ? args['rows'].filter((r): r is string => typeof r === 'string') : []
        if (rows.length === 0 || rows.length > 3) {
          return { ok: false, text: '', error: 'crafting_shaped 需要 rows：1~3 行字符串网格' }
        }
        if (rows.some((r) => r.length > 3)) {
          return { ok: false, text: '', error: 'crafting_shaped 每行不能超过 3 格' }
        }
        const key: Record<string, { item: string }> = {}
        const charsSeen = new Set<string>()
        for (const raw of rawIngredients) {
          const item = (raw as Record<string, unknown>)?.['item']
          const char = (raw as Record<string, unknown>)?.['char']
          if (typeof item !== 'string' || typeof char !== 'string' || !/^[A-Za-z]$/.test(char)) {
            return { ok: false, text: '', error: 'shaped 原料必须是 {item:string, char:单个字母}' }
          }
          const r = resolveItemName(svc, item)
          if (!r.value) {
            return { ok: false, text: '', error: `原料「${item}」无法识别，候选：${r.suggestions.join(' / ') || '无'}` }
          }
          key[char] = { item: r.value.id }
          charsSeen.add(char)
          resolution.push(`${item} → ${r.value.id}（char=${char}，${r.value.via}${r.value.verified ? '' : '，未核实'}）`)
        }
        const usedChars = new Set(rows.join('').replace(/ /g, '').split(''))
        const missing = [...usedChars].filter((c) => !charsSeen.has(c))
        if (missing.length > 0) {
          return { ok: false, text: '', error: `网格使用了未在 ingredients 声明的字符：${missing.join(',')}` }
        }
        def.pattern = normalizePattern(rows)
        def.key = key
      } else if (kind === 'crafting_shapeless') {
        const ings: Array<{ item: string }> = []
        for (const raw of rawIngredients) {
          const item = (raw as Record<string, unknown>)?.['item']
          const amount = (raw as Record<string, unknown>)?.['amount']
          if (typeof item !== 'string') {
            return { ok: false, text: '', error: 'shapeless 原料必须是 {item, amount?}' }
          }
          const r = resolveItemName(svc, item)
          if (!r.value) {
            return { ok: false, text: '', error: `原料「${item}」无法识别，候选：${r.suggestions.join(' / ') || '无'}` }
          }
          const n = Math.max(1, Math.floor(typeof amount === 'number' ? amount : 1))
          for (let i = 0; i < n; i++) ings.push({ item: r.value.id })
          resolution.push(`${item} → ${r.value.id}${n > 1 ? ` ×${n}` : ''}（${r.value.via}）`)
        }
        if (ings.length === 0) return { ok: false, text: '', error: 'shapeless 至少需要一种原料' }
        if (ings.length > 9) return { ok: false, text: '', error: 'shapeless 原料合计不能超过 9 格' }
        def.ingredients = ings
      } else {
        const input = typeof args['input'] === 'string' ? args['input'] : ''
        if (!input.trim()) return { ok: false, text: '', error: 'smelting 需要 input' }
        const r = resolveItemName(svc, input)
        if (!r.value) {
          return { ok: false, text: '', error: `输入「${input}」无法识别，候选：${r.suggestions.join(' / ') || '无'}` }
        }
        def.input = r.value.id
        def.experience = Math.max(0, typeof args['experience'] === 'number' ? args['experience'] : 0)
        def.cookingTime = Math.max(1, Math.floor(typeof args['cookingTime'] === 'number' ? args['cookingTime'] : 200))
        resolution.push(`${input} → ${r.value.id}（${r.value.via}）`)
      }

      // 落盘归属 / namespace / id
      const root = deps.projectRoot?.()
      const ownerKind = asOwnerKind(args['ownerKind'])
      const ownerId = typeof args['ownerId'] === 'string' ? args['ownerId'] : ''
      if ((ownerKind && !ownerId) || (!ownerKind && ownerId)) {
        return { ok: false, text: '', error: 'ownerKind 与 ownerId 必须同时提供' }
      }
      let modId: string | null = null
      if (root) {
        try {
          modId = readProjectModId(root)
        } catch {
          modId = null
        }
      }
      if (ownerKind && !root) return { ok: false, text: '', error: '落盘需要先打开项目' }
      def.id = typeof args['recipeId'] === 'string' && args['recipeId']
        ? args['recipeId']
        : ownerId || idFromItem(def.result.item)

      const validationError = validateRecipe(def)
      if (validationError) return { ok: false, text: '', error: `生成配方校验未通过：${validationError}` }

      // 原版同产物配方参考（mcdata）
      const referenceLines: string[] = []
      if (svc && outRes.value.via !== 'bare') {
        try {
          const refs = svc.recipes(outRes.value.id.replace(/^minecraft:/, ''), 3)
          if (refs.length > 0) {
            referenceLines.push('原版同产物配方参考（核对材料/摆法，自定义配方可不同）：')
            for (const ref of refs) {
              referenceLines.push(
                `- [${ref.type}] ${ref.ingredients.join(' + ')}` +
                  (ref.pattern?.length ? `\n  摆法：${ref.pattern.map((r) => `[${r}]`).join(' / ')}` : '') +
                  (ref.count > 1 ? ` ×${ref.count}` : '')
              )
            }
          }
        } catch {
          // 参考仅为增强信息，忽略查询异常
        }
      }

      const namespace = modId ?? (typeof args['namespace'] === 'string' ? args['namespace'] : 'minecraft')
      const mcVersion = root ? readProjectMcVersion(root) : ''
      const vanilla = compileRecipe(def, namespace, mcVersion || undefined)

      let saveNote = '未落盘（未提供 ownerKind/ownerId）；确认后可用 recipe_create 写入。'
      let saved: { ownerKind: OwnerKind; ownerId: string; replaced: boolean; total: number } | null = null
      if (ownerKind && ownerId && root) {
        let content: ReturnType<typeof loadContent>
        try {
          content = loadContent(root, ownerKind, ownerId)
        } catch (e) {
          return { ok: false, text: '', error: `归属对象 ${ownerKind}/${ownerId} 不存在：${(e as Error).message}（请先 content_upsert）` }
        }
        const owner = content as unknown as { recipes?: RecipeDef[] }
        const list = Array.isArray(owner.recipes) ? owner.recipes : []
        const idx = list.findIndex((r) => r.id === def.id)
        const replaced = idx >= 0
        if (replaced) list[idx] = def
        else list.push(def)
        owner.recipes = list
        saveContent(root, content)
        saved = { ownerKind, ownerId, replaced, total: list.length }
        saveNote = `已${replaced ? '覆盖' : '追加'}到 ${ownerKind}/${ownerId}（共 ${list.length} 条配方）。`
      }

      const text = [
        `已生成 ${kind} 配方（id=${def.id}）。${saveNote}`,
        '名称解析：',
        ...resolution.map((r) => `- ${r}`),
        ...(outRes.value.verified ? [] : ['⚠️ 产物为裸名（未在 minecraft-data 核实），将按项目命名空间补全；若是原版物品请改用注册名。']),
        referenceLines.length ? '' : '',
        ...referenceLines,
        `将产出：data/${namespace}/${dataPath('recipe', mcVersion)}/${def.id}.json`,
        '```json',
        JSON.stringify(vanilla, null, 2),
        '```'
      ]
        .filter((l) => l !== undefined)
        .join('\n')
      const result: ToolResult = {
        ok: true,
        text: clip(text),
        data: { recipe: def, vanilla, saved }
      }
      return result
    }
  })

  return tools
}
