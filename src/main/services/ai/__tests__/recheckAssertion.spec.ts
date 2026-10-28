/**
 * 单项断言复验单测（P1 扩展覆盖面）。
 *
 * 覆盖：原有静态/构建断言仍可复跑；新增 runtime-world / runtime-inventory /
 * user-confirmation / gametest-runtime 的真机与无头复验路径（在线命中/不符/离线）。
 * 全部副作用经 RecheckDeps 注入，不触真实网络/磁盘/Gradle。
 */
import { describe, expect, it, vi } from 'vitest'

import { recheckAssertion, type RecheckDeps } from '../recheckAssertion'
import type { AcceptanceAssertion, GameTestReport } from '../../../../shared/types/agent'
import type { ObserverEndpoint } from '../../observer/observerClient'

function assertion(overrides: Partial<AcceptanceAssertion>): AcceptanceAssertion {
  return {
    id: 'a1',
    kind: 'file-exists',
    description: '断言',
    expected: 'foo.txt',
    status: 'pending',
    ...overrides
  }
}

function onlineEndpoint(port = 9876): ObserverEndpoint {
  return {
    port,
    health: { ok: true, mod: 'kunyu-observer', version: '1', minecraft: '1.20.1', inGame: true, now: 0 }
  }
}

function baseDeps(overrides: Partial<RecheckDeps> = {}): RecheckDeps {
  return { projectPath: 'D:/proj', ...overrides }
}

describe('recheckAssertion - 真机断言（runtime-*）', () => {
  it('在线且读到相符方块 → runtime-world verified', async () => {
    const a = await recheckAssertion(
      assertion({ kind: 'runtime-world', expected: 'mymod:ruby_block', x: 0, y: 64, z: 0 }),
      baseDeps({
        probeObserver: async () => onlineEndpoint(),
        fetchBlock: async () => ({ block: 'mymod:ruby_block' })
      })
    )
    expect(a.status).toBe('verified')
  })

  it('在线但读到不符方块 → runtime-world failed', async () => {
    const a = await recheckAssertion(
      assertion({ kind: 'runtime-world', expected: 'mymod:ruby_block', x: 0, y: 64, z: 0 }),
      baseDeps({
        probeObserver: async () => onlineEndpoint(),
        fetchBlock: async () => ({ block: 'minecraft:air' })
      })
    )
    expect(a.status).toBe('failed')
  })

  it('观察通道离线 → runtime-world unverified（不冒充结论）', async () => {
    const fetchBlock = vi.fn()
    const a = await recheckAssertion(
      assertion({ kind: 'runtime-world', expected: 'mymod:ruby_block', x: 0, y: 64, z: 0 }),
      baseDeps({ probeObserver: async () => null, fetchBlock })
    )
    expect(a.status).toBe('unverified')
    expect(fetchBlock).not.toHaveBeenCalled()
  })

  it('在线且背包含期望物品 → runtime-inventory verified', async () => {
    const a = await recheckAssertion(
      assertion({ kind: 'runtime-inventory', expected: 'mymod:ruby' }),
      baseDeps({
        probeObserver: async () => onlineEndpoint(),
        fetchInventory: async () => ({ slots: [{ id: 'mymod:ruby' }] })
      })
    )
    expect(a.status).toBe('verified')
  })

  it('观察通道离线 → runtime-inventory unverified', async () => {
    const a = await recheckAssertion(
      assertion({ kind: 'runtime-inventory', expected: 'mymod:ruby' }),
      baseDeps({ probeObserver: async () => null })
    )
    expect(a.status).toBe('unverified')
  })
})

describe('recheckAssertion - 人工确认（user-confirmation）', () => {
  it('在线拿到截图 → awaiting-user + 证据路径，绝不自动 verified', async () => {
    const writeFile = vi.fn()
    const a = await recheckAssertion(
      assertion({ kind: 'user-confirmation', description: '外观', expected: '看起来像红宝石' }),
      baseDeps({
        probeObserver: async () => onlineEndpoint(),
        fetchScreenshot: async () => ({ dataUrl: 'data:image/png;base64,AAAA' }),
        writeFile,
        screenshotDir: '/tmp/shots'
      })
    )
    expect(a.status).toBe('awaiting-user')
    expect(a.evidence?.type).toBe('screenshot')
    expect(a.evidence?.path).toContain('kunyu-recheck-confirm-')
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('观察通道离线 → 无截图 → unverified', async () => {
    const a = await recheckAssertion(
      assertion({ kind: 'user-confirmation', expected: '外观正常' }),
      baseDeps({ probeObserver: async () => null })
    )
    expect(a.status).toBe('unverified')
    expect(a.reason).toContain('真机截图')
  })
})

describe('recheckAssertion - GameTest 无头复跑（gametest-runtime）', () => {
  function report(overrides: Partial<GameTestReport> = {}): GameTestReport {
    return { status: 'pass', passed: ['test_ruby_block'], failed: [], summary: 'GameTest 1 项通过', durationMs: 100, ...overrides }
  }

  it('重跑 GameTest 报告含期望方法 → verified', async () => {
    const a = await recheckAssertion(
      assertion({ kind: 'gametest-runtime', expected: 'test_ruby_block' }),
      baseDeps({ runGameTest: async () => report() })
    )
    expect(a.status).toBe('verified')
    expect(a.actual).toBe('通过')
  })

  it('重跑 GameTest 报告含失败 → failed+reason', async () => {
    const a = await recheckAssertion(
      assertion({ kind: 'gametest-runtime', expected: 'test_ruby_block' }),
      baseDeps({
        runGameTest: async () =>
          report({ status: 'fail', passed: [], failed: [{ name: 'test_ruby_block', error: 'expected STONE got AIR' }] })
      })
    )
    expect(a.status).toBe('failed')
    expect(a.reason).toContain('expected STONE')
  })

  it('无打开项目 → unverified，不触发 Gradle', async () => {
    const runGameTest = vi.fn()
    const a = await recheckAssertion(
      assertion({ kind: 'gametest-runtime', expected: 'test_ruby_block' }),
      { projectPath: null, runGameTest }
    )
    expect(a.status).toBe('unverified')
    expect(runGameTest).not.toHaveBeenCalled()
  })
})

describe('recheckAssertion - 静态断言（回归）', () => {
  it('无打开项目时 file-exists 标 unverified', async () => {
    const a = await recheckAssertion(assertion({ expected: 'foo.txt' }), { projectPath: null })
    expect(a.status).toBe('unverified')
  })

  it('build-pass 无项目 → unverified，不触发 Gradle', async () => {
    const runGradle = vi.fn()
    const a = await recheckAssertion(assertion({ kind: 'build-pass', expected: '' }), {
      projectPath: null,
      runGradle
    })
    expect(a.status).toBe('unverified')
    expect(runGradle).not.toHaveBeenCalled()
  })
})
