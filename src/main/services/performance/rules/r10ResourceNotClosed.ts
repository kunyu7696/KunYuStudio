/**
 * R10 资源未关闭：方法内打开文件/套接字/流，但方法体中没有 close 调用
 *（try-with-resources 编译产物含 close，会被正确排除）。
 */
import { defineRule, methodRefs, type FindingEvidence } from './types'

const OPEN_CALLS: Array<{ owner: string; name: string }> = [
  { owner: 'java/io/FileInputStream', name: '<init>' },
  { owner: 'java/io/FileOutputStream', name: '<init>' },
  { owner: 'java/io/RandomAccessFile', name: '<init>' },
  { owner: 'java/net/Socket', name: '<init>' },
  { owner: 'java/net/URL', name: 'openStream' }
]

export const ruleR10 = defineRule({
  id: 'R10',
  severity: 'medium',
  source: 'static',
  description: '打开的文件/套接字/流在方法内未见关闭',
  message: '资源未关闭可能泄漏文件描述符，建议 try-with-resources 或 finally close',
  check(ctx) {
    const findings: FindingEvidence[] = []
    for (const cls of ctx.classes) {
      for (const method of cls.methods) {
        const refs = methodRefs(method)
        const opened = refs.filter((r) => OPEN_CALLS.some((o) => o.owner === r.owner && o.name === r.name))
        if (opened.length === 0) continue
        const hasClose = refs.some((r) => r.name === 'close')
        if (hasClose) continue
        for (const ref of opened) {
          findings.push({
            className: cls.name,
            method: method.name,
            detail: `打开资源 ${ref.owner.replace(/\//g, '.')} 但方法内无 close`
          })
        }
      }
    }
    return findings
  }
})
