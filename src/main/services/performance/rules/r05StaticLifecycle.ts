/**
 * R05 静态持有对象生命周期：静态字段持有 Minecraft 运行时对象
 *（World/Level/Server/Player/Minecraft…），其生命周期可能跨越多个世界/会话，
 * 导致旧世界无法被 GC（典型内存泄漏）。
 */
import { defineRule, type FindingEvidence } from './types'

const MC_RUNTIME_TYPE = /^(net\.minecraft|com\.mojang)\./
const LEAKY_TYPE_NAMES = /(World|Level|Server|Player|Entity|BlockEntity|Minecraft|Client|Dimension|RegistryAccess)/

export const ruleR05 = defineRule({
  id: 'R05',
  severity: 'high',
  source: 'static',
  description: '静态持有 Minecraft 对象可能跨世界泄漏',
  message: '静态字段持有游戏运行时对象，切换世界/退出存档时可能无法释放',
  check(ctx) {
    const findings: FindingEvidence[] = []
    for (const cls of ctx.classes) {
      for (const field of cls.fields) {
        if (!field.isStatic) continue
        if (MC_RUNTIME_TYPE.test(field.type) && LEAKY_TYPE_NAMES.test(field.type)) {
          findings.push({
            className: cls.name,
            field: field.name,
            detail: `静态字段 ${field.name}: ${field.type}，静态存储会延长运行时对象生命周期`
          })
        }
      }
    }
    return findings
  }
})
