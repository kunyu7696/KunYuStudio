/**
 * P1-5 修复测试：dispatchSubtasks 必须收集子任务契约并隔离子任务异常。
 *
 * 修复前：dispatchSubtasks 的 runJob 调用无 try/catch，
 * 单个子任务 throw 会逃逸导致整个织星 run 崩溃；
 * JobOutcome 没有 contract 字段，子任务契约被丢弃。
 *
 * 修复后：runJob 外加 try/catch，失败子任务记录并继续；
 * 每个子任务的 contract 收集到 contracts 数组返回。
 */
import { describe, expect, it, vi } from 'vitest'
import type { AcceptanceContract } from '../../../../../shared/types/agent'
import { dispatchSubtasks, type DispatchDeps, type DispatchJob, type SharedContext } from '../../tierDispatcher'

function job(i: number, total: number, goal = `goal-${i}`): DispatchJob {
  return { index: i, total, tier: 'artisan', label: total > 1 ? `子任务 ${i + 1}/${total}` : '', goal }
}

function contract(overall: AcceptanceContract['overall']): AcceptanceContract {
  return { overall, assertions: [], summary: `整体 ${overall}` }
}

function makeDeps(overrides: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    gate: async () => {},
    isCanceled: () => false,
    resolveModel: () => ({ providerId: 'p', model: null }),
    emit: () => {},
    runJob: async () => ({ files: [], notes: '', contract: null }),
    ...overrides
  }
}

describe('dispatchSubtasks：子任务契约收集（P1-5）', () => {
  it('收集每个子任务的 contract 到 contracts 数组', async () => {
    const jobs = [job(0, 2), job(1, 2)]
    const shared: SharedContext = { goal: '总目标' }
    const deps = makeDeps({
      runJob: vi.fn(async (j) => ({
        files: [{ path: `f-${j.index}.java`, action: 'create' as const, content: '', accepted: true }],
        notes: `子${j.index}`,
        contract: contract('verified')
      }))
    })
    const r = await dispatchSubtasks(jobs, shared, deps)
    expect(r.contracts).toHaveLength(2)
    expect(r.contracts![0]).not.toBeNull()
    expect(r.contracts![1]).not.toBeNull()
  })

  it('子任务 contract 为 null 时也如实收集', async () => {
    const jobs = [job(0, 2), job(1, 2)]
    const deps = makeDeps({
      runJob: vi.fn(async (j) => ({
        files: [],
        notes: '',
        contract: j.index === 0 ? contract('verified') : null
      }))
    })
    const r = await dispatchSubtasks(jobs, { goal: 'g' }, deps)
    expect(r.contracts).toEqual([contract('verified'), null])
  })

  it('断点续跑：resumed 的 contracts 被保留', async () => {
    const resumedContract = contract('verified')
    const jobs = [job(0, 3), job(1, 3), job(2, 3)]
    const deps = makeDeps({
      skipCompleted: 1,
      resumed: { files: [], notes: '', contracts: [resumedContract] },
      runJob: vi.fn(async () => ({
        files: [],
        notes: '',
        contract: contract('pending')
      }))
    })
    const r = await dispatchSubtasks(jobs, { goal: 'g' }, deps)
    expect(r.contracts).toEqual([resumedContract, contract('pending'), contract('pending')])
  })
})

describe('dispatchSubtasks：子任务异常隔离（P1-5）', () => {
  it('单个子任务 throw 不崩溃整个 run，后续子任务继续执行', async () => {
    const jobs = [job(0, 3), job(1, 3), job(2, 3)]
    const events: Array<{ kind: string; index: number }> = []
    const callOrder: number[] = []
    const deps = makeDeps({
      emit: (ev) => events.push({ kind: ev.kind, index: ev.job.index }),
      runJob: vi.fn(async (j) => {
        callOrder.push(j.index)
        if (j.index === 1) throw new Error('子任务1爆炸')
        return { files: [], notes: `ok-${j.index}`, contract: contract('verified') }
      })
    })
    const r = await dispatchSubtasks(jobs, { goal: 'g' }, deps)
    // 三个子任务都被调用
    expect(callOrder).toEqual([0, 1, 2])
    // 子任务1的失败被记录到 notes
    expect(r.notes).toContain('执行异常')
    expect(r.notes).toContain('子任务1爆炸')
    // 子任务0和2的 notes 保留
    expect(r.notes).toContain('ok-0')
    expect(r.notes).toContain('ok-2')
    // 子任务1的 contract 为 null
    expect(r.contracts).toEqual([contract('verified'), null, contract('verified')])
    // 事件流含 fail
    expect(events.some((e) => e.kind === 'fail' && e.index === 1)).toBe(true)
    // 事件流含子任务0和2的 finish
    expect(events.some((e) => e.kind === 'finish' && e.index === 0)).toBe(true)
    expect(events.some((e) => e.kind === 'finish' && e.index === 2)).toBe(true)
  })

  it('全部子任务都 throw 也不崩溃，notes 含所有失败', async () => {
    const jobs = [job(0, 2), job(1, 2)]
    const deps = makeDeps({
      runJob: vi.fn(async (j) => {
        throw new Error(`爆炸${j.index}`)
      })
    })
    const r = await dispatchSubtasks(jobs, { goal: 'g' }, deps)
    expect(r.notes).toContain('爆炸0')
    expect(r.notes).toContain('爆炸1')
    expect(r.contracts).toEqual([null, null])
    expect(r.files).toEqual([])
  })

  it('单作业异常仍能隔离（total=1）', async () => {
    const jobs = [job(0, 1)]
    const deps = makeDeps({
      runJob: vi.fn(async () => {
        throw new Error('单任务爆炸')
      })
    })
    const r = await dispatchSubtasks(jobs, { goal: 'g' }, deps)
    expect(r.notes).toContain('单任务爆炸')
    expect(r.contracts).toEqual([null])
    expect(r.files).toEqual([])
  })
})
