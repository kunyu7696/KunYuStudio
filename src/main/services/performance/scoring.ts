/**
 * 五维评分引擎 + 建议生成（纯函数，同输入必得同输出）。
 *
 * 扣分模型（确定性）：critical 35 / high 20 / medium 10 / low 4，
 * 每条 finding 按其规则映射的维度扣分；overall 汇总全部扣分。
 */
import type {
  AdviceAction,
  AdviceSeverity,
  ProfileAdvice,
  ProfileScore,
  ProfileSeverity,
  ScoreSet
} from '../../../shared/schemas/performance/profile'
import type { Finding } from './rules'

type Dimension = keyof ScoreSet

const DIMENSIONS: Dimension[] = ['cpuEfficiency', 'memoryEfficiency', 'tickImpact', 'compatibility']

/** 规则 → 影响维度 */
const RULE_DIMENSIONS: Record<string, Dimension[]> = {
  R01: ['cpuEfficiency', 'tickImpact'],
  R02: ['compatibility'],
  R03: ['tickImpact', 'memoryEfficiency'],
  R04: ['memoryEfficiency'],
  R05: ['memoryEfficiency'],
  R06: ['memoryEfficiency', 'compatibility'],
  R07: ['compatibility'],
  R08: ['compatibility', 'tickImpact'],
  R09: ['cpuEfficiency'],
  R10: ['memoryEfficiency'],
  R11: ['compatibility'],
  R12: ['compatibility']
}

const PENALTY: Record<AdviceSeverity, number> = {
  critical: 35,
  high: 20,
  medium: 10,
  low: 4
}

/** 规则 → 一键优化动作（默认 manual，需改代码） */
const RULE_ACTION: Partial<Record<string, AdviceAction>> = {
  R11: 'remove',
  R12: 'disable'
}

export interface ScoredResult {
  score: ProfileScore
  advice: ProfileAdvice[]
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function severityOfOverall(overall: number): ProfileSeverity {
  if (overall >= 80) return 'good'
  if (overall >= 50) return 'warn'
  return 'bad'
}

export function scoreFindings(findings: Finding[]): ScoredResult {
  const penaltyByDimension = new Map<Dimension, number>()
  let overallPenalty = 0

  for (const finding of findings) {
    const penalty = PENALTY[finding.severity] ?? 0
    overallPenalty += penalty
    const dims = RULE_DIMENSIONS[finding.ruleId] ?? ['compatibility']
    for (const dimension of dims) {
      penaltyByDimension.set(dimension, (penaltyByDimension.get(dimension) ?? 0) + penalty)
    }
  }

  const scores: ScoreSet = {
    overall: clampScore(100 - overallPenalty),
    cpuEfficiency: clampScore(100 - (penaltyByDimension.get('cpuEfficiency') ?? 0)),
    memoryEfficiency: clampScore(100 - (penaltyByDimension.get('memoryEfficiency') ?? 0)),
    tickImpact: clampScore(100 - (penaltyByDimension.get('tickImpact') ?? 0)),
    compatibility: clampScore(100 - (penaltyByDimension.get('compatibility') ?? 0))
  }

  const ruleIds = Array.from(new Set(findings.map((f) => f.ruleId))).sort()
  const score: ProfileScore = {
    scores,
    severity: severityOfOverall(scores.overall),
    tags: ruleIds.length === 0 ? ['clean'] : ruleIds
  }

  const advice: ProfileAdvice[] = findings.map((finding, index) => ({
    id: `${finding.ruleId}-${index + 1}`,
    ruleId: finding.ruleId,
    severity: finding.severity,
    source: finding.source,
    message: finding.message,
    evidence: finding.evidence.map((e) => e.detail).join('；'),
    action: RULE_ACTION[finding.ruleId] ?? 'manual',
    actionDetail: Array.from(new Set(finding.evidence.map((e) => e.modId).filter((x): x is string => !!x))).join(',')
  }))

  return { score, advice }
}

export { DIMENSIONS }
