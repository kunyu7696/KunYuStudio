<template>
  <main class="content-area">
    <Suspense v-if="viewComponent">
      <template #default>
        <component :is="viewComponent" :key="ui.activeModuleId" />
      </template>
      <template #fallback>
        <div class="ca-loading">
          <el-icon class="is-loading" :size="22"><Loading /></el-icon>
          <span>{{ t('palette.contentLoading') }}</span>
        </div>
      </template>
    </Suspense>
  </main>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, type Component } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import { moduleRegistry, type KunYuModule } from '../../modules'
import { useUiStore } from '../../stores/ui'
import { t } from '../../i18n'

const ui = useUiStore()

/** 异步组件缓存：同一模块只创建一次 AsyncComponentWrapper */
const asyncCache = new Map<string, Component>()

function resolveComponent(mod: KunYuModule | undefined): Component | undefined {
  if (!mod) return undefined
  if (mod.component) return mod.component
  if (!mod.loader) return undefined
  const cached = asyncCache.get(mod.id)
  if (cached) return cached
  const asyncComp = defineAsyncComponent(mod.loader)
  asyncCache.set(mod.id, asyncComp)
  return asyncComp
}

const viewComponent = computed(() => resolveComponent(moduleRegistry.get(ui.activeModuleId)))
</script>

<style scoped>
.content-area {
  flex: 1;
  min-width: 0;
  background: var(--ky-bg-panel);
  overflow: hidden;
}

.ca-loading {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ky-text-sub);
  font-size: 12px;
}
</style>
