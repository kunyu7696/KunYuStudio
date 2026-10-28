/**
 * TR-11.1：织星 TierDispatcher 跨档调度。
 * - 一次运行出现 ≥2 个不同档位的子任务事件
 * - 后序子任务上下文包含前序产物摘要
 * - 最终聚合全部产物
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildDispatchJobs,
  buildSubtaskGoal,
  dispatchSubtasks,
  resolveSubtaskTier,
  type DispatchDeps,
  type SharedContext
} from '../tierDispatcher'
import { BudgetExceededError } from '../orchestrator/types'
import type {
  AgentFileChange,
  AgentPlan
} from '../../../../shared/types/agent'

function file(path: string): AgentFileChange {
  return { path, action: 'create', content: 'x', accepted: true }
}

function makePlan(): AgentPlan {
  return {
    intent: 'code',
    contentTypes: ['block'],
    stages: ['generate', 'build'],
    goal: '做一个小型整合包',
    tier: 'weaver',
    // 目标关键词分别路由到迅工 / 大师两个不同档位
    subtasks: [
      { goal: '简单加一个物品' },
      { goal: '做一个复杂的 boss 与维度' }
    ]
  } as AgentPlan
}

describe('TierDispatcher', () => {
  it('resolveSubtaskTier：显式 tier 优先，否则按 goal 路由', () => {
    expect(resolveSubtaskTier({ goal: '简单的小东西' })).toBe('sprinter')
    expect(resolveSubtaskTier({ goal: '随便写点', tier: 'master' })).toBe('master')
    expect(resolveSubtaskTier({ goal: '毫无关键词的内容' })).toBe('artisan')
  })

  it('buildDispatchJobs：产出 ≥2 个不同档位作业并标注序号', () => {
    const jobs = buildDispatchJobs(makePlan())
    expect(jobs).toHaveLength(2)
    expect(jobs[0].tier).toBe('sprinter')
    expect(jobs[1].tier).toBe('master')
    expect(jobs[0].index).toBe(0)
    expect(jobs[0].total).toBe(2)
    expect(jobs[0].label).toContain('子任务 1/2')
  })

  it('buildSubtaskGoal：无有效子任务时不崩，单作业回落到整包目标', () => {
    const single = buildDispatchJobs({ ...makePlan(), subtasks: [] })
    expect(single).toHaveLength(1)
    expect(single[0].goal).toContain('整合包')
  })

  it('dispatchSubtasks：≥2 档位事件 + 后序上下文含前序摘要 + 聚合全部产物', async () => {
    const jobs = buildDispatchJobs(makePlan())
    const shared: SharedContext = { goal: makePlan().goal }

    const startTiers: string[] = []
    const capturedGoals: string[] = []
    const runJob = vi.fn(async (job, goal: string) => {
      capturedGoals.push(goal)
      return { files: [file(`out-${job.index}.txt`)], notes: `n${job.index}` }
    })

    const deps: DispatchDeps = {
      gate: async () => {},
      isCanceled: () => false,
      resolveModel: (t) => ({ providerId: `p-${t}`, model: `m-${t}` }),
      emit: (ev) => {
        if (ev.kind === 'start') startTiers.push(ev.job.tier)
      },
      runJob
    }

    const result = await dispatchSubtasks(jobs, shared, deps)

    // ≥2 个不同档位
    expect(startTiers).toEqual(['sprinter', 'master'])
    expect(new Set(startTiers).size).toBeGreaterThanOrEqual(2)

    // 每个子任务按自身档位解析了 provider/model
    expect(runJob).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tier: 'sprinter' }),
      expect.any(String),
      'p-sprinter',
      'm-sprinter'
    )

    // 后序（第 2 个）子任务上下文包含前序产物路径
    expect(capturedGoals[1]).toContain('out-0.txt')
    expect(capturedGoals[1]).toContain('已完成的前序产物')

    // 聚合全部产物
    expect(result.files.map((f) => f.path)).toEqual(['out-0.txt', 'out-1.txt'])
    expect(result.notes).toContain('n0')
    expect(result.notes).toContain('n1')
  })

  it('dispatchSubtasks：取消后不再启动后续子任务', async () => {
    const jobs = buildDispatchJobs(makePlan())
    const shared: SharedContext = { goal: 'g' }
    let calls = 0
    const result = await dispatchSubtasks(jobs, shared, {
      gate: async () => {},
      isCanceled: () => calls >= 1,
      resolveModel: () => ({ providerId: 'p', model: 'm' }),
      emit: () => {},
      runJob: vi.fn(async () => {
        calls += 1
        return { files: [file('x.txt')], notes: '' }
      })
    })
    // 第一个跑完（calls 变 1），第二个开始前检测到取消 → 只聚合 1 个文件
    expect(result.files).toHaveLength(1)
    expect(calls).toBe(1)
  })

  it('预算熔断：子任务抛 BudgetExceededError 时必须上抛且不执行后续子任务', async () => {
    const jobs = buildDispatchJobs(makePlan())
    const shared: SharedContext = { goal: 'g' }
    let secondCalled = false
    const runJob = vi.fn(async (job) => {
      if (job.index === 0) throw new BudgetExceededError('模型调用已达 144 次上限')
      secondCalled = true
      return { files: [file('x.txt')], notes: '' }
    })

    await expect(
      dispatchSubtasks(jobs, shared, {
        gate: async () => {},
        isCanceled: () => false,
        resolveModel: () => ({ providerId: 'p', model: 'm' }),
        emit: () => {},
        runJob
      })
    ).rejects.toBeInstanceOf(BudgetExceededError)

    // 熔断后第 2 个子任务不得执行
    expect(secondCalled).toBe(false)
    expect(runJob).toHaveBeenCalledTimes(1)
  })

  it('非预算异常：子任务普通错误被隔离，后续子任务继续执行', async () => {
    const jobs = buildDispatchJobs(makePlan())
    const shared: SharedContext = { goal: 'g' }
    let secondCalled = false
    const runJob = vi.fn(async (job) => {
      if (job.index === 0) throw new Error('普通错误')
      secondCalled = true
      return { files: [file('x.txt')], notes: '' }
    })

    const result = await dispatchSubtasks(jobs, shared, {
      gate: async () => {},
      isCanceled: () => false,
      resolveModel: () => ({ providerId: 'p', model: 'm' }),
      emit: () => {},
      runJob
    })

    // 普通错误被吞掉：第 2 个子任务仍执行
    expect(secondCalled).toBe(true)
    expect(result.files.map((f) => f.path)).toEqual(['x.txt'])
    expect(result.notes).toContain('执行异常')
  })

  it('断点续跑：skipCompleted 跳过已完成子任务，resumed 产物作为前序上下文与聚合基数', async () => {
    const jobs = buildDispatchJobs(makePlan())
    const shared: SharedContext = { goal: makePlan().goal }

    const startTiers: string[] = []
    const capturedGoals: string[] = []
    const progress: Array<{ completed: number; fileCount: number }> = []
    const runJob = vi.fn(async (job, goal: string) => {
      capturedGoals.push(goal)
      return { files: [file(`new-${job.index}.txt`)], notes: `new-n${job.index}` }
    })

    const result = await dispatchSubtasks(jobs, shared, {
      gate: async () => {},
      isCanceled: () => false,
      resolveModel: (t) => ({ providerId: `p-${t}`, model: `m-${t}` }),
      emit: (ev) => {
        if (ev.kind === 'start') startTiers.push(ev.job.tier)
      },
      runJob,
      skipCompleted: 1, // 第 1 个子任务已完成
      resumed: { files: [file('old-0.txt')], notes: 'old-n0' },
      onSubtaskProgress: (acc) => {
        progress.push({ completed: acc.completed, fileCount: acc.files.length })
      }
    })

    // 只跑了第 2 个子任务
    expect(startTiers).toEqual(['master'])
    expect(runJob).toHaveBeenCalledTimes(1)
    // 后续子任务看到前序已恢复产物
    expect(capturedGoals[0]).toContain('old-0.txt')
    // 聚合包含恢复产物 + 新产物
    expect(result.files.map((f) => f.path)).toEqual(['old-0.txt', 'new-1.txt'])
    expect(result.notes).toContain('old-n0')
    expect(result.notes).toContain('new-n1')
    // 子任务级断点回调：completed 反映全局进度（跳过基数）
    expect(progress).toEqual([{ completed: 2, fileCount: 2 }])
  })

  it('buildSubtaskGoal：注入 loader/version/约束/前序产物/总目标', () => {
    const jobs = buildDispatchJobs(makePlan())
    const goal = buildSubtaskGoal(
      jobs[1],
      { goal: '总包目标', loader: 'fabric', mcVersion: '1.20.1', constraints: '统一命名空间 demo' },
      [file('prev.txt')]
    )
    expect(goal).toContain('fabric')
    expect(goal).toContain('1.20.1')
    expect(goal).toContain('统一命名空间 demo')
    expect(goal).toContain('prev.txt')
    expect(goal).toContain('总包目标')
  })
})
