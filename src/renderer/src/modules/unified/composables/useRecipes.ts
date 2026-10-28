/**
 * useRecipes：配方可视化编辑。
 * 从 UnifiedEditorView 抽出，逻辑零改动。
 */
import { computed } from 'vue'
import { useUnifiedStore } from '../../../stores/unified'
import type { RecipeIngredient } from '../../../../../shared/types/content'
import { createDefaultRecipe } from '../../../../../shared/schemas/recipe.schema'
import type { RecipeDef, RecipeKind, RecipeStack } from '../../../../../shared/schemas/recipe.schema'

export function useRecipes() {
  const store = useUnifiedStore()

  /* ================================================================== */
  /* 配方可视化编辑                                                        */
  /* ================================================================== */

  /** 当前对象的配方列表 */
  const recipes = computed<RecipeDef[]>(() => store.active?.data.recipes ?? [])

  /** 添加配方：默认有序合成，结果为自身 */
  function addRecipe(): void {
    const u = store.active
    if (!u) return
    if (!Array.isArray(u.data.recipes)) u.data.recipes = []
    u.data.recipes.push(createDefaultRecipe(u.id))
  }

  /** 删除配方 */
  function removeRecipe(ri: number): void {
    const list = store.active?.data.recipes
    if (!list) return
    list.splice(ri, 1)
  }

  /** 切换配方类型，初始化新类型所需字段 */
  function setRecipeKind(r: RecipeDef, k: RecipeKind): void {
    if (r.kind === k) return
    r.kind = k
    if (k === 'crafting_shaped' && !r.pattern) {
      r.pattern = ['   ', '   ', '   ']
      r.key = {}
    } else if (k === 'crafting_shapeless' && !Array.isArray(r.ingredients)) {
      r.ingredients = []
    } else if (k === 'smelting') {
      if (typeof r.experience !== 'number') r.experience = 0
      if (typeof r.cookingTime !== 'number') r.cookingTime = 200
      r.input = r.input ?? ''
    }
  }

  /** RecipeDef 的 pattern/key → CraftingGrid 的 3×3 物品网格 */
  function shapedGrid(r: RecipeDef): (RecipeIngredient | null)[][] {
    const empty: (RecipeIngredient | null)[][] = [
      [null, null, null],
      [null, null, null],
      [null, null, null]
    ]
    if (r.pattern && r.key) {
      for (let row = 0; row < 3; row++) {
        const line: string = r.pattern[row] ?? '   '
        for (let c = 0; c < 3; c++) {
          const ch = line[c] ?? ' '
          if (ch !== ' ' && r.key[ch]) empty[row][c] = { item: r.key[ch].item }
        }
      }
    }
    return empty
  }

  /** CraftingGrid 网格 → RecipeDef 的 pattern/key（同物品复用同一字符） */
  function applyShapedGrid(r: RecipeDef, grid: (RecipeIngredient | null)[][]): void {
    const rows: string[] = []
    const key: Record<string, RecipeStack> = {}
    let next = 65 // 'A'
    for (const row of grid) {
      let line = ''
      for (const cell of row) {
        if (!cell) {
          line += ' '
          continue
        }
        const existing = Object.entries(key).find(([, v]) => v.item === cell.item)
        if (existing) {
          line += existing[0]
        } else {
          const ch = String.fromCharCode(next++)
          key[ch] = { item: cell.item }
          line += ch
        }
      }
      rows.push(line)
    }
    r.pattern = rows as [string, string, string]
    r.key = key
  }

  return { recipes, addRecipe, removeRecipe, setRecipeKind, shapedGrid, applyShapedGrid }
}
