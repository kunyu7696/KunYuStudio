import { computed } from 'vue'
import { useAiAgentsStore } from '../../../stores/aiAgents'

// ---------- 运行预算（P1-9 熔断实时用量） ----------
export function useAgentBudget() {
  const agents = useAiAgentsStore()

  /** 模型调用或构建用量达到上限 80% 视为临近熔断，预算条转橙警示 */
  const budgetHot = computed(() => {
    const b = agents.budget
    if (!b) return false
    return b.modelCallsUsed >= b.modelCallsMax * 0.8 || b.gradleBuildsUsed >= b.gradleBuildsMax * 0.8
  })
  /** 墙钟上限（分钟），预算条 tooltip 用 */
  const budgetWallMin = computed(() => Math.round((agents.budget?.wallMaxMs ?? 0) / 60000))

  return {
    budgetHot,
    budgetWallMin
  }
}
