/**
 * P3-3 跨平台联动：CurseForge ↔ Modrinth 同模组映射缓存 + 版本滞后/重复/缺失预警。
 *
 * 映射策略（宁漏勿错，不做模糊打分）：
 *   1. slug 精确（MR /project/{slug}；CF mods/search?slug=）
 *   2. 名称归一化精确（去除非字母数字后全等，各侧召回前 5 条候选）
 * 结果持久化到 `.kunyu/crossmap.json`：命中缓存 30 天、未命中负缓存 7 天。
 *
 * 版本滞后：本侧版本列表按项目 mcVersion+loader 过滤取最新，与已装 versionId 比对；
 * 对侧仅用项目级 updatedAt 做「更新超前」提示（不为逐版本比对让请求量翻倍）。
 * 单模组失败不阻断整体报告；CF 无 Key 且镜像未启用时 CF 侧整体降级跳过。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  findProjectBySlug,
  isCurseforgeAvailable,
  listModFiles,
  searchProjectCandidates
} from './marketService'
import { readSources } from './modpack/provenance'
import type { CrossPlatformCandidate, MarketModFile, ModPlatform } from '../../shared/types/market'
import type {
  CrossLinkDuplicate,
  CrossLinkItem,
  CrossLinkMatchedBy,
  CrossLinkMissingDep,
  CrossLinkReport,
  ModSourceEntry
} from '../../shared/types/modpack'

/** 映射缓存 TTL：命中 30 天、未命中（负缓存）7 天 */
const HIT_TTL_MS = 30 * 24 * 3600 * 1000
const MISS_TTL_MS = 7 * 24 * 3600 * 1000

/** 名称归一化：小写 + 去除非字母数字（对齐大小写/连字符/空格差异） */
export function normalizeModName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** 从候选中挑对侧项目：slug 精确优先，其次名称归一化全等；都不中返回 null */
export function pickCounterpartMatch(
  candidates: CrossPlatformCandidate[],
  target: { slug: string; name: string }
): CrossPlatformCandidate | null {
  const slugLower = target.slug.toLowerCase()
  if (slugLower) {
    const bySlug = candidates.find((c) => c.slug.toLowerCase() === slugLower)
    if (bySlug) return bySlug
  }
  const nameNorm = normalizeModName(target.name)
  if (!nameNorm) return null
  return candidates.find((c) => normalizeModName(c.name) === nameNorm) ?? null
}

/** 版本列表按 mcVersion+loader 过滤取最新（无适配返回 null，不回退全局最新以免误导） */
export function latestCompatible(
  files: MarketModFile[],
  mcVersion: string,
  loader: string
): MarketModFile | null {
  const normLoader = loader.toLowerCase()
  const compat = files.filter(
    (f) =>
      (!mcVersion || f.gameVersions.includes(mcVersion)) &&
      (!normLoader || f.loaders.some((l) => l.toLowerCase() === normLoader))
  )
  if (compat.length === 0) return null
  return compat.sort((a, b) => +new Date(b.releasedAt) - +new Date(a.releasedAt))[0] ?? null
}

/** 已装条目 + 其对侧映射（报告中间态，纯函数与编排共享；对侧平台由查询方向补齐） */
export interface LinkedEntry {
  entry: ModSourceEntry
  counterpart: (CrossPlatformCandidate & { platform: ModPlatform }) | null
}

/** 每个已装条目占据的平台身份集合（自身 + 对侧映射）：依赖/重复判定共用 */
function platformIdsOf({ entry, counterpart }: LinkedEntry): string[] {
  const ids = [`${entry.platform}:${entry.modId}`]
  if (counterpart) ids.push(`${counterpart.platform}:${counterpart.id}`)
  return ids
}

/** 跨平台重复安装：同一逻辑模组（任一平台身份相交）在两个平台各装一份 */
export function buildDuplicates(linked: LinkedEntry[]): CrossLinkDuplicate[] {
  const dups: CrossLinkDuplicate[] = []
  for (let i = 0; i < linked.length; i++) {
    for (let j = i + 1; j < linked.length; j++) {
      const a = linked[i]!
      const b = linked[j]!
      // 同平台两份不算跨平台重复（属来源记录异常，不在此报告）
      if (a.entry.platform === b.entry.platform) continue
      const idsB = platformIdsOf(b)
      if (!platformIdsOf(a).some((id) => idsB.includes(id))) continue
      const cf = a.entry.platform === 'curseforge' ? a.entry : b.entry
      const mr = a.entry.platform === 'modrinth' ? a.entry : b.entry
      dups.push({ name: mr.name || cf.name, cfFileName: cf.fileName, mrFileName: mr.fileName })
    }
  }
  return dups
}

/** 市场侧 required 依赖缺失：已装版本声明的前置既未同平台安装、也无跨平台等价安装 */
export function buildMissingDeps(
  linked: LinkedEntry[],
  ownFiles: Map<string, MarketModFile[]>
): CrossLinkMissingDep[] {
  const installedIds = new Set<string>()
  for (const l of linked) platformIdsOf(l).forEach((id) => installedIds.add(id))
  const seen = new Set<string>()
  const out: CrossLinkMissingDep[] = []
  for (const { entry } of linked) {
    const files = ownFiles.get(`${entry.platform}:${entry.modId}`) ?? []
    const installed = files.find((f) => f.id === entry.versionId)
    for (const dep of installed?.dependencies ?? []) {
      if (dep.relationType !== 'required') continue
      const depKey = `${dep.platform}:${dep.modId}`
      if (installedIds.has(depKey) || seen.has(depKey)) continue
      seen.add(depKey)
      out.push({
        fileName: entry.fileName,
        name: entry.name,
        depPlatform: dep.platform,
        depModId: dep.modId
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 映射缓存 `.kunyu/crossmap.json`（风格与 provenance 一致：容错读、告警写）
// ---------------------------------------------------------------------------
interface CrossMapCacheEntry {
  candidate: CrossPlatformCandidate | null
  matchedBy: CrossLinkMatchedBy | null
  matchedAt: string
}

interface CrossMapFile {
  version: 1
  entries: Record<string, CrossMapCacheEntry>
}

export function crossMapPath(projectRoot: string): string {
  return join(projectRoot, '.kunyu', 'crossmap.json')
}

/** 读取映射缓存；文件缺失或损坏一律容错返回空表 */
export function readCrossMap(projectRoot: string): Map<string, CrossMapCacheEntry> {
  const map = new Map<string, CrossMapCacheEntry>()
  const file = crossMapPath(projectRoot)
  if (!existsSync(file)) return map
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<CrossMapFile> | null
    const entries = raw?.entries ?? {}
    for (const [key, e] of Object.entries(entries)) {
      if (!e || typeof e.matchedAt !== 'string') continue
      map.set(key, e)
    }
  } catch (err) {
    console.warn(`[crossLink] 映射缓存解析失败，按空缓存处理：${(err as Error).message}`)
  }
  return map
}

function writeCrossMap(projectRoot: string, map: Map<string, CrossMapCacheEntry>): void {
  const file = crossMapPath(projectRoot)
  try {
    mkdirSync(dirname(file), { recursive: true })
    const payload: CrossMapFile = { version: 1, entries: Object.fromEntries(map) }
    writeFileSync(file, JSON.stringify(payload, null, 2))
  } catch (err) {
    console.warn(`[crossLink] 映射缓存写入失败：${(err as Error).message}`)
  }
}

function cacheFresh(e: CrossMapCacheEntry, now: number): boolean {
  const age = now - +new Date(e.matchedAt)
  return e.candidate ? age < HIT_TTL_MS : age < MISS_TTL_MS
}

/** 解析单条已装记录的对侧映射（先缓存，未中再联网；结果写回缓存） */
async function resolveCounterpart(
  entry: ModSourceEntry,
  target: ModPlatform,
  apiKey: string,
  cache: Map<string, CrossMapCacheEntry>,
  dirty: { v: boolean }
): Promise<{ candidate: CrossPlatformCandidate | null; matchedBy: CrossLinkMatchedBy | null }> {
  const key = `${entry.platform}:${entry.modId}`
  const cached = cache.get(key)
  if (cached && cacheFresh(cached, Date.now())) {
    return { candidate: cached.candidate, matchedBy: cached.matchedBy }
  }
  // 1) slug 精确；2) 名称归一化精确
  let matchedBy: CrossLinkMatchedBy | null = null
  let candidate = await findProjectBySlug(target, entry.slug, apiKey)
  if (candidate) {
    matchedBy = 'slug'
  } else {
    candidate = pickCounterpartMatch(await searchProjectCandidates(target, entry.name, apiKey), entry)
    if (candidate) matchedBy = 'name'
  }
  cache.set(key, { candidate, matchedBy, matchedAt: new Date().toISOString() })
  dirty.v = true
  return { candidate, matchedBy }
}

/** 构造空报告（IPC 层目标解析失败等早退路径共用，保持结构完整） */
export function emptyCrossLinkReport(error?: string): CrossLinkReport {
  return {
    ok: !error,
    ...(error ? { error } : {}),
    generatedAt: '',
    items: [],
    duplicates: [],
    missingDeps: [],
    matchedCount: 0,
    updateCount: 0,
    cfUnavailable: false
  }
}

/**
 * 构建跨平台联动报告：逐已装模组联网（本侧版本列表 1 次 + 对侧映射 1~2 次），
 * 单模组失败降级跳过不阻断整体；映射结果落盘 `.kunyu/crossmap.json`。
 */
export async function buildCrossLinkReport(
  projectRoot: string,
  meta: { mcVersion: string; loader: string },
  curseforgeApiKey: string
): Promise<CrossLinkReport> {
  const entries = [...readSources(projectRoot).values()].filter(
    (e): e is ModSourceEntry & { platform: ModPlatform } => e.platform !== 'local' && !!e.modId
  )
  const report = emptyCrossLinkReport()
  report.generatedAt = new Date().toISOString()
  if (entries.length === 0) return report

  const cfOk = isCurseforgeAvailable(curseforgeApiKey)
  const cache = readCrossMap(projectRoot)
  const dirty = { v: false }
  const ownFiles = new Map<string, MarketModFile[]>()
  const linked: LinkedEntry[] = []

  for (const entry of entries) {
    const key = `${entry.platform}:${entry.modId}`
    // 本侧版本列表（CF 不可用时该侧整体降级：只出映射不出滞后）
    if (entry.platform === 'curseforge' && !cfOk) {
      report.cfUnavailable = true
    } else {
      try {
        ownFiles.set(key, await listModFiles(entry.platform, entry.modId, curseforgeApiKey))
      } catch {
        /* 单模组失败不阻断 */
      }
    }
    // 对侧映射
    const target: ModPlatform = entry.platform === 'curseforge' ? 'modrinth' : 'curseforge'
    let counterpart: CrossPlatformCandidate | null = null
    let matchedBy: CrossLinkMatchedBy | null = null
    if (target === 'curseforge' && !cfOk) {
      report.cfUnavailable = true
    } else {
      try {
        const r = await resolveCounterpart(entry, target, curseforgeApiKey, cache, dirty)
        counterpart = r.candidate
        matchedBy = r.matchedBy
      } catch {
        /* 单模组失败不阻断 */
      }
    }
    linked.push({ entry, counterpart: counterpart ? { ...counterpart, platform: target } : null })

    const files = ownFiles.get(key) ?? []
    const latest = latestCompatible(files, meta.mcVersion, meta.loader)
    const item: CrossLinkItem = {
      fileName: entry.fileName,
      name: entry.name,
      platform: entry.platform,
      modId: entry.modId,
      versionId: entry.versionId,
      versionNumber: entry.versionNumber,
      counterpart:
        counterpart && matchedBy
          ? {
              platform: target,
              id: counterpart.id,
              slug: counterpart.slug,
              name: counterpart.name,
              matchedBy,
              updatedAt: counterpart.updatedAt
            }
          : null,
      latest: latest
        ? { versionId: latest.id, versionNumber: latest.versionNumber, releasedAt: latest.releasedAt }
        : null,
      updateAvailable: !!latest && latest.id !== entry.versionId,
      counterpartAhead: !!(
        counterpart &&
        latest &&
        +new Date(counterpart.updatedAt) > +new Date(latest.releasedAt)
      )
    }
    report.items.push(item)
  }

  report.matchedCount = report.items.filter((i) => i.counterpart).length
  report.updateCount = report.items.filter((i) => i.updateAvailable).length
  report.duplicates = buildDuplicates(linked)
  report.missingDeps = buildMissingDeps(linked, ownFiles)
  if (dirty.v) writeCrossMap(projectRoot, cache)
  return report
}
