<template>
  <el-dialog v-model="visible" :title="t('legacyImport.title')" width="560px" append-to-body @close="onClose">
    <div class="lid-body">
      <p class="lid-intro">
        {{ t('legacyImport.introLead') }}<strong>{{ t('legacyImport.introStrong') }}</strong>{{ t('legacyImport.introTail') }}
      </p>

      <div v-for="group in groups" :key="group.loader" class="lid-group">
        <p class="lid-group-title">{{ group.label }}</p>
        <div v-if="group.cells.length" class="lid-grid">
          <el-tooltip
            v-for="cell in group.cells"
            :key="cell.id"
            :content="tooltipOf(cell)"
            placement="top"
          >
            <div class="lid-cell">
              <span class="lid-cell-top">
                <span class="lid-mc">{{ cell.mcVersion }}</span>
                <span class="lid-badge">{{ t('legacyImport.badge') }}</span>
              </span>
              <span class="lid-loader">{{ cell.loaderVersion }}</span>
              <span class="lid-meta">{{ t('legacyImport.meta', { n: cell.templateCount }) }}</span>
            </div>
          </el-tooltip>
        </div>
        <p v-else class="lid-empty">{{ t('legacyImport.empty') }}</p>
      </div>
    </div>

    <template #footer>
      <el-button @click="onClose">{{ t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="importing" @click="onPickAndImport">
        {{ t('legacyImport.pickImport') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useAiMonitorStore } from '../../stores/aiMonitor'
import { useProjectStore } from '../../stores/project'
import type { ComboMatrixCell } from '../../../../shared/types/monitor'
import type { LoaderId } from '../../../../shared/types/aiReference'
import { t } from '../../i18n'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'imported', name: string): void
}>()

const monitor = useAiMonitorStore()
const projectStore = useProjectStore()
const importing = ref(false)

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    // 确保版本矩阵就绪，失败时仅显示已登记的遗留组合
    await monitor.init().catch(() => undefined)
  }
)

const LOADER_ORDER: Array<{ loader: LoaderId; label: string }> = [
  { loader: 'fabric', label: 'Fabric' },
  { loader: 'forge', label: 'Forge' },
  { loader: 'neoforge', label: 'NeoForge' }
]

const groups = computed(() =>
  LOADER_ORDER.map((g) => ({
    loader: g.loader,
    label: g.label,
    cells: (monitor.monitor?.cells ?? []).filter(
      (c) => c.loader === g.loader && c.tier === 'legacy' && c.health !== 'deprecated'
    )
  }))
)

function tooltipOf(cell: ComboMatrixCell): string {
  return t('legacyImport.tooltip', { combo: `${cell.loader}-${cell.mcVersion}` })
}

async function onPickAndImport(): Promise<void> {
  const dir = await window.api.dialog.selectDirectory()
  if (!dir) return
  importing.value = true
  try {
    const project = await projectStore.importProject(dir)
    ElMessage.success(t('legacyImport.imported', { name: project.name }))
    emit('imported', project.name)
    visible.value = false
  } catch (err) {
    ElMessage.error(t('legacyImport.importFailed', { message: (err as Error).message }))
  } finally {
    importing.value = false
  }
}

function onClose(): void {
  visible.value = false
}
</script>

<style scoped>
.lid-body {
  padding: 4px 2px 0;
}

.lid-intro {
  margin: 0 0 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--ky-text-sub);
}

.lid-group {
  margin-top: 8px;
}

.lid-group-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-text-sub);
}

.lid-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.lid-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px dashed var(--ky-border);
  background: var(--ky-bg-panel);
  cursor: default;
}

.lid-cell-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lid-mc {
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
}

.lid-badge {
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 15px;
  font-weight: 600;
  background: rgba(249, 226, 175, 0.18);
  color: #f9e2af;
}

.lid-loader {
  font-size: 11px;
  color: var(--ky-text-sub);
}

.lid-meta {
  font-size: 10px;
  color: var(--ky-text-dim);
}

.lid-empty {
  margin: 0;
  font-size: 11px;
  color: var(--ky-text-dim);
}
</style>
