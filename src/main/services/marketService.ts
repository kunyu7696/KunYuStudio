/**
 * M9 模组市场与社区桥接服务。
 *
 * 统一封装 CurseForge 与 Modrinth 两个平台：
 *  - 搜索 / 详情 / 版本列表 → 统一适配为 MarketModSummary / MarketModDetail / MarketModFile
 *  - installMod：下载 jar 到项目 run/mods 目录，含冲突检测与依赖递归安装
 *
 * 平台差异（API Key、字段命名、下载链接规则）全部在此消化，渲染层只面向统一类型。
 * API Key 由 IPC 层从 settings.marketplace 注入，保持本服务可单元测试。
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { readFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { httpDownload, httpGetJson, type DownloadExpected } from './httpUtil'
import { getSection } from './settingsService'
import { translateZhQuery } from './marketQueryZh'
import type { ProvenanceRecorder } from './modpack/provenance'
import {
  PROJECT_TYPE_META,
  type MarketDependency,
  type MarketInstallInput,
  type MarketInstallResult,
  type MarketModDetail,
  type MarketModFile,
  type MarketModSummary,
  type MarketProjectType,
  type MarketSearchQuery,
  type MarketSearchResult,
  type ModPlatform
} from '../../shared/types/market'
import type { ModSourceEntry, SideRequirement } from '../../shared/types/modpack'

const CF_BASE = 'https://api.curseforge.com/v1'
/**
 * MCIM 社区镜像（https://www.mcimirror.top）：完全兼容 CurseForge 官方接口且免 Key。
 * 未配置官方 Key 时作为默认数据源；配置了用户自带 Key 时走官方 API（计入作者下载归因）。
 * 文件 CDN 同步镜像：edge.forgecdn.net → mod.mcimirror.top。
 */
const CF_MIRROR_BASE = 'https://mod.mcimirror.top/curseforge/v1'
const MR_BASE = 'https://api.modrinth.com/v2'
const USER_AGENT = 'KunYu-Studio/0.1 (+https://github.com/kunyu-ecosystem)'

/** 简单令牌桶：按平台限速（Modrinth 1 req/s，CurseForge 5 req/s） */
const RATE_LIMITS: Record<ModPlatform, number> = { modrinth: 1000, curseforge: 200 }
const lastRequest: Record<ModPlatform, number> = { modrinth: 0, curseforge: 0 }

async function rateLimit(platform: ModPlatform): Promise<void> {
  const now = Date.now()
  const wait = RATE_LIMITS[platform] - (now - lastRequest[platform])
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequest[platform] = Date.now()
}

/** CurseForge 请求端点：有 Key 走官方，无 Key 走 MCIM 镜像（镜像自带 Key，勿再附带空 x-api-key）。
 *  P1-10：镜像回退默认关闭——无 Key 且用户未在设置中显式允许时抛错，不静默走第三方镜像。 */
function cfEndpoint(apiKey: string): { base: string; headers: Record<string, string>; mirrored: boolean } {
  const mirrored = !apiKey
  if (mirrored && !getSection('marketplace').allowCfMirror) {
    throw new Error(
      '未配置 CurseForge API Key，且第三方镜像（MCIM）未启用。' +
      '请在 设置 → 模组市场 填入自己的 Key（推荐，计入作者归因），' +
      '或显式勾选「允许 MCIM 社区镜像」（数据可能与官方存在延迟/差异，风险自负）。'
    )
  }
  return {
    base: mirrored ? CF_MIRROR_BASE : CF_BASE,
    headers: apiKey
      ? { 'x-api-key': apiKey, 'User-Agent': USER_AGENT }
      : { 'User-Agent': USER_AGENT },
    mirrored
  }
}

/** 把官方 CDN 下载地址改写为 MCIM 镜像地址（仅镜像模式）。 */
function mirrorCfDownloadUrl(url: string): string {
  return url.replace(/^https?:\/\/edge\.forgecdn\.net/, 'https://mod.mcimirror.top')
}

// ---------------------------------------------------------------------------
// CurseForge API 原始类型（仅本文件内使用）
// ---------------------------------------------------------------------------
interface CfMod {
  id: number
  slug: string
  name: string
  summary: string
  logo?: { thumbnailUrl: string } | null
  downloadCount: number
  dateModified: string
  authors: Array<{ name: string }>
  categories: Array<{ name: string }>
  latestFiles: Array<CfFile>
  links?: { websiteUrl: string }
}

interface CfFile {
  id: number
  displayName: string
  fileName: string
  downloadUrl: string | null
  fileLength: number
  fileDate: string
  dependencies: Array<{ modId: number; relationType: number }>
  gameVersions: string[]
  // CF 用 sortableGameVersions 描述加载器/版本，但结构不统一，取 gameVersions 兜底
  sortableGameVersions?: Array<{ gameVersionName: string; gameVersionTypeId?: number }>
}

// ---------------------------------------------------------------------------
// Modrinth API 原始类型
// ---------------------------------------------------------------------------
interface MrProject {
  /** 详情 API 返回 id，搜索 API 返回 project_id —— 两个都兼容 */
  id?: string
  project_id?: string
  slug: string
  title: string
  description: string
  body?: string
  /** 项目许可（Modrinth license 对象：SPDX id + 展示 URL；P3-1a 随详情落盘供再分发合规判定） */
  license?: { id?: string; name?: string; url?: string } | null
  icon_url: string | null
  downloads: number
  updated: string
  categories: string[]
  loaders: string[]
  game_versions: string[]
  url?: string
  /** 搜索结果 hit 独有：作者 id / 总关注数等 */
  author_id?: string
  follows?: number
  /** 项目级运行侧别（Modrinth project API 返回 required/optional/unsupported） */
  client_side?: string
  server_side?: string
}

interface MrVersion {
  id: string
  name: string
  version_number: string
  date_published: string
  loaders: string[]
  game_versions: string[]
  dependencies: Array<{ project_id: string | null; dependency_type: string }>
  /** files 带平台权威哈希（P1-10：下载完整性校验以此为准） */
  files: Array<{
    url: string
    filename: string
    size: number
    primary: boolean
    hashes?: { sha1?: string; sha512?: string }
  }>
}

// ---------------------------------------------------------------------------
// 适配层
// ---------------------------------------------------------------------------
function cfLoaders(file: CfFile): string[] {
  const loaders = new Set<string>()
  for (const gv of file.gameVersions) {
    if (/fabric|forge|neoforge|quilt/i.test(gv)) loaders.add(gv.toLowerCase())
  }
  return [...loaders]
}

function cfGameVersions(file: CfFile): string[] {
  return file.gameVersions.filter((v) => /^\d+\.\d+/.test(v))
}

function adaptCfSummary(mod: CfMod, projectType: MarketProjectType): MarketModSummary {
  const files = mod.latestFiles ?? []
  const loaders = new Set<string>()
  const gameVersions = new Set<string>()
  for (const f of files) {
    cfLoaders(f).forEach((l) => loaders.add(l))
    cfGameVersions(f).forEach((v) => gameVersions.add(v))
  }
  return {
    id: String(mod.id),
    platform: 'curseforge',
    projectType,
    slug: mod.slug,
    name: mod.name,
    summary: mod.summary ?? '',
    authors: (mod.authors ?? []).map((a) => a.name),
    iconUrl: mod.logo?.thumbnailUrl ?? null,
    downloads: mod.downloadCount ?? 0,
    updatedAt: mod.dateModified,
    loaders: [...loaders],
    gameVersions: [...gameVersions],
    categories: (mod.categories ?? []).map((c) => c.name),
    url: mod.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/${PROJECT_TYPE_META[projectType].cfUrlSegment}/${mod.slug}`
  }
}

function adaptCfFile(modId: string, f: CfFile, mirrored: boolean): MarketModFile {
  // CF 部分文件 downloadUrl 为 null，需拼接下载端点；镜像模式下所有下载走 MCIM（官方 CDN 已强制 Key）
  let downloadUrl: string
  if (mirrored) {
    downloadUrl = f.downloadUrl
      ? mirrorCfDownloadUrl(f.downloadUrl)
      : `https://mod.mcimirror.top/files/${Math.floor(f.id / 1000)}/${f.id % 1000}/${f.fileName}`
  } else {
    downloadUrl =
      f.downloadUrl ||
      `https://www.curseforge.com/api/v1/mods/${modId}/files/${f.id}/download`
  }
  return {
    id: String(f.id),
    name: f.displayName || f.fileName,
    versionNumber: f.displayName || f.fileName,
    fileName: f.fileName,
    downloadUrl,
    size: f.fileLength,
    releasedAt: f.fileDate,
    loaders: cfLoaders(f),
    gameVersions: cfGameVersions(f),
    dependencies: (f.dependencies ?? []).map((d) => ({
      platform: 'curseforge',
      modId: String(d.modId),
      relationType: cfRelationType(d.relationType)
    }))
  }
}

function cfRelationType(t: number): MarketDependency['relationType'] {
  // CF relationType: 1=embedded, 2=optional, 3=required, 4=incompatible, 5=tool
  if (t === 3) return 'required'
  if (t === 2) return 'optional'
  if (t === 4) return 'incompatible'
  return 'optional'
}

function adaptMrSummary(p: MrProject, projectType: MarketProjectType): MarketModSummary {
  // 搜索 API 的 hit 用 project_id，详情 API 返回 id——统一兼容
  const id = p.project_id ?? p.id ?? ''
  return {
    id,
    platform: 'modrinth',
    projectType,
    slug: p.slug,
    name: p.title,
    summary: (p.description ?? '').slice(0, 300),
    authors: [],
    iconUrl: p.icon_url,
    downloads: p.downloads ?? 0,
    updatedAt: p.updated,
    loaders: p.loaders ?? [],
    gameVersions: p.game_versions ?? [],
    categories: p.categories ?? [],
    url: p.url ?? `https://modrinth.com/${PROJECT_TYPE_META[projectType].mrUrlSegment}/${p.slug}`
  }
}

function adaptMrVersion(v: MrVersion): MarketModFile {
  const primary = v.files.find((f) => f.primary) ?? v.files[0]
  return {
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    fileName: primary?.filename ?? `${v.id}.jar`,
    downloadUrl: primary?.url ?? '',
    // 平台权威哈希透传：下载校验与安装来源记录（整合包组装比对）共用
    ...(primary?.hashes ? { hashes: { sha1: primary.hashes.sha1, sha512: primary.hashes.sha512 } } : {}),
    size: primary?.size ?? 0,
    releasedAt: v.date_published,
    loaders: v.loaders ?? [],
    gameVersions: v.game_versions ?? [],
    dependencies: (v.dependencies ?? [])
      .filter((d) => d.project_id)
      .map((d) => ({
        platform: 'modrinth',
        modId: d.project_id!,
        relationType: mrRelationType(d.dependency_type)
      }))
  }
}

function mrRelationType(t: string): MarketDependency['relationType'] {
  if (t === 'required') return 'required'
  if (t === 'incompatible') return 'incompatible'
  return 'optional'
}

// ---------------------------------------------------------------------------
// CurseForge 客户端
// ---------------------------------------------------------------------------
/** CF modLoaderType 参数（仅 mod 类内容生效）：0=Any 1=Forge 4=Fabric 5=Quilt 6=NeoForge */
const CF_LOADER_TYPE: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }

async function searchCf(
  query: MarketSearchQuery,
  apiKey: string
): Promise<MarketSearchResult> {
  const projectType = query.projectType ?? 'mod'
  // 无 Key 且未显式允许镜像时 cfEndpoint 抛错（P1-10：镜像回退默认关闭）
  const ep = cfEndpoint(apiKey)
  const params = new URLSearchParams({
    gameId: '432',
    classId: String(PROJECT_TYPE_META[projectType].cfClassId),
    searchFilter: query.query ?? '',
    pageSize: String(query.pageSize ?? 20),
    index: String((query.page ?? 0) * (query.pageSize ?? 20)),
    sortField: '2', // 2=popularity, 3=last updated, 6=downloads
    sortOrder: 'desc'
  })
  if (query.gameVersion) params.set('gameVersion', query.gameVersion)
  // 加载器过滤仅对 mod 类有意义（光影/资源包等在 CF 无 modLoaderType 维度）
  if (projectType === 'mod' && query.loader) {
    const lt = CF_LOADER_TYPE[query.loader.toLowerCase()]
    if (lt) params.set('modLoaderType', String(lt))
  }
  await rateLimit('curseforge')
  const { data } = await httpGetJson<{ data: CfMod[]; pagination: { resultCount: number; totalCount: number } }>(
    `${ep.base}/mods/search?${params.toString()}`,
    { headers: ep.headers }
  )
  const items = (data.data ?? []).map((m) => adaptCfSummary(m, projectType))
  return {
    items,
    total: data.pagination?.totalCount ?? null,
    hasMore: items.length === (query.pageSize ?? 20)
  }
}

async function getCfDetail(modId: string, apiKey: string, projectType: MarketProjectType = 'mod'): Promise<MarketModDetail> {
  // 无 Key 且未显式允许镜像时 cfEndpoint 抛错（P1-10）
  const ep = cfEndpoint(apiKey)
  await rateLimit('curseforge')
  const { data: modResp } = await httpGetJson<{ data: CfMod }>(`${ep.base}/mods/${modId}`, {
    headers: ep.headers
  })
  await rateLimit('curseforge')
  const { data: filesResp } = await httpGetJson<{ data: CfFile[] }>(
    `${ep.base}/mods/${modId}/files`,
    { headers: ep.headers }
  )
  const summary = adaptCfSummary(modResp.data, projectType)
  const files = (filesResp.data ?? [])
    .map((f) => adaptCfFile(modId, f, ep.mirrored))
    .sort((a, b) => +new Date(b.releasedAt) - +new Date(a.releasedAt))
  return { ...summary, description: summary.summary, files }
}

// ---------------------------------------------------------------------------
// Modrinth 客户端
// ---------------------------------------------------------------------------
async function searchMr(query: MarketSearchQuery): Promise<MarketSearchResult> {
  const projectType = query.projectType ?? 'mod'
  const facets: string[] = []
  facets.push(`["project_type:${PROJECT_TYPE_META[projectType].mrProjectType}"]`)
  // 加载器 facet 仅 mod 类使用（光影的 iris/optifine、数据包的 datapack 是另一类加载器维度）
  if (projectType === 'mod' && query.loader) facets.push(`["categories:${query.loader}"]`)
  if (query.gameVersion) facets.push(`["versions:${query.gameVersion}"]`)
  const params = new URLSearchParams({
    query: query.query ?? '',
    limit: String(query.pageSize ?? 20),
    offset: String((query.page ?? 0) * (query.pageSize ?? 20))
  })
  if (facets.length) params.set('facets', `[${facets.join(',')}]`)
  await rateLimit('modrinth')
  const { data } = await httpGetJson<{ hits: MrProject[]; total_hits: number }>(
    `${MR_BASE}/search?${params.toString()}`,
    { headers: { 'User-Agent': USER_AGENT } }
  )
  const items = (data.hits ?? []).map((p) => adaptMrSummary(p, projectType))
  return {
    items,
    total: data.total_hits ?? null,
    hasMore: items.length === (query.pageSize ?? 20)
  }
}

async function getMrDetail(modId: string, projectType: MarketProjectType = 'mod'): Promise<MarketModDetail> {
  await rateLimit('modrinth')
  const { data: project } = await httpGetJson<MrProject>(`${MR_BASE}/project/${modId}`, {
    headers: { 'User-Agent': USER_AGENT }
  })
  await rateLimit('modrinth')
  const { data: versions } = await httpGetJson<MrVersion[]>(`${MR_BASE}/project/${modId}/version`, {
    headers: { 'User-Agent': USER_AGENT }
  })
  const summary = adaptMrSummary(project, projectType)
  const files = versions
    .map(adaptMrVersion)
    .sort((a, b) => +new Date(b.releasedAt) - +new Date(a.releasedAt))
  // P3-1a：许可协议随详情返回（CurseForge 端 API 无此字段，cf 详情恒为缺省）
  const licenseId = project.license?.id?.trim() || ''
  return {
    ...summary,
    description: project.body ?? summary.summary,
    files,
    clientSide: mrSide(project.client_side),
    serverSide: mrSide(project.server_side),
    license: licenseId ? { id: licenseId, name: project.license?.name?.trim() || licenseId } : null
  }
}

/** Modrinth 侧别字符串 → 三态；非法值视为 undefined（不采信） */
function mrSide(v: string | undefined): SideRequirement | undefined {
  return v === 'required' || v === 'optional' || v === 'unsupported' ? v : undefined
}

// ---------------------------------------------------------------------------
// 统一入口
// ---------------------------------------------------------------------------
export async function searchMods(
  query: MarketSearchQuery,
  curseforgeApiKey: string
): Promise<MarketSearchResult> {
  // M12 中文搜索：中→英桥接（钠→Sodium、光影→shaders），未收录中文保留兜底
  const translated = translateZhQuery(query.query ?? '')
  const effectiveQuery: MarketSearchQuery =
    translated.terms.length > 0 ? { ...query, query: translated.query } : query
  const result =
    effectiveQuery.platform === 'curseforge'
      ? await searchCf(effectiveQuery, curseforgeApiKey)
      : await searchMr(effectiveQuery)
  if (translated.terms.length > 0) result.translatedTerms = translated.terms
  if (translated.untranslated.length > 0) result.untranslatedZh = translated.untranslated
  return result
}

export async function getModDetail(
  platform: ModPlatform,
  modId: string,
  curseforgeApiKey: string,
  projectType: MarketProjectType = 'mod'
): Promise<MarketModDetail> {
  if (platform === 'curseforge') return getCfDetail(modId, curseforgeApiKey, projectType)
  return getMrDetail(modId, projectType)
}

export async function getModVersions(
  platform: ModPlatform,
  modId: string,
  curseforgeApiKey: string,
  projectType: MarketProjectType = 'mod'
): Promise<MarketModFile[]> {
  const detail = await getModDetail(platform, modId, curseforgeApiKey, projectType)
  return detail.files
}

// ---------------------------------------------------------------------------
// 安装：下载文件 → 校验 zip 头 → 按内容类型落盘 → 冲突检测 → 依赖（仅 mod）
// ---------------------------------------------------------------------------
interface InstallTarget {
  /** 绝对路径目录 */
  dir: string
  /** 展示用相对路径（结果回显） */
  display: string
  /** 冲突检测认的扩展名 */
  extensions: string[]
  /** 数据包落盘到具体存档时，提示用户重启/重进存档 */
  note?: string
}

/**
 * 按内容类型决定安装目标目录：
 * - mod → run/mods（.jar）
 * - resourcepack → run/resourcepacks（.zip）
 * - shader → run/shaderpacks（.zip）
 * - datapack → run/saves 下唯一存档的 datapacks；无存档或多存档时退回 run/datapacks 并提示
 * - modpack → 项目 modpacks/（.mrpack/.zip 仅下载，导入由启动器/整合包流程完成）
 */
function resolveInstallTarget(projectPath: string, projectType: MarketProjectType): InstallTarget {
  switch (projectType) {
    case 'resourcepack':
      return { dir: join(projectPath, 'run', 'resourcepacks'), display: 'run/resourcepacks', extensions: ['.zip'] }
    case 'shader':
      return { dir: join(projectPath, 'run', 'shaderpacks'), display: 'run/shaderpacks', extensions: ['.zip'] }
    case 'datapack': {
      const savesDir = join(projectPath, 'run', 'saves')
      let worlds: string[] = []
      try {
        worlds = readdirSync(savesDir).filter((n) => {
          try { return statSync(join(savesDir, n)).isDirectory() } catch { return false }
        })
      } catch { /* 无存档目录 */ }
      if (worlds.length === 1) {
        return {
          dir: join(savesDir, worlds[0]!, 'datapacks'),
          display: `run/saves/${worlds[0]}/datapacks`,
          extensions: ['.zip'],
          note: '数据包已装入存档，需重进存档或 /reload 生效'
        }
      }
      return {
        dir: join(projectPath, 'run', 'datapacks'),
        display: 'run/datapacks',
        extensions: ['.zip'],
        note: '未找到唯一存档：已放入 run/datapacks，请手动移入目标存档的 datapacks 目录'
      }
    }
    case 'modpack':
      return {
        dir: join(projectPath, 'modpacks'),
        display: 'modpacks',
        extensions: ['.zip', '.mrpack'],
        note: '整合包已下载，请在启动器中导入（mrpack/zip），本工具不直接展开安装'
      }
    default:
      return { dir: join(projectPath, 'run', 'mods'), display: 'run/mods', extensions: ['.jar'] }
  }
}

async function validateZip(filePath: string): Promise<void> {
  const fd = await readFile(filePath)
  // ZIP/JAR/mrpack 同为 ZIP 魔数 PK\x03\x04
  if (fd.length < 4 || fd[0] !== 0x50 || fd[1] !== 0x4b || fd[2] !== 0x03 || fd[3] !== 0x04) {
    throw new Error(`下载文件不是有效的 zip 包：${filePath}`)
  }
}

async function downloadOne(
  url: string,
  destPath: string,
  platform: ModPlatform,
  expected?: DownloadExpected,
  signal?: AbortSignal
): Promise<void> {
  await rateLimit(platform)
  // 平台权威哈希（sha512→sha1）流式校验；CF 无哈希时 size 兜底（httpDownload 内实现）
  await httpDownload(url, destPath, { expected, signal })
  await validateZip(destPath)
}

/**
 * 下载市场文件到目标路径：落到目标旁的 .part 半成品，校验通过后原子改名。
 * installMod / 依赖安装与用户级 Mod 库共用此函数；
 * 目标目录创建与冲突检测由调用方负责。
 *
 * 弱网：.part 路径稳定，用户再次点击下载时 httpDownload 会用 Range 从已有字节续传，
 * 而不是每次从零重来（此前用随机临时目录，断点无法复用）；失败保留 .part 供续传。
 * 支持 AbortSignal 取消（modlib 下载可中途取消）。
 */
export async function fetchToFile(
  url: string,
  platform: ModPlatform,
  destFile: string,
  expected?: DownloadExpected,
  signal?: AbortSignal
): Promise<void> {
  const partPath = `${destFile}.part`
  mkdirSync(dirname(destFile), { recursive: true })
  await downloadOne(url, partPath, platform, expected, signal)
  await rename(partPath, destFile)
}

export type PostInstallAnalysisHook = (
  files: string[],
  loader: string,
  mcVersion: string
) => { analyzed: number; warnings: string[] }

/**
 * 构造来源记录条目（仅供整合包项目消费，失败返回 null 不阻断安装）。
 * 坐标为平台反查所需：CF 记数值 modId/fileID，Modrinth 记 project id / version id + 直链。
 * Modrinth 项目级侧别（clientSide/serverSide）随记录落盘，作为组装 env 的权威信号。
 */
function toSourceEntry(
  platform: ModPlatform,
  modId: string,
  slug: string,
  name: string,
  file: MarketModFile,
  destFile: string,
  sides?: { clientSide?: SideRequirement; serverSide?: SideRequirement },
  licenseId?: string
): ModSourceEntry | null {
  try {
    return {
      fileName: file.fileName,
      platform,
      modId,
      versionId: file.id,
      slug,
      name,
      versionNumber: file.versionNumber,
      downloadUrl: file.downloadUrl || null,
      size: statSync(destFile).size,
      // 平台权威 sha1 随记录落盘：组装整合包时按内容识别本地替换（P1-10）
      ...(file.hashes?.sha1 ? { sha1: file.hashes.sha1 } : {}),
      ...(sides?.clientSide ? { clientSide: sides.clientSide } : {}),
      ...(sides?.serverSide ? { serverSide: sides.serverSide } : {}),
      // P3-1a：许可 SPDX id 随记录落盘，组装时判定随包再分发合规性
      ...(licenseId ? { license: licenseId } : {}),
      installedAt: new Date().toISOString()
    }
  } catch {
    return null
  }
}

/**
 * 安装市场内容到项目。目标目录按内容类型分流（见 resolveInstallTarget）；
 * 依赖递归、来源记录、安装后静态分析仅对 mod 类型生效。
 * @param postInstall 安装后静态分析钩子（可选）
 * @param provenance 来源记录器（可选，仅整合包项目由 IPC 层注入）
 */
export async function installMod(
  input: MarketInstallInput,
  curseforgeApiKey: string,
  postInstall?: PostInstallAnalysisHook,
  provenance?: ProvenanceRecorder
): Promise<MarketInstallResult> {
  const {
    platform,
    modId,
    versionId,
    projectPath,
    projectType = 'mod',
    includeDependencies = true,
    overwrite = false
  } = input
  try {
    const detail = await getModDetail(platform, modId, curseforgeApiKey, projectType)
    const file = detail.files.find((f) => f.id === versionId) ?? detail.files[0]
    if (!file) return { ok: false, error: '未找到可安装的版本文件' }

    const target = resolveInstallTarget(projectPath, projectType)
    const destDir = target.dir
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })

    // 冲突检测：同 slug 已存在的同类文件
    const existing = findExistingFile(destDir, detail.slug, target.extensions)
    if (existing && !overwrite) {
      return { ok: false, conflict: { existingFile: existing }, error: `已存在同内容文件：${existing}` }
    }
    if (existing && overwrite) {
      // 覆盖安装：先清掉旧文件的来源坐标，避免新旧版本坐标混用
      provenance?.remove(basename(existing))
      try { unlinkSync(existing) } catch { /* 忽略 */ }
    }

    const destFile = join(destDir, file.fileName)
    await fetchToFile(file.downloadUrl, platform, destFile, {
      sha512: file.hashes?.sha512,
      sha1: file.hashes?.sha1,
      size: file.size
    })

    // 来源记录仅 mod 类型（整合包清单引用的是模组坐标）
    const entry = projectType === 'mod'
      ? toSourceEntry(platform, modId, detail.slug, detail.name, file, destFile, {
          clientSide: detail.clientSide,
          serverSide: detail.serverSide
        }, detail.license?.id)
      : null
    if (entry) provenance?.record(entry)

    const installed: string[] = [destFile]
    const installedNames = [file.fileName]

    // 递归安装 required 依赖（深度上限 5，防循环）；仅模组有依赖语义
    if (projectType === 'mod' && includeDependencies) {
      const visited = new Set<string>([`${platform}:${modId}`])
      await installDependencies(
        file.dependencies,
        destDir,
        curseforgeApiKey,
        visited,
        1,
        installed,
        installedNames,
        provenance
      )
    }

    // 安装成功后静态分析入榜（仅模组）：失败仅告警，不影响安装结果、不回滚已安装文件
    let analyzed = 0
    let analysisWarnings: string[] = []
    if (projectType === 'mod' && postInstall && input.loader && input.mcVersion) {
      try {
        const hookResult = postInstall(installed, input.loader, input.mcVersion)
        analyzed = hookResult.analyzed
        analysisWarnings = hookResult.warnings
      } catch (hookErr) {
        analysisWarnings = [hookErr instanceof Error ? hookErr.message : String(hookErr)]
      }
    }

    // 来源记录一次落盘（安装失败路径不写）
    if (projectType === 'mod') provenance?.flush()

    return {
      ok: true,
      installed: destFile,
      installedDir: target.display,
      fileName: file.fileName,
      dependenciesInstalled: installedNames.slice(1),
      analyzed,
      analysisWarnings,
      note: target.note
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** 取路径末尾文件名（兼容 \ 与 /） */
function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || ''
}

function findExistingFile(dir: string, slug: string, extensions: string[]): string | null {
  const slugLower = slug.toLowerCase()
  const entries = readdirSync(dir)
  for (const name of entries) {
    const lower = name.toLowerCase()
    if (!extensions.some((ext) => lower.endsWith(ext))) continue
    // 文件名含 slug（不区分大小写、允许 -/_ 互换）即视为同内容
    const normalized = lower.replace(/[_\-\.]/g, '')
    const needle = slugLower.replace(/[_\-\.]/g, '')
    if (normalized.includes(needle)) return join(dir, name)
  }
  return null
}

async function installDependencies(
  deps: MarketDependency[],
  destDir: string,
  apiKey: string,
  visited: Set<string>,
  depth: number,
  installed: string[],
  installedNames: string[],
  provenance?: ProvenanceRecorder
): Promise<void> {
  if (depth > 5) return
  for (const dep of deps) {
    if (dep.relationType !== 'required') continue
    const key = `${dep.platform}:${dep.modId}`
    if (visited.has(key)) continue
    visited.add(key)
    try {
      const detail = await getModDetail(dep.platform, dep.modId, apiKey)
      const file = detail.files[0]
      if (!file?.downloadUrl) continue
      const existing = findExistingFile(destDir, detail.slug, ['.jar'])
      // 已存在同 slug：不写记录（记录归先前那次安装所有）
      if (existing) continue
      const destFile = join(destDir, file.fileName)
      await fetchToFile(file.downloadUrl, dep.platform, destFile, {
        sha512: file.hashes?.sha512,
        sha1: file.hashes?.sha1,
        size: file.size
      })
      installed.push(destFile)
      installedNames.push(file.fileName)
      const entry = toSourceEntry(dep.platform, dep.modId, detail.slug, detail.name, file, destFile, {
        clientSide: detail.clientSide,
        serverSide: detail.serverSide
      }, detail.license?.id)
      if (entry) provenance?.record(entry)
      await installDependencies(
        file.dependencies,
        destDir,
        apiKey,
        visited,
        depth + 1,
        installed,
        installedNames,
        provenance
      )
    } catch {
      // 单个依赖失败不阻断主模组安装
    }
  }
}

/** 测试连接：有 Key 时验证官方 API；无 Key 且允许镜像时验证 MCIM 可达性（Modrinth 始终可达） */
export async function testCurseforgeConnection(apiKey: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now()
  try {
    // cfEndpoint 在「无 Key 且镜像未启用」时抛错，转为连接失败文案返回
    const ep = cfEndpoint(apiKey)
    await rateLimit('curseforge')
    await httpGetJson<{ data: unknown[] }>(`${ep.base}/categories?gameId=432`, {
      headers: ep.headers,
      timeoutMs: 15000
    })
    return { ok: true, latencyMs: Date.now() - start }
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message }
  }
}
