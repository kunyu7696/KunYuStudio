<template>
  <aside class="ai-panel" :style="{ width: `${ui.aiPanelWidth}px` }">
    <!-- 左缘拖拽调宽 -->
    <div class="ai-resizer" :title="t('assistant.panel.resizeTip')" @mousedown="startResize" />

    <!-- 头部 -->
    <header class="ap-head">
      <div class="ap-title">
        <el-icon :size="15" class="ap-title-icon"><MagicStick /></el-icon>
        <span>{{ t('assistant.panel.title') }}</span>
      </div>
      <div class="ap-head-actions">
        <el-button size="small" text :title="t('assistant.session.newTip')" @click="onNewSession">
          <el-icon><Plus /></el-icon>
        </el-button>
        <el-popover placement="bottom-end" :width="288" trigger="click" popper-class="ap-sessions-popper">
          <template #reference>
            <el-button size="small" text :title="t('assistant.session.historyTip')">
              <el-icon><ChatDotRound /></el-icon>
            </el-button>
          </template>
          <div class="ap-sess-pop">
            <div class="ap-sess-pop-head">
              <span>{{ t('assistant.session.historyTitle', { n: chat.sessions.length }) }}</span>
              <el-button size="small" text type="primary" @click="onNewSession">
                {{ t('assistant.session.new') }}
              </el-button>
            </div>
            <div class="ap-sess-list">
              <div
                v-for="s in chat.sortedSessions"
                :key="s.id"
                class="ap-sess-item"
                :class="{ 'is-active': s.id === chat.activeSessionId }"
                @click="onSelectSession(s.id)"
              >
                <div class="ap-sess-main">
                  <span class="ap-sess-title">{{ s.title }}</span>
                  <span class="ap-sess-meta">
                    {{ t('assistant.session.entryMeta', { n: s.entries.length, time: formatTime(s.updatedAt) }) }}
                  </span>
                </div>
                <div class="ap-sess-ops" @click.stop>
                  <button type="button" :title="t('assistant.session.renameTip')" @click="onRenameSession(s.id, s.title)">
                    <el-icon :size="13"><EditPen /></el-icon>
                  </button>
                  <button type="button" :title="t('assistant.session.exportTip')" @click="onExportSession(s.id)">
                    <el-icon :size="13"><Download /></el-icon>
                  </button>
                  <button
                    type="button"
                    :title="t('assistant.session.deleteTip')"
                    class="is-danger"
                    @click="onDeleteSession(s.id, s.title)"
                  >
                    <el-icon :size="13"><Close /></el-icon>
                  </button>
                </div>
              </div>
              <p v-if="chat.sessions.length === 0" class="ap-sess-empty">
                {{ t('assistant.session.empty') }}
              </p>
            </div>
          </div>
        </el-popover>
        <el-button
          v-if="chat.entries.length > 0"
          size="small"
          text
          :title="t('assistant.session.clearTip')"
          @click="onClear"
        >
          <el-icon><Delete /></el-icon>
        </el-button>
        <el-button size="small" text :title="t('assistant.panel.manageProvidersTip')" @click="openAiSettings">
          <el-icon><Setting /></el-icon>
        </el-button>
        <el-button size="small" text :title="t('assistant.panel.collapseTip')" @click="ui.toggleAiPanel()">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
    </header>

    <!-- 内置探针关闭时的轻提示：8s 自动消退，开关只在设置页 -->
    <div v-if="observerHintVisible" class="ap-observer">
      <span class="ap-observer-dot"></span>
      <span class="ap-observer-text">{{ t('assistant.observer.hint') }}</span>
      <el-button
        size="small"
        text
        class="ap-observer-close"
        :title="t('assistant.observer.dismissTip')"
        @click="dismissObserverHint"
      >
        <el-icon :size="12"><Close /></el-icon>
      </el-button>
    </div>

    <!-- 运行预算条（P1-9 熔断）：实时显示模型调用/构建用量，临近上限（≥80%）转橙警示 -->
    <div v-if="agentMode && agentAvailable && agents.budget" class="ap-budget" :class="{ 'is-hot': budgetHot }">
      <span class="ap-budget-text" :title="t('assistant.budget.tip', { min: budgetWallMin })">
        {{
          t('assistant.budget.text', {
            callsUsed: agents.budget.modelCallsUsed,
            callsMax: agents.budget.modelCallsMax,
            buildsUsed: agents.budget.gradleBuildsUsed,
            buildsMax: agents.budget.gradleBuildsMax
          })
        }}
      </span>
    </div>

    <!-- 历史任务（任务图跨运行持久化）：默认折叠；interrupted/failed/canceled 可断点续跑 -->
    <div v-if="agentMode && agentAvailable" class="ap-history">
      <button type="button" class="ap-history-head" @click="toggleHistory">
        <el-icon :size="13" class="ap-history-icon"><Clock /></el-icon>
        <span class="ap-history-title">{{ t('assistant.history.title') }}</span>
        <span v-if="agents.history.length > 0" class="ap-history-count">{{ agents.history.length }}</span>
        <el-icon :size="12" class="ap-history-caret">
          <ArrowUp v-if="historyOpen" />
          <ArrowDown v-else />
        </el-icon>
      </button>
      <div v-if="historyOpen" class="ap-history-list">
        <p v-if="agents.history.length === 0" class="ap-history-empty">{{ t('assistant.history.empty') }}</p>
        <div v-for="r in agents.history" :key="r.id" class="ap-history-item">
          <span class="ap-run-dot" :class="runStatusClass(r.status)" :title="runStatusText(r.status)"></span>
          <div class="ap-history-main">
            <span class="ap-history-goal" :title="r.request.message">{{ summarizeRun(r) }}</span>
            <span class="ap-history-meta">{{ intentLabelOf(r.intent) }} · {{ relativeTime(r.updatedAt) }}{{ usageLabelOf(r) }}</span>
          </div>
          <div class="ap-history-ops" @click.stop>
            <button
              v-if="canResume(r.status)"
              type="button"
              :title="t('assistant.history.resumeTip')"
              :disabled="agents.running"
              @click="onResumeRun(r.id)"
            >
              <el-icon :size="13"><RefreshRight /></el-icon>
            </button>
            <button type="button" :title="t('assistant.history.deleteTip')" class="is-danger" @click="onDeleteRun(r.id)">
              <el-icon :size="13"><Close /></el-icon>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 消息区（@click 委托处理 v-html 代码块内的复制按钮） -->
    <div :ref="setBodyRef" class="ap-body" @click="onBodyClick">
      <!-- 未配置任何厂商 -->
      <div v-if="enabledProviders.length === 0" class="ap-empty">
        <el-icon :size="34" class="ap-empty-icon"><MagicStick /></el-icon>
        <p class="ap-empty-title">{{ t('assistant.empty.noProviderTitle') }}</p>
        <p class="ap-empty-desc">{{ t('assistant.empty.noProviderDesc') }}</p>
        <el-button size="small" type="primary" @click="openAiSettings">{{ t('assistant.empty.addProvider') }}</el-button>
      </div>

      <!-- 未选默认厂商 -->
      <div v-else-if="!settings.ai.defaultProviderId" class="ap-empty">
        <el-icon :size="34" class="ap-empty-icon"><ChatDotRound /></el-icon>
        <p class="ap-empty-title">{{ t('assistant.empty.pickProviderTitle') }}</p>
        <p class="ap-empty-desc">{{ t('assistant.empty.pickProviderDesc') }}</p>
      </div>

      <template v-else>
        <div v-if="chat.entries.length === 0" class="ap-welcome">
          <div class="ap-welcome-logo"><el-icon :size="20"><MagicStick /></el-icon></div>
          <p class="ap-welcome-title">{{ welcomeTitle }}</p>
          <p class="ap-welcome-desc">{{ t('assistant.welcome.desc') }}</p>
          <div class="ap-suggestions">
            <button v-for="s in suggestions" :key="s" class="ap-suggestion" @click="send(s)">{{ s }}</button>
          </div>
        </div>

        <AssistantMessageItem
          v-for="entry in chat.entries"
          :key="entry.id"
          :entry="entry"
          :is-last-assistant="entry.id === lastAssistantId"
          :agent-running="agents.running"
          :thoughts="agents.currentThoughts"
          :open-thought-id="openThoughtId"
          :timeline-segments="timelineSegments"
          :tool-seg-open="toolSegOpen"
          :rechecking="recheckingAssertion"
          @retry="retry"
          @toggle-thought="toggleThought"
          @toggle-seg="toggleSeg"
          @copy="copyAnswer"
          @recheck="onRecheckAssertion"
        />
      </template>
    </div>

    <!-- Agent 流水线轨道：放在输入框上方，运行时可见进度；任务结束即复位为待命（不留亮灯） -->
    <AgentTrack v-if="agentMode && agentAvailable" idle-when-stopped />

    <!-- 严格审查闸门：开启后上一次运行的落盘变更未全部复核前，输入区上方常显阻塞条（发送在 send() 内硬拦截） -->
    <div v-if="strictReviewPending.length > 0" class="ap-strict-review">
      <el-icon :size="13" class="ap-strict-review-icon"><Warning /></el-icon>
      <span class="ap-strict-review-text">{{ t('assistant.strictReview.bar', { n: strictReviewPending.length }) }}</span>
      <el-button size="small" text type="primary" @click="onStrictKeepAll">
        {{ t('assistant.review.keepAll') }}
      </el-button>
      <el-button size="small" text type="danger" @click="onStrictRevertAll">
        {{ t('assistant.review.revertAllBtn') }}
      </el-button>
    </div>

    <AssistantInputArea
      v-if="hasProvider"
      ref="inputAreaRef"
      v-model:draft="draft"
      v-model:attachments="pendingAttachments"
      v-model:agent-mode="agentMode"
      :agent-available="agentAvailable"
      :selection-chip="selectionChip"
      :build-error-chip="buildErrorChip"
      :providers="enabledProviders"
      :default-provider-id="settings.ai.defaultProviderId"
      :busy="busy"
      :provider-name="currentProviderName"
      @send="send()"
      @stop="stopAll"
      @explain-selection="askExplainSelection"
      @fix-build="askFixBuild"
      @provider-change="onProviderChange"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, type ComponentPublicInstance } from 'vue'
import {
  ArrowDown,
  ArrowUp,
  ChatDotRound,
  Clock,
  Close,
  Delete,
  Download,
  EditPen,
  MagicStick,
  Plus,
  RefreshRight,
  Setting,
  Warning
} from '@element-plus/icons-vue'
import { useI18n } from '../../i18n'
import { useSettingsStore } from '../../stores/settings'
import { useAiChatStore } from '../../stores/aiChat'
import { useAiAgentsStore } from '../../stores/aiAgents'
import { useAiMonitorStore } from '../../stores/aiMonitor'
import { useUiStore } from '../../stores/ui'
import { useProjectStore } from '../../stores/project'
import AgentTrack from './AgentTrack.vue'
import AssistantMessageItem from './assistant/AssistantMessageItem.vue'
import AssistantInputArea from './assistant/AssistantInputArea.vue'
import { useChatMessaging } from './assistant/useChatMessaging'
import { pendingReviewPaths, useChangeReview } from './assistant/useChangeReview'
import { useContextChips } from './assistant/useContextChips'
import { useObserverBanner } from './assistant/useObserverBanner'
import { useThought } from './assistant/useThought'
import { useTimeline } from './assistant/useTimeline'
import { useAgentBudget } from './assistant/useAgentBudget'
import { useAgentHistory } from './assistant/useAgentHistory'
import { useArtifacts } from './assistant/useArtifacts'
import { useMarkdown } from './assistant/useMarkdown'
import { useSessionManagement } from './assistant/useSessionManagement'
import { useSettingsLink } from './assistant/useSettingsLink'
import { useResize } from './assistant/useResize'

const { t } = useI18n()
const settings = useSettingsStore()
const chat = useAiChatStore()
const agents = useAiAgentsStore()
const monitor = useAiMonitorStore()
const ui = useUiStore()
const projectStore = useProjectStore()

/**
 * Agent 工程模式只在打开项目后可用：没有项目时面板是一个普通聊天框
 * （不显示轨道/预算/历史任务，发送也只走厂商问答），避免在主页就发起会写盘的项目工作。
 */
const agentAvailable = computed(() => !!projectStore.currentProject)

onMounted(() => {
  void monitor.init()
})

const inputAreaRef = ref<InstanceType<typeof AssistantInputArea> | null>(null)

// ---------- 消息发送（普通问答走 M6 通道；Agent 模式走五 Agent 编排） ----------
const { draft, bodyRef, pendingAttachments, agentMode, busy, send, stopAll, retry } = useChatMessaging()
// 函数式 ref：等价于字符串 ref="bodyRef"，同时让脚本侧保有对 bodyRef 的引用
const setBodyRef = (el: Element | ComponentPublicInstance | null): void => {
  bodyRef.value = el as HTMLElement | null
}

// ---------- 严格审查闸门：未复核完的落盘变更在输入区上方常显阻塞条 ----------
const changeReview = useChangeReview()
/** 当前仍 pending 的落盘文件；空数组 = 闸门放行。运行进行中不显示（pending 属于在途产出） */
const strictReviewPending = computed<string[]>(() => {
  const runId = agents.runId
  if (!runId || !settings.ai.strictReview || !agentMode.value || !agentAvailable.value || agents.running) return []
  return pendingReviewPaths(runId, agents.runArtifacts(runId))
})

function onStrictKeepAll(): void {
  changeReview.keepAll(agents.runId, strictReviewPending.value)
}

async function onStrictRevertAll(): Promise<void> {
  await changeReview.revertAll(agents.runId, strictReviewPending.value)
}

// ---------- T70/T7.3：三加载器欢迎语、建议词与上下文快捷入口 ----------
const { welcomeTitle, suggestions, selectionChip, buildErrorChip, askExplainSelection, askFixBuild } =
  useContextChips({ send })

// ---------- 内置探针关闭时的轻提示（8s 自动消退；开关在设置页）----------
// 注意：必须放在 agentMode 声明之后（TDZ，曾致启动黑屏）
const { observerHintVisible, dismissObserverHint } = useObserverBanner({ agentMode })

// ---------- 思考过程折叠块 ----------
const { openThoughtId, lastAssistantId, toggleThought } = useThought()

// ---------- 工作流时间轴 ----------
const { timelineSegments, toolSegOpen, toggleSeg } = useTimeline()

// ---------- 运行预算（P1-9 熔断实时用量） ----------
const { budgetHot, budgetWallMin } = useAgentBudget()

// ---------- 历史任务（任务图跨运行持久化 + 断点续跑） ----------
const {
  historyOpen,
  toggleHistory,
  runStatusClass,
  runStatusText,
  canResume,
  summarizeRun,
  intentLabelOf,
  usageLabelOf,
  relativeTime,
  onResumeRun,
  onDeleteRun
} = useAgentHistory()

// ---------- 编排产出卡片 / 单项断言复验 ----------
const { recheckingAssertion, onRecheckAssertion } = useArtifacts()

// ---------- T7.1：Markdown 渲染 + 代码块/整段复制 ----------
const { onBodyClick, copyAnswer } = useMarkdown()

// ---------- T7.4：多会话管理 ----------
const { formatTime, onNewSession, onSelectSession, onRenameSession, onDeleteSession, onClear, onExportSession } =
  useSessionManagement({ focusInput: () => inputAreaRef.value?.focus() })

// ---------- 厂商 / 设置跳转 ----------
const { enabledProviders, hasProvider, currentProviderName, onProviderChange, openAiSettings } = useSettingsLink()

// ---------- 左缘拖拽调宽 ----------
const { startResize } = useResize()
</script>

<style scoped>
.ai-panel {
  position: relative;
  flex-shrink: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-sidebar);
  border-left: 1px solid var(--ky-border);
  min-height: 0;
}

.ai-resizer {
  position: absolute;
  left: -2px;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  z-index: 5;
}
.ai-resizer:hover {
  background: rgba(var(--ky-accent-rgb), 0.35);
}

/* 头部 */
.ap-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 6px 14px;
  flex-shrink: 0;
}
.ap-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
}
.ap-title-icon {
  color: var(--ky-accent);
}
.ap-head-actions {
  display: flex;
  align-items: center;
}

/* 消息区 */
.ap-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

/* 空状态 / 欢迎 */
.ap-empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 12px;
}
.ap-empty-icon {
  color: var(--ky-accent);
  opacity: 0.8;
  margin-bottom: 4px;
}
.ap-empty-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
}
.ap-empty-desc {
  margin: 0 0 8px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--ky-text-dim);
}
.ap-welcome {
  margin: auto;
  padding: 16px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.ap-welcome-logo {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--ky-accent-rgb), 0.14);
  border: 1px solid rgba(var(--ky-accent-rgb), 0.3);
  color: var(--ky-accent);
  margin-bottom: 12px;
}
.ap-welcome-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--ky-text);
}
.ap-welcome-desc {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--ky-text-dim);
}
.ap-suggestions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 320px;
}
.ap-suggestion {
  text-align: left;
  padding: 9px 12px;
  border: 1px solid var(--ky-border);
  border-radius: 10px;
  background: var(--ky-bg-panel);
  color: var(--ky-text-sub);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}
.ap-suggestion:hover {
  border-color: var(--ky-accent);
  color: var(--ky-accent);
  background: rgba(var(--ky-accent-rgb), 0.06);
}

/* T7.4：历史会话弹层 */
.ap-sess-pop {
  margin: -12px;
}
.ap-sess-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-text);
  border-bottom: 1px solid var(--ky-border);
}
.ap-sess-list {
  max-height: 320px;
  overflow-y: auto;
  padding: 4px;
}
.ap-sess-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
}
.ap-sess-item:hover {
  background: var(--ky-bg-hover, rgba(127, 127, 127, 0.1));
}
.ap-sess-item.is-active {
  background: var(--ky-accent-bg, rgba(64, 158, 255, 0.12));
}
.ap-sess-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ap-sess-title {
  font-size: 12.5px;
  color: var(--ky-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-sess-meta {
  font-size: 11px;
  color: var(--ky-text-sub);
}
.ap-sess-ops {
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.ap-sess-item:hover .ap-sess-ops {
  display: flex;
}
.ap-sess-ops button {
  appearance: none;
  border: none;
  background: transparent;
  padding: 3px;
  border-radius: 4px;
  color: var(--ky-text-sub);
  cursor: pointer;
  display: inline-flex;
}
.ap-sess-ops button:hover {
  color: var(--ky-accent);
  background: var(--ky-bg-panel);
}
.ap-sess-ops button.is-danger:hover {
  color: var(--el-color-danger);
}
.ap-sess-empty {
  text-align: center;
  font-size: 12px;
  color: var(--ky-text-sub);
  padding: 18px 0;
}

/* ---------- 内置探针关闭时的轻提示（8s 自动消退） ---------- */
.ap-observer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px 14px;
  border-top: 1px solid var(--ky-border);
  background: rgba(230, 162, 60, 0.08);
}
.ap-observer-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e6a23c;
  box-shadow: 0 0 0 3px rgba(230, 162, 60, 0.18);
  animation: ap-observer-pulse 1.6s ease-in-out infinite;
}
@keyframes ap-observer-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 3px rgba(230, 162, 60, 0.18);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(230, 162, 60, 0.08);
  }
}
.ap-observer-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--ky-text-sub);
}
.ap-observer-close {
  flex-shrink: 0;
}

/* ---------- 运行预算条（P1-9 熔断实时用量） ---------- */
.ap-budget {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 4px 14px;
  border-top: 1px solid var(--ky-border);
  background: rgba(var(--ky-accent-rgb), 0.05);
}
.ap-budget-text {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--ky-text-sub);
  font-variant-numeric: tabular-nums;
}
.ap-budget.is-hot {
  background: rgba(230, 162, 60, 0.1);
}
.ap-budget.is-hot .ap-budget-text {
  color: #e6a23c;
}

/* ---------- 严格审查闸门阻塞条（未复核完常显于输入区上方） ---------- */
.ap-strict-review {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border-top: 1px solid var(--ky-border);
  background: rgba(230, 162, 60, 0.1);
}
.ap-strict-review-icon {
  flex-shrink: 0;
  color: var(--el-color-warning);
}
.ap-strict-review-text {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--ky-text-sub);
}

/* ---------- 历史任务（任务图持久化 + 断点续跑） ---------- */
.ap-history {
  flex-shrink: 0;
  border-top: 1px solid var(--ky-border);
}
.ap-history-head {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: var(--ky-text-sub);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}
.ap-history-head:hover {
  color: var(--ky-text);
  background: var(--ky-bg-hover, rgba(127, 127, 127, 0.08));
}
.ap-history-icon {
  color: var(--ky-accent);
}
.ap-history-title {
  font-weight: 600;
}
.ap-history-count {
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 15px;
  color: var(--ky-text-dim);
  background: var(--ky-bg-panel);
  border: 1px solid var(--ky-border);
}
.ap-history-caret {
  margin-left: auto;
  color: var(--ky-text-dim);
}
.ap-history-list {
  max-height: 200px;
  overflow-y: auto;
  padding: 2px 6px 6px;
}
.ap-history-empty {
  margin: 0;
  padding: 10px 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--ky-text-sub);
}
.ap-history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
}
.ap-history-item:hover {
  background: var(--ky-bg-hover, rgba(127, 127, 127, 0.1));
}
/* 状态圆点（is-* 约定：is-ok 绿 / is-busy 黄脉冲 / is-fail 红 / is-warn 黄（无法判定） / is-idle 灰） */
.ap-run-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--ky-text-dim);
}
.ap-run-dot.is-ok {
  background: var(--ky-accent);
  box-shadow: 0 0 5px rgba(var(--ky-accent-rgb), 0.6);
}
.ap-run-dot.is-busy {
  background: var(--el-color-warning);
  animation: ap-run-pulse 1.2s ease-in-out infinite;
}
.ap-run-dot.is-fail {
  background: var(--el-color-danger);
}
.ap-run-dot.is-warn {
  background: var(--el-color-warning);
}
.ap-run-dot.is-idle {
  background: var(--ky-text-dim);
  opacity: 0.55;
}
@keyframes ap-run-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; box-shadow: 0 0 6px rgba(230, 162, 60, 0.7); }
}
.ap-history-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ap-history-goal {
  font-size: 12px;
  color: var(--ky-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-history-meta {
  font-size: 10.5px;
  color: var(--ky-text-sub);
}
.ap-history-ops {
  display: none;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.ap-history-item:hover .ap-history-ops {
  display: flex;
}
.ap-history-ops button {
  appearance: none;
  border: none;
  background: transparent;
  padding: 3px;
  border-radius: 4px;
  color: var(--ky-text-sub);
  cursor: pointer;
  display: inline-flex;
}
.ap-history-ops button:hover {
  color: var(--ky-accent);
  background: var(--ky-bg-panel);
}
.ap-history-ops button.is-danger:hover {
  color: var(--el-color-danger);
}
.ap-history-ops button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>

<!-- popper 被 teleport 到 body，需全局样式覆盖背景 -->
<style>
.ap-tier-popover.el-popper {
  background: var(--ky-bg-sidebar) !important;
  border: 1px solid var(--ky-border) !important;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5) !important;
  padding: 8px !important;
}
.ap-tier-popover.el-popper .el-popper__arrow::before {
  background: var(--ky-bg-sidebar) !important;
  border: 1px solid var(--ky-border) !important;
}
</style>
