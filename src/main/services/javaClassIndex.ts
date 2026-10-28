/**
 * Java 智能 import：项目源码类索引（主进程）。
 *
 * 渲染层发现「未解析的简单类型名」后，通过 IPC 批量请求全限定名候选。
 * 索引只覆盖用户工程源码（src/main/java、src/client/java），不解析依赖 jar；
 * Minecraft/Fabric 库类型由渲染层 AI 兜底处理。
 *
 * 性能：按项目根缓存 简单名 → 候选列表，签名为「relPath:mtimeMs」拼接，
 * 任一文件增删改后签名变化才重建；源码扫描同步但有文件数上限（典型模组工程 <500 文件）。
 */
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { GREP_SKIP_DIRS } from './ai/projectGrep'
import type {
  JavaClassCandidate,
  JavaResolvedSymbol
} from '../../shared/types/java'

/** 参与索引的源码根（相对项目根，POSIX） */
const JAVA_SOURCE_ROOTS = ['src/main/java', 'src/client/java']
/** 与 projectGrep 一致的文件数上限，防止巨型工程卡顿 */
const JAVA_MAX_FILES = 2000

const PACKAGE_RE = /^\s*package\s+([A-Za-z_][\w.]*)\s*;/m
const TYPE_DECL_RE =
  /\b(?:public\s+|private\s+|protected\s+)?(?:final\s+|abstract\s+|sealed\s+|static\s+)*(?:class|interface|enum|record|@interface)\s+([A-Za-z_]\w*)/g

interface CachedIndex {
  /** 签名：所有 java 文件 relPath:mtimeMs 排序拼接 */
  sig: string
  /** 简单类名 → 候选（按 fqcn 去重） */
  index: Map<string, JavaClassCandidate[]>
}

const cache = new Map<string, CachedIndex>()

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

/** 从源码文本提取 package 与全部顶层类型声明（正则法，容忍部分语法噪声） */
export function parseJavaTypes(
  source: string
): { packageName: string; types: string[] } {
  const pkgMatch = source.match(PACKAGE_RE)
  const packageName = pkgMatch ? pkgMatch[1] : ''
  const types: string[] = []
  let m: RegExpExecArray | null
  TYPE_DECL_RE.lastIndex = 0
  while ((m = TYPE_DECL_RE.exec(source)) !== null) {
    types.push(m[1])
  }
  return { packageName, types }
}

interface WalkFile {
  rel: string
  mtimeMs: number
}

/** 递归收集源码根下的 .java 文件（跳依赖/构建/IDE 目录，根逃逸防护） */
function collectJavaFiles(root: string, sourceRoot: string): WalkFile[] {
  const base = resolve(root, sourceRoot)
  if (!existsSync(base) || !statSync(base).isDirectory()) return []
  const out: WalkFile[] = []

  const walk = (dir: string): void => {
    if (out.length >= JAVA_MAX_FILES) return
    let entries: Dirent<string>[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= JAVA_MAX_FILES) return
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (GREP_SKIP_DIRS.has(entry.name)) continue
        walk(abs)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.java')) continue
      const rel = relative(root, abs)
      if (rel.startsWith('..')) continue
      let mtimeMs = 0
      try {
        mtimeMs = statSync(abs).mtimeMs
      } catch {
        continue
      }
      out.push({ rel: toPosix(rel), mtimeMs })
    }
  }

  walk(base)
  return out
}

function buildIndex(root: string): CachedIndex {
  const files: WalkFile[] = []
  for (const sourceRoot of JAVA_SOURCE_ROOTS) {
    files.push(...collectJavaFiles(root, sourceRoot))
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))

  const sig = files.map((f) => `${f.rel}:${Math.round(f.mtimeMs)}`).join('|')
  const cached = cache.get(root)
  if (cached && cached.sig === sig) return cached

  const index = new Map<string, JavaClassCandidate[]>()
  for (const f of files) {
    let source: string
    try {
      source = readFileSync(resolve(root, f.rel.split('/').join(sep)), 'utf-8')
    } catch {
      continue
    }
    const { packageName, types } = parseJavaTypes(source)
    for (const simple of types) {
      const fqcn = packageName ? `${packageName}.${simple}` : simple
      const list = index.get(simple)
      if (!list) {
        index.set(simple, [{ fqcn, relPath: f.rel }])
      } else if (!list.some((c) => c.fqcn === fqcn)) {
        list.push({ fqcn, relPath: f.rel })
      }
    }
  }
  for (const list of index.values()) {
    list.sort((a, b) => (a.fqcn < b.fqcn ? -1 : a.fqcn > b.fqcn ? 1 : 0))
  }

  const next: CachedIndex = { sig, index }
  cache.set(root, next)
  return next
}

/** 测试专用：清空索引缓存 */
export function clearJavaClassIndex(root?: string): void {
  if (root) cache.delete(root)
  else cache.clear()
}

/**
 * 批量解析简单类型名。
 * @param root 项目根绝对路径
 * @param currentFilePackage 当前编辑文件的 package（无包声明传 ''）
 * @param symbols 待解析简单名（调用方负责去重与排除）
 */
export function resolveJavaSymbols(
  root: string,
  currentFilePackage: string,
  symbols: readonly string[]
): Record<string, JavaResolvedSymbol> {
  const absRoot = resolve(root)
  const { index } = buildIndex(absRoot)
  const result: Record<string, JavaResolvedSymbol> = {}
  for (const name of symbols) {
    const candidates = (index.get(name) ?? []).map((c) => ({ ...c }))
    const samePackage = candidates.some(
      (c) => c.fqcn === (currentFilePackage ? `${currentFilePackage}.${name}` : name)
    )
    result[name] = { samePackage, candidates }
  }
  return result
}
