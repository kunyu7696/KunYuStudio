<template>
  <el-dialog
    :model-value="open"
    :title="t('performance.wizard.title')"
    width="620px"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:open', v)"
    @close="reset"
  >
    <el-steps :active="stepIndex" align-center class="ow-steps" finish-status="success">
      <el-step :title="t('performance.wizard.stepPick')" />
      <el-step :title="t('performance.wizard.stepPreview')" />
      <el-step :title="t('performance.wizard.stepResult')" />
    </el-steps>

    <!-- 1 选择 -->
    <div v-if="step === 'pick'">
      <el-empty
        v-if="selectable.length === 0"
        :description="t('performance.wizard.empty')"
        :image-size="70"
      />
      <div v-else class="ow-list">
        <label v-for="item in selectable" :key="item.advice.id" class="ow-item">
          <el-checkbox
            :model-value="picked.has(item.advice.id)"
            @change="toggle(item.advice.id)"
          />
          <div class="ow-item-body">
            <div class="ow-item-line">
              <span class="pv-adv-sev" :class="item.advice.severity">{{ item.advice.severity }}</span>
              <span class="ow-rule">{{ item.advice.ruleId }}</span>
              <span class="ow-kind" :class="item.action.kind">
                {{ item.action.kind === 'remove' ? t('performance.wizard.kindRemove') : t('performance.wizard.kindDisable') }}
              </span>
              {{ item.advice.message }}
            </div>
            <div class="ow-target">{{ t('performance.wizard.target', { target: item.action.target }) }}</div>
          </div>
        </label>
      </div>
    </div>

    <!-- 2 预览 -->
    <div v-else-if="step === 'preview'" class="ow-preview">
      <el-alert type="warning" :closable="false" class="ow-warn">
        {{ t('performance.wizard.previewWarn') }}
      </el-alert>
      <div class="ow-roots">
        <div>mods：{{ roots.modsRoot }}</div>
        <div>config：{{ roots.configRoot }}</div>
      </div>
      <ul class="ow-effects">
        <li v-for="line in previewLines" :key="line.target + line.kind">
          <span class="ow-effect-kind" :class="line.kind">{{ line.kind }}</span>
          {{ line.effect }}
        </li>
      </ul>
    </div>

    <!-- 3 回执 -->
    <div v-else class="ow-result">
      <div class="ow-summary">
        {{ t('performance.wizard.summary', {
          done: countStatus('done'),
          skipped: countStatus('skipped'),
          rejected: countStatus('rejected')
        }) }}
      </div>
      <ul class="ow-effects">
        <li v-for="r in receipts" :key="r.target + r.kind">
          <span class="ow-receipt" :class="r.status">{{ statusText(r.status) }}</span>
          <span class="ow-effect-kind" :class="r.kind">{{ r.kind }}</span>
          {{ r.target }} — {{ r.detail }}
        </li>
      </ul>
    </div>

    <template #footer>
      <el-button @click="emit('update:open', false)">
        {{ step === 'result' ? t('performance.wizard.close') : t('performance.wizard.cancel') }}
      </el-button>
      <el-button v-if="step === 'preview'" @click="step = 'pick'">{{ t('performance.wizard.prev') }}</el-button>
      <el-button
        v-if="step === 'pick'"
        type="primary"
        :disabled="picked.size === 0"
        @click="step = 'preview'"
      >
        {{ t('performance.wizard.next') }}
      </el-button>
      <el-button
        v-if="step === 'preview'"
        type="primary"
        :loading="running"
        @click="confirmAndRun"
      >
        {{ t('performance.wizard.run') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type {
  ActionReceipt,
  ModPerformanceProfile
} from '../../../../shared/schemas/performance/profile'
import {
  previewActions,
  selectableAdvices,
  type SelectableAdvice
} from './optimizePlan'
import { t } from '../../i18n'

type Step = 'pick' | 'preview' | 'result'

const props = defineProps<{
  open: boolean
  profile: ModPerformanceProfile | null
  roots: { modsRoot: string; configRoot: string }
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'applied', receipts: ActionReceipt[]): void
}>()

const step = ref<Step>('pick')
const picked = ref<Set<string>>(new Set())
const receipts = ref<ActionReceipt[]>([])
const running = ref(false)

const selectable = computed<SelectableAdvice[]>(() => {
  if (!props.profile) return []
  return selectableAdvices(props.profile.identity, props.profile.advice)
})

const pickedActions = computed(() =>
  selectable.value
    .filter((item) => picked.value.has(item.advice.id))
    .map((item) => item.action)
)

const previewLines = computed(() => previewActions(pickedActions.value))

const stepIndex = computed(() =>
  step.value === 'pick' ? 0 : step.value === 'preview' ? 1 : 2
)

function toggle(id: string): void {
  const next = new Set(picked.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  picked.value = next
}

function countStatus(s: ActionReceipt['status']): number {
  return receipts.value.filter((r) => r.status === s).length
}

function statusText(s: ActionReceipt['status']): string {
  return t(`performance.wizard.status.${s}`)
}

async function confirmAndRun(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('performance.wizard.confirmBody', { n: pickedActions.value.length }),
      t('performance.wizard.confirmTitle'),
      {
        confirmButtonText: t('performance.wizard.confirmRun'),
        cancelButtonText: t('performance.wizard.confirmBack'),
        type: 'warning'
      }
    )
  } catch {
    return
  }
  running.value = true
  try {
    receipts.value = await window.api.profile.applyActions({
      modsRoot: props.roots.modsRoot,
      configRoot: props.roots.configRoot,
      actions: pickedActions.value
    })
    step.value = 'result'
    emit('applied', receipts.value)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : String(err))
  } finally {
    running.value = false
  }
}

function reset(): void {
  step.value = 'pick'
  receipts.value = []
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      reset()
      picked.value = new Set(selectable.value.map((item) => item.advice.id))
    }
  }
)
</script>

<style scoped>
.ow-steps {
  margin-bottom: 18px;
}
.ow-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 340px;
  overflow-y: auto;
}
.ow-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px;
  border: 1px solid var(--ky-border);
  border-radius: var(--ky-radius-control);
  cursor: pointer;
}
.ow-item:hover {
  background: var(--ky-bg-hover);
}
.ow-item-body {
  flex: 1;
}
.ow-item-line {
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ow-rule {
  font-family: var(--ky-font-mono);
  font-size: 11px;
  color: var(--ky-text-dim);
}
.pv-adv-sev {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}
.pv-adv-sev.low {
  color: var(--ky-blue);
}
.pv-adv-sev.medium {
  color: var(--ky-yellow);
}
.pv-adv-sev.high {
  color: var(--ky-red);
}
.pv-adv-sev.critical {
  color: var(--ky-red);
  background: rgba(248, 113, 113, 0.18);
  border-radius: 4px;
}
.ow-kind {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}
.ow-kind.disable {
  color: var(--ky-yellow);
  background: rgba(251, 191, 36, 0.12);
}
.ow-kind.remove {
  color: var(--ky-red);
  background: rgba(248, 113, 113, 0.14);
}
.ow-kind.config {
  color: var(--ky-blue);
  background: rgba(56, 189, 248, 0.12);
}
.ow-target {
  font-family: var(--ky-font-mono);
  font-size: 11px;
  color: var(--ky-text-dim);
  margin-top: 4px;
}
.ow-warn {
  margin-bottom: 10px;
}
.ow-roots {
  font-family: var(--ky-font-mono);
  font-size: 11px;
  color: var(--ky-text-dim);
  margin-bottom: 12px;
}
.ow-effects {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ow-effects li {
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.ow-effect-kind {
  font-family: var(--ky-font-mono);
  font-size: 11px;
  text-transform: uppercase;
  width: 56px;
}
.ow-effect-kind.disable {
  color: var(--ky-yellow);
}
.ow-effect-kind.remove {
  color: var(--ky-red);
}
.ow-effect-kind.config {
  color: var(--ky-blue);
}
.ow-summary {
  font-weight: 600;
  margin-bottom: 12px;
}
.ow-receipt {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}
.ow-receipt.done {
  color: var(--ky-accent);
}
.ow-receipt.skipped {
  color: var(--ky-text-dim);
}
.ow-receipt.rejected {
  color: var(--ky-red);
}
</style>
