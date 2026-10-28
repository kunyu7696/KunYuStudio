/**
 * TR-14.1：Spark CPU 文本树 / heap JSON 解析与归因。
 */
import { describe, expect, it } from 'vitest'
import {
  attributeSpark,
  parseSparkReport
} from '../sparkParser'
import type { PackageIndexEntry } from '../jfrParser'

const INDEX: PackageIndexEntry[] = [
  { modId: 'mod-a', modName: '模组A', prefixes: ['com.examplea'] },
  { modId: 'mod-b', modName: '模组B', prefixes: ['com.exampleb'] }
]

const CPU_TEXT = `
CPU Sampler (5s)
tick average 12.3ms
Top timings:
  55% com.examplea.foo.FooA.tick()
  25% com.exampleb.BazB.update()
  20% net.unknown.X.run()
`

const HEAP_JSON = `
{
  "averageTickMs": 10.5,
  "entries": [
    { "name": "com.examplea.foo.Thing", "bytes": 4000, "count": 10 },
    { "name": "com.exampleb.bar.Obj", "bytes": 1000, "count": 2 }
  ]
}
`

describe('parseSparkReport CPU 文本树', () => {
  it('解析节点百分比与 tick', () => {
    const r = parseSparkReport(CPU_TEXT)
    expect(r.source).toBe('cpu-tree')
    expect(r.averageTickMs).toBe(12.3)
    const a = r.nodes.find((n) => n.className === 'com.examplea.foo.FooA')
    expect(a?.weight).toBe(55)
    expect(a?.kind).toBe('cpu')
  })

  it('CPU 归因到两个模组 + 未知桶', () => {
    const r = parseSparkReport(CPU_TEXT)
    const attributed = attributeSpark(r, INDEX)
    const a = attributed.find((x) => x.modId === 'mod-a')
    const b = attributed.find((x) => x.modId === 'mod-b')
    const other = attributed.find((x) => x.modId === '__other__')
    expect(a?.cpuPercent).toBe(55)
    expect(b?.cpuPercent).toBe(25)
    expect(other?.cpuPercent).toBe(20)
  })
})

describe('parseSparkReport heap JSON', () => {
  it('解析 bytes 与 tick', () => {
    const r = parseSparkReport(HEAP_JSON)
    expect(r.source).toBe('heap-json')
    expect(r.averageTickMs).toBe(10.5)
    const a = r.nodes.find((n) => n.className === 'com.examplea.foo.Thing')
    expect(a?.weight).toBe(4000)
    expect(a?.kind).toBe('memory')
  })

  it('内存归因', () => {
    const r = parseSparkReport(HEAP_JSON)
    const attributed = attributeSpark(r, INDEX)
    const a = attributed.find((x) => x.modId === 'mod-a')
    const b = attributed.find((x) => x.modId === 'mod-b')
    expect(a?.memoryBytes).toBe(4000)
    expect(b?.memoryBytes).toBe(1000)
  })
})

describe('parseSparkReport 异常', () => {
  it('空文本 unknown', () => {
    expect(parseSparkReport('').source).toBe('unknown')
  })
  it('坏 JSON unknown', () => {
    expect(parseSparkReport('{bad json').source).toBe('unknown')
  })
})
