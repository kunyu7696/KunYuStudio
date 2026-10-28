/**
 * pack.toml / index.toml 读写（IO 层）。
 * pack.toml：项目创建时生成、用户/Agent 可手编；组装时仅在缺失时自愈，绝不回写
 * （smol-toml 重序列化会丢失用户注释）。
 * index.toml：组装时自动重生成的文件清单快照，头部注明勿手编。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'smol-toml'
import {
  INDEX_HASH_FORMAT,
  PACK_TOML_FORMAT,
  normalizePackTomlDoc,
  packTomlLoaderKey,
  type IndexTomlFile,
  type PackTomlIr
} from '../../../shared/types/packToml'
import type { ModpackMeta } from './modpackAssembler'

const PACK_TOML_NAME = 'pack.toml'
const INDEX_TOML_NAME = 'index.toml'

/** pack.toml 组装产物描述字段（IR 权威，导出时覆写清单骨架） */
export interface PackTomlExtras {
  author?: string
  version?: string
  description?: string
}

/** 生成 pack.toml 文本（纯函数，键结构对齐 packwiz 官方）。loaderVersion 为 null 时省略加载器键 */
export function buildPackToml(meta: ModpackMeta, extra?: PackTomlExtras): string {
  const versions: Record<string, string> = { minecraft: meta.mcVersion }
  if (meta.loaderVersion) versions[packTomlLoaderKey(meta.loader)] = meta.loaderVersion
  const doc = {
    name: meta.name,
    author: extra?.author ?? '',
    version: extra?.version ?? '1.0.0',
    index: 'index.toml',
    'pack-format': PACK_TOML_FORMAT,
    description: extra?.description ?? '',
    versions
  }
  return stringify(doc)
}

export interface ParsePackResult {
  ok: boolean
  ir: PackTomlIr | null
  /** 坏 TOML 时的中文报错（含 smol-toml 原始行号信息） */
  error?: string
  /** 规范化告警（字段缺失补默认值等） */
  warnings: string[]
}

/** 解析 pack.toml 文本为 IR；坏 TOML 返回 ok=false，由组装层决定 fail-fast */
export function parsePackToml(text: string): ParsePackResult {
  let raw: unknown
  try {
    raw = parse(text)
  } catch (err) {
    return { ok: false, ir: null, error: `pack.toml 解析失败：${(err as Error).message}`, warnings: [] }
  }
  const { ir, warnings } = normalizePackTomlDoc(raw)
  return { ok: true, ir, warnings }
}

export interface EnsurePackResult extends ParsePackResult {
  /** 本次是否自愈生成了 pack.toml（存量项目首次组装时为 true） */
  created: boolean
}

/** 读项目根 pack.toml；缺失时按项目元数据自愈生成（存量项目无需迁移脚本） */
export function ensurePackToml(projectRoot: string, meta: ModpackMeta): EnsurePackResult {
  const abs = join(projectRoot, PACK_TOML_NAME)
  if (existsSync(abs)) {
    return { ...parsePackToml(readFileSync(abs, 'utf-8')), created: false }
  }
  const doc = {
    name: meta.name,
    author: '',
    version: '1.0.0',
    index: 'index.toml',
    'pack-format': PACK_TOML_FORMAT,
    description: '',
    versions: buildVersions(meta)
  }
  writeFileSync(abs, stringify(doc), 'utf-8')
  const { ir, warnings } = normalizePackTomlDoc(doc)
  return { ok: true, ir, warnings, created: true }
}

/** 只读读取 pack.toml（干跑预览用，不写盘） */
export function readPackToml(projectRoot: string): ParsePackResult & { exists: boolean } {
  const abs = join(projectRoot, PACK_TOML_NAME)
  if (!existsSync(abs)) {
    return { ok: true, ir: null, warnings: [], exists: false }
  }
  return { ...parsePackToml(readFileSync(abs, 'utf-8')), exists: true }
}

function buildVersions(meta: ModpackMeta): Record<string, string> {
  const versions: Record<string, string> = { minecraft: meta.mcVersion }
  if (meta.loaderVersion) versions[packTomlLoaderKey(meta.loader)] = meta.loaderVersion
  return versions
}

/** 版本字段比对告警：DB 项目元数据权威，pack.toml 不一致时提醒以项目设置为准 */
export function packTomlVersionWarnings(ir: PackTomlIr | null, meta: ModpackMeta): string[] {
  if (!ir) return []
  const out: string[] = []
  if (ir.minecraft && ir.minecraft !== meta.mcVersion) {
    out.push(
      `pack.toml 的 minecraft 版本（${ir.minecraft}）与项目设置（${meta.mcVersion}）不一致，以项目设置为准。`
    )
  }
  const key = packTomlLoaderKey(meta.loader)
  if (ir.loader && ir.loader !== meta.loader) {
    out.push(`pack.toml 的加载器（${ir.loader}）与项目设置（${meta.loader}）不一致，以项目设置为准。`)
  } else if (ir.loaderVersion && ir.loaderVersion !== meta.loaderVersion) {
    out.push(`pack.toml 的 ${key} 版本（${ir.loaderVersion}）与项目设置（${meta.loaderVersion ?? '未登记'}）不一致，以项目设置为准。`)
  }
  return out
}

/** 文件 sha256（读不到返回 null，由调用方降级告警） */
export function sha256File(absPath: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(absPath)).digest('hex')
  } catch {
    return null
  }
}

/** 生成 index.toml 文本（纯函数）。键名贴 packwiz：hash-format / [[files]] / version-id */
export function buildIndexToml(files: IndexTomlFile[]): string {
  const doc = {
    'hash-format': INDEX_HASH_FORMAT,
    files: files.map((f) => ({
      file: f.file,
      hash: f.hash,
      size: f.size,
      ...(f.platform ? { platform: f.platform } : {}),
      ...(f.slug ? { slug: f.slug } : {}),
      ...(f.versionId ? { 'version-id': f.versionId } : {}),
      ...(f.pack ? { pack: f.pack } : {})
    }))
  }
  return '# 由坤舆在组装时自动生成（文件清单快照），请勿手工编辑。\n' + stringify(doc)
}

/** 组装成功后把文件清单快照落到项目根 index.toml */
export function writeIndexSnapshot(projectRoot: string, files: IndexTomlFile[]): string {
  const abs = join(projectRoot, INDEX_TOML_NAME)
  writeFileSync(abs, buildIndexToml(files), 'utf-8')
  return abs
}
