/**
 * Patchouli 手册 FC 工具（patchouliService 的 AI 封装）。
 *
 * - patchouli_list_books / patchouli_read_book：只读浏览 config/<ns>/patchouli_books/<book>/；
 * - patchouli_save_book：整本手册同步写入（book.json + 类目/条目 JSON，目录下不再存在的
 *   类目/条目文件会被移除；prev 提供重命名/迁移命名空间语义）。
 * 页面类型支持 text/crafting/image/spotlight 四种；id 合法性与根守卫由服务层负责，
 * 工具侧捕获后软失败。
 */
import type { PatchouliBook, PatchouliCategory, PatchouliEntry, PatchouliPage } from '../../../../shared/types/patchouli'
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'
import { listBooks, readBook, saveBook } from '../../patchouliService'

const CLIP = 8000
function clip(text: string): string {
  return text.length <= CLIP ? text : `${text.slice(0, CLIP)}…（已截断）`
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function asNumber(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function asPage(raw: unknown): PatchouliPage {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const text = asString(o['text'])
  switch (o['type']) {
    case 'crafting':
      return { type: 'crafting', recipe: asString(o['recipe']), ...(text ? { text } : {}) }
    case 'image':
      return {
        type: 'image',
        images: Array.isArray(o['images']) ? o['images'].filter((x): x is string => typeof x === 'string') : [],
        ...(asString(o['title']) ? { title: asString(o['title']) } : {})
      }
    case 'spotlight':
      return { type: 'spotlight', item: asString(o['item']), ...(text ? { text } : {}) }
    default:
      return { type: 'text', text }
  }
}

/** 入参 → 结构化手册（轻量结构校验；id 合法性由服务层 validateContentId 把关） */
function asBook(raw: unknown): { book?: PatchouliBook; error?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'book 必须是对象' }
  const o = raw as Record<string, unknown>
  const namespace = asString(o['namespace']).trim()
  const bookId = asString(o['bookId']).trim()
  const name = asString(o['name']).trim()
  if (!namespace || !bookId || !name) return { error: 'book 需要 namespace/bookId/name' }
  const rawCats = o['categories']
  if (!Array.isArray(rawCats)) return { error: 'book.categories 必须是数组（可为空）' }
  const categories: PatchouliCategory[] = []
  for (let i = 0; i < rawCats.length; i++) {
    const c = rawCats[i] as Record<string, unknown> | null
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { error: `categories[${i}] 必须是对象` }
    const catId = asString(c['id']).trim()
    const catName = asString(c['name']).trim()
    if (!catId || !catName) return { error: `categories[${i}] 需要 id/name` }
    const rawEntries = Array.isArray(c['entries']) ? c['entries'] : []
    const entries: PatchouliEntry[] = []
    for (let j = 0; j < rawEntries.length; j++) {
      const e = rawEntries[j] as Record<string, unknown> | null
      if (!e || typeof e !== 'object' || Array.isArray(e)) return { error: `categories[${i}].entries[${j}] 必须是对象` }
      const entryId = asString(e['id']).trim()
      const entryName = asString(e['name']).trim()
      if (!entryId || !entryName) return { error: `categories[${i}].entries[${j}] 需要 id/name` }
      entries.push({
        id: entryId,
        name: entryName,
        icon: asString(e['icon']).trim() || 'minecraft:book',
        pages: Array.isArray(e['pages']) ? (e['pages'] as unknown[]).map(asPage) : []
      })
    }
    categories.push({
      id: catId,
      name: catName,
      description: asString(c['description']),
      icon: asString(c['icon']).trim() || 'minecraft:book',
      sortnum: asNumber(c['sortnum'], 0),
      entries
    })
  }
  return {
    book: {
      namespace,
      bookId,
      name,
      landingText: asString(o['landingText']),
      version: asNumber(o['version'], 1),
      creativeTab: asString(o['creativeTab']).trim() || 'misc',
      categories
    }
  }
}

export function builtinPatchouliTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  /* patchouli_list_books */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'patchouli_list_books',
        description:
          '列出当前项目全部 Patchouli 手册（命名空间/书 id/书名/类目数/条目数），附默认命名空间；' +
          '损坏文件列入警告。写手册前先调用避免重名覆盖。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    visibility: 'project',
    execute: () => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      try {
        const r = listBooks(root)
        const lines = r.books.map(
          (b) => `- ${b.namespace}/${b.bookId}「${b.name}」（${b.categoryCount} 类目 / ${b.entryCount} 条目）`
        )
        const warn = r.warnings.length ? `\n解析警告：\n${r.warnings.map((w) => `- ⚠️ ${w}`).join('\n')}` : ''
        const ns = r.defaultNamespace ? `默认命名空间：${r.defaultNamespace}。` : ''
        const text = r.books.length
          ? `${ns}共 ${r.books.length} 本手册：\n${lines.join('\n')}${warn}`
          : `${ns}还没有 Patchouli 手册。`
        return { ok: true, text: clip(text), data: r }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  /* patchouli_read_book */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'patchouli_read_book',
        description: '读取整本手册完整 JSON（book.json + 类目树 + 各条目 pages）。',
        parameters: {
          type: 'object',
          properties: {
            namespace: { type: 'string', description: '宿主命名空间（config/<namespace>/ 目录名）' },
            bookId: { type: 'string', description: '书 id（目录名）' }
          },
          required: ['namespace', 'bookId']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const namespace = asString(args['namespace']).trim()
      const bookId = asString(args['bookId']).trim()
      if (!namespace || !bookId) return { ok: false, text: '', error: '缺少 namespace / bookId 参数' }
      try {
        const book = readBook(root, namespace, bookId)
        return { ok: true, text: clip(JSON.stringify(book, null, 2)), data: book }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  /* patchouli_save_book */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'patchouli_save_book',
        description:
          '整本写入 Patchouli 手册（新建或同名覆盖，同步语义：目录下不再存在的类目/条目文件会被移除）。' +
          '页面类型仅支持 text/crafting/image/spotlight。',
        parameters: {
          type: 'object',
          properties: {
            book: {
              type: 'object',
              description:
                '手册对象：{ namespace, bookId, name, landingText?, version?, creativeTab?, ' +
                'categories: [{ id, name, description?, icon?, sortnum?, entries: [{ id, name, icon?, pages: [...] }] }] }'
            },
            prev: {
              type: 'object',
              description: '重命名/迁移时的旧位置 { namespace, bookId }（可选，提供则删除旧目录）'
            }
          },
          required: ['book']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const parsed = asBook(args['book'])
      if (!parsed.book) return { ok: false, text: '', error: parsed.error }
      const rawPrev = args['prev']
      let prev: { namespace: string; bookId: string } | undefined
      if (rawPrev && typeof rawPrev === 'object' && !Array.isArray(rawPrev)) {
        const p = rawPrev as Record<string, unknown>
        const pNs = asString(p['namespace']).trim()
        const pId = asString(p['bookId']).trim()
        if (pNs && pId) prev = { namespace: pNs, bookId: pId }
      }
      try {
        saveBook(root, parsed.book, prev)
        const b = parsed.book
        const entryCount = b.categories.reduce((n, c) => n + c.entries.length, 0)
        return {
          ok: true,
          text: `已保存手册 ${b.namespace}/${b.bookId}「${b.name}」（${b.categories.length} 类目 / ${entryCount} 条目）`,
          data: { namespace: b.namespace, bookId: b.bookId, categoryCount: b.categories.length, entryCount }
        }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  return tools
}
