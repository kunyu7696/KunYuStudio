/**
 * R02 未同步静态字段：非 final、非 volatile 的静态字段被 putstatic 写入，
 * 且写入方法未同步 —— 多线程下存在竞态（典型：计数器/开关/缓存引用）。
 */
import { defineRule, type FindingEvidence } from './types'

export const ruleR02 = defineRule({
  id: 'R02',
  severity: 'medium',
  source: 'static',
  description: '未同步静态字段：可变静态字段在非同步方法中被写入',
  message: '可变静态字段缺少同步/volatile，跨线程读写可能出现竞态',
  check(ctx) {
    const findings: FindingEvidence[] = []
    for (const cls of ctx.classes) {
      for (const field of cls.fields) {
        if (!field.isStatic || field.isFinal || field.isVolatile) continue
        for (const method of cls.methods) {
          if (method.isSynchronized) continue
          const writes = method.instructions.some(
            (i) => i.opcode === 'putstatic' && i.ref.includes(`.${field.name}:`)
          )
          if (writes) {
            findings.push({
              className: cls.name,
              method: method.name,
              field: field.name,
              detail: `静态字段 ${field.name}: ${field.type} 在非同步方法中写入`
            })
          }
        }
      }
    }
    return findings
  }
})
