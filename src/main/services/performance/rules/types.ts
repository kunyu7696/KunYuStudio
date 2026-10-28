/**
 * 声明式静态分析规则框架。
 * 新增规则只需 defineRule({ id, severity, description, check })；
 * check 返回证据数组（空数组 = 不命中），无需感知 Finding 装配。
 */
import type { AdviceSeverity, AdviceSource } from '../../../../shared/schemas/performance/profile'
import type { ModMetadataSummary } from '../modMetadata'
import type { AnnotationInfo, ParsedClass, ParsedMethod } from '../javapBridge'

export interface FindingEvidence {
  /** 集合级规则（R11/R12）指向的模组 */
  modId?: string
  className?: string
  method?: string
  field?: string
  detail: string
}

/** 集合级规则上下文：当前实例已安装的模组信息 */
export interface InstalledModInfo {
  modId: string
  modName: string
  version: string
}

export interface Finding {
  ruleId: string
  severity: AdviceSeverity
  /** 结论来源标签：static 静态分析 / runtime 运行时采样 / heuristic 启发式推测 */
  source: AdviceSource
  message: string
  evidence: FindingEvidence[]
}

export interface RuleContext {
  metadata: ModMetadataSummary
  classes: ParsedClass[]
  classByName: Map<string, ParsedClass>
  /** 集合级规则（R11/R12）输入；单模组分析时为空数组 */
  installedMods: InstalledModInfo[]
}

export interface Rule {
  id: string
  severity: AdviceSeverity
  /** 结论来源标签（随该规则产出的每条 Finding 携带） */
  source: AdviceSource
  description: string
  run(ctx: RuleContext): Finding[]
}

export function defineRule(spec: {
  id: string
  severity: AdviceSeverity
  source: AdviceSource
  description: string
  message: string
  check: (ctx: RuleContext) => FindingEvidence[]
}): Rule {
  return {
    id: spec.id,
    severity: spec.severity,
    source: spec.source,
    description: spec.description,
    run(ctx) {
      const evidence = spec.check(ctx)
      if (evidence.length === 0) return []
      return [
        { ruleId: spec.id, severity: spec.severity, source: spec.source, message: spec.message, evidence }
      ]
    }
  }
}

// ---------- 公共匹配 helper ----------

/** 解析 javap 行内引用：Method/InterfaceMethod/Field owner.member:… */
export interface RefInfo {
  kind: 'Method' | 'InterfaceMethod' | 'Field'
  owner: string
  name: string
}

export function parseRef(ref: string): RefInfo | null {
  const m = /^(Method|InterfaceMethod|Field)\s+([\w/$]+)\.([\w$<>"]+):/.exec(ref)
  if (!m) return null
  return { kind: m[1] as RefInfo['kind'], owner: m[2]!, name: m[3]!.replace(/"/g, '') }
}

export function methodRefs(method: ParsedMethod): RefInfo[] {
  return method.instructions.map((i) => parseRef(i.ref)).filter((x): x is RefInfo => x !== null)
}

/** 注解简单名匹配（@Inject / @Mixin …） */
export function hasAnnotation(holder: { annotations: AnnotationInfo[] }, simpleName: string): boolean {
  return holder.annotations.some(
    (a) => a.type === simpleName || a.type.endsWith('.' + simpleName)
  )
}

/** 会修改目标方法行为的 Mixin 注入注解 */
export const INJECTION_ANNOTATIONS = [
  'Inject',
  'Redirect',
  'Overwrite',
  'ModifyArg',
  'ModifyArgs',
  'ModifyVariable',
  'ModifyConstant',
  'WrapOperation',
  'WrapWithCondition'
] as const

export function hasInjectionAnnotation(method: ParsedMethod): boolean {
  return INJECTION_ANNOTATIONS.some((name) => hasAnnotation(method, name))
}

/**
 * 提取 Mixin 注入注解中的目标方法描述：
 * method="tick()V" / method={"a()V","b()V"}
 */
export function injectionTargetMethods(method: ParsedMethod): string[] {
  const targets: string[] = []
  for (const annotation of method.annotations) {
    if (!INJECTION_ANNOTATIONS.some((n) => annotation.type.endsWith('.' + n) || annotation.type === n)) {
      continue
    }
    const paramMatch = /method\s*=\s*(\{[^}]*\}|"[^"]*")/.exec(annotation.params)
    if (!paramMatch) continue
    const raw = paramMatch[1]!
    const strings = /"([^"]+)"/g
    let m: RegExpExecArray | null
    while ((m = strings.exec(raw)) !== null) targets.push(m[1]!)
  }
  return targets
}

/** 类是否为 Mixin 类（类级 @Mixin） */
export function isMixinClass(cls: ParsedClass): boolean {
  return cls.classAnnotations.some((a) => a.type.endsWith('.Mixin') || a.type === 'Mixin')
}
