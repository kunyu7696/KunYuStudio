import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useAiAgentsStore } from '../../../stores/aiAgents'
import { t } from '../../../i18n'
import type { AcceptanceAssertion, AgentArtifact } from '../../../../../shared/types/agent'

export function useArtifacts() {
  const agents = useAiAgentsStore()

  /** 气泡下嵌入的编排产出卡片（文件变更/构建结论/验收契约/截图/跳过说明；plan 已内联到气泡内） */
  const EMBED_KINDS = new Set(['file-change', 'build-result', 'contract', 'probe-screenshot', 'error'])
  function messageArtifacts(runId: string): AgentArtifact[] {
    return agents.runArtifacts(runId).filter((a) => EMBED_KINDS.has(a.kind))
  }

  /** 取某次运行的「执行计划」产物，内联显示在助手气泡内 */
  function planOf(runId: string): AgentArtifact | undefined {
    return agents.runArtifacts(runId).find((a) => a.kind === 'plan')
  }

  /**
   * 单项断言复验（证据链 #6）：调用主进程重跑该校验，返回的契约 artifact 同 id 替换。
   * build-pass 会真实执行一次 Gradle clean build（30min 超时），按钮全程禁用防重入。
   */
  const recheckingAssertion = ref(false)
  async function onRecheckAssertion(
    runId: string,
    payload: { artifactId: string; assertion: AcceptanceAssertion }
  ): Promise<void> {
    if (recheckingAssertion.value) return
    recheckingAssertion.value = true
    try {
      const res = await window.api.agent.recheckAssertion(runId, payload.artifactId, payload.assertion)
      if (res.ok) {
        agents.updateArtifact(runId, res.artifact)
        ElMessage.success(t('assistant.artifact.recheckDone'))
      } else {
        ElMessage.warning(res.errorMessage)
      }
    } catch (err) {
      ElMessage.error(t('assistant.artifact.recheckFailed', { msg: (err as Error).message }))
    } finally {
      recheckingAssertion.value = false
    }
  }

  return {
    messageArtifacts,
    planOf,
    recheckingAssertion,
    onRecheckAssertion
  }
}
