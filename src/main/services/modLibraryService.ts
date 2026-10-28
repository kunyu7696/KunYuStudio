/**
 * 用户级 Mod 库服务。
 *
 * 库布局（libraryRoot = userData/mod-library/，由 IPC 层注入）：
 *  - *.jar：市场下载/本地导入的模组文件
 *  - library.json：条目清单（ModLibraryFile）
 *
 * 能力：列表过滤 / 市场版本下载入库 / 本地 jar 导入 / 移除 /
 *      加入整合包项目（复制到 run/mods + 来源坐标 provenance）。
 * 本服务不依赖 Electron API，单测零 mock。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { listZipEntries } from './archiveExtract'
import { fetchToFile, getModDetail } from './marketService'
import { createProvenanceRecorder } from './modpack/provenance'
import type { ModSourceEntry } from '../../shared/types/modpack'
import type {
  ModLibraryEntry,
  ModLibraryFile,
  ModLibraryFilter,
  ModLibraryOpResult,
  ModLibraryDownloadInput,
  ResourceLibraryType
} from '../../shared/types/modLibrary'

const LIBRARY_FILE = 'library.json'

/** 合法资源类型白名单（落盘分流与清单归一共用） */
const RESOURCE_TYPES: readonly ResourceLibraryType[] = ['mod', 'resourcepack', 'datapack', 'shader', 'modpack']

/** 本地导入可识别的扩展名 */
const IMPORT_EXTENSIONS = ['.jar', '.zip', '.mrpack']

function libraryFilePath(libraryRoot: string): string {
  return join(libraryRoot, LIBRARY_FILE)
}

/** 归一资源类型：旧条目缺失/非法值一律按 'mod' 处理（读时归一，不改盘文件） */
function normalizeResourceType(value: unknown): ResourceLibraryType {
  return RESOURCE_TYPES.includes(value as ResourceLibraryType) ? (value as ResourceLibraryType) : 'mod'
}

/** 读取库清单；缺失/损坏一律回退空表（不阻断）。旧条目读时归一 resourceType。 */
function readLibrary(libraryRoot: string): ModLibraryEntry[] {
  const file = libraryFilePath(libraryRoot)
  if (!existsSync(file)) return []
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<ModLibraryFile> | null
    if (!Array.isArray(raw?.entries)) return []
    return raw.entries
      .filter((e): e is ModLibraryEntry => !!(e && e.fileName))
      .map((e) => ({ ...e, resourceType: normalizeResourceType(e.resourceType) }))
  } catch (err) {
    console.warn(`[modlib] 库清单解析失败，按空表处理：${(err as Error).message}`)
    return []
  }
}

/** 写出库清单 */
function writeLibrary(libraryRoot: string, entries: ModLibraryEntry[]): void {
  mkdirSync(libraryRoot, { recursive: true })
  const payload: ModLibraryFile = { version: 1, entries }
  writeFileSync(libraryFilePath(libraryRoot), JSON.stringify(payload, null, 2))
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || ''
}

/** 简单 zip/jar 魔数校验（PK\x03\x04） */
function assertJar(filePath: string): void {
  const fd = readFileSync(filePath)
  if (fd.length < 4 || fd[0] !== 0x50 || fd[1] !== 0x4b || fd[2] !== 0x03 || fd[3] !== 0x04) {
    throw new Error(`不是有效的 jar/zip 文件：${filePath}`)
  }
}

/** zip 结构探测：按条目名判定包类型（shaders/ → 光影；data/ → 数据包；assets/ 或 pack.mcmeta → 资源包） */
function probeZipType(filePath: string): ResourceLibraryType {
  let names: string[]
  try {
    names = listZipEntries(readFileSync(filePath))
  } catch {
    return 'resourcepack'
  }
  if (names.some((n) => n === 'shaders' || n.startsWith('shaders/'))) return 'shader'
  if (names.some((n) => n === 'data' || n.startsWith('data/'))) return 'datapack'
  return 'resourcepack'
}

/** 按扩展名 + zip 结构识别资源类型：.jar → mod；.mrpack → modpack；.zip → 结构探测（默认 resourcepack） */
export function detectResourceType(fileName: string, filePath?: string): ResourceLibraryType {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.jar')) return 'mod'
  if (lower.endsWith('.mrpack')) return 'modpack'
  if (lower.endsWith('.zip')) return filePath ? probeZipType(filePath) : 'resourcepack'
  return 'mod'
}

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

/** 列出库条目（可按加载器/MC版本/资源类型/名称过滤），按加入时间倒序 */
export function listEntries(libraryRoot: string, filter: ModLibraryFilter = {}): ModLibraryEntry[] {
  let entries = readLibrary(libraryRoot)
  if (filter.type) {
    entries = entries.filter((e) => e.resourceType === filter.type)
  }
  if (filter.loader) {
    entries = entries.filter((e) => e.loaders.map((l) => l.toLowerCase()).includes(filter.loader!.toLowerCase()))
  }
  if (filter.mcVersion) {
    entries = entries.filter((e) => e.gameVersions.includes(filter.mcVersion!))
  }
  if (filter.query && filter.query.trim()) {
    const q = filter.query.trim().toLowerCase()
    entries = entries.filter((e) => e.name.toLowerCase().includes(q) || e.fileName.toLowerCase().includes(q))
  }
  return entries.sort((a, b) => +new Date(b.addedAt) - +new Date(a.addedAt))
}

// ---------------------------------------------------------------------------
// 市场下载入库
// ---------------------------------------------------------------------------

/**
 * 从市场下载指定版本文件入库并登记。
 * 同名 jar 已在库时幂等返回（平台文件名全局唯一，同名视为同版本）。
 */
export async function downloadEntry(
  libraryRoot: string,
  input: ModLibraryDownloadInput,
  curseforgeApiKey: string,
  signal?: AbortSignal
): Promise<ModLibraryOpResult> {
  try {
    const existing = readLibrary(libraryRoot)
    const detail = await getModDetail(input.platform, input.projectId, curseforgeApiKey, input.projectType ?? 'mod')
    const file = detail.files.find((f) => f.id === input.versionId) ?? detail.files[0]
    if (!file) return { ok: false, error: '未找到可下载的版本文件' }
    if (existing.some((e) => e.fileName === file.fileName)) {
      return { ok: true, fileName: file.fileName, message: '已在资源库中' }
    }
    mkdirSync(libraryRoot, { recursive: true })
    const destFile = join(libraryRoot, file.fileName)
    // modlib 下载补平台哈希校验（与 installMod 路径对齐），
    // 之前缺失导致同一份篡改文件 installMod 拒绝、modlib 接受。
    await fetchToFile(file.downloadUrl, input.platform, destFile, {
      sha512: file.hashes?.sha512,
      sha1: file.hashes?.sha1,
      size: file.size
    }, signal)

    // 资源类型：平台项目类型优先；拿不到时按扩展名/zip 结构识别
    const resourceType: ResourceLibraryType =
      input.projectType && RESOURCE_TYPES.includes(input.projectType)
        ? input.projectType
        : detectResourceType(file.fileName, destFile)

    const entry: ModLibraryEntry = {
      fileName: file.fileName,
      resourceType,
      name: detail.name,
      platform: input.platform,
      projectId: input.projectId,
      versionId: file.id,
      slug: detail.slug,
      versionNumber: file.versionNumber || file.name,
      loaders: file.loaders,
      gameVersions: file.gameVersions,
      size: statSync(destFile).size,
      downloadUrl: file.downloadUrl || null,
      iconUrl: detail.iconUrl ?? null,
      addedAt: new Date().toISOString()
    }
    existing.push(entry)
    writeLibrary(libraryRoot, existing)
    return { ok: true, fileName: file.fileName }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * 补齐旧版条目的平台图标（早期入库未记录 iconUrl）。
 * 逐条拉详情，失败静默跳过（离线时保持无图标，界面用首字母占位）；
 * 有变化才回写 library.json。返回是否有更新。
 */
export async function enrichIcons(
  libraryRoot: string,
  curseforgeApiKey: string,
  signal?: AbortSignal
): Promise<boolean> {
  const entries = readLibrary(libraryRoot)
  const missing = entries.filter(
    (e) => e.platform !== 'local' && e.projectId && !e.iconUrl
  )
  if (missing.length === 0) return false
  let changed = false
  for (const entry of missing) {
    if (signal?.aborted) break
    try {
      const detail = await getModDetail(entry.platform as 'curseforge' | 'modrinth', entry.projectId!, curseforgeApiKey, 'mod')
      if (detail.iconUrl) {
        entry.iconUrl = detail.iconUrl
        changed = true
      }
    } catch {
      /* 离线/接口异常：保留占位图标即可 */
    }
  }
  if (changed) writeLibrary(libraryRoot, entries)
  return changed
}

// ---------------------------------------------------------------------------
// 本地导入
// ---------------------------------------------------------------------------

/**
 * 导入本地资源文件到库（复制落盘 + local 条目登记）。
 * 支持 .jar/.zip/.mrpack；类型按扩展名 + zip 结构识别（见 detectResourceType）。
 * 同名文件跳过；非 jar/zip/mrpack 或魔数不对的抛错由调用方汇总。
 */
export async function importLocalFiles(
  libraryRoot: string,
  filePaths: string[]
): Promise<ModLibraryEntry[]> {
  mkdirSync(libraryRoot, { recursive: true })
  const entries = readLibrary(libraryRoot)
  const imported: ModLibraryEntry[] = []
  for (const src of filePaths) {
    const fileName = basename(src)
    const lower = fileName.toLowerCase()
    if (!fileName || !IMPORT_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue
    if (entries.some((e) => e.fileName === fileName)) continue
    assertJar(src)
    const destFile = join(libraryRoot, fileName)
    await copyFile(src, destFile)
    const entry: ModLibraryEntry = {
      fileName,
      resourceType: detectResourceType(fileName, destFile),
      name: fileName.replace(/\.(jar|zip|mrpack)$/i, ''),
      platform: 'local',
      projectId: null,
      versionId: null,
      slug: null,
      versionNumber: '',
      loaders: [],
      gameVersions: [],
      size: statSync(destFile).size,
      downloadUrl: null,
      addedAt: new Date().toISOString()
    }
    entries.push(entry)
    imported.push(entry)
  }
  if (imported.length) writeLibrary(libraryRoot, entries)
  return imported
}

// ---------------------------------------------------------------------------
// 移除
// ---------------------------------------------------------------------------

/** 从库移除条目并删除 jar；返回是否有移除 */
export function removeEntry(libraryRoot: string, fileName: string): boolean {
  const entries = readLibrary(libraryRoot)
  const next = entries.filter((e) => e.fileName !== fileName)
  if (next.length === entries.length) return false
  const jarPath = join(libraryRoot, fileName)
  try { if (existsSync(jarPath)) unlinkSync(jarPath) } catch { /* 删文件失败不阻断清单更新 */ }
  writeLibrary(libraryRoot, next)
  return true
}

// ---------------------------------------------------------------------------
// 加入整合包项目
// ---------------------------------------------------------------------------

/** 由库条目构造来源记录坐标（local 条目返回 null，走 overrides 兜底） */
function toSourceEntry(entry: ModLibraryEntry): ModSourceEntry | null {
  if (entry.platform === 'local' || !entry.projectId || !entry.versionId) return null
  return {
    fileName: entry.fileName,
    platform: entry.platform,
    modId: entry.projectId,
    versionId: entry.versionId,
    slug: entry.slug ?? '',
    name: entry.name,
    versionNumber: entry.versionNumber,
    downloadUrl: entry.downloadUrl,
    size: entry.size,
    installedAt: new Date().toISOString()
  }
}

/** 各资源类型加入项目的目标目录（datapack 需叠加存档名，见 resolveTargetDir） */
const TARGET_DIRS: Record<Exclude<ResourceLibraryType, 'datapack' | 'modpack'>, { rel: string[]; display: string }> = {
  mod: { rel: ['run', 'mods'], display: 'run/mods' },
  resourcepack: { rel: ['run', 'resourcepacks'], display: 'run/resourcepacks' },
  shader: { rel: ['run', 'shaderpacks'], display: 'run/shaderpacks' }
}

/** 列出项目 run/saves 下的世界目录名（无 saves 目录返回空表） */
export function listWorlds(projectPath: string): string[] {
  const savesDir = join(projectPath, 'run', 'saves')
  try {
    return readdirSync(savesDir).filter((n) => {
      try { return statSync(join(savesDir, n)).isDirectory() } catch { return false }
    })
  } catch {
    return []
  }
}

/** 按资源类型解析落盘目录；非法类型/缺存档名/路径逃逸一律抛错（调用方转 error 返回） */
function resolveTargetDir(
  projectPath: string,
  resourceType: ResourceLibraryType,
  worldName?: string
): { dir: string; display: string } {
  if (resourceType === 'modpack') {
    throw new Error('整合包不能加入项目：请从新建项目导入')
  }
  let rel: string[]
  let display: string
  if (resourceType === 'datapack') {
    if (!worldName || worldName === '..' || worldName.includes('/') || worldName.includes('\\')) {
      throw new Error('数据包需要指定目标存档（run/saves 下的世界目录）')
    }
    rel = ['run', 'saves', worldName, 'datapacks']
    display = `run/saves/${worldName}/datapacks`
  } else {
    const target = TARGET_DIRS[resourceType]
    if (!target) throw new Error(`未知的资源类型：${resourceType}`)
    rel = target.rel
    display = target.display
  }
  const dir = join(projectPath, ...rel)
  // 防路径穿越：落盘目录必须解析在项目目录内
  const resolved = resolve(dir)
  if (resolved !== resolve(projectPath) && !resolved.startsWith(resolve(projectPath) + sep)) {
    throw new Error(`落盘目录越出项目：${display}`)
  }
  return { dir, display }
}

/**
 * 把库内资源加入整合包项目：按类型分流落盘（mod→run/mods，resourcepack→run/resourcepacks，
 * shader→run/shaderpacks，datapack→run/saves/<世界名>/datapacks，modpack 拒绝）。
 * 仅 mod 类型同步 provenance 来源坐标（整合包清单只引用模组坐标）。
 * 目标已存在同名文件：overwrite=false 返回 conflict；true 覆盖并更新坐标。
 */
export async function addEntryToProject(
  libraryRoot: string,
  projectPath: string,
  fileName: string,
  overwrite = false,
  worldName?: string
): Promise<ModLibraryOpResult> {
  try {
    const entry = readLibrary(libraryRoot).find((e) => e.fileName === fileName)
    if (!entry) return { ok: false, error: `资源库中不存在：${fileName}` }
    if (entry.resourceType === 'modpack') {
      return { ok: false, error: '整合包请从新建项目导入' }
    }
    // fileName 来自库清单，仍按纯文件名白名单校验（防清单被篡改后的路径穿越）
    if (fileName !== basename(fileName)) return { ok: false, error: `非法文件名：${fileName}` }
    const srcFile = join(libraryRoot, fileName)
    if (!existsSync(srcFile)) return { ok: false, error: `库内资源文件丢失：${fileName}` }

    const target = resolveTargetDir(projectPath, entry.resourceType, worldName)
    const destFile = join(target.dir, fileName)
    if (existsSync(destFile) && !overwrite) {
      return { ok: false, error: `${target.display} 已存在同名文件：${fileName}`, conflict: { existingFile: destFile } }
    }
    mkdirSync(target.dir, { recursive: true })
    await copyFile(srcFile, destFile)

    // 来源坐标仅 mod 类型：覆盖旧坐标后写入新坐标
    const source = entry.resourceType === 'mod' ? toSourceEntry(entry) : null
    if (source) {
      const recorder = createProvenanceRecorder(projectPath)
      if (overwrite) recorder.remove(fileName)
      recorder.record(source)
      recorder.flush()
    }
    return { ok: true, fileName, message: target.display }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * 库体检：清掉清单中 jar 文件已不存在的悬空条目（诊断用）。
 */
export function pruneMissing(libraryRoot: string): number {
  const entries = readLibrary(libraryRoot)
  const next = entries.filter((e) => existsSync(join(libraryRoot, e.fileName)))
  if (next.length !== entries.length) writeLibrary(libraryRoot, next)
  return entries.length - next.length
}

/** 重新扫描库目录：把磁盘有但清单缺失的 jar/zip/mrpack 补登为 local 条目 */
export function rescanLibrary(libraryRoot: string): ModLibraryEntry[] {
  if (!existsSync(libraryRoot)) return []
  const entries = readLibrary(libraryRoot)
  const known = new Set(entries.map((e) => e.fileName))
  const added: ModLibraryEntry[] = []
  for (const name of readdirSync(libraryRoot)) {
    const lower = name.toLowerCase()
    if (!IMPORT_EXTENSIONS.some((ext) => lower.endsWith(ext)) || known.has(name)) continue
    const filePath = join(libraryRoot, name)
    if (!statSync(filePath).isFile()) continue
    const entry: ModLibraryEntry = {
      fileName: name,
      resourceType: detectResourceType(name, filePath),
      name: name.replace(/\.(jar|zip|mrpack)$/i, ''),
      platform: 'local',
      projectId: null,
      versionId: null,
      slug: null,
      versionNumber: '',
      loaders: [],
      gameVersions: [],
      size: statSync(filePath).size,
      downloadUrl: null,
      addedAt: new Date().toISOString()
    }
    entries.push(entry)
    added.push(entry)
  }
  if (added.length) writeLibrary(libraryRoot, entries)
  return added
}
