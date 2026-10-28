<template>
  <div class="uev-recipes">
    <div v-for="(r, ri) in recipes" :key="ri" class="uev-recipe">
      <div class="uev-recipe-head">
        <el-radio-group
          :model-value="r.kind"
          size="small"
          @change="(k) => setRecipeKind(r, k as RecipeKind)"
        >
          <el-radio-button value="crafting_shaped">{{ t('unified.recipe.shaped') }}</el-radio-button>
          <el-radio-button value="crafting_shapeless">{{ t('unified.recipe.shapeless') }}</el-radio-button>
          <el-radio-button value="smelting">{{ t('unified.recipe.smelting') }}</el-radio-button>
        </el-radio-group>
        <el-button size="small" text @click="removeRecipe(ri)">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
      <el-input v-model="r.id" size="small" class="uev-recipe-id" :placeholder="t('unified.recipe.idPlaceholder')" />

      <CraftingGrid
        v-if="r.kind === 'crafting_shaped'"
        mode="shaped"
        :grid="shapedGrid(r)"
        :namespace="ns"
        @update:grid="(g) => applyShapedGrid(r, g)"
      />
      <CraftingGrid
        v-else-if="r.kind === 'crafting_shapeless'"
        mode="shapeless"
        :ingredients="r.ingredients ?? []"
        :namespace="ns"
        @update:ingredients="(list) => (r.ingredients = list.map((v) => ({ item: v.item })))"
      />
      <CraftingGrid
        v-else
        mode="smelting"
        :input="r.input ?? ''"
        :experience="r.experience ?? 0"
        :cooking-time="r.cookingTime ?? 200"
        :namespace="ns"
        @update:input="(v) => (r.input = v)"
        @update:experience="(v) => (r.experience = v)"
        @update:cooking-time="(v) => (r.cookingTime = v)"
      />

      <div class="uev-recipe-result">
        <span class="uev-recipe-label">{{ t('unified.recipe.result') }}</span>
        <el-input v-model="r.result.item" size="small" class="uev-recipe-item" :placeholder="t('unified.recipe.resultPlaceholder')" />
        <el-input-number v-model="r.result.count" :min="1" size="small" :disabled="r.kind === 'smelting'" />
      </div>
    </div>

    <el-button size="small" @click="addRecipe">
      <el-icon class="uev-btn-icon"><Plus /></el-icon>{{ t('unified.recipe.add') }}
    </el-button>
  </div>
</template>

<script setup lang="ts">
/**
 * RecipePane：对应配方编辑分段（从 UnifiedEditorView 抽出，逻辑零改动）。
 * 通过 useRecipes 直接读写 unified store，无 props/emits。
 */
import { computed } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useProjectStore } from '../../../stores/project'
import CraftingGrid from '../../../components/visual/recipe/CraftingGrid.vue'
import type { RecipeKind } from '../../../../../shared/schemas/recipe.schema'
import { useRecipes } from '../composables/useRecipes'
import { t } from '../../../i18n'

const projectStore = useProjectStore()
const ns = computed(() => projectStore.currentProject?.namespace || 'mymod')

const { recipes, addRecipe, removeRecipe, setRecipeKind, shapedGrid, applyShapedGrid } = useRecipes()
</script>

<style scoped>
/* 对应配方编辑 */
.uev-recipes {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
}
.uev-recipe {
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--ky-bg);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.uev-recipe-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.uev-recipe-id {
  width: 100%;
}
.uev-recipe-result {
  display: flex;
  align-items: center;
  gap: 6px;
}
.uev-recipe-label {
  font-size: 11px;
  color: var(--ky-text-sub);
  flex-shrink: 0;
}
.uev-recipe-item {
  flex: 1;
  min-width: 0;
}
.uev-btn-icon {
  margin-right: 3px;
}
</style>
