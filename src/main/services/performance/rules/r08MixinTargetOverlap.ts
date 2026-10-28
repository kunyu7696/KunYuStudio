/**
 * R08 Mixin 目标重叠：本 jar 内多个注入点作用于同一目标类的同一目标方法，
 * 会产生注入顺序依赖/重复包装，与其他同类 Mixin 叠加时更易崩溃。
 *
 * 数据来源：metadata.mixins（mixinClass→target）+ classes 中注入方法的目标方法。
 */
import { defineRule, injectionTargetMethods, type FindingEvidence } from './types'

export const ruleR08 = defineRule({
  id: 'R08',
  severity: 'high',
  source: 'static',
  description: 'Mixin 目标重叠：多个注入点作用于同一目标方法',
  message: '同目标方法上有多个注入器，存在注入顺序依赖与重复包装风险',
  check(ctx) {
    // mixinClass → target（来自 mixin 配置；字符串形式无 target 时 target=null）
    const targetByMixin = new Map<string, string | null>()
    for (const cfg of ctx.metadata.mixins) {
      for (const entry of cfg.entries) {
        targetByMixin.set(entry.mixinClass, entry.target)
      }
    }

    /** key = 目标类#目标方法 → 注入点列表 */
    const overlaps = new Map<string, FindingEvidence[]>()

    for (const cls of ctx.classes) {
      const target = targetByMixin.get(cls.name)
      for (const method of cls.methods) {
        const targets = injectionTargetMethods(method)
        if (targets.length === 0) continue
        for (const targetMethod of targets) {
          const key = `${target ?? '?'}#${targetMethod}`
          const list = overlaps.get(key) ?? []
          list.push({
            className: cls.name,
            method: method.name,
            detail: `注入点 ${cls.name}.${method.name} → ${target ?? '未知目标'}.${targetMethod}`
          })
          overlaps.set(key, list)
        }
      }
    }

    const findings: FindingEvidence[] = []
    for (const list of overlaps.values()) {
      // 同一 mixin 类内不同方法作用于同目标也视为重叠
      if (list.length >= 2) findings.push(...list)
    }
    return findings
  }
})
