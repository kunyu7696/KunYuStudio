<template>
  <div class="imt">
    <p class="imt-desc">
      {{ t('resourcepack.itemModel.descBefore') }}
      <code>model</code> {{ t('resourcepack.itemModel.descAfter') }}
    </p>
    <ItemModelNode :model-value="rootDef" :depth="0" @update:model-value="onRootUpdate" />
  </div>
</template>

<script setup lang="ts">
/**
 * ItemModelTreeEditor：物品模型定义（assets/<ns>/items/*.json）树形编辑器。
 * 作为 PackDualEditor 的自定义表单渲染器：契约同 SchemaForm
 * （modelValue 为整个表单值对象，编辑其中 model 键，其余键透传保留）。
 */
import { computed } from 'vue'
import type { ItemModelDefinition } from '../../../../../shared/schemas/resourcepack/itemModel'
import {
  createItemModelDefinition,
  isItemModelDefinition
} from '../../../../../shared/schemas/resourcepack/itemModel'
import ItemModelNode from './ItemModelNode.vue'
import { t } from '../../../i18n'

const props = defineProps<{
  modelValue?: Record<string, unknown>
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: Record<string, unknown>): void }>()

const rootDef = computed<ItemModelDefinition>(() => {
  const m = props.modelValue?.model
  return isItemModelDefinition(m) ? m : createItemModelDefinition('minecraft:model')
})

function onRootUpdate(v: ItemModelDefinition): void {
  emit('update:modelValue', { ...(props.modelValue ?? {}), model: v })
}
</script>

<style scoped>
.imt {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.imt-desc {
  margin: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  opacity: 0.85;
  line-height: 1.5;
}
</style>
