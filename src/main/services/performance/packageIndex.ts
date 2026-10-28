/**
 * 从已入库画像构建「包名 → 模组」索引：
 * 打开各画像 jar，统计 class 包路径，选出有代表性的包前缀。
 *
 * 供 JFR / Spark 动态归因复用。单个 jar 读取失败跳过，不影响其余模组。
 */
import type { PackageIndexEntry } from './jfrParser'
import type { ProfileRepository } from './profileRepository'
import { openZip } from './jarReader'

/** 取包名前 depth 段；段数不足返回 null */
function prefixSegments(pkg: string, depth: number): string | null {
  const parts = pkg.split('.')
  if (parts.length < depth) return null
  return parts.slice(0, depth).join('.')
}

/**
 * 为单个 jar 的类条目挑选代表前缀：
 * 按前 3 段聚合，覆盖类数最多且 ≥2 的前缀入选；不足则退化到前 2 段 / 前 1 段。
 */
export function prefixesFromClassPackages(packages: string[]): string[] {
  if (packages.length === 0) return []
  const prefixes = new Set<string>()

  for (const depth of [3, 2, 1]) {
    const counts = new Map<string, number>()
    for (const pkg of packages) {
      const p = prefixSegments(pkg, depth)
      if (p) counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    for (const [prefix, n] of counts) {
      if (n >= 2) prefixes.add(prefix)
    }
    if (prefixes.size > 0) break
  }
  // 任意深度都只有 1 个类的包：直接加入完整包名
  if (prefixes.size === 0 && packages.length > 0) {
    for (const pkg of packages.slice(0, 4)) prefixes.add(pkg)
  }
  return [...prefixes].sort()
}

/** 全量构建包索引 */
export function buildPackageIndex(repo: ProfileRepository): PackageIndexEntry[] {
  const profiles = repo.listProfiles()
  const entries: PackageIndexEntry[] = []
  for (const profile of profiles) {
    let packages: string[] = []
    try {
      const reader = openZip(profile.identity.filePath)
      packages = reader
        .entries()
        .map((e) => {
          if (!e.path.endsWith('.class')) return null
          const cls = e.path.slice(0, -'.class'.length).replace(/\//g, '.')
          const dot = cls.lastIndexOf('.')
          return dot === -1 ? null : cls.slice(0, dot)
        })
        .filter((x): x is string => x !== null)
    } catch {
      continue
    }
    const prefixes = prefixesFromClassPackages(packages)
    if (prefixes.length === 0) continue
    entries.push({
      modId: profile.identity.modId,
      modName: profile.identity.modName,
      prefixes
    })
  }
  return entries
}
