/**
 * R04 无界缓存：语义上为缓存/注册表的静态集合字段存在写入（put/add），
 * 但类中未见任何淘汰（remove/clear/removeEldestEntry）→ 长期运行持续增长。
 */
import { defineRule, methodRefs, type FindingEvidence } from './types'

const COLLECTION_TYPES =
  /(^|\.)(Map|HashMap|LinkedHashMap|TreeMap|ConcurrentHashMap|WeakHashMap|List|ArrayList|LinkedList|Set|HashSet|LinkedHashSet)(\[\]|$)/
const CACHE_NAME = /(cache|caches|map|registry|pending|entries|pool|holders)/i

export const ruleR04 = defineRule({
  id: 'R04',
  severity: 'medium',
  source: 'heuristic',
  description: '无界缓存：静态集合只增不删，长期运行存在内存增长风险',
  message: '缓存集合没有容量上限或淘汰逻辑，随时间增长可能占用大量内存',
  check(ctx) {
    const findings: FindingEvidence[] = []
    for (const cls of ctx.classes) {
      const refs = cls.methods.flatMap((m) => methodRefs(m))
      const hasEviction = refs.some(
        (r) => r.name === 'remove' || r.name === 'clear' || r.name === 'removeEldestEntry'
      )
      const hasInsert = refs.some((r) => r.name === 'put' || r.name === 'putIfAbsent' || r.name === 'add')
      if (!hasInsert || hasEviction) continue

      for (const field of cls.fields) {
        if (!field.isStatic || !COLLECTION_TYPES.test(field.type) || !CACHE_NAME.test(field.name)) continue
        findings.push({
          className: cls.name,
          field: field.name,
          detail: `静态集合 ${field.name}: ${field.type} 存在 put/add 但类中无 remove/clear`
        })
      }
    }
    return findings
  }
})
