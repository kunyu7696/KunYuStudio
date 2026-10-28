<template>
  <!-- 设置项行：左 label/desc 右控件；行间隔线不穿通、末行无线。
       data-setting-id 等 attrs 透传到根元素，供设置搜索定位高亮。 -->
  <div class="settings-row">
    <div class="sr-text">
      <div class="sr-label">{{ label }}</div>
      <div v-if="desc" class="sr-desc">{{ desc }}</div>
    </div>
    <div class="sr-control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string; desc?: string }>()
</script>

<style scoped>
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 12px 0;
}

.settings-row:not(:last-child) {
  border-bottom: 1px solid var(--ky-border);
}

/* 文字列保底宽度：控件过宽放不下时换行，label/desc 始终横排（防挤压成竖排） */
.sr-text {
  flex: 1 1 240px;
  min-width: 200px;
}

.sr-label {
  font-size: 13px;
  color: var(--ky-text);
}

.sr-desc {
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ky-text-dim);
}

.sr-control {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}
</style>
