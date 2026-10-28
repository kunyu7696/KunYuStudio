/**
 * projectDAL 测试：updateProject 的 path 持久化（重新定位的存储层）。
 */
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let db: Database.Database

vi.mock('../db', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../db')>()
  return { ...mod, getDb: () => db }
})

const { migrate } = await import('../db')
const { insertProject, getProjectById, updateProject } = await import('../projectDAL')

function makeInput(over: Record<string, unknown> = {}) {
  return {
    name: '演示',
    type: 'mod' as const,
    path: 'D:/proj/a',
    loader: 'fabric' as const,
    mcVersion: '1.20.1',
    ...over
  }
}

beforeEach(() => {
  db = new Database(':memory:')
  migrate(db)
})

describe('updateProject', () => {
  it('path 补丁落库并可回读（重新定位的持久化）', () => {
    const p = insertProject(makeInput())
    const updated = updateProject(p.id, { path: 'D:/proj/b' })
    expect(updated?.path).toBe('D:/proj/b')
    expect(getProjectById(p.id)?.path).toBe('D:/proj/b')
  })

  it('不传 path 时保留原路径（既有调用方不受影响）', () => {
    const p = insertProject(makeInput())
    const updated = updateProject(p.id, { description: '新描述' })
    expect(updated?.path).toBe('D:/proj/a')
    expect(getProjectById(p.id)?.description).toBe('新描述')
  })

  it('lastOpenedAt 未给定时不被覆盖', () => {
    const p = insertProject(makeInput())
    const updated = updateProject(p.id, { name: '改名' })
    expect(updated?.lastOpenedAt).toBe(p.lastOpenedAt)
    expect(updated?.name).toBe('改名')
  })
})
