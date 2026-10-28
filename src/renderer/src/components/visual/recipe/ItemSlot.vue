<template>
  <button
    class="recipe-slot"
    :class="{ filled: !!item }"
    :title="item ? `${item}${count && count > 1 ? ' ×' + count : ''}` : t('itemSlot.pickTitle')"
    @click="$emit('pick')"
    @contextmenu.prevent="$emit('clear')"
  >
    <span v-if="!item" class="recipe-slot-plus">+</span>
    <template v-else>
      <span class="recipe-slot-item">{{ shortLabel }}</span>
      <span v-if="count && count > 1" class="recipe-slot-count">{{ count }}</span>
    </template>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../../../i18n'

const props = withDefaults(
  defineProps<{
    /** 物品引用 ID，如 minecraft:iron_ingot 或 :iron_ingot（冒号前缀表示模组命名空间下的物品） */
    item: string
    count?: number
  }>(),
  { count: 1 }
)

defineEmits<{
  (e: 'pick'): void
  (e: 'clear'): void
}>()

/** 简短显示：取最后一段 + 下划线替换为空格，最多 8 字 */
const shortLabel = computed(() => {
  const last = props.item.split(':').pop() ?? props.item
  const words = last.replace(/_/g, ' ').split(' ')
  // 取首字母连写（iron_ingot → II）
  return words.map((w) => (w ? w[0]?.toUpperCase() ?? '' : '')).join('') || '?'
})
</script>

<style scoped>
.recipe-slot {
  width: 40px;
  height: 40px;
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.08);
  color: var(--ky-text-dim);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: border-color 0.15s, background 0.15s;
  padding: 0;
}
.recipe-slot:hover {
  border-color: var(--ky-accent, #89b4fa);
  background: rgba(127, 127, 127, 0.16);
}
.recipe-slot.filled {
  background: rgba(137, 180, 250, 0.08);
  color: var(--ky-text);
  font-weight: 600;
  font-size: 12px;
}
.recipe-slot-plus {
  opacity: 0.4;
}
.recipe-slot-item {
  line-height: 1;
}
.recipe-slot-count {
  position: absolute;
  bottom: 1px;
  right: 2px;
  font-size: 10px;
  font-weight: 600;
  color: var(--ky-accent, #89b4fa);
  line-height: 1;
}
</style>
