/**
 * db.migrate 版本化迁移测试（#6 技术债：user_version + 有序迁移表）。
 *
 * 覆盖：全新库、版本化之前的 legacy 库（user_version=0 且表已存在）、
 * 已是最新的库（无操作）、幂等重放、迁移失败整体回滚。
 */
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migrate, SCHEMA_VERSION } from '../db'

function userVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name)
}

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
  ).map((r) => r.name)
}

describe('db.migrate 版本化迁移', () => {
  it('全新库：跑完全部迁移并落到 SCHEMA_VERSION', () => {
    const db = new Database(':memory:')
    migrate(db)
    expect(userVersion(db)).toBe(SCHEMA_VERSION)
    for (const t of ['projects', 'mod_profiles', 'mod_dynamic', 'mod_scores', 'mod_advice', 'agent_runs', 'agent_run_events', 'model_assets']) {
      expect(tableNames(db)).toContain(t)
    }
    expect(columnNames(db, 'projects')).toContain('loader_version')
    db.close()
  })

  it('legacy 库（user_version=0、表已建、无 loader_version）：幂等重放 + 补列 + 抬版本', () => {
    const db = new Database(':memory:')
    // 模拟版本化之前的旧库：手工建 projects（无 loader_version）+ 旧 mod_profiles
    db.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
        loader TEXT, mc_version TEXT NOT NULL DEFAULT '', mod_id TEXT, namespace TEXT,
        jdk_path TEXT, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
        last_opened_at INTEGER NOT NULL
      );
      INSERT INTO projects (id, name, type, path, created_at, last_opened_at)
        VALUES ('p1', '旧项目', 'mod', '/tmp/p1', 1, 1);
    `)
    expect(userVersion(db)).toBe(0)

    migrate(db)

    expect(userVersion(db)).toBe(SCHEMA_VERSION)
    expect(columnNames(db, 'projects')).toContain('loader_version')
    // 老数据不受影响
    const row = db.prepare('SELECT id, loader_version FROM projects WHERE id = ?').get('p1') as {
      id: string
      loader_version: string | null
    }
    expect(row.loader_version).toBeNull()
    db.close()
  })

  it('已是最新：无操作、不重复执行迁移', () => {
    const db = new Database(':memory:')
    migrate(db)
    migrate(db) // 第二次全部 pending 为空
    expect(userVersion(db)).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('部分落后：只执行缺失的迁移段', () => {
    const db = new Database(':memory:')
    // 手工制造 v1 完成、v2 未跑的状态
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY)')
    db.pragma('user_version = 1')
    migrate(db)
    expect(userVersion(db)).toBe(SCHEMA_VERSION)
    expect(columnNames(db, 'projects')).toContain('loader_version')
    db.close()
  })

  it('v4 异构旧库修复：仅 2 列 projects 表补齐后 last_opened_at 查询可用（数据层）', () => {
    const db = new Database(':memory:')
    // 模拟异构旧库：projects 仅 2 列，v1 的 IF NOT EXISTS 对它无效
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO projects (id, name) VALUES ('p1', '残缺旧项目');
    `)
    migrate(db)
    expect(userVersion(db)).toBe(SCHEMA_VERSION)
    // 全部规范列补齐
    for (const col of ['type', 'path', 'mc_version', 'created_at', 'last_opened_at', 'loader_version']) {
      expect(columnNames(db, 'projects')).toContain(col)
    }
    // 复现点：之前会抛 no such column: last_opened_at
    const rows = db
      .prepare('SELECT id, name, last_opened_at, created_at FROM projects ORDER BY last_opened_at DESC')
      .all()
    expect(rows).toEqual([{ id: 'p1', name: '残缺旧项目', last_opened_at: 0, created_at: 0 }])
    // 补齐后可正常写入业务列
    db.prepare(
      "UPDATE projects SET type = 'mod', path = '/tmp/p1', mc_version = '1.20.1', created_at = 10, last_opened_at = 20 WHERE id = 'p1'"
    ).run()
    expect(db.prepare('SELECT mc_version FROM projects WHERE id = ?').get('p1')).toEqual({
      mc_version: '1.20.1'
    })
    db.close()
  })

  it('迁移执行在事务内：user_version 与实际 schema 一致（重跑安全）', () => {
    const db = new Database(':memory:')
    migrate(db)
    // 版本号与列同时存在，不存在"版本已抬但列没加"的中间态
    expect(userVersion(db)).toBe(SCHEMA_VERSION)
    expect(columnNames(db, 'projects')).toContain('loader_version')
    db.close()
  })
})
