/**
 * R11 硬冲突 / R12 功能重复的集合级规则测试。
 */
import { describe, expect, it } from 'vitest'
import { runCollectionRules } from '../performance/rules'
import type { InstalledModInfo } from '../performance/rules'
import { ruleR11 } from '../performance/rules/r11KnownConflict'
import { ruleR12 } from '../performance/rules/r12FeatureDuplicate'
import { buildRuleContext } from '../performance/rules'

function mod(modId: string): InstalledModInfo {
  return { modId, modName: modId, version: '1' }
}

function emptyMetadata() {
  return {
    fabric: { modId: '', modName: '', version: '', hardDeps: [], softDeps: [], mixinConfigs: [] },
    mixins: [],
    classCount: 0
  }
}

function collectionHit(rule: typeof ruleR11, mods: InstalledModInfo[]) {
  const ctx = buildRuleContext(emptyMetadata(), [], mods)
  return rule.run(ctx)
}

describe('R11 已知硬冲突', () => {
  it('optifine + sodium 命中，证据含双方 modId 与具体原因', () => {
    const findings = collectionHit(ruleR11, [mod('optifine'), mod('sodium')])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('critical')
    expect(findings[0]?.source).toBe('static')
    expect(findings[0]?.evidence).toHaveLength(2)
    expect(findings[0]?.evidence.map((e) => e.modId)).toEqual(['optifine', 'sodium'])
    expect(findings[0]?.evidence[0]?.detail).toContain('渲染')
  })

  it('phosphor + starlight 命中', () => {
    const findings = collectionHit(ruleR11, [mod('phosphor'), mod('starlight')])
    expect(findings).toHaveLength(1)
  })

  it('无冲突组合不命中', () => {
    const findings = collectionHit(ruleR11, [mod('sodium'), mod('lithium'), mod('ferritecore')])
    expect(findings).toHaveLength(0)
  })

  it('只装一方不命中', () => {
    expect(collectionHit(ruleR11, [mod('optifine')])).toHaveLength(0)
  })
})

describe('R12 功能重复', () => {
  it('jei + rei + emi 同功能命中，每个模组各一条证据', () => {
    const findings = collectionHit(ruleR12, [mod('jei'), mod('roughlyenoughitems'), mod('emi')])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.source).toBe('heuristic')
    expect(findings[0]?.evidence).toHaveLength(3)
    expect(findings[0]?.evidence[0]?.detail).toContain('物品与合成查询')
  })

  it('两个小地图命中', () => {
    const findings = collectionHit(ruleR12, [mod('journeymap'), mod('xaerominimap')])
    expect(findings).toHaveLength(1)
  })

  it('不同功能不命中', () => {
    const findings = collectionHit(ruleR12, [mod('jei'), mod('sodium'), mod('journeymap')])
    expect(findings).toHaveLength(0)
  })
})

describe('runCollectionRules 聚合', () => {
  it('同时返回 R11/R12 结果', () => {
    const findings = runCollectionRules([
      mod('optifine'),
      mod('sodium'),
      mod('jei'),
      mod('emi')
    ])
    const ids = new Set(findings.map((f) => f.ruleId))
    expect(ids.has('R11')).toBe(true)
    expect(ids.has('R12')).toBe(true)
  })
})
