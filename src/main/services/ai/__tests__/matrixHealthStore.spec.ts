/**
 * 矩阵健康状态存储：基线增量同步（mergeFromBaseline）。
 *
 * 背景：overlay 是运行时唯一真源，manifest 只在「overlay 无记录」时做一次性种子；
 * 结果是参考包基线里更新的门禁结论永远进不来，「版本矩阵健康度 → 刷新」点了没反应。
 * mergeFromBaseline 用 lastVerifiedAt 做时间守卫补齐这个缺口：
 *  - 基线更新 → 采纳统计；若基线门禁时间也不早于本地 verifiedAt，一并采纳灯色
 *  - 基线更旧/相同 → 不动（避免把探针/监测的新结论刷回旧值）
 *  - 本地 verifiedAt 更新（刚跑过探针/监测）→ 只同步统计，保留本地灯色
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }))

import { createMatrixHealthStore } from '../matrixHealthStore'
import type { ReferenceManifest } from '../../../../shared/types/aiReference'

interface FingerprintLike {
  id: string
  health?: string
  verifiedAt?: string | null
  matrixHealth?: {
    templateCount: number
    verifiedCount: number
    passRate: number
    lastVerifiedAt: string | null
  }
}

/** 只构造 mergeFromBaseline 读取的 versionFingerprints，其余字段与测试无关 */
function manifestOf(entries: FingerprintLike[]): ReferenceManifest {
  return {
    versionFingerprints: entries.map((e) => ({
      loader: 'fabric',
      mcVersion: '1.20.1',
      verifiedAt: e.verifiedAt ?? null,
      ...e
    }))
  } as unknown as ReferenceManifest
}

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ky-mhs-'))
  path = join(dir, 'overlay.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('三态报告（stages）', () => {
  it('recordGateResult 写 compile 阶段，load/runtime 保留', () => {
    const store = createMatrixHealthStore({ path })
    store.recordGateResult({
      comboId: 'fabric-1.20.1',
      pass: true,
      templateCount: 5,
      at: '2026-11-09T00:00:00.000Z'
    })
    store.recordLoadResult({
      comboId: 'fabric-1.20.1',
      pass: false,
      at: '2026-11-09T01:00:00.000Z',
      note: 'Missing or unsupported mandatory dependencies'
    })
    // 再跑一次编译：load 阶段不被覆盖
    store.recordGateResult({
      comboId: 'fabric-1.20.1',
      pass: true,
      templateCount: 6,
      at: '2026-11-09T02:00:00.000Z'
    })
    const combo = store.getCombo('fabric-1.20.1')
    expect(combo?.matrixHealth?.stages?.compile).toEqual({
      pass: true,
      at: '2026-11-09T02:00:00.000Z'
    })
    expect(combo?.matrixHealth?.stages?.load).toEqual({
      pass: false,
      at: '2026-11-09T01:00:00.000Z',
      note: 'Missing or unsupported mandatory dependencies'
    })
  })

  it('recordLoadResult 无编译记录时补 0 统计，不伪造灯色', () => {
    const store = createMatrixHealthStore({ path })
    store.recordLoadResult({
      comboId: 'fabric-1.20.1',
      pass: true,
      at: '2026-11-09T01:00:00.000Z'
    })
    const combo = store.getCombo('fabric-1.20.1')
    expect(combo?.health).toBe('unknown')
    expect(combo?.matrixHealth?.passRate).toBe(0)
    expect(combo?.matrixHealth?.stages?.load?.pass).toBe(true)
    expect(combo?.matrixHealth?.stages?.compile).toBeUndefined()
  })
})

describe('mergeFromBaseline（矩阵健康度刷新）', () => {
  it('overlay 无记录：整条灌入并计入采纳数', () => {
    const store = createMatrixHealthStore({ path })
    const adopted = store.mergeFromBaseline(
      manifestOf([
        {
          id: 'fabric-1.20.1',
          health: 'green',
          verifiedAt: '2026-10-27T00:00:00.000Z',
          matrixHealth: {
            templateCount: 5,
            verifiedCount: 5,
            passRate: 100,
            lastVerifiedAt: '2026-10-27T00:00:00.000Z'
          }
        }
      ])
    )
    expect(adopted).toBe(1)
    expect(store.getCombo('fabric-1.20.1')?.matrixHealth?.passRate).toBe(100)
  })

  it('基线更新：采纳新统计与灯色（基线门禁时间晚于本地记录）', () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        combos: {
          'fabric-1.20.1': {
            health: 'yellow',
            verifiedAt: '2026-10-23T00:00:00.000Z',
            matrixHealth: {
              templateCount: 3,
              verifiedCount: 1,
              passRate: 33,
              lastVerifiedAt: '2026-10-23T00:00:00.000Z'
            }
          }
        },
        templates: {}
      }),
      'utf-8'
    )
    const store = createMatrixHealthStore({ path })
    const adopted = store.mergeFromBaseline(
      manifestOf([
        {
          id: 'fabric-1.20.1',
          health: 'green',
          verifiedAt: '2026-10-27T00:00:00.000Z',
          matrixHealth: {
            templateCount: 5,
            verifiedCount: 5,
            passRate: 100,
            lastVerifiedAt: '2026-10-27T00:00:00.000Z'
          }
        }
      ])
    )
    expect(adopted).toBe(1)
    const combo = store.getCombo('fabric-1.20.1')
    expect(combo?.matrixHealth?.passRate).toBe(100)
    // 基线门禁时间（10/27）晚于本地 verifiedAt（10/23）→ 采纳导出快照的灯色
    expect(combo?.health).toBe('green')
    expect(combo?.verifiedAt).toBe('2026-10-27T00:00:00.000Z')
  })

  it('基线统计更新但本地 verifiedAt 更新：只同步统计，保留本地灯色', () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        combos: {
          'fabric-1.20.1': {
            health: 'red',
            verifiedAt: '2026-11-01T00:00:00.000Z',
            matrixHealth: {
              templateCount: 3,
              verifiedCount: 1,
              passRate: 20,
              lastVerifiedAt: '2026-10-20T00:00:00.000Z'
            }
          }
        },
        templates: {}
      }),
      'utf-8'
    )
    const store = createMatrixHealthStore({ path })
    const adopted = store.mergeFromBaseline(
      manifestOf([
        {
          id: 'fabric-1.20.1',
          health: 'green',
          verifiedAt: '2026-10-27T00:00:00.000Z',
          matrixHealth: {
            templateCount: 5,
            verifiedCount: 5,
            passRate: 100,
            lastVerifiedAt: '2026-10-27T00:00:00.000Z'
          }
        }
      ])
    )
    expect(adopted).toBe(1)
    const combo = store.getCombo('fabric-1.20.1')
    expect(combo?.matrixHealth?.passRate).toBe(100)
    // 本地探针记录（11/01）更新：灯色与 verifiedAt 不被旧基线覆盖
    expect(combo?.health).toBe('red')
    expect(combo?.verifiedAt).toBe('2026-11-01T00:00:00.000Z')
  })

  it('基线更旧或相同：不覆盖，返回 0（保证探针新结论不被旧基线刷掉）', () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        combos: {
          'fabric-1.20.1': {
            health: 'green',
            verifiedAt: '2026-10-30T00:00:00.000Z',
            matrixHealth: {
              templateCount: 6,
              verifiedCount: 6,
              passRate: 100,
              lastVerifiedAt: '2026-10-30T00:00:00.000Z'
            }
          }
        },
        templates: {}
      }),
      'utf-8'
    )
    const store = createMatrixHealthStore({ path })
    const adopted = store.mergeFromBaseline(
      manifestOf([
        {
          id: 'fabric-1.20.1',
          health: 'green',
          verifiedAt: '2026-10-27T00:00:00.000Z',
          matrixHealth: {
            templateCount: 5,
            verifiedCount: 5,
            passRate: 100,
            lastVerifiedAt: '2026-10-27T00:00:00.000Z'
          }
        }
      ])
    )
    expect(adopted).toBe(0)
    expect(store.getCombo('fabric-1.20.1')?.matrixHealth?.templateCount).toBe(6)
  })

  it('基线无 matrixHealth 档案：跳过', () => {
    const store = createMatrixHealthStore({ path })
    const adopted = store.mergeFromBaseline(
      manifestOf([{ id: 'fabric-1.20.1', health: 'green', verifiedAt: '2026-10-27T00:00:00.000Z' }])
    )
    expect(adopted).toBe(0)
    expect(store.getCombo('fabric-1.20.1')).toBeNull()
  })
})
