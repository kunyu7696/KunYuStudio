import type { AgentRunRequest } from '../../../../shared/types/agent'
import type { ResolvedProject } from './types'

/**
 * 请求组合 vs 工程实际组合一致性检查。
 *
 * 修复前 AgentRunRequest.loader/mcVersion 注释写「仅 fabric/1.20.1 激活，
 * 其余组合被拒绝并提示」，实测既不拒绝也不提示，用户会以为能跨组合生成。
 *
 * 现状：17 个组合全激活（isComboActive 不再拒绝），但请求组合与工程实际组合
 * 不一致时仍要提示用户——避免用户在 fabric 工程里请求 neoforge 1.21.1 后
 * 误以为生成产物会针对 neoforge 1.21.1 适配（实际还是按工程组合走）。
 *
 * @returns 不一致字段清单；null = 一致或无项目可比
 */
export function detectComboMismatch(
  request: AgentRunRequest,
  project: ResolvedProject | null
): { loader?: string; mcVersion?: string } | null {
  if (!project) return null
  const mismatch: { loader?: string; mcVersion?: string } = {}
  if (project.loader !== null && project.loader !== request.loader) {
    mismatch.loader = request.loader
  }
  if (project.mcVersion !== request.mcVersion) {
    mismatch.mcVersion = request.mcVersion
  }
  return Object.keys(mismatch).length > 0 ? mismatch : null
}
