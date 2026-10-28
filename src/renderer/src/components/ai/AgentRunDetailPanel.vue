<!--
  运行详情面板（批5）：会话结束时把一次 Agent 运行的产出显式收敛为三段——
  过程（工具调用时间线 + 编译/护栏日志）/ 验证（已验证·未验证·无法判定三态 +
  断言明细 + GameTest + 构建结论）/ 产物（jar·源码·贴图路径，贴图可就地重跑）。

  与散落在气泡里的卡片相比：三态结论与证据链集中在一处，用户一眼能看清
  「做了什么 / 验证到什么程度 / 落了哪些产物」，并可直接对单张贴图局部重跑
  （只重生成贴图，不重跑整个模组）。
-->
<template>
  <section class="rd-panel">
    <header class="rd-head">
      <el-icon :size="13" class="rd-head-icon"><DocumentChecked /></el-icon>
      <span class="rd-title">{{ t('assistant.detail.title') }}</span>
      <span class="rd-verdict" :class="`is-${verdictClass}`">{{ verdictLabel }}</span>
    </header>

    <!-- 过程：工具调用时间线 + 日志 -->
    <div class="rd-sec">
      <button type="button" class="rd-sec-head" @click="open.process = !open.process">
        <el-icon :size="12" class="rd-caret" :class="{ 'is-open': open.process }"><ArrowRight /></el-icon>
        <span class="rd-sec-title">{{ t('assistant.detail.secProcess') }}</span>
        <span class="rd-sec-meta">{{ processMeta }}</span>
      </button>
      <div v-if="open.process" class="rd-sec-body">
        <!-- 待办清单（todo_write）：模型自维护的进度面板，放在时间轴之前 -->
        <AgentArtifactCards v-if="todoArtifacts.length" :artifacts="todoArtifacts" />
        <AgentTimelineSegments
          v-if="segments.length"
          :segments="segments"
          :open="toolSegOpen"
          @toggle-seg="(k) => emit('toggleSeg', k)"
        />
        <p v-else-if="!todoArtifacts.length" class="rd-empty">{{ t('assistant.detail.processEmpty') }}</p>
      </div>
    </div>

    <!-- 验证：三态结论 + 断言明细 + 构建/GameTest 证据 -->
    <div class="rd-sec">
      <button type="button" class="rd-sec-head" @click="open.verify = !open.verify">
        <el-icon :size="12" class="rd-caret" :class="{ 'is-open': open.verify }"><ArrowRight /></el-icon>
        <span class="rd-sec-title">{{ t('assistant.detail.secVerify') }}</span>
        <span class="rd-sec-meta">{{ verifyMeta }}</span>
      </button>
      <div v-if="open.verify" class="rd-sec-body">
        <p v-if="outcome?.headline" class="rd-headline">{{ outcome.headline }}</p>
        <ul v-if="outcome && outcome.gaps.length" class="rd-gaps">
          <li v-for="(g, i) in outcome.gaps" :key="i">⚠️ {{ g }}</li>
        </ul>
        <AgentArtifactCards
          v-if="verifyArtifacts.length"
          :artifacts="verifyArtifacts"
          :rechecking="rechecking"
          @recheck="(p) => emit('recheck', p)"
        />
        <p v-else class="rd-empty">{{ t('assistant.detail.verifyEmpty') }}</p>
      </div>
    </div>

    <!-- 产物：源码 / 贴图 / 数据，导出 jar·zip -->
    <div class="rd-sec">
      <button type="button" class="rd-sec-head" @click="open.artifacts = !open.artifacts">
        <el-icon :size="12" class="rd-caret" :class="{ 'is-open': open.artifacts }"><ArrowRight /></el-icon>
        <span class="rd-sec-title">{{ t('assistant.detail.secArtifacts') }}</span>
        <span class="rd-sec-meta">{{ artifactMeta }}</span>
      </button>
      <div v-if="open.artifacts" class="rd-sec-body">
        <AgentArtifactCards
          v-if="artifactArtifacts.length"
          :artifacts="artifactArtifacts"
          :run-id="runId"
          :rechecking="rechecking"
          allow-regenerate
          allow-apply-candidate
          :applying-candidate="applyingCandidate"
          :applied-index="appliedIndex"
          @regenerate="onRegenerate"
          @apply-candidate="onApplyCandidate"
        />
        <p v-else class="rd-empty">{{ t('assistant.detail.artifactsEmpty') }}</p>
      </div>
    </div>

    <!-- 贴图局部重跑：只对单张贴图 AI 重绘并原地回写，不重跑整个模组 -->
    <el-dialog
      v-model="regenOpen"
      :title="t('assistant.detail.regenTitle')"
      width="460px"
      append-to-body
      class="rd-regen-dialog"
    >
      <p class="rd-regen-path">{{ regenPath }}</p>
      <el-input
        v-model="regenInstruction"
        type="textarea"
        :rows="3"
        maxlength="200"
        show-word-limit
        :placeholder="t('assistant.detail.regenPh')"
      />
      <p class="rd-regen-tip">{{ t('assistant.detail.regenTip') }}</p>
      <template #footer>
        <el-button @click="regenOpen = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="regenBusy" @click="doRegenerate">
          {{ t('assistant.artifact.regen') }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { ArrowRight, DocumentChecked } from '@element-plus/icons-vue'
import type { AcceptanceAssertion, AgentArtifact, RunOutcome } from '../../../../shared/types/agent'
import { useProjectStore } from '../../stores/project'
import AgentArtifactCards from './AgentArtifactCards.vue'
import AgentTimelineSegments from './assistant/AgentTimelineSegments.vue'
import { reviewStatusOf } from './assistant/useChangeReview'
import type { TimelineSegment } from './assistant/useTimeline'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const props = defineProps<{
  /** 本次运行的全部产物（未过滤，由面板按域切分到三段） */
  artifacts: AgentArtifact[]
  /** 本次运行的 runId（改动审批/对比/撤销的定位键） */
  runId?: string | null
  /** 过程段的时间轴片段（仅当前运行有效） */
  segments: TimelineSegment[]
  /** 工具组折叠状态（与气泡时间轴共用） */
  toolSegOpen: Record<string, boolean>
  /** 运行结论（三态事实源；chat/早退为 null 时按产物兜底派生） */
  outcome: RunOutcome | null
  rechecking?: boolean
}>()

const emit = defineEmits<{
  toggleSeg: [key: string]
  recheck: [payload: { artifactId: string; assertion: AcceptanceAssertion }]
}>()

const projectStore = useProjectStore()

const open = reactive({ process: true, verify: true, artifacts: true })

// ---------------- 三态结论（已验证 / 未验证 / 无法判定） ----------------
type VerdictClass = 'success' | 'partial' | 'failed' | 'inconclusive' | 'unknown'

const contractArt = computed<AgentArtifact | undefined>(() =>
  props.artifacts.find((a) => a.kind === 'contract')
)
const buildArt = computed<AgentArtifact | undefined>(() =>
  props.artifacts.find((a) => a.kind === 'build-result')
)

/** 无 RunOutcome 时按产物派生兜底（历史事件/异常早退）：环境阻塞优先判「无法判定」 */
const verdictClass = computed<VerdictClass>(() => {
  const v = props.outcome?.verdict
  if (v === 'success') return 'success'
  if (v === 'partial') return 'partial'
  if (v === 'failed') return 'failed'
  if (v === 'inconclusive') return 'inconclusive'
  if (buildArt.value?.build?.blockedByEnvironment) return 'inconclusive'
  const o = contractArt.value?.contract?.overall
  if (o === 'verified' || o === 'pass') return 'success'
  if (o === 'failed' || o === 'fail') return 'failed'
  return 'unknown'
})

const verdictLabel = computed(() => {
  switch (verdictClass.value) {
    case 'success':
      return t('assistant.detail.verdictSuccess')
    case 'partial':
      return t('assistant.detail.verdictPartial')
    case 'failed':
      return t('assistant.detail.verdictFailed')
    case 'inconclusive':
      return t('assistant.detail.verdictInconclusive')
    default:
      return t('assistant.detail.verdictUnknown')
  }
})

// ---------------- 三段内容切分 ----------------
/** 验证段：契约 / 构建 / GameTest / 探针截图 / 跳过说明 */
const VERIFY_KINDS = new Set(['contract', 'build-result', 'gametest', 'probe-screenshot', 'error'])
const verifyArtifacts = computed(() => props.artifacts.filter((a) => VERIFY_KINDS.has(a.kind)))

/** 产物段：文件变更 + 导出产物 + 贴图候选画廊 */
const ARTIFACT_KINDS = new Set(['file-change', 'export-result', 'texture-candidates'])
const artifactArtifacts = computed(() => props.artifacts.filter((a) => ARTIFACT_KINDS.has(a.kind)))

/** 过程段待办清单：todo_write 提交的进度面板（同一 run 内固定 id，只保留最新一张） */
const todoArtifacts = computed(() => props.artifacts.filter((a) => a.kind === 'todo-list'))

/** 产物段摘要：N 个文件（含已撤销数）· M 项导出产物 · K 组贴图候选 */
const artifactMeta = computed(() => {
  const fileChanges = props.artifacts.filter((a) => a.kind === 'file-change')
  const files = fileChanges.reduce(
    (n, a) => n + (a.files?.filter((f) => f.accepted).length ?? 0),
    0
  )
  const reverted = fileChanges.reduce(
    (n, a) =>
      n +
      (a.files ?? []).filter(
        (f) => f.accepted && reviewStatusOf(props.runId ?? null, f.path) === 'reverted'
      ).length,
    0
  )
  const exported = props.artifacts
    .filter((a) => a.kind === 'export-result')
    .reduce((n, a) => n + (a.export?.artifacts.length ?? 0), 0)
  const texSets = props.artifacts.filter((a) => a.kind === 'texture-candidates').length
  const texVariants = props.artifacts
    .filter((a) => a.kind === 'texture-candidates')
    .reduce((n, a) => n + (a.textureCandidates?.variants.length ?? 0), 0)
  const parts: string[] = []
  if (files > 0) {
    parts.push(
      t('assistant.detail.metaFiles', { n: files }) +
        (reverted > 0 ? t('assistant.detail.metaFilesReverted', { n: reverted }) : '')
    )
  }
  if (exported > 0) parts.push(t('assistant.detail.metaExported', { n: exported }))
  if (texSets > 0) {
    parts.push(t('assistant.detail.metaTexture', { sets: texSets, variants: texVariants }))
  }
  return parts.length ? parts.join(' · ') : t('assistant.detail.metaNone')
})

/** 过程段摘要：N 次工具调用 */
const processMeta = computed(() => {
  const calls = props.segments.reduce((n, s) => n + (s.kind === 'tools' ? s.items.length : 0), 0)
  const parts: string[] = []
  const todos = todoArtifacts.value[0]?.todos
  if (todos?.length) {
    parts.push(
      t('assistant.detail.metaTodos', {
        done: todos.filter((todo) => todo.status === 'completed').length,
        total: todos.length
      })
    )
  }
  if (calls > 0) parts.push(t('assistant.detail.metaCalls', { n: calls }))
  return parts.length > 0 ? parts.join(' · ') : t('assistant.detail.metaNoRecord')
})

/** 验证段摘要：断言通过/未验证计数 + 构建状态 */
const verifyMeta = computed(() => {
  const assertions = contractArt.value?.contract?.assertions ?? []
  if (assertions.length > 0) {
    const verified = assertions.filter((a) => a.status === 'verified' || a.status === 'pass')
    const failed = assertions.filter((a) => a.status === 'failed' || a.status === 'fail')
    const parts = [t('assistant.detail.metaVerified', { done: verified.length, total: assertions.length })]
    if (failed.length > 0) parts.push(t('assistant.detail.metaFailed', { n: failed.length }))
    return parts.join('，')
  }
  const b = buildArt.value?.build
  if (b) {
    const label =
      b.status === 'pass'
        ? t('assistant.detail.buildPass')
        : b.status === 'fail'
          ? t('assistant.detail.buildFail')
          : t('assistant.detail.buildSkipped')
    return t('assistant.detail.buildMeta', { label, rounds: b.rounds })
  }
  return t('assistant.detail.metaNoVerify')
})

// ---------------- 贴图局部重跑 ----------------
const regenOpen = ref(false)
const regenBusy = ref(false)
const regenPath = ref('')
const regenInstruction = ref('')

function onRegenerate(payload: { path: string }): void {
  regenPath.value = payload.path
  regenInstruction.value = ''
  regenOpen.value = true
}

async function doRegenerate(): Promise<void> {
  if (regenBusy.value) return
  const projectPath = projectStore.currentProject?.path
  if (!projectPath) {
    ElMessage.warning(t('assistant.detail.regenNoProject'))
    return
  }
  if (!regenInstruction.value.trim()) {
    ElMessage.warning(t('assistant.detail.regenNeedInstruction'))
    return
  }
  regenBusy.value = true
  try {
    const res = await window.api.agent.regenerateAsset({
      projectPath,
      relPath: regenPath.value,
      instruction: regenInstruction.value.trim()
    })
    if (res.ok) {
      ElMessage.success(
        t('assistant.detail.regenOk', {
          size: res.size,
          warn: res.warnings.length ? '：' + res.warnings[0] : ''
        })
      )
      regenOpen.value = false
    } else {
      ElMessage.error(res.errorMessage)
    }
  } catch (err) {
    ElMessage.error(t('assistant.detail.regenFailed', { msg: (err as Error).message }))
  } finally {
    regenBusy.value = false
  }
}

// ---------------- 采用 AI 候选贴图（聊天「产物」卡点选） ----------------
const applyingCandidate = ref<{ artifactId: string; candidateIndex: number } | null>(null)
/** 各组候选的已应用序号（artifactId → 1-based 候选序号），点选写回成功后记录 */
const appliedIndex = ref<Record<string, number>>({})

async function onApplyCandidate(payload: { artifactId: string; candidateIndex: number }): Promise<void> {
  if (applyingCandidate.value) return
  const projectPath = projectStore.currentProject?.path
  if (!projectPath) {
    ElMessage.warning(t('assistant.detail.applyNoProject'))
    return
  }
  const art = props.artifacts.find((a) => a.id === payload.artifactId)
  const set = art?.textureCandidates
  const variant = set?.variants.find((v) => v.index === payload.candidateIndex)
  if (!set || !variant) {
    ElMessage.warning(t('assistant.detail.applyStale'))
    return
  }
  applyingCandidate.value = { artifactId: payload.artifactId, candidateIndex: payload.candidateIndex }
  try {
    const res = await window.api.content.applyTextureCandidate(
      projectPath,
      set.assetKind,
      set.assetId,
      variant.pixels,
      set.size
    )
    if (res.ok) {
      appliedIndex.value[payload.artifactId] = payload.candidateIndex
      ElMessage.success(
        t('assistant.detail.applyOk', {
          index: payload.candidateIndex,
          kind: set.assetKind,
          id: set.assetId,
          suffix: res.pngWritten
            ? t('assistant.detail.applySuffixPng')
            : t('assistant.detail.applySuffixNoPng')
        })
      )
    } else {
      ElMessage.error(res.errorMessage)
    }
  } catch (err) {
    ElMessage.error(t('assistant.detail.applyFailed', { msg: (err as Error).message }))
  } finally {
    applyingCandidate.value = null
  }
}
</script>

<style scoped>
.rd-panel {
  margin-top: 6px;
  border: 1px solid var(--ky-border);
  border-radius: 10px;
  background: var(--ky-bg-panel);
  overflow: hidden;
}
.rd-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--ky-border);
}
.rd-head-icon {
  color: var(--ky-accent);
}
.rd-title {
  flex: 1;
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-text);
}
.rd-verdict {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  line-height: 16px;
  border: 1px solid transparent;
}
.rd-verdict.is-success {
  color: var(--ky-accent);
  background: rgba(var(--ky-accent-rgb), 0.12);
  border-color: rgba(var(--ky-accent-rgb), 0.3);
}
.rd-verdict.is-partial {
  color: var(--el-color-warning);
  background: rgba(230, 162, 60, 0.1);
  border-color: rgba(230, 162, 60, 0.3);
}
.rd-verdict.is-failed {
  color: var(--el-color-danger);
  background: rgba(243, 139, 168, 0.1);
  border-color: rgba(243, 139, 168, 0.3);
}
.rd-verdict.is-inconclusive,
.rd-verdict.is-unknown {
  color: var(--ky-text-sub);
  background: rgba(147, 153, 178, 0.1);
  border-color: var(--ky-border);
}
.rd-sec + .rd-sec {
  border-top: 1px solid var(--ky-border);
}
.rd-sec-head {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--ky-text-sub);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.rd-sec-head:hover {
  color: var(--ky-text);
  background: rgba(147, 153, 178, 0.07);
}
.rd-caret {
  color: var(--ky-text-dim);
  transition: transform 0.18s ease;
}
.rd-caret.is-open {
  transform: rotate(90deg);
}
.rd-sec-title {
  font-weight: 600;
}
.rd-sec-meta {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--ky-text-dim);
}
.rd-sec-body {
  padding: 2px 10px 8px;
}
.rd-empty {
  margin: 2px 0;
  font-size: 11.5px;
  color: var(--ky-text-dim);
}
.rd-headline {
  margin: 2px 0 6px;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--ky-text);
}
.rd-gaps {
  list-style: none;
  margin: 0 0 6px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: #f9e2af;
}
.rd-regen-path {
  margin: 0 0 8px;
  font-size: 11.5px;
  color: var(--ky-text-sub);
  font-family: var(--ky-font-mono, monospace);
  word-break: break-all;
}
.rd-regen-tip {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--ky-text-dim);
}
</style>
