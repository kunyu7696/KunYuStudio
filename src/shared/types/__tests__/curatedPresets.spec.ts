import { describe, expect, it } from 'vitest'
import { CURATED_MOD_PRESETS } from '../market'

describe('CURATED_MOD_PRESETS 精选模组合规预设', () => {
  it('至少包含一个预设且字段完整', () => {
    expect(CURATED_MOD_PRESETS.length).toBeGreaterThanOrEqual(1)
    for (const p of CURATED_MOD_PRESETS) {
      expect(p.slug).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.loaders.length).toBeGreaterThan(0)
      expect(p.gameVersions.length).toBeGreaterThan(0)
      expect(p.license).toBeTruthy()
      expect(p.note).toBeTruthy()
      // 仅允许 https 外链
      expect(p.url).toMatch(/^https:\/\//)
      // 合规底线：预设只允许保存元数据，任何形态的本地文件引用都不得出现
      expect(JSON.stringify(p)).not.toMatch(/\.(jar|zip)$/i)
    }
  })

  it('Epic Fight：CurseForge / forge+neoforge / 显著标注 Fabric 不可用', () => {
    const epic = CURATED_MOD_PRESETS.find((p) => p.slug === 'epic-fight-mod')
    expect(epic).toBeTruthy()
    expect(epic!.platform).toBe('curseforge')
    expect(epic!.loaders).toEqual(['forge', 'neoforge'])
    expect(epic!.loaders).not.toContain('fabric')
    expect(epic!.fabricIncompatible).toBe(true)
    expect(epic!.gameVersions).toContain('1.20.1')
    expect(epic!.note).toContain('Forge/NeoForge')
    expect(epic!.url).toContain('curseforge.com')
  })
})
