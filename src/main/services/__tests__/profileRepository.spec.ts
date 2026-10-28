/**
 * 模组性能画像仓储层测试：upsert 语义、动态指标独立、排行榜排序筛选与删除。
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../db'
import {
  createProfileRepository,
  type ProfileRepository
} from '../performance/profileRepository'
import {
  createEmptyStaticFeatures,
  type DynamicMetrics,
  type ModPerformanceProfile,
  type ProfileKey
} from '../../../shared/schemas/performance/profile'

function makeProfile(modId: string, version: string, overall: number): ModPerformanceProfile {
  return {
    identity: {
      modId,
      version,
      loader: 'fabric',
      mcVersion: '1.20.1',
      fileHash: `hash-${modId}-${version}`,
      modName: modId === 'a' ? 'Alpha Mod' : 'Beta Mod',
      filePath: `/mods/${modId}-${version}.jar`
    },
    staticFeatures: createEmptyStaticFeatures(),
    dynamicMetrics: null,
    score: {
      scores: {
        overall,
        cpuEfficiency: overall,
        memoryEfficiency: overall - 10,
        tickImpact: overall - 20,
        compatibility: overall - 30
      },
      severity: overall >= 80 ? 'good' : overall >= 50 ? 'warn' : 'bad',
      tags: overall >= 80 ? ['lightweight'] : []
    },
    advice: [
      {
        id: 'R01-1',
        ruleId: 'R01',
        severity: 'medium',
        source: 'static',
        message: '存在主线程阻塞调用',
        evidence: 'com.example.Foo#bar',
        action: 'manual',
        actionDetail: ''
      }
    ],
    analyzedAt: '2026-09-20T10:00:00.000Z'
  }
}

const keyA1 = (): ProfileKey => ({
  modId: 'a',
  version: '1.0.0',
  loader: 'fabric',
  mcVersion: '1.20.1'
})

describe('profileRepository', () => {
  let db: Database.Database
  let repo: ProfileRepository

  beforeEach(() => {
    db = new Database(':memory:')
    migrate(db)
    repo = createProfileRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  it('upsert 后可完整读取画像（含建议）', () => {
    repo.upsertProfile(makeProfile('a', '1.0.0', 90))
    const got = repo.getProfile(keyA1())
    expect(got).not.toBeNull()
    expect(got?.identity.modName).toBe('Alpha Mod')
    expect(got?.identity.fileHash).toBe('hash-a-1.0.0')
    expect(got?.score.scores.overall).toBe(90)
    expect(got?.advice).toHaveLength(1)
    expect(got?.advice[0]?.ruleId).toBe('R01')
    // 来源标签按 ruleId 派生还原
    expect(got?.advice[0]?.source).toBe('static')
  })

  it('同键重复 upsert 为更新而非新增', () => {
    repo.upsertProfile(makeProfile('a', '1.0.0', 90))
    expect(repo.countProfiles()).toBe(1)
    repo.upsertProfile(makeProfile('a', '1.0.0', 40))
    expect(repo.countProfiles()).toBe(1)
    const got = repo.getProfile(keyA1())
    expect(got?.score.scores.overall).toBe(40)
    expect(got?.score.severity).toBe('bad')
    // 建议整体替换后仍是 1 条，不累积
    expect(got?.advice).toHaveLength(1)
  })

  it('不同版本并存', () => {
    repo.upsertProfile(makeProfile('a', '1.0.0', 90))
    repo.upsertProfile(makeProfile('a', '2.0.0', 30))
    expect(repo.countProfiles()).toBe(2)
    expect(
      repo.getProfile({ ...keyA1(), version: '2.0.0' })?.score.scores.overall
    ).toBe(30)
  })

  it('动态指标独立 upsert，重算静态画像不影响动态数据', () => {
    repo.upsertProfile(makeProfile('a', '1.0.0', 90))
    const metrics: DynamicMetrics = {
      cpu: { sampleDurationMs: 30_000, averageCpuPercent: 42, topMethods: [] },
      memory: { heapUsedMb: 2048, allocationRateMbps: 12, topAllocators: [] },
      tick: { averageTickMs: 3.2, tickDrops: 0, tps: 20 },
      events: [],
      sampledAt: '2026-09-20T11:00:00.000Z',
      source: 'jfr'
    }
    repo.upsertDynamic(keyA1(), metrics)
    repo.upsertProfile(makeProfile('a', '1.0.0', 88))
    const got = repo.getProfile(keyA1())
    expect(got?.dynamicMetrics?.source).toBe('jfr')
    expect(got?.dynamicMetrics?.tick.tps).toBe(20)
    expect(got?.score.scores.overall).toBe(88)
  })

  it('排行榜按 overall 降序且筛选生效', () => {
    repo.upsertProfile(makeProfile('a', '1.0.0', 90))
    repo.upsertProfile(makeProfile('b', '1.0.0', 40))
    const all = repo.leaderboard({ orderBy: 'overall' })
    expect(all.map((e) => e.modId)).toEqual(['a', 'b'])
    expect(all[0]?.scores.memoryEfficiency).toBe(80)
    expect(all[0]?.adviceCount).toBe(1)

    const goodOnly = repo.leaderboard({ orderBy: 'overall', severity: 'good' })
    expect(goodOnly).toHaveLength(1)
    expect(goodOnly[0]?.modId).toBe('a')

    const byCpu = repo.leaderboard({ orderBy: 'cpuEfficiency' })
    expect(byCpu.map((e) => e.modId)).toEqual(['a', 'b'])
  })

  it('删除画像清除全部分表数据', () => {
    repo.upsertProfile(makeProfile('a', '1.0.0', 90))
    repo.upsertDynamic(keyA1(), {
      cpu: { sampleDurationMs: 1, averageCpuPercent: 1, topMethods: [] },
      memory: { heapUsedMb: 1, allocationRateMbps: 1, topAllocators: [] },
      tick: { averageTickMs: 1, tickDrops: 0, tps: 20 },
      events: [],
      sampledAt: '2026-09-20T11:00:00.000Z',
      source: 'spark'
    })
    repo.deleteProfile(keyA1())
    expect(repo.countProfiles()).toBe(0)
    expect(repo.getProfile(keyA1())).toBeNull()
    const dynamicRows = db
      .prepare('SELECT COUNT(*) AS n FROM mod_dynamic')
      .get() as { n: number }
    expect(dynamicRows.n).toBe(0)
  })

  it('listProfiles 支持 loader / mcVersion 过滤', () => {
    repo.upsertProfile(makeProfile('a', '1.0.0', 90))
    expect(repo.listProfiles()).toHaveLength(1)
    expect(repo.listProfiles({ loader: 'forge' })).toHaveLength(0)
    expect(repo.listProfiles({ mcVersion: '1.20.1' })).toHaveLength(1)
  })
})
