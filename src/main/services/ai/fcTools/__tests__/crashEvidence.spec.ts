/**
 * crashEvidence 单测（P10：崩溃/启动标准化证据清单）。
 * 三项硬证据：ready-line / 最深 Caused by / 首个自有栈帧；渲染空段跳过。
 */
import { describe, expect, it } from 'vitest'
import { extractCrashEvidence, renderCrashEvidence } from '../crashEvidence'

const CRASH = [
  '---- Minecraft Crash Report ----',
  'Description: Ticking entity',
  'java.lang.NullPointerException: Cannot invoke tick()',
  '\tat net.minecraft.server.MinecraftServer.tickWorlds(MinecraftServer.java:899)',
  'Caused by: java.lang.IllegalStateException: registry frozen',
  '\tat net.minecraft.registry.SimpleRegistry.set(SimpleRegistry.java:120)',
  'Caused by: com.example.thiefmod.BadConfigException: missing loot table',
  '\tat com.example.thiefmod.ThiefEntity.loadLoot(ThiefEntity.java:42)',
  '\tat net.minecraft.entity.Entity.readNbt(Entity.java:2333)'
].join('\n')

describe('extractCrashEvidence', () => {
  it('最深 Caused by 取链尾（根因不看顶行），链深度正确', () => {
    const ev = extractCrashEvidence(CRASH, ['thiefmod'])
    expect(ev.deepestCausedBy).toContain('BadConfigException')
    expect(ev.causedByDepth).toBe(2)
  })

  it('首个自有栈帧命中自有包，跳过 minecraft 运行时帧', () => {
    const ev = extractCrashEvidence(CRASH, ['thiefmod'])
    expect(ev.firstOwnFrame).toContain('com.example.thiefmod.ThiefEntity.loadLoot')
  })

  it('ready-line：Done 行被捕获', () => {
    const log = '[12:00:00] [Server thread/INFO]: Done (3.21s)! For help, type "help"'
    expect(extractCrashEvidence(log).readyLine).toContain('Done (3.21s)!')
  })

  it('无异常链/无就绪行 → 全 null，渲染为空串', () => {
    const ev = extractCrashEvidence('[INFO] starting\n[INFO] stopping')
    expect(ev.readyLine).toBeNull()
    expect(ev.deepestCausedBy).toBeNull()
    expect(ev.firstOwnFrame).toBeNull()
    expect(ev.causedByDepth).toBe(0)
    expect(renderCrashEvidence(ev)).toBe('')
  })

  it('hints 为空时 firstOwnFrame 恒 null（无法判定归属，不猜）', () => {
    const ev = extractCrashEvidence(CRASH, [])
    expect(ev.firstOwnFrame).toBeNull()
    expect(ev.deepestCausedBy).not.toBeNull()
  })

  it('hints 大小写不敏感', () => {
    const ev = extractCrashEvidence(CRASH, ['THIEFMOD'])
    expect(ev.firstOwnFrame).toContain('ThiefEntity')
  })
})

describe('renderCrashEvidence', () => {
  it('三项齐全渲染三行清单', () => {
    const ev = extractCrashEvidence(`Done (1.0s)!\n${CRASH}`, ['thiefmod'])
    const out = renderCrashEvidence(ev)
    expect(out).toContain('标准化证据清单')
    expect(out).toContain('就绪证据')
    expect(out).toContain('最深 Caused by（2 层链')
    expect(out).toContain('首个自有栈帧')
  })
})
