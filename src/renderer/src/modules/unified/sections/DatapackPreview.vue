<template>
  <!-- ===== 生物群系 / 进度：无 3D 预览，展示数据包说明 ===== -->
  <main class="uev-stage">
    <div class="uev-dp-preview">
      <el-icon :size="40" color="var(--ky-text-dim)"><Files /></el-icon>
      <h3>{{ t('unified.dpPreview.title', { kind: t(active.type === 'biome' ? 'unified.kind.biome' : 'unified.kind.advancement') }) }}</h3>
      <p>
        {{ t('unified.dpPreview.desc') }}
      </p>
      <p class="uev-dp-path">
        {{ active.type === 'biome'
          ? t('unified.dpPreview.biomePath', { ns, id: active.id })
          : t('unified.dpPreview.advancementPath', { ns, id: active.id }) }}
      </p>
      <p>{{ t('unified.dpPreview.note') }}</p>
    </div>
  </main>
</template>

<script setup lang="ts">
/**
 * DatapackPreview：生物群系 / 进度的数据包产物说明（从 UnifiedEditorView 抽出，逻辑零改动）。
 * 直接读取 store，无 props/emits。
 */
import { computed } from 'vue'
import { Files } from '@element-plus/icons-vue'
import { useProjectStore } from '../../../stores/project'
import { useUnifiedStore } from '../../../stores/unified'
import { t } from '../../../i18n'

const projectStore = useProjectStore()
const store = useUnifiedStore()

const ns = computed(() => projectStore.currentProject?.namespace || 'mymod')

/** 本组件仅在存在活动对象时渲染（父级 v-if/v-else 保证），模板内直接取值 */
const active = computed(() => store.active!)
</script>

<style scoped>
.uev-dp-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  padding: 32px;
  text-align: center;
  color: var(--ky-text-dim);
  font-size: 12px;
  line-height: 1.6;
}
.uev-dp-preview h3 {
  margin: 0;
  font-size: 14px;
  color: var(--ky-text);
}
.uev-dp-preview p { margin: 0; max-width: 420px; }
.uev-dp-path {
  font-family: Consolas, 'Courier New', monospace;
  color: #f9c98b;
  background: rgba(249, 201, 139, 0.08);
  padding: 6px 10px;
  border-radius: 4px;
}
</style>
