/**
 * Patchouli 指南书主进程服务。
 *
 * 直读直写 config/<namespace>/patchouli_books/<book>/ 目录（book.json + en_us/categories +
 * en_us/entries），JSON 格式与 companionContent 的 buildPatchouliBookJson/Category/Entry 对齐
 * （2 空格缩进 + 尾部换行）。页面类型支持 text/crafting/image/spotlight 四种；
 * 读到其他页面类型时忽略（保存后不再回写，列表 warnings 会提示）。
 * 保存为同步语义：目录下不再存在的类目/条目文件会被移除。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  PatchouliBook,
  PatchouliBookSummary,
  PatchouliCategory,
  PatchouliEntry,
  PatchouliListResult,
  PatchouliPage
} from '../../shared/types/patchouli'
import { validateContentId } from '../../shared/types/content'
import { assertWithinRoot } from './fsService'
import { resolveModContext } from './contentGenerator/context'

const SUPPORTED_PAGE_TYPES = ['text', 'crafting', 'image', 'spotlight'] as const

/** 手册目录（config/<namespace>/patchouli_books/<book>/） */
export function bookDir(root: string, namespace: string, bookId: string): string {
  assertWithinRoot(root)
  if (!validateContentId(namespace)) throw new Error(`命名空间不合法：${namespace}`)
  if (!validateContentId(bookId)) throw new Error(`手册 id 不合法：${bookId}`)
  return join(root, 'config', namespace, 'patchouli_books', bookId)
}

/** 新建手册时的默认命名空间：模组项目取 modId，其他项目空串（用户填写） */
export function defaultNamespace(root: string): string {
  try {
    return resolveModContext(root).modId
  } catch {
    return ''
  }
}

/* ------------------------------ 页面（反）序列化 ------------------------------ */

function pageToJson(p: PatchouliPage): Record<string, unknown> {
  switch (p.type) {
    case 'crafting':
      return { type: 'crafting', recipe: p.recipe ?? '', ...(p.text ? { text: p.text } : {}) }
    case 'image':
      return { type: 'image', images: p.images ?? [], ...(p.title ? { title: p.title } : {}) }
    case 'spotlight':
      return { type: 'spotlight', item: p.item ?? '', ...(p.text ? { text: p.text } : {}) }
    default:
      return { type: 'text', text: p.text ?? '' }
  }
}

function pageFromJson(raw: Record<string, unknown>): PatchouliPage | null {
  const type = typeof raw.type === 'string' ? raw.type : ''
  if (!(SUPPORTED_PAGE_TYPES as readonly string[]).includes(type)) return null
  const text = typeof raw.text === 'string' ? raw.text : undefined
  switch (type) {
    case 'crafting':
      return { type, recipe: typeof raw.recipe === 'string' ? raw.recipe : '', text }
    case 'image':
      return {
        type,
        images: Array.isArray(raw.images)
          ? raw.images.filter((x): x is string => typeof x === 'string')
          : [],
        title: typeof raw.title === 'string' ? raw.title : undefined
      }
    case 'spotlight':
      return { type, item: typeof raw.item === 'string' ? raw.item : '', text }
    default:
      return { type: 'text', text: text ?? '' }
  }
}

/** JSON 工具：读（BOM 容忍）、写（2 空格缩进 + 换行，与生成器对齐） */
function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')) as Record<string, unknown>
}

function writeJson(path: string, doc: Record<string, unknown>): void {
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n')
}

/* ------------------------------ 读取 ------------------------------ */

function readEntry(path: string, id: string): PatchouliEntry {
  const doc = readJson(path)
  const pages = Array.isArray(doc.pages)
    ? doc.pages
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map(pageFromJson)
        .filter((p): p is PatchouliPage => p !== null)
    : []
  return {
    id,
    name: typeof doc.name === 'string' ? doc.name : id,
    icon: typeof doc.icon === 'string' ? doc.icon : 'minecraft:book',
    pages
  }
}

function readCategory(bookPath: string, id: string): PatchouliCategory {
  const doc = readJson(join(bookPath, 'en_us', 'categories', `${id}.json`))
  const entriesDir = join(bookPath, 'en_us', 'entries', id)
  const entries: PatchouliEntry[] = []
  if (existsSync(entriesDir)) {
    for (const name of readdirSync(entriesDir)) {
      if (!name.endsWith('.json')) continue
      entries.push(readEntry(join(entriesDir, name), name.slice(0, -'.json'.length)))
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return {
    id,
    name: typeof doc.name === 'string' ? doc.name : id,
    description: typeof doc.description === 'string' ? doc.description : '',
    icon: typeof doc.icon === 'string' ? doc.icon : 'minecraft:book',
    sortnum: typeof doc.sortnum === 'number' ? doc.sortnum : 0,
    entries
  }
}

/** 读整本手册（类目按 sortnum 再按 id 排序） */
export function readBook(root: string, namespace: string, bookId: string): PatchouliBook {
  const dir = bookDir(root, namespace, bookId)
  const bookJsonPath = join(dir, 'book.json')
  if (!existsSync(bookJsonPath)) throw new Error(`手册不存在：${namespace}/${bookId}`)
  const doc = readJson(bookJsonPath)
  const catDir = join(dir, 'en_us', 'categories')
  const categories: PatchouliCategory[] = []
  if (existsSync(catDir)) {
    for (const name of readdirSync(catDir)) {
      if (!name.endsWith('.json')) continue
      categories.push(readCategory(dir, name.slice(0, -'.json'.length)))
    }
  }
  categories.sort((a, b) => a.sortnum - b.sortnum || a.id.localeCompare(b.id))
  return {
    namespace,
    bookId,
    name: typeof doc.name === 'string' ? doc.name : bookId,
    landingText: typeof doc.landing_text === 'string' ? doc.landing_text : '',
    version: typeof doc.version === 'number' ? doc.version : 1,
    creativeTab: typeof doc.creative_tab === 'string' ? doc.creative_tab : 'misc',
    categories
  }
}

/** 扫描 config/*​/patchouli_books/*​/book.json 列表；损坏文件进 warnings */
export function listBooks(root: string): PatchouliListResult {
  assertWithinRoot(root)
  const result: PatchouliListResult = { books: [], defaultNamespace: defaultNamespace(root), warnings: [] }
  const configDir = join(root, 'config')
  if (!existsSync(configDir)) return result
  for (const ns of readdirSync(configDir)) {
    const booksRoot = join(configDir, ns, 'patchouli_books')
    if (!existsSync(booksRoot)) continue
    for (const bookId of readdirSync(booksRoot)) {
      try {
        const book = readBook(root, ns, bookId)
        const summary: PatchouliBookSummary = {
          namespace: ns,
          bookId,
          name: book.name,
          categoryCount: book.categories.length,
          entryCount: book.categories.reduce((n, c) => n + c.entries.length, 0)
        }
        result.books.push(summary)
      } catch (err) {
        result.warnings.push(`${ns}/${bookId}：${(err as Error).message}`)
      }
    }
  }
  result.books.sort((a, b) => a.namespace.localeCompare(b.namespace) || a.bookId.localeCompare(b.bookId))
  return result
}

/* ------------------------------ 写入（同步语义） ------------------------------ */

function syncDir(dir: string, keepFiles: Set<string>): void {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.json') && !keepFiles.has(name)) rmSync(join(dir, name), { force: true })
  }
}

/**
 * 保存手册：写 book.json + 全部类目/条目；移除本手册目录下不再存在的类目/条目文件；
 * prev 提供且与新位置不同时删除旧手册目录（重命名/迁移命名空间语义）。
 */
export function saveBook(
  root: string,
  book: PatchouliBook,
  prev?: { namespace: string; bookId: string }
): void {
  const dir = bookDir(root, book.namespace, book.bookId)
  const catDir = join(dir, 'en_us', 'categories')
  const entriesRoot = join(dir, 'en_us', 'entries')
  mkdirSync(catDir, { recursive: true })
  mkdirSync(entriesRoot, { recursive: true })

  writeJson(join(dir, 'book.json'), {
    name: book.name,
    landing_text: book.landingText,
    version: book.version,
    creative_tab: book.creativeTab
  })

  const keepCats = new Set<string>()
  const keepCatDirs = new Set<string>()
  for (const cat of book.categories) {
    if (!validateContentId(cat.id)) throw new Error(`类目 id 不合法：${cat.id}`)
    keepCats.add(`${cat.id}.json`)
    keepCatDirs.add(cat.id)
    writeJson(join(catDir, `${cat.id}.json`), {
      name: cat.name,
      description: cat.description,
      icon: cat.icon,
      sortnum: cat.sortnum
    })
    const catEntriesDir = join(entriesRoot, cat.id)
    mkdirSync(catEntriesDir, { recursive: true })
    const keepEntries = new Set<string>()
    for (const entry of cat.entries) {
      if (!validateContentId(entry.id)) throw new Error(`条目 id 不合法：${entry.id}`)
      keepEntries.add(`${entry.id}.json`)
      writeJson(join(catEntriesDir, `${entry.id}.json`), {
        name: entry.name,
        icon: entry.icon,
        category: cat.id,
        pages: entry.pages.map(pageToJson)
      })
    }
    syncDir(catEntriesDir, keepEntries)
  }
  syncDir(catDir, keepCats)
  // 移除已删除类目的 entries 子目录
  if (existsSync(entriesRoot)) {
    for (const name of readdirSync(entriesRoot)) {
      if (!keepCatDirs.has(name)) rmSync(join(entriesRoot, name), { recursive: true, force: true })
    }
  }

  if (prev && (prev.namespace !== book.namespace || prev.bookId !== book.bookId)) {
    rmSync(bookDir(root, prev.namespace, prev.bookId), { recursive: true, force: true })
  }
}

/** 删除整本手册目录（不存在时静默成功） */
export function deleteBook(root: string, namespace: string, bookId: string): void {
  rmSync(bookDir(root, namespace, bookId), { recursive: true, force: true })
}
