/**
 * TR-12.1：测试治愈闭环。
 * - 可修复失败经 ≤10 轮自愈后通过
 * - 需人工失败立即暂停并出报告
 * - 第 10 轮仍失败出报告
 */
import { describe, expect, it, vi } from 'vitest'
import { classifyFailure, type FailureSignals } from '../diagnosis'
import {
  runTestHealLoop,
  TEST_FIX_MAX_ROUNDS,
  type ProbeResult,
  type TestHealDeps
} from '../testHealLoop'
import type { TestOutcome } from '../../../../shared/types/agent'

function failProbe(crash: string): ProbeResult {
  const test: TestOutcome = {
    status: 'connected-fail',
    screenshotPath: null,
    summary: crash
  }
  const signals: FailureSignals = {
    passed: false,
    crashReport: crash,
    latestLog: null,
    introspectionOk: false,
    introspectionError: null
  }
  return { test, signals }
}

function passProbe(): ProbeResult {
  const test: TestOutcome = {
    status: 'connected-ok',
    screenshotPath: null,
    summary: 'ok'
  }
  const signals: FailureSignals = {
    passed: true,
    crashReport: null,
    latestLog: null,
    introspectionOk: true,
    introspectionError: null
  }
  return { test, signals }
}

function skipProbe(): ProbeResult {
  const test: TestOutcome = {
    status: 'skipped',
    screenshotPath: null,
    summary: 'kunyu-observer 离线'
  }
  const signals: FailureSignals = {
    passed: false,
    crashReport: null,
    latestLog: null,
    introspectionOk: false,
    introspectionError: null
  }
  return { test, signals }
}

function baseDeps(partial: Partial<TestHealDeps>): TestHealDeps {
  return {
    isCanceled: () => false,
    gate: async () => {},
    pause: vi.fn(async () => {}),
    probe: vi.fn(async () => failProbe('error: cannot find symbol')),
    classify: classifyFailure,
    writeReport: vi.fn(async () => 'report.md'),
    fixAndRebuild: vi.fn(async () => {}),
    ...partial
  }
}

describe('runTestHealLoop', () => {
  it('常量：最多 10 轮', () => {
    expect(TEST_FIX_MAX_ROUNDS).toBe(10)
  })

  it('可修复失败：第 3 次探测通过，经历 2 次修复，无报告', async () => {
    const fixAndRebuild = vi.fn(async () => {})
    const probe = vi
      .fn()
      .mockResolvedValueOnce(failProbe('error: cannot find symbol a'))
      .mockResolvedValueOnce(failProbe('error: cannot find symbol b'))
      .mockResolvedValueOnce(passProbe())

    const result = await runTestHealLoop(baseDeps({ probe, fixAndRebuild }))

    expect(result.probes).toBe(3)
    expect(result.healed).toBe(true)
    expect(result.pausedForHuman).toBe(false)
    expect(result.reportPath).toBeNull()
    expect(fixAndRebuild).toHaveBeenCalledTimes(2)
    expect(result.test.status).toBe('connected-ok')
  })

  it('需人工失败：首次即暂停并写报告，不做修复', async () => {
    const pause = vi.fn(async () => {})
    const writeReport = vi.fn(async () => 'human-report.md')
    const fixAndRebuild = vi.fn(async () => {})

    const result = await runTestHealLoop(
      baseDeps({
        probe: vi.fn(async () => failProbe('Mixin apply failed for Foo')),
        pause,
        writeReport,
        fixAndRebuild
      })
    )

    expect(result.probes).toBe(1)
    expect(result.pausedForHuman).toBe(true)
    expect(result.reportPath).toBe('human-report.md')
    expect(pause).toHaveBeenCalledTimes(1)
    expect(writeReport).toHaveBeenCalledTimes(1)
    expect(fixAndRebuild).not.toHaveBeenCalled()
  })

  it('第 10 轮仍失败：出报告，修复 9 次，不暂停（非人工）', async () => {
    const fixAndRebuild = vi.fn(async () => {})
    const writeReport = vi.fn(async () => 'limit-report.md')
    const probe = vi.fn(async () => failProbe('error: cannot find symbol x'))

    const result = await runTestHealLoop(baseDeps({ probe, fixAndRebuild, writeReport }))

    expect(result.probes).toBe(10)
    expect(result.healed).toBe(true)
    expect(result.pausedForHuman).toBe(false)
    expect(result.reportPath).toBe('limit-report.md')
    expect(fixAndRebuild).toHaveBeenCalledTimes(9)
    expect(writeReport).toHaveBeenCalledTimes(1)
  })

  it('观察通道离线：跳过不治愈、不报告', async () => {
    const fixAndRebuild = vi.fn(async () => {})
    const result = await runTestHealLoop(
      baseDeps({ probe: vi.fn(async () => skipProbe()), fixAndRebuild })
    )
    expect(result.probes).toBe(1)
    expect(result.healed).toBe(false)
    expect(result.reportPath).toBeNull()
    expect(fixAndRebuild).not.toHaveBeenCalled()
  })
})
