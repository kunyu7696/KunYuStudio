/**
 * TR-15.1：排行榜五维排序 / 三维筛选 / 模组对比。
 */
import { describe, expect, it } from 'vitest'
import {
  applyView,
  buildComparison,
  distinctValues,
  filterEntries,
  sortEntries
} from '../leaderboardView'
import type { LeaderboardEntry } from '../../../../../shared/schemas/performance/profile'
import type { ScoreSet } from '../../../../../shared/schemas/performance/profile'

function entry(
  modId: string,
  loader: string,
  mcVersion: string,
  severity: LeaderboardEntry['severity'],
  scores: Partial<ScoreSet>
): LeaderboardEntry {
  return {
    modId,
    version: '1.0.0',
    loader,
    mcVersion,
    modName: modId,
    severity,
    tags: [],
    scores: {
      overall: 0,
      cpuEfficiency: 0,
      memoryEfficiency: 0,
      tickImpact: 0,
      compatibility: 0,
      ...scores
    },
    adviceCount: 0
  }
}

const DATA: LeaderboardEntry[] = [
  entry('alpha', 'fabric', '1.20.1', 'good', { overall: 90, cpuEfficiency: 70 }),
  entry('beta', 'forge', '1.20.1', 'bad', { overall: 40, cpuEfficiency: 90 }),
  entry('gamma', 'fabric', '1.21.1', 'warn', { overall: 60, cpuEfficiency: 50 })
]

describe('sortEntries', () => {
  it('overall 降序', () => {
    expect(sortEntries(DATA, 'overall').map((e) => e.modId)).toEqual([
      'alpha',
      'gamma',
      'beta'
    ])
  })
  it('换列即时重排（cpuEfficiency）', () => {
    expect(sortEntries(DATA, 'cpuEfficiency').map((e) => e.modId)).toEqual([
      'beta',
      'alpha',
      'gamma'
    ])
  })
})

describe('filterEntries', () => {
  it('loader 生效', () => {
    expect(
      filterEntries(DATA, { loader: 'fabric' }).map((e) => e.modId)
    ).toEqual(['alpha', 'gamma'])
  })
  it('mcVersion 生效', () => {
    expect(
      filterEntries(DATA, { mcVersion: '1.20.1' }).map((e) => e.modId)
    ).toEqual(['alpha', 'beta'])
  })
  it('severity 生效', () => {
    expect(filterEntries(DATA, { severity: 'bad' }).map((e) => e.modId)).toEqual([
      'beta'
    ])
  })
  it('空条件不过滤', () => {
    expect(filterEntries(DATA, {}).length).toBe(3)
  })
})

describe('applyView', () => {
  it('筛选后排序', () => {
    const r = applyView(DATA, { loader: 'fabric' }, 'overall')
    expect(r.map((e) => e.modId)).toEqual(['alpha', 'gamma'])
  })
})

describe('buildComparison', () => {
  it('按给定键顺序输出', () => {
    const r = buildComparison(DATA, [
      { modId: 'gamma', version: '1.0.0', loader: 'fabric', mcVersion: '1.21.1' },
      { modId: 'alpha', version: '1.0.0', loader: 'fabric', mcVersion: '1.20.1' }
    ])
    expect(r.map((e) => e.modId)).toEqual(['gamma', 'alpha'])
  })
  it('缺失键跳过', () => {
    const r = buildComparison(DATA, [
      { modId: 'nope', version: '1.0.0', loader: 'fabric', mcVersion: '1.20.1' },
      { modId: 'alpha', version: '1.0.0', loader: 'fabric', mcVersion: '1.20.1' }
    ])
    expect(r.map((e) => e.modId)).toEqual(['alpha'])
  })
})

describe('distinctValues', () => {
  it('loader 去重排序', () => {
    expect(distinctValues(DATA, 'loader')).toEqual(['fabric', 'forge'])
  })
})
