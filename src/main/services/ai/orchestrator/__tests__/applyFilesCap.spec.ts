/**
 * P1-4 修复测试：filesPerRound 截断必须在完整性硬门之前跑。
 *
 * 修复前：硬门基于完整 files 数组判断 hasAnyOutput/hasCodeOutput，
 * 截断后才丢掉超额文件。模型交 10 个文件、硬门看 10 个判完整，
 * 但截断只留前 5 个可能丢掉核心 Java 仍判「完整」。
 *
 * 修复后：先截断，硬门基于截断后的 capped 数组判完整性；
 * 被丢弃文件如实回报。
 */
import { describe, expect, it } from 'vitest'
import type { AgentFileChange } from '../../../../../shared/types/agent'
import { applyFilesCap } from '../generatePipeline'

function fc(path: string, accepted = true): AgentFileChange {
  return { path, action: 'create', content: '', accepted }
}

describe('applyFilesCap：filesPerRound 截断', () => {
  it('未超上限 → 原样返回，丢弃 0', () => {
    const files = [fc('a.java'), fc('b.java')]
    const r = applyFilesCap(files, 5)
    expect(r.capped).toEqual(files)
    expect(r.dropped).toEqual([])
  })

  it('超过上限 → 保留前 N 个，丢弃其余', () => {
    const files = [fc('a.java'), fc('b.java'), fc('c.java'), fc('d.java')]
    const r = applyFilesCap(files, 2)
    expect(r.capped.map((f) => f.path)).toEqual(['a.java', 'b.java'])
    expect(r.dropped.map((f) => f.path)).toEqual(['c.java', 'd.java'])
  })

  it('cap=0 → 全部丢弃', () => {
    const files = [fc('a.java')]
    const r = applyFilesCap(files, 0)
    expect(r.capped).toEqual([])
    expect(r.dropped).toEqual(files)
  })

  it('cap 负数 → 视作 0 全部丢弃（防御）', () => {
    const files = [fc('a.java'), fc('b.java')]
    const r = applyFilesCap(files, -1)
    expect(r.capped).toEqual([])
    expect(r.dropped).toEqual(files)
  })

  it('空 files → 空 capped 空 dropped', () => {
    const r = applyFilesCap([], 5)
    expect(r.capped).toEqual([])
    expect(r.dropped).toEqual([])
  })

  it('保留 accepted 与 rejected 标记（截断不改状态）', () => {
    const files = [fc('a.java', true), fc('b.java', false), fc('c.java', true)]
    const r = applyFilesCap(files, 2)
    expect(r.capped[0].accepted).toBe(true)
    expect(r.capped[1].accepted).toBe(false)
    expect(r.dropped[0].path).toBe('c.java')
    expect(r.dropped[0].accepted).toBe(true)
  })
})
