/**
 * ftbQuestService 单测：SNBT 解析器与 buildFtbQuestChapter 互逆 + 章节 CRUD + 根守卫。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kunyu-ftb-test-'))
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
  deleteChapter,
  listChapters,
  parseFtbChapter,
  readChapter,
  saveChapter
} from '../ftbQuestService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { buildFtbQuestChapter } from '../modpack/companionContent'
import type { FtbQuestChapter } from '../../../shared/types/ftbquest'

let projectRoot: string

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'kunyu-ftb-proj-'))
  registerProjectRoot(projectRoot)
})

afterEach(() => {
  unregisterProjectRoot(projectRoot)
  rmSync(projectRoot, { recursive: true, force: true })
})

const SAMPLE: FtbQuestChapter = {
  id: 'getting_started',
  title: '入门',
  icon: 'minecraft:book',
  quests: [
    {
      id: 'chop_tree',
      title: '砍树',
      description: ['用拳头砍一棵树', '含"引号"与\\反斜杠'],
      dependencies: [],
      item: 'minecraft:oak_log',
      reward: { item: 'minecraft:bread', count: 4 }
    },
    {
      id: 'make_pickaxe',
      title: '做镐',
      description: [],
      dependencies: ['chop_tree'],
      item: 'minecraft:wooden_pickaxe'
    }
  ]
}

describe('parseFtbChapter ↔ buildFtbQuestChapter 互逆', () => {
  it('生成 → 解析 → 结构与原文一致（含转义与依赖）', () => {
    const text = buildFtbQuestChapter({
      chapterId: SAMPLE.id,
      title: SAMPLE.title,
      icon: SAMPLE.icon,
      quests: SAMPLE.quests
    })
    expect(parseFtbChapter(text)).toEqual(SAMPLE)
  })

  it('解析 → 保存 → 再解析：二次往返稳定', () => {
    const text = buildFtbQuestChapter({
      chapterId: SAMPLE.id,
      title: SAMPLE.title,
      icon: SAMPLE.icon,
      quests: SAMPLE.quests
    })
    saveChapter(projectRoot, parseFtbChapter(text))
    const again = readChapter(projectRoot, SAMPLE.id)
    expect(again).toEqual(SAMPLE)
  })

  it('宽容解析：未知键（x/y/shape）与数字坐标忽略', () => {
    const text = [
      '{',
      '\tid: "real_world"',
      '\ttitle: "真实章节"',
      '\ticon: "minecraft:apple"',
      '\tquests: [{',
      '\t\tid: "q1"',
      '\t\ttitle: "任务一"',
      '\t\tx: 1.5',
      '\t\ty: -2',
      '\t\tshape: "circle"',
      '\t\ttasks: [{',
      '\t\t\ttype: "item"',
      '\t\t\titem: "minecraft:stone"',
      '\t\t\tcount: 3',
      '\t\t}]',
      '\t}]',
      '}'
    ].join('\n')
    const ch = parseFtbChapter(text)
    expect(ch.id).toBe('real_world')
    expect(ch.quests).toHaveLength(1)
    expect(ch.quests[0].item).toBe('minecraft:stone')
    expect(ch.quests[0].dependencies).toEqual([])
  })

  it('语法错误抛错（不静默吞掉手写损坏文件）', () => {
    expect(() => parseFtbChapter('{ id: "unclosed')).toThrow()
  })
})

describe('章节 CRUD', () => {
  it('空项目：列表为空且无警告', () => {
    const res = listChapters(projectRoot)
    expect(res.chapters).toEqual([])
    expect(res.warnings).toEqual([])
  })

  it('保存 → 列表 → 读取 → 删除 全链路', () => {
    saveChapter(projectRoot, SAMPLE)
    const res = listChapters(projectRoot)
    expect(res.chapters).toEqual([
      { id: 'getting_started', title: '入门', icon: 'minecraft:book', questCount: 2 }
    ])
    expect(readChapter(projectRoot, 'getting_started')).toEqual(SAMPLE)

    deleteChapter(projectRoot, 'getting_started')
    expect(listChapters(projectRoot).chapters).toEqual([])
    // 再删一次静默成功
    deleteChapter(projectRoot, 'getting_started')
  })

  it('重命名：prevId 旧文件被删除', () => {
    saveChapter(projectRoot, SAMPLE)
    saveChapter(projectRoot, { ...SAMPLE, id: 'renamed' }, 'getting_started')
    const res = listChapters(projectRoot)
    expect(res.chapters.map((c) => c.id)).toEqual(['renamed'])
    expect(
      existsSync(
        join(projectRoot, 'config', 'ftbquests', 'quests', 'chapters', 'getting_started.snbt')
      )
    ).toBe(false)
  })

  it('列表容忍损坏文件：正常章节照出，损坏文件进 warnings', () => {
    const dir = join(projectRoot, 'config', 'ftbquests', 'quests', 'chapters')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'good.snbt'), buildFtbQuestChapter({ chapterId: 'good', title: '好', quests: [] }))
    writeFileSync(join(dir, 'bad.snbt'), '{ id: "unclosed')
    const res = listChapters(projectRoot)
    expect(res.chapters.map((c) => c.id)).toEqual(['good'])
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('bad.snbt')
  })

  it('id 校验：非法 id 拒绝（防路径穿越）', () => {
    expect(() => saveChapter(projectRoot, { ...SAMPLE, id: '../evil' })).toThrow()
    expect(() => readChapter(projectRoot, '../../etc')).toThrow()
  })

  it('根守卫：未注册的项目根拒绝访问', () => {
    const outsider = mkdtempSync(join(tmpdir(), 'kunyu-ftb-outside-'))
    try {
      expect(() => listChapters(outsider)).toThrow()
    } finally {
      rmSync(outsider, { recursive: true, force: true })
    }
  })

  it('保存内容可读：磁盘文件含 tab 缩进与无引号键', () => {
    saveChapter(projectRoot, SAMPLE)
    const text = readFileSync(
      join(projectRoot, 'config', 'ftbquests', 'quests', 'chapters', 'getting_started.snbt'),
      'utf-8'
    )
    expect(text).toContain('\tid: "getting_started"')
    expect(text).toContain('dependencies: [')
    expect(text.endsWith('\n')).toBe(true)
  })
})
