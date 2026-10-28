/**
 * Gradle done 等待表单测（P1-12）：
 * 正常投递 / watchdog 超时收口 / watchdog 与事件竞争 / 无 watchdog 兼容旧行为。
 * 用假时钟直测，不依赖真实 orchestrator 会话。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGradleWaiterTable } from '../gradleWaiter'

describe('createGradleWaiterTable（P1-12）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('done 事件正常投递时按事件结果收口', async () => {
    const t = createGradleWaiterTable()
    const p = t.wait('r1')
    t.deliver('r1', { exitCode: 0, cancelled: false, timedOut: false })
    await expect(p).resolves.toEqual({ exitCode: 0, cancelled: false, timedOut: false })
  })

  it('watchdog：done 事件永不到达时按 timedOut=true 收口（不再永久挂起）', async () => {
    const t = createGradleWaiterTable()
    const p = t.wait('r1', 5000)
    await vi.advanceTimersByTimeAsync(5001)
    await expect(p).resolves.toEqual({ exitCode: null, cancelled: false, timedOut: true })
  })

  it('done 先到则 watchdog 被清除，不会覆盖真实结果', async () => {
    const t = createGradleWaiterTable()
    const p = t.wait('r1', 1000)
    t.deliver('r1', { exitCode: 1, cancelled: false, timedOut: false })
    await vi.advanceTimersByTimeAsync(2000)
    await expect(p).resolves.toEqual({ exitCode: 1, cancelled: false, timedOut: false })
  })

  it('watchdog 先收口后，晚到的 deliver 不再生效（settle 守卫）', async () => {
    const t = createGradleWaiterTable()
    const p = t.wait('r1', 1000)
    await vi.advanceTimersByTimeAsync(1001)
    t.deliver('r1', { exitCode: 0, cancelled: false, timedOut: false })
    await expect(p).resolves.toEqual({ exitCode: null, cancelled: false, timedOut: true })
  })

  it('不传 timeoutMs 时保持旧行为（只等事件，无 watchdog）', async () => {
    const t = createGradleWaiterTable()
    const p = t.wait('r1')
    let settled = false
    void p.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(settled).toBe(false)
    t.deliver('r1', { exitCode: 0, cancelled: false, timedOut: false })
    await expect(p).resolves.toEqual({ exitCode: 0, cancelled: false, timedOut: false })
  })
})
