/**
 * FTB 任务书主进程服务。
 *
 * 读写项目根 config/ftbquests/quests/chapters/<章节id>.snbt（SNBT：无引号键 NBT 文本）。
 * 解析器 parseFtbChapter 与生成器 buildFtbQuestChapter（companionContent）互逆：
 * 无引号键、tab 缩进、双引号字符串（" 与 \ 转义）、数组 []、复合 {}。
 * 解析对未知键宽容（忽略），只提取本工具支持的字段；
 * 保存时经 buildFtbQuestChapter 重写为规范格式（id/title/icon/quests + dependencies）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  FtbQuest,
  FtbQuestChapter,
  FtbQuestChapterSummary,
  FtbQuestListResult
} from '../../shared/types/ftbquest'
import { validateContentId } from '../../shared/types/content'
import { assertWithinRoot } from './fsService'
import { buildFtbQuestChapter } from './modpack/companionContent'

/** 章节目录（项目根 config/ftbquests/quests/chapters/） */
export function chaptersDir(root: string): string {
  assertWithinRoot(root)
  return join(root, 'config', 'ftbquests', 'quests', 'chapters')
}

/* ------------------------------ SNBT 迷你解析 ------------------------------ */

type SnbtValue = string | number | SnbtCompound | SnbtValue[]
interface SnbtCompound {
  [key: string]: SnbtValue
}

/**
 * 解析 SNBT 子集：复合 {k: v}、数组 [v, ...]、双引号字符串（\" \\ 转义）、
 * 整数/小数数字、裸词（按字符串收）。键为无引号标识符。
 * 足以覆盖 FTB Quests 章节文件与 buildFtbQuestChapter 的全部输出。
 */
export function parseSnbt(text: string): SnbtCompound {
  let pos = 0
  const src = text.replace(/^\uFEFF/, '')

  function skipWs(): void {
    while (pos < src.length) {
      const c = src[pos]
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') pos++
      else if (c === '/' && src[pos + 1] === '/') {
        while (pos < src.length && src[pos] !== '\n') pos++
      } else break
    }
  }

  function parseString(): string {
    // src[pos] === '"'
    pos++
    let out = ''
    while (pos < src.length) {
      const c = src[pos]
      if (c === '\\') {
        const n = src[pos + 1]
        if (n === '"' || n === '\\') {
          out += n
          pos += 2
          continue
        }
        if (n === 'n') {
          out += '\n'
          pos += 2
          continue
        }
        out += c
        pos++
        continue
      }
      if (c === '"') {
        pos++
        return out
      }
      out += c
      pos++
    }
    throw new Error('SNBT 字符串未闭合')
  }

  function parseBare(): string {
    const start = pos
    while (pos < src.length && !' \t\r\n,:{}[]"'.includes(src[pos])) pos++
    if (pos === start) throw new Error(`SNBT 语法错误：位置 ${pos} 处期望取值`)
    return src.slice(start, pos)
  }

  function parseValue(): SnbtValue {
    skipWs()
    const c = src[pos]
    if (c === '"') return parseString()
    if (c === '{') return parseCompound()
    if (c === '[') return parseList()
    const bare = parseBare()
    const num = Number(bare)
    return Number.isFinite(num) && bare.trim() !== '' ? num : bare
  }

  function parseCompound(): SnbtCompound {
    // src[pos] === '{'
    pos++
    const out: SnbtCompound = {}
    for (;;) {
      skipWs()
      if (src[pos] === '}') {
        pos++
        return out
      }
      if (pos >= src.length) throw new Error('SNBT 复合未闭合')
      const key = src[pos] === '"' ? parseString() : parseBare()
      skipWs()
      if (src[pos] !== ':') throw new Error(`SNBT 键 ${key} 后缺少冒号`)
      pos++
      out[key] = parseValue()
      skipWs()
      if (src[pos] === ',') pos++
    }
  }

  function parseList(): SnbtValue[] {
    // src[pos] === '['
    pos++
    const out: SnbtValue[] = []
    for (;;) {
      skipWs()
      if (src[pos] === ']') {
        pos++
        return out
      }
      if (pos >= src.length) throw new Error('SNBT 数组未闭合')
      out.push(parseValue())
      skipWs()
      if (src[pos] === ',') pos++
    }
  }

  skipWs()
  const root = parseCompound()
  return root
}

function asString(v: SnbtValue | undefined): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return undefined
}

function asStringList(v: SnbtValue | undefined): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => asString(x) ?? '').filter((s) => s.length > 0)
}

function asNumber(v: SnbtValue | undefined, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

/** 从任务复合中提取 item 任务与 item 奖励（其他类型忽略，取不到物品 id 回退空串） */
function questFromCompound(raw: SnbtCompound): FtbQuest {
  const quest: FtbQuest = {
    id: asString(raw.id) ?? '',
    title: asString(raw.title) ?? '',
    description: asStringList(raw.description),
    dependencies: asStringList(raw.dependencies),
    item: 'minecraft:stone'
  }
  if (Array.isArray(raw.tasks)) {
    for (const t of raw.tasks) {
      if (t && typeof t === 'object' && !Array.isArray(t)) {
        const item = asString((t as SnbtCompound).item)
        if (item) {
          quest.item = item
          break
        }
      }
    }
  }
  if (Array.isArray(raw.rewards)) {
    for (const r of raw.rewards) {
      if (r && typeof r === 'object' && !Array.isArray(r)) {
        const rc = r as SnbtCompound
        const item = asString(rc.item)
        if (item) {
          quest.reward = { item, count: asNumber(rc.count, 1) }
          break
        }
      }
    }
  }
  return quest
}

/** 解析章节 SNBT 文本为结构化章节；章节 id 缺省时回退 fallbackId（通常取文件名主干） */
export function parseFtbChapter(text: string, fallbackId = ''): FtbQuestChapter {
  const root = parseSnbt(text)
  const quests = Array.isArray(root.quests)
    ? root.quests
        .filter((q): q is SnbtCompound => !!q && typeof q === 'object' && !Array.isArray(q))
        .map(questFromCompound)
        .filter((q) => q.id.length > 0)
    : []
  return {
    id: asString(root.id) ?? fallbackId,
    title: asString(root.title) ?? '',
    icon: asString(root.icon) ?? 'minecraft:book',
    quests
  }
}

/* ------------------------------ 章节 CRUD ------------------------------ */

function chapterPath(root: string, id: string): string {
  if (!validateContentId(id)) {
    throw new Error('章节 id 不合法：小写字母开头，仅含小写字母、数字、下划线')
  }
  return join(chaptersDir(root), `${id}.snbt`)
}

/** 列出章节摘要；无法解析的文件记入 warnings（不静默丢弃） */
export function listChapters(root: string): FtbQuestListResult {
  const dir = chaptersDir(root)
  const result: FtbQuestListResult = { chapters: [], warnings: [] }
  if (!existsSync(dir)) return result
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.snbt')) continue
    const stem = name.slice(0, -'.snbt'.length)
    try {
      const ch = parseFtbChapter(readFileSync(join(dir, name), 'utf-8'), stem)
      const summary: FtbQuestChapterSummary = {
        id: ch.id || stem,
        title: ch.title,
        icon: ch.icon,
        questCount: ch.quests.length
      }
      result.chapters.push(summary)
    } catch (err) {
      result.warnings.push(`${name}：${(err as Error).message}`)
    }
  }
  result.chapters.sort((a, b) => a.id.localeCompare(b.id))
  return result
}

/** 读取单个章节（含任务明细） */
export function readChapter(root: string, id: string): FtbQuestChapter {
  const path = chapterPath(root, id)
  if (!existsSync(path)) throw new Error(`章节不存在：${id}`)
  return parseFtbChapter(readFileSync(path, 'utf-8'), id)
}

/**
 * 保存章节：经 buildFtbQuestChapter 序列化为规范 SNBT（与解析互逆）。
 * prevId 提供且与新 id 不同时删除旧文件（重命名语义）。
 */
export function saveChapter(root: string, chapter: FtbQuestChapter, prevId?: string): void {
  const path = chapterPath(root, chapter.id)
  const dir = chaptersDir(root)
  mkdirSync(dir, { recursive: true })
  const content = buildFtbQuestChapter({
    chapterId: chapter.id,
    title: chapter.title,
    icon: chapter.icon,
    quests: chapter.quests.map((q) => ({
      id: q.id,
      title: q.title,
      description: q.description,
      dependencies: q.dependencies,
      item: q.item,
      reward: q.reward
    }))
  })
  writeFileSync(path, content)
  if (prevId && prevId !== chapter.id) {
    rmSync(chapterPath(root, prevId), { force: true })
  }
}

/** 删除章节文件（不存在时静默成功） */
export function deleteChapter(root: string, id: string): void {
  rmSync(chapterPath(root, id), { force: true })
}
