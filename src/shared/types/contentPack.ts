/**
 * ContentPack 内容模块化共享类型与守卫。
 * 每个内容包是项目根 content-packs/<packId>/ 下的自包含目录（Git 友好、可跨项目复制）：
 * - pack.json 模块清单（含 enabled 启用开关与平台模组引用）
 * - overrides/ 组装时合并进 zip 的 overrides/
 * - mods/ 组装时随包到 zip 的 overrides/mods/
 * 启用状态存 pack.json 的 enabled 字段（UI 切换改写 pack.json，不进 pack.toml）。
 */
import type { CurseForgeFileEntry, ModrinthFileEntry } from './modpack'

/** 内容包 format 标记 */
export const CONTENT_PACK_FORMAT = 'kunyu-content-pack/1'

/** 内容包分类：科技 / 冒险 / 任务 / 库 / 其他 */
export type ContentPackCategory = 'tech' | 'adventure' | 'quest' | 'library' | 'other'

export const CONTENT_PACK_CATEGORIES: readonly ContentPackCategory[] = [
  'tech',
  'adventure',
  'quest',
  'library',
  'other'
]

/** pack.json.mods 平台引用：CurseForge 下载坐标（清单 files 条目） */
export interface ContentPackCurseForgeRef {
  platform: 'curseforge'
  projectID: number
  fileID: number
  /** 展示用文件名（不参与清单生成） */
  fileName?: string
}

/** pack.json.mods 平台引用：Modrinth 清单条目（哈希与直链齐全才可用，缺则告警跳过） */
export interface ContentPackModrinthRef {
  platform: 'modrinth'
  /** 游戏目录相对路径（如 mods/sodium.jar） */
  path: string
  sha1: string
  sha512: string
  size: number
  downloadUrl: string
}

export type ContentPackModRef = ContentPackCurseForgeRef | ContentPackModrinthRef

/** content-packs/<packId>/pack.json 清单 */
export interface ContentPackManifest {
  format: string
  /** 必须与目录名一致（路径安全边界） */
  id: string
  name: string
  category: ContentPackCategory
  version: string
  description: string
  author: string
  enabled: boolean
  mods: ContentPackModRef[]
}

/** 内容包扫描概要（UI 列表与 ModpackPlan.packs 共用） */
export interface ContentPackSummary {
  packId: string
  name: string
  category: ContentPackCategory
  version: string
  description: string
  enabled: boolean
  /** pack.json 是否合法（非法包只展示告警，不参与组装） */
  valid: boolean
  /** 解析告警（中文） */
  warnings: string[]
}

/** 组装输入：一个已扫描的内容包（纯数据，planner 保持零 IO） */
export interface ContentPackInput {
  packId: string
  name: string
  category: ContentPackCategory
  version: string
  description: string
  enabled: boolean
  /** pack.json 解析告警（透传到 plan.packs 展示） */
  warnings: string[]
  /** 包内 overrides/ 下文件（相对包 overrides/ 的 POSIX 路径） */
  overrideFiles: string[]
  /** 包内 mods/ 下 jar（项目相对路径 + 文件名） */
  jarFiles: { fileName: string; sourceRel: string }[]
  /** 平台引用转换出的清单条目 */
  curseforgeFiles: CurseForgeFileEntry[]
  modrinthFiles: ModrinthFileEntry[]
}

/** 新建内容包入参 */
export interface CreatePackInput {
  id: string
  name: string
  category: ContentPackCategory
  description?: string
  author?: string
}

/** 内容包操作回执（新建 / 启用切换共用） */
export interface ContentPackOpResult {
  ok: boolean
  error?: string
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** packId 安全性：禁止路径穿越、Windows 保留字符与点开头（隐藏目录） */
export function isValidPackId(id: string): boolean {
  if (!id || id !== id.trim() || id.startsWith('.') || id.includes('..') || /[/\\<>:"|?*\u0000-\u001f]/.test(id)) {
    return false
  }
  return /^[A-Za-z0-9._-]+$/.test(id)
}

export interface ParsePackDocResult {
  manifest: ContentPackManifest | null
  warnings: string[]
}

/**
 * 解析 pack.json 原始 JSON 为清单。
 * id 非法或与目录名不一致 → 整包拒（返回 null）；其余字段非法降级补默认并产出中文告警。
 */
export function parseContentPackDoc(raw: unknown, dirName: string): ParsePackDocResult {
  const warnings: string[] = []
  if (!isObj(raw)) {
    return { manifest: null, warnings: ['pack.json 内容不是有效的 JSON 对象，内容包已跳过。'] }
  }

  const id = str(raw.id)
  if (!isValidPackId(id)) {
    return {
      manifest: null,
      warnings: [`pack.json 的 id（${id || '缺失'}）非法或缺失，内容包已跳过。`]
    }
  }
  if (id !== dirName) {
    return {
      manifest: null,
      warnings: [`pack.json 的 id（${id}）与目录名（${dirName}）不一致，内容包已跳过。`]
    }
  }

  const format = str(raw.format) || CONTENT_PACK_FORMAT
  if (format !== CONTENT_PACK_FORMAT) {
    warnings.push(`内容包 ${id} 的 format 为 ${format}（期望 ${CONTENT_PACK_FORMAT}），已按当前版本解析。`)
  }

  const name = str(raw.name).trim() || dirName
  const category = (CONTENT_PACK_CATEGORIES as readonly string[]).includes(str(raw.category))
    ? (str(raw.category) as ContentPackCategory)
    : 'other'
  const version = str(raw.version)
  const description = str(raw.description)
  const author = str(raw.author)
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : false
  if (typeof raw.enabled !== 'boolean') {
    warnings.push(`内容包 ${id} 的 enabled 不是布尔值，按禁用处理。`)
  }

  const mods: ContentPackModRef[] = []
  if (Array.isArray(raw.mods)) {
    for (const [i, m] of raw.mods.entries()) {
      if (!isObj(m)) {
        warnings.push(`内容包 ${id} 的 mods[${i}] 不是对象，已跳过。`)
        continue
      }
      const platform = str(m.platform)
      if (platform === 'curseforge') {
        const projectID = m.projectID
        const fileID = m.fileID
        if (
          typeof projectID !== 'number' ||
          !Number.isInteger(projectID) ||
          projectID <= 0 ||
          typeof fileID !== 'number' ||
          !Number.isInteger(fileID) ||
          fileID <= 0
        ) {
          warnings.push(`内容包 ${id} 的 mods[${i}] CurseForge 坐标（projectID/fileID）非法，已跳过。`)
          continue
        }
        mods.push({
          platform: 'curseforge',
          projectID,
          fileID,
          ...(typeof m.fileName === 'string' && m.fileName ? { fileName: m.fileName } : {})
        })
      } else if (platform === 'modrinth') {
        const path = str(m.path)
        const sha1 = str(m.sha1)
        const sha512 = str(m.sha512)
        const size = m.size
        const downloadUrl = str(m.downloadUrl)
        if (!path || !sha1 || !sha512 || !downloadUrl || typeof size !== 'number' || size <= 0) {
          warnings.push(`内容包 ${id} 的 mods[${i}] Modrinth 条目缺少 path/sha1/sha512/size/downloadUrl，已跳过。`)
          continue
        }
        mods.push({ platform: 'modrinth', path, sha1, sha512, size, downloadUrl })
      } else {
        warnings.push(`内容包 ${id} 的 mods[${i}] 平台（${platform || '缺失'}）不支持，已跳过。`)
      }
    }
  } else if (raw.mods !== undefined) {
    warnings.push(`内容包 ${id} 的 mods 不是数组，已丢弃。`)
  }

  return {
    manifest: { format: CONTENT_PACK_FORMAT, id, name, category, version, description, author, enabled, mods },
    warnings
  }
}
