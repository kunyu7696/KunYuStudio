import { describe, expect, it } from 'vitest'
import { analyzeCrashReport, diagnose, scanGameLog } from '../crashAnalyzer'

const CRASH_MISSING_DEP = `---- Minecraft Crash Report ----

Description: Initializing game

java.lang.RuntimeException: Could not execute entrypoint stage 'main' due to errors, provided by 'mymod'!
\tat net.fabricmc.loader.impl.entrypoint.EntrypointUtils.lambda$invoke0$0(EntrypointUtils.java:51)
\tat com.example.mymod.MyMod.onInitialize(MyMod.java:14)
Caused by: java.lang.NoClassDefFoundError: net/fabricmc/fabric/api/object/builder/v1/Block
\tat com.example.mymod.registry.ModBlocks.register(ModBlocks.java:11)
\tat com.example.mymod.MyMod.onInitialize(MyMod.java:12)
Caused by: java.lang.ClassNotFoundException: net.fabricmc.fabric.api.object.builder.v1.Block
\tat java.base/jdk.internal.loader.BuiltinClassLoader.loadClass(BuiltinClassLoader.java:641)

A detailed walkthrough of the error, its code path and all known details is as follows:
`

const CRASH_DUP_REG = `Description: Registering blocks

net.minecraft.util.Identifier注册异常
java.lang.IllegalStateException: Block minecraft:sodium_fluid was already registered!
\tat net.minecraft.registry.Registry.register(Registry.java:120)
\tat com.example.mymod.registry.ModBlocks.register(ModBlocks.java:22)
`

describe('analyzeCrashReport', () => {
  it('识别缺依赖（取最后一条 Caused by 为根因）', () => {
    const d = analyzeCrashReport(CRASH_MISSING_DEP, 'run/crash-reports/crash-2026.txt')
    expect(d.category).toBe('missing-dependency')
    expect(d.headline).toContain('依赖')
    expect(d.cause).toContain('ClassNotFoundException')
    expect(d.suggestion).toContain('依赖')
    expect(d.evidence.length).toBeGreaterThan(0)
    expect(d.evidence[0]).toContain('Caused by')
    expect(d.reportPath).toBe('run/crash-reports/crash-2026.txt')
  })

  it('识别重复注册', () => {
    const d = analyzeCrashReport(CRASH_DUP_REG)
    expect(d.category).toBe('duplicate-registration')
    expect(d.suggestion).toMatch(/注册|entrypoint/)
  })

  it('无 Description 时兜底不抛错', () => {
    const d = analyzeCrashReport('garbage content without structure')
    expect(d.category).toBe('unknown')
    expect(d.suggestion).toContain('完整崩溃报告')
    expect(d.reportPath).toBeUndefined()
  })

  it('识别 NPE 并给栈帧定位建议', () => {
    const text = `Description: Ticking entity

java.lang.NullPointerException: Cannot invoke "net.minecraft.world.World.getBlockState()" because "this.level" is null
\tat com.example.mymod.entity.Golem.tick(Golem.java:42)
`
    const d = analyzeCrashReport(text)
    expect(d.category).toBe('npe')
    expect(d.suggestion).toContain('null')
  })
})

describe('scanGameLog', () => {
  it('抽取高价值 ERROR 并去重', () => {
    const log = [
      '[09:00:01] [main/INFO]: Loading Minecraft 1.20.1',
      '[09:00:02] [main/ERROR]: Mixin apply failed modid.mixins.json:MyMixin -> net.minecraft.client.Minecraft',
      '[09:00:03] [main/ERROR]: Mixin apply failed modid.mixins.json:MyMixin -> net.minecraft.client.Minecraft',
      '[09:00:04] [Render thread/WARN]: @Inject conflict some warning without pattern',
      '[09:00:05] [Render thread/ERROR]: java.lang.ClassNotFoundException: com.foo.Bar'
    ].join('\n')
    const f = scanGameLog(log)
    const patterns = f.map((x) => x.pattern)
    expect(patterns).toContain('mixin-apply-failed')
    expect(patterns).toContain('missing-class')
    // 重复行只保留一条
    expect(f.filter((x) => x.pattern === 'mixin-apply-failed')).toHaveLength(1)
  })

  it('无问题日志返回空数组', () => {
    const log = '[09:00:01] [main/INFO]: Sound engine started\n[09:00:02] [main/INFO]: OpenAL initialized'
    expect(scanGameLog(log)).toEqual([])
  })

  it('只有通用异常时兜底返回（限 10 条）', () => {
    const log = Array.from({ length: 20 }, (_, i) => `[09:00:0${i}] [t/ERROR]: java.lang.IllegalStateException: boom ${i}`).join('\n')
    const f = scanGameLog(log)
    expect(f.length).toBe(10)
    expect(f[0].pattern).toBe('generic-exception')
  })
})

describe('diagnose', () => {
  it('crash-report 优先于日志', () => {
    const d = diagnose({ reportText: CRASH_DUP_REG, logText: '[t/ERROR]: java.lang.NullPointerException: x' })
    expect(d!.category).toBe('duplicate-registration')
  })

  it('无崩溃报告时用日志归因', () => {
    const d = diagnose({ reportText: null, logText: '[t/ERROR]: Mixin apply failed foo.mixins.json' })
    expect(d!.category).toBe('mixin')
  })

  it('两者皆无返回 null', () => {
    expect(diagnose({ reportText: '', logText: '[main/INFO]: all good' })).toBeNull()
  })
})
