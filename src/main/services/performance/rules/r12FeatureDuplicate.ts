/**
 * R12 功能重复：同一功能标签命中 ≥2 个已安装模组。
 * 这不是崩溃级冲突，但功能重叠会增加开销并可能互相干扰，建议保留其一。
 */
import { FEATURE_TAGS } from '../data/featureTags'
import { defineRule, type FindingEvidence, type InstalledModInfo } from './types'

export const ruleR12 = defineRule({
  id: 'R12',
  severity: 'low',
  source: 'heuristic',
  description: '功能重复：多个模组提供同一功能',
  message: '检测到功能重叠的模组，保留其一可减少开销与潜在干扰',
  check(ctx) {
    const byId = new Map<string, InstalledModInfo>()
    for (const mod of ctx.installedMods) byId.set(mod.modId.toLowerCase(), mod)

    const findings: FindingEvidence[] = []
    for (const tag of FEATURE_TAGS) {
      const matched = tag.modIds
        .map((id) => byId.get(id))
        .filter((x): x is InstalledModInfo => x !== undefined)
      if (matched.length < 2) continue
      for (const mod of matched) {
        const others = matched.filter((m) => m.modId !== mod.modId).map((m) => m.modId)
        findings.push({
          modId: mod.modId,
          detail: `「${tag.feature}」(${tag.category}) 与 ${others.join('、')} 功能重叠`
        })
      }
    }
    return findings
  }
})
