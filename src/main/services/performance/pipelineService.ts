/**
 * 模组性能管线服务：三条模式的统一入口。
 *
 * - 全自动（织星）：jar 集合 → 静态分析入榜 → 动态采样（JFR/Spark 注入）→ 画像汇总
 * - 半自动：对单 jar / mods 目录一键静态分析
 * - 人工：导入 jar（静态）/ .jfr（动态）/ spark 报告（动态）
 *
 * 所有入口吞掉单项异常并回执，绝不抛出；静态分析失败不回滚已安装文件。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AnalyzeJarOptions } from './staticAnalyzer'
import type { ProfileRepository } from './profileRepository'
import { analyzeJar } from './staticAnalyzer'
import { buildPackageIndex } from './packageIndex'
import { runJfrPrint } from './jfrRunner'
import { parseJfrPrint } from './jfrParser'
import { parseSparkReport } from './sparkParser'
import {
  metricsFromJfr,
  metricsFromSpark,
  storeMetrics
} from './dynamicMerge'
import { runCollectionRules, type Finding } from './rules'
import { scoreFindings } from './scoring'

export interface StaticOneInput {
  jarPath: string
  loader: string
  mcVersion: string
  javap?: AnalyzeJarOptions['javap']
}

export interface StaticOneResult {
  ok: boolean
  modId?: string
  fileName: string
  error?: string
}

export interface AnalyzeDirectoryResult {
  total: number
  succeeded: number
  results: StaticOneResult[]
}

export type PipelineStage =
  | 'static-start'
  | 'static-item'
  | 'dynamic-start'
  | 'dynamic-item'
  | 'done'

export type PipelineEvent =
  | { stage: 'static-start'; total: number }
  | { stage: 'static-item'; index: number; total: number; result: StaticOneResult }
  | { stage: 'dynamic-start'; source: 'jfr' | 'spark' }
  | { stage: 'dynamic-item'; modId: string }
  | { stage: 'done'; profiles: number }

/** 半自动 / 人工 jar：单 jar 静态分析并入榜（失败不抛） */
export function analyzeAndStore(
  repo: ProfileRepository,
  input: StaticOneInput
): StaticOneResult {
  const fileName = input.jarPath.split(/[\\/]/).pop() ?? input.jarPath
  try {
    const profile = analyzeJar({
      jarPath: input.jarPath,
      loader: input.loader,
      mcVersion: input.mcVersion,
      javap: input.javap
    })
    repo.upsertProfile(profile)
    try {
      syncCollectionRules(repo, { loader: input.loader, mcVersion: input.mcVersion })
    } catch (err) {
      // 集合级规则重算失败不影响单模组入榜结果，仅告警
      console.warn(
        `[performance] 集合级规则重算失败（${fileName}）：${err instanceof Error ? err.message : String(err)}`
      )
    }
    return { ok: true, modId: profile.identity.modId, fileName }
  } catch (err) {
    return { ok: false, fileName, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 集合级规则（R11/R12）重算：
 * 取 scope 内全部画像 → 跑集合规则 → 按模组拆分 →
 * 与画像已有的 R01–R10 建议合并重新评分入库。
 * 每次单 jar 入榜后调用，保证后装的模组能补全冲突/重复判定。
 * @returns 被重算的画像数量
 */
export function syncCollectionRules(
  repo: ProfileRepository,
  scope: { loader?: string; mcVersion?: string } = {}
): number {
  const profiles = repo.listProfiles(scope)
  if (profiles.length === 0) return 0

  const installed = profiles.map((p) => ({
    modId: p.identity.modId,
    modName: p.identity.modName,
    version: p.identity.version
  }))
  const findingsByMod = splitFindingsByMod(runCollectionRules(installed))

  let updated = 0
  for (const profile of profiles) {
    const ownFindings: Finding[] = profile.advice
      .filter((a) => a.ruleId !== 'R11' && a.ruleId !== 'R12')
      .map((a) => ({
        ruleId: a.ruleId,
        severity: a.severity,
        source: a.source,
        message: a.message,
        evidence: [{ detail: a.evidence }]
      }))
    const collectionFindings = findingsByMod.get(profile.identity.modId.toLowerCase()) ?? []
    const { score, advice } = scoreFindings([...ownFindings, ...collectionFindings])

    const conflicts = collectionFindings
      .filter((f) => f.ruleId === 'R11')
      .flatMap((f) => f.evidence.map((e) => e.detail))

    repo.upsertProfile({
      ...profile,
      staticFeatures: {
        ...profile.staticFeatures,
        dependencies: { ...profile.staticFeatures.dependencies, conflicts }
      },
      score,
      advice
    })
    updated += 1
  }
  return updated
}

/** 集合级 finding 按证据指向的 modId 拆成每模组一份 */
function splitFindingsByMod(findings: Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>()
  for (const finding of findings) {
    const modIds = Array.from(
      new Set(
        finding.evidence
          .map((e) => e.modId?.toLowerCase())
          .filter((x): x is string => !!x)
      )
    )
    for (const modId of modIds) {
      const bucket = map.get(modId) ?? []
      bucket.push({
        ...finding,
        evidence: finding.evidence.filter((e) => e.modId?.toLowerCase() === modId)
      })
      map.set(modId, bucket)
    }
  }
  return map
}

function isJarFile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.jar') && !lower.endsWith('.disabled')
}

/** 半自动：扫描目录全部 jar 分析入榜 */
export function analyzeModsDirectory(
  repo: ProfileRepository,
  input: { dir: string; loader: string; mcVersion: string }
): AnalyzeDirectoryResult {
  let names: string[] = []
  try {
    names = readdirSync(input.dir).filter(isJarFile)
  } catch (err) {
    return {
      total: 0,
      succeeded: 0,
      results: [
        {
          ok: false,
          fileName: input.dir,
          error: err instanceof Error ? err.message : String(err)
        }
      ]
    }
  }
  const results: StaticOneResult[] = names.map((name) =>
    analyzeAndStore(repo, {
      jarPath: join(input.dir, name),
      loader: input.loader,
      mcVersion: input.mcVersion
    })
  )
  return {
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    results
  }
}

export interface ImportJfrInput {
  jfrPath: string
  jdkHome?: string | null
  loader?: string
  mcVersion?: string
}

export interface ImportResult {
  ok: boolean
  profilesUpdated: number
  modIds: string[]
  error?: string
}

/** 人工：导入 .jfr → jfr print → 解析归因 → 合并入画像 */
export async function importJfr(
  repo: ProfileRepository,
  input: ImportJfrInput
): Promise<ImportResult> {
  try {
    if (!existsSync(input.jfrPath)) {
      return { ok: false, profilesUpdated: 0, modIds: [], error: 'JFR 文件不存在' }
    }
    const text = await runJfrPrint(input.jdkHome ?? '', input.jfrPath)
    const parsed = parseJfrPrint(text)
    const index = buildPackageIndex(repo)
    const metrics = metricsFromJfr(parsed, index)
    const updated = storeMetrics(repo, metrics, {
      loader: input.loader,
      mcVersion: input.mcVersion
    })
    return { ok: true, profilesUpdated: updated, modIds: [...metrics.keys()] }
  } catch (err) {
    return {
      ok: false,
      profilesUpdated: 0,
      modIds: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

export interface ImportSparkInput {
  /** 文本内容与文件路径二选一 */
  text?: string
  filePath?: string
  loader?: string
  mcVersion?: string
}

/** 人工：导入 Spark 报告（文本 / 文件）→ 解析归因 → 合并入画像 */
export function importSpark(
  repo: ProfileRepository,
  input: ImportSparkInput
): ImportResult {
  try {
    let text: string
    if (input.text !== undefined) {
      text = input.text
    } else if (input.filePath) {
      if (!existsSync(input.filePath)) {
        return { ok: false, profilesUpdated: 0, modIds: [], error: 'Spark 报告不存在' }
      }
      text = readFileSync(input.filePath, 'utf8')
    } else {
      return { ok: false, profilesUpdated: 0, modIds: [], error: '未提供 Spark 报告内容' }
    }
    const report = parseSparkReport(text)
    const index = buildPackageIndex(repo)
    const metrics = metricsFromSpark(report, index)
    const updated = storeMetrics(repo, metrics, {
      loader: input.loader,
      mcVersion: input.mcVersion
    })
    return { ok: true, profilesUpdated: updated, modIds: [...metrics.keys()] }
  } catch (err) {
    return {
      ok: false,
      profilesUpdated: 0,
      modIds: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

/** 动态采样器：返回 JFR 文本或 Spark 文本；由接入方（沙箱/bridge）注入 */
export type DynamicCollector =
  | { kind: 'jfr'; collect: () => Promise<string> }
  | { kind: 'spark'; collect: () => Promise<string> }

export interface FullAutoInput {
  jarPaths: string[]
  loader: string
  mcVersion: string
  /** 动态阶段采集器；缺省仅做静态 */
  collector?: DynamicCollector
}

export interface FullAutoResult {
  static: AnalyzeDirectoryResult
  dynamic: ImportResult
}

/**
 * 全自动（织星）：静态分析全部入榜 → 动态采样归因 → 汇总。
 * 动态阶段失败不影响已入榜的静态画像。
 */
export async function runFullAuto(
  repo: ProfileRepository,
  input: FullAutoInput,
  emit: (event: PipelineEvent) => void = () => undefined
): Promise<FullAutoResult> {
  emit({ stage: 'static-start', total: input.jarPaths.length })

  const results: StaticOneResult[] = input.jarPaths.map((jarPath, index) => {
    const result = analyzeAndStore(repo, {
      jarPath,
      loader: input.loader,
      mcVersion: input.mcVersion
    })
    emit({ stage: 'static-item', index: index + 1, total: input.jarPaths.length, result })
    return result
  })
  const staticResult: AnalyzeDirectoryResult = {
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    results
  }

  let dynamic: ImportResult = { ok: true, profilesUpdated: 0, modIds: [] }
  if (input.collector) {
    emit({ stage: 'dynamic-start', source: input.collector.kind })
    try {
      const text = await input.collector.collect()
      if (input.collector.kind === 'jfr') {
        const parsed = parseJfrPrint(text)
        const index = buildPackageIndex(repo)
        const metrics = metricsFromJfr(parsed, index)
        dynamic = {
          ok: true,
          profilesUpdated: storeMetrics(repo, metrics, input),
          modIds: [...metrics.keys()]
        }
      } else {
        const report = parseSparkReport(text)
        const index = buildPackageIndex(repo)
        const metrics = metricsFromSpark(report, index)
        dynamic = {
          ok: true,
          profilesUpdated: storeMetrics(repo, metrics, input),
          modIds: [...metrics.keys()]
        }
      }
      for (const modId of dynamic.modIds) emit({ stage: 'dynamic-item', modId })
    } catch (err) {
      dynamic = {
        ok: false,
        profilesUpdated: 0,
        modIds: [],
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  emit({ stage: 'done', profiles: repo.countProfiles() })
  return { static: staticResult, dynamic }
}

/** market install 钩子类型：对已安装文件做静态分析 */
export type PostInstallHook = (
  files: string[],
  loader: string,
  mcVersion: string
) => { analyzed: number; warnings: string[] }

/** 创建安装后静态分析钩子（分析失败仅告警，不影响安装） */
export function createPostInstallHook(repo: ProfileRepository): PostInstallHook {
  return (files, loader, mcVersion) => {
    let analyzed = 0
    const warnings: string[] = []
    for (const file of files) {
      if (!isJarFile(file)) continue
      const result = analyzeAndStore(repo, { jarPath: file, loader, mcVersion })
      if (result.ok) analyzed += 1
      else if (result.error) warnings.push(result.error)
    }
    return { analyzed, warnings }
  }
}
