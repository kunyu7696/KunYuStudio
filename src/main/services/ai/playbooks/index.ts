/**
 * Playbook 注册表与选择/渲染。
 *
 * 选择：按 关键词(+1)/contentTypes(+3)/intent(+2)/projectType(+2) 打分，
 * 达到阈值（默认 3）才注入，最多 3 条、分数降序（同分按 id 稳定序）。
 * 渲染：紧凑五段（路由/流程/验收/失败），注入 generate 阶段 system prompt。
 * 纯函数零依赖，直接可单测。
 */
import type { Playbook, PlaybookSelectionInput } from './types'
import { contentAuthoringPlaybook } from './contentAuthoring'
import { textureVisualPlaybook } from './textureVisual'
import { codeChangePlaybook } from './codeChange'
import { loaderPlatformPlaybook } from './loaderPlatform'
import { gameTestPlaybook } from './gameTest'
import { knowledgeMarketPlaybook } from './knowledgeMarket'
import { buildRepairPlaybook } from './buildRepair'
import { performanceDesignPlaybook } from './performanceDesign'

/** 全部 playbook（注册顺序即同分时的稳定次序参考） */
export const PLAYBOOKS: readonly Playbook[] = [
  contentAuthoringPlaybook,
  textureVisualPlaybook,
  codeChangePlaybook,
  loaderPlatformPlaybook,
  gameTestPlaybook,
  knowledgeMarketPlaybook,
  buildRepairPlaybook,
  performanceDesignPlaybook
]

const DEFAULT_THRESHOLD = 3
const DEFAULT_MAX = 3

/** 单条 playbook 对本次任务的命中分 */
export function scorePlaybook(pb: Playbook, input: PlaybookSelectionInput): number {
  let score = 0
  const lower = (input.message ?? '').toLowerCase()
  for (const t of pb.triggers) {
    if (t && lower.includes(t.toLowerCase())) score += 1
  }
  for (const ct of input.contentTypes ?? []) {
    if (pb.contentTypes?.includes(ct.toLowerCase())) score += 3
  }
  if (input.intent && pb.intents?.some((i) => i === input.intent)) score += 2
  if (input.projectType && pb.projectTypes?.includes(input.projectType)) score += 2
  return score
}

/** 选择本次任务命中的 playbook（达阈值、分数降序、最多 max 条） */
export function selectPlaybooks(input: PlaybookSelectionInput): Playbook[] {
  const threshold = input.threshold ?? DEFAULT_THRESHOLD
  const max = input.max ?? DEFAULT_MAX
  return PLAYBOOKS.map((pb) => ({ pb, score: scorePlaybook(pb, input) }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score || a.pb.id.localeCompare(b.pb.id))
    .slice(0, max)
    .map((s) => s.pb)
}

/**
 * 渲染为 system prompt 注入段。空命中返回空串（调用方自然跳过，不产生空段落）。
 * 每条 playbook 压缩为四行（路由/流程/验收/失败），避免 prompt 膨胀（教训）。
 */
export function renderPlaybookSection(playbooks: readonly Playbook[]): string {
  if (playbooks.length === 0) return ''
  const blocks = playbooks.map((pb) =>
    [
      `◆ ${pb.title}`,
      `路由：${pb.route.note}`,
      `流程：${pb.workflow.map((w, i) => `${i + 1})${w}`).join(' ')}`,
      `验收：${pb.acceptanceGates.join('；')}`,
      `失败：${pb.failureContract.join('；')}`
    ].join('\n')
  )
  return (
    `【任务规程】本次命中 ${playbooks.length} 条 playbook，按其工具路由/验收门/失败契约执行：\n` +
    blocks.join('\n')
  )
}
