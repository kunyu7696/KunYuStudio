/**
 * 动态采样结果 → DynamicMetrics 映射，并合并到对应画像。
 *
 * 归因粒度：包前缀 → modId；一个 modId 可能对应多个画像版本，
 * 优先匹配同 loader / mcVersion，否则取首个。
 */
import type {
  DynamicMetrics,
  ProfileKey
} from '../../../shared/schemas/performance/profile'
import type { ProfileRepository } from './profileRepository'
import type { JfrParseResult, PackageIndexEntry } from './jfrParser'
import { resolveMod } from './jfrParser'
import type { SparkReport } from './sparkParser'

/** 为每个 modId 选一个画像主键（loader/mcVersion 优先） */
export function pickProfileKeys(
  repo: ProfileRepository,
  modIds: string[],
  prefer: { loader?: string; mcVersion?: string }
): Map<string, ProfileKey> {
  const all = repo.listProfiles()
  const result = new Map<string, ProfileKey>()
  for (const modId of modIds) {
    const candidates = all.filter((p) => p.identity.modId === modId)
    if (candidates.length === 0) continue
    const exact = candidates.find(
      (p) =>
        p.identity.loader === prefer.loader &&
        p.identity.mcVersion === prefer.mcVersion
    )
    const chosen = exact ?? candidates[0]
    if (!chosen) continue
    const i = chosen.identity
    result.set(modId, {
      modId: i.modId,
      version: i.version,
      loader: i.loader,
      mcVersion: i.mcVersion
    })
  }
  return result
}

/** JFR：按模组构建动态指标 */
export function metricsFromJfr(
  result: JfrParseResult,
  index: PackageIndexEntry[]
): Map<string, DynamicMetrics> {
  const byMod = new Map<
    string,
    { cpuSelf: number; hotspots: JfrParseResult['hotspots']; allocations: JfrParseResult['allocations'] }
  >()

  const ensure = (modId: string) => {
    let bucket = byMod.get(modId)
    if (!bucket) {
      bucket = { cpuSelf: 0, hotspots: [], allocations: [] }
      byMod.set(modId, bucket)
    }
    return bucket
  }

  const pct = (samples: number): number =>
    result.totalSamples === 0
      ? 0
      : Math.round((samples / result.totalSamples) * 1000) / 10

  for (const h of result.hotspots) {
    const modId = resolveMod(h.package, index)?.modId ?? '__other__'
    if (modId === '__other__') continue
    const bucket = ensure(modId)
    bucket.hotspots.push(h)
    bucket.cpuSelf += pct(h.samples)
  }
  for (const a of result.allocations) {
    const modId = resolveMod(a.package, index)?.modId ?? '__other__'
    if (modId === '__other__') continue
    ensure(modId).allocations.push(a)
  }

  const metrics = new Map<string, DynamicMetrics>()
  for (const [modId, bucket] of byMod) {
    metrics.set(modId, {
      cpu: {
        sampleDurationMs: 0,
        averageCpuPercent: Math.round(bucket.cpuSelf * 10) / 10,
        topMethods: bucket.hotspots.map((h) => ({
          className: h.className,
          method: h.method,
          selfPercent: pct(h.samples)
        }))
      },
      memory: {
        heapUsedMb: 0,
        allocationRateMbps: 0,
        topAllocators: bucket.allocations.map((a) => ({
          type: a.className,
          bytesPerSec: 0
        }))
      },
      tick: { averageTickMs: 0, tickDrops: 0, tps: 0 },
      events: [],
      sampledAt: new Date().toISOString(),
      source: 'jfr'
    })
  }
  return metrics
}

/** Spark：按模组构建动态指标（CPU 树 / heap JSON 可能只含其一） */
export function metricsFromSpark(
  report: SparkReport,
  index: PackageIndexEntry[]
): Map<string, DynamicMetrics> {
  const byMod = new Map<
    string,
    { cpuSelf: number; cpuNodes: SparkReport['nodes']; memNodes: SparkReport['nodes'] }
  >()

  const ensure = (modId: string) => {
    let bucket = byMod.get(modId)
    if (!bucket) {
      bucket = { cpuSelf: 0, cpuNodes: [], memNodes: [] }
      byMod.set(modId, bucket)
    }
    return bucket
  }

  for (const node of report.nodes) {
    const modId = resolveMod(node.package, index)?.modId ?? '__other__'
    if (modId === '__other__') continue
    const bucket = ensure(modId)
    if (node.kind === 'cpu') {
      bucket.cpuNodes.push(node)
      bucket.cpuSelf += node.weight
    } else {
      bucket.memNodes.push(node)
    }
  }

  const metrics = new Map<string, DynamicMetrics>()
  for (const [modId, bucket] of byMod) {
    metrics.set(modId, {
      cpu: {
        sampleDurationMs: 0,
        averageCpuPercent: Math.round(bucket.cpuSelf * 10) / 10,
        topMethods: bucket.cpuNodes
          .filter((n): n is typeof n & { className: string } => n.className !== null)
          .map((n) => ({
            className: n.className,
            method: n.raw,
            selfPercent: Math.round(n.weight * 10) / 10
          }))
      },
      memory: {
        heapUsedMb: 0,
        allocationRateMbps: 0,
        topAllocators: bucket.memNodes
          .filter((n): n is typeof n & { className: string } => n.className !== null)
          .map((n) => ({
            type: n.className,
            bytesPerSec: n.weight
          }))
      },
      tick: {
        averageTickMs: report.averageTickMs ?? 0,
        tickDrops: 0,
        tps: 0
      },
      events: [],
      sampledAt: new Date().toISOString(),
      source: 'spark'
    })
  }
  return metrics
}

/** 把指标映射写入仓储对应画像；返回成功写入的主键数 */
export function storeMetrics(
  repo: ProfileRepository,
  metrics: Map<string, DynamicMetrics>,
  prefer: { loader?: string; mcVersion?: string }
): number {
  const keys = pickProfileKeys(repo, [...metrics.keys()], prefer)
  let n = 0
  for (const [modId, m] of metrics) {
    const key = keys.get(modId)
    if (!key) continue
    repo.upsertDynamic(key, m)
    n += 1
  }
  return n
}
