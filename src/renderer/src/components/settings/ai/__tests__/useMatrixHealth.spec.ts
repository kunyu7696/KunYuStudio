import { describe, expect, it } from 'vitest'
import type { MatrixHealthRow } from '../types'
import { useMatrixHealth } from '../useMatrixHealth'

/** 构造一行看板数据：stages 缺省即「编译态未落库」的历史/现状数据 */
function row(health: string, passRate: number, stages?: MatrixHealthRow['stages']): MatrixHealthRow {
  return {
    loader: 'fabric',
    mcVersion: '1.21.1',
    templateCount: 10,
    verifiedCount: 10,
    passRate,
    lastVerifiedAt: null,
    health,
    stages
  }
}

const { matrixStageDotClass } = useMatrixHealth()

describe('门禁三态点：编译态由统计派生', () => {
  it('stages.compile 未落库时，green 组合的编译点仍为绿（按 passRate/health 派生）', () => {
    expect(matrixStageDotClass(row('green', 100), 'compile')).toMatchObject({
      'is-ok': true,
      'is-fail': false,
      'is-idle': false
    })
  })

  it('red / deprecated 派生为失败', () => {
    for (const health of ['red', 'deprecated', 'yellow']) {
      expect(matrixStageDotClass(row(health, 0), 'compile')['is-fail']).toBe(true)
    }
  })

  it('unknown / beta 无编译结论时保持灰（未跑）', () => {
    for (const health of ['unknown', 'beta']) {
      expect(matrixStageDotClass(row(health, 0), 'compile')['is-idle']).toBe(true)
    }
  })

  it('stages.compile 存在时以落库结论为准，统计不再覆盖', () => {
    const r = row('green', 100, { compile: { pass: false, at: '2026-11-10T00:00:00Z' } })
    expect(matrixStageDotClass(r, 'compile')['is-fail']).toBe(true)
  })

  it('load / runtime 未落库仍为灰，不被编译派生逻辑污染', () => {
    const r = row('green', 100)
    expect(matrixStageDotClass(r, 'load')['is-idle']).toBe(true)
    expect(matrixStageDotClass(r, 'runtime')['is-idle']).toBe(true)
  })
})
