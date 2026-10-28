/**
 * 静态规则注册表与执行入口。
 * 新增规则：写 defineRule 文件 → 在此追加一项（唯一需要改动的地方）。
 */
import type { AdviceSource } from '../../../../shared/schemas/performance/profile'
import type { ModMetadataSummary } from '../modMetadata'
import type { ParsedClass } from '../javapBridge'
import type { Finding, InstalledModInfo, Rule, RuleContext } from './types'
import { ruleR01 } from './r01BlockingMainThread'
import { ruleR02 } from './r02UnsynchronizedStatic'
import { ruleR03 } from './r03TickAllocation'
import { ruleR04 } from './r04UnboundedCache'
import { ruleR05 } from './r05StaticLifecycle'
import { ruleR06 } from './r06ListenerNotUnregistered'
import { ruleR07 } from './r07DuplicateRegistration'
import { ruleR08 } from './r08MixinTargetOverlap'
import { ruleR09 } from './r09ThreadPoolAbuse'
import { ruleR10 } from './r10ResourceNotClosed'
import { ruleR11 } from './r11KnownConflict'
import { ruleR12 } from './r12FeatureDuplicate'

/** 单模组规则（per-mod 分析） */
export const MOD_RULES: Rule[] = [
  ruleR01,
  ruleR02,
  ruleR03,
  ruleR04,
  ruleR05,
  ruleR06,
  ruleR07,
  ruleR08,
  ruleR09,
  ruleR10
]

/** 集合级规则（对整个实例只跑一次） */
export const COLLECTION_RULES: Rule[] = [ruleR11, ruleR12]

export const ALL_RULES: Rule[] = [...MOD_RULES, ...COLLECTION_RULES]

export function buildRuleContext(
  metadata: ModMetadataSummary,
  classes: ParsedClass[],
  installedMods: InstalledModInfo[] = []
): RuleContext {
  const classByName = new Map<string, ParsedClass>()
  for (const cls of classes) classByName.set(cls.name, cls)
  return { metadata, classes, classByName, installedMods }
}

export function runRules(ctx: RuleContext, rules: Rule[] = ALL_RULES): Finding[] {
  const findings: Finding[] = []
  for (const rule of rules) findings.push(...rule.run(ctx))
  return findings
}

/** 集合级检测（R11/R12）：只需已安装模组清单 */
export function runCollectionRules(installedMods: InstalledModInfo[]): Finding[] {
  const ctx = buildRuleContext(
    {
      fabric: { modId: '', modName: '', version: '', hardDeps: [], softDeps: [], mixinConfigs: [] },
      mixins: [],
      classCount: 0
    },
    [],
    installedMods
  )
  return runRules(ctx, COLLECTION_RULES)
}

export { hasInjectionAnnotation, injectionTargetMethods } from './types'
export type { Finding, InstalledModInfo, Rule, RuleContext } from './types'

const SOURCE_BY_RULE = new Map<string, AdviceSource>(ALL_RULES.map((r) => [r.id, r.source]))

/** 规则 id → 结论来源标签；未知 id 按启发式（最低置信）处理 */
export function sourceOfRule(ruleId: string): AdviceSource {
  return SOURCE_BY_RULE.get(ruleId) ?? 'heuristic'
}
