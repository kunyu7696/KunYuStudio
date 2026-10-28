/**
 * licensePolicy 单测（P3-1a）：许可分类与随包再分发告警。
 * 纯函数，无文件系统。
 */
import { describe, expect, it } from 'vitest'
import {
  classifyRedistribution,
  collectRedistributionWarnings,
  normalizeLicenseId,
  redistributionWarning
} from '../licensePolicy'

describe('normalizeLicenseId', () => {
  it('归一化大小写/空白/下划线', () => {
    expect(normalizeLicenseId('  MIT ')).toBe('mit')
    expect(normalizeLicenseId('Apache 2.0')).toBe('apache-2.0')
    expect(normalizeLicenseId('CC_BY_SA-4.0')).toBe('cc-by-sa-4.0')
    expect(normalizeLicenseId('')).toBe('')
    expect(normalizeLicenseId(null)).toBe('')
    expect(normalizeLicenseId(undefined)).toBe('')
  })
})

describe('classifyRedistribution', () => {
  it('宽松许可 → permissive', () => {
    expect(classifyRedistribution('MIT')).toBe('permissive')
    expect(classifyRedistribution('Apache-2.0')).toBe('permissive')
    expect(classifyRedistribution('BSD-3-Clause')).toBe('permissive')
    expect(classifyRedistribution('CC0-1.0')).toBe('permissive')
    expect(classifyRedistribution('Unlicense')).toBe('permissive')
    expect(classifyRedistribution('0BSD')).toBe('permissive')
  })

  it('copyleft 许可 → copyleft（含版本变体）', () => {
    expect(classifyRedistribution('GPL-3.0')).toBe('copyleft')
    expect(classifyRedistribution('LGPL-2.1')).toBe('copyleft')
    expect(classifyRedistribution('AGPL-3.0-only')).toBe('copyleft')
    expect(classifyRedistribution('MPL-2.0')).toBe('copyleft')
    expect(classifyRedistribution('EPL-2.0')).toBe('copyleft')
    expect(classifyRedistribution('CC-BY-SA-4.0')).toBe('copyleft')
  })

  it('ARR/专有/自定义/ND-NC 系 → restricted', () => {
    expect(classifyRedistribution('ARR')).toBe('restricted')
    expect(classifyRedistribution('All Rights Reserved')).toBe('restricted')
    expect(classifyRedistribution('LicenseRef-Proprietary')).toBe('restricted')
    expect(classifyRedistribution('proprietary')).toBe('restricted')
    expect(classifyRedistribution('CC-BY-ND-4.0')).toBe('restricted')
    expect(classifyRedistribution('CC-BY-NC-4.0')).toBe('restricted')
  })

  it('空值与未知串 → unknown', () => {
    expect(classifyRedistribution('')).toBe('unknown')
    expect(classifyRedistribution(null)).toBe('unknown')
    expect(classifyRedistribution(undefined)).toBe('unknown')
    expect(classifyRedistribution('SomeWeirdLicense-1.0')).toBe('unknown')
  })
})

describe('redistributionWarning', () => {
  it('restricted 给强提示并建议清单引用/授权', () => {
    const w = redistributionWarning('optifine.jar', 'LicenseRef-Proprietary', 'restricted')
    expect(w).toContain('optifine.jar')
    expect(w).toContain('不允许随包再分发')
    expect(w).toContain('清单引用')
  })

  it('copyleft 给条件提示', () => {
    const w = redistributionWarning('epicfight.jar', 'GPL-3.0', 'copyleft')
    expect(w).toContain('epicfight.jar')
    expect(w).toContain('copyleft')
    expect(w).toContain('义务')
  })

  it('permissive 无需告警', () => {
    expect(redistributionWarning('sodium.jar', 'MIT', 'permissive')).toBeNull()
  })
})

describe('collectRedistributionWarnings', () => {
  it('permissive 静默；restricted/copyleft 逐条；unknown 合并为一条', () => {
    const warnings = collectRedistributionWarnings([
      { fileName: 'sodium.jar', license: 'MIT' },
      { fileName: 'epic.jar', license: 'GPL-3.0' },
      { fileName: 'optifine.jar', license: 'ARR' },
      { fileName: 'a.jar', license: null },
      { fileName: 'b.jar', license: 'WeirdLicense' },
      { fileName: 'c.jar', license: '' }
    ])
    expect(warnings.some((w) => w.includes('sodium.jar'))).toBe(false)
    expect(warnings.some((w) => w.includes('epic.jar') && w.includes('copyleft'))).toBe(true)
    expect(warnings.some((w) => w.includes('optifine.jar') && w.includes('ARR'))).toBe(true)
    // 3 个 unknown 合并为一条（含文件名截断列表）
    const merged = warnings.filter((w) => w.includes('无许可协议数据'))
    expect(merged).toHaveLength(1)
    expect(merged[0]).toContain('3 个')
    expect(merged[0]).toContain('a.jar')
    expect(merged[0]).toContain('b.jar')
    expect(merged[0]).toContain('c.jar')
    // 总条数 = 2 逐条 + 1 合并
    expect(warnings).toHaveLength(3)
  })

  it('unknown 超过 5 个时文件名截断 + 等', () => {
    const bundled = Array.from({ length: 7 }, (_, i) => ({ fileName: `m${i}.jar`, license: null }))
    const warnings = collectRedistributionWarnings(bundled)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('7 个')
    expect(warnings[0]).toContain('等')
    expect(warnings[0]).not.toContain('m6.jar')
  })

  it('全 permissive 时零告警', () => {
    expect(
      collectRedistributionWarnings([
        { fileName: 'a.jar', license: 'MIT' },
        { fileName: 'b.jar', license: 'Apache-2.0' }
      ])
    ).toEqual([])
  })
})
