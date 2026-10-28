/**
 * ftbTools 单测：章节列表/读取/整章写入往返、入参校验与项目门控。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-ftb-tool-test-'))
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

import { builtinFtbTools } from '../fcTools/ftbTools'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'
import type { ToolExecContext, ToolRegistryDeps } from '../toolRegistry'

const CTX: ToolExecContext = { loader: 'fabric', mcVersion: '1.20.1' }

const CHAPTER = {
  id: 'getting_started',
  title: '入门',
  icon: 'minecraft:book',
  quests: [
    {
      id: 'chop_tree',
      title: '砍树',
      item: 'minecraft:oak_log',
      description: ['用拳头砍一棵树'],
      reward: { item: 'minecraft:bread', count: 4 }
    },
    { id: 'make_pickaxe', title: '做镐', item: 'minecraft:wooden_pickaxe', dependencies: ['chop_tree'] }
  ]
}

let root: string
let deps: ToolRegistryDeps

function tool(name: string) {
  return builtinFtbTools(deps).find((t) => t.def.function.name === name)!
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-ftb-proj-'))
  registerProjectRoot(root)
  deps = { projectRoot: () => root }
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('ftbTools', () => {
  it('项目未打开时拒绝', async () => {
    deps.projectRoot = () => null
    const r = await tool('ftb_list_chapters').execute({}, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('没有打开的项目')
  })

  it('空项目列表为零章节', async () => {
    const r = await tool('ftb_list_chapters').execute({}, CTX)
    expect(r.ok).toBe(true)
    expect(r.text).toContain('还没有章节')
  })

  it('ftb_save_chapter → ftb_read_chapter 往返；列表收编', async () => {
    const saved = await tool('ftb_save_chapter').execute({ chapter: CHAPTER }, CTX)
    expect(saved.ok).toBe(true)
    expect(saved.text).toContain('2 个任务')

    const read = await tool('ftb_read_chapter').execute({ id: 'getting_started' }, CTX)
    expect(read.ok).toBe(true)
    expect(read.text).toContain('chop_tree')
    expect(read.text).toContain('minecraft:bread')

    const list = await tool('ftb_list_chapters').execute({}, CTX)
    expect(list.text).toContain('getting_started')
    expect(list.text).toContain('2 个任务')
  })

  it('prevId 提供时重命名删除旧章节', async () => {
    await tool('ftb_save_chapter').execute({ chapter: CHAPTER }, CTX)
    const renamed = await tool('ftb_save_chapter').execute(
      { chapter: { ...CHAPTER, id: 'chapter_one' }, prevId: 'getting_started' },
      CTX
    )
    expect(renamed.ok).toBe(true)
    const gone = await tool('ftb_read_chapter').execute({ id: 'getting_started' }, CTX)
    expect(gone.ok).toBe(false)
    expect(gone.error).toContain('不存在')
  })

  it('入参校验：缺 quests / 非法 id / 任务缺字段', async () => {
    const noQuests = await tool('ftb_save_chapter').execute({ chapter: { id: 'a', title: 'A' } }, CTX)
    expect(noQuests.ok).toBe(false)
    expect(noQuests.error).toContain('quests')
    const badId = await tool('ftb_save_chapter').execute(
      { chapter: { id: 'BAD ID', title: 'A', quests: [] } },
      CTX
    )
    expect(badId.ok).toBe(false)
    expect(badId.error).toContain('不合法')
    const badQuest = await tool('ftb_save_chapter').execute(
      { chapter: { id: 'a', title: 'A', quests: [{ id: 'q1' }] } },
      CTX
    )
    expect(badQuest.ok).toBe(false)
    expect(badQuest.error).toContain('quests[0]')
  })

  it('ftb_read_chapter 读不存在章节软失败', async () => {
    const r = await tool('ftb_read_chapter').execute({ id: 'nope' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不存在')
  })
})
