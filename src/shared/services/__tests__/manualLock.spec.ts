/**
 * TR-10.1：人工档位锁定纯逻辑。
 * - 未锁定：路由档位原样
 * - 锁定：收敛到锁定档（不越档）
 * - 冲突：锁定档 ≠ 自动流程所需档位
 */
import { describe, expect, it } from 'vitest'
import {
  detectLockConflict,
  isLocked,
  resolveTierWithLock
} from '../manualLock'
import type { ManualLock } from '../../types/settings'

const UNLOCKED: ManualLock = { tier: null, source: null, lockedAt: null }
const LOCKED_MASTER: ManualLock = {
  tier: 'master',
  source: 'agent-track',
  lockedAt: '2025-01-01T00:00:00.000Z'
}

describe('manualLock', () => {
  it('isLocked 判定', () => {
    expect(isLocked(UNLOCKED)).toBe(false)
    expect(isLocked(LOCKED_MASTER)).toBe(true)
  })

  it('未锁定时路由档位原样返回', () => {
    expect(resolveTierWithLock('artisan', UNLOCKED)).toBe('artisan')
    expect(resolveTierWithLock('weaver', UNLOCKED)).toBe('weaver')
  })

  it('锁定后无论路由到哪都收敛到锁定档（不越档）', () => {
    expect(resolveTierWithLock('sprinter', LOCKED_MASTER)).toBe('master')
    expect(resolveTierWithLock('weaver', LOCKED_MASTER)).toBe('master')
  })

  it('冲突判定：所需档位与锁定档不同才冲突', () => {
    expect(detectLockConflict('master', LOCKED_MASTER)).toBe(false)
    expect(detectLockConflict('weaver', LOCKED_MASTER)).toBe(true)
    expect(detectLockConflict('weaver', UNLOCKED)).toBe(false)
  })
})
