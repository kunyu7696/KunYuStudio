/**
 * 端到端静态分析服务：jar 文件 → ModPerformanceProfile。
 *
 * 管线：zip → fabric/mixin 元数据 → javap 批量反汇编 → R01–R10 规则 → 评分/建议。
 * 纯 CPU/IO 操作，无网络；动态指标在此阶段为 null（JFR/Spark 另路补充）。
 */
import type {
  ModPerformanceProfile,
  StaticFeatures
} from '../../../shared/schemas/performance/profile'
import {
  createJavapBridge,
  classEntryToFqn,
  type BatchProgress,
  type ParsedClass
} from './javapBridge'
import { extractModMetadata } from './modMetadata'
import { openZip, sha256Hex } from './jarReader'
import {
  buildRuleContext,
  MOD_RULES,
  runRules,
  hasInjectionAnnotation,
  injectionTargetMethods,
  type Finding
} from './rules'
import { scoreFindings } from './scoring'

export interface AnalyzeJarOptions {
  jarPath: string
  loader: string
  mcVersion: string
  /** 大 jar 的批次回调（UI 进度） */
  onProgress?: (progress: BatchProgress) => void
  /** 注入 javap 桥接（测试可用假桥接） */
  javap?: ReturnType<typeof createJavapBridge>
}

export function analyzeJar(options: AnalyzeJarOptions): ModPerformanceProfile {
  const { jarPath, loader, mcVersion } = options
  const reader = openZip(jarPath)
  const fileHash = sha256Hex(jarPath)
  const metadata = extractModMetadata(reader)

  const classFqns = reader
    .entries()
    .map((e) => classEntryToFqn(e.path))
    .filter((x): x is string => x !== null)

  const bridge = options.javap ?? createJavapBridge()
  const classes = bridge.analyze(jarPath, classFqns, options.onProgress)

  const context = buildRuleContext(metadata, classes)
  const findings = runRules(context, MOD_RULES)
  const { score, advice } = scoreFindings(findings)

  const staticFeatures = buildStaticFeatures(metadata, classes, findings)

  return {
    identity: {
      modId: metadata.fabric.modId,
      version: metadata.fabric.version,
      loader,
      mcVersion,
      fileHash,
      modName: metadata.fabric.modName,
      filePath: jarPath
    },
    staticFeatures,
    dynamicMetrics: null,
    score,
    advice,
    analyzedAt: new Date().toISOString()
  }
}

const R02_ID = 'R02'

function buildStaticFeatures(
  metadata: ReturnType<typeof extractModMetadata>,
  classes: ParsedClass[],
  findings: Finding[]
): StaticFeatures {
  const mixinCount = metadata.mixins.reduce((sum, c) => sum + c.entries.length, 0)
  const mixinTargets = Array.from(
    new Set(metadata.mixins.flatMap((c) => c.entries.map((e) => e.target).filter((x): x is string => x !== null)))
  )

  const countByRule = (ruleId: string): number => findings.filter((f) => f.ruleId === ruleId).length
  const nativeCalls = classes.reduce(
    (sum, cls) => sum + cls.methods.filter((m) => m.isNative).length,
    0
  )

  let eventListeners = 0
  let tickCallbacks = 0
  let injectionPoints = 0
  for (const cls of classes) {
    for (const method of cls.methods) {
      for (const instruction of method.instructions) {
        if (/\.register:|addListener/.test(instruction.ref)) eventListeners += 1
      }
      if (hasInjectionAnnotation(method)) {
        injectionPoints += 1
        if (injectionTargetMethods(method).some((t) => /tick|render/.test(t))) {
          tickCallbacks += 1
        }
      }
    }
  }

  return {
    classCount: metadata.classCount,
    mixinCount,
    mixinTargets,
    hooks: {
      tickCallbacks,
      eventListeners,
      injectionPoints
    },
    dependencies: {
      hardDeps: metadata.fabric.hardDeps,
      softDeps: metadata.fabric.softDeps,
      conflicts: []
    },
    bytecode: {
      mainThreadBlockingCalls: countByRule('R01'),
      tickLoopAllocations: countByRule('R03'),
      unboundedCaches: countByRule('R04'),
      unsynchronizedStaticFields: countByRule(R02_ID),
      nativeMethodCalls: nativeCalls
    }
  }
}

