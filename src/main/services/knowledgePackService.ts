/**
 * 知识库语料包：版本指纹与过期检测（P0，纯本地，零网络）。
 *
 * 语料（resources/knowledge/<corpus>/*.md）随包分发，发布前人工更新。为让「语料是否
 * 与登记版本一致、是否久未更新」可被用户与 CI 看见，这里用 manifest.json 记录每个文件
 * 的 sha256、汇总指纹与生成日期；运行时扫描磁盘并与之比对。
 *
 * 状态语义：
 *   ok              指纹一致且未超过保鲜阈值
 *   drifted         有新增/缺失/内容改动（与登记版本不符）
 *   missing-manifest 从未登记过指纹（旧包或开发态手工增删）
 *   outdated        指纹一致，但登记日期距今超过 KNOWLEDGE_STALE_DAYS
 *   empty           磁盘上没有任何语料
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  KnowledgeFileEntry,
  KnowledgePackState,
  KnowledgePackStatus
} from '../../shared/types/ai'
import { defaultKnowledgeRoot } from './knowledgeSearch'

/** 语料保鲜阈值：超过即提示「可能过期」 */
export const KNOWLEDGE_STALE_DAYS = 180

/** 受管的语料库目录（flat 结构，与 knowledgeSearch 的读取方式一致） */
export const KNOWLEDGE_CORPORA = ['fabric', 'mcwiki', 'kubejs'] as const

export interface KnowledgePackManifest {
  schemaVersion: number
  /** 语料包版本号（发布方维护） */
  corpusVersion: string
  /** 登记日期 YYYY-MM-DD */
  generatedAt: string
  files: KnowledgeFileEntry[]
  /** 全部文件按 path 排序后 path:sha256 的 sha256 */
  fingerprint: string
}

export type { KnowledgePackState, KnowledgePackStatus }

export interface LocalPackScan {
  files: KnowledgeFileEntry[]
  fingerprint: string
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 稳定指纹：按 path 排序后拼接 path:sha256，避免依赖文件系统枚举顺序 */
export function computeFingerprint(entries: Array<Pick<KnowledgeFileEntry, 'path' | 'sha256'>>): string {
  const lines = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((e) => `${e.path}:${e.sha256}`)
  return sha256(lines.join('\n'))
}

/** 扫描语料目录，返回每个文件的哈希与整体指纹 */
export function scanLocalPack(root: string = defaultKnowledgeRoot()): LocalPackScan {
  const files: KnowledgeFileEntry[] = []
  for (const corpus of KNOWLEDGE_CORPORA) {
    const dir = join(root, corpus)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.md')) continue
      const abs = join(dir, name)
      const buf = readFileSync(abs)
      // 归一化换行（CRLF→LF）后再哈希，保证 Windows 开发机与 Linux CI 指纹一致
      const normalized = buf.toString('utf8').replace(/\r\n/g, '\n')
      files.push({ path: `${corpus}/${name}`, sha256: sha256(normalized), bytes: buf.length })
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { files, fingerprint: computeFingerprint(files) }
}

/** 读取登记清单；不存在或结构非法返回 null（不抛错） */
export function readPackManifest(root: string = defaultKnowledgeRoot()): KnowledgePackManifest | null {
  const path = join(root, 'manifest.json')
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Partial<KnowledgePackManifest>
    if (raw.schemaVersion !== 1) return null
    if (typeof raw.corpusVersion !== 'string' || typeof raw.generatedAt !== 'string') return null
    if (!Array.isArray(raw.files) || typeof raw.fingerprint !== 'string') return null
    const files: KnowledgeFileEntry[] = []
    for (const f of raw.files) {
      if (!f || typeof f.path !== 'string' || typeof f.sha256 !== 'string') return null
      files.push({ path: f.path, sha256: f.sha256, bytes: typeof f.bytes === 'number' ? f.bytes : 0 })
    }
    return {
      schemaVersion: 1,
      corpusVersion: raw.corpusVersion,
      generatedAt: raw.generatedAt,
      files,
      fingerprint: raw.fingerprint
    }
  } catch {
    return null
  }
}

function ageInDays(generatedAt: string, now: number): number | null {
  const t = Date.parse(`${generatedAt}T00:00:00Z`)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

/**
 * 按当前磁盘内容生成并写入清单。
 * 写入失败（如安装目录只读、asar 内不可写）返回 false，调用方据此保留原状态。
 */
export function writePackManifest(
  root: string,
  scan: LocalPackScan,
  now: number = Date.now()
): boolean {
  const generatedAt = new Date(now).toISOString().slice(0, 10)
  const manifest: KnowledgePackManifest = {
    schemaVersion: 1,
    corpusVersion: generatedAt.replace(/-/g, '.'),
    generatedAt,
    files: scan.files,
    fingerprint: scan.fingerprint
  }
  try {
    writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
    return true
  } catch {
    return false
  }
}

/**
 * 自动重写清单后的一致性结果：重新读清单，保证返回的版本/指纹与落盘内容一致。
 */
function autoRefreshedStatus(
  root: string,
  now: number,
  fileCount: number
): KnowledgePackStatus {
  const manifest = readPackManifest(root)
  return {
    state: 'ok',
    corpusVersion: manifest?.corpusVersion ?? null,
    generatedAt: manifest?.generatedAt ?? null,
    ageDays: manifest ? ageInDays(manifest.generatedAt, now) : null,
    fileCount,
    fingerprint: manifest?.fingerprint ?? '',
    missingFiles: [],
    extraFiles: [],
    changedFiles: [],
    autoRefreshed: true,
    message: `语料有变动，已自动更新版本指纹（${fileCount} 个文件，版本 ${manifest?.corpusVersion ?? '未知'}）`
  }
}

/**
 * 计算语料状态：磁盘扫描结果与登记清单比对。
 *
 * autoRefresh=true 时，若发现「未登记」或「与登记版本不一致」，会按磁盘当前内容
 * 自动重写清单（语料指纹自动更新），随后按新清单返回 ok。用于开发态改语料后
 * 免手工跑脚本；打包环境资源目录只读时写入失败，仍如实返回 drifted。
 */
export function getKnowledgePackStatus(
  root: string = defaultKnowledgeRoot(),
  now: number = Date.now(),
  opts: { autoRefresh?: boolean } = {}
): KnowledgePackStatus {
  const local = scanLocalPack(root)
  const manifest = readPackManifest(root)
  const base = {
    corpusVersion: manifest?.corpusVersion ?? null,
    generatedAt: manifest?.generatedAt ?? null,
    ageDays: manifest ? ageInDays(manifest.generatedAt, now) : null,
    fileCount: local.files.length,
    fingerprint: local.fingerprint
  }

  if (local.files.length === 0) {
    return {
      ...base,
      state: 'empty',
      missingFiles: [],
      extraFiles: [],
      changedFiles: [],
      message: '未找到任何语料文件，kb_search 将不可用'
    }
  }

  if (!manifest) {
    if (opts.autoRefresh && writePackManifest(root, local, now)) {
      return autoRefreshedStatus(root, now, local.files.length)
    }
    return {
      ...base,
      state: 'missing-manifest',
      missingFiles: [],
      extraFiles: local.files.map((f) => f.path),
      changedFiles: [],
      message: '语料未登记版本指纹，无法判断是否与发布版本一致'
    }
  }

  const disk = new Map(local.files.map((f) => [f.path, f.sha256]))
  const reg = new Map(manifest.files.map((f) => [f.path, f.sha256]))
  const missingFiles = [...reg.keys()].filter((p) => !disk.has(p)).sort()
  const extraFiles = [...disk.keys()].filter((p) => !reg.has(p)).sort()
  const changedFiles = [...reg.keys()]
    .filter((p) => disk.has(p) && disk.get(p) !== reg.get(p))
    .sort()

  if (missingFiles.length || extraFiles.length || changedFiles.length) {
    if (opts.autoRefresh && writePackManifest(root, local, now)) {
      return autoRefreshedStatus(root, now, local.files.length)
    }
    const parts = [
      changedFiles.length ? `改动 ${changedFiles.length}` : '',
      extraFiles.length ? `新增 ${extraFiles.length}` : '',
      missingFiles.length ? `缺失 ${missingFiles.length}` : ''
    ].filter(Boolean)
    return {
      ...base,
      state: 'drifted',
      missingFiles,
      extraFiles,
      changedFiles,
      message: `语料与登记版本不一致（${parts.join(' / ')}），指纹已变化`
    }
  }

  const ageDays = base.ageDays
  if (ageDays !== null && ageDays > KNOWLEDGE_STALE_DAYS) {
    return {
      ...base,
      state: 'outdated',
      missingFiles: [],
      extraFiles: [],
      changedFiles: [],
      message: `语料指纹一致，但已 ${ageDays} 天未更新，内容可能过期`
    }
  }

  return {
    ...base,
    state: 'ok',
    missingFiles: [],
    extraFiles: [],
    changedFiles: [],
    message: `语料一致：${local.files.length} 个文件，版本 ${manifest.corpusVersion}`
  }
}
