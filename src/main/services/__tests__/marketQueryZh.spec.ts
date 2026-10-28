import { describe, it, expect } from 'vitest'
import { containsChinese, translateZhQuery } from '../marketQueryZh'

describe('translateZhQuery', () => {
  it('空串原样返回且无命中', () => {
    const r = translateZhQuery('')
    expect(r.query).toBe('')
    expect(r.terms).toHaveLength(0)
  })

  it('纯英文查询原样透传', () => {
    const r = translateZhQuery('sodium fabric')
    expect(r.query).toBe('sodium fabric')
    expect(r.terms).toHaveLength(0)
  })

  it('纯中文术语翻译为英文（光影 → shaders）', () => {
    const r = translateZhQuery('光影')
    expect(r.query).toContain('shaders')
    expect(r.terms).toEqual([{ zh: '光影', en: 'shaders', kind: 'term' }])
  })

  it('模组别名精确命中（钠 → Sodium）', () => {
    const r = translateZhQuery('钠')
    expect(r.query).toContain('Sodium')
    expect(r.terms[0]).toMatchObject({ zh: '钠', en: 'Sodium', kind: 'alias' })
  })

  it('中英文混合：英文 token 保留且中文被翻译（fabric 优化）', () => {
    const r = translateZhQuery('fabric 优化')
    expect(r.query).toContain('fabric')
    expect(r.query).toContain('optimization')
    expect(r.query).not.toContain('优化')
  })

  it('多个术语同时翻译（小地图 传送）', () => {
    const r = translateZhQuery('小地图 传送')
    expect(r.query).toContain('minimap')
    expect(r.query).toContain('teleport')
    expect(r.terms).toHaveLength(2)
  })

  it('最长匹配优先：旅行地图不被短词"地图"截断', () => {
    const r = translateZhQuery('旅行地图')
    expect(r.query).toContain('JourneyMap')
    expect(r.query).not.toContain('旅行')
    // 只命中一个词条（旅行地图），不再级联命中"地图"
    expect(r.terms).toHaveLength(1)
    expect(r.terms[0].kind).toBe('alias')
  })

  it('别名优先于同字术语（暮色森林 → Twilight Forest，单条命中）', () => {
    const r = translateZhQuery('暮色森林')
    expect(r.query).toContain('Twilight Forest')
    expect(r.terms).toHaveLength(1)
    expect(r.terms[0].kind).toBe('alias')
  })

  it('未收录的中文片段保留在末尾为国产模组兜底', () => {
    const r = translateZhQuery('国风家具')
    expect(r.query).toContain('furniture')
    expect(r.query.trimEnd().endsWith('国风')).toBe(true)
    expect(r.untranslated).toEqual(['国风'])
  })

  it('英文词去重保序（多个中文词映射同一英文）', () => {
    // 资源包 / 材质包都映射 resource pack
    const r = translateZhQuery('资源包 材质包')
    expect(r.query.split(/\s+/).filter((t) => t.toLowerCase() === 'resource')).toHaveLength(1)
    expect(r.query.split(/\s+/).filter((t) => t.toLowerCase() === 'pack')).toHaveLength(1)
  })

  it('多词别名输出多 token（一键整理 → inventory sorting）', () => {
    const r = translateZhQuery('一键整理')
    expect(r.query).toContain('inventory')
    expect(r.query).toContain('sorting')
  })

  it('M12 补充别名命中（匠魂/高清修复/物品管理器/宝可梦）', () => {
    expect(translateZhQuery('匠魂').query).toContain('Tinkers Construct')
    expect(translateZhQuery('高清修复').query).toContain('OptiFine')
    expect(translateZhQuery('物品管理器').query).toContain('JEI')
    expect(translateZhQuery('宝可梦').query).toContain('Pixelmon')
    expect(translateZhQuery('光影前置').query).toContain('Iris')
  })

  it('M12 补充术语命中（整合包/前置/枪械/养蜂）', () => {
    expect(translateZhQuery('整合包').query).toContain('modpack')
    expect(translateZhQuery('前置').query).toContain('dependency')
    expect(translateZhQuery('枪械').query).toContain('guns')
    expect(translateZhQuery('养蜂').query).toContain('bees')
  })

  it('M16 补充术语命中（数据包 → datapack）', () => {
    expect(translateZhQuery('数据包').query).toContain('datapack')
  })

  it('未收录中文片段出现在 untranslated 中，纯英文查询为空', () => {
    const r1 = translateZhQuery('玄古异闻录')
    expect(r1.untranslated).toContain('玄古异闻录')
    const r2 = translateZhQuery('sodium')
    expect(r2.untranslated).toHaveLength(0)
  })

  it('多余空白被规范化', () => {
    const r = translateZhQuery('  光影   优化  ')
    expect(r.query).not.toMatch(/\s{2,}/)
    expect(r.query).toContain('shaders')
    expect(r.query).toContain('optimization')
  })
})

describe('containsChinese', () => {
  it('识别中文字符', () => {
    expect(containsChinese('光影')).toBe(true)
    expect(containsChinese('fabric 优化')).toBe(true)
  })
  it('纯英文/数字返回 false', () => {
    expect(containsChinese('sodium 1.20')).toBe(false)
  })
})
