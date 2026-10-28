/**
 * patchouliService 单测：book.json/类目/条目读写、同步语义保存、与生成器格式对齐、守卫。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-pb-test-'))
  return {
    app: {
      getPath: () => dir,
      isPackaged: false,
      getVersion: () => '0.0.0-test'
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (b: Buffer) => b,
      decryptString: (b: Buffer) => b
    }
  }
})

import {
  deleteBook,
  listBooks,
  readBook,
  saveBook
} from '../patchouliService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import {
  buildPatchouliBookJson,
  buildPatchouliCategory,
  buildPatchouliEntry
} from '../modpack/companionContent'
import type { PatchouliBook } from '../../../shared/types/patchouli'

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'kunyu-pb-proj-'))
  registerProjectRoot(projectRoot)
})

afterEach(() => {
  unregisterProjectRoot(projectRoot)
  rmSync(projectRoot, { recursive: true, force: true })
})

const SAMPLE: PatchouliBook = {
  namespace: 'testmod',
  bookId: 'guide',
  name: '测试指南',
  landingText: '欢迎来到测试指南。',
  version: 1,
  creativeTab: 'misc',
  categories: [
    {
      id: 'basics',
      name: '基础',
      description: '基础内容',
      icon: 'minecraft:book',
      sortnum: 0,
      entries: [
        {
          id: 'first',
          name: '第一步',
          icon: 'minecraft:oak_log',
          pages: [
            { type: 'text', text: '第一页文本。' },
            { type: 'crafting', recipe: 'minecraft:wooden_pickaxe', text: '做一把镐。' },
            { type: 'image', images: ['testmod:textures/gui/pic.png'], title: '示意图' },
            { type: 'spotlight', item: 'minecraft:diamond', text: '聚焦一颗钻石。' }
          ]
        }
      ]
    }
  ]
}

describe('saveBook ↔ readBook 往返', () => {
  it('四种页面类型全量往返一致', () => {
    saveBook(projectRoot, SAMPLE)
    expect(readBook(projectRoot, 'testmod', 'guide')).toEqual(SAMPLE)
  })

  it('落盘 JSON 与生成器格式对齐（2 空格缩进 + 尾部换行）', () => {
    saveBook(projectRoot, SAMPLE)
    const text = readFileSync(
      join(projectRoot, 'config', 'testmod', 'patchouli_books', 'guide', 'book.json'),
      'utf-8'
    )
    expect(text).toBe(JSON.stringify(
      { name: '测试指南', landing_text: '欢迎来到测试指南。', version: 1, creative_tab: 'misc' },
      null,
      2
    ) + '\n')
  })

  it('读取生成器产物：buildPatchouli* 输出可直接读入', () => {
    const base = join(projectRoot, 'config', 'genmod', 'patchouli_books', 'handbook')
    mkdirSync(join(base, 'en_us', 'categories'), { recursive: true })
    mkdirSync(join(base, 'en_us', 'entries', 'start'), { recursive: true })
    writeFileSync(
      join(base, 'book.json'),
      buildPatchouliBookJson({ modId: 'genmod', bookId: 'handbook', name: '手册', categories: [] })
    )
    writeFileSync(
      join(base, 'en_us', 'categories', 'start.json'),
      buildPatchouliCategory({ id: 'start', name: '起步', description: '起步', icon: 'minecraft:map', entries: [] })
    )
    writeFileSync(
      join(base, 'en_us', 'entries', 'start', 'hello.json'),
      buildPatchouliEntry({ id: 'hello', name: '你好', icon: 'minecraft:apple', pages: ['第一页', '第二页'] }, 'start')
    )
    const book = readBook(projectRoot, 'genmod', 'handbook')
    expect(book.name).toBe('手册')
    expect(book.categories[0].entries[0].pages).toEqual([
      { type: 'text', text: '第一页' },
      { type: 'text', text: '第二页' }
    ])
  })
})

describe('同步语义保存', () => {
  it('删除类目后其 categories 文件与 entries 子目录被移除', () => {
    saveBook(projectRoot, {
      ...SAMPLE,
      categories: [
        SAMPLE.categories[0],
        { id: 'extra', name: '额外', description: '', icon: 'minecraft:stone', sortnum: 1, entries: [] }
      ]
    })
    saveBook(projectRoot, SAMPLE)
    const base = join(projectRoot, 'config', 'testmod', 'patchouli_books', 'guide')
    expect(existsSync(join(base, 'en_us', 'categories', 'extra.json'))).toBe(false)
    expect(existsSync(join(base, 'en_us', 'entries', 'extra'))).toBe(false)
    expect(readBook(projectRoot, 'testmod', 'guide').categories.map((c) => c.id)).toEqual(['basics'])
  })

  it('删除条目后其文件被移除', () => {
    saveBook(projectRoot, {
      ...SAMPLE,
      categories: [
        {
          ...SAMPLE.categories[0],
          entries: [
            SAMPLE.categories[0].entries[0],
            { id: 'second', name: '第二步', icon: 'minecraft:stone', pages: [{ type: 'text', text: 'x' }] }
          ]
        }
      ]
    })
    saveBook(projectRoot, SAMPLE)
    expect(
      existsSync(
        join(projectRoot, 'config', 'testmod', 'patchouli_books', 'guide', 'en_us', 'entries', 'basics', 'second.json')
      )
    ).toBe(false)
  })

  it('重命名：prev 旧目录被删除', () => {
    saveBook(projectRoot, SAMPLE)
    saveBook(projectRoot, { ...SAMPLE, bookId: 'guidebook' }, { namespace: 'testmod', bookId: 'guide' })
    expect(existsSync(join(projectRoot, 'config', 'testmod', 'patchouli_books', 'guide'))).toBe(false)
    expect(readBook(projectRoot, 'testmod', 'guidebook').name).toBe('测试指南')
  })
})

describe('listBooks 与守卫', () => {
  it('空项目：空列表，默认命名空间为空串', () => {
    const res = listBooks(projectRoot)
    expect(res.books).toEqual([])
    expect(res.defaultNamespace).toBe('')
  })

  it('模组项目：默认命名空间为 modId', () => {
    const res = join(projectRoot, 'src', 'main', 'resources')
    mkdirSync(res, { recursive: true })
    writeFileSync(join(res, 'fabric.mod.json'), JSON.stringify({ id: 'mymod', entrypoints: {} }))
    expect(listBooks(projectRoot).defaultNamespace).toBe('mymod')
  })

  it('列表摘要含类目/条目计数；损坏手册进 warnings', () => {
    saveBook(projectRoot, SAMPLE)
    const broken = join(projectRoot, 'config', 'bad', 'patchouli_books', 'oops')
    mkdirSync(broken, { recursive: true })
    writeFileSync(join(broken, 'book.json'), '{ 不是合法 JSON')
    const res = listBooks(projectRoot)
    expect(res.books).toEqual([
      { namespace: 'testmod', bookId: 'guide', name: '测试指南', categoryCount: 1, entryCount: 1 }
    ])
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('bad/oops')
  })

  it('id 校验：非法命名空间/手册/类目/条目 id 拒绝', () => {
    expect(() => saveBook(projectRoot, { ...SAMPLE, namespace: '../x' })).toThrow()
    expect(() => readBook(projectRoot, 'testmod', '../../etc')).toThrow()
    expect(() =>
      saveBook(projectRoot, {
        ...SAMPLE,
        categories: [{ ...SAMPLE.categories[0], id: 'BAD ID' }]
      })
    ).toThrow()
  })

  it('根守卫：未注册的项目根拒绝访问', () => {
    const outsider = mkdtempSync(join(tmpdir(), 'kunyu-pb-outside-'))
    try {
      expect(() => listBooks(outsider)).toThrow()
    } finally {
      rmSync(outsider, { recursive: true, force: true })
    }
  })

  it('deleteBook 移除整个目录；不存在时静默', () => {
    saveBook(projectRoot, SAMPLE)
    deleteBook(projectRoot, 'testmod', 'guide')
    expect(existsSync(join(projectRoot, 'config', 'testmod', 'patchouli_books', 'guide'))).toBe(false)
    deleteBook(projectRoot, 'testmod', 'guide')
  })
})
