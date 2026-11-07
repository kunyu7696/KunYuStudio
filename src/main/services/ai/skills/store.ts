/**
 * 用户技能包存储（Agent Skills 标准 SKILL.md）。
 *
 * 设计边界（与内置 playbook 体系互不干扰）：
 * - 只做安装/扫描/启停/删除/按需读取，**绝不执行技能包内的脚本**；
 * - 技能根固定在 `<userData>/workbench-skills`，每个技能是一级子目录；
 * - 扫描期校验 frontmatter、目录限额与路径安全，坏技能记入 issues 而不拖垮其它技能；
 * - 读写全部软失败并给出中文原因，IPC/工具层不抛异常；
 * - 启停状态落 `.skill-state.json`（版本号 + 串行写队列，避免并发覆盖）。
 *
 * 本文件不 import electron，便于单测直接以临时目录驱动。
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  SKILL_LIMITS,
  SKILL_NAME_PATTERN,
  type SkillIssue,
  type SkillListResult,
  type SkillMeta,
  type SkillMutationResult,
  type SkillSource
} from '../../../../shared/types/skill'

/** 校验失败（消息直接面向用户，中文） */
export class SkillValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkillValidationError'
  }
}

/** frontmatter 解析结果（正文单独返回，不注入 prompt） */
export interface ParsedSkillMarkdown {
  name: string
  description: string
  version: string
  /** 其余顶层字段原样保留（安装时整文件复制，不改写） */
  extra: Record<string, string>
  body: string
}

/** 目录体检结果 */
export interface SkillDirInspection {
  name: string
  description: string
  version: string
  path: string
  sizeBytes: number
  entryCount: number
  updatedAt: string
}

interface SkillStateFile {
  version: number
  enabled: Record<string, boolean>
  sources: Record<string, SkillSource>
}

const STATE_FILE = '.skill-state.json'
const SKILL_FILE = 'SKILL.md'

/** 允许 skills_read 读取的文本类扩展名（二进制资产只作为技能包附件，不喂给模型） */
const READABLE_EXTS = new Set([
  '.md',
  '.txt',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.java',
  '.gradle',
  '.properties',
  '.xml',
  '.csv',
  '.sh',
  '.ps1',
  '.py'
])

/** 全局技能根（纯函数，供 IPC/编排器复用） */
export function skillRootFromUserData(userData: string): string {
  return join(userData, 'workbench-skills')
}

// ---------------------------------------------------------------------------
// frontmatter 解析（只实现 SKILL.md 常用子集：标量 / 引号 / 块标量）
// ---------------------------------------------------------------------------

function unquote(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  // 未加引号时去掉行尾注释（YAML 中 ` #` 起注释）
  return value.replace(/\s+#.*$/, '').trim()
}

function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const raw = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const open = /^---[ \t]*\r?\n/.exec(raw)
  if (!open) {
    throw new SkillValidationError('SKILL.md 缺少 YAML frontmatter（文件必须以 --- 开始）')
  }
  const rest = raw.slice(open[0].length)
  const close = /\r?\n---[ \t]*(?:\r?\n|$)/.exec(rest)
  if (!close) {
    throw new SkillValidationError('SKILL.md 的 YAML frontmatter 未闭合（缺少结束的 ---）')
  }
  return {
    frontmatter: rest.slice(0, close.index),
    body: rest.slice(close.index + close[0].length)
  }
}

function parseFrontmatter(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || /^\s*#/.test(line)) continue
    const m = /^([A-Za-z0-9_-]+):(.*)$/.exec(line)
    if (!m) continue
    const key = m[1]
    const raw = m[2].trim()
    if (/^[|>][+-]?$/.test(raw)) {
      const folded = raw.startsWith('>')
      const collected: string[] = []
      let j = i + 1
      while (j < lines.length && (lines[j].trim() === '' || /^\s+/.test(lines[j]))) {
        collected.push(lines[j].replace(/^\s+/, ''))
        j++
      }
      while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop()
      out[key] = folded ? collected.join(' ').trim() : collected.join('\n').trim()
      i = j - 1
      continue
    }
    out[key] = unquote(raw)
  }
  return out
}

/** 解析 SKILL.md：frontmatter + 正文，并完成 name/description/正文校验 */
export function parseSkillMarkdown(text: string): ParsedSkillMarkdown {
  const { frontmatter, body } = splitFrontmatter(text)
  const fields = parseFrontmatter(frontmatter)
  const name = (fields['name'] ?? '').trim()
  const description = (fields['description'] ?? '').trim()
  const version = (fields['version'] ?? '').trim() || '0.0.0'

  if (!name) throw new SkillValidationError('SKILL.md 缺少 name 字段')
  if (name.length > 64 || !SKILL_NAME_PATTERN.test(name)) {
    throw new SkillValidationError(
      'name 必须为 1-64 位小写字母/数字，并以单连字符分隔（如 my-skill）'
    )
  }
  if (!description) throw new SkillValidationError('SKILL.md 缺少 description 字段')
  if (description.length > 1024) {
    throw new SkillValidationError(`description 超长（${description.length} 字符 > 1024）`)
  }
  if (!body.trim()) throw new SkillValidationError('SKILL.md 正文为空')

  const extra: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (k !== 'name' && k !== 'description' && k !== 'version') extra[k] = v
  }
  return { name, description, version, extra, body }
}

// ---------------------------------------------------------------------------
// 路径安全
// ---------------------------------------------------------------------------

/** target 是否为 root 的严格子路径（不含根本身） */
function isStrictChild(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  if (!rel || isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith(`..${sep}`)
}

/** 校验一级目录名：只允许普通段，禁止分隔符/上级引用/盘符 */
function assertDirName(dirName: string): void {
  if (
    !dirName ||
    dirName === '.' ||
    dirName === '..' ||
    /[\\/:]/.test(dirName) ||
    isAbsolute(dirName)
  ) {
    throw new SkillValidationError(`非法的技能目录名：${dirName}`)
  }
}

/** 遍历目录统计项数与字节数；符号链接/特殊文件直接拒绝 */
function walkStats(dir: string, acc: { entries: number; bytes: number }): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    acc.entries += 1
    if (ent.isSymbolicLink()) {
      throw new SkillValidationError(`技能包包含符号链接（${ent.name}），出于安全拒绝安装`)
    }
    const abs = join(dir, ent.name)
    if (ent.isDirectory()) {
      walkStats(abs, acc)
    } else if (ent.isFile()) {
      acc.bytes += lstatSync(abs).size
    } else {
      throw new SkillValidationError(`技能包包含特殊文件（${ent.name}），出于安全拒绝安装`)
    }
    if (acc.entries > SKILL_LIMITS.maxDirEntries) {
      throw new SkillValidationError(`技能包目录项超过上限（${SKILL_LIMITS.maxDirEntries}）`)
    }
    if (acc.bytes > SKILL_LIMITS.maxDirBytes) {
      throw new SkillValidationError(
        `技能包体积超过上限（${Math.round(SKILL_LIMITS.maxDirBytes / 1024 / 1024)} MiB）`
      )
    }
  }
}

/** 体检一个技能目录：返回元数据，任何不安全/不合规都抛 SkillValidationError */
export function inspectSkillDir(dirAbs: string): SkillDirInspection {
  const skillFile = join(dirAbs, SKILL_FILE)
  if (!existsSync(skillFile)) throw new SkillValidationError('缺少 SKILL.md')
  const fileStat = lstatSync(skillFile)
  if (fileStat.isSymbolicLink()) throw new SkillValidationError('SKILL.md 是符号链接，拒绝读取')
  if (!fileStat.isFile()) throw new SkillValidationError('SKILL.md 不是普通文件')
  if (fileStat.size > SKILL_LIMITS.maxSkillFileBytes) {
    throw new SkillValidationError(
      `SKILL.md 超长（${Math.ceil(fileStat.size / 1024)} KiB > ${SKILL_LIMITS.maxSkillFileBytes / 1024} KiB）`
    )
  }
  const parsed = parseSkillMarkdown(readFileSync(skillFile, 'utf-8'))
  const acc = { entries: 0, bytes: 0 }
  walkStats(dirAbs, acc)
  return {
    name: parsed.name,
    description: parsed.description,
    version: parsed.version,
    path: skillFile,
    sizeBytes: acc.bytes,
    entryCount: acc.entries,
    updatedAt: statSync(dirAbs).mtime.toISOString()
  }
}

// ---------------------------------------------------------------------------
// 状态文件
// ---------------------------------------------------------------------------

function statePath(root: string): string {
  return join(root, STATE_FILE)
}

function emptyState(): SkillStateFile {
  return { version: 0, enabled: {}, sources: {} }
}

function readState(root: string): SkillStateFile {
  const file = statePath(root)
  if (!existsSync(file)) return emptyState()
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<SkillStateFile>
    const enabled: Record<string, boolean> = {}
    const sources: Record<string, SkillSource> = {}
    if (raw.enabled && typeof raw.enabled === 'object') {
      for (const [k, v] of Object.entries(raw.enabled)) {
        if (typeof v === 'boolean') enabled[k] = v
      }
    }
    if (raw.sources && typeof raw.sources === 'object') {
      for (const [k, v] of Object.entries(raw.sources)) {
        if (v === 'file' || v === 'directory') sources[k] = v
      }
    }
    return {
      version: typeof raw.version === 'number' ? raw.version : 0,
      enabled,
      sources
    }
  } catch {
    // 状态文件损坏时按默认（全启用）恢复，不阻断技能使用
    return emptyState()
  }
}

/** 原子写状态：先写临时文件再 rename，避免半截 JSON */
function writeState(root: string, state: SkillStateFile): void {
  mkdirSync(root, { recursive: true })
  const file = statePath(root)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf-8')
  renameSync(tmp, file)
}

// ---------------------------------------------------------------------------
// 扫描缓存（显式 reload / 任何变更后失效）
// ---------------------------------------------------------------------------

const cache = new Map<string, SkillListResult>()

/** 清空扫描缓存（设置页「重载」按钮 / 外部手动改动技能包后调用） */
export function reloadSkills(root: string): void {
  cache.delete(resolve(root))
}

function invalidate(root: string): void {
  cache.delete(resolve(root))
}

// ---------------------------------------------------------------------------
// 扫描
// ---------------------------------------------------------------------------

function scanSkills(root: string): SkillListResult {
  const absRoot = resolve(root)
  const state = readState(absRoot)
  const skills: SkillMeta[] = []
  const issues: SkillIssue[] = []
  if (!existsSync(absRoot)) return { root: absRoot, skills, issues }

  let entries: Dirent[] = []
  try {
    entries = readdirSync(absRoot, { withFileTypes: true })
  } catch (err) {
    issues.push({ dirName: '', message: `读取技能根失败：${(err as Error).message}` })
    return { root: absRoot, skills, issues }
  }

  const seenNames = new Set<string>()
  for (const ent of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (ent.isSymbolicLink()) {
      issues.push({ dirName: ent.name, message: '符号链接目录，出于安全跳过' })
      continue
    }
    if (!ent.isDirectory()) continue
    try {
      const meta = inspectSkillDir(join(absRoot, ent.name))
      if (seenNames.has(meta.name)) {
        issues.push({ dirName: ent.name, message: `技能名 ${meta.name} 与其它已安装技能重复` })
        continue
      }
      seenNames.add(meta.name)
      skills.push({
        ...meta,
        enabled: state.enabled[ent.name] ?? true,
        source: state.sources[ent.name] ?? 'directory',
        dirName: ent.name
      })
    } catch (err) {
      issues.push({ dirName: ent.name, message: (err as Error).message })
    }
  }
  return { root: absRoot, skills, issues }
}

/** 扫描全局技能根（结果带缓存，变更/重载后失效） */
export function listSkills(root: string): SkillListResult {
  const key = resolve(root)
  const cached = cache.get(key)
  if (cached) return cached
  const result = scanSkills(key)
  cache.set(key, result)
  return result
}

// ---------------------------------------------------------------------------
// 安装
// ---------------------------------------------------------------------------

/** 递归复制目录（源已通过体检：无符号链接/特殊文件） */
export function copySkillTree(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  for (const ent of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, ent.name)
    const dest = join(destDir, ent.name)
    if (ent.isSymbolicLink()) {
      throw new SkillValidationError(`复制期发现符号链接（${ent.name}），已中止`)
    }
    if (ent.isDirectory()) {
      copySkillTree(src, dest)
    } else if (ent.isFile()) {
      copyFileSync(src, dest)
    } else {
      throw new SkillValidationError(`复制期发现特殊文件（${ent.name}），已中止`)
    }
  }
}

/** 安装单个 SKILL.md 文件（目录名 = frontmatter name） */
export function importSkillFile(root: string, sourceFile: string): SkillMutationResult {
  try {
    const absRoot = resolve(root)
    const src = resolve(sourceFile)
    const stat = lstatSync(src)
    if (stat.isSymbolicLink()) return { ok: false, error: '源文件是符号链接，拒绝导入' }
    if (!stat.isFile()) return { ok: false, error: '请选择一个 SKILL.md 文件' }
    if (stat.size > SKILL_LIMITS.maxSkillFileBytes) {
      return {
        ok: false,
        error: `SKILL.md 超长（${Math.ceil(stat.size / 1024)} KiB > ${SKILL_LIMITS.maxSkillFileBytes / 1024} KiB）`
      }
    }
    const parsed = parseSkillMarkdown(readFileSync(src, 'utf-8'))
    const destDir = join(absRoot, parsed.name)
    if (existsSync(destDir)) {
      return { ok: false, error: `已存在同名技能：${parsed.name}` }
    }
    mkdirSync(absRoot, { recursive: true })
    mkdirSync(destDir)
    copyFileSync(src, join(destDir, SKILL_FILE))
    const state = readState(absRoot)
    state.enabled[parsed.name] = true
    state.sources[parsed.name] = 'file'
    state.version += 1
    writeState(absRoot, state)
    invalidate(absRoot)
    return { ok: true, name: parsed.name }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** 安装整个技能目录（必须直接包含 SKILL.md） */
export function importSkillDirectory(root: string, sourceDir: string): SkillMutationResult {
  try {
    const absRoot = resolve(root)
    const src = resolve(sourceDir)
    if (src === absRoot || isStrictChild(absRoot, src)) {
      return { ok: false, error: '不能从技能根内部导入，请选择外部目录' }
    }
    const stat = lstatSync(src)
    if (stat.isSymbolicLink()) return { ok: false, error: '源目录是符号链接，拒绝导入' }
    if (!stat.isDirectory()) return { ok: false, error: '请选择一个技能包目录' }
    const inspection = inspectSkillDir(src)
    const destDir = join(absRoot, inspection.name)
    if (existsSync(destDir)) {
      return { ok: false, error: `已存在同名技能：${inspection.name}` }
    }
    mkdirSync(absRoot, { recursive: true })
    copySkillTree(src, destDir)
    const state = readState(absRoot)
    state.enabled[inspection.name] = true
    state.sources[inspection.name] = 'directory'
    state.version += 1
    writeState(absRoot, state)
    invalidate(absRoot)
    return { ok: true, name: inspection.name }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// ---------------------------------------------------------------------------
// 启停 / 删除 / 读取
// ---------------------------------------------------------------------------

/** 启用或禁用技能（按磁盘目录名定位，禁用项不注入也不进 run 快照） */
export function setSkillEnabled(
  root: string,
  dirName: string,
  enabled: boolean
): SkillMutationResult {
  try {
    assertDirName(dirName)
    const absRoot = resolve(root)
    const dir = join(absRoot, dirName)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      return { ok: false, error: `技能目录不存在：${dirName}` }
    }
    inspectSkillDir(dir)
    const state = readState(absRoot)
    state.enabled[dirName] = enabled
    state.version += 1
    writeState(absRoot, state)
    invalidate(absRoot)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** 删除技能目录（仅限技能根的一级子目录） */
export function removeSkill(root: string, dirName: string): SkillMutationResult {
  try {
    assertDirName(dirName)
    const absRoot = resolve(root)
    const dir = join(absRoot, dirName)
    if (!existsSync(dir)) return { ok: false, error: `技能目录不存在：${dirName}` }
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) {
      return { ok: false, error: '目标不是普通技能目录，拒绝删除' }
    }
    rmSync(dir, { recursive: true, force: true })
    const state = readState(absRoot)
    delete state.enabled[dirName]
    delete state.sources[dirName]
    state.version += 1
    writeState(absRoot, state)
    invalidate(absRoot)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/**
 * 读取技能包内文本文件（默认 SKILL.md）。
 * 路径必须落在技能目录内；拒绝符号链接、越界、二进制与超限读取。
 */
export function readSkillFile(
  root: string,
  dirName: string,
  relFile = SKILL_FILE
): { ok: true; text: string; path: string } | { ok: false; error: string } {
  try {
    assertDirName(dirName)
    const absRoot = resolve(root)
    const skillDir = join(absRoot, dirName)
    if (!isStrictChild(absRoot, skillDir)) return { ok: false, error: '技能目录越界' }
    const rawRel = (relFile || SKILL_FILE).trim().replace(/\\/g, '/')
    if (!rawRel || rawRel.startsWith('/') || /^[A-Za-z]:/.test(rawRel)) {
      return { ok: false, error: `非法的技能内文件路径：${relFile}` }
    }
    const target = resolve(skillDir, rawRel)
    if (!isStrictChild(skillDir, target)) {
      return { ok: false, error: `技能内文件路径越界：${relFile}` }
    }
    if (!existsSync(target)) return { ok: false, error: `技能内文件不存在：${rawRel}` }
    const stat = lstatSync(target)
    if (stat.isSymbolicLink()) return { ok: false, error: '拒绝读取符号链接文件' }
    if (!stat.isFile()) return { ok: false, error: '目标不是普通文件' }
    if (stat.size > SKILL_LIMITS.maxReadBytes) {
      return {
        ok: false,
        error: `文件超长（${Math.ceil(stat.size / 1024)} KiB > ${SKILL_LIMITS.maxReadBytes / 1024} KiB），请拆分后重试`
      }
    }
    const dot = target.lastIndexOf('.')
    const ext = dot >= 0 ? target.slice(dot).toLowerCase() : ''
    if (!READABLE_EXTS.has(ext)) {
      return { ok: false, error: `不支持读取该类型文件（${ext || '无扩展名'}），仅支持文本类附件` }
    }
    return { ok: true, text: readFileSync(target, 'utf-8'), path: target }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
