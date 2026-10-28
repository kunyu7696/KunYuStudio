/**
 * R09 线程池滥用：
 * - Executors.newCachedThreadPool：线程数无上限，突发负载下可能创建大量线程；
 * - 方法内裸 new Thread(...).start()：缺少复用与统一关闭。
 */
import { defineRule, methodRefs, type FindingEvidence } from './types'

export const ruleR09 = defineRule({
  id: 'R09',
  severity: 'medium',
  source: 'static',
  description: '线程池/线程创建无约束（newCachedThreadPool/裸 Thread）',
  message: '无界线程池或裸线程在高负载下会创建大量线程，建议有界池并统一生命周期',
  check(ctx) {
    const findings: FindingEvidence[] = []
    for (const cls of ctx.classes) {
      for (const method of cls.methods) {
        const refs = methodRefs(method)
        for (const ref of refs) {
          if (ref.owner === 'java/util/concurrent/Executors' && ref.name === 'newCachedThreadPool') {
            findings.push({
              className: cls.name,
              method: method.name,
              detail: '使用无界线程数的 newCachedThreadPool'
            })
          }
        }
        const startsThread =
          method.instructions.some((i) => i.opcode === 'new' && i.ref.includes('java/lang/Thread')) &&
          refs.some((r) => r.owner === 'java/lang/Thread' && r.name === 'start')
        if (startsThread) {
          findings.push({
            className: cls.name,
            method: method.name,
            detail: '方法内裸创建并启动 Thread，缺少线程复用'
          })
        }
      }
    }
    return findings
  }
})
