/**
 * 配方语义 Schema（统一编辑器 P3.3）。
 *
 * 与加载器无关的可视化编辑模型，编译后产出原版
 * data/<ns>/recipes/*.json。三种最常用配方：
 * - crafting_shaped：有形状合成（pattern + key）
 * - crafting_shapeless：无序合成
 * - smelting：熔炉烧制
 *
 * 设计边界：原料仅支持物品（item），暂不支持标签（tag）原料、
 * 切石/锻造/营火等配方类型。
 */

import { isMc1205OrLater, isMc1212OrLater } from '../dataPath'
import { sharedT } from '../i18n'

export type RecipeKind = 'crafting_shaped' | 'crafting_shapeless' | 'smelting'

/** 物品引用 */
export interface RecipeStack {
  /** 物品 id：含命名空间（minecraft:stick）原样使用；不含则补当前模组命名空间 */
  item: string
}

/** 结果物品 */
export interface RecipeResultStack extends RecipeStack {
  count: number
}

/** 配方定义（语义层） */
export interface RecipeDef {
  /** 配方文件 id（相对 data/<ns>/recipes/） */
  id: string
  kind: RecipeKind

  /* ---- crafting_shaped ---- */
  /** 3 行，每行 1~3 字符，' ' 表示空槽；字符须出现在 key 中 */
  pattern?: [string, string, string]
  /** 字符 → 物品引用 */
  key?: Record<string, RecipeStack>

  /* ---- crafting_shapeless ---- */
  ingredients?: RecipeStack[]

  /* ---- smelting ---- */
  input?: string
  experience?: number
  /** ticks，默认 200（10 秒） */
  cookingTime?: number

  /* ---- 三种共有 ---- */
  result: RecipeResultStack
  group?: string
}

/* ---------------- 工厂 ---------------- */

/** 默认"合成自身"的有序配方（UI 起步用，3×3 空网格 + 结果为自身） */
export function createDefaultRecipe(selfId: string): RecipeDef {
  return {
    id: selfId,
    kind: 'crafting_shaped',
    pattern: ['   ', '   ', '   '],
    key: {},
    result: { item: selfId, count: 1 }
  }
}

/* ---------------- 编译到原版 JSON ---------------- */

function resolveItem(item: string, namespace: string): string {
  return item.includes(':') ? item : `${namespace}:${item}`
}

function keyToVanilla(
  key: Record<string, RecipeStack>,
  namespace: string,
  mcVersion?: string
): Record<string, unknown> {
  const useString = mcVersion ? isMc1212OrLater(mcVersion) : false
  const out: Record<string, unknown> = {}
  for (const [ch, v] of Object.entries(key)) {
    const resolved = resolveItem(v.item, namespace)
    // P0-7：ingredient/key 在 1.21.2（24w33a）前始终是 {"item":…} 对象，
    // 1.20.5 只把 crafting result 的 item 改名为 id，ingredient 不跟随
    out[ch] = useString ? resolved : { item: resolved }
  }
  return out
}

/**
 * 编译为原版配方 JSON 对象。
 * @param def       语义定义
 * @param namespace 不含命名空间的物品 id 补此前缀（通常为 mod id）
 * @param mcVersion 目标 MC 版本，决定两处格式差异（经 mcmeta 官方镜像原版数据核实）：
 *   - 1.20.5+：仅 crafting result 的 item 字段改名为 id；ingredient/key 保持 {"item":…}
 *   - 1.21.2+：ingredient/key/ingredients 的对象形式失效，改为纯字符串（result 仍为 {id,count}）
 *   - cookingtime 全版本统一（one word，非 cooking_time）
 *   缺省 mcVersion 按 1.20.x 口径输出（item 字段 + 对象形式）
 */
export function compileRecipe(
  def: RecipeDef,
  namespace: string,
  mcVersion?: string
): Record<string, unknown> {
  const useId = mcVersion ? isMc1205OrLater(mcVersion) : false
  const useString = mcVersion ? isMc1212OrLater(mcVersion) : false
  const resultKey = useId ? 'id' : 'item'

  if (def.kind === 'crafting_shaped') {
    return {
      type: 'minecraft:crafting_shaped',
      ...(def.group ? { group: def.group } : {}),
      pattern: def.pattern ?? ['   ', '   ', '   '],
      key: keyToVanilla(def.key ?? {}, namespace, mcVersion),
      result: {
        [resultKey]: resolveItem(def.result.item, namespace),
        count: Math.max(1, Math.floor(def.result.count))
      }
    }
  }

  if (def.kind === 'crafting_shapeless') {
    const ingredients = useString
      ? (def.ingredients ?? []).map((v) => resolveItem(v.item, namespace))
      : (def.ingredients ?? []).map((v) => ({ item: resolveItem(v.item, namespace) }))
    return {
      type: 'minecraft:crafting_shapeless',
      ...(def.group ? { group: def.group } : {}),
      ingredients,
      result: {
        [resultKey]: resolveItem(def.result.item, namespace),
        count: Math.max(1, Math.floor(def.result.count))
      }
    }
  }

  // smelting：result 全版本为纯字符串 id；ingredient 1.21.2 前为 {"item":…} 对象
  const inputResolved = resolveItem(def.input ?? '', namespace)
  const ingredient = useString ? inputResolved : { item: inputResolved }
  return {
    type: 'minecraft:smelting',
    ...(def.group ? { group: def.group } : {}),
    ingredient,
    result: resolveItem(def.result.item, namespace),
    experience: Math.max(0, def.experience ?? 0),
    cookingtime: Math.max(1, Math.floor(def.cookingTime ?? 200))
  }
}

/* ---------------- 校验 ---------------- */

/** 轻量校验，返回首条错误信息；合法返回 null */
export function validateRecipe(def: RecipeDef): string | null {
  if (!def.id.trim() || !/^[a-z][a-z0-9_]{0,63}$/.test(def.id.trim())) {
    return sharedT('schema.recipe.errIdInvalid')
  }
  if (!def.result.item.trim()) {
    return sharedT('schema.recipe.errResultRequired')
  }

  if (def.kind === 'crafting_shaped') {
    const pattern = def.pattern ?? ['   ', '   ', '   ']
    if (pattern.some((row) => row.length > 3)) {
      return sharedT('schema.recipe.errRowLength')
    }
    const usedChars = new Set<string>()
    for (const row of pattern) {
      for (const ch of row) {
        if (ch !== ' ') usedChars.add(ch)
      }
    }
    if (usedChars.size === 0) {
      return sharedT('schema.recipe.errGridRequired')
    }
    for (const ch of usedChars) {
      const mapped = def.key?.[ch]
      if (!mapped || !mapped.item.trim()) {
        return sharedT('schema.recipe.errKeyUnmapped', { ch })
      }
    }
  } else if (def.kind === 'crafting_shapeless') {
    const ings = def.ingredients ?? []
    if (ings.length === 0) {
      return sharedT('schema.recipe.errIngredientsRequired')
    }
    if (ings.some((v) => !v.item.trim())) {
      return sharedT('schema.recipe.errIngredientEmpty')
    }
  } else {
    if (!def.input?.trim()) {
      return sharedT('schema.recipe.errInputRequired')
    }
  }
  return null
}
