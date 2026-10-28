import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAiAgentsStore } from '../../../stores/aiAgents'
import { t } from '../../../i18n'
import type { AgentRunRecord, AgentRunStatus } from '../../../../../shared/types/agent'
import { formatTime } from './useSessionManagement'

export function useAgentHistory() {
  const agents = useAiAgentsStore()

  /** 历史区块默认折叠，首次展开时拉取最近 20 条 */
  const historyOpen = ref(false)

  function toggleHistory(): void {
    historyOpen.value = !historyOpen.value
    if (historyOpen.value) void agents.loadHistory()
  }

  /** 状态圆点：is-ok 完成 / is-busy 运行中 / is-fail 失败或中断 / is-warn 无法判定 / is-idle 取消 */
  function runStatusClass(status: AgentRunStatus): string {
    switch (status) {
      case 'completed':
        return 'is-ok'
      case 'running':
        return 'is-busy'
      case 'failed':
      case 'interrupted':
        return 'is-fail'
      case 'inconclusive':
        return 'is-warn'
      default:
        return 'is-idle'
    }
  }

  function runStatusText(status: AgentRunStatus): string {
    switch (status) {
      case 'running':
        return t('assistant.history.statusRunning')
      case 'completed':
        return t('assistant.history.statusCompleted')
      case 'failed':
        return t('assistant.history.statusFailed')
      case 'canceled':
        return t('assistant.history.statusCanceled')
      case 'interrupted':
        return t('assistant.history.statusInterrupted')
      case 'inconclusive':
        return t('assistant.history.statusInconclusive')
    }
  }

  /** 可续跑：有断点意义的未完成状态（completed 无需续跑） */
  function canResume(status: AgentRunStatus): boolean {
    return (
      status === 'interrupted' ||
      status === 'failed' ||
      status === 'canceled' ||
      status === 'inconclusive'
    )
  }

  /** 行摘要：优先断点计划目标，回退请求消息首行 */
  function summarizeRun(r: AgentRunRecord): string {
    const goal = r.checkpoint?.plan?.goal?.trim()
    const text = goal || r.request.message.trim() || t('assistant.history.emptyMessage')
    return text.split('\n')[0].slice(0, 60)
  }

  function intentLabelOf(intent: string): string {
    switch (intent) {
      case 'chat':
        return t('assistant.history.intentChat')
      case 'code':
        return t('assistant.history.intentCode')
      case 'fix':
        return t('assistant.history.intentFix')
      case 'verify':
        return t('assistant.history.intentVerify')
      default:
        return intent
    }
  }

  /** 用量摘要（usage 落库后 token 可查）；旧记录/厂商未返回 usage 时如实留空 */
  function usageLabelOf(r: AgentRunRecord): string {
    const u = r.usage
    if (!u) return ''
    const parts: string[] = []
    if (u.modelCalls > 0) parts.push(t('assistant.history.usageCalls', { n: u.modelCalls }))
    if (u.totalTokens > 0) {
      parts.push(
        u.totalTokens >= 10000
          ? t('assistant.history.usageTokensK', { n: (u.totalTokens / 1000).toFixed(1) })
          : t('assistant.history.usageTokens', { n: u.totalTokens })
      )
    }
    return parts.length > 0 ? ` · ${parts.join(' / ')}` : ''
  }

  function relativeTime(ts: number): string {
    const diff = Date.now() - ts
    const min = Math.floor(diff / 60000)
    if (min < 1) return t('settings.ai.agoJust')
    if (min < 60) return t('settings.ai.agoMinutes', { n: min })
    const hour = Math.floor(min / 60)
    if (hour < 24) return t('settings.ai.agoHours', { n: hour })
    const day = Math.floor(hour / 24)
    if (day < 7) return t('settings.ai.agoDays', { n: day })
    return formatTime(ts)
  }

  async function onResumeRun(id: string): Promise<void> {
    const err = await agents.resumeRun(id)
    if (err) ElMessage.warning(err)
  }

  async function onDeleteRun(id: string): Promise<void> {
    try {
      await ElMessageBox.confirm(t('assistant.history.deleteConfirm'), t('assistant.history.deleteTitle'), {
        type: 'warning',
        confirmButtonText: t('assistant.deleteBtn'),
        cancelButtonText: t('common.cancel')
      })
    } catch {
      return
    }
    await agents.deleteRun(id)
  }

  return {
    agents,
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
  }
}
