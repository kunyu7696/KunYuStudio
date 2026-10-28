<template>
  <div class="ap-msg" :class="entry.role === 'user' ? 'is-user' : 'is-assistant'">
    <div v-if="entry.pending" class="ap-bubble ap-bubble-pending">
      <span class="ap-dots"><i></i><i></i><i></i></span>
    </div>
    <template v-else>
      <div v-if="entry.error" class="ap-error">
        <span class="ap-error-text">{{ t('assistant.message.failed', { msg: entry.error }) }}</span>
        <el-button size="small" text type="primary" @click="emit('retry', entry)">{{ t('assistant.message.retry') }}</el-button>
      </div>
      <template v-else>
        <div
          v-if="entry.role === 'user'"
          class="ap-bubble ap-bubble-user"
        >
          <div v-if="entry.attachments && entry.attachments.length" class="ap-bubble-files">
            <template v-for="(a, ai) in entry.attachments" :key="`${a.name}-${ai}`">
              <img
                v-if="a.kind === 'image' && a.thumbUrl"
                :src="a.thumbUrl"
                class="ap-bubble-thumb"
                :alt="a.name"
              />
              <div v-else class="ap-bubble-doc">
                <el-icon :size="14"><Document /></el-icon>
                <span class="ap-bubble-doc-name" :title="a.name">{{ a.name }}</span>
                <span class="ap-bubble-doc-size">{{ formatBytes(a.size) }}</span>
              </div>
            </template>
          </div>
          <div v-if="entry.content" class="ap-bubble-text">{{ entry.content }}</div>
        </div>
        <div v-else class="ap-bubble ap-bubble-assistant ap-md-wrap">
          <span v-if="entry.agentIntent" class="ap-agent-tag">
            <el-icon :size="11"><Connection /></el-icon>
            {{ intentTagText(entry.agentIntent) }}
          </span>
          <!-- 思考过程：普通问答 reasoning_content / Agent 思维链，思考中脉冲、完成后折叠为耗时摘要 -->
          <div
            v-if="(isLastAssistant && thoughts.length) || entry.reasoning"
            class="ap-thought"
            :class="{ 'is-open': openThoughtId === entry.id || thoughtLive(), 'is-live': thoughtLive() }"
          >
            <button type="button" class="ap-thought-head" @click.stop="emit('toggleThought', entry.id)">
              <span v-if="thoughtLive()" class="ap-thought-dot"></span>
              <el-icon v-else :size="12" class="ap-thought-icon"><MagicStick /></el-icon>
              <span class="ap-thought-label">{{ thoughtLabel() }}</span>
              <el-icon
                :size="11"
                class="ap-thought-caret"
                :class="{ 'is-open': openThoughtId === entry.id || thoughtLive() }"
              >
                <ArrowRight />
              </el-icon>
            </button>
            <div v-if="openThoughtId === entry.id || thoughtLive()" class="ap-thought-body">
              <p v-if="entry.reasoning" class="ap-thought-text">{{ entry.reasoning }}</p>
              <template v-else>
                <p v-for="(th, i) in thoughts" :key="i" class="ap-thought-text">{{ th }}</p>
              </template>
            </div>
          </div>
          <!-- tool loop 中间态：折叠摘要行「已执行 N 个工具 ›」，点击展开明细；
               执行中自动展开显示进度，全部结束后自动收起 -->
          <div v-if="entry.toolActivities && entry.toolActivities.length" class="ap-tools">
            <button type="button" class="ap-tools-head" @click.stop="toolsOpen = !toolsOpen">
              <span v-if="toolsLive()" class="ap-tools-dot"></span>
              <el-icon v-else :size="12" class="ap-tools-icon"><Tools /></el-icon>
              <span class="ap-tools-label">{{ toolsLabel() }}</span>
              <el-icon :size="11" class="ap-tools-caret" :class="{ 'is-open': toolsExpanded() }">
                <ArrowRight />
              </el-icon>
            </button>
            <div v-if="toolsExpanded()" class="ap-tools-body">
              <div
                v-for="(act, i) in entry.toolActivities"
                :key="i"
                class="ap-tool-row"
                :class="`is-${act.status}`"
              >
                <el-icon class="ap-tool-icon" :size="12">
                  <Loading v-if="act.status === 'running'" class="ap-tool-spin" />
                  <CircleCheckFilled v-else-if="act.status === 'done'" />
                  <CircleCloseFilled v-else />
                </el-icon>
                <span class="ap-tool-name">{{ toolDisplayName(act.name) }}</span>
                <span v-if="act.argsSummary" class="ap-tool-args">{{ act.argsSummary }}</span>
                <span v-if="act.summary && act.status !== 'running'" class="ap-tool-summary">
                  {{ shortSummary(act) }}
                </span>
              </div>
            </div>
          </div>

          <!-- 执行计划：直接内联在内容框里，不做独立卡片层 -->
          <div v-if="entry.agentRunId && planOf(entry.agentRunId)" class="ap-plan-inline">
            <div class="ap-plan-head">
              <el-icon :size="12"><Compass /></el-icon>
              <span class="ap-plan-title">{{ planOf(entry.agentRunId)!.title }}</span>
              <el-tag
                v-for="refItem in planOf(entry.agentRunId)!.references"
                :key="refItem"
                size="small"
                effect="plain"
                class="ap-plan-ref"
              >{{ refItem }}</el-tag>
            </div>
            <pre v-if="planOf(entry.agentRunId)!.body" class="ap-plan-body">{{ planOf(entry.agentRunId)!.body }}</pre>
          </div>
          <div class="ap-md" v-html="renderMd(entry.content)"></div>
          <div class="ap-msg-actions">
            <button
              type="button"
              class="ap-msg-action"
              :data-entry-id="entry.id"
              :title="t('assistant.message.copyTip')"
              @click.stop="emit('copy', entry)"
            >
              <el-icon :size="12"><CopyDocument /></el-icon>
              {{ t('assistant.message.copy') }}
            </button>
          </div>
        </div>
        <!-- 会话结束「运行详情」面板：过程（时间轴）/ 验证（三态）/ 产物（文件·导出），仅当前运行可见 -->
        <div v-if="entry.agentRunId && runArtifactsOf(entry.agentRunId).length" class="ap-run-detail">
          <AgentRunDetailPanel
            :artifacts="runArtifactsOf(entry.agentRunId)"
            :run-id="entry.agentRunId"
            :segments="isLastAssistant ? timelineSegments : []"
            :tool-seg-open="toolSegOpen"
            :outcome="isLastAssistant ? agents.lastOutcome : null"
            :rechecking="rechecking"
            @toggle-seg="(key) => emit('toggleSeg', key)"
            @recheck="onRecheck"
          />
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowRight,
  CircleCheckFilled,
  CircleCloseFilled,
  Compass,
  Connection,
  CopyDocument,
  Document,
  Loading,
  MagicStick,
  Tools
} from '@element-plus/icons-vue'
import { ref } from 'vue'
import { useAiAgentsStore } from '../../../stores/aiAgents'
import type { AcceptanceAssertion, AgentArtifact, AgentIntent } from '../../../../../shared/types/agent'
import type { ChatEntry, ToolActivity } from '../../../../../shared/types/ai'
import { renderMarkdown } from '../../../utils/markdown'
import { formatBytes } from '../../../utils/attachment'
import AgentRunDetailPanel from '../AgentRunDetailPanel.vue'
import type { TimelineSegment } from './useTimeline'
import { useI18n } from '../../../i18n'

const props = defineProps<{
  entry: ChatEntry
  isLastAssistant: boolean
  agentRunning: boolean
  thoughts: string[]
  openThoughtId: string | null
  timelineSegments: TimelineSegment[]
  toolSegOpen: Record<string, boolean>
  rechecking: boolean
}>()

const emit = defineEmits<{
  retry: [entry: ChatEntry]
  toggleThought: [id: string]
  toggleSeg: [key: string]
  copy: [entry: ChatEntry]
  recheck: [runId: string, payload: { artifactId: string; assertion: AcceptanceAssertion }]
}>()

const agents = useAiAgentsStore()
const { t } = useI18n()

/** 本次运行的全部产物（未过滤）：交给「运行详情」面板按 过程/验证/产物 三段切分 */
function runArtifactsOf(runId: string): AgentArtifact[] {
  return agents.runArtifacts(runId)
}

/** 取某次运行的「执行计划」产物，内联显示在助手气泡内 */
function planOf(runId: string): AgentArtifact | undefined {
  return agents.runArtifacts(runId).find((a) => a.kind === 'plan')
}

function intentTagText(intent: string): string {
  const map: Record<AgentIntent, string> = {
    chat: t('assistant.message.intentChat'),
    code: t('assistant.message.intentCode'),
    fix: t('assistant.message.intentFix'),
    verify: t('assistant.message.intentVerify')
  }
  return map[intent as AgentIntent] ?? 'Agent'
}

/** 该气泡的思考是否仍在进行（普通问答：有思考流且正文尚未开始；Agent：本轮思维链仍在追加） */
function thoughtLive(): boolean {
  const entry = props.entry
  if (entry.error) return false
  if (entry.reasoning !== undefined) {
    return !entry.reasoningMs && entry.content === ''
  }
  return props.isLastAssistant && props.thoughts.length > 0 && props.agentRunning
}

/** 折叠块标题：思考中→脉冲「思考中…」；完成→耗时摘要 */
function thoughtLabel(): string {
  if (thoughtLive()) return t('assistant.thought.live')
  if (props.entry.reasoning !== undefined) {
    const secs = Math.max(1, Math.round((props.entry.reasoningMs ?? 0) / 1000))
    return t('assistant.thought.done', { secs })
  }
  return t('assistant.thought.label')
}

/** 工具名 → 本地化显示（简洁版，跟 summarizeToolArgs 配套；复用 assistant.timeline.tool.*） */
function toolDisplayName(name: string): string {
  const map: Record<string, string> = {
    web_fetch: t('assistant.timeline.tool.webFetch'),
    market_search_mods: t('assistant.timeline.tool.marketSearchMods'),
    kb_search: t('assistant.timeline.tool.kbSearch'),
    image_generate: t('assistant.timeline.tool.imageGenerate'),
    run_shell: t('assistant.timeline.tool.runShell'),
    read_file: t('assistant.timeline.tool.readFileShort'),
    write_file: t('assistant.timeline.tool.writeFileShort')
  }
  return map[name] ?? name
}

/** 工具明细手动展开开关（执行中会自动展开，结束后自动收起） */
const toolsOpen = ref(false)

function toolsLive(): boolean {
  return (props.entry.toolActivities ?? []).some((a) => a.status === 'running')
}

function toolsExpanded(): boolean {
  return toolsOpen.value || toolsLive()
}

/** 折叠摘要行标题：执行中→当前工具；完成→「已执行 N 个工具」（含失败计数） */
function toolsLabel(): string {
  const acts = props.entry.toolActivities ?? []
  if (toolsLive()) {
    const cur = acts.find((a) => a.status === 'running')
    return cur
      ? t('assistant.message.toolRunning', { name: toolDisplayName(cur.name) })
      : t('assistant.message.toolRunningGeneric')
  }
  const failed = acts.filter((a) => a.status === 'failed').length
  return failed > 0
    ? t('assistant.message.toolsDoneFail', { n: acts.length, failed })
    : t('assistant.message.toolsDone', { n: acts.length })
}

/** 失败摘要截断：避免整行原始报错（ECONNRESET 等）铺开刷屏 */
function shortSummary(act: ToolActivity): string {
  const s = act.summary ?? ''
  if (act.status === 'failed' && s.length > 40) return s.slice(0, 40) + '…'
  return s
}

function renderMd(content: string): string {
  return renderMarkdown(content)
}

function onRecheck(payload: { artifactId: string; assertion: AcceptanceAssertion }): void {
  if (props.entry.agentRunId) emit('recheck', props.entry.agentRunId, payload)
}
</script>

<style scoped>
/* 消息气泡 */
.ap-msg {
  display: flex;
  flex-direction: column;
}
.ap-msg.is-user {
  align-items: flex-end;
}
.ap-msg.is-assistant {
  align-items: stretch;
}
.ap-bubble {
  max-width: 92%;
  padding: 8px 11px;
  border-radius: 10px;
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
}
.ap-bubble-user {
  background: rgba(var(--ky-accent-rgb), 0.16);
  border: 1px solid rgba(var(--ky-accent-rgb), 0.3);
  color: var(--ky-text);
  border-bottom-right-radius: 3px;
}
/* 助手内容不带卡片边框，直接铺在背景上（思考块/时间轴自带结构） */
.ap-bubble-assistant {
  background: transparent;
  border: none;
  color: var(--ky-text);
  padding: 2px 4px;
  max-width: 100%;
}

/* T7.1：助手气泡内 Markdown（用户气泡仍保持 pre-wrap 纯文本） */
.ap-md-wrap {
  white-space: normal;
  max-width: 100%;
}
.ap-md {
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--ky-text);
  word-break: break-word;
}
.ap-md > :first-child {
  margin-top: 0;
}
.ap-md > :last-child {
  margin-bottom: 0;
}
.ap-md .md-p {
  margin: 5px 0;
}
.ap-md .md-h {
  margin: 10px 0 5px;
  font-weight: 600;
  line-height: 1.4;
}
.ap-md .md-h1 { font-size: 14.5px; }
.ap-md .md-h2 { font-size: 13.5px; }
.ap-md .md-h3,
.ap-md .md-h4,
.ap-md .md-h5,
.ap-md .md-h6 { font-size: 12.5px; }
.ap-md .md-ul,
.ap-md .md-ol {
  margin: 5px 0;
  padding-left: 19px;
}
.ap-md .md-li {
  margin: 2px 0;
}
.ap-md .md-quote {
  margin: 6px 0;
  padding: 3px 10px;
  border-left: 3px solid var(--ky-border);
  color: var(--ky-text-dim);
}
.ap-md .md-hr {
  border: none;
  border-top: 1px solid var(--ky-border);
  margin: 8px 0;
}
.ap-md .md-link {
  color: var(--ky-accent);
  text-decoration: none;
  border-bottom: 1px dashed rgba(var(--ky-accent-rgb), 0.5);
}
.ap-md .md-link:hover {
  border-bottom-style: solid;
}
.ap-md .md-inline-code {
  font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 11.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.16);
  color: var(--ky-text);
}

/* 代码块 */
.ap-md .md-code {
  margin: 7px 0;
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--ky-code-bg);
}
.ap-md .md-code-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px 3px 10px;
  background: rgba(255, 255, 255, 0.05);
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}
.ap-md .md-code-lang {
  font-size: 10.5px;
  color: #8b95a7;
  font-family: 'Cascadia Code', Consolas, monospace;
  letter-spacing: 0.3px;
}
.ap-md .md-copy-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: #8b95a7;
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  transition: color 0.15s ease, background 0.15s ease;
}
.ap-md .md-copy-btn:hover {
  color: #d8dee9;
  background: rgba(255, 255, 255, 0.08);
}
.ap-md .md-pre {
  margin: 0;
  padding: 8px 10px;
  overflow-x: auto;
  background: var(--ky-code-bg);
}
.ap-md .md-code-block {
  display: block;
  font-family: 'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 11.5px;
  line-height: 1.6;
  color: #d8dee9;
  white-space: pre;
  background: transparent;
}
.ap-md .tok-keyword { color: #c792ea; }
.ap-md .tok-string { color: #a5d6a7; }
.ap-md .tok-number { color: #f78c6c; }
.ap-md .tok-comment { color: #7f8c98; font-style: italic; }
.ap-md .tok-anno { color: #ffcb6b; }

/* 思考过程折叠块：展示推理模型的 reasoning_content */
.ap-thought {
  margin: 4px 0 8px;
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  background: rgba(167, 139, 250, 0.06);
  overflow: hidden;
}
.ap-thought-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--ky-text-sub);
  font-size: 12px;
}
.ap-thought-head:hover { color: var(--ky-text); }
.ap-thought-icon { color: #a78bfa; }
.ap-thought-label { font-weight: 500; }
/* 思考进行中：绿色脉冲圆点（TRAE「思考中…」） */
.ap-thought-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ky-accent);
  animation: ap-thought-pulse 1.1s ease-in-out infinite;
}
@keyframes ap-thought-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(var(--ky-accent-rgb), 0.45); }
  50% { opacity: 0.55; box-shadow: 0 0 0 4px rgba(var(--ky-accent-rgb), 0); }
}
.ap-thought.is-live .ap-thought-label { color: var(--ky-text); }
.ap-thought-caret {
  margin-left: auto;
  transition: transform 0.2s ease;
  color: var(--ky-text-sub);
}
.ap-thought-caret.is-open { transform: rotate(90deg); }
.ap-thought-body {
  padding: 0 10px 10px;
  border-top: 1px solid var(--ky-border);
  /* 长思考限高滚动，避免流式推理把气泡撑满整屏；视口相对高度，桌面端约 420px */
  max-height: min(50vh, 420px);
  overflow-y: auto;
}
/* 思考块滚动条：显式可见，提示内容可继续滚动（截断不再像静态死区） */
.ap-thought-body::-webkit-scrollbar { width: 6px; }
.ap-thought-body::-webkit-scrollbar-thumb {
  background: rgba(167, 139, 250, 0.35);
  border-radius: 3px;
}
.ap-thought-body::-webkit-scrollbar-thumb:hover { background: rgba(167, 139, 250, 0.55); }
.ap-thought-body::-webkit-scrollbar-track { background: transparent; }
.ap-thought-text {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ky-text-sub);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--ky-font-mono, monospace);
}
.ap-thought-text:first-child { margin-top: 8px; }

/* tool loop 折叠摘要块：单行摘要 + 点击展开明细，与思考块同款结构 */
.ap-tools {
  margin: 4px 0 8px;
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  background: rgba(127, 127, 127, 0.05);
  overflow: hidden;
}
.ap-tools-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--ky-text-sub);
  font-size: 12px;
}
.ap-tools-head:hover { color: var(--ky-text); }
.ap-tools-icon { color: var(--ky-accent); }
.ap-tools-label { font-weight: 500; }
/* 执行中：脉冲圆点（与思考块一致） */
.ap-tools-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ky-accent);
  animation: ap-thought-pulse 1.1s ease-in-out infinite;
}
.ap-tools-caret {
  margin-left: auto;
  transition: transform 0.2s ease;
  color: var(--ky-text-sub);
}
.ap-tools-caret.is-open { transform: rotate(90deg); }
.ap-tools-body {
  padding: 4px 10px 8px;
  border-top: 1px solid var(--ky-border);
  display: flex;
  flex-direction: column;
  gap: 3px;
  /* 明细限高滚动，避免多次联网调用把气泡撑满整屏 */
  max-height: 200px;
  overflow-y: auto;
}
.ap-tool-row {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  line-height: 1.5;
  padding: 1px 0;
}
.ap-tool-icon {
  flex-shrink: 0;
}
.ap-tool-row.is-running .ap-tool-icon { color: #fbbf24; }
.ap-tool-row.is-done .ap-tool-icon { color: #a6e3a1; }
.ap-tool-row.is-failed .ap-tool-icon { color: var(--ky-text-dim); }
.ap-tool-name {
  color: var(--ky-text-sub);
  font-weight: 500;
  flex-shrink: 0;
}
.ap-tool-args {
  color: var(--ky-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}
.ap-tool-summary {
  color: var(--ky-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}
.ap-tool-spin {
  animation: ap-spin 1s linear infinite;
}
@keyframes ap-spin {
  to { transform: rotate(360deg); }
}

/* 助手气泡 hover 快捷操作 */
.ap-msg-actions {
  display: flex;
  gap: 4px;
  margin-top: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.ap-bubble-assistant:hover .ap-msg-actions {
  opacity: 1;
}
.ap-msg-action {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  appearance: none;
  border: none;
  background: transparent;
  color: var(--ky-text-dim);
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
}
.ap-msg-action:hover {
  color: var(--ky-accent);
  background: rgba(var(--ky-accent-rgb), 0.1);
}

/* 等待动画 */
.ap-bubble-pending {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: var(--ky-bg-panel);
  border: 1px solid var(--ky-border);
}
.ap-dots {
  display: inline-flex;
  gap: 4px;
}
.ap-dots i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ky-text-dim);
  animation: ap-bounce 1.2s ease-in-out infinite;
}
.ap-dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.ap-dots i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes ap-bounce {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

/* 错误条 */
.ap-error {
  max-width: 92%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid rgba(243, 139, 168, 0.4);
  border-radius: 8px;
  background: rgba(243, 139, 168, 0.08);
}
.ap-error-text {
  font-size: 11.5px;
  color: var(--el-color-danger);
}

/* 编排运行标签与消息流产出卡片 */
.ap-agent-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-bottom: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 16px;
  color: var(--ky-accent);
  background: rgba(var(--ky-accent-rgb), 0.12);
  border: 1px solid rgba(var(--ky-accent-rgb), 0.3);
}
/* 执行计划内联在气泡内容里（不再做独立卡片层） */
.ap-plan-inline {
  margin: 0 0 8px;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.06);
  border: 1px solid var(--ky-border);
}
.ap-plan-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ky-text);
}
.ap-plan-title {
  margin-right: 2px;
}
.ap-plan-ref {
  font-size: 10px;
}
.ap-plan-body {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--ky-text-sub);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Cascadia Code', Consolas, monospace;
}
/* 会话结束「运行详情」面板：过程 / 验证 / 产物 */
.ap-run-detail {
  max-width: 100%;
  width: 100%;
  margin-top: 4px;
}

/* 用户气泡内附件 */
.ap-bubble-user {
  white-space: normal;
}
.ap-bubble-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.ap-bubble-files:last-child {
  margin-bottom: 0;
}
.ap-bubble-thumb {
  width: 76px;
  height: 76px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid rgba(var(--ky-accent-rgb), 0.25);
  display: block;
}
.ap-bubble-doc {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 5px 9px;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--ky-text);
  font-size: 11.5px;
}
.ap-bubble-doc .el-icon {
  color: var(--ky-accent);
  flex-shrink: 0;
}
.ap-bubble-doc-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}
.ap-bubble-doc-size {
  color: var(--ky-text-dim);
  font-size: 10px;
  flex-shrink: 0;
}
.ap-bubble-text {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
