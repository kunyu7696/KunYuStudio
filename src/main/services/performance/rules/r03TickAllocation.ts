/**
 * R03 tick 内分配：注入到 tick/render 等高频方法的注入器方法体内存在对象/数组分配，
 * 高频分配会增加 GC 压力（每秒 20 次 tick × 分配量）。
 */
import { defineRule, hasInjectionAnnotation, injectionTargetMethods, type FindingEvidence } from './types'

const ALLOCATION_OPCODES = new Set(['new', 'anewarray', 'newarray', 'multianewarray'])
const HOT_TARGET = /tick|render|render\(|onTick|clientTick|tick\(/

export const ruleR03 = defineRule({
  id: 'R03',
  severity: 'low',
  source: 'heuristic',
  description: 'tick 内分配：注入到 tick/render 的方法中每帧分配对象/数组',
  message: '高频路径中的重复分配会增加 GC 压力，可复用对象或延迟到状态变更时计算',
  check(ctx) {
    const findings: FindingEvidence[] = []
    for (const cls of ctx.classes) {
      for (const method of cls.methods) {
        if (!hasInjectionAnnotation(method)) continue
        const targets = injectionTargetMethods(method)
        if (!targets.some((t) => HOT_TARGET.test(t))) continue
        const allocations = method.instructions.filter((i) => ALLOCATION_OPCODES.has(i.opcode))
        for (const alloc of allocations) {
          findings.push({
            className: cls.name,
            method: method.name,
            detail: `注入目标 ${targets.join(',')} 中存在分配指令 ${alloc.opcode}${alloc.ref ? ` (${alloc.ref})` : ''}`
          })
        }
      }
    }
    return findings
  }
})
