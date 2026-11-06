/**
 * 矩阵健康状态存储：基线增量同步（mergeFromBaseline）。
 *
 * 背景：overlay 是运行时唯一真源，manifest 只在「overlay 无记录」时做一次性种子；
 * 结果是参考包基线里更新的门禁结论永远进不来，「版本矩阵健康度 → 刷新」点了没反应。
 * mergeFromBaseline 用 lastVerifiedAt 做时间守卫补齐这个缺口：
 *  - 基线更新 → 采纳统计
 *  - 基线更旧/相同 → 不动（避免把探针/监测的新结论刷回旧值）
 *  - 只动 matrixHealth，不动 health/verifiedAt（灯色归运行时通道）
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

  it('基线更新：采纳新统计，但不改 health / verifiedAt（灯色归运行时）', () => {
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
    // 运行时灯色不被基线覆盖
    expect(combo?.health).toBe('yellow')
    expect(combo?.verifiedAt).toBe('2026-10-23T00:00:00.000Z')
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
