/**
 * 五维评分引擎测试：确定性、满分兜底、扣分映射、建议动作。
 */
import { describe, expect, it } from 'vitest'
import { scoreFindings, severityOfOverall } from '../performance/scoring'
import type { Finding } from '../performance/rules'

function finding(ruleId: string, severity: Finding['severity'], detail = '证据', source?: Finding['source']): Finding {
  return {
    ruleId,
    severity,
    source: source ?? 'static',
    message: `问题 ${ruleId}`,
    evidence: [{ detail }]
  }
}

describe('无问题', () => {
  const result = scoreFindings([])

  it('五维全部满分', () => {
    expect(result.score.scores).toEqual({
      overall: 100,
      cpuEfficiency: 100,
      memoryEfficiency: 100,
      tickImpact: 100,
      compatibility: 100
    })
    expect(result.score.severity).toBe('good')
  })

  it('tags 标记 clean，无建议', () => {
    expect(result.score.tags).toEqual(['clean'])
    expect(result.advice).toEqual([])
  })
})

describe('确定性（TR-7.1）', () => {
  const input = [
    finding('R01', 'critical'),
    finding('R04', 'medium'),
    finding('R12', 'low')
  ]
  it('两次评分深度相等', () => {
    const a = scoreFindings(input)
    const b = scoreFindings(input)
    expect(a).toEqual(b)
  })
})

describe('扣分映射', () => {
  it('R01(critical) 同时扣 cpu/tick/overall', () => {
    const { scores } = scoreFindings([finding('R01', 'critical')]).score
    expect(scores.overall).toBe(65)
    expect(scores.cpuEfficiency).toBe(65)
    expect(scores.tickImpact).toBe(65)
    // 不影响内存维度
    expect(scores.memoryEfficiency).toBe(100)
  })

  it('R04(medium) 只扣内存维度', () => {
    const { scores } = scoreFindings([finding('R04', 'medium')]).score
    expect(scores.memoryEfficiency).toBe(90)
    expect(scores.overall).toBe(90)
    expect(scores.compatibility).toBe(100)
  })

  it('多条扣分有 0 分下限', () => {
    const findings = [
      finding('R11', 'critical'),
      finding('R11', 'critical'),
      finding('R11', 'critical'),
      finding('R02', 'high')
    ]
    const { scores } = scoreFindings(findings).score
    expect(scores.compatibility).toBe(0)
    expect(scores.overall).toBe(0)
  })
})

describe('severity 阈值', () => {
  it('80 good / 50 warn / 49 bad', () => {
    expect(severityOfOverall(100)).toBe('good')
    expect(severityOfOverall(80)).toBe('good')
    expect(severityOfOverall(50)).toBe('warn')
    expect(severityOfOverall(49)).toBe('bad')
  })

  it('一个 high 问题 overall=80 仍 good；两个 high → 60 warn', () => {
    expect(scoreFindings([finding('R05', 'high')]).score.severity).toBe('good')
    expect(scoreFindings([finding('R05', 'high'), finding('R05', 'high')]).score.severity).toBe('warn')
  })
})

describe('建议生成', () => {
  it('建议与 finding 一一对应，id 带序号', () => {
    const result = scoreFindings([finding('R04', 'medium'), finding('R04', 'medium')])
    expect(result.advice.map((a) => a.id)).toEqual(['R04-1', 'R04-2'])
    expect(result.advice[0]).toMatchObject({
      ruleId: 'R04',
      severity: 'medium',
      action: 'manual',
      evidence: '证据'
    })
  })

  it('R11 → remove，actionDetail 含冲突模组 id', () => {
    const conflict: Finding = {
      ruleId: 'R11',
      severity: 'critical',
      source: 'static',
      message: '冲突',
      evidence: [{ modId: 'optifine', detail: 'a' }, { modId: 'sodium', detail: 'b' }]
    }
    const advice = scoreFindings([conflict]).advice[0]!
    expect(advice.action).toBe('remove')
    expect(advice.actionDetail).toBe('optifine,sodium')
  })

  it('R12 → disable', () => {
    const dup = finding('R12', 'low')
    expect(scoreFindings([dup]).advice[0]?.action).toBe('disable')
  })

  it('来源标签从 finding 透传到建议', () => {
    expect(scoreFindings([finding('R04', 'medium', '证据', 'heuristic')]).advice[0]?.source).toBe('heuristic')
    expect(scoreFindings([finding('R01', 'critical')]).advice[0]?.source).toBe('static')
  })

  it('tags 为命中规则 id（去重排序）', () => {
    const tags = scoreFindings([finding('R04', 'medium'), finding('R01', 'critical'), finding('R04', 'medium')]).score.tags
    expect(tags).toEqual(['R01', 'R04'])
  })
})
