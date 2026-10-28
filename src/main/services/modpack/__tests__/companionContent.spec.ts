/**
 * companionContent 单测（P3-3）：FTB Quests / Patchouli / 键位 / 优化 profile 生成。
 * 纯函数验证：文件路径、内容结构、SNBT/JSON 合法性。
 */
import { describe, expect, it } from 'vitest'
import {
  buildFtbQuestChapter,
  buildKeybindSnippet,
  buildOptimizationProfile,
  buildPatchouliBookJson,
  buildPatchouliCategory,
  buildPatchouliEntry,
  genFtbQuestChapter,
  genKeybindSnippet,
  genOptimizationProfile,
  genPatchouliBook
} from '../companionContent'

describe('FTB Quests SNBT', () => {
  it('章节结构：id/title/icon/quests 数组齐全', () => {
    const out = buildFtbQuestChapter({
      chapterId: 'getting_started',
      title: '入门',
      quests: [
        { id: 'q1', title: '砍树', item: 'minecraft:oak_log', reward: { item: 'minecraft:bread', count: 4 } },
        { id: 'q2', title: '做镐', description: ['用木头做一把镐'], item: 'minecraft:wooden_pickaxe' }
      ]
    })
    expect(out).toContain('id: "getting_started"')
    expect(out).toContain('title: "入门"')
    expect(out).toContain('icon: "minecraft:book"')
    expect(out).toContain('id: "q1"')
    expect(out).toContain('title: "砍树"')
    expect(out).toContain('item: "minecraft:oak_log"')
    expect(out).toContain('count: 4')
    expect(out).toContain('description: [')
    expect(out).toContain('"用木头做一把镐"')
    // 第二个任务无 reward 段
    const q2Block = out.slice(out.indexOf('id: "q2"'))
    expect(q2Block).not.toContain('rewards:')
  })

  it('字符串转义：内部双引号与反斜杠', () => {
    const out = buildFtbQuestChapter({
      chapterId: 'esc',
      title: '含"引号"的章节',
      quests: []
    })
    expect(out).toContain('title: "含\\"引号\\"的章节"')
  })

  it('genFtbQuestChapter 路径：config/ftbquests/quests/chapters/<id>.snbt', () => {
    const r = genFtbQuestChapter({ chapterId: 'main', title: '主线', quests: [] })
    expect([...r.files.keys()]).toEqual(['config/ftbquests/quests/chapters/main.snbt'])
    expect(r.summary[0]).toContain('main')
  })
})

describe('Patchouli', () => {
  const book = {
    modId: 'kunyu',
    bookId: 'guide',
    name: '导引手册',
    categories: [
      {
        id: 'basics',
        name: '基础',
        description: '基础玩法',
        icon: 'minecraft:grass_block',
        entries: [
          { id: 'start', name: '开局', icon: 'minecraft:stick', pages: ['第一页正文', '第二页正文'] }
        ]
      }
    ]
  }

  it('book.json：name/landing_text/version', () => {
    const doc = JSON.parse(buildPatchouliBookJson(book)) as Record<string, unknown>
    expect(doc['name']).toBe('导引手册')
    expect(doc['landing_text']).toContain('导引手册')
    expect(doc['version']).toBe(1)
  })

  it('category JSON：name/description/icon/sortnum', () => {
    const doc = JSON.parse(buildPatchouliCategory(book.categories[0]!)) as Record<string, unknown>
    expect(doc['name']).toBe('基础')
    expect(doc['icon']).toBe('minecraft:grass_block')
  })

  it('entry JSON：category 关联 + text 页数组', () => {
    const doc = JSON.parse(buildPatchouliEntry(book.categories[0]!.entries[0]!, 'basics')) as { category: string; pages: Array<{ type: string; text: string }> }
    expect(doc.category).toBe('basics')
    expect(doc.pages).toHaveLength(2)
    expect(doc.pages[0]).toEqual({ type: 'text', text: '第一页正文' })
  })

  it('genPatchouliBook：book.json + 类目 + 条目全部落位', () => {
    const r = genPatchouliBook(book)
    const keys = [...r.files.keys()].sort()
    expect(keys).toEqual([
      'config/kunyu/patchouli_books/guide/book.json',
      'config/kunyu/patchouli_books/guide/en_us/categories/basics.json',
      'config/kunyu/patchouli_books/guide/en_us/entries/basics/start.json'
    ])
    expect(r.summary[0]).toContain('guide')
    expect(r.summary[0]).toContain('1 类目 / 1 条目')
  })
})

describe('键位片段', () => {
  it('key_ 行格式 + 注释头', () => {
    const out = buildKeybindSnippet({
      modId: 'kunyu',
      binds: [
        { name: 'open_gui', key: 'key.keyboard.g', comment: '打开主界面' },
        { name: 'toggle_mode', key: 'key.keyboard.unknown' }
      ]
    })
    expect(out).toContain('# kunyu 键位默认配置')
    expect(out).toContain('# 打开主界面')
    expect(out).toContain('key_key.kunyu.open_gui:key.keyboard.g')
    expect(out).toContain('key_key.kunyu.toggle_mode:key.keyboard.unknown')
  })

  it('genKeybindSnippet 路径', () => {
    const r = genKeybindSnippet({ modId: 'kunyu', binds: [{ name: 'x', key: 'key.keyboard.x' }] })
    expect([...r.files.keys()]).toEqual(['config/kunyu-keybinds.txt'])
  })
})

describe('优化 profile', () => {
  it('performance 档：fast 画质 + 低视距 + 关阴影', () => {
    const out = buildOptimizationProfile({ fileName: 'sodium.properties', tier: 'performance' })
    expect(out).toContain('graphics=fast')
    expect(out).toContain('renderDistance=6')
    expect(out).toContain('entityShadows=false')
  })

  it('balanced 档：fancy + 10 区块', () => {
    const out = buildOptimizationProfile({ fileName: 'sodium.properties', tier: 'balanced' })
    expect(out).toContain('graphics=fancy')
    expect(out).toContain('renderDistance=10')
  })

  it('quality 档：fabulous + 16 区块 + 帧率不限', () => {
    const out = buildOptimizationProfile({ fileName: 'sodium.properties', tier: 'quality' })
    expect(out).toContain('graphics=fabulous')
    expect(out).toContain('renderDistance=16')
    expect(out).toContain('maxFps=0')
  })

  it('genOptimizationProfile 路径与摘要', () => {
    const r = genOptimizationProfile({ fileName: 'sodium-options.properties', tier: 'performance' })
    expect([...r.files.keys()]).toEqual(['config/sodium-options.properties'])
    expect(r.summary[0]).toContain('performance')
  })
})
