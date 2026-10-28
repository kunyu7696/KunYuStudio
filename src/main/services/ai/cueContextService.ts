/**
 * 仓库级上下文检索服务——为 CUE 补全注入项目代码/知识库/模板参考。
 *
 * 三源并行检索（各源独立 try/catch，任何一源失败不阻塞其他源）：
 * 1. project_grep：同项目代码命中（当前文件排除）
 * 2. kb_search：本地知识库 RAG（仅已就绪时，绝不触发懒加载）
 * 3. template_search：参考包模板（仅 java 且 query 命中内容类型词时）
 *
 * 预算拼装 ≤ maxChars，每块带来源头注释，尾部按行截断。
 * 缓存：key = root + language + tokens 归一化，value 带 mtime 签名，TTL 60s LRU。
 */
import { createHash } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { GREP_SKIP_DIRS } from './projectGrep'
import { searchProjectCode } from './projectGrep'
import { getKbRag, isKbRagReady } from './kbRagSingleton'
import { getReferenceService } from './referencePackageService'
import { createContextBuilder, detectContentTypes } from './contextBuilder'
import { openProject } from '../projectService'

// ── 常量 ─────────────────────────────────────────────────────────────────────

const MAX_GREP_RESULTS = 8
const MAX_KB_RESULTS = 3
const TEMPLATE_MAX_CHARS = 1200
const CACHE_TTL_MS = 60_000
const CACHE_MAX_ENTRIES = 32
/** 单行截断长度（grep 命中行） */
const LINE_MAX_LEN = 200

// ── 类型 ─────────────────────────────────────────────────────────────────────

export interface CueContextSource {
  kind: 'grep' | 'kb' | 'template'
  ref: string
}

export interface CueContextResult {
  text: string
  sources: CueContextSource[]
}

// ── mtime 签名缓存 ──────────────────────────────────────────────────────────

interface CacheEntry {
  sig: string
  text: string
  sources: CueContextSource[]
  at: number
}

const cache = new Map<string, CacheEntry>()

/** 计算项目根下 .java/.json 文件的 mtime 拼接哈希 */
function computeMtimeSignature(root: string): string {
  const parts: string[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const abs = join(dir, e.name)
      if (e.isDirectory()) {
        if (GREP_SKIP_DIRS.has(e.name)) continue
        walk(abs)
        continue
      }
      if (!e.isFile()) continue
      if (!e.name.endsWith('.java') && !e.name.endsWith('.json')) continue
      try {
        const st = statSync(abs)
        parts.push(`${relative(root, abs).split(sep).join('/')}:${st.mtimeMs}`)
      } catch {
        // 忽略
      }
    }
  }
  walk(root)
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}

function makeCacheKey(root: string, language: string, query: string): string {
  const tokens = query
    .split(/[\s|]+/)
    .filter(Boolean)
    .sort()
    .join('|')
  return `${root}::${language}::${tokens}`
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

export async function collectCueContext(input: {
  projectId: string
  relPath: string
  language: string
  query: string
  maxChars: number
  sources: { grep: boolean; kb: boolean; templates: boolean }
}): Promise<CueContextResult> {
  const empty: CueContextResult = { text: '', sources: [] }

  // 解析项目（openProject 是同步函数）
  const project = openProject(input.projectId)
  if (!project?.path) return empty
  const root = project.path

  // 检查缓存
  const cacheKey = makeCacheKey(root, input.language, input.query)
  const sig = computeMtimeSignature(root)
  const cached = cache.get(cacheKey)
  if (cached && cached.sig === sig && Date.now() - cached.at < CACHE_TTL_MS) {
    return { text: cached.text, sources: cached.sources }
  }

  // 三源并行
  const results = await Promise.allSettled([
    input.sources.grep
      ? grepSource(root, input.query, input.relPath, input.language)
      : Promise.resolve({ text: '', sources: [] as CueContextSource[] }),
    input.sources.kb
      ? kbSource(input.query)
      : Promise.resolve({ text: '', sources: [] as CueContextSource[] }),
    input.sources.templates && input.language === 'java'
      ? templateSource(input.query, project)
      : Promise.resolve({ text: '', sources: [] as CueContextSource[] })
  ])

  // 拼装：grep > kb > template
  const blocks: Array<{ text: string; sources: CueContextSource[] }> = []
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.text) blocks.push(r.value)
  }

  let text = ''
  const allSources: CueContextSource[] = []
  for (const block of blocks) {
    const blockWithHeader = block.sources
      .map((s) => `// [${s.kind}] ${s.ref}`)
      .join('\n')
    const full = blockWithHeader + '\n' + block.text
    if (text.length + full.length > input.maxChars) {
      // 尾部按行截断
      const remaining = input.maxChars - text.length
      if (remaining > 100) {
        const lines = full.split('\n')
        let cut = ''
        for (const line of lines) {
          if (cut.length + line.length + 1 > remaining) break
          cut += line + '\n'
        }
        text += cut
      }
      break
    }
    text += full + '\n\n'
    allSources.push(...block.sources)
  }

  const trimmed = text.trim()
  const result: CueContextResult = { text: trimmed, sources: allSources }

  // 写缓存（LRU：超出容量时删最旧）
  if (cache.size >= CACHE_MAX_ENTRIES) {
    let oldestKey = ''
    let oldestAt = Infinity
    for (const [k, v] of cache) {
      if (v.at < oldestAt) {
        oldestAt = v.at
        oldestKey = k
      }
    }
    if (oldestKey) cache.delete(oldestKey)
  }
  cache.set(cacheKey, { sig, text: trimmed, sources: allSources, at: Date.now() })

  return result
}

// ── 三源实现 ─────────────────────────────────────────────────────────────────

/** 源 1：项目代码 grep */
async function grepSource(
  root: string,
  query: string,
  relPath: string,
  language: string
): Promise<{ text: string; sources: CueContextSource[] }> {
  const tokens = extractTokens(query)
  if (tokens.length === 0) return { text: '', sources: [] }

  const pattern = tokens.map(escapeRe).join('|')
  const glob = language === 'java' ? '*.java' : language === 'json' ? '*.json' : undefined
  const result = searchProjectCode(root, {
    pattern,
    glob,
    maxResults: MAX_GREP_RESULTS,
    ignoreCase: false
  })
  if (!result.ok || result.hits.length === 0) return { text: '', sources: [] }

  // 排除当前文件自身
  const hits = result.hits.filter((h) => h.file !== relPath)
  if (hits.length === 0) return { text: '', sources: [] }

  const lines: string[] = []
  const sources: CueContextSource[] = []
  for (const h of hits) {
    const truncated = h.text.length > LINE_MAX_LEN ? h.text.slice(0, LINE_MAX_LEN) + '…' : h.text
    lines.push(`${h.file}:${h.line}:${truncated}`)
    sources.push({ kind: 'grep', ref: `${h.file}:${h.line}` })
  }
  return { text: lines.join('\n'), sources }
}

/** 源 2：本地知识库 RAG（仅已就绪时，绝不触发懒加载） */
async function kbSource(
  query: string
): Promise<{ text: string; sources: CueContextSource[] }> {
  // isReady 门控：未就绪直接跳过（绝不触发 getKbRag 懒加载）
  if (!isKbRagReady()) return { text: '', sources: [] }
  const kb = await getKbRag()
  if (!kb) return { text: '', sources: [] }

  const { hits } = await kb.search(query, MAX_KB_RESULTS)
  if (hits.length === 0) return { text: '', sources: [] }

  const lines: string[] = []
  const sources: CueContextSource[] = []
  for (const h of hits) {
    const text = h.chunk.text
    const truncated = text.length > 300 ? text.slice(0, 300) + '…' : text
    lines.push(truncated)
    sources.push({ kind: 'kb', ref: h.chunk.relPath || `kb#${h.chunk.index}` })
  }
  return { text: lines.join('\n\n'), sources }
}

/** 源 3：参考包模板（仅 java 且 query 命中内容类型词时） */
async function templateSource(
  query: string,
  project: { loader: string | null; mcVersion: string }
): Promise<{ text: string; sources: CueContextSource[] }> {
  if (!project.loader || !project.mcVersion) return { text: '', sources: [] }
  const types = detectContentTypes(query)
  if (types.length === 0) return { text: '', sources: [] }

  const refService = getReferenceService()
  if (!refService.isLoaded()) return { text: '', sources: [] }

  const cb = createContextBuilder(refService)
  const templates = cb.getTemplateContents(
    project.loader as never,
    project.mcVersion,
    types,
    query
  )
  if (templates.length === 0) return { text: '', sources: [] }

  const top = templates[0]
  const truncated =
    top.content.length > TEMPLATE_MAX_CHARS
      ? top.content.slice(0, TEMPLATE_MAX_CHARS) + '\n// …'
      : top.content
  return {
    text: truncated,
    sources: [{ kind: 'template', ref: `${top.type}/${top.file}` }]
  }
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

/** 从原始 query 行提取编程标识符（驼峰拆分后取稀罕度前 2） */
function extractTokens(query: string): string[] {
  const rawTokens = query.match(/[A-Za-z_$][\w$]{2,}/g) ?? []
  const stopwords = new Set([
    'class', 'return', 'public', 'private', 'protected', 'static', 'final',
    'abstract', 'void', 'int', 'long', 'float', 'double', 'boolean', 'char',
    'byte', 'short', 'new', 'this', 'super', 'if', 'else', 'for', 'while',
    'do', 'switch', 'case', 'default', 'break', 'continue', 'try', 'catch',
    'finally', 'throw', 'throws', 'import', 'package', 'extends', 'implements',
    'interface', 'enum', 'record', 'var', 'null', 'true', 'false', 'String',
    'get', 'set', 'is', 'has', 'can', 'the', 'and', 'or', 'not', 'but'
  ])
  const filtered = rawTokens.filter((t) => !stopwords.has(t))
  // 驼峰拆分：取原始 token 中最长的两个（稀罕度代理）
  const byLength = [...filtered].sort((a, b) => b.length - a.length)
  return byLength.slice(0, 2)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
