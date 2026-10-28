/**
 * P0-a 真机断言执行器单测：evaluateRuntimeAssertions。
 *
 * 通过注入 RuntimeProbeDeps 模拟 kunyu-observer 通道，覆盖：
 * 离线(port=null) → 未验证；在线命中 → verified；不符 → failed；
 * 单项读取异常 → 该断言未验证且不阻断其余断言；非 runtime-* 断言不受影响。
 */
import { describe, expect, it, vi } from 'vitest'

import { evaluateRuntimeAssertions, type RuntimeProbeDeps } from '../runtimeProbe'
import type { AcceptanceAssertion, AcceptanceContract } from '../../../../shared/types/agent'

function assertion(overrides: Partial<AcceptanceAssertion>): AcceptanceAssertion {
  return {
    id: 'a',
    kind: 'runtime-world',
    description: '断言',
    expected: 'mymod:ruby_block',
    status: 'pending',
    ...overrides
  }
}

function contract(assertions: AcceptanceAssertion[]): AcceptanceContract {
  return { overall: 'pending', assertions, summary: '' }
}

function deps(overrides: Partial<RuntimeProbeDeps> = {}): RuntimeProbeDeps {
  return {
    fetchBlock: async () => ({ block: 'mymod:ruby_block' }),
    fetchInventory: async () => ({ slots: [] }),
    ...overrides
  }
}

describe('evaluateRuntimeAssertions', () => {
  it('port=null（离线）→ 所有 pending runtime-* 标未验证且不读通道', async () => {
    const fetchBlock = vi.fn()
    const fetchInventory = vi.fn()
    const c = contract([
      assertion({ id: 'w1', kind: 'runtime-world', x: 0, y: 64, z: 0 }),
      assertion({ id: 'i1', kind: 'runtime-inventory' })
    ])
    const out = await evaluateRuntimeAssertions(null, c, { fetchBlock, fetchInventory })
    expect(out.assertions.every((a) => a.status === 'unverified')).toBe(true)
    expect(fetchBlock).not.toHaveBeenCalled()
    expect(fetchInventory).not.toHaveBeenCalled()
  })

  it('在线且读到相符方块 → runtime-world verified', async () => {
    const out = await evaluateRuntimeAssertions(
      9876,
      contract([assertion({ id: 'w1', kind: 'runtime-world', x: 1, y: 2, z: 3 })]),
      deps()
    )
    expect(out.assertions[0].status).toBe('verified')
  })

  it('在线但读到不符方块 → runtime-world failed', async () => {
    const out = await evaluateRuntimeAssertions(
      9876,
      contract([assertion({ id: 'w1', kind: 'runtime-world', x: 1, y: 2, z: 3 })]),
      deps({ fetchBlock: async () => ({ block: 'minecraft:air' }) })
    )
    expect(out.assertions[0].status).toBe('failed')
  })

  it('背包含期望物品 → runtime-inventory verified', async () => {
    const out = await evaluateRuntimeAssertions(
      9876,
      contract([assertion({ id: 'i1', kind: 'runtime-inventory', expected: 'mymod:ruby' })]),
      deps({ fetchInventory: async () => ({ slots: [{ id: 'mymod:ruby' }] }) })
    )
    expect(out.assertions[0].status).toBe('verified')
  })

  it('背包未含期望物品 → runtime-inventory failed', async () => {
    const out = await evaluateRuntimeAssertions(
      9876,
      contract([assertion({ id: 'i1', kind: 'runtime-inventory', expected: 'mymod:ruby' })]),
      deps({ fetchInventory: async () => ({ slots: [{ id: 'minecraft:stone' }] }) })
    )
    expect(out.assertions[0].status).toBe('failed')
  })

  it('单项读取抛异常 → 该断言未验证，其余断言照常判定，不整体失败', async () => {
    const c = contract([
      assertion({ id: 'w1', kind: 'runtime-world', x: 0, y: 0, z: 0 }),
      assertion({ id: 'i1', kind: 'runtime-inventory', expected: 'mymod:ruby' })
    ])
    const out = await evaluateRuntimeAssertions(9876, c, {
      fetchBlock: async () => {
        throw new Error('timeout')
      },
      fetchInventory: async () => ({ slots: [{ id: 'mymod:ruby' }] })
    })
    expect(out.assertions.find((a) => a.id === 'w1')?.status).toBe('unverified')
    expect(out.assertions.find((a) => a.id === 'i1')?.status).toBe('verified')
  })

  it('无 pending runtime-* → 原契约按引用返回，不触发读取', async () => {
    const fetchBlock = vi.fn()
    const c = contract([assertion({ id: 'x', kind: 'file-exists', expected: 'a.txt' })])
    const out = await evaluateRuntimeAssertions(9876, c, { fetchBlock, fetchInventory: vi.fn() })
    expect(out).toBe(c)
    expect(fetchBlock).not.toHaveBeenCalled()
  })

  it('仅处理 pending：已评估的 runtime-* 保持原状', async () => {
    const fetchBlock = vi.fn(async () => ({ block: 'mymod:ruby_block' }))
    const c = contract([
      assertion({ id: 'w0', kind: 'runtime-world', x: 0, y: 0, z: 0, status: 'failed' }),
      assertion({ id: 'w1', kind: 'runtime-world', x: 1, y: 2, z: 3 })
    ])
    const out = await evaluateRuntimeAssertions(9876, c, {
      fetchBlock,
      fetchInventory: async () => ({ slots: [] })
    })
    expect(out.assertions[0].status).toBe('failed')
    expect(out.assertions[1].status).toBe('verified')
    expect(fetchBlock).toHaveBeenCalledTimes(1)
  })
})
