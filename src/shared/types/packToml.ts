/**
 * pack.toml 中间表示层（packwiz 风格）共享类型与守卫。
 * pack.toml = 人可读元数据 IR（Git 友好，用户/Agent 可手编）；
 * index.toml = 组装时自动重生成的文件清单快照（勿手编）。
 * 导出时由 modpackAssembler 把 IR 转换为 CurseForge manifest.json / Modrinth modrinth.index.json。
 */
import type { ModLoader } from './project'

/** pack.toml 的 pack-format 标记（对齐 packwiz 官方；旧版曾写自定义 kunyu-modpack/1） */
export const PACK_TOML_FORMAT = 'packwiz:1.1.0'

/** index.toml 固定哈希算法 */
export const INDEX_HASH_FORMAT = 'sha256'

/** pack.toml versions 段的加载器键名（贴 packwiz 习惯：fabric-loader / forge / neoforge） */
export function packTomlLoaderKey(loader: ModLoader): string {
  return loader === 'fabric' ? 'fabric-loader' : loader
}

/** 规范化后的 pack.toml IR。版本三项仅用于与项目设置比对告警，DB 元数据始终权威 */
export interface PackTomlIr {
  format: string
  name: string
  author: string
  version: string
  description: string
  minecraft: string | null
  loader: ModLoader | null
  loaderVersion: string | null
}

/** index.toml 单文件条目（项目相对路径 + sha256；mods 条目附来源 meta） */
export interface IndexTomlFile {
  /** 项目相对 POSIX 路径（如 run/mods/a.jar、overrides/config/x.conf） */
  file: string
  /** sha256 十六进制摘要 */
  hash: string
  /** 字节大小 */
  size: number
  /** 来源平台（仅 mods 条目；来自 .kunyu/modpack.json） */
  platform?: 'curseforge' | 'modrinth' | 'local'
  /** 平台 slug（仅 mods 条目） */
  slug?: string
  /** 平台版本文件 id（仅 mods 条目） */
  versionId?: string
  /** 归属内容包 id（仅 content-packs/ 贡献的条目） */
  pack?: string
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function nonEmpty(v: string | null): string | null {
  return v && v.trim() ? v.trim() : null
}

/** 从 versions 段识别加载器与版本（键名贴 packwiz：fabric-loader / forge / neoforge） */
function readLoader(versions: Record<string, unknown>): {
  loader: ModLoader | null
  loaderVersion: string | null
} {
  for (const key of ['fabric-loader', 'forge', 'neoforge'] as const) {
    const v = nonEmpty(str(versions[key]))
    if (v) {
      const loader: ModLoader = key === 'fabric-loader' ? 'fabric' : key
      return { loader, loaderVersion: v }
    }
  }
  return { loader: null, loaderVersion: null }
}

export interface NormalizePackResult {
  ir: PackTomlIr
  warnings: string[]
}

/**
 * 把 TOML parse 出的原始文档规范化为 IR。
 * 宽松解析：字段缺失补默认值并产出中文告警，绝不抛异常（组装层决定 fail-fast 时机）。
 */
export function normalizePackTomlDoc(raw: unknown): NormalizePackResult {
  const warnings: string[] = []
  const doc = isObj(raw) ? raw : {}
  if (!isObj(raw)) warnings.push('pack.toml 内容不是有效的 TOML 表，已按空文档处理。')

  // packwiz 规范键为 pack-format；兼容旧版 format（kunyu-modpack/1）
  const format =
    nonEmpty(str(doc['pack-format'])) ?? nonEmpty(str(doc.format)) ?? PACK_TOML_FORMAT
  if (format !== PACK_TOML_FORMAT) {
    warnings.push(`pack.toml 的 pack-format 为 ${format}（期望 ${PACK_TOML_FORMAT}），已按当前版本解析。`)
  }

  const name = str(doc.name) ?? ''
  if (!name.trim()) warnings.push('pack.toml 缺少 name 字段，组装时使用项目名称。')
  const version = str(doc.version) ?? ''
  if (!version.trim()) warnings.push('pack.toml 缺少 version 字段，组装时使用清单骨架中的版本号。')
  const author = str(doc.author) ?? ''
  const description = str(doc.description) ?? ''

  const versions = isObj(doc.versions) ? doc.versions : {}
  if (!isObj(doc.versions)) warnings.push('pack.toml 缺少 [versions] 段，版本以项目设置为准。')
  const minecraft = nonEmpty(str(versions.minecraft))
  if (!minecraft) warnings.push('pack.toml 缺少 [versions].minecraft，版本以项目设置为准。')
  const { loader, loaderVersion } = readLoader(versions)
  if (!loader) warnings.push('pack.toml 缺少加载器版本键（如 fabric-loader），以项目设置为准。')

  return {
    ir: { format: PACK_TOML_FORMAT, name, author, version, description, minecraft, loader, loaderVersion },
    warnings
  }
}
