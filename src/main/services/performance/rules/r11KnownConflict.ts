/**
 * R11 已知硬冲突：在已安装模组集合中匹配 KNOWN_CONFLICTS。
 * 每个冲突对输出一条 finding，证据分别指向两个模组并给出具体原因。
 */
import { KNOWN_CONFLICTS } from '../data/knownConflicts'
import { defineRule, type FindingEvidence } from './types'

export const ruleR11 = defineRule({
  id: 'R11',
  severity: 'critical',
  source: 'static',
  description: '已知硬冲突：已安装模组中存在无法共存的组合',
  message: '检测到已知硬冲突模组对，同时加载可能导致崩溃或严重异常',
  check(ctx) {
    const installed = new Set(ctx.installedMods.map((m) => m.modId.toLowerCase()))
    const findings: FindingEvidence[] = []
    for (const conflict of KNOWN_CONFLICTS) {
      if (installed.has(conflict.modA) && installed.has(conflict.modB)) {
        findings.push({
          modId: conflict.modA,
          detail: `${conflict.modA} ⚠ ${conflict.modB}：${conflict.reason}`
        })
        findings.push({
          modId: conflict.modB,
          detail: `${conflict.modB} ⚠ ${conflict.modA}：${conflict.reason}`
        })
      }
    }
    return findings
  }
})
