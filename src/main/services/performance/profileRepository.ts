/**
 * 模组性能画像仓储层：静态画像 / 动态指标 / 评分 / 建议的持久化与查询。
 *
 * upsert 语义：
 * - mod_profiles / mod_scores：主键冲突则更新
 * - mod_advice：同键先全删再插入（建议整体替换）
 * - mod_dynamic：独立 upsert，静态画像重算不影响动态数据
 */
import type Database from 'better-sqlite3'
import type {
  DynamicMetrics,
  LeaderboardEntry,
  LeaderboardQuery,
  ModPerformanceProfile,
  ProfileKey,
  ProfileSeverity,
  ScoreOrderKey,
  StaticFeatures
} from '../../../shared/schemas/performance/profile'
import { sourceOfRule } from './rules'

interface ProfileRow {
  mod_id: string
  version: string
  loader: string
  mc_version: string
  mod_name: string
  file_hash: string
  file_path: string
  static_json: string
  analyzed_at: number
  updated_at: number
}

interface DynamicRow {
  dynamic_json: string
  sampled_at: number
}

interface ScoreRow {
  overall: number
  cpu_efficiency: number
  memory_efficiency: number
  tick_impact: number
  compatibility: number
  severity: ProfileSeverity
  tags_json: string
}

interface AdviceRow {
  advice_id: string
  rule_id: string
  severity: string
  message: string
  evidence: string
  action: string
  action_detail: string
}

export interface ProfileRepository {
  upsertProfile(profile: ModPerformanceProfile): void
  upsertDynamic(key: ProfileKey, metrics: DynamicMetrics): void
  getProfile(key: ProfileKey): ModPerformanceProfile | null
  listProfiles(filter?: { loader?: string; mcVersion?: string }): ModPerformanceProfile[]
  leaderboard(query: LeaderboardQuery): LeaderboardEntry[]
  deleteProfile(key: ProfileKey): void
  countProfiles(): number
}

const ORDER_COLUMN: Record<ScoreOrderKey, string> = {
  overall: 'overall',
  cpuEfficiency: 'cpu_efficiency',
  memoryEfficiency: 'memory_efficiency',
  tickImpact: 'tick_impact',
  compatibility: 'compatibility'
}

export function createProfileRepository(database: Database.Database): ProfileRepository {
  const upsertStaticStmt = database.prepare(`
    INSERT INTO mod_profiles
      (mod_id, version, loader, mc_version, mod_name, file_hash, file_path, static_json, analyzed_at, updated_at)
    VALUES
      (@mod_id, @version, @loader, @mc_version, @mod_name, @file_hash, @file_path, @static_json, @analyzed_at, @updated_at)
    ON CONFLICT(mod_id, version, loader, mc_version) DO UPDATE SET
      mod_name = excluded.mod_name,
      file_hash = excluded.file_hash,
      file_path = excluded.file_path,
      static_json = excluded.static_json,
      analyzed_at = excluded.analyzed_at,
      updated_at = excluded.updated_at
  `)

  const upsertScoreStmt = database.prepare(`
    INSERT INTO mod_scores
      (mod_id, version, loader, mc_version, overall, cpu_efficiency, memory_efficiency, tick_impact, compatibility, severity, tags_json)
    VALUES
      (@mod_id, @version, @loader, @mc_version, @overall, @cpu_efficiency, @memory_efficiency, @tick_impact, @compatibility, @severity, @tags_json)
    ON CONFLICT(mod_id, version, loader, mc_version) DO UPDATE SET
      overall = excluded.overall,
      cpu_efficiency = excluded.cpu_efficiency,
      memory_efficiency = excluded.memory_efficiency,
      tick_impact = excluded.tick_impact,
      compatibility = excluded.compatibility,
      severity = excluded.severity,
      tags_json = excluded.tags_json
  `)

  const deleteAdviceStmt = database.prepare(`
    DELETE FROM mod_advice
    WHERE mod_id = @mod_id AND version = @version AND loader = @loader AND mc_version = @mc_version
  `)

  const insertAdviceStmt = database.prepare(`
    INSERT INTO mod_advice
      (mod_id, version, loader, mc_version, advice_id, rule_id, severity, message, evidence, action, action_detail)
    VALUES
      (@mod_id, @version, @loader, @mc_version, @advice_id, @rule_id, @severity, @message, @evidence, @action, @action_detail)
  `)

  const upsertDynamicStmt = database.prepare(`
    INSERT INTO mod_dynamic
      (mod_id, version, loader, mc_version, dynamic_json, sampled_at)
    VALUES
      (@mod_id, @version, @loader, @mc_version, @dynamic_json, @sampled_at)
    ON CONFLICT(mod_id, version, loader, mc_version) DO UPDATE SET
      dynamic_json = excluded.dynamic_json,
      sampled_at = excluded.sampled_at
  `)

  function upsertProfile(profile: ModPerformanceProfile): void {
    const key = {
      mod_id: profile.identity.modId,
      version: profile.identity.version,
      loader: profile.identity.loader,
      mc_version: profile.identity.mcVersion
    }
    const analyzedAt = Date.parse(profile.analyzedAt) || Date.now()
    const tx = database.transaction(() => {
      upsertStaticStmt.run({
        ...key,
        mod_name: profile.identity.modName,
        file_hash: profile.identity.fileHash,
        file_path: profile.identity.filePath,
        static_json: JSON.stringify(profile.staticFeatures),
        analyzed_at: analyzedAt,
        updated_at: Date.now()
      })
      const s = profile.score.scores
      upsertScoreStmt.run({
        ...key,
        overall: s.overall,
        cpu_efficiency: s.cpuEfficiency,
        memory_efficiency: s.memoryEfficiency,
        tick_impact: s.tickImpact,
        compatibility: s.compatibility,
        severity: profile.score.severity,
        tags_json: JSON.stringify(profile.score.tags)
      })
      deleteAdviceStmt.run(key)
      for (const a of profile.advice) {
        insertAdviceStmt.run({
          ...key,
          advice_id: a.id,
          rule_id: a.ruleId,
          severity: a.severity,
          message: a.message,
          evidence: a.evidence,
          action: a.action,
          action_detail: a.actionDetail
        })
      }
    })
    tx()
  }

  function upsertDynamic(key: ProfileKey, metrics: DynamicMetrics): void {
    upsertDynamicStmt.run({
      mod_id: key.modId,
      version: key.version,
      loader: key.loader,
      mc_version: key.mcVersion,
      dynamic_json: JSON.stringify(metrics),
      sampled_at: Date.parse(metrics.sampledAt) || Date.now()
    })
  }

  function readAdvice(key: ProfileKey): ModPerformanceProfile['advice'] {
    const rows = database
      .prepare(
        `SELECT advice_id, rule_id, severity, message, evidence, action, action_detail
         FROM mod_advice
         WHERE mod_id = ? AND version = ? AND loader = ? AND mc_version = ?
         ORDER BY id ASC`
      )
      .all(key.modId, key.version, key.loader, key.mcVersion) as AdviceRow[]
    return rows.map((r) => ({
      id: r.advice_id,
      ruleId: r.rule_id,
      severity: r.severity as ModPerformanceProfile['advice'][number]['severity'],
      // 来源标签由规则静态决定，读取时按 ruleId 派生（不占用存储列）
      source: sourceOfRule(r.rule_id),
      message: r.message,
      evidence: r.evidence,
      action: r.action as ModPerformanceProfile['advice'][number]['action'],
      actionDetail: r.action_detail
    }))
  }

  function getProfile(key: ProfileKey): ModPerformanceProfile | null {
    const row = database
      .prepare(
        `SELECT mod_id, version, loader, mc_version, mod_name, file_hash, file_path, static_json, analyzed_at, updated_at
         FROM mod_profiles
         WHERE mod_id = ? AND version = ? AND loader = ? AND mc_version = ?`
      )
      .get(key.modId, key.version, key.loader, key.mcVersion) as ProfileRow | undefined
    if (!row) return null

    const scoreRow = database
      .prepare(
        `SELECT overall, cpu_efficiency, memory_efficiency, tick_impact, compatibility, severity, tags_json
         FROM mod_scores
         WHERE mod_id = ? AND version = ? AND loader = ? AND mc_version = ?`
      )
      .get(key.modId, key.version, key.loader, key.mcVersion) as ScoreRow | undefined

    const dynamicRow = database
      .prepare(
        `SELECT dynamic_json, sampled_at FROM mod_dynamic
         WHERE mod_id = ? AND version = ? AND loader = ? AND mc_version = ?`
      )
      .get(key.modId, key.version, key.loader, key.mcVersion) as DynamicRow | undefined

    return hydrate(row, scoreRow, dynamicRow, readAdvice(key))
  }

  function listProfiles(filter: { loader?: string; mcVersion?: string } = {}): ModPerformanceProfile[] {
    const rows = database
      .prepare(
        `SELECT mod_id, version, loader, mc_version, mod_name, file_hash, file_path, static_json, analyzed_at, updated_at
         FROM mod_profiles
         WHERE (? IS NULL OR loader = ?) AND (? IS NULL OR mc_version = ?)
         ORDER BY mod_id ASC, version DESC`
      )
      .all(filter.loader ?? null, filter.loader ?? null, filter.mcVersion ?? null, filter.mcVersion ?? null) as ProfileRow[]
    return rows
      .map((row) => {
        const key: ProfileKey = {
          modId: row.mod_id,
          version: row.version,
          loader: row.loader,
          mcVersion: row.mc_version
        }
        const scoreRow = database
          .prepare(
            `SELECT overall, cpu_efficiency, memory_efficiency, tick_impact, compatibility, severity, tags_json
             FROM mod_scores
             WHERE mod_id = ? AND version = ? AND loader = ? AND mc_version = ?`
          )
          .get(key.modId, key.version, key.loader, key.mcVersion) as ScoreRow | undefined
        const dynamicRow = database
          .prepare(
            `SELECT dynamic_json, sampled_at FROM mod_dynamic
             WHERE mod_id = ? AND version = ? AND loader = ? AND mc_version = ?`
          )
          .get(key.modId, key.version, key.loader, key.mcVersion) as DynamicRow | undefined
        return hydrate(row, scoreRow, dynamicRow, readAdvice(key))
      })
      .filter((p): p is ModPerformanceProfile => p !== null)
  }

  function leaderboard(query: LeaderboardQuery): LeaderboardEntry[] {
    const orderColumn = ORDER_COLUMN[query.orderBy] ?? 'overall'
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500)
    const rows = database
      .prepare(
        `SELECT p.mod_id AS mod_id, p.version AS version, p.loader AS loader, p.mc_version AS mc_version,
                p.mod_name AS mod_name,
                s.overall AS overall, s.cpu_efficiency AS cpu_efficiency,
                s.memory_efficiency AS memory_efficiency, s.tick_impact AS tick_impact,
                s.compatibility AS compatibility, s.severity AS severity, s.tags_json AS tags_json,
                (SELECT COUNT(*) FROM mod_advice a
                  WHERE a.mod_id = p.mod_id AND a.version = p.version
                    AND a.loader = p.loader AND a.mc_version = p.mc_version) AS advice_count
         FROM mod_profiles p
         JOIN mod_scores s ON p.mod_id = s.mod_id AND p.version = s.version
           AND p.loader = s.loader AND p.mc_version = s.mc_version
         WHERE (? IS NULL OR p.loader = ?)
           AND (? IS NULL OR p.mc_version = ?)
           AND (? IS NULL OR s.severity = ?)
         ORDER BY s.${orderColumn} DESC, p.mod_id ASC
         LIMIT ?`
      )
      .all(
        query.loader ?? null, query.loader ?? null,
        query.mcVersion ?? null, query.mcVersion ?? null,
        query.severity ?? null, query.severity ?? null,
        limit
      ) as Array<ProfileRow & ScoreRow & { advice_count: number }>

    return rows.map((r) => ({
      modId: r.mod_id,
      version: r.version,
      loader: r.loader,
      mcVersion: r.mc_version,
      modName: r.mod_name,
      severity: r.severity,
      tags: safeParseStringArray(r.tags_json),
      scores: {
        overall: r.overall,
        cpuEfficiency: r.cpu_efficiency,
        memoryEfficiency: r.memory_efficiency,
        tickImpact: r.tick_impact,
        compatibility: r.compatibility
      },
      adviceCount: r.advice_count
    }))
  }

  function deleteProfile(key: ProfileKey): void {
    const tx = database.transaction(() => {
      database
        .prepare('DELETE FROM mod_profiles WHERE mod_id=? AND version=? AND loader=? AND mc_version=?')
        .run(key.modId, key.version, key.loader, key.mcVersion)
      database
        .prepare('DELETE FROM mod_dynamic WHERE mod_id=? AND version=? AND loader=? AND mc_version=?')
        .run(key.modId, key.version, key.loader, key.mcVersion)
      database
        .prepare('DELETE FROM mod_scores WHERE mod_id=? AND version=? AND loader=? AND mc_version=?')
        .run(key.modId, key.version, key.loader, key.mcVersion)
      database
        .prepare('DELETE FROM mod_advice WHERE mod_id=? AND version=? AND loader=? AND mc_version=?')
        .run(key.modId, key.version, key.loader, key.mcVersion)
    })
    tx()
  }

  function countProfiles(): number {
    const row = database.prepare('SELECT COUNT(*) AS n FROM mod_profiles').get() as { n: number }
    return row.n
  }

  return {
    upsertProfile,
    upsertDynamic,
    getProfile,
    listProfiles,
    leaderboard,
    deleteProfile,
    countProfiles
  }
}

/** 行数据组装为完整画像；static_json 损坏则返回 null */
function hydrate(
  row: ProfileRow,
  scoreRow: ScoreRow | undefined,
  dynamicRow: DynamicRow | undefined,
  advice: ModPerformanceProfile['advice']
): ModPerformanceProfile | null {
  let staticFeatures: StaticFeatures
  try {
    staticFeatures = JSON.parse(row.static_json) as StaticFeatures
  } catch {
    return null
  }
  const dynamicMetrics: DynamicMetrics | null = dynamicRow
    ? (((): DynamicMetrics | null => {
        try {
          return JSON.parse(dynamicRow.dynamic_json) as DynamicMetrics
        } catch {
          return null
        }
      })())
    : null

  const score = scoreRow
    ? {
        scores: {
          overall: scoreRow.overall,
          cpuEfficiency: scoreRow.cpu_efficiency,
          memoryEfficiency: scoreRow.memory_efficiency,
          tickImpact: scoreRow.tick_impact,
          compatibility: scoreRow.compatibility
        },
        severity: scoreRow.severity,
        tags: safeParseStringArray(scoreRow.tags_json)
      }
    : {
        scores: { overall: 0, cpuEfficiency: 0, memoryEfficiency: 0, tickImpact: 0, compatibility: 0 },
        severity: 'warn' as ProfileSeverity,
        tags: []
      }

  return {
    identity: {
      modId: row.mod_id,
      version: row.version,
      loader: row.loader,
      mcVersion: row.mc_version,
      fileHash: row.file_hash,
      modName: row.mod_name,
      filePath: row.file_path
    },
    staticFeatures,
    dynamicMetrics,
    score,
    advice,
    analyzedAt: new Date(row.analyzed_at).toISOString()
  }
}

function safeParseStringArray(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
