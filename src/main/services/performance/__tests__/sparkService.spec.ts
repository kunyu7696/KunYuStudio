/**
 * TR-14.1：Spark 服务三路径与降级。
 * - 在线路径（kunyu-observer /v1/server-command）归因成功
 * - 离线路径给引导且流程可继续（手动导入被解析）
 */
import { describe, expect, it, vi } from 'vitest'
import { collectAndAttributeSpark } from '../sparkService'
import type { PackageIndexEntry } from '../jfrParser'

const INDEX: PackageIndexEntry[] = [
  { modId: 'mod-a', modName: '模组A', prefixes: ['com.examplea'] }
]

const CPU_TEXT = `
  55% com.examplea.foo.FooA.tick()
  45% net.unknown.X.run()
`

function onlineRunCommand(output: string | null) {
  return vi.fn(async () => {
    if (output === null) throw new Error('boom')
    return { ok: true as const, command: 'spark profiler stop --copy-output', result: 1, lines: [output], output }
  })
}

describe('collectAndAttributeSpark', () => {
  it('在线路径：server-command 取回报告并归因', async () => {
    const result = await collectAndAttributeSpark({
      observerPort: 9876,
      runCommand: onlineRunCommand(CPU_TEXT),
      projectPath: null,
      manual: null,
      index: INDEX
    })
    expect(result.path).toBe('online')
    expect(result.attributed[0].modId).toBe('mod-a')
    expect(result.attributed[0].cpuPercent).toBe(55)
  })

  it('在线失败 → 手动导入文本被解析（流程可继续）', async () => {
    const result = await collectAndAttributeSpark({
      observerPort: 9876,
      runCommand: onlineRunCommand(null),
      projectPath: null,
      manual: CPU_TEXT,
      index: INDEX
    })
    expect(result.path).toBe('manual')
    expect(result.attributed[0].modId).toBe('mod-a')
  })

  it('全不可用：返回引导且 attributed 为空，流程可继续', async () => {
    const result = await collectAndAttributeSpark({
      observerPort: null,
      projectPath: null,
      manual: null,
      index: INDEX
    })
    expect(result.path).toBe('unavailable')
    expect(result.guide).toBeTruthy()
    expect(result.attributed).toEqual([])
  })
})
