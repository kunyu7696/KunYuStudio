/**
 * R01 主线程阻塞：Mixin 注入方法中调用强阻塞 API（sleep/wait/网络IO/进程等待）。
 * 仅在注入方法命中（普通类的阻塞调用可能位于工作线程，避免误报）。
 */
import { defineRule, hasInjectionAnnotation, methodRefs, type FindingEvidence } from './types'

/** owner.name 形式的强阻塞 API */
const BLOCKING_CALLS = new Set<string>([
  'java/lang/Thread.sleep',
  'java/lang/Object.wait',
  'java/net/URL.openStream',
  'java/net/URL.openConnection',
  'java/net/HttpURLConnection.connect',
  'java/net/Socket.connect',
  'java/lang/Process.waitFor',
  'java/util/concurrent/Future.get',
  'java/util/concurrent/CountDownLatch.await',
  'java/util/concurrent/CyclicBarrier.await'
])

export const ruleR01 = defineRule({
  id: 'R01',
  severity: 'critical',
  source: 'static',
  description: '主线程阻塞：Mixin 注入方法内存在 sleep/网络/进程等待等阻塞调用',
  message: '注入方法内的阻塞调用会卡住游戏主线程（卡顿/无响应），应移至异步线程',
  check(ctx) {
    const findings: FindingEvidence[] = []
    for (const cls of ctx.classes) {
      for (const method of cls.methods) {
        if (!hasInjectionAnnotation(method)) continue
        for (const ref of methodRefs(method)) {
          const key = `${ref.owner}.${ref.name}`
          if (BLOCKING_CALLS.has(key)) {
            findings.push({
              className: cls.name,
              method: method.name,
              detail: `阻塞调用 ${key.replace(/\//g, '.')}`
            })
          }
        }
      }
    }
    return findings
  }
})
