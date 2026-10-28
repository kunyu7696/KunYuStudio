/**
 * 测试治愈闭环（TR-12.1）。
 *
 * 每轮：探测游戏 → 采集失败信号 → 分类：
 * - 通过：结束（若此前自愈过则 healed=true）；
 * - 需人工：立即暂停并写出诊断报告；
 * - 可修复：执行「定向修复 → 重构建」后进入下一轮；
 * - 第 maxRounds 轮仍失败：写出诊断报告后结束。
 */
import type { FailureClassification, FailureSignals } from './diagnosis'
import type { TestOutcome } from '../../../shared/types/agent'

/** 可自动修复的最大探测轮次 */
export const TEST_FIX_MAX_ROUNDS = 10

export interface ProbeResult {
  test: TestOutcome
  signals: FailureSignals
}

export interface TestHealResult {
  test: TestOutcome
  reportPath: string | null
  /** 已完成的探测次数 */
  probes: number
  /** 是否经历过自愈后通过 */
  healed: boolean
  /** 是否因需人工而暂停 */
  pausedForHuman: boolean
}

export interface TestHealDeps {
  maxRounds?: number
  isCanceled: () => boolean
  gate: () => Promise<void>
  pause: () => Promise<void>
  probe: () => Promise<ProbeResult>
  classify: (s: FailureSignals) => FailureClassification
  writeReport: (
    round: number,
    cls: FailureClassification,
    signals: FailureSignals
  ) => Promise<string>
  fixAndRebuild: (
    round: number,
    cls: FailureClassification,
    signals: FailureSignals
  ) => Promise<void>
}

export async function runTestHealLoop(deps: TestHealDeps): Promise<TestHealResult> {
  const maxRounds = deps.maxRounds ?? TEST_FIX_MAX_ROUNDS
  let reportPath: string | null = null
  let pausedForHuman = false
  let last: ProbeResult | null = null

  for (let round = 1; round <= maxRounds; round++) {
    await deps.gate()
    if (deps.isCanceled()) break

    const current = await deps.probe()
    last = current
    const { test, signals } = current

    // 观察通道离线：保持跳过，不进入治愈
    if (test.status === 'skipped') {
      return { test, reportPath: null, probes: round, healed: round > 1, pausedForHuman: false }
    }
    if (signals.passed) {
      return { test, reportPath: null, probes: round, healed: round > 1, pausedForHuman: false }
    }

    const cls = deps.classify(signals)

    // 需人工：立即暂停 + 诊断报告
    if (!cls.fixable) {
      reportPath = await deps.writeReport(round - 1, cls, signals)
      await deps.pause()
      pausedForHuman = true
      return { test, reportPath, probes: round, healed: round > 1, pausedForHuman: true }
    }

    // 可修复但已到上限轮：出报告，不再修复
    if (round >= maxRounds) {
      reportPath = await deps.writeReport(round, cls, signals)
      return { test, reportPath, probes: round, healed: round > 1, pausedForHuman: false }
    }

    await deps.fixAndRebuild(round, cls, signals)
  }

  // 仅取消会走到这里；orchestrator 调用后会据 state.canceled 走 finishCanceled
  const canceledTest: TestOutcome =
    last?.test ?? { status: 'skipped', screenshotPath: null, summary: '运行已取消' }
  return {
    test: canceledTest,
    reportPath,
    probes: 0,
    healed: false,
    pausedForHuman
  }
}
