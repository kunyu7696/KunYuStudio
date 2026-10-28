import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'

let db: Database.Database | null = null

/**
 * 打开 SQLite 数据库（懒加载单例）。
 * 数据库文件存放于 Electron userData 目录，随应用卸载时一并清理。
 */
export function getDb(): Database.Database {
  if (db) return db
  const dbPath = join(app.getPath('userData'), 'kunyu.db')
  mkdirSync(dirname(dbPath), { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

interface Migration {
  version: number
  name: string
  up: (database: Database.Database) => void
}

/** v1 基线：全部初版表结构（CREATE IF NOT EXISTS，老库重放无副作用） */
function migrateV1Baseline(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      type          TEXT NOT NULL,
      path          TEXT NOT NULL UNIQUE,
      loader        TEXT,
      mc_version    TEXT NOT NULL DEFAULT '',
      mod_id        TEXT,
      namespace     TEXT,
      jdk_path      TEXT,
      description   TEXT NOT NULL DEFAULT '',
      created_at    INTEGER NOT NULL,
      last_opened_at INTEGER NOT NULL
    );
    -- projects 的索引在 v4 修复段补建：异构残缺表缺列时基线建索引会直接失败

    CREATE TABLE IF NOT EXISTS mod_profiles (
      mod_id        TEXT NOT NULL,
      version       TEXT NOT NULL,
      loader        TEXT NOT NULL,
      mc_version    TEXT NOT NULL,
      mod_name      TEXT NOT NULL DEFAULT '',
      file_hash     TEXT NOT NULL DEFAULT '',
      file_path     TEXT NOT NULL DEFAULT '',
      static_json   TEXT NOT NULL,
      analyzed_at   INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      PRIMARY KEY (mod_id, version, loader, mc_version)
    );

    CREATE TABLE IF NOT EXISTS mod_dynamic (
      mod_id        TEXT NOT NULL,
      version       TEXT NOT NULL,
      loader        TEXT NOT NULL,
      mc_version    TEXT NOT NULL,
      dynamic_json  TEXT NOT NULL,
      sampled_at    INTEGER NOT NULL,
      PRIMARY KEY (mod_id, version, loader, mc_version)
    );

    CREATE TABLE IF NOT EXISTS mod_scores (
      mod_id        TEXT NOT NULL,
      version       TEXT NOT NULL,
      loader        TEXT NOT NULL,
      mc_version    TEXT NOT NULL,
      overall       REAL NOT NULL,
      cpu_efficiency REAL NOT NULL,
      memory_efficiency REAL NOT NULL,
      tick_impact   REAL NOT NULL,
      compatibility REAL NOT NULL,
      severity      TEXT NOT NULL,
      tags_json     TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (mod_id, version, loader, mc_version)
    );

    CREATE TABLE IF NOT EXISTS mod_advice (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      mod_id        TEXT NOT NULL,
      version       TEXT NOT NULL,
      loader        TEXT NOT NULL,
      mc_version    TEXT NOT NULL,
      advice_id     TEXT NOT NULL,
      rule_id       TEXT NOT NULL,
      severity      TEXT NOT NULL,
      message       TEXT NOT NULL,
      evidence      TEXT NOT NULL DEFAULT '',
      action        TEXT NOT NULL,
      action_detail TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_mod_advice_key ON mod_advice(mod_id, version, loader, mc_version);
    CREATE INDEX IF NOT EXISTS idx_mod_scores_severity ON mod_scores(severity);

    -- Agent 任务图跨运行持久化（断点续跑）：
    -- agent_runs 存运行主记录 + 最新断点快照；agent_run_events 存完整事件流水（PK 幂等重放）
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      tier TEXT NOT NULL,
      intent TEXT NOT NULL DEFAULT 'chat',
      request_json TEXT NOT NULL,
      checkpoint_json TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      reply TEXT,
      usage_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      finished_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_agent_runs_updated ON agent_runs(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

    CREATE TABLE IF NOT EXISTS agent_run_events (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      stage TEXT NOT NULL,
      at TEXT NOT NULL,
      event_json TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    );

    -- 离线模型资产表（modelProvisionService：预置模型预取状态落库）
    CREATE TABLE IF NOT EXISTS model_assets (
      model_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'missing',
      dir TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      updated_at INTEGER NOT NULL
    );
  `)
}

/** v2：projects 新增加载器版本列（老库平滑加列，历史项目为 NULL） */
function migrateV2ProjectLoaderVersion(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>
  if (!columns.some((c) => c.name === 'loader_version')) {
    database.exec('ALTER TABLE projects ADD COLUMN loader_version TEXT')
  }
}

/** v3：agent_runs 新增 usage_json 列（usage 落库；老库平滑加列，历史记录为 NULL） */
function migrateV3AgentRunUsage(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(agent_runs)').all() as Array<{ name: string }>
  // 表不存在（仅手工构造的最小库会出现）时跳过：v1 baseline 会直接建出带 usage_json 的新表
  if (columns.length === 0) return
  if (!columns.some((c) => c.name === 'usage_json')) {
    database.exec('ALTER TABLE agent_runs ADD COLUMN usage_json TEXT')
  }
}

/**
 * v4：异构旧库修复。
 * 极早期（版本化之前）的 projects 表可能只有少量列（如仅 id/name），
 * v1 的 CREATE IF NOT EXISTS 对已存在的表是空操作，缺失列会导致
 * "no such column: last_opened_at" 等运行期错误。逐列补齐缺失列：
 * - NOT NULL 列必须带 DEFAULT 才能通过 ALTER 添加，历史行补默认值；
 * - PRIMARY KEY/UNIQUE 约束无法经 ALTER 补建，放弃约束保功能（异构旧库本就无此约束）。
 */
const PROJECTS_REPAIR_COLUMNS: ReadonlyArray<{ name: string; ddl: string }> = [
  { name: 'name', ddl: "ALTER TABLE projects ADD COLUMN name TEXT NOT NULL DEFAULT ''" },
  { name: 'type', ddl: "ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT ''" },
  { name: 'path', ddl: "ALTER TABLE projects ADD COLUMN path TEXT NOT NULL DEFAULT ''" },
  { name: 'loader', ddl: 'ALTER TABLE projects ADD COLUMN loader TEXT' },
  { name: 'mc_version', ddl: "ALTER TABLE projects ADD COLUMN mc_version TEXT NOT NULL DEFAULT ''" },
  { name: 'mod_id', ddl: 'ALTER TABLE projects ADD COLUMN mod_id TEXT' },
  { name: 'namespace', ddl: 'ALTER TABLE projects ADD COLUMN namespace TEXT' },
  { name: 'jdk_path', ddl: 'ALTER TABLE projects ADD COLUMN jdk_path TEXT' },
  { name: 'description', ddl: "ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''" },
  { name: 'created_at', ddl: 'ALTER TABLE projects ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0' },
  { name: 'last_opened_at', ddl: 'ALTER TABLE projects ADD COLUMN last_opened_at INTEGER NOT NULL DEFAULT 0' },
  { name: 'loader_version', ddl: 'ALTER TABLE projects ADD COLUMN loader_version TEXT' }
]

function migrateV4RepairHeterogeneousProjects(database: Database.Database): void {
  const columns = database.prepare('PRAGMA table_info(projects)').all() as Array<{ name: string }>
  // 表不存在（全新库）时跳过：v1 baseline 已建出完整新表
  if (columns.length === 0) return
  for (const col of PROJECTS_REPAIR_COLUMNS) {
    if (!columns.some((c) => c.name === col.name)) {
      database.exec(col.ddl)
    }
  }
  // projects 索引统一在此补建：v1 基线若带 CREATE INDEX，
  // 异构残缺表（缺 last_opened_at/type 列）会在基线阶段就抛 no such column，
  // 根本轮不到 v4 修复；补齐列之后再建索引，全新库（走 v1 建表）也会经过 v4 补建
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_projects_last_opened ON projects(last_opened_at DESC);
    CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(type);
  `)
}

/**
 * 有序迁移表（只增不改：已发布版本禁止回写，新变更追加到末尾）。
 * 回滚策略：forward-only——SQLite ALTER 能力有限（早期版本无 DROP COLUMN），
 * 线上库不做 down 迁移；需要回滚时以新版本号补偿（如加列代替删列）。
 */
const MIGRATIONS: ReadonlyArray<Migration> = [
  { version: 1, name: 'baseline', up: migrateV1Baseline },
  { version: 2, name: 'projects.loader_version', up: migrateV2ProjectLoaderVersion },
  { version: 3, name: 'agent_runs.usage_json', up: migrateV3AgentRunUsage },
  { version: 4, name: 'projects.repair_heterogeneous', up: migrateV4RepairHeterogeneousProjects }
]

/** 当前 schema 目标版本（供诊断/测试断言） */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version

/**
 * 按 user_version 顺序执行未完成迁移（事务包裹，任一失败整体回滚）。
 * 老库（版本化之前建立）user_version=0 且表已存在：v1 全部 CREATE IF NOT EXISTS
 * 幂等重放，v2/v3 自带列存在性检测；异构残缺 projects 表由 v4 逐列补齐修复。
 */
export function migrate(database: Database.Database): void {
  const current = (database.pragma('user_version', { simple: true }) as number) || 0
  const pending = MIGRATIONS.filter((m) => m.version > current)
  if (pending.length === 0) return
  database.transaction(() => {
    for (const m of pending) {
      m.up(database)
      database.pragma(`user_version = ${m.version}`)
    }
  })()
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
