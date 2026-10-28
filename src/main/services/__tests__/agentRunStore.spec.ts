/**
 * AgentRunStore DAL 测试：CRUD / 断点快照 / 启动自愈 / images 剥离。
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate } from '../db'
import { createAgentRunStore, type AgentRunStore } from '../agentRunStore'

let db: Database.Database
let store: AgentRunStore

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
  store = createAgentRunStore(db)
})

afterEach(() => {
  db.close()
})

function makeRequest(message: string, images?: string[]) {
  return {
    message,
    projectId: null,
    loader: 'fabric' as const,
    mcVersion: '1.20.1',
    images
  }
}

describe('createRun + getRun', () => {
  it('创建后 getRun 可反序列化', () => {
    store.createRun({ id: 'r1', projectId: 'p1', tier: 'artisan', intent: 'code', request: makeRequest('新增方块') })
    const record = store.getRun('r1')!
    expect(record.id).toBe('r1')
    expect(record.projectId).toBe('p1')
    expect(record.tier).toBe('artisan')
    expect(record.status).toBe('running')
    expect(record.request.message).toBe('新增方块')
    expect(record.checkpoint).toBeNull()
  })

  it('request.images 被剥离，替换为 imageCount', () => {
    const req = makeRequest('带图请求', ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'])
    store.createRun({ id: 'r2', projectId: null, tier: 'master', intent: 'fix', request: req })
    const record = store.getRun('r2')!
    expect(record.request.message).toBe('带图请求')
    expect(record.request.images).toBeUndefined()
    expect(record.request.imageCount).toBe(2)
  })

  it('不存在返回 null', () => {
    expect(store.getRun('none')).toBeNull()
  })
})

describe('updateIntent（P1-1 回归：真实意图回写）', () => {
  it('回写后 listRuns/ getRun 可见真实意图', () => {
    store.createRun({ id: 'r9', projectId: 'p1', tier: 'artisan', intent: 'chat', request: makeRequest('做个盗贼') })
    expect(store.getRun('r9')!.intent).toBe('chat')
    store.updateIntent('r9', 'code')
    expect(store.getRun('r9')!.intent).toBe('code')
  })

  it('不存在的 runId 不抛错', () => {
    expect(() => store.updateIntent('ghost', 'verify')).not.toThrow()
  })
})

describe('appendEvent + getRunEvents', () => {
  it('追加并顺序反序列化', () => {
    store.createRun({ id: 'r1', projectId: null, tier: 'artisan', intent: 'chat', request: makeRequest('hi') })
    store.appendEvent('r1', {
      seq: 1,
      runId: 'r1',
      stage: 'understand',
      type: 'log',
      detail: 'first',
      at: '2026-09-27T01:00:00.000Z'
    } as never)
    store.appendEvent('r1', {
      seq: 2,
      runId: 'r1',
      stage: 'generate',
      type: 'phase',
      phase: 'done',
      at: '2026-09-27T01:00:01.000Z'
    } as never)
    const events = store.getRunEvents('r1')
    expect(events.length).toBe(2)
    expect(events[0].detail).toBe('first')
    expect(events[1].seq).toBe(2)
  })

  it('同 seq 覆盖写（幂等）', () => {
    store.createRun({ id: 'r1', projectId: null, tier: 'artisan', intent: 'chat', request: makeRequest('hi') })
    store.appendEvent('r1', { seq: 1, runId: 'r1', stage: 'understand', type: 'log', detail: 'old', at: '2026-01-01' } as never)
    store.appendEvent('r1', { seq: 1, runId: 'r1', stage: 'understand', type: 'log', detail: 'new', at: '2026-01-02' } as never)
    const events = store.getRunEvents('r1')
    expect(events.length).toBe(1)
    expect(events[0].detail).toBe('new')
  })

  it('appendEvent 更新 agent_runs.updated_at', () => {
    store.createRun({ id: 'r1', projectId: null, tier: 'artisan', intent: 'chat', request: makeRequest('hi') })
    const before = store.getRun('r1')!.updatedAt
    store.appendEvent('r1', { seq: 1, runId: 'r1', stage: 'understand', type: 'log', detail: 'd', at: '2026-01-01' } as never)
    const after = store.getRun('r1')!.updatedAt
    expect(after).toBeGreaterThanOrEqual(before)
  })
})

describe('saveCheckpoint', () => {
  it('覆盖写 checkpoint_json', () => {
    store.createRun({ id: 'r1', projectId: null, tier: 'artisan', intent: 'code', request: makeRequest('a') })
    store.saveCheckpoint('r1', {
      version: 1,
      completedStage: 'generate',
      files: [{ path: 'src/a.java', action: 'create', content: 'x', accepted: true }]
    })
    const record = store.getRun('r1')!
    expect(record.checkpoint).not.toBeNull()
    expect(record.checkpoint!.completedStage).toBe('generate')
    expect(record.checkpoint!.files!.length).toBe(1)
  })
})

describe('finishRun', () => {
  it('收尾写状态、reply、finished_at；checkpoint 可选', () => {
    store.createRun({ id: 'r1', projectId: null, tier: 'artisan', intent: 'code', request: makeRequest('a') })
    store.finishRun('r1', 'completed', '完成', { version: 1, completedStage: 'done' })
    const record = store.getRun('r1')!
    expect(record.status).toBe('completed')
    expect(record.reply).toBe('完成')
    expect(record.finishedAt).not.toBeNull()
    expect(record.checkpoint!.completedStage).toBe('done')
  })

  it('仅改状态时不覆盖 reply', () => {
    store.createRun({ id: 'r1', projectId: null, tier: 'artisan', intent: 'code', request: makeRequest('a') })
    store.finishRun('r1', 'failed')
    const record = store.getRun('r1')!
    expect(record.status).toBe('failed')
    expect(record.reply).toBeNull()
  })

  // usage 落库（token/成本可查）
  it('usage 传入时落库并在 getRun/listRuns 反序列化', () => {
    store.createRun({ id: 'r1', projectId: null, tier: 'artisan', intent: 'code', request: makeRequest('a') })
    const usage = { promptTokens: 120, completionTokens: 80, totalTokens: 200, modelCalls: 3 }
    store.finishRun('r1', 'completed', '完成', undefined, usage)
    const record = store.getRun('r1')!
    expect(record.usage).toEqual(usage)
    expect(store.listRuns()[0].usage).toEqual(usage)
  })

  it('usage 缺省时保持 usage_json 为空，读取为 null', () => {
    store.createRun({ id: 'r1', projectId: null, tier: 'artisan', intent: 'code', request: makeRequest('a') })
    store.finishRun('r1', 'failed', '失败')
    expect(store.getRun('r1')!.usage).toBeNull()
  })

  it('损坏的 usage JSON 按无用量处理（不抛错）', () => {
    store.createRun({ id: 'r1', projectId: null, tier: 'artisan', intent: 'code', request: makeRequest('a') })
    db.prepare("UPDATE agent_runs SET usage_json = '{oops' WHERE id = 'r1'").run()
    expect(store.getRun('r1')!.usage).toBeNull()
  })
})

describe('listRuns', () => {
  it('按 updated_at DESC 且受 limit 限制', () => {
    for (let i = 1; i <= 5; i++) {
      store.createRun({ id: `r${i}`, projectId: 'p1', tier: 'artisan', intent: 'code', request: makeRequest(`m${i}`) })
    }
    const rows = store.listRuns({ limit: 3 })
    expect(rows.length).toBe(3)
  })

  it('projectId 过滤', () => {
    store.createRun({ id: 'ra', projectId: 'p1', tier: 'artisan', intent: 'code', request: makeRequest('a') })
    store.createRun({ id: 'rb', projectId: 'p2', tier: 'artisan', intent: 'code', request: makeRequest('b') })
    const rows = store.listRuns({ projectId: 'p2' })
    expect(rows.length).toBe(1)
    expect(rows[0].id).toBe('rb')
  })
})

describe('deleteRun', () => {
  it('删除记录并连带删除事件', () => {
    store.createRun({ id: 'r1', projectId: null, tier: 'artisan', intent: 'chat', request: makeRequest('hi') })
    store.appendEvent('r1', { seq: 1, runId: 'r1', stage: 'understand', type: 'log', detail: 'd', at: '2026-01-01' } as never)
    expect(store.deleteRun('r1')).toBe(true)
    expect(store.getRun('r1')).toBeNull()
    expect(store.getRunEvents('r1').length).toBe(0)
  })

  it('删除不存在返回 false', () => {
    expect(store.deleteRun('none')).toBe(false)
  })
})

describe('markInterruptedOnBoot', () => {
  it('把 running 全部改为 interrupted', () => {
    store.createRun({ id: 'r1', projectId: null, tier: 'artisan', intent: 'code', request: makeRequest('a') })
    store.createRun({ id: 'r2', projectId: null, tier: 'artisan', intent: 'code', request: makeRequest('b') })
    store.finishRun('r2', 'completed')
    const changed = store.markInterruptedOnBoot()
    expect(changed).toBe(1)
    expect(store.getRun('r1')!.status).toBe('interrupted')
    expect(store.getRun('r2')!.status).toBe('completed')
  })
})

describe('pruneEventRetention（数据层：事件流水保留策略）', () => {
  function seedRun(id: string, status: 'running' | 'completed', finishedAt: number | null) {
    store.createRun({ id, projectId: null, tier: 'artisan', intent: 'code', request: makeRequest(id) })
    store.appendEvent(id, { seq: 0, stage: 'plan', at: new Date().toISOString(), type: 'log', message: `${id}-e0` } as never)
    store.appendEvent(id, { seq: 1, stage: 'plan', at: new Date().toISOString(), type: 'log', message: `${id}-e1` } as never)
    if (status !== 'running') {
      db.prepare('UPDATE agent_runs SET status = ?, finished_at = ? WHERE id = ?').run(status, finishedAt, id)
    }
  }

  function eventCount(runId: string): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM agent_run_events WHERE run_id = ?').get(runId) as { n: number }).n
  }

  it('超期已结束运行的事件被清理，主记录保留', () => {
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000
    seedRun('old1', 'completed', old)
    seedRun('fresh1', 'completed', Date.now())
    seedRun('still-running', 'running', null)

    const removed = store.pruneEventRetention(30)

    expect(removed).toBe(2) // old1 的两条事件
    expect(eventCount('old1')).toBe(0)
    expect(eventCount('fresh1')).toBe(2)
    expect(eventCount('still-running')).toBe(2)
    // 主记录与结果摘要保留，仅事件流水不可回放
    expect(store.getRun('old1')!.status).toBe('completed')
  })

  it('无超期数据时返回 0（幂等可重复执行）', () => {
    seedRun('r1', 'completed', Date.now())
    expect(store.pruneEventRetention(30)).toBe(0)
    expect(store.pruneEventRetention(30)).toBe(0)
  })
})
