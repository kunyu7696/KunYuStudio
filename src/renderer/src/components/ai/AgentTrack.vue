<template>
  <section class="agent-track" role="log" aria-live="polite" :aria-label="t('assistant.track.ariaLabel')">
    <ol class="at-nodes">
      <template v-for="(stage, idx) in shownStages" :key="stage.id">
        <!-- 连接线作为独立 flex 项，自动撑满相邻节点间距（原固定宽度在宽面板下会留缺口） -->
        <li v-if="idx > 0" class="at-link" :class="`is-${linkPhase(idx)}`" aria-hidden="true" />
        <li
          class="at-node"
          :class="[`is-${stage.phase}`, { 'is-off': stage.off }]"
        >
          <div class="at-node-btn" :aria-label="t('assistant.track.nodeAria', { name: stage.name, phase: phaseLabel(stage.phase), action: stage.action })">
            <span class="at-dot" aria-hidden="true">
              <el-icon :size="15"><component :is="iconOf(stage.id)" /></el-icon>
            </span>
            <span class="at-name">{{ stage.name }}<span v-if="stage.phase === 'skipped'" class="at-skipped-suffix">{{ t('assistant.track.skippedSuffix') }}</span></span>
          </div>
        </li>
      </template>
    </ol>
    <!-- 导出已从流水线分离：保存 = 落盘所有未保存编辑；导出 = 手动整理 jar/zip 产物 -->
    <div class="at-actions">
      <el-button
        size="small"
        :disabled="!canSave"
        @click="onSaveAll"
      >
        {{ t('common.save') }}
      </el-button>
      <el-tooltip
        :content="t('assistant.track.exportTip')"
        placement="top"
      >
        <span>
          <el-button
            size="small"
            type="primary"
            :disabled="!canExport"
            :loading="exporting"
            @click="onExport"
          >
            {{ t('assistant.track.exportBtn') }}
          </el-button>
        </span>
      </el-tooltip>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Compass, EditPen, Promotion, Tools, View } from '@element-plus/icons-vue'
import type { AgentPhaseState } from '../../../../shared/types/agent'
import type { StageId } from '../../../../shared/types/tiers'
import { useAiAgentsStore } from '../../stores/aiAgents'
import { useEditorStore } from '../../stores/editor'
import { useProjectStore } from '../../stores/project'
import { useUnifiedStore } from '../../stores/unified'
import { useI18n } from '../../i18n'

const agents = useAiAgentsStore()
const { t } = useI18n()
const editor = useEditorStore()
const projectStore = useProjectStore()
const unified = useUnifiedStore()

/** 未保存代码标签数 */
const dirtyCount = computed(() => editor.tabs.filter((tab) => tab.dirty).length)
/** 内容编辑器是否有正在编辑的对象（无 dirty 跟踪，有活动对象即允许保存） */
const hasActiveContent = computed(() => !!unified.active)
/** 保存按钮：有脏代码标签或内容编辑器有活动对象时启用 */
const canSave = computed(() => dirtyCount.value > 0 || hasActiveContent.value)

/** 保存全部：代码编辑器脏标签 + 内容编辑器当前活动对象 */
async function onSaveAll(): Promise<void> {
  const root = projectStore.currentProject?.path
  let saved = 0
  // 1. 代码标签页
  saved += await editor.saveAll()
  // 2. 内容编辑器活动对象（方块/物品/实体/生物群系/进度）
  if (unified.active && root) {
    const err = await unified.save(root)
    if (err) {
      ElMessage.error(t('assistant.track.saveFailed', { msg: err }))
      return
    }
    saved += 1
  }
  if (saved > 0) ElMessage.success(t('assistant.track.saved', { n: saved }))
  else ElMessage.info(t('assistant.track.nothingToSave'))
}

const exporting = ref(false)
/** 有打开项目且非运行中即可导出；做多个内容后统一导出，不强制要求先跑流水线 */
const canExport = computed(() => !!projectStore.currentProject && !agents.running)

async function onExport(): Promise<void> {
  if (exporting.value) return
  exporting.value = true
  try {
    const res = await agents.exportNow()
    if (res.ok) ElMessage.success(res.message)
    else ElMessage.warning(res.message)
  } finally {
    exporting.value = false
  }
}

/** 计划外的阶段在轨道上淡显（chat 只走 understand；由运行事件驱动） */
function isStagePlanned(id: StageId): boolean {
  const stage = agents.stages.find((s) => s.id === id)
  if (!stage) return true
  if (stage.phase !== 'waiting') return true
  if (agents.running) return true
  return id === 'understand'
}

const props = withDefaults(
  defineProps<{
    /**
     * 无运行进行时把轨道复位为「待命」：AI 助手面板用——任务结束后不回留上一轮的
     * 亮灯状态（结论与产出在会话气泡的「运行详情」里，历史任务另外可查）；
     * AI 制作页不用（规划完成等待确认等终态需要保留在轨道上）。
     */
    idleWhenStopped?: boolean
  }>(),
  { idleWhenStopped: false }
)

interface ShownStage {
  id: StageId
  name: string
  phase: AgentPhaseState
  action: string
  off: boolean
}

/**
 * 展示用阶段：idleWhenStopped 且当前无运行（含已完成/已取消的终态）时一律回「待命」，
 * 避免「没有任务了依旧亮着」；运行中/暂停中仍按真实阶段推进。
 */
const shownStages = computed<ShownStage[]>(() => {
  const idle = props.idleWhenStopped && !agents.running
  return agents.stages.map((s) => ({
    id: s.id,
    name: s.name,
    phase: idle ? 'waiting' : s.phase,
    action: idle ? t('assistant.track.phaseWaiting') : s.action,
    off: idle ? false : !isStagePlanned(s.id)
  }))
})

const ICONS: Record<StageId, unknown> = {
  understand: Compass,
  generate: EditPen,
  build: Tools,
  test: View,
  export: Promotion
}
function iconOf(id: StageId): unknown {
  return ICONS[id]
}

/** 连接线灯色：上游 done 才点亮（按展示用阶段，空闲时全为待命） */
function linkPhase(idx: number): AgentPhaseState {
  const prev = shownStages.value[idx - 1]
  if (!prev) return 'waiting'
  if (prev.phase === 'done') return 'done'
  if (prev.phase === 'running') return 'running'
  if (prev.phase === 'error') return 'error'
  return 'waiting'
}

function phaseLabel(phase: AgentPhaseState): string {
  switch (phase) {
    case 'waiting':
      return t('assistant.track.phaseWaiting')
    case 'running':
      return t('assistant.track.phaseRunning')
    case 'done':
      return t('assistant.track.phaseDone')
    case 'error':
      return t('assistant.track.phaseError')
    case 'skipped':
      return t('assistant.track.phaseSkipped')
  }
}
</script>

<style scoped>
.agent-track {
  flex-shrink: 0;
  margin: 0 10px 4px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 阶段条 */
.at-nodes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: flex-start;
}
/* 手动操作条：保存 / 导出产物（导出已从流水线分离） */
.at-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 6px 2px 0;
  border-top: 1px dashed var(--ky-border);
  margin-top: 6px;
}
.at-node {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.at-node-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
/* 连接线：独立 flex 项，自动撑满相邻节点间距，避免固定宽度在宽面板下留缺口（黑缝） */
.at-link {
  flex: 1 1 auto;
  min-width: 6px;
  height: 2px;
  margin-top: 12px;
  pointer-events: none;
}
.at-link.is-waiting {
  background: var(--ky-border);
}
.at-link.is-running {
  background: linear-gradient(90deg, var(--ky-accent), var(--ky-border));
}
.at-link.is-done {
  background: var(--ky-accent);
}
.at-link.is-error {
  background: var(--el-color-danger);
}
.at-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--ky-border);
  color: var(--ky-text-dim);
  background: var(--ky-bg-sidebar);
  transition: border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
  z-index: 1;
}
.at-name {
  font-size: 10.5px;
  color: var(--ky-text-dim);
  white-space: nowrap;
}
/* 计划外阶段淡显（如闲聊只走理解） */
.at-node.is-off .at-dot,
.at-node.is-off .at-name {
  opacity: 0.38;
}
.at-node.is-running .at-dot {
  color: var(--ky-accent);
  border-color: var(--ky-accent);
  animation: at-pulse 1.3s ease-in-out infinite;
}
.at-node.is-running .at-name {
  color: var(--ky-accent);
}
.at-node.is-done .at-dot {
  color: #11111b;
  background: var(--ky-accent);
  border-color: var(--ky-accent);
}
.at-node.is-done .at-name {
  color: var(--ky-text-sub);
}
.at-node.is-error .at-dot {
  color: #fff;
  background: var(--el-color-danger);
  border-color: var(--el-color-danger);
}
.at-node.is-error .at-name {
  color: var(--el-color-danger);
}
.at-node.is-skipped .at-dot {
  color: var(--el-color-warning);
  border-color: var(--el-color-warning);
  border-style: dashed;
  background: rgba(230, 162, 60, 0.08);
}
.at-node.is-skipped .at-name {
  color: var(--el-color-warning);
}
.at-skipped-suffix {
  margin-left: 2px;
  font-size: 9px;
  opacity: 0.85;
}
@keyframes at-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(var(--ky-accent-rgb), 0.45);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(var(--ky-accent-rgb), 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .at-node.is-running .at-dot {
    animation: none;
    box-shadow: 0 0 0 3px rgba(var(--ky-accent-rgb), 0.25);
  }
}
</style>
