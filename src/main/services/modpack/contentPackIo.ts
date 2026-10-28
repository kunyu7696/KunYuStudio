/**
 * ContentPack 目录 IO 层（项目根 content-packs/<packId>/）。
 * 仿 provenance.ts 风格：纯 node:fs、单测零 mock、失败容错不阻断组装。
 * - scanContentPacks：扫描每个子目录读 pack.json → 概要（坏包降级 + 告警）
 * - scanEnabledPackInputs：组装输入（仅合法包，含文件清单与平台引用条目）
 * - createContentPack：新建模块骨架（同 id 已存在则拒绝，不覆盖）
 * - setPackEnabled：读 pack.json → 改 enabled → 写回（保留其余字段）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import type { CurseForgeFileEntry, ModrinthFileEntry } from '../../../shared/types/modpack'
import {
  CONTENT_PACK_CATEGORIES,
  CONTENT_PACK_FORMAT,
  isValidPackId,
  parseContentPackDoc,
  type ContentPackInput,
  type ContentPackManifest,
  type ContentPackOpResult,
  type ContentPackSummary,
  type CreatePackInput
} from '../../../shared/types/contentPack'

/** 内容包模块根目录（项目相对） */
export const CONTENT_PACKS_DIR = 'content-packs'

function packsRoot(projectRoot: string): string {
  return join(projectRoot, CONTENT_PACKS_DIR)
}

function manifestPath(projectRoot: string, packId: string): string {
  return join(projectRoot, CONTENT_PACKS_DIR, packId, 'pack.json')
}

/** 递归列目录，返回相对 base 的 POSIX 路径（目录不存在返回空数组） */
function listFilesRel(base: string): string[] {
  const out: string[] = []
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name)
      const childRel = rel ? posix.join(rel, name) : name
      if (statSync(abs).isDirectory()) walk(abs, childRel)
      else out.push(childRel)
    }
  }
  if (existsSync(base)) walk(base, '')
  return out
}

/** 剥离 UTF-8 BOM（Windows 记事本/PowerShell 写出的 JSON 常带 BOM，直接 parse 会失败） */
function stripBom(text: string): string {
  return text.startsWith('\uFEFF') ? text.slice(1) : text
}

/** 读单个 pack.json；非法返回 null + 告警 */
function readManifest(projectRoot: string, dirName: string): {
  manifest: ContentPackManifest | null
  warnings: string[]
} {
  const abs = manifestPath(projectRoot, dirName)
  if (!existsSync(abs)) {
    return { manifest: null, warnings: [`内容包 ${dirName} 缺少 pack.json，已跳过。`] }
  }
  let raw: unknown
  try {
    raw = JSON.parse(stripBom(readFileSync(abs, 'utf8')))
  } catch (err) {
    return { manifest: null, warnings: [`内容包 ${dirName} 的 pack.json 解析失败：${(err as Error).message}`] }
  }
  return parseContentPackDoc(raw, dirName)
}

/** 扫描项目根 content-packs/ 下全部内容包概要（目录缺失返回空数组） */
export function scanContentPacks(projectRoot: string): ContentPackSummary[] {
  const root = packsRoot(projectRoot)
  if (!existsSync(root)) return []
  const out: ContentPackSummary[] = []
  for (const dirName of readdirSync(root)) {
    const abs = join(root, dirName)
    if (!statSync(abs).isDirectory()) continue
    const { manifest, warnings } = readManifest(projectRoot, dirName)
    if (!manifest) {
      out.push({
        packId: dirName,
        name: dirName,
        category: 'other',
        version: '',
        description: '',
        enabled: false,
        valid: false,
        warnings
      })
      continue
    }
    out.push({
      packId: manifest.id,
      name: manifest.name,
      category: manifest.category,
      version: manifest.version,
      description: manifest.description,
      enabled: manifest.enabled,
      valid: true,
      warnings
    })
  }
  return out.sort((a, b) => a.packId.localeCompare(b.packId))
}

/**
 * 组装输入扫描：合法包 → ContentPackInput（含 enabled 标志，禁用包不产文件清单也行，
 * planner 按 enabled 决定是否合并；概要供 plan.packs 展示）。
 */
export function scanEnabledPackInputs(projectRoot: string): ContentPackInput[] {
  const root = packsRoot(projectRoot)
  if (!existsSync(root)) return []
  const out: ContentPackInput[] = []
  for (const dirName of readdirSync(root)) {
    const packDir = join(root, dirName)
    if (!statSync(packDir).isDirectory()) continue
    const { manifest, warnings } = readManifest(projectRoot, dirName)
    if (!manifest) continue

    const curseforgeFiles: CurseForgeFileEntry[] = []
    const modrinthFiles: ModrinthFileEntry[] = []
    for (const ref of manifest.mods) {
      if (ref.platform === 'curseforge') {
        curseforgeFiles.push({ projectID: ref.projectID, fileID: ref.fileID, required: true })
      } else {
        modrinthFiles.push({
          path: ref.path,
          hashes: { sha1: ref.sha1, sha512: ref.sha512 },
          fileSize: ref.size,
          downloads: [ref.downloadUrl],
          env: { client: 'required', server: 'required' }
        })
      }
    }

    out.push({
      packId: manifest.id,
      name: manifest.name,
      category: manifest.category,
      version: manifest.version,
      description: manifest.description,
      enabled: manifest.enabled,
      warnings,
      overrideFiles: listFilesRel(join(packDir, 'overrides')),
      jarFiles: listFilesRel(join(packDir, 'mods'))
        .filter((rel) => rel.toLowerCase().endsWith('.jar'))
        .map((rel) => ({
          fileName: rel.split('/').pop() ?? rel,
          sourceRel: posix.join(CONTENT_PACKS_DIR, manifest.id, 'mods', rel)
        })),
      curseforgeFiles,
      modrinthFiles
    })
  }
  return out.sort((a, b) => a.packId.localeCompare(b.packId))
}

/**
 * 新建内容包骨架：content-packs/<id>/pack.json + overrides/ + mods/ 空目录。
 * id 非法或目录已存在时拒绝（幂等保护，绝不覆盖用户内容）。
 */
export function createContentPack(projectRoot: string, input: CreatePackInput): ContentPackOpResult {
  const id = input.id.trim()
  if (!isValidPackId(id)) {
    return { ok: false, error: `内容包 ID 非法：只允许字母、数字、点、下划线、连字符，且不能是「.」开头。` }
  }
  if (!(CONTENT_PACK_CATEGORIES as readonly string[]).includes(input.category)) {
    return { ok: false, error: `内容包分类（${input.category}）不支持。` }
  }
  const packDir = join(packsRoot(projectRoot), id)
  if (existsSync(packDir)) {
    return { ok: false, error: `内容包目录已存在：content-packs/${id}/（不覆盖现有内容）。` }
  }
  const manifest: ContentPackManifest = {
    format: CONTENT_PACK_FORMAT,
    id,
    name: input.name.trim() || id,
    category: input.category,
    version: '1.0.0',
    description: input.description ?? '',
    author: input.author ?? '',
    enabled: true,
    mods: []
  }
  try {
    mkdirSync(join(packDir, 'overrides'), { recursive: true })
    mkdirSync(join(packDir, 'mods'), { recursive: true })
    writeFileSync(manifestPath(projectRoot, id), JSON.stringify(manifest, null, 2), 'utf-8')
  } catch (err) {
    return { ok: false, error: `内容包创建失败：${(err as Error).message}` }
  }
  return { ok: true }
}

/**
 * 切换内容包启用状态：读 pack.json → 改 enabled → 写回（保留其余字段与未知键）。
 * pack.json 缺失或坏 JSON 时拒绝，不猜测。
 */
export function setPackEnabled(projectRoot: string, packId: string, enabled: boolean): ContentPackOpResult {
  if (!isValidPackId(packId)) {
    return { ok: false, error: `内容包 ID（${packId}）非法。` }
  }
  const abs = manifestPath(projectRoot, packId)
  if (!existsSync(abs)) {
    return { ok: false, error: `未找到内容包 content-packs/${packId}/pack.json。` }
  }
  let doc: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(stripBom(readFileSync(abs, 'utf8')))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: `内容包 ${packId} 的 pack.json 不是 JSON 对象，无法切换启用状态。` }
    }
    doc = parsed as Record<string, unknown>
  } catch (err) {
    return { ok: false, error: `内容包 ${packId} 的 pack.json 解析失败：${(err as Error).message}` }
  }
  doc.enabled = enabled
  try {
    writeFileSync(abs, JSON.stringify(doc, null, 2), 'utf-8')
  } catch (err) {
    return { ok: false, error: `内容包 ${packId} 的 pack.json 写入失败：${(err as Error).message}` }
  }
  return { ok: true }
}
