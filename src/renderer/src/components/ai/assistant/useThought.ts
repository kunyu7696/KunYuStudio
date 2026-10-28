import { computed, nextTick, ref, watch } from 'vue'
import { useAiChatStore } from '../../../stores/aiChat'
import { useAiAgentsStore } from '../../../stores/aiAgents'
import { t } from '../../../i18n'
import type { ChatEntry } from '../../../../../shared/types/ai'

export function useThought() {
  const chat = useAiChatStore()
  const agents = useAiAgentsStore()

  /** 思考过程折叠块展开状态：按气泡 id 记录（手风琴，一次只展开一个）；思考进行中强制展开 */
  const openThoughtId = ref<string | null>(null)
  function toggleThought(id: string): void {
    openThoughtId.value = openThoughtId.value === id ? null : id
  }

  /** 思考过程/工作流时间轴只挂在最后一条助手气泡上（它们属于「当前运行」，不进历史回放） */
  const lastAssistantId = computed<string | null>(() => {
    for (let i = chat.entries.length - 1; i >= 0; i--) {
      if (chat.entries[i].role === 'assistant') return chat.entries[i].id
    }
    return null
  })

  /** 该气泡的思考是否仍在进行（普通问答：有思考流且正文尚未开始；Agent：本轮思维链仍在追加） */
  function thoughtLive(entry: ChatEntry): boolean {
    if (entry.error) return false
    if (entry.reasoning !== undefined) {
      return !entry.reasoningMs && entry.content === ''
    }
    return entry.id === lastAssistantId.value && agents.currentThoughts.length > 0 && agents.running
  }

  /** 折叠块标题：思考中→脉冲「思考中…」；完成→耗时摘要 */
  function thoughtLabel(entry: ChatEntry): string {
    if (thoughtLive(entry)) return t('assistant.thought.live')
    if (entry.reasoning !== undefined) {
      const secs = Math.max(1, Math.round((entry.reasoningMs ?? 0) / 1000))
      return t('assistant.thought.done', { secs })
    }
    return t('assistant.thought.label')
  }

  /** 实时思考文本：普通问答 reasoning / Agent 思维链，用于流式期间把思考块自动滚动到底部（TRAE 行为） */
  const liveThoughtText = computed(() => {
    const id = lastAssistantId.value
    if (!id) return ''
    const e = chat.entries.find((x) => x.id === id)
    if (!e || e.error) return ''
    if (e.reasoning !== undefined) return e.reasoning
    if (agents.running) return agents.currentThoughts.join('\n')
    return ''
  })
  watch(liveThoughtText, () => {
    nextTick(() => {
      const el = document.querySelector('.ap-thought.is-live .ap-thought-body') as HTMLElement | null
      if (el) el.scrollTop = el.scrollHeight
    })
  })

  return {
    openThoughtId,
    lastAssistantId,
    toggleThought,
    thoughtLive,
    thoughtLabel
  }
}
