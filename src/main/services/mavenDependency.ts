/**
 * 构建依赖（Maven 坐标）管理：幂等改写项目 build.gradle。
 *
 * 设计要点：
 * - 只增删自己写的行，靠行尾标记识别（`// kunyu:dep:<group>:<artifact>`、
 *   `// kunyu:maven:<url>`），用户手写的 repositories / dependencies 零触碰；
 * - 重复添加同一坐标只更新版本/配置，不产生重复行（幂等）；
 * - 撤销 = 删掉对应标记行，仓库单独撤销；
 * - 坐标与仓库地址都做白名单校验，避免把引号/换行注入构建脚本；
 * - 所有文本变换是纯函数，可在临时目录离线测试，不依赖 Gradle / JDK / 网络。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  DependencyAddInput,
  DependencyConfiguration,
  DependencyFileState,
  DependencyOpResult,
  MavenCoordinate,
  ProjectDependency
} from '../../shared/types/dependency'
import type { ModLoader } from '../../shared/types/project'

/** 依赖行尾标记前缀 */
const DEP_MARK = '// kunyu:dep:'
/** 仓库行尾标记前缀 */
const REPO_MARK = '// kunyu:maven:'

const CONFIGURATIONS: readonly DependencyConfiguration[] = [
  'modImplementation',
  'implementation',
  'compileOnly',
  'runtimeOnly',
  'api'
]

/** 坐标分段白名单：字母数字开头，只允许 . _ -（版本额外允许 +） */
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/

export function isDependencyConfiguration(value: string): value is DependencyConfiguration {
  return (CONFIGURATIONS as readonly string[]).includes(value)
}

/** 加载器对应的默认依赖配置 */
export function defaultConfiguration(loader: ModLoader | null): DependencyConfiguration {
  return loader === 'fabric' ? 'modImplementation' : 'implementation'
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** 解析 group:artifact:version */
export function parseNotation(input: string): Parsed<MavenCoordinate> {
  const raw = (input ?? '').trim()
  if (!raw) return { ok: false, error: '坐标不能为空' }
  const parts = raw.split(':')
  if (parts.length !== 3) return { ok: false, error: '坐标格式应为 group:artifact:version' }
  const [group, artifact, version] = parts
  if (!SEGMENT_RE.test(group)) return { ok: false, error: `group 非法：${group}` }
  if (!SEGMENT_RE.test(artifact)) return { ok: false, error: `artifact 非法：${artifact}` }
  if (!VERSION_RE.test(version)) return { ok: false, error: `version 非法：${version}` }
  return { ok: true, value: { group, artifact, version } }
}

/** 规范化 maven 仓库地址：仅接受 https，去掉查询串/凭证，补齐结尾斜杠 */
export function normalizeRepository(input: string): Parsed<string> | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: `仓库地址不合法：${raw}` }
  }
  if (url.protocol !== 'https:') return { ok: false, error: '仓库地址必须是 https' }
  if (url.username || url.password) return { ok: false, error: '仓库地址不能内嵌账号密码' }
  if (url.search || url.hash) return { ok: false, error: '仓库地址不能带查询串或锚点' }
  const href = url.toString()
  return { ok: true, value: href.endsWith('/') ? href : `${href}/` }
}

// ────────────────────────────── 文本工具 ──────────────────────────────

interface Line {
  body: string
  eol: string
}

function splitLines(text: string): Line[] {
  const out: Line[] = []
  let i = 0
  while (i < text.length) {
    const nl = text.indexOf('\n', i)
    if (nl < 0) {
      out.push({ body: text.slice(i), eol: '' })
      break
    }
    const hasCr = nl > i && text[nl - 1] === '\r'
    out.push({ body: text.slice(i, hasCr ? nl - 1 : nl), eol: hasCr ? '\r\n' : '\n' })
    i = nl + 1
  }
  return out
}

function joinLines(lines: Line[]): string {
  return lines.map((l) => l.body + l.eol).join('')
}

function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function lineIndexOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length - 1
}

interface BlockRange {
  openBrace: number
  closeBrace: number
  indent: string
}

/** 跳过字符串字面量，返回结束引号下标（未闭合时停在行尾） */
function skipString(text: string, start: number): number {
  const quote = text[start]
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      i += 1
      continue
    }
    if (ch === quote) return i
    if (ch === '\n') return i
  }
  return text.length - 1
}

/** 从 open 处的 `{` 起做括号配对，忽略注释与字符串 */
function matchBrace(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i)
      if (nl < 0) return -1
      i = nl
      continue
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0) return -1
      i = end + 1
      continue
    }
    if (ch === '"' || ch === "'") {
      i = skipString(text, i)
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * 定位顶层块（repositories / dependencies）。
 * 同名块可能出现在 buildscript / publishing 里（缩进更深），
 * 取缩进最小者；同缩进取最后一个（项目级块通常在后）。
 */
function findBlock(text: string, name: string): BlockRange | null {
  const re = new RegExp(`^([ \\t]*)${name}\\s*\\{`, 'gm')
  const hits: BlockRange[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const openBrace = m.index + m[0].length - 1
    const closeBrace = matchBrace(text, openBrace)
    if (closeBrace < 0) continue
    hits.push({ openBrace, closeBrace, indent: m[1] })
  }
  if (hits.length === 0) return null
  const minIndent = Math.min(...hits.map((h) => h.indent.length))
  const top = hits.filter((h) => h.indent.length === minIndent)
  return top[top.length - 1]
}

/** 把一行插到块内末尾（块尾 `}` 之前）；块不存在时在文件末尾新建块 */
function insertIntoBlock(
  originalText: string,
  blockName: string,
  body: string
): { text: string; changed: boolean } {
  const block = findBlock(originalText, blockName)
  const eol = detectEol(originalText)
  if (!block) {
    const trimmed = originalText.replace(/\s*$/, '')
    const prefix = trimmed ? `${trimmed}${eol}${eol}` : ''
    return {
      text: `${prefix}${blockName} {${eol}    ${body}${eol}}${eol}`,
      changed: true
    }
  }

  const lines = splitLines(originalText)
  const closeIdx = lineIndexOf(originalText, block.closeBrace)
  const lineStart = originalText.lastIndexOf('\n', block.closeBrace) + 1
  const col = block.closeBrace - lineStart
  const closeLine = lines[closeIdx]
  const lineEol = closeLine.eol || eol
  const indent = `${block.indent}    `
  const head = closeLine.body.slice(0, col)

  if (head.trim() === '') {
    lines.splice(closeIdx, 0, { body: `${indent}${body}`, eol: lineEol })
    return { text: joinLines(lines), changed: true }
  }

  // 块尾与内容同行（dependencies { ... }）：拆成三行
  lines.splice(
    closeIdx,
    1,
    { body: head, eol: lineEol },
    { body: `${indent}${body}`, eol: lineEol },
    { body: closeLine.body.slice(col), eol: closeLine.eol }
  )
  return { text: joinLines(lines), changed: true }
}

// ────────────────────────────── 读写状态 ──────────────────────────────

const DEP_LINE_RE =
  /^[ \t]*([A-Za-z][A-Za-z0-9]*)\s+["']([^"'\r\n]+)["'][^\r\n]*?\/\/\s*kunyu:dep:([^\s]+)/

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 标记行判定：标记后必须紧跟空白或行尾。
 * 否则 `kunyu:dep:com.foo:bar` 会前缀命中 `kunyu:dep:com.foo:bar-core`，
 * 导致更新/删除误伤另一条依赖。
 */
function lineHasMarker(body: string, marker: string): boolean {
  return new RegExp(`${escapeRegExp(marker)}(?=\\s|$)`).test(body)
}

/** 从 build.gradle 文本解析出由 KunYu 管理的依赖与仓库 */
export function readDependencyState(text: string, hasBuildGradle = true): DependencyFileState {
  const dependencies: ProjectDependency[] = []
  const repositories: string[] = []
  const seenDep = new Set<string>()

  for (const line of splitLines(text)) {
    const repoMatch = /\/\/\s*kunyu:maven:(\S+)/.exec(line.body)
    if (repoMatch && !repositories.includes(repoMatch[1])) repositories.push(repoMatch[1])

    const m = DEP_LINE_RE.exec(line.body)
    if (!m) continue
    const [, configuration, notation, marker] = m
    const parsed = parseNotation(notation)
    if (!parsed.ok) continue
    const key = `${parsed.value.group}:${parsed.value.artifact}`
    if (key !== marker || seenDep.has(key)) continue
    seenDep.add(key)
    dependencies.push({
      coordinate: parsed.value,
      notation,
      configuration: isDependencyConfiguration(configuration) ? configuration : 'implementation'
    })
  }
  return { dependencies, repositories, hasBuildGradle }
}

/** 幂等写入一条依赖：已存在则原地更新，否则插到 dependencies 块尾 */
export function upsertDependencyInText(
  text: string,
  dep: ProjectDependency
): { text: string; changed: boolean } {
  const marker = `${DEP_MARK}${dep.coordinate.group}:${dep.coordinate.artifact}`
  const lines = splitLines(text)
  const idx = lines.findIndex((l) => lineHasMarker(l.body, marker))
  const body = `${dep.configuration} "${dep.notation}" ${marker}`

  if (idx >= 0) {
    const indent = /^[ \t]*/.exec(lines[idx].body)?.[0] ?? ''
    const next = `${indent}${body}`
    if (lines[idx].body === next) return { text, changed: false }
    lines[idx] = { body: next, eol: lines[idx].eol }
    return { text: joinLines(lines), changed: true }
  }
  return insertIntoBlock(text, 'dependencies', body)
}

/** 幂等写入一个 maven 仓库（已存在则不重复） */
export function upsertRepositoryInText(
  text: string,
  url: string
): { text: string; changed: boolean } {
  const marker = `${REPO_MARK}${url}`
  if (splitLines(text).some((l) => lineHasMarker(l.body, marker))) return { text, changed: false }
  return insertIntoBlock(text, 'repositories', `maven { url = '${url}' } ${marker}`)
}

/** 删除某条由 KunYu 管理的依赖 */
export function removeDependencyFromText(
  text: string,
  coordinate: MavenCoordinate
): { text: string; changed: boolean } {
  const marker = `${DEP_MARK}${coordinate.group}:${coordinate.artifact}`
  const lines = splitLines(text)
  const kept = lines.filter((l) => !lineHasMarker(l.body, marker))
  if (kept.length === lines.length) return { text, changed: false }
  return { text: joinLines(kept), changed: true }
}

/** 删除某个由 KunYu 管理的 maven 仓库（不碰用户手写仓库） */
export function removeRepositoryFromText(
  text: string,
  url: string
): { text: string; changed: boolean } {
  const marker = `${REPO_MARK}${url}`
  const lines = splitLines(text)
  const kept = lines.filter((l) => !lineHasMarker(l.body, marker))
  if (kept.length === lines.length) return { text, changed: false }
  return { text: joinLines(kept), changed: true }
}

// ────────────────────────────── 文件级操作 ──────────────────────────────

function gradlePathOf(root: string): string {
  return join(root, 'build.gradle')
}

function readGradle(root: string): string | null {
  const file = gradlePathOf(root)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

export function readProjectDependencies(root: string): DependencyFileState {
  const text = readGradle(root)
  if (text === null) return { dependencies: [], repositories: [], hasBuildGradle: false }
  return readDependencyState(text, true)
}

function mutate(
  root: string,
  fn: (text: string) => { text: string; changed: boolean }
): DependencyOpResult {
  const text = readGradle(root)
  if (text === null) return { ok: false, error: '项目根目录缺少 build.gradle，无法管理构建依赖' }
  try {
    const result = fn(text)
    if (result.changed) writeFileSync(gradlePathOf(root), result.text, 'utf8')
    return { ok: true, changed: result.changed, state: readDependencyState(result.text) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

export function addProjectDependency(
  root: string,
  input: DependencyAddInput,
  loader: ModLoader | null
): DependencyOpResult {
  const parsed = parseNotation(input.notation)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const configuration =
    input.configuration && isDependencyConfiguration(input.configuration)
      ? input.configuration
      : defaultConfiguration(loader)
  const repo = normalizeRepository(input.repository ?? '')
  if (repo && !repo.ok) return { ok: false, error: repo.error }

  const dep: ProjectDependency = {
    coordinate: parsed.value,
    notation: input.notation.trim(),
    configuration
  }
  return mutate(root, (text) => {
    let next = text
    let changed = false
    if (repo?.ok) {
      const r = upsertRepositoryInText(next, repo.value)
      next = r.text
      changed = changed || r.changed
    }
    const d = upsertDependencyInText(next, dep)
    return { text: d.text, changed: changed || d.changed }
  })
}

export function removeProjectDependency(root: string, notation: string): DependencyOpResult {
  const parsed = parseNotation(notation)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  return mutate(root, (text) => removeDependencyFromText(text, parsed.value))
}

export function removeProjectRepository(root: string, url: string): DependencyOpResult {
  const normalized = normalizeRepository(url)
  if (!normalized) return { ok: false, error: '仓库地址不能为空' }
  if (!normalized.ok) return { ok: false, error: normalized.error }
  return mutate(root, (text) => removeRepositoryFromText(text, normalized.value))
}
