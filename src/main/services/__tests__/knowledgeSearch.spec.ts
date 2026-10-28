import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import {
  MarkdownKnowledgeBase,
  formatHits,
  splitMarkdown,
  tokenize
} from '../knowledgeSearch'

describe('tokenize 混合分词', () => {
  it('英文标识符整体 + 拆词', () => {
    const t = tokenize('EntityType 注册')
    expect(t).toContain('entitytype')
    expect(t).toContain('entity')
    expect(t).toContain('type')
  })

  it('中文 2-gram / 3-gram', () => {
    const t = tokenize('战利品表')
    expect(t).toContain('战利品')
    expect(t).toContain('战利品表'.slice(0, 2))
  })
})

describe('splitMarkdown', () => {
  it('按标题切分并保留标题路径', () => {
    const md = `# 注册\n\n开头内容\n\n## 方块\n\n方块内容A\n\n## 物品\n\n物品内容B\n`
    const chunks = splitMarkdown(md, 'reg.md')
    expect(chunks).toHaveLength(3)
    expect(chunks[1].title).toBe('注册 / 方块')
    expect(chunks[1].text).toContain('方块内容A')
  })
})

describe('MarkdownKnowledgeBase（真实语料）', () => {
  const fabric = new MarkdownKnowledgeBase(join(process.cwd(), 'resources', 'knowledge', 'fabric'))
  const wiki = new MarkdownKnowledgeBase(join(process.cwd(), 'resources', 'knowledge', 'mcwiki'))

  it('两个语料目录就绪', () => {
    expect(fabric.available()).toBe(true)
    expect(wiki.available()).toBe(true)
  })

  it('fabric：Mixin 注入查询命中 Mixin 篇', () => {
    const hits = fabric.search('@Inject 怎么用 Mixin 注入', 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.chunk.file.includes('07-mixins'))).toBe(true)
  })

  it('fabric：网络包 C2S 命中 networking 篇', () => {
    const hits = fabric.search('自定义网络包 ServerPlayNetworking 发送', 5)
    expect(hits.some((h) => h.chunk.file.includes('04-networking'))).toBe(true)
  })

  it('fabric：实体 AI 目标命中 entities-ai 篇', () => {
    const hits = fabric.search('MeleeAttackGoal 实体属性注册 createAttributes', 5)
    expect(hits.some((h) => h.chunk.file.includes('08-entities-ai'))).toBe(true)
  })

  it('wiki：中文「战利品表」查询命中掉落物词条', () => {
    // mcwiki 语料里战利品内容在 07/05 等篇；fabric 10 也有——这里只测 wiki 库自身
    const hits = wiki.search('战利品表 战利品', 8)
    expect(hits.length).toBeGreaterThan(0)
  })

  it('wiki：伤害类型 damage_type 中文查询', () => {
    const hits = wiki.search('伤害类型 DamageSource 1.20.1', 5)
    expect(hits.some((h) => h.chunk.file.includes('03-damage'))).toBe(true)
  })

  it('wiki：GameTest 无头测试', () => {
    const hits = wiki.search('GameTest runGameTestServer 无头', 5)
    expect(hits.some((h) => h.chunk.file.includes('12-gametest'))).toBe(true)
  })

  it('空查询/未命中行为 + formatHits 兜底文案', () => {
    expect(fabric.search('')).toEqual([])
    const text = formatHits([], 'Fabric 开发文档')
    expect(text).toContain('未命中')
  })
})
