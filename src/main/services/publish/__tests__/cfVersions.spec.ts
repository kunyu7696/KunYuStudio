import { describe, expect, it } from 'vitest'
import { matchCfGameVersions, type CfGameVersion } from '../cfVersions'

const VERSIONS: CfGameVersion[] = [
  { id: 4, name: 'Fabric' },
  { id: 1, name: 'Forge' },
  { id: 6, name: 'NeoForge' },
  { id: 8000, name: '1.20.1', gameVersionTypeID: 73250 },
  { id: 9001, name: '1.21.1', gameVersionTypeID: 73250 },
  { id: 501, name: '1.20.1-Snapshot' },
  { id: 100, name: 'Modloader' }
]

describe('matchCfGameVersions', () => {
  it('精确匹配 MC 版本 + fabric 加载器', () => {
    const m = matchCfGameVersions(VERSIONS, '1.20.1', 'fabric')
    expect(m.mcVersion?.id).toBe(8000)
    expect(m.loader?.id).toBe(4)
    expect(m.suggestions).toEqual([])
  })

  it('neoforge 别名匹配 NeoForge（大小写不敏感）', () => {
    const m = matchCfGameVersions(VERSIONS, '1.21.1', 'neoforge')
    expect(m.mcVersion?.id).toBe(9001)
    expect(m.loader?.id).toBe(6)
    expect(m.suggestions).toEqual([])
  })

  it('forge 匹配 Forge', () => {
    const m = matchCfGameVersions(VERSIONS, '1.20.1', 'forge')
    expect(m.loader?.id).toBe(1)
    expect(m.suggestions).toEqual([])
  })

  it('MC 版本缺失时返回数字开头的建议（最多 20 个）', () => {
    const m = matchCfGameVersions(VERSIONS, '9.9.9', 'fabric')
    expect(m.mcVersion).toBeNull()
    expect(m.loader?.id).toBe(4)
    expect(m.suggestions.length).toBeGreaterThan(0)
    expect(m.suggestions.length).toBeLessThanOrEqual(20)
    for (const s of m.suggestions) {
      expect(s).toMatch(/^\d+\.\d+/)
    }
    expect(m.suggestions).not.toContain('Modloader')
    expect(m.suggestions).not.toContain('Fabric')
  })

  it('加载器缺失时 suggestions 非空', () => {
    const m = matchCfGameVersions(VERSIONS, '1.20.1', 'unknownloader')
    expect(m.mcVersion?.id).toBe(8000)
    expect(m.loader).toBeNull()
    expect(m.suggestions.length).toBeGreaterThan(0)
  })

  it('双缺失时 mcVersion 与 loader 均为 null', () => {
    const m = matchCfGameVersions(VERSIONS, '9.9.9', 'unknownloader')
    expect(m.mcVersion).toBeNull()
    expect(m.loader).toBeNull()
  })
})
