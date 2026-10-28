/**
 * Agent 任务图持久化 DAL（断点续跑 + 历史任务）。
 *
 * 纯函数风格：createAgentRunStore(db) 注入 better-sqlite3 实例，
 * 测试可直接传 :memory: 数据库（先调用 migrate 建表）。
 *
 * 设计要点：
 * - request 落库前剥离 images（data URL 可能数 MB），仅保留 imageCount 计数；
 * - 事件流整包 JSON 存 agent_run_events（PK run_id+seq 幂等）；
 * - checkpoint 覆盖写，断点续跑时由 orchestrator 反序列化恢复。
 */
import type Database from 'better-sqlite3'
import type {
  AgentEvent,
  AgentIntent,
  AgentRunCheckpoint,
  AgentRunRecord,
  AgentRunRequest,
  AgentRunStatus,
  AgentRunUsage
} from '../../shared/types/agent'
import type { TierId } from '../../shared/types/tiers'

// ---------------------------------------------------------------------------
// 行类型（snake_case 与表结构一一对应）
// ---------------------------------------------------------------------------

interface AgentRunRow {
  id: string
  project_id: string | null
  tier: string
  intent: string
  request_json: string
  checkpoint_json: string | null
  status: string
  reply: string | null
  usage_json: string | null
  created_at: number
  updated_at: number
  finished_at: number | null
}

interface AgentRunEventRow {
  run_id: string
  seq: number
  stage: string
  at: string
  event_json: string
}

export interface CreateAgentRunInput {
  id: string
  projectId: string | null
  tier: TierId
  intent: AgentIntent | string
  /** 原始请求；images 在序列化前剥离 */
  request: AgentRunRequest
}

export interface ListAgentRunsOptions {
  limit?: number
  projectId?: string | null
}

/** 序列化请求：剥离 images（体积可达数 MB），用 imageCount 计数替代 */
function serializeRequest(request: AgentRunRequest): string {
  const imageCount = Array.isArray(request.images) ? request.images.length : 0
  const rest: Record<string, unknown> = { ...(request as unknown as Record<string, unknown>) }
  delete rest['images']
  rest['imageCount'] = imageCount
  return JSON.stringify(rest)
}

/** 反序列化运行主记录 */
function rowToRecord(row: AgentRunRow): AgentRunRecord {
  let usage: AgentRunUsage | null = null
  if (row.usage_json) {
    try {
      usage = JSON.parse(row.usage_json) as AgentRunUsage
    } catch {
      /* 损坏的 usage JSON 按无用量处理（与 checkpoint 容错同策略） */
    }
  }
  return {
    id: row.id,
    projectId: row.project_id,
    tier: row.tier as TierId,
    intent: row.intent,
    request: JSON.parse(row.request_json) as AgentRunRecord['request'],
    checkpoint: row.checkpoint_json
      ? (JSON.parse(row.checkpoint_json) as AgentRunCheckpoint)
      : null,
    status: row.status as AgentRunStatus,
    reply: row.reply,
    usage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at
  }
}

export function createAgentRunStore(db: Database.Database) {
  return {
    /** 创建运行主记录（初始 status=running） */
    createRun(input: CreateAgentRunInput): void {
      const now = Date.now()
      db.prepare(
        `INSERT INTO agent_runs
          (id, project_id, tier, intent, request_json, checkpoint_json, status, reply, created_at, updated_at, finished_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'running', NULL, ?, ?, NULL)`
      ).run(input.id, input.projectId, input.tier, input.intent, serializeRequest(input.request), now, now)
    },

    /**
     * 回写真实意图：createRun 时 plan 未定，占位写
     * 'chat'；understand 判定完成后调用本方法回写，历史列表/统计才能看到
     * code/fix/verify 的真实分布。
     */
    updateIntent(runId: string, intent: AgentIntent): void {
      db.prepare('UPDATE agent_runs SET intent = ?, updated_at = ? WHERE id = ?').run(
        intent,
        Date.now(),
        runId
      )
    },

    /**
     * 追加一条事件（整包 JSON 原样存储，截图路径等字段不裁剪）。
     * PK (run_id, seq) 冲突时覆盖（INSERT OR REPLACE），保证幂等。
     * 顺手刷新主记录 updated_at，让历史列表按最近活动排序。
     */
    appendEvent(runId: string, event: AgentEvent): void {
      db.prepare(
        `INSERT OR REPLACE INTO agent_run_events (run_id, seq, stage, at, event_json)
         VALUES (?, ?, ?, ?, ?)`
      ).run(runId, event.seq, event.stage, event.at, JSON.stringify(event))
      db.prepare('UPDATE agent_runs SET updated_at = ? WHERE id = ?').run(Date.now(), runId)
    },

    /** 覆盖写断点快照（每完成一个阶段调用一次） */
    saveCheckpoint(runId: string, checkpoint: AgentRunCheckpoint): void {
      db.prepare('UPDATE agent_runs SET checkpoint_json = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(checkpoint),
        Date.now(),
        runId
      )
    },

    /** 收尾：写状态 + 完成时间；reply/checkpoint/usage 传入时才覆盖 */
    finishRun(
      runId: string,
      status: AgentRunStatus,
      reply?: string,
      checkpoint?: AgentRunCheckpoint,
      usage?: AgentRunUsage
    ): void {
      const now = Date.now()
      db.prepare(
        `UPDATE agent_runs SET
           status = ?,
           updated_at = ?,
           finished_at = ?,
           reply = CASE WHEN ? IS NULL THEN reply ELSE ? END,
           checkpoint_json = CASE WHEN ? IS NULL THEN checkpoint_json ELSE ? END,
           usage_json = CASE WHEN ? IS NULL THEN usage_json ELSE ? END
         WHERE id = ?`
      ).run(
        status,
        now,
        now,
        reply ?? null,
        reply ?? null,
        checkpoint ? JSON.stringify(checkpoint) : null,
        checkpoint ? JSON.stringify(checkpoint) : null,
        usage ? JSON.stringify(usage) : null,
        usage ? JSON.stringify(usage) : null,
        runId
      )
    },

    /** 历史列表：按最近活动倒序；projectId 传入时按项目过滤 */
    listRuns(options: ListAgentRunsOptions = {}): AgentRunRecord[] {
      const limit = options.limit ?? 20
      const projectId = options.projectId ?? null
      const rows = (
        projectId
          ? db
              .prepare('SELECT * FROM agent_runs WHERE project_id = ? ORDER BY updated_at DESC LIMIT ?')
              .all(projectId, limit)
          : db.prepare('SELECT * FROM agent_runs ORDER BY updated_at DESC LIMIT ?').all(limit)
      ) as AgentRunRow[]
      return rows.map(rowToRecord)
    },

    /** 单条记录（含反序列化 request/checkpoint）；不存在返回 null */
    getRun(id: string): AgentRunRecord | null {
      const row = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as
        | AgentRunRow
        | undefined
      return row ? rowToRecord(row) : null
    },

    /** 事件流水：按 seq 升序反序列化 */
    getRunEvents(runId: string): AgentEvent[] {
      const rows = db
        .prepare('SELECT event_json FROM agent_run_events WHERE run_id = ? ORDER BY seq ASC')
        .all(runId) as AgentRunEventRow[]
      return rows.map((r) => JSON.parse(r.event_json) as AgentEvent)
    },

    /** 删除运行记录并连带删除事件流水 */
    deleteRun(id: string): boolean {
      db.prepare('DELETE FROM agent_run_events WHERE run_id = ?').run(id)
      const result = db.prepare('DELETE FROM agent_runs WHERE id = ?').run(id)
      return result.changes > 0
    },

    /**
     * 启动自愈：上次进程退出时遗留的 running 一律改写为 interrupted。
     * 返回影响行数（通常为 0；>0 说明上次有任务被强制中断，可在 UI 提示续跑）。
     */
    markInterruptedOnBoot(): number {
      const now = Date.now()
      const result = db
        .prepare(
          "UPDATE agent_runs SET status = 'interrupted', updated_at = ?, finished_at = ? WHERE status = 'running'"
        )
        .run(now, now)
      return result.changes
    },

    /**
     * 事件流水保留策略：清理已结束运行超过 maxAgeDays 的事件 JSON。
     * 仅删 agent_run_events，agent_runs 主记录（reply/usage/断点）保留——
     * 历史列表仍可见结果摘要，只是超期后不可再整包回放事件流。
     * 返回删除的事件行数。running 状态（无 finished_at）永不清理。
     */
    pruneEventRetention(maxAgeDays = 30): number {
      const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
      const result = db
        .prepare(
          `DELETE FROM agent_run_events WHERE run_id IN (
             SELECT id FROM agent_runs
              WHERE status != 'running' AND finished_at IS NOT NULL AND finished_at < ?
           )`
        )
        .run(cutoff)
      return result.changes
    }
  }
}

export type AgentRunStore = ReturnType<typeof createAgentRunStore>
