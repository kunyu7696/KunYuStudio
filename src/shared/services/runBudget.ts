/**
 * run 级预算推导：由「档位深度 × 模型真实价格」算出本次运行的上限。
 *
 * 旧实现是五档硬编码常量，和模型价格脱钩：换贵模型照样跑满次数，换本地模型
 * 也不会放宽。这里把两件事分开：
 * - **深度**（档位决定）：允许做多深的工具循环 / 修复轮次 → 调用次数天花板；
 * - **花钱**（模型决定）：用户设定的单次任务成本上限 × 档位份额 → 按估算单价
 *   折算成允许的调用次数，取两者较小值。
 *
 * 三种计费类型：
 * - metered：按价格折算调用次数，同时记录估算成本，超成本上限即熔断；
 * - unlimited：本地 / 零价模型，不设成本上限，只受深度天花板约束；
 * - unknown：目录未收录该模型 → 不猜价格，回退固定档位上限并明确告知。
 */
import { TIER_CONFIGS, type TierId } from '../types/tiers'
import { estimateCallCostUsd, type ModelProfile } from '../types/modelProfile'

/** 用户未设置时的单次任务成本上限（USD） */
export const DEFAULT_MAX_RUN_COST_USD = 1

/** 档位占用户成本上限的份额：越深的档位允许花越多 */
export const TIER_COST_SHARES: Record<TierId, number> = {
  sprinter: 0.25,
  artisan: 0.5,
  master: 0.75,
  bridge: 0.9,
  weaver: 1
}

/** 无论多贵，至少允许跑完最小闭环（understand + generate + 一次构建修复） */
export const MIN_MODEL_CALLS = 8

/** 未知价格时的固定回退预算（仅为兜底，正常路径不再使用） */
export const FALLBACK_TIER_RUN_BUDGETS: Record<
  TierId,
  { maxModelCalls: number; maxGradleBuilds: number; maxWallMinutes: number }
> = {
  sprinter: { maxModelCalls: 24, maxGradleBuilds: 3, maxWallMinutes: 30 },
  artisan: { maxModelCalls: 48, maxGradleBuilds: 6, maxWallMinutes: 60 },
  master: { maxModelCalls: 72, maxGradleBuilds: 10, maxWallMinutes: 90 },
  bridge: { maxModelCalls: 96, maxGradleBuilds: 12, maxWallMinutes: 120 },
  weaver: { maxModelCalls: 144, maxGradleBuilds: 14, maxWallMinutes: 150 }
}

export type RunBudgetSource = 'pricing' | 'unlimited' | 'unknown'

export interface ResolvedRunBudget {
  /** 模型调用总次数上限 */
  maxModelCalls: number
  /** 真实 Gradle 构建总次数上限 */
  maxGradleBuilds: number
  /** 墙钟时长上限（分钟） */
  maxWallMinutes: number
  /** 预算来源：价格推导 / 无限量 / 未识别回退 */
  source: RunBudgetSource
  /** 单次运行成本上限（USD）；null = 不设成本上限 */
  maxCostUsd: number | null
  /** 单次调用估算成本（USD）；unknown 时为 null */
  estimatedCostPerCallUsd: number | null
  /** 被推导的模型标识（UI/日志展示） */
  modelLabel: string
  /** 需要如实告知用户的说明（价格新鲜度、回退原因、最贵模型封顶等） */
  notes: string[]
}

export interface ResolveRunBudgetOptions {
  /** 用户设置的单次任务成本上限（USD）；0 或负数 = 不限（仅本地/免费模型有意义） */
  maxRunCostUsd: number
}

/** 档位深度对应的调用次数天花板（与价格无关） */
export function tierCallCeiling(tier: TierId): number {
  const cfg = TIER_CONFIGS[tier]
  return (
    12 +
    (cfg.toolLoopRounds + 1) * 3 +
    cfg.maxBuildRounds * 4 +
    Math.ceil(cfg.filesPerRound / 5) * 2
  )
}

/** 档位深度对应的单次调用 token 估算（输入随工具轮次，输出随单轮文件量） */
export function tierCallTokens(tier: TierId): { prompt: number; completion: number } {
  const cfg = TIER_CONFIGS[tier]
  return {
    prompt: 6_000 + (cfg.toolLoopRounds + 1) * 2_500 + cfg.filesPerRound * 120,
    completion: 1_500 + cfg.filesPerRound * 600
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * 由档位与模型档案推导本次运行预算。
 * @param tier 本次运行档位
 * @param profile 当前模型档案；null = 尚未解析出模型（按 unknown 处理）
 */
export function resolveRunBudget(
  tier: TierId,
  profile: ModelProfile | null,
  options: ResolveRunBudgetOptions
): ResolvedRunBudget {
  const ceiling = tierCallCeiling(tier)
  // Gradle 构建不花 token，直接由档位修复轮次推导：构建 + 测试自愈 + 余量
  const maxGradleBuilds = TIER_CONFIGS[tier].maxBuildRounds + 4
  const modelLabel = profile ? profile.displayName || profile.model : '（未识别模型）'

  if (!profile || profile.billing === 'unknown') {
    const fallback = FALLBACK_TIER_RUN_BUDGETS[tier]
    return {
      ...fallback,
      source: 'unknown',
      maxCostUsd: null,
      estimatedCostPerCallUsd: null,
      modelLabel,
      notes: [
        '模型未收录在价格目录中（可用 npm run models:refresh 刷新），预算回退到固定档位上限，不随价格变化。'
      ]
    }
  }

  const tokens = tierCallTokens(tier)
  const perCall = estimateCallCostUsd(profile, tokens.prompt, tokens.completion)

  if (profile.billing === 'unlimited' || perCall === null || perCall === 0) {
    return {
      maxModelCalls: ceiling,
      maxGradleBuilds,
      maxWallMinutes: clamp(Math.ceil(ceiling * 2.5), 20, 240),
      source: 'unlimited',
      maxCostUsd: null,
      estimatedCostPerCallUsd: 0,
      modelLabel,
      notes: ['当前模型为本地/零价，不设成本上限，预算只受档位深度约束。']
    }
  }

  const userCap = Number.isFinite(options.maxRunCostUsd) ? options.maxRunCostUsd : 0
  const notes: string[] = []
  if (userCap <= 0) {
    return {
      maxModelCalls: ceiling,
      maxGradleBuilds,
      maxWallMinutes: clamp(Math.ceil(ceiling * 2.5), 20, 240),
      source: 'pricing',
      maxCostUsd: null,
      estimatedCostPerCallUsd: perCall,
      modelLabel,
      notes: [
        `单次任务成本上限已设为不限；估算每次调用约 $${perCall.toFixed(4)}，` +
          `档位深度天花板为 ${ceiling} 次，仍会按调用次数熔断。`
      ]
    }
  }

  const cap = Math.round(userCap * TIER_COST_SHARES[tier] * 10_000) / 10_000
  const callsByCost = Math.floor(cap / perCall)
  const maxModelCalls = clamp(callsByCost, MIN_MODEL_CALLS, ceiling)
  if (callsByCost < MIN_MODEL_CALLS) {
    notes.push(
      `按成本上限只够约 ${callsByCost} 次调用，已放宽到最小闭环 ${MIN_MODEL_CALLS} 次；` +
        `该模型较贵，建议换更便宜模型或调高单次成本上限。`
    )
  }
  if (callsByCost > ceiling) {
    notes.push(`成本上限可覆盖 ${callsByCost} 次调用，但档位深度只允许 ${ceiling} 次，按档位封顶。`)
  }
  if (profile.catalogFetchedAt) {
    notes.push(`价格来自 ${profile.source} 快照（${profile.catalogFetchedAt.slice(0, 10)}）。`)
  }

  return {
    maxModelCalls,
    maxGradleBuilds,
    maxWallMinutes: clamp(Math.ceil(maxModelCalls * 2.5), 20, 240),
    source: 'pricing',
    maxCostUsd: cap,
    estimatedCostPerCallUsd: perCall,
    modelLabel,
    notes
  }
}
