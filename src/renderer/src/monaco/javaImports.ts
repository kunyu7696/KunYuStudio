/**
 * M4 Java 智能 import —— 渲染层纯函数（无 Monaco 依赖，便于 node 单测）。
 *
 * 三件事：
 * 1. stripJavaCommentsAndStrings：注释/字符串/字符/文本块内容替换为空白，保留行列偏移；
 * 2. collectUnresolvedTypeNames：从干净源码中收集「疑似缺少 import」的大写标识符首次出现位置；
 * 3. buildImportEdit：计算 import 语句的字典序插入位置（Monaco 单点 edit 数据）。
 *
 * 排除策略（五重 + 同包判定在主进程索引侧）：
 * java.lang 白名单 / 本文件声明的类型 / 显式 import / 通配 import（诊断阶段按 FQCN 前缀过滤）/
 * 单字母泛型参数 / 全大写常量；被限定名（foo.Bar）的后缀不作为未解析名。
 */

/** java.lang 常用类型（无需 import）；按需扩充 */
export const JAVA_LANG_TYPES: ReadonlySet<string> = new Set([
  'Object',
  'String',
  'StringBuffer',
  'StringBuilder',
  'CharSequence',
  'Character',
  'Byte',
  'Short',
  'Integer',
  'Long',
  'Float',
  'Double',
  'Boolean',
  'Number',
  'Void',
  'Math',
  'System',
  'Class',
  'ClassLoader',
  'Package',
  'Enum',
  'Record',
  'Runnable',
  'Thread',
  'Process',
  'ProcessBuilder',
  'Throwable',
  'Exception',
  'RuntimeException',
  'IllegalArgumentException',
  'IllegalStateException',
  'UnsupportedOperationException',
  'NullPointerException',
  'IndexOutOfBoundsException',
  'ArrayIndexOutOfBoundsException',
  'StringIndexOutOfBoundsException',
  'NumberFormatException',
  'ArithmeticException',
  'ClassCastException',
  'ClassNotFoundException',
  'NoSuchFieldException',
  'NoSuchMethodException',
  'InterruptedException',
  'ReflectiveOperationException',
  'SecurityException',
  'ArrayStoreException',
  'NegativeArraySizeException',
  'CloneNotSupportedException',
  'StackTraceElement',
  'Iterable',
  'Comparable',
  'Appendable',
  'AutoCloseable',
  'Cloneable',
  'Readable',
  'Override',
  'Deprecated',
  'SuppressWarnings',
  'FunctionalInterface',
  'SafeVarargs'
])

type StripState = 'code' | 'line' | 'block' | 'string' | 'char' | 'textblock'

/**
 * 将注释与字符串字面量内容替换为空白（保留换行/制表符与原始长度），
 * 输出与输入严格等长且行列对齐，可直接在原坐标上跑标识符正则。
 */
export function stripJavaCommentsAndStrings(source: string): string {
  let out = ''
  let i = 0
  const n = source.length
  let state: StripState = 'code'

  const blankOf = (ch: string): string => (ch === '\n' ? '\n' : ch === '\t' ? '\t' : ' ')

  while (i < n) {
    const c = source[i]
    const next = source[i + 1]

    if (state === 'code') {
      if (c === '/' && next === '/') {
        state = 'line'
        out += '  '
        i += 2
        continue
      }
      if (c === '/' && next === '*') {
        state = 'block'
        out += '  '
        i += 2
        continue
      }
      if (c === '"' && next === '"' && source[i + 2] === '"') {
        state = 'textblock'
        out += '   '
        i += 3
        continue
      }
      if (c === '"') {
        state = 'string'
        out += ' '
        i += 1
        continue
      }
      if (c === "'") {
        state = 'char'
        out += ' '
        i += 1
        continue
      }
      out += c
      i += 1
      continue
    }

    if (state === 'line') {
      if (c === '\n') {
        state = 'code'
        out += c
      } else {
        out += ' '
      }
      i += 1
      continue
    }

    if (state === 'block') {
      if (c === '*' && next === '/') {
        state = 'code'
        out += '  '
        i += 2
        continue
      }
      out += blankOf(c)
      i += 1
      continue
    }

    if (state === 'string' || state === 'char') {
      const quote = state === 'string' ? '"' : "'"
      if (c === '\\') {
        // 转义对：反斜杠 + 下一字符都抹掉（换行仍保留以维持行号）
        out += ' '
        if (i + 1 < n) {
          out += blankOf(source[i + 1])
          i += 2
        } else {
          i += 1
        }
        continue
      }
      if (c === quote) {
        state = 'code'
        out += ' '
        i += 1
        continue
      }
      out += blankOf(c)
      i += 1
      continue
    }

    // textblock
    if (c === '"' && next === '"' && source[i + 2] === '"') {
      state = 'code'
      out += '   '
      i += 3
      continue
    }
    out += blankOf(c)
    i += 1
  }

  return out
}

const PACKAGE_RE = /^[ \t]*package[ \t]+([A-Za-z_][\w.]*)\s*;/m
const IMPORT_LINE_RE = /^[ \t]*import[ \t]+(static[ \t]+)?([\w.]+(?:\.\*)?|\*)[ \t]*;/
const TYPE_DECL_RE =
  /\b(?:public\s+|private\s+|protected\s+)?(?:final\s+|abstract\s+|sealed\s+|static\s+)*(?:class|interface|enum|record|@interface)\s+([A-Za-z_]\w*)/g
/** 大写开头标识符；负向后顾排除限定名后缀（.Bar）与标识符中段 */
const TYPE_USAGE_RE = /(?<![\w.])([A-Z][A-Za-z0-9_]*)/g
const ALL_CAPS_RE = /^[A-Z0-9_]+$/

export interface UnresolvedTypeName {
  name: string
  /** Monaco 风格 1 起始行号 */
  lineNumber: number
  /** 1 起始列 */
  column: number
}

export interface CollectImportsInfo {
  packageName: string
  /** 显式 import 的简单名集合（含 static import 的成员名） */
  importedSimpleNames: ReadonlySet<string>
  /** 非静态通配 import 的包前缀（带尾点，如 'java.util.'）；用于按 FQCN 过滤候选 */
  wildcardPackages: string[]
  /** 疑似缺失 import 的类型名（按首次出现去重） */
  unresolved: UnresolvedTypeName[]
}

/**
 * 从（建议已 strip 的）Java 源码中收集未解析类型名。
 * 直接传原始源码也可：字符串/注释里的大写词可能造成误报，建议先 strip。
 */
export function collectUnresolvedTypeNames(cleanSource: string): CollectImportsInfo {
  const pkgMatch = cleanSource.match(PACKAGE_RE)
  const packageName = pkgMatch ? pkgMatch[1] : ''

  const importedSimpleNames = new Set<string>()
  const wildcardPackages: string[] = []
  const declaredNames = new Set<string>()

  for (const rawLine of cleanSource.split(/\r?\n/)) {
    const m = rawLine.match(IMPORT_LINE_RE)
    if (!m) continue
    const isStatic = Boolean(m[1])
    const fqPart = m[2]
    if (fqPart.endsWith('.*')) {
      // 静态通配导入的是成员而非类型，无法据此排除类型名
      if (!isStatic) wildcardPackages.push(fqPart.slice(0, -1)) // 'pkg.*' → 'pkg.'
      continue
    }
    const lastDot = fqPart.lastIndexOf('.')
    importedSimpleNames.add(lastDot >= 0 ? fqPart.slice(lastDot + 1) : fqPart)
  }

  let dm: RegExpExecArray | null
  TYPE_DECL_RE.lastIndex = 0
  while ((dm = TYPE_DECL_RE.exec(cleanSource)) !== null) {
    declaredNames.add(dm[1])
  }

  const seen = new Set<string>()
  const unresolved: UnresolvedTypeName[] = []
  let lineStart = 0
  let lineNumber = 1

  let m2: RegExpExecArray | null
  TYPE_USAGE_RE.lastIndex = 0
  while ((m2 = TYPE_USAGE_RE.exec(cleanSource)) !== null) {
    const name = m2[1]
    const idx = m2.index
    while (lineStart <= idx) {
      const nl = cleanSource.indexOf('\n', lineStart)
      if (nl === -1 || nl >= idx) break
      lineStart = nl + 1
      lineNumber += 1
    }

    if (
      seen.has(name) ||
      name.length === 1 ||
      ALL_CAPS_RE.test(name) ||
      JAVA_LANG_TYPES.has(name) ||
      declaredNames.has(name) ||
      importedSimpleNames.has(name)
    ) {
      seen.add(name)
      continue
    }
    seen.add(name)
    unresolved.push({ name, lineNumber, column: idx - lineStart + 1 })
  }

  return { packageName, importedSimpleNames, wildcardPackages, unresolved }
}

/** 符号集签名（排序拼接），供诊断层去重，避免相同符号集重复 IPC */
export function unresolvedSignature(names: readonly string[]): string {
  return [...names].sort().join(',')
}

/** FQCN 是否被某个通配 import 覆盖（候选命中即视为已可用，不出缺失诊断） */
export function isCoveredByWildcard(fqcn: string, wildcardPackages: readonly string[]): boolean {
  return wildcardPackages.some((prefix) => fqcn.startsWith(prefix))
}

export interface MonacoRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface JavaImportEdit {
  range: MonacoRange
  text: string
}

const FQCN_RE = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)+$/
const IMPORT_FQ_RE = /^[ \t]*import[ \t]+(?:static[ \t]+)?([\w.]+(?:\.\*)?|\*)[ \t]*;[ \t]*$/

/**
 * 计算插入/去重后的单点 import edit；返回 null 表示无需插入：
 * - 该 FQCN 已存在显式 import；
 * - FQCN 非法。
 * 插入规则：有 import 区按整行字典序插入；无 import 区有 package 则在 package 后空一行；
 * 连 package 都没有则插文件首。
 */
export function buildImportEdit(source: string, fqcn: string): JavaImportEdit | null {
  if (!FQCN_RE.test(fqcn)) return null
  const statement = `import ${fqcn};`
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = source.split(/\r?\n/)

  let packageIdx = -1
  const importIdx: number[] = []
  let alreadyImported = false
  lines.forEach((line, i) => {
    const m = line.match(IMPORT_FQ_RE)
    if (m) {
      importIdx.push(i)
      if (m[1] === fqcn) alreadyImported = true
    } else if (packageIdx === -1 && PACKAGE_RE.test(line)) {
      packageIdx = i
    }
  })
  if (alreadyImported) return null

  // 有 import 区：字典序
  if (importIdx.length > 0) {
    for (const idx of importIdx) {
      if (lines[idx].trim() > statement) {
        return {
          range: {
            startLineNumber: idx + 1,
            startColumn: 1,
            endLineNumber: idx + 1,
            endColumn: 1
          },
          text: `${statement}${eol}`
        }
      }
    }
    const last = importIdx[importIdx.length - 1]
    return {
      range: {
        startLineNumber: last + 1,
        startColumn: lines[last].length + 1,
        endLineNumber: last + 1,
        endColumn: lines[last].length + 1
      },
      text: `${eol}${statement}`
    }
  }

  // 无 import 区：package 之后
  if (packageIdx >= 0) {
    return {
      range: {
        startLineNumber: packageIdx + 1,
        startColumn: lines[packageIdx].length + 1,
        endLineNumber: packageIdx + 1,
        endColumn: lines[packageIdx].length + 1
      },
      text: `${eol}${eol}${statement}`
    }
  }

  // 文件首
  return {
    range: {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1
    },
    text: `${statement}${eol}${eol}`
  }
}
