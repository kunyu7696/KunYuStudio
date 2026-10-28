/**
 * R07 重复注册：同一方法内对同一注册调用（owner.register）出现 ≥2 次，
 * 通常意味着初始化逻辑重复执行/循环内误注册。
 */
import { defineRule, methodRefs, type FindingEvidence } from './types'

const REGISTER_NAMES = new Set(['register', 'add', 'addListener'])

export const ruleR07 = defineRule({
  id: 'R07',
  severity: 'low',
  source: 'heuristic',
  description: '同一方法内重复注册/添加同一目标',
  message: '单个方法中重复执行注册调用，可能导致重复条目或重复事件',
  check(ctx) {
    const findings: FindingEvidence[] = []
    for (const cls of ctx.classes) {
      for (const method of cls.methods) {
        const counts = new Map<string, number>()
        for (const ref of methodRefs(method)) {
          if (!REGISTER_NAMES.has(ref.name)) continue
          const key = `${ref.owner}.${ref.name}`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        for (const [key, count] of counts) {
          if (count >= 2) {
            findings.push({
              className: cls.name,
              method: method.name,
              detail: `${key.replace(/\//g, '.')} 在同一方法内调用 ${count} 次`
            })
          }
        }
      }
    }
    return findings
  }
})
