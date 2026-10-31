<template>
  <!-- ===== 生物群系 / 进度：无 3D 预览，展示数据包说明 ===== -->
  <main class="uev-stage">
    <div class="uev-dp-preview">
      <el-icon :size="40" color="var(--ky-text-dim)"><Files /></el-icon>
      <h3>{{ t('unified.dpPreview.title', { kind: t(kindKey) }) }}</h3>
      <p>
        {{ active.type === 'enchantment' ? t('unified.dpPreview.enchDesc') : t('unified.dpPreview.desc') }}
      </p>
      <p v-if="active.type === 'enchantment'" class="uev-dp-path">
        {{ t('unified.dpPreview.enchPathJava') }}<br />
        {{ t('unified.dpPreview.enchPathData', { ns, id: active.id }) }}
      </p>
      <p v-else-if="active.type === 'tag'" class="uev-dp-path">
        {{ t('unified.dpPreview.tagPath', { ns, registry: tagDir, id: active.id }) }}
      </p>
      <p v-else class="uev-dp-path">
        {{ active.type === 'biome'
          ? t('unified.dpPreview.biomePath', { ns, id: active.id })
          : t('unified.dpPreview.advancementPath', { ns, id: active.id }) }}
      </p>
      <p>{{ active.type === 'enchantment' ? t('unified.dpPreview.enchNote') : t('unified.dpPreview.note') }}</p>
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
import { tagRegistryPath } from '../../../../../shared/dataPath'

const projectStore = useProjectStore()
const store = useUnifiedStore()

const ns = computed(() => projectStore.currentProject?.namespace || 'mymod')

/** 本组件仅在存在活动对象时渲染（父级 v-if/v-else 保证），模板内直接取值 */
const active = computed(() => store.active!)

/** 标签产物目录段（1.20.x 复数 / 1.21+ 单数，统一由 tagRegistryPath 推导） */
const tagDir = computed(() => {
  const registry = active.value.data.tags?.[0]?.registry ?? 'item'
  return tagRegistryPath(registry, projectStore.currentProject?.mcVersion || '1.20.1')
})

/** 标题按对象类型取对应 kind 键（biome / advancement / tag / enchantment） */
const kindKey = computed(() =>
  active.value.type === 'biome'
    ? 'unified.kind.biome'
    : active.value.type === 'advancement'
      ? 'unified.kind.advancement'
      : active.value.type === 'tag'
        ? 'unified.kind.tag'
        : 'unified.kind.enchantment'
)
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
