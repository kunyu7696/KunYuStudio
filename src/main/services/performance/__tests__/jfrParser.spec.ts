/**
 * TR-13.1：jfr print 固化样本解析与归因。
 * - 两个不同包名热点归因到两个模组
 * - 未知包名归入「其他 / 原版」
 */
import { describe, expect, it } from 'vitest'
import {
  attributeHotspots,
  OTHER_MOD,
  parseJfrPrint,
  type PackageIndexEntry
} from '../jfrParser'

/** 固化的 jfr print 样本（4 次 ExecutionSample：A×2 / B×1 / 未知×1） */
const SAMPLE = `
jdk.ExecutionSample {
  startTime = 10:00:00
  sampledThread = "Server thread"
  state = "STATE_RUNNABLE"
  stackTrace = [
    com.examplea.foo.FooA.tick(FooA.java:10)
    net.minecraft.server.MinecraftServer.tick(MinecraftServer.java:500)
    java.lang.Thread.run(Thread.java:829)
  ]
}

jdk.ExecutionSample {
  startTime = 10:00:01
  sampledThread = "Server thread"
  state = "STATE_RUNNABLE"
  stackTrace = [
    com.examplea.foo.FooA.tick(FooA.java:11)
    net.minecraft.server.MinecraftServer.tick(MinecraftServer.java:501)
  ]
}

jdk.ExecutionSample {
  startTime = 10:00:02
  stackTrace = [
    com.exampleb.bar.BazB.update(BazB.java:22)
    net.minecraft.server.MinecraftServer.tick(MinecraftServer.java:502)
  ]
}

jdk.ExecutionSample {
  startTime = 10:00:03
  stackTrace = [
    net.unknown.thing.X.doStuff(X.java:1)
    java.lang.Thread.run(Thread.java:829)
  ]
}

jdk.ObjectAllocationSample {
  startTime = 10:00:04
  objectClass = com.examplea.foo.Thing
  weight = 1024
  eventThread = "Server thread"
}
`

const INDEX: PackageIndexEntry[] = [
  { modId: 'mod-a', modName: '模组A', prefixes: ['com.examplea'] },
  { modId: 'mod-b', modName: '模组B', prefixes: ['com.exampleb'] }
]

describe('parseJfrPrint', () => {
  it('解析样本数与栈顶热点', () => {
    const r = parseJfrPrint(SAMPLE)
    expect(r.totalSamples).toBe(4)
    // A 热点 2 次（栈顶），B 1 次
    const fooA = r.hotspots.find((h) => h.className === 'com.examplea.foo.FooA')
    expect(fooA?.samples).toBe(2)
    expect(fooA?.method).toBe('tick')
    expect(fooA?.package).toBe('com.examplea.foo')
    const bazB = r.hotspots.find((h) => h.className === 'com.exampleb.bar.BazB')
    expect(bazB?.samples).toBe(1)
  })

  it('解析 objectClass 分配事件', () => {
    const r = parseJfrPrint(SAMPLE)
    const alloc = r.allocations.find((a) => a.className === 'com.examplea.foo.Thing')
    expect(alloc?.count).toBe(1)
  })

  it('空输入不崩', () => {
    const r = parseJfrPrint('')
    expect(r.totalSamples).toBe(0)
    expect(r.hotspots).toEqual([])
  })
})

describe('attributeHotspots（TR-13.1）', () => {
  it('两个不同包名热点归因到两个模组', () => {
    const r = parseJfrPrint(SAMPLE)
    const attributed = attributeHotspots(r, INDEX)
    const a = attributed.find((x) => x.modId === 'mod-a')
    const b = attributed.find((x) => x.modId === 'mod-b')
    expect(a?.samples).toBe(2)
    expect(a?.selfPercent).toBe(50)
    expect(a?.modName).toBe('模组A')
    expect(b?.samples).toBe(1)
    expect(b?.selfPercent).toBe(25)
  })

  it('未知包名归入「其他 / 原版」', () => {
    const r = parseJfrPrint(SAMPLE)
    const attributed = attributeHotspots(r, INDEX)
    const other = attributed.find((x) => x.modId === OTHER_MOD.modId)
    expect(other?.modName).toBe('其他 / 原版')
    expect(other?.samples).toBe(1)
    expect(other?.selfPercent).toBe(25)
  })

  it('前缀边界安全：com.examplea 不误匹配 com.exampleab', () => {
    const r = parseJfrPrint(`
jdk.ExecutionSample {
  stackTrace = [
    com.exampleab.evil.Fake.tick(Fake.java:1)
  ]
}
`)
    const attributed = attributeHotspots(r, INDEX)
    // com.exampleab 不应归因 mod-a，应落入 other
    expect(attributed).toHaveLength(1)
    expect(attributed[0].modId).toBe(OTHER_MOD.modId)
  })
})
