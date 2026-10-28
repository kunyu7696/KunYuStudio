/**
 * Minecraft 原版结构化数据查询（离线，P0 知识源①）。
 *
 * 数据来源：prismarinejs/minecraft-data（MIT License），仅随包分发
 * 1.20.1 精选子集（resources/mcdata/pc/1.20.1）：
 * blocks/items/entities/enchantments/effects/biomes/particles/foods/recipes/
 * materials/instruments/blockLoot/entityLoot/language。
 *
 * 用途：Agent 写配方/战利品/属性时，先经 mc_data_lookup 取得标准注册名与
 * 数值参数（硬度/耐久/碰撞箱/饱食…），杜绝凭记忆编造 ID。
 *
 * 纯函数 + 懒加载缓存；rootDir 可注入（测试/多版本扩展），不直接依赖 electron app。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isPackagedRuntime } from '../runtimeEnv'

export type McDataKind =
  | 'block'
  | 'item'
  | 'entity'
  | 'enchantment'
  | 'effect'
  | 'biome'
  | 'particle'
  | 'food'

export interface McDataEntry {
  kind: McDataKind
  /** 标准注册名（无命名空间，默认 minecraft:），如 diamond_ore */
  name: string
  /** 原版英文名（Stone / Diamond Ore） */
  displayName: string
  /** 中文别名（种子词典命中时存在） */
  zhName?: string
  /** 分类相关的数值/事实参数 */
  facts: Record<string, unknown>
}

export interface McRecipeResult {
  /** 产物注册名 */
  output: string
  count: number
  /** 配方类型：crafting_shaped / crafting_shapeless / smelting / stonecutting 等 */
  type: string
  /** 人类可读成分描述（注册名 × 数量） */
  ingredients: string[]
  /** 结构化成分（name → 数量；形状配方含 pattern 行） */
  pattern?: string[]
}

interface RawBlock {
  id: number
  name: string
  displayName: string
  hardness?: number
  resistance?: number
  stackSize?: number
  material?: string
  diggable?: boolean
  transparent?: boolean
  emitLight?: number
  filterLight?: number
  drops?: Array<number | { item?: number; drop?: number }>
  harvestTools?: Record<string, boolean | number>
  boundingBox?: string
  soundType?: { name?: string }
}

interface RawItem {
  id: number
  name: string
  displayName: string
  stackSize: number
  maxDurability?: number
}

interface RawEntity {
  id: number
  name: string
  displayName: string
  width?: number
  height?: number
  type?: string
  category?: string
}

interface RawSimple {
  id?: number
  name: string
  displayName?: string
  [k: string]: unknown
}

type RawFoods = Record<string, { stackSize?: number; foodPoints?: number; saturation?: number }>
type RawRecipes = Record<string, Array<Record<string, unknown>>>
type RawLanguage = Record<string, string>
type ZhAliases = Record<string, string>

const KIND_FILES: Record<McDataKind, string> = {
  block: 'blocks.json',
  item: 'items.json',
  entity: 'entities.json',
  enchantment: 'enchantments.json',
  effect: 'effects.json',
  biome: 'biomes.json',
  particle: 'particles.json',
  food: 'foods.json'
}

export class McDataService {
  private readonly dir: string
  private cache = new Map<string, unknown>()
  private aliases: ZhAliases | null = null
  private itemNameById = new Map<number, string>()

  constructor(rootDir?: string) {
    this.dir = join(rootDir ?? defaultMcDataRoot(), 'pc', '1.20.1')
  }

  available(): boolean {
    return existsSync(join(this.dir, 'blocks.json'))
  }

  private load<T>(file: string): T {
    const hit = this.cache.get(file)
    if (hit !== undefined) return hit as T
    const raw = readFileSync(join(this.dir, file), 'utf-8').replace(/^﻿/, '')
    const parsed = JSON.parse(raw) as T
    this.cache.set(file, parsed)
    return parsed
  }

  private zhMap(): ZhAliases {
    if (this.aliases) return this.aliases
    const path = join(this.dir, 'zh-aliases.json')
    this.aliases = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf-8')) as ZhAliases)
      : {}
    return this.aliases
  }

  private zhOf(kind: McDataKind, name: string): string | undefined {
    return this.zhMap()[`${kind}:${name}`]
  }

  private items(): RawItem[] {
    const items = this.load<RawItem[]>('items.json')
    if (this.itemNameById.size === 0) {
      for (const it of items) this.itemNameById.set(it.id, it.name)
    }
    return items
  }

  private itemName(id: number): string {
    this.items()
    return this.itemNameById.get(id) ?? `item#${id}`
  }

  /** 全量条目索引（按 kind 懒构建） */
  private entriesOf(kind: McDataKind): McDataEntry[] {
    const key = `__entries__${kind}`
    const cached = this.cache.get(key) as McDataEntry[] | undefined
    if (cached) return cached

    let entries: McDataEntry[] = []
    if (kind === 'block') {
      entries = this.load<RawBlock[]>('blocks.json').map((b) => ({
        kind,
        name: b.name,
        displayName: b.displayName,
        facts: {
          hardness: b.hardness,
          resistance: b.resistance,
          material: b.material,
          diggable: b.diggable,
          transparent: b.transparent,
          emitLight: b.emitLight,
          filterLight: b.filterLight,
          stackSize: b.stackSize,
          boundingBox: b.boundingBox,
          sound: b.soundType?.name,
          needsTool: b.harvestTools ? Object.keys(b.harvestTools).length > 0 : false,
          drops: (b.drops ?? []).map((d) =>
            typeof d === 'number' ? this.itemName(d) : this.itemName(d.drop ?? d.item ?? 0)
          )
        }
      }))
    } else if (kind === 'item') {
      entries = this.items().map((it) => ({
        kind,
        name: it.name,
        displayName: it.displayName,
        facts: { stackSize: it.stackSize, maxDurability: it.maxDurability }
      }))
    } else if (kind === 'entity') {
      entries = this.load<RawEntity[]>('entities.json').map((en) => ({
        kind,
        name: en.name,
        displayName: en.displayName,
        facts: {
          width: en.width,
          height: en.height,
          type: en.type,
          category: en.category
        }
      }))
    } else if (kind === 'food') {
      // foods.json 以数字 item id 为键，值含 name/foodPoints/saturation
      const foods = this.load<Record<string, RawFoods[string] & { name: string; displayName?: string }>>('foods.json')
      entries = Object.values(foods).map((f) => ({
        kind,
        name: f.name,
        displayName: f.displayName ?? this.displayNameOf('item', f.name) ?? f.name,
        facts: {
          foodPoints: f.foodPoints,
          saturation: f.saturation,
          stackSize: f.stackSize
        }
      }))
    } else {
      const file = KIND_FILES[kind]
      const rows = this.load<RawSimple[]>(file)
      entries = rows.map((r) => ({
        kind,
        name: r.name,
        displayName: r.displayName ?? r.name,
        facts: Object.fromEntries(
          Object.entries(r).filter(([k]) => !['id', 'name', 'displayName'].includes(k))
        )
      }))
    }

    const zh = this.zhMap()
    for (const e of entries) {
      const z = zh[`${kind}:${e.name}`]
      if (z) e.zhName = z
    }
    this.cache.set(key, entries)
    return entries
  }

  /** 从 language.json 反查某类条目的英文显示名（foods 用） */
  private displayNameOf(kind: McDataKind, name: string): string | undefined {
    const lang = this.load<RawLanguage>('language.json')
    return lang[`${kind}.minecraft.${name}`]
  }

  /**
   * 模糊查询：支持注册名（diamond_ore）、英文（Diamond Ore）、中文别名（钻石矿）。
   * kinds 省略时全类检索；按相关度排序返回前 limit 条。
   */
  lookup(
    query: string,
    kinds?: McDataKind[],
    limit = 8
  ): { entries: McDataEntry[]; degraded?: string } {
    const q = query.trim().toLowerCase()
    if (!q) return { entries: [] }
    const targets = kinds && kinds.length > 0 ? kinds : (Object.keys(KIND_FILES) as McDataKind[])
    const scored: Array<{ e: McDataEntry; s: number }> = []
    for (const kind of targets) {
      let rows: McDataEntry[]
      try {
        rows = this.entriesOf(kind)
      } catch {
        continue
      }
      for (const e of rows) {
        const s = scoreMatch(q, e)
        if (s > 0) scored.push({ e, s })
      }
    }
    scored.sort((a, b) => b.s - a.s)
    return { entries: scored.slice(0, Math.max(1, Math.min(30, limit))).map((x) => x.e) }
  }

  /** 按注册名精确取条目（跨类，item/block 同名时优先指定 kind） */
  resolve(name: string, kind?: McDataKind): McDataEntry | null {
    const n = name.replace(/^minecraft:/, '').toLowerCase()
    const kinds = kind ? [kind] : (Object.keys(KIND_FILES) as McDataKind[])
    for (const k of kinds) {
      const hit = this.entriesOf(k).find((e) => e.name === n)
      if (hit) return hit
    }
    return null
  }

  /** 查产物配方（输入注册名或中文名），解析成分为注册名；精确匹配优先排序 */
  recipes(outputQuery: string, limit = 5): McRecipeResult[] {
    const all = this.load<RawRecipes>('recipes.json')
    // 数字键（item id）→ 注册名
    const entries = Object.entries(all)
      .map(([id, list]) => ({ name: this.itemName(Number(id)), list }))
      .filter((r) => r.name !== `item#${NaN}`)
    const q = outputQuery.trim().toLowerCase()
    const nameOf = (n: string): string => this.languageName(n)?.toLowerCase() ?? ''
    const zhOfAny = (n: string): string =>
      this.zhOf('item', n) ?? this.zhOf('block', n) ?? ''
    // 0=注册名/中文/英文精确，1=前缀，2=子串
    const rankOf = (n: string): number => {
      const zh = zhOfAny(n)
      if (n === q || zh === q || nameOf(n) === q) return 0
      if (n.startsWith(q) || zh.startsWith(q) || nameOf(n).startsWith(q)) return 1
      if (n.includes(q) || zh.includes(q) || nameOf(n).includes(q)) return 2
      return -1
    }
    const matched = entries
      .map((r) => ({ ...r, rank: rankOf(r.name) }))
      .filter((r) => r.rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, Math.max(1, limit))

    const out: McRecipeResult[] = []
    for (const m of matched) {
      for (const rec of m.list) {
        out.push(this.describeRecipe(m.name, rec))
        if (out.length >= limit) return out
      }
    }
    return out
  }

  private languageName(itemName: string): string | undefined {
    const lang = this.load<RawLanguage>('language.json')
    return lang[`item.minecraft.${itemName}`] ?? lang[`block.minecraft.${itemName}`]
  }

  private describeRecipe(output: string, rec: Record<string, unknown>): McRecipeResult {
    const result = rec.result as { count?: number; id?: number } | undefined
    const ingredients: string[] = []
    const hasShape = Array.isArray(rec.inShape)
    const type =
      String(rec.type ?? (hasShape || Array.isArray(rec.pattern) ? 'crafting_shaped' : 'crafting_shapeless'))

    const addIngredient = (raw: unknown): void => {
      if (typeof raw === 'number') {
        ingredients.push(this.itemName(raw))
      } else if (Array.isArray(raw)) {
        for (const r of raw) addIngredient(r)
      } else if (raw && typeof raw === 'object') {
        const o = raw as Record<string, unknown>
        if (typeof o.id === 'number') ingredients.push(this.itemName(o.id))
        else if (typeof o.item === 'number') ingredients.push(this.itemName(o.item))
        else if (typeof o.tag === 'string') ingredients.push(`#${o.tag}`)
      }
    }

    if (Array.isArray(rec.ingredients)) rec.ingredients.forEach(addIngredient)
    if (hasShape) {
      // inShape 是行×列二维数组（[[a],[b]]），flatten 后逐个解析
      for (const row of rec.inShape as unknown[][]) {
        if (Array.isArray(row)) row.forEach(addIngredient)
        else addIngredient(row)
      }
    }
    if (rec.ingredient) addIngredient(rec.ingredient)

    return {
      output,
      count: result?.count ?? 1,
      type: type.replace('minecraft:', ''),
      ingredients: [...new Set(ingredients)],
      ...(Array.isArray(rec.pattern) ? { pattern: rec.pattern as string[] } : {})
    }
  }
}

/** 匹配评分：注册名精确 100 / 英文全称 90 / 中文全称 90 / 前缀 60 / 子串 30 */
function scoreMatch(q: string, e: McDataEntry): number {
  if (e.name === q) return 100
  const dn = e.displayName.toLowerCase()
  if (dn === q) return 90
  if (e.zhName === q) return 90
  if (e.name.startsWith(q)) return 60
  if (dn.startsWith(q)) return 50
  if (e.zhName?.startsWith(q)) return 55
  if (e.name.includes(q)) return 30
  if (dn.includes(q)) return 25
  if (e.zhName?.includes(q)) return 35
  // 去空格/下划线宽松匹配（diamond ore ↔ diamondore）
  const loose = (s: string) => s.replace(/[\s_]/g, '')
  const lq = loose(q)
  if (lq.length >= 3) {
    if (loose(e.name).includes(lq)) return 20
    if (loose(dn).includes(lq)) return 15
  }
  return 0
}

/** dev：resources/mcdata；prod：process.resourcesPath/mcdata（electron-builder extraResources） */
export function defaultMcDataRoot(): string {
  // app 仅在 electron 主进程可用；测试/工具环境回退 cwd
  try {
    const { app } = require('electron') as typeof import('electron')
    if (isPackagedRuntime(app)) return join(process.resourcesPath, 'mcdata')
  } catch {
    /* 非 electron 环境 */
  }
  return join(process.cwd(), 'resources', 'mcdata')
}

let singleton: McDataService | null = null

/** 懒单例（工具注册表全局复用） */
export function getMcDataService(): McDataService {
  if (!singleton) singleton = new McDataService()
  return singleton
}
