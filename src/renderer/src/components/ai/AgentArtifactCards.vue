<template>
  <div class="art-cards">
    <div v-for="art in artifacts" :key="art.id" class="art-card" :class="`art-${art.kind}`">
      <!-- 执行计划 -->
      <template v-if="art.kind === 'plan'">
        <div class="art-head">
          <el-icon><Compass /></el-icon>
          <span class="art-title">{{ art.title }}</span>
        </div>
        <div v-if="art.references?.length" class="art-tags">
          <el-tag v-for="refItem in art.references" :key="refItem" size="small" effect="plain">
            {{ refItem }}
          </el-tag>
        </div>
        <pre v-if="art.body" class="art-pre">{{ art.body }}</pre>
      </template>

      <!-- 检索产物 -->
      <template v-else-if="art.kind === 'retrieval'">
        <div class="art-head">
          <el-icon><Search /></el-icon>
          <span class="art-title">{{ art.title }}</span>
        </div>
        <ul v-if="art.references?.length" class="art-list">
          <li v-for="r in art.references" :key="r">{{ r }}</li>
        </ul>
        <p v-else class="art-empty-line">{{ t('assistant.artifact.retrievalEmpty') }}</p>
        <p v-if="art.body" class="art-fingerprint">{{ art.body }}</p>
      </template>

      <!-- 待办清单（todo_write：模型自维护的进度面板） -->
      <template v-else-if="art.kind === 'todo-list' && art.todos">
        <div class="art-head">
          <el-icon><List /></el-icon>
          <span class="art-title">{{ art.title }}</span>
          <el-tag size="small" :type="todoTagType(art.todos)">{{ todoProgress(art.todos) }}</el-tag>
        </div>
        <ul class="art-todos">
          <li v-for="todo in art.todos" :key="todo.id" :class="`art-todo art-todo--${todo.status}`">
            <span class="art-todo-mark">{{ todoMark(todo.status) }}</span>
            <span class="art-todo-text">{{ todo.content }}</span>
          </li>
        </ul>
      </template>

      <!-- 文件变更 + 改动审批（P3）：逐条复核「保留 / 撤销」，撤销即回滚到 run 前状态 -->
      <template v-else-if="art.kind === 'file-change'">
        <div class="art-head">
          <el-icon><EditPen /></el-icon>
          <span class="art-title">{{ art.title }}</span>
        </div>
        <ul class="art-files">
          <li v-for="(f, i) in art.files" :key="`${f.path}-${i}`" :class="f.accepted ? 'is-ok' : 'is-skip'">
            <span class="art-file-icon">{{ f.accepted ? '✅' : '⚠️' }}</span>
            <span class="art-file-path">{{ f.path }}</span>
            <el-tag size="small" :type="f.action === 'create' ? 'success' : 'warning'">
              {{
                f.action === 'create'
                  ? t('assistant.artifact.actionCreate')
                  : t('assistant.artifact.actionModify')
              }}
            </el-tag>
            <template v-if="f.accepted">
              <span v-if="statBadge(f.path)" class="art-file-stat" :title="statTitle(f.path)">
                {{ statBadge(f.path) }}
              </span>
              <!-- 对比：run 前原文快照 vs 当前磁盘（Monaco DiffEditor 标签） -->
              <button
                type="button"
                class="art-diff-btn"
                :title="t('assistant.review.diffTip')"
                @click="openDiffFor(f.path)"
              >
                {{ t('assistant.review.diff') }}
              </button>
              <template v-if="statusOf(f.path) === 'pending'">
                <button
                  type="button"
                  class="art-keep-btn"
                  :title="t('assistant.review.keepTip')"
                  @click="keepFor(f.path)"
                >
                  {{ t('assistant.review.keep') }}
                </button>
                <button
                  type="button"
                  class="art-rollback-btn"
                  :title="t('assistant.review.revertTip')"
                  :disabled="reviewing"
                  @click="rollbackFor(f.path)"
                >
                  {{ t('assistant.review.revert') }}
                </button>
              </template>
              <span v-else-if="statusOf(f.path) === 'kept'" class="art-file-state is-kept">
                {{ t('assistant.review.kept') }}
              </span>
              <span v-else class="art-file-state is-reverted">{{ t('assistant.review.reverted') }}</span>
              <button
                v-if="isRegenerable(f)"
                type="button"
                class="art-regen-btn"
                :title="t('assistant.artifact.regenTip')"
                @click="$emit('regenerate', { path: f.path })"
              >
                {{ t('assistant.artifact.regen') }}
              </button>
            </template>
          </li>
        </ul>
        <!-- 审批汇总条：批量保留 / 撤销所有未处理项 -->
        <div v-if="landedOf(art).length" class="art-review-bar">
          <span class="art-review-progress">
            {{
              t('assistant.review.progress', {
                kept: summaryOf(art).kept,
                reverted: summaryOf(art).reverted,
                pending: summaryOf(art).pending
              })
            }}
          </span>
          <button
            type="button"
            class="art-review-act"
            :disabled="summaryOf(art).pending === 0"
            @click="keepAllFor(art)"
          >
            {{ t('assistant.review.keepAll') }}
          </button>
          <button
            type="button"
            class="art-review-act is-danger"
            :disabled="summaryOf(art).pending === 0 || reviewing"
            @click="revertAllFor(art)"
          >
            {{ t('assistant.review.revertPending') }}
          </button>
        </div>
        <p v-if="art.files?.some((f) => !f.accepted && f.reason)" class="art-reject">
          {{ art.files.find((f) => !f.accepted)?.reason }}
        </p>
        <p v-if="art.body" class="art-notes">{{ art.body }}</p>
      </template>

      <!-- 构建结论 -->
      <template v-else-if="art.kind === 'build-result' && art.build">
        <div class="art-head">
          <el-icon><Tools /></el-icon>
          <span class="art-title">{{ art.title }}</span>
          <el-tag
            size="small"
            :type="art.build.status === 'pass' ? 'success' : art.build.status === 'fail' ? 'danger' : 'info'"
          >
            {{
              art.build.status === 'pass'
                ? t('assistant.artifact.buildPass')
                : art.build.status === 'fail'
                  ? t('assistant.artifact.buildFail')
                  : t('assistant.artifact.skipped')
            }}
            · {{ t('assistant.artifact.buildRounds', { n: art.build.rounds }) }}
          </el-tag>
        </div>
        <p class="art-summary">{{ art.build.summary }}</p>
        <div v-if="art.build.matchedPatternIds.length" class="art-tags">
          <el-tag
            v-for="id in art.build.matchedPatternIds"
            :key="id"
            size="small"
            type="danger"
            effect="plain"
          >
            {{ id }}
          </el-tag>
        </div>
      </template>

      <!-- 验收契约（特征③，三态显式化：已验证/未通过/未验证） -->
      <template v-else-if="art.kind === 'contract' && art.contract">
        <div class="art-head">
          <el-icon><DocumentChecked /></el-icon>
          <span class="art-title">{{ art.title }}</span>
          <el-tag size="small" :type="overallTagType(art.contract)">
            {{ overallLabel(art.contract) }}
          </el-tag>
        </div>
        <p class="art-summary">{{ art.contract.summary }}</p>
        <ul class="art-contract-list">
          <template v-for="a in art.contract.assertions" :key="a.id">
            <li :class="`art-assertion art-assertion--${normStatus(a.status)}`">
              <span class="art-assertion-icon">{{ statusIcon(a.status) }}</span>
              <span class="art-assertion-kind">{{ kindLabel(a.kind) }}</span>
              <span class="art-assertion-desc" :title="a.expected || ''">{{ a.description }}</span>
              <el-image
                v-if="a.status === 'awaiting-user' && shotUrl(a)"
                class="art-assertion-shot"
                :src="shotUrl(a)!"
                :preview-src-list="[shotUrl(a)!]"
                fit="cover"
                hide-on-click-modal
              />
              <span v-if="a.actual" class="art-assertion-actual">{{ a.actual }}</span>
              <button
                v-if="recheckable(a)"
                class="art-recheck-btn"
                :disabled="rechecking"
                :title="
                  a.kind === 'build-pass'
                    ? t('assistant.artifact.recheckBuildTip')
                    : t('assistant.artifact.recheckTip')
                "
                @click="$emit('recheck', { artifactId: art.id, assertion: a })"
              >
                {{ t('assistant.artifact.recheck') }}
              </button>
            </li>
            <li v-if="evidenceText(a)" class="art-assertion-evidence" :title="evidenceText(a)!">
              ↳ {{ evidenceText(a) }}
            </li>
          </template>
          <li
            v-for="a in art.contract.assertions.filter((x) => x.reason && !isVerified(x.status))"
            :key="`reason-${a.id}`"
            class="art-assertion-reason"
          >
            ⚠️ {{ a.reason }}
          </li>
        </ul>
        <p v-if="hasAwaiting(art.contract)" class="art-awaiting-hint">
          {{ t('assistant.artifact.awaitingHint') }}
        </p>
      </template>

      <!-- 探针截图 -->
      <template v-else-if="art.kind === 'probe-screenshot'">
        <div class="art-head">
          <el-icon><View /></el-icon>
          <span class="art-title">{{ art.title }}</span>
        </div>
        <el-image
          v-if="art.screenshotPath && fileUrl(art.screenshotPath)"
          class="art-shot"
          :src="fileUrl(art.screenshotPath)!"
          :preview-src-list="[fileUrl(art.screenshotPath)!]"
          fit="cover"
          hide-on-click-modal
        >
          <template #error>
            <div class="art-shot-error">{{ t('assistant.artifact.shotError') }}</div>
          </template>
        </el-image>
        <p v-else class="art-empty-line">{{ t('assistant.artifact.shotEmpty') }}</p>
        <p v-if="art.body" class="art-summary">{{ art.body }}</p>
      </template>

      <!-- 贴图候选画廊（AI 重绘出的多个方案，点选后写回资产） -->
      <template v-else-if="art.kind === 'texture-candidates' && art.textureCandidates">
        <div class="art-head">
          <el-icon><Picture /></el-icon>
          <span class="art-title">{{ art.title }}</span>
          <el-tag size="small" type="info">
            {{ art.textureCandidates.size }}×{{ art.textureCandidates.size }}
          </el-tag>
        </div>
        <p class="art-summary">
          「{{ art.textureCandidates.prompt }}」
          <span v-if="art.textureCandidates.provider"> · {{ art.textureCandidates.provider }}</span>
        </p>
        <div class="art-thumbs">
          <button
            v-for="v in art.textureCandidates.variants"
            :key="v.index"
            type="button"
            class="art-thumb"
            :class="{ 'is-active': v.index === selIndex(art) }"
            :title="t('assistant.artifact.candidateTitle', { index: v.index, colors: v.colorCount })"
            @click="selectMap[art.id] = v.index"
          >
            <img
              :src="v.dataUrl"
              :alt="t('assistant.artifact.candidateAlt', { index: v.index })"
              draggable="false"
            />
            <span class="art-thumb-no">{{ v.index }}</span>
          </button>
        </div>
        <p v-if="art.textureCandidates.warnings?.length" class="art-warn-line">
          ⚠ {{ art.textureCandidates.warnings[0] }}
        </p>
        <div v-if="allowApplyCandidate" class="art-tex-actions">
          <span class="art-tex-hint">
            {{ t('assistant.artifact.appliedHint', { index: art.textureCandidates.appliedIndex }) }}
          </span>
          <button
            type="button"
            class="art-apply-btn"
            :disabled="applyingThis(art) || selIndex(art) === appliedOf(art)"
            @click="$emit('applyCandidate', { artifactId: art.id, candidateIndex: selIndex(art) })"
          >
            {{
              applyingThis(art)
                ? t('assistant.artifact.applying')
                : selIndex(art) === appliedOf(art)
                  ? t('assistant.artifact.applied')
                  : t('assistant.artifact.applyCandidate', { index: selIndex(art) })
            }}
          </button>
        </div>
      </template>

      <!-- 工具调用（generate 阶段 Function Calling） -->
      <template v-else-if="art.kind === 'tool-call'">
        <div class="art-head">
          <el-icon><MagicStick /></el-icon>
          <span class="art-title">{{ art.title }}</span>
        </div>
        <pre v-if="art.body" class="art-pre">{{ art.body }}</pre>
      </template>

      <!-- 导出产物 -->
      <template v-else-if="art.kind === 'export-result' && art.export">
        <div class="art-head">
          <el-icon><Promotion /></el-icon>
          <span class="art-title">{{ art.title }}</span>
          <el-tag size="small" :type="art.export.status === 'ok' ? 'success' : 'info'">
            {{
              art.export.status === 'ok'
                ? t('assistant.artifact.exported')
                : t('assistant.artifact.skipped')
            }}
          </el-tag>
        </div>
        <p class="art-summary">{{ art.export.summary }}</p>
        <ul v-if="art.export.artifacts.length" class="art-list">
          <li v-for="(a, i) in art.export.artifacts" :key="i">
            {{ a.kind === 'jar' ? '📦' : a.kind === 'zip' ? '🗜️' : '📄' }} {{ a.path }}
          </li>
        </ul>
        <ul v-if="art.export.notes?.length" class="art-list art-list-note">
          <li v-for="(n, i) in art.export.notes" :key="i">⚠️ {{ n }}</li>
        </ul>
      </template>

      <!-- 错误/跳过说明 -->
      <template v-else-if="art.kind === 'error'">
        <div class="art-head">
          <el-icon><Warning /></el-icon>
          <span class="art-title">{{ art.title }}</span>
        </div>
        <p class="art-summary art-summary-warn">{{ art.body }}</p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Compass,
  DocumentChecked,
  EditPen,
  List,
  MagicStick,
  Picture,
  Promotion,
  Search,
  Tools,
  View,
  Warning
} from '@element-plus/icons-vue'
import {
  RECHECKABLE_ASSERTION_KINDS,
  type AcceptanceAssertion,
  type AcceptanceContract,
  type AgentArtifact,
  type AgentTodoItem,
  type AssertionKind,
  type AssertionStatus
} from '../../../../shared/types/agent'
import { MAX_DIFF_LINES, useChangeReview } from './assistant/useChangeReview'
import { useI18n } from '../../i18n'

const { t } = useI18n()

const props = defineProps<{
  artifacts: AgentArtifact[]
  /** 本次运行的 runId（改动审批/对比/撤销的定位键；缺省回退到 store 的当前运行） */
  runId?: string | null
  rechecking?: boolean
  /** 产物卡片是否对贴图显示「重跑」按钮（资源替换局部重跑） */
  allowRegenerate?: boolean
  /** 产物卡片是否对贴图候选显示「使用此候选」（聊天内点选写回资产） */
  allowApplyCandidate?: boolean
  /** 正在写回的候选（按钮 loading 态 + 防重入） */
  applyingCandidate?: { artifactId: string; candidateIndex: number } | null
  /** 已应用的候选序号（artifactId → 1-based），未记录时回退到 artifact 自带的 appliedIndex */
  appliedIndex?: Record<string, number>
}>()

defineEmits<{
  /** 「复跑此项」：由父级走 agent:recheck-assertion IPC 后 updateArtifact 同 id 替换 */
  recheck: [payload: { artifactId: string; assertion: AcceptanceAssertion }]
  /** 「重跑这张贴图」：只重生成该 PNG，不重跑整个模组（走 agent:regenerate-asset IPC） */
  regenerate: [payload: { path: string }]
  /** 「使用此候选」：把选中的 AI 候选贴图写回资产（走 content:texture-apply-candidate） */
  applyCandidate: [payload: { artifactId: string; candidateIndex: number }]
}>()

/** 贴图候选：当前选中序号（未点选时默认 AI 自动写回的那张） */
const selectMap = ref<Record<string, number>>({})

function selIndex(art: AgentArtifact): number {
  return selectMap.value[art.id] ?? art.textureCandidates?.appliedIndex ?? 1
}

function appliedOf(art: AgentArtifact): number {
  return props.appliedIndex?.[art.id] ?? art.textureCandidates?.appliedIndex ?? 1
}

function applyingThis(art: AgentArtifact): boolean {
  return props.applyingCandidate?.artifactId === art.id
}

/** 贴图局部重跑按钮可见性：仅 assets/<ns>/textures/ 下已落盘的 PNG */
function isRegenerable(f: { path: string; accepted: boolean }): boolean {
  return (
    props.allowRegenerate === true &&
    f.accepted &&
    /^assets\/[^/]+\/textures\/.*\.png$/.test(f.path)
  )
}

// ---------------- 待办清单（todo_write 进度面板） ----------------
function todoMark(status: AgentTodoItem['status']): string {
  return status === 'completed' ? '✅' : status === 'in_progress' ? '🔄' : '⬜'
}

function todoProgress(todos: AgentTodoItem[]): string {
  return `${todos.filter((todo) => todo.status === 'completed').length}/${todos.length}`
}

function todoTagType(todos: AgentTodoItem[]): 'success' | 'warning' | 'info' {
  const done = todos.filter((todo) => todo.status === 'completed').length
  if (done === todos.length) return 'success'
  return done > 0 ? 'warning' : 'info'
}

// ---------------- 改动审批（P3）：逐条复核 + 保留/撤销 + 批量 ----------------
const review = useChangeReview()
const reviewing = review.reviewing

/** 审批定位键：优先用父级传入的 runId，缺省回退到 store 当前运行 */
const runId = computed(() => props.runId ?? review.currentRunId())

/** 该 card 内已落盘的文件路径（未通过校验的文件从未落盘，不参与审批） */
function landedOf(art: AgentArtifact): string[] {
  return (art.files ?? []).filter((f) => f.accepted).map((f) => f.path)
}

function statusOf(relPath: string): string {
  return review.statusOf(runId.value, relPath)
}

/** 复核进度（读取模块级 reactive 状态：撤销/保留后模板自动刷新） */
function summaryOf(art: AgentArtifact): { kept: number; reverted: number; pending: number } {
  let kept = 0
  let reverted = 0
  let pending = 0
  for (const relPath of landedOf(art)) {
    const s = review.statusOf(runId.value, relPath)
    if (s === 'kept') kept += 1
    else if (s === 'reverted') reverted += 1
    else pending += 1
  }
  return { kept, reverted, pending }
}

/** 行级统计徽标：加载中「…」；无快照/读取失败空；超阈值降级为「整文件」 */
function statBadge(relPath: string): string {
  const s = review.statsOf(runId.value, relPath)
  if (s === undefined) return '…'
  if (s === null) return ''
  return s.truncated
    ? t('assistant.review.statWhole', { added: s.added, removed: s.removed })
    : t('assistant.review.statLine', { added: s.added, removed: s.removed })
}

function statTitle(relPath: string): string {
  const s = review.statsOf(runId.value, relPath)
  if (!s) return ''
  return s.truncated
    ? t('assistant.review.statTitleTrunc', { max: MAX_DIFF_LINES })
    : t('assistant.review.statTitle', { added: s.added, removed: s.removed })
}

function openDiffFor(relPath: string): void {
  void review.openDiff(runId.value, relPath)
}

function keepFor(relPath: string): void {
  review.keep(runId.value, relPath)
}

function rollbackFor(relPath: string): void {
  void review.revert(runId.value, relPath)
}

function keepAllFor(art: AgentArtifact): void {
  review.keepAll(runId.value, landedOf(art))
}

/** 批量撤销：只对未处理项生效（已保留/已撤销的跳过） */
async function revertAllFor(art: AgentArtifact): Promise<void> {
  const pending = landedOf(art).filter((p) => review.statusOf(runId.value, p) === 'pending')
  await review.revertAll(runId.value, pending)
}

/** 审批队列变化时懒加载行级统计（快照 + 当前磁盘；已取过的路径走缓存） */
watch(
  [() => props.artifacts.map((a) => a.id).join('|'), runId],
  () => {
    void review.loadStats(
      runId.value,
      props.artifacts.flatMap((a) => landedOf(a))
    )
  },
  { immediate: true }
)

/** 契约是否含待人工确认项（标签 / 提示行用） */
function hasAwaiting(contract: AcceptanceContract): boolean {
  return contract.assertions.some((a) => a.status === 'awaiting-user')
}

/** 三态归一：历史数据 pass/fail/skipped 映射到新三态 verified/failed/unverified */
type NormStatus = 'verified' | 'failed' | 'unverified' | 'awaiting-user' | 'pending'
function normStatus(s: AssertionStatus): NormStatus {
  if (s === 'pass' || s === 'verified') return 'verified'
  if (s === 'fail' || s === 'failed') return 'failed'
  if (s === 'skipped' || s === 'unverified') return 'unverified'
  return s
}

function isVerified(s: AssertionStatus): boolean {
  return normStatus(s) === 'verified'
}

function statusIcon(s: AssertionStatus): string {
  switch (normStatus(s)) {
    case 'verified':
      return '✅'
    case 'failed':
      return '❌'
    case 'unverified':
      return '⚪'
    case 'awaiting-user':
      return '👁️'
    default:
      return '⏳'
  }
}

function overallTagType(c: AcceptanceContract): 'success' | 'danger' | 'warning' | 'info' {
  const o = normStatus(c.overall)
  if (o === 'verified') return 'success'
  if (o === 'failed') return 'danger'
  if (hasAwaiting(c)) return 'warning'
  return 'info'
}

function overallLabel(c: AcceptanceContract): string {
  const o = normStatus(c.overall)
  if (o === 'verified') return t('assistant.artifact.overallVerified')
  if (o === 'failed') return t('assistant.artifact.overallFailed')
  if (hasAwaiting(c)) return t('assistant.artifact.overallAwaiting')
  if (o === 'unverified') return t('assistant.artifact.overallPartial')
  return t('assistant.artifact.overallRunning')
}

/** 该断言类型是否支持单项复验（与主进程 recheckAssertion 同一事实源） */
function recheckable(a: AcceptanceAssertion): boolean {
  return RECHECKABLE_ASSERTION_KINDS.has(a.kind)
}

/** 证据链一行摘要：命令 + 退出码 / 文件路径 + 时间戳 */
function evidenceText(a: AcceptanceAssertion): string | null {
  const ev = a.evidence
  if (!ev) return null
  const parts: string[] = []
  if (ev.command) parts.push(`$ ${ev.command}`)
  if (ev.exitCode !== undefined) parts.push(`exit ${ev.exitCode}`)
  if (ev.path) parts.push(ev.path)
  if (parts.length === 0) return null
  const ts = ev.timestamp
    ? `（${new Date(ev.timestamp).toLocaleString('zh-CN', { hour12: false })}）`
    : ''
  return parts.join(' · ') + ts
}

/** 人工确认缩略图：优先新 evidence（type=screenshot），回退旧 evidencePath */
function shotUrl(a: AcceptanceAssertion): string | null {
  const p = a.evidence?.path ?? a.evidencePath
  return p ? fileUrl(p) : null
}

/** 验收契约断言 kind → 中文标签 */
function kindLabel(kind: AssertionKind): string {
  switch (kind) {
    case 'file-exists':
      return t('assistant.artifact.kindFileExists')
    case 'texture-ready':
      return t('assistant.artifact.kindTextureReady')
    case 'registry-entry':
      return t('assistant.artifact.kindRegistryEntry')
    case 'build-pass':
      return t('assistant.artifact.kindBuildPass')
    case 'gametest-runtime':
      return t('assistant.artifact.kindGametestRuntime')
    case 'user-confirmation':
      return t('assistant.artifact.kindUserConfirmation')
    case 'runtime-world':
      return t('assistant.artifact.kindRuntimeWorld')
    case 'runtime-inventory':
      return t('assistant.artifact.kindRuntimeInventory')
  }
}

/** 游戏本机绝对路径 → 可渲染 file:// URL（Windows 盘符处理） */
function fileUrl(absPath: string): string | null {
  if (!absPath) return null
  const normalized = absPath.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${normalized}`
  if (normalized.startsWith('/')) return `file://${normalized}`
  return null
}
</script>

<style scoped>
.art-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.art-card {
  border: 1px solid var(--ky-border);
  background: var(--ky-bg-panel);
  border-radius: 8px;
  padding: 8px 10px;
}
.art-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-text);
}
.art-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.art-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
.art-pre {
  margin: 6px 0 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow: auto;
}
.art-list {
  margin: 6px 0 0;
  padding-left: 16px;
  font-size: 11.5px;
  color: var(--ky-text-sub);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
/* 待办清单（todo_write 进度面板） */
.art-todos {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.art-todo {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11.5px;
  color: var(--ky-text-sub);
}
.art-todo--completed .art-todo-text {
  color: var(--ky-text-dim);
  text-decoration: line-through;
}
.art-todo--in_progress .art-todo-text {
  color: var(--ky-text);
}
.art-todo-mark {
  flex-shrink: 0;
  font-size: 10px;
}
.art-todo-text {
  word-break: break-word;
}
.art-list-note {
  color: var(--ky-yellow);
}
.art-fingerprint {
  margin: 6px 0 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--ky-text-dim);
}
.art-files {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.art-files li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
}
.art-file-path {
  flex: 1;
  min-width: 0;
  font-family: var(--ky-font-mono, monospace);
  color: var(--ky-text-sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.art-files li.is-skip .art-file-path {
  color: var(--ky-text-dim);
  text-decoration: line-through;
}
.art-reject {
  margin: 6px 0 0;
  font-size: 11px;
  color: #f9e2af;
}
.art-notes {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: var(--ky-text-sub);
  line-height: 1.5;
}
.art-summary {
  margin: 6px 0 0;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--ky-text-sub);
}
.art-summary-warn {
  color: #f9e2af;
}
.art-empty-line {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--ky-text-dim);
}
.art-shot {
  display: block;
  width: 100%;
  max-height: 180px;
  margin-top: 6px;
  border-radius: 6px;
  border: 1px solid var(--ky-border);
  cursor: zoom-in;
}
.art-shot-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 80px;
  font-size: 11px;
  color: var(--ky-text-dim);
  background: rgba(147, 153, 178, 0.06);
  border-radius: 6px;
}
.art-contract-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.art-assertion {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--ky-text-sub);
}
.art-assertion-icon {
  flex-shrink: 0;
}
.art-assertion-kind {
  flex-shrink: 0;
  padding: 1px 5px;
  font-size: 10px;
  background: var(--ky-surface, rgba(147, 153, 178, 0.1));
  border-radius: 3px;
  color: var(--ky-text-dim);
}
.art-assertion-desc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.art-assertion-actual {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  font-family: var(--ky-font-mono, monospace);
}
.art-assertion-reason {
  font-size: 10.5px;
  color: #f9e2af;
  padding-left: 18px;
}
.art-assertion-evidence {
  font-size: 10.5px;
  color: var(--ky-text-dim);
  font-family: var(--ky-font-mono, monospace);
  padding-left: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.art-assertion--failed .art-assertion-desc {
  color: #f38ba8;
}
.art-assertion--unverified .art-assertion-desc {
  color: var(--ky-text-dim);
}
.art-recheck-btn {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 1.4;
  padding: 1px 6px;
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  background: transparent;
  color: var(--ky-text-dim);
  cursor: pointer;
}
.art-recheck-btn:hover:not(:disabled) {
  color: var(--ky-text);
  border-color: var(--ky-text-dim);
}
.art-recheck-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
/* 产物卡片：贴图「重跑」按钮（资源替换局部重跑） */
.art-regen-btn {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 1.4;
  padding: 1px 6px;
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  background: transparent;
  color: var(--ky-text-dim);
  cursor: pointer;
}
.art-regen-btn:hover {
  color: var(--ky-accent);
  border-color: var(--ky-accent);
}
/* T2：对比 / 撤销按钮（与重跑同款，语义色区分） */
.art-diff-btn,
.art-rollback-btn,
.art-keep-btn {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 1.4;
  padding: 1px 6px;
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  background: transparent;
  color: var(--ky-text-dim);
  cursor: pointer;
}
.art-diff-btn:hover {
  color: var(--ky-accent);
  border-color: var(--ky-accent);
}
.art-rollback-btn:hover:not(:disabled) {
  color: var(--el-color-warning);
  border-color: var(--el-color-warning);
}
.art-rollback-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.art-keep-btn:hover {
  color: var(--ky-accent);
  border-color: var(--ky-accent);
}
/* P3 改动审批：行级统计徽标 + 复核状态 + 批量条 */
.art-file-stat {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 1.4;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: var(--ky-font-mono, monospace);
  color: var(--ky-text-dim);
  background: rgba(147, 153, 178, 0.1);
}
.art-file-state {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 1.4;
  padding: 1px 6px;
  border-radius: 4px;
}
.art-file-state.is-kept {
  color: var(--ky-accent);
  background: rgba(var(--ky-accent-rgb), 0.12);
}
.art-file-state.is-reverted {
  color: var(--ky-text-dim);
  background: rgba(147, 153, 178, 0.12);
}
.art-review-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--ky-border);
}
.art-review-progress {
  flex: 1;
  font-size: 10.5px;
  color: var(--ky-text-dim);
}
.art-review-act {
  flex-shrink: 0;
  font-size: 10.5px;
  line-height: 1.5;
  padding: 1px 8px;
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  background: transparent;
  color: var(--ky-text-dim);
  cursor: pointer;
}
.art-review-act:hover:not(:disabled) {
  color: var(--ky-accent);
  border-color: var(--ky-accent);
}
.art-review-act.is-danger:hover:not(:disabled) {
  color: var(--el-color-warning);
  border-color: var(--el-color-warning);
}
.art-review-act:disabled {
  opacity: 0.45;
  cursor: default;
}
/* 贴图候选画廊 */
.art-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0;
}
.art-thumb {
  position: relative;
  width: 56px;
  height: 56px;
  padding: 0;
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  overflow: hidden;
}
.art-thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}
.art-thumb.is-active {
  border-color: var(--ky-accent);
  box-shadow: 0 0 0 1px var(--ky-accent);
}
.art-thumb-no {
  position: absolute;
  right: 2px;
  bottom: 1px;
  font-size: 10px;
  line-height: 1;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--ky-bg-panel);
  color: var(--ky-text-dim);
}
.art-warn-line {
  margin: 0 0 4px;
  font-size: 11px;
  color: var(--ky-text-dim);
}
.art-tex-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}
.art-tex-hint {
  font-size: 11px;
  color: var(--ky-text-dim);
}
.art-apply-btn {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.5;
  padding: 2px 10px;
  border: 1px solid var(--ky-accent);
  border-radius: 4px;
  background: transparent;
  color: var(--ky-accent);
  cursor: pointer;
}
.art-apply-btn:disabled {
  border-color: var(--ky-border);
  color: var(--ky-text-dim);
  cursor: default;
}
.art-assertion-shot {
  flex-shrink: 0;
  width: 64px;
  height: 36px;
  border-radius: 4px;
  border: 1px solid var(--ky-border);
  cursor: zoom-in;
}
.art-assertion--awaiting-user .art-assertion-desc {
  color: #f9e2af;
}
.art-awaiting-hint {
  margin: 6px 0 0;
  font-size: 10.5px;
  line-height: 1.5;
  color: #f9e2af;
}
</style>
