/**
 * 排行榜纯视图逻辑：筛选 / 排序 / 对比。
 * 独立于 IPC，便于单元测试（TR-15.1）。
 */
import type {
  LeaderboardEntry,
  ProfileKey,
  ProfileSeverity,
  ScoreOrderKey
} from '../../../../shared/schemas/performance/profile'
import { profileKeyText } from '../../../../shared/schemas/performance/profile'

export interface LeaderboardFilter {
  loader?: string | null
  mcVersion?: string | null
  severity?: ProfileSeverity | null
}

/** loader / MC 版本 / severity 三维筛选；空串与 null 视为不过滤 */
export function filterEntries(
  entries: LeaderboardEntry[],
  filter: LeaderboardFilter
): LeaderboardEntry[] {
  const loader = filter.loader?.trim() || null
  const mcVersion = filter.mcVersion?.trim() || null
  const severity = filter.severity || null
  return entries.filter(
    (e) =>
      (loader === null || e.loader === loader) &&
      (mcVersion === null || e.mcVersion === mcVersion) &&
      (severity === null || e.severity === severity)
  )
}

/** 按选定五维分数降序；同分按 modId 升序稳定 */
export function sortEntries(
  entries: LeaderboardEntry[],
  orderBy: ScoreOrderKey
): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    const diff = b.scores[orderBy] - a.scores[orderBy]
    if (diff !== 0) return diff
    return a.modId.localeCompare(b.modId)
  })
}

/** 筛选 + 排序组合 */
export function applyView(
  entries: LeaderboardEntry[],
  filter: LeaderboardFilter,
  orderBy: ScoreOrderKey
): LeaderboardEntry[] {
  return sortEntries(filterEntries(entries, filter), orderBy)
}

/** 按给定主键顺序取出对比行；缺失的键跳过 */
export function buildComparison(
  entries: LeaderboardEntry[],
  keys: ProfileKey[]
): LeaderboardEntry[] {
  const byKey = new Map<string, LeaderboardEntry>()
  for (const e of entries) byKey.set(profileKeyText(e), e)
  const result: LeaderboardEntry[] = []
  for (const k of keys) {
    const hit = byKey.get(profileKeyText(k))
    if (hit) result.push(hit)
  }
  return result
}

/** 从行集合中提取去重的可选项（供筛选下拉） */
export function distinctValues(
  entries: LeaderboardEntry[],
  field: 'loader' | 'mcVersion'
): string[] {
  return [...new Set(entries.map((e) => e[field]))].sort((a, b) => a.localeCompare(b))
}
