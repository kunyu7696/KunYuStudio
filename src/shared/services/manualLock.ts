/**
 * 人工档位锁定纯逻辑（TR-10.1）。
 * - 普通 run 入口遵循锁定：锁定后只能运行锁定档，不越档；
 * - full_auto 需要某档位而锁定在别的档位时构成冲突（TR-10.2 弹窗条件）。
 */
import type { ManualLock } from '../types/settings'
import type { TierId } from '../types/tiers'

export function isLocked(lock: ManualLock): boolean {
  return lock.tier !== null
}

/**
 * 应用锁定：未锁定返回路由档位；锁定后无论显式/自动都收敛到锁定档（不越档）。
 */
export function resolveTierWithLock(routeTier: TierId, lock: ManualLock): TierId {
  return isLocked(lock) ? (lock.tier as TierId) : routeTier
}

/**
 * 冲突判定：自动流程需要 requiredTier，但锁定在另一个档位。
 * requiredTier 与锁定档一致（或未锁定）时无冲突。
 */
export function detectLockConflict(requiredTier: TierId, lock: ManualLock): boolean {
  return isLocked(lock) && lock.tier !== requiredTier
}

/** 冲突弹窗三选项（TR-10.1） */
export type LockConflictChoice = 'wait' | 'cancel' | 'unlock'
