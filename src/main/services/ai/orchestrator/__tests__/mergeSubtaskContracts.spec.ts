/**
 * P1-5 修复测试：织星档子任务契约必须合并保留，不能恒为 null。
 *
 * 修复前：dispatchSubtasks 的 JobOutcome 只有 { files, notes }，
 * runToolLoop 返回的 contract 被丢弃；织星档 return 时硬编码 contract: null。
 * 最贵的一档反而是唯一没有任何断言/证据链的一档。
 *
 * 修复后：抽纯函数 mergeSubtaskContracts 合并多个子任务契约；
 * dispatchSubtasks 收集每个子任务的 contract；织星档返回合并后的 contract。
 */
import { describe, expect, it } from 'vitest'
import type {
  AcceptanceAssertion,
  AcceptanceContract,
  AssertionStatus
} from '../../../../../shared/types/agent'
import { mergeSubtaskContracts } from '../generatePipeline'

function assertion(
  id: string,
  status: AssertionStatus
): AcceptanceAssertion {
  return { id, kind: 'file-exists', description: id, expected: '', status }
}

function contract(
  overall: AssertionStatus,
  assertions: AcceptanceAssertion[],
  summary = ''
): AcceptanceContract {
  return { overall, assertions, summary }
}

describe('mergeSubtaskContracts：织星子任务契约合并', () => {
  it('空数组 → null', () => {
    expect(mergeSubtaskContracts([])).toBeNull()
  })

  it('全 null/undefined → null', () => {
    expect(mergeSubtaskContracts([null, undefined, null])).toBeNull()
  })

  it('单个非空 → 原样返回（不加前缀）', () => {
    const c = contract('verified', [assertion('a-0', 'verified')], '通过')
    const r = mergeSubtaskContracts([c])
    expect(r).toEqual(c)
  })

  it('多个非空：assertions 拼接，id 加子任务前缀防冲突', () => {
    const c1 = contract('verified', [
      assertion('a-0', 'verified'),
      assertion('a-1', 'verified')
    ])
    const c2 = contract('verified', [assertion('a-0', 'verified')]) // 同 id
    const r = mergeSubtaskContracts([c1, c2])
    expect(r!.assertions).toHaveLength(3)
    expect(r!.assertions.map((a) => a.id)).toEqual([
      'sub0-a-0',
      'sub0-a-1',
      'sub1-a-0'
    ])
  })

  it('overall 合并：任一 failed → failed', () => {
    const c1 = contract('verified', [assertion('a', 'verified')])
    const c2 = contract('failed', [assertion('b', 'failed')])
    const r = mergeSubtaskContracts([c1, c2])
    expect(r!.overall).toBe('failed')
  })

  it('overall 合并：任一 pending/awaiting-user → pending', () => {
    const c1 = contract('verified', [assertion('a', 'verified')])
    const c2 = contract('pending', [assertion('b', 'pending')])
    const r = mergeSubtaskContracts([c1, c2])
    expect(r!.overall).toBe('pending')
  })

  it('overall 合并：全 verified → verified', () => {
    const c1 = contract('verified', [assertion('a', 'verified')])
    const c2 = contract('verified', [assertion('b', 'verified')])
    const r = mergeSubtaskContracts([c1, c2])
    expect(r!.overall).toBe('verified')
  })

  it('overall 合并：无 failed/pending/awaiting，有 unverified → unverified', () => {
    const c1 = contract('verified', [assertion('a', 'verified')])
    const c2 = contract('unverified', [assertion('b', 'unverified')])
    const r = mergeSubtaskContracts([c1, c2])
    expect(r!.overall).toBe('unverified')
  })

  it('overall 合并：旧值 pass=verified / fail=failed / skipped=unverified 归一', () => {
    const c1 = contract('pass', [assertion('a', 'pass')])
    const c2 = contract('skipped', [assertion('b', 'skipped')])
    const r = mergeSubtaskContracts([c1, c2])
    expect(r!.overall).toBe('unverified')
  })

  it('跳过 null 子任务，只合并非空', () => {
    const c1 = contract('verified', [assertion('a', 'verified')])
    const r = mergeSubtaskContracts([null, c1, undefined])
    expect(r!.assertions).toHaveLength(1)
    expect(r!.overall).toBe('verified')
  })

  it('合并后 summary 含子任务数与断言总数', () => {
    const c1 = contract('verified', [assertion('a', 'verified')], '子1通过')
    const c2 = contract('failed', [assertion('b', 'failed')], '子2失败')
    const r = mergeSubtaskContracts([c1, c2])
    expect(r!.summary).toContain('2')
    expect(r!.summary).toContain('2')
  })
})
