import { computed, nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useAiChatStore } from '../../../stores/aiChat'
import { useAiAgentsStore } from '../../../stores/aiAgents'
import { useProjectStore } from '../../../stores/project'
import { useSettingsStore } from '../../../stores/settings'
import { pendingReviewPaths } from './useChangeReview'
import { t } from '../../../i18n'
import type { ChatAttachment, ChatEntry } from '../../../../../shared/types/ai'

// ---------- 消息发送（普通问答走 M6 通道；Agent 模式走五 Agent 编排） ----------
export function useChatMessaging() {
  const chat = useAiChatStore()
  const agents = useAiAgentsStore()
  const projectStore = useProjectStore()
  const settings = useSettingsStore()

  const draft = ref('')
  const bodyRef = ref<HTMLElement | null>(null)
  /** 待发送附件（图片/文档），发送成功后清空 */
  const pendingAttachments = ref<ChatAttachment[]>([])
  /** 多 Agent 工程模式开关（关闭即普通厂商问答，轨道不出现） */
  const agentMode = ref(false)

  /**
   * 本次发送是否走 Agent 编排：开关打开且已打开项目。
   * 未打开项目时不进行项目工作——即使开关残留为开，也只走普通厂商问答
   * （面板在主页就是普通聊天框）。
   */
  const agentRunMode = computed(() => agentMode.value && !!projectStore.currentProject)

  const busy = computed(() => chat.sending || agents.running)

  async function send(presetText?: string): Promise<void> {
    // 建议词/选区快捷入口只发预置文本，不夹带当前待传附件
    const isPreset = presetText !== undefined
    const text = (presetText ?? draft.value).trim()
    const attachments = isPreset ? [] : pendingAttachments.value.slice()
    if ((!text && attachments.length === 0) || busy.value) return
    // 严格审查闸门（ai.strictReview 开启时）：上一次 Agent 运行的落盘变更未全部
    // 保留/撤销前，禁止发起下一次运行。必须在清空输入框之前拦截，保住用户已输入内容。
    const gateRunId = agents.runId
    if (agentRunMode.value && settings.ai.strictReview && gateRunId) {
      const pending = pendingReviewPaths(gateRunId, agents.runArtifacts(gateRunId))
      if (pending.length > 0) {
        ElMessage.warning(t('assistant.strictReview.blocked', { n: pending.length }))
        return
      }
    }
    draft.value = ''
    if (!isPreset) pendingAttachments.value = []
    // 等一拍让输入框高度 watcher 先复位（原实现此处同步重置 textarea 高度）
    await nextTick()
    const err = agentRunMode.value
      ? await agents.run(text, attachments)
      : await chat.send(text, attachments)
    if (err) {
      // 仅前置校验失败（未配置厂商等）会返回 err：把附件退回待发区，避免用户重选
      if (!isPreset) pendingAttachments.value = attachments
      ElMessage.warning(err)
    }
  }

  async function stopAll(): Promise<void> {
    if (agents.running) await agents.cancel()
    chat.stop()
  }

  /** 失败条目重试：移除失败气泡并重发其上一条用户消息 */
  async function retry(entry: ChatEntry): Promise<void> {
    const idx = chat.entries.findIndex((e) => e.id === entry.id)
    if (idx < 0) return
    let lastUser = ''
    for (let i = idx - 1; i >= 0; i--) {
      if (chat.entries[i].role === 'user') {
        lastUser = chat.entries[i].content
        break
      }
    }
    chat.entries.splice(idx, 1)
    if (lastUser) {
      const err = await chat.send(lastUser)
      if (err) ElMessage.warning(err)
    }
  }

  // ---------- 自动滚到底部 ----------
  watch(
    () => chat.entries.map((e) => `${e.id}:${e.content.length}:${e.pending ? 1 : 0}:${e.error ? 1 : 0}`).join('|'),
    async () => {
      await nextTick()
      const el = bodyRef.value
      if (el) el.scrollTop = el.scrollHeight
    }
  )

  return {
    draft,
    bodyRef,
    pendingAttachments,
    agentMode,
    busy,
    send,
    stopAll,
    retry
  }
}
