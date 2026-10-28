/**
 * patchouliTools 单测：手册列表/读取/整本写入往返、入参校验与项目门控。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-pat-tool-test-'))
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

import { builtinPatchouliTools } from '../fcTools/patchouliTools'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'
import type { ToolExecContext, ToolRegistryDeps } from '../toolRegistry'

const CTX: ToolExecContext = { loader: 'fabric', mcVersion: '1.20.1' }

const BOOK = {
  namespace: 'testmod',
  bookId: 'guide',
  name: '指南',
  landingText: '欢迎',
  categories: [
    {
      id: 'basics',
      name: '基础',
      description: '入门类目',
      entries: [
        { id: 'intro', name: '介绍', pages: [{ type: 'text', text: '第一页' }] },
        { id: 'craft', name: '合成', pages: [{ type: 'crafting', recipe: 'minecraft:stick' }] }
      ]
    }
  ]
}

let root: string
let deps: ToolRegistryDeps

function tool(name: string) {
  return builtinPatchouliTools(deps).find((t) => t.def.function.name === name)!
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-pat-proj-'))
  registerProjectRoot(root)
  deps = { projectRoot: () => root }
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('patchouliTools', () => {
  it('项目未打开时拒绝', async () => {
    deps.projectRoot = () => null
    const r = await tool('patchouli_list_books').execute({}, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('没有打开的项目')
  })

  it('patchouli_save_book → patchouli_read_book 往返；列表收编', async () => {
    const saved = await tool('patchouli_save_book').execute({ book: BOOK }, CTX)
    expect(saved.ok).toBe(true)
    expect(saved.text).toContain('testmod/guide')
    expect(saved.text).toContain('1 类目 / 2 条目')

    const read = await tool('patchouli_read_book').execute({ namespace: 'testmod', bookId: 'guide' }, CTX)
    expect(read.ok).toBe(true)
    expect(read.text).toContain('第一页')
    expect(read.text).toContain('minecraft:stick')

    const list = await tool('patchouli_list_books').execute({}, CTX)
    expect(list.text).toContain('testmod/guide')
    expect(list.text).toContain('指南')
  })

  it('同步语义：再次保存时移除已删条目', async () => {
    await tool('patchouli_save_book').execute({ book: BOOK }, CTX)
    const slim = {
      ...BOOK,
      categories: [{ ...BOOK.categories[0], entries: [BOOK.categories[0].entries[0]] }]
    }
    const saved = await tool('patchouli_save_book').execute({ book: slim }, CTX)
    expect(saved.ok).toBe(true)
    const read = await tool('patchouli_read_book').execute({ namespace: 'testmod', bookId: 'guide' }, CTX)
    expect(read.text).not.toContain('"id": "craft"')
  })

  it('prev 提供时迁移旧目录', async () => {
    await tool('patchouli_save_book').execute({ book: BOOK }, CTX)
    const moved = await tool('patchouli_save_book').execute(
      { book: { ...BOOK, bookId: 'handbook' }, prev: { namespace: 'testmod', bookId: 'guide' } },
      CTX
    )
    expect(moved.ok).toBe(true)
    const gone = await tool('patchouli_read_book').execute({ namespace: 'testmod', bookId: 'guide' }, CTX)
    expect(gone.ok).toBe(false)
    expect(gone.error).toContain('不存在')
  })

  it('入参校验：缺必填 / 非法类目 id', async () => {
    const missing = await tool('patchouli_save_book').execute({ book: { namespace: 'testmod' } }, CTX)
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('namespace/bookId/name')
    const badCat = await tool('patchouli_save_book').execute(
      { book: { ...BOOK, categories: [{ id: 'BAD ID', name: 'X' }] } },
      CTX
    )
    expect(badCat.ok).toBe(false)
    expect(badCat.error).toContain('不合法')
  })

  it('patchouli_read_book 读不存在手册软失败', async () => {
    const r = await tool('patchouli_read_book').execute({ namespace: 'testmod', bookId: 'nope' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不存在')
  })
})
