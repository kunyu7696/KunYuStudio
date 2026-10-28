/**
 * R06 监听未注销：代码对某 owner 调用 register/addListener 注册，
 * 但整个 jar 中未见同一 owner 的 unregister/removeListener。
 */
import { defineRule, methodRefs, type FindingEvidence } from './types'

const REGISTER_NAMES = new Set(['register', 'addListener'])
const UNREGISTER_NAMES = new Set(['unregister', 'removeListener'])

export const ruleR06 = defineRule({
  id: 'R06',
  severity: 'medium',
  source: 'static',
  description: '监听/订阅注册后未见注销，可能造成泄漏或重复回调',
  message: '注册的监听/订阅没有对应注销调用，对象可能无法回收或收到重复事件',
  check(ctx) {
    const registerPoints = new Map<string, FindingEvidence>()
    const unregisterOwners = new Set<string>()

    for (const cls of ctx.classes) {
      for (const method of cls.methods) {
        for (const ref of methodRefs(method)) {
          if (UNREGISTER_NAMES.has(ref.name)) unregisterOwners.add(ref.owner)
          if (REGISTER_NAMES.has(ref.name)) {
            const key = `${ref.owner}`
            if (!registerPoints.has(key)) {
              registerPoints.set(key, {
                className: cls.name,
                method: method.name,
                detail: `注册点 ${ref.owner.replace(/\//g, '.')}.${ref.name}`
              })
            }
          }
        }
      }
    }

    const findings: FindingEvidence[] = []
    for (const [owner, evidence] of registerPoints) {
      if (!unregisterOwners.has(owner)) findings.push(evidence)
    }
    return findings
  }
})
