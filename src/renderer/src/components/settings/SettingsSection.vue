<template>
  <!-- 设置分组：小标题在卡片外，卡片承载若干 SettingsRow -->
  <section class="settings-section">
    <h3 class="ss-title">{{ title }}</h3>
    <div class="ss-card">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<style scoped>
.settings-section {
  margin-bottom: 20px;
}

.ss-title {
  margin: 0 0 8px 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
}

.ss-card {
  background: var(--ky-bg-panel);
  border: 1px solid var(--ky-border);
  border-radius: 10px;
  padding: 2px 14px;
}
</style>
