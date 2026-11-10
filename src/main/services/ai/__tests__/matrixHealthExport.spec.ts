/**
 * manifest 导出的合并语义回归测试。
 *
 * 背景（真实事故）：CI 每个作业都以空 overlay 起步，三态里的 load/runtime
 * 作业只写阶段结果；导出脚本若整体覆盖 matrixHealth/health，跑过运行时门禁的
 * 组合会从 green/100% 变成 unknown/0%——证据最全的组合数据最差。
 * 这里锁死三条语义：阶段累积、仅编译门禁可改统计与灯色、无档案不动基线。
 */
import { describe, expect, it } from 'vitest'

const mod = (await import(
  '../../../../../scripts/exportMatrixHealth.mjs' as string
)) as {
  mergeFingerprint: (
    fp: Record<string, unknown>,
    combo: Record<string, unknown> | undefined
  ) => boolean
}

const { mergeFingerprint } = mod

/** 基线：编译门禁通过后的典型指纹 */
function baseline(): Record<string, unknown> {
  return {
    id: 'fabric-1.20.1',
    health: 'green',
    verifiedAt: '2026-11-09T07:15:40.000Z',
    matrixHealth: {
      templateCount: 5,
      verifiedCount: 5,
      passRate: 100,
      lastVerifiedAt: '2026-11-09T07:15:40.000Z',
      stages: {}
    }
  }
}

/** load/runtime 作业的 overlay 记录（空 overlay 起步，统计只有占位 0） */
function stageOnly(stage: 'load' | 'runtime', pass: boolean): Record<string, unknown> {
  return {
    health: 'unknown',
    verifiedAt: null,
    matrixHealth: {
      templateCount: 0,
      verifiedCount: 0,
      passRate: 0,
      lastVerifiedAt: null,
      stages: { [stage]: { pass, at: '2026-11-10T00:39:51.227Z' } }
    }
  }
}

describe('mergeFingerprint', () => {
  it('只有 runtime 阶段时保留编译统计与灯色，仅追加阶段', () => {
    const fp = baseline()
    expect(mergeFingerprint(fp, stageOnly('runtime', true))).toBe(true)
    expect(fp.health).toBe('green')
    expect(fp.verifiedAt).toBe('2026-11-09T07:15:40.000Z')
    const mh = fp.matrixHealth as Record<string, unknown>
    expect(mh.templateCount).toBe(5)
    expect(mh.verifiedCount).toBe(5)
    expect(mh.passRate).toBe(100)
    expect(mh.lastVerifiedAt).toBe('2026-11-09T07:15:40.000Z')
    expect((mh.stages as Record<string, unknown>).runtime).toEqual({
      pass: true,
      at: '2026-11-10T00:39:51.227Z'
    })
  })

  it('只有 load 阶段时同样不清零编译统计', () => {
    const fp = baseline()
    mergeFingerprint(fp, stageOnly('load', false))
    const mh = fp.matrixHealth as Record<string, unknown>
    expect(fp.health).toBe('green')
    expect(mh.passRate).toBe(100)
    expect((mh.stages as Record<string, Record<string, unknown>>).load?.pass).toBe(false)
  })

  it('编译门禁（含 stages.compile）可改统计与灯色，但不丢已有 load/runtime', () => {
    const fp = baseline()
    const mh0 = fp.matrixHealth as Record<string, unknown>
    mh0.stages = {
      load: { pass: true, at: '2026-11-09T09:00:00.000Z' },
      runtime: { pass: true, at: '2026-11-10T00:39:51.227Z' }
    }
    mergeFingerprint(fp, {
      health: 'yellow',
      verifiedAt: '2026-11-10T06:00:00.000Z',
      matrixHealth: {
        templateCount: 6,
        verifiedCount: 0,
        passRate: 0,
        lastVerifiedAt: '2026-11-10T06:00:00.000Z',
        stages: { compile: { pass: false, at: '2026-11-10T06:00:00.000Z' } }
      }
    })
    expect(fp.health).toBe('yellow')
    expect(fp.verifiedAt).toBe('2026-11-10T06:00:00.000Z')
    const mh = fp.matrixHealth as Record<string, unknown>
    expect(mh.templateCount).toBe(6)
    expect(mh.passRate).toBe(0)
    const stages = mh.stages as Record<string, Record<string, unknown>>
    expect(stages.compile?.pass).toBe(false)
    expect(stages.load?.pass).toBe(true)
    expect(stages.runtime?.pass).toBe(true)
  })

  it('没有 matrixHealth 档案（纯监测/探针记录）时不动基线', () => {
    const fp = baseline()
    expect(mergeFingerprint(fp, { health: 'red', verifiedAt: '2026-11-10T00:00:00.000Z' })).toBe(
      false
    )
    expect(fp.health).toBe('green')
    expect((fp.matrixHealth as Record<string, unknown>).passRate).toBe(100)
  })
})
