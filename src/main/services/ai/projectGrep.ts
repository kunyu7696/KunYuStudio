/**
 * project_grep：在「用户工程源码」内做有界正则检索（FC 只读工具后端）。
 *
 * kb_search 只覆盖随应用分发的 ai-reference 参考包；content_read 只读 .kunyu
 * 语义 JSON。当用户手改了 Java/Gradle、或 Agent 需要核对工程现状（已有注册名、
 * 包结构、mod id）时，用本工具扫描真实工程文件。
 *
 * 安全/资源约束：
 * - 递归跳过依赖与构建输出目录，默认仅白名单源码扩展名；
 * - 扫描文件数与命中数双上限，单行截断，防止巨型工程烧穿 token；
 * - 所有命中路径强制解析在项目根内，防 `..` 逃逸。
 */
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** 递归跳过的目录名（依赖、构建输出、运行目录、IDE、版本控制） */
export const GREP_SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'build',
  '.gradle',
  'run',
  '.kunyu',
  'out',
  'dist',
  '.idea',
  'bin'
])

/** 无 glob 过滤时允许检索的源码类扩展名（小写，含点） */
export const GREP_DEFAULT_EXTS: readonly string[] = [
  '.java',
  '.gradle',
  '.json',
  '.toml',
  '.mcfunction',
  '.properties',
  '.md',
  // 资源包/光影包领域后缀：语言文件、动画元数据、GLSL 着色器（否则 grep 不到这些 JSON 驱动资产）
  '.lang',
  '.mcmeta',
  '.vsh',
  '.fsh',
  '.glsl'
]

export const GREP_MAX_FILES = 2000
export const GREP_DEFAULT_MAX_RESULTS = 40
export const GREP_HARD_MAX_RESULTS = 100
const GREP_MAX_LINE_LEN = 300

/** 用户自定义排除文件（项目根，类似 .cursorignore；逐行规则，# 注释） */
export const KUNYU_IGNORE_FILENAME = '.kunyuignore'

export interface KunyuIgnore {
  /** 目录/路径段精确名（如 build、temp_dir） */
  plainNames: Set<string>
  /** 相对路径前缀（含 / 的规则，如 assets/sounds） */
  prefixes: string[]
  /** 文件名 glob（*.log、cache_*.json） */
  fileGlobs: RegExp[]
}

/** 解析 .kunyuignore；文件缺失返回空规则（零成本）。规则语义：
 *  - `dir`        → 路径任一段精确匹配（目录与文件均生效）
 *  - `dir/`       → 同上（尾斜杠仅为可读性）
 *  - `a/b`        → 相对路径前缀匹配（排除该子树）
 *  - `*.log`      → 文件名 glob（* 与 ?）
 */
export function parseKunyuIgnore(root: string): KunyuIgnore {
  const ig: KunyuIgnore = { plainNames: new Set(), prefixes: [], fileGlobs: [] }
  const file = join(root, KUNYU_IGNORE_FILENAME)
  if (!existsSync(file)) return ig
  let raw = ''
  try {
    raw = readFileSync(file, 'utf-8')
  } catch {
    return ig
  }
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim()
    if (!line || line.startsWith('#')) continue
    if (line.includes('*') || line.includes('?')) {
      try {
        ig.fileGlobs.push(globToRegExp(line))
      } catch {
        /* 非法 glob 忽略 */
      }
      continue
    }
    const name = line.replace(/\/+$/, '')
    if (name.includes('/')) ig.prefixes.push(name)
    else if (name) ig.plainNames.add(name)
  }
  return ig
}

/** 相对 POSIX 路径是否被用户规则排除（目录传其相对路径，文件传完整相对路径） */
export function isIgnoredByUser(ig: KunyuIgnore, relPosix: string): boolean {
  if (!relPosix) return false
  const segments = relPosix.split('/')
  for (const seg of segments) {
    if (ig.plainNames.has(seg)) return true
  }
  for (const prefix of ig.prefixes) {
    if (relPosix === prefix || relPosix.startsWith(`${prefix}/`)) return true
  }
  const base = segments[segments.length - 1]
  for (const re of ig.fileGlobs) {
    if (re.test(base)) return true
  }
  return false
}

export interface GrepHit {
  /** 相对项目根的 POSIX 风格路径 */
  file: string
  line: number
  /** 截断后的行文本（去首尾空白） */
  text: string
}

export interface ProjectGrepOptions {
  pattern: string
  /** 简单文件名通配（支持 * 与 ?），如 *.java；缺省用扩展名白名单 */
  glob?: string
  maxResults?: number
  ignoreCase?: boolean
}

export interface ProjectGrepResult {
  ok: boolean
  hits: GrepHit[]
  /** 因命中数达上限被截断 */
  truncated: boolean
  filesScanned: number
  error?: string
}

/** 简单 glob（仅 * 与 ?，按文件名匹配）转正则 */
export function globToRegExp(glob: string): RegExp {
  let re = ''
  for (const ch of glob) {
    if (ch === '*') re += '[^/\\\\]*'
    else if (ch === '?') re += '[^/\\\\]'
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

/** 文件名是否允许检索：显式 glob 优先；否则走扩展名白名单 */
function acceptFile(name: string, globRe: RegExp | null): boolean {
  if (globRe) return globRe.test(name)
  const lower = name.toLowerCase()
  return GREP_DEFAULT_EXTS.some((ext) => lower.endsWith(ext))
}

/**
 * 在项目根内执行检索。
 * @throws 不抛业务异常：正则非法/根不存在均以 ok:false 返回
 */
export function searchProjectCode(root: string, options: ProjectGrepOptions): ProjectGrepResult {
  const absRoot = resolve(root)
  if (!existsSync(absRoot) || !statSync(absRoot).isDirectory()) {
    return { ok: false, hits: [], truncated: false, filesScanned: 0, error: '项目根不存在或不是目录' }
  }
  const pattern = options.pattern ?? ''
  if (!pattern.trim()) {
    return { ok: false, hits: [], truncated: false, filesScanned: 0, error: 'pattern 不能为空' }
  }
  let matcher: RegExp
  try {
    matcher = new RegExp(pattern, options.ignoreCase ? 'i' : '')
  } catch (e) {
    return {
      ok: false,
      hits: [],
      truncated: false,
      filesScanned: 0,
      error: `正则表达式非法：${(e as Error).message}`
    }
  }
  const maxResults = Math.min(
    GREP_HARD_MAX_RESULTS,
    Math.max(1, Math.floor(options.maxResults ?? GREP_DEFAULT_MAX_RESULTS))
  )
  const globRe = options.glob ? globToRegExp(options.glob) : null
  const userIgnore = parseKunyuIgnore(absRoot)

  const hits: GrepHit[] = []
  let filesScanned = 0
  let truncated = false

  const walk = (dir: string): boolean => {
    let entries: Dirent<string>[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return true // 无权限/瞬态目录：跳过不中断
    }
    for (const entry of entries) {
      if (truncated) return false
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (GREP_SKIP_DIRS.has(entry.name)) continue
        if (isIgnoredByUser(userIgnore, toPosix(relative(absRoot, abs)))) continue
        if (!walk(abs)) return false
        continue
      }
      if (!entry.isFile() || !acceptFile(entry.name, globRe)) continue
      if (filesScanned >= GREP_MAX_FILES) return true
      filesScanned += 1
      // 根逃逸防护（符号链接等异常情况下仍限定在根内）
      const rel = relative(absRoot, abs)
      if (rel.startsWith('..')) continue
      if (isIgnoredByUser(userIgnore, toPosix(rel))) continue
      let content: string
      try {
        content = readFileSync(abs, 'utf-8')
      } catch {
        continue
      }
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]
        if (!matcher.test(raw)) continue
        const text = raw.trim()
        hits.push({
          file: toPosix(rel),
          line: i + 1,
          text: text.length > GREP_MAX_LINE_LEN ? `${text.slice(0, GREP_MAX_LINE_LEN)}…` : text
        })
        if (hits.length >= maxResults) {
          truncated = true
          return false
        }
      }
    }
    return true
  }

  walk(absRoot)
  return { ok: true, hits, truncated, filesScanned }
}
