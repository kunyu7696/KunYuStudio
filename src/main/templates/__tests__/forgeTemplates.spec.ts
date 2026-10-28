import { describe, expect, it } from 'vitest'
import {
  FORGE_MOJANG_PACK_FORMAT,
  forgeBuildGradle,
  forgeClientClass,
  forgeGradleProperties,
  forgeMainClass,
  forgeModBlocksClass,
  forgeModItemsClass,
  forgeModsToml,
  forgePackMcmeta,
  forgeSettingsGradle,
  type ForgeTemplateVars
} from '../forgeTemplates'

/** 括号配平计数（忽略字符串与注释内的括号） */
function balanceOf(script: string): { braces: number; parens: number } {
  let braces = 0
  let parens = 0
  let inLineComment = false
  let inBlockComment = false
  let quote: string | null = null
  for (let i = 0; i < script.length; i++) {
    const ch = script[i]
    const next = script[i + 1]
    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i++
      }
      continue
    }
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && next === '/') {
      inLineComment = true
      i++
      continue
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true
      i++
      continue
    }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === '{') braces++
    else if (ch === '}') braces--
    else if (ch === '(') parens++
    else if (ch === ')') parens--
  }
  return { braces, parens }
}

const vars263: ForgeTemplateVars = {
  modId: 'mymod',
  modName: 'My Mod',
  version: '1.0.0',
  packageName: 'com.example.mymod',
  mcVersion: '26.3',
  forgeVersion: '66.0.11',
  loomLikeVersion: '[7.0.17,8)',
  gradleVersion: '9.7.1',
  jdk: 25,
  forgeConstructorStyle: 'modbusgroup'
}

describe('Forge 26.3（FG7 mavenizer / Java 25）：对齐官方 forge-26.3-66.0.11 MDK', () => {
  it('build.gradle：mavenizer + eventbus-validator + 坐标参数化，无 mappings channel', () => {
    for (const mirror of ['china', 'official'] as const) {
      const script = forgeBuildGradle(vars263, mirror)
      expect(script, mirror).toContain("id 'net.minecraftforge.gradle' version '[7.0.17,8)'")
      expect(script, mirror).toContain('minecraft.mavenizer(it)')
      expect(script, mirror).toContain('maven fg.forgeMaven')
      expect(script, mirror).toContain('maven fg.minecraftLibsMaven')
      expect(script, mirror).toContain(
        'implementation minecraft.dependency("net.minecraftforge:forge:${project.minecraft_version}-${project.forge_version}")'
      )
      expect(script, mirror).toContain("annotationProcessor 'net.minecraftforge:eventbus-validator:7.0.6'")
      expect(script, mirror).toContain('JavaLanguageVersion.of(25)')
      expect(script, mirror).toContain("register('client')")
      // S-05：javaagent 形态（kunyu-observer-agent），覆盖全加载器全版本
      expect(script, mirror).toContain("findProperty('kunyu.observer.agent')")
      expect(script, mirror).toContain('-javaagent:')
      // FG7 不再有 FG4/5/6 的 mappings channel/version DSL 行
      expect(script, mirror).not.toMatch(/^\s*mappings channel/m)
      expect(script, mirror).not.toMatch(/^\s*minecraft 'net\.minecraftforge:forge/m)
      expect(balanceOf(script).braces, `${mirror} 花括号未配平`).toBe(0)
      expect(balanceOf(script).parens, `${mirror} 圆括号未配平`).toBe(0)
    }
  })

  it('china 镜像在 mavenizer 之后插入 aliyun/BMCL，且不丢 fg.* maven', () => {
    const script = forgeBuildGradle(vars263, 'china')
    expect(script.indexOf('minecraft.mavenizer(it)')).toBeLessThan(script.indexOf('maven.aliyun.com'))
    expect(script.indexOf('maven.aliyun.com')).toBeLessThan(script.indexOf('maven fg.forgeMaven'))
  })

  it('gradle.properties：含 merge-source-sets=true 与版本属性', () => {
    const props = forgeGradleProperties(vars263)
    expect(props).toContain('net.minecraftforge.gradle.merge-source-sets=true')
    expect(props).toContain('minecraft_version=26.3')
    expect(props).toContain('forge_version=66.0.11')
  })

  it('settings.gradle：Gradle 9.7.1 → foojay 1.0.0', () => {
    const settings = forgeSettingsGradle('official', '9.7.1')
    expect(settings).toContain("id 'org.gradle.toolchains.foojay-resolver-convention' version '1.0.0'")
  })

  it('mods.toml：loader/forge 区间 [66,)，minecraft [26.3,26.4)', () => {
    const toml = forgeModsToml(vars263)
    expect(toml).toContain('loaderVersion="[66,)"')
    expect(toml).toContain('versionRange="[66,)"')
    expect(toml).toContain('versionRange="[26.3,26.4)"')
  })

  it('pack.mcmeta：仅 min_format/max_format=121（无 pack_format）', () => {
    expect(FORGE_MOJANG_PACK_FORMAT).toBe(121)
    const meta = JSON.parse(forgePackMcmeta(vars263)) as {
      pack: { description: string; min_format: number; max_format: number; pack_format?: number }
    }
    expect(meta.pack.min_format).toBe(121)
    expect(meta.pack.max_format).toBe(121)
    expect(meta.pack.pack_format).toBeUndefined()
  })

  it('主类：modbusgroup 构造风格（FMLJavaModLoadingContext + getModBusGroup），不再注入 IEventBus', () => {
    const src = forgeMainClass(vars263)
    expect(src).toContain('public MymodMod(FMLJavaModLoadingContext context)')
    expect(src).toContain('var modBusGroup = context.getModBusGroup();')
    expect(src).toContain('ModBlocks.BLOCKS.register(modBusGroup)')
    expect(src).toContain('FMLCommonSetupEvent.getBus(modBusGroup).addListener(this::commonSetup)')
    expect(src).toContain('import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;')
    expect(src).not.toContain('IEventBus')
    expect(src).not.toContain('MinecraftForge.EVENT_BUS')
  })

  it('ModBlocks/ModItems：Properties 强制 setId(DeferredRegister.key(...))', () => {
    const blocks = forgeModBlocksClass(vars263)
    expect(blocks).toContain('.setId(BLOCKS.key("example_block"))')
    const items = forgeModItemsClass(vars263)
    expect(items).toContain('.setId(ITEMS.key("example_block"))')
    expect(items).toContain('.setId(ITEMS.key("example_item"))')
  })

  it('客户端类：SubscribeEvent 迁至 eventbus.api.listener 包，订阅注解默认 MOD 总线不写 bus 参数', () => {
    const src = forgeClientClass(vars263)
    expect(src).toContain('import net.minecraftforge.eventbus.api.listener.SubscribeEvent;')
    expect(src).toContain('@Mod.EventBusSubscriber(modid = MymodMod.MOD_ID, value = Dist.CLIENT)')
    expect(src).not.toContain('eventbus.api.SubscribeEvent')
    expect(src).not.toContain('Bus.MOD')
  })
})

describe('Forge 旧版回归：1.20.1 仍走 FG6 / classic 构造器 / 旧 SubscribeEvent 包', () => {
  const varsLegacy: ForgeTemplateVars = {
    ...vars263,
    mcVersion: '1.20.1',
    forgeVersion: '47.4.23',
    loomLikeVersion: '[6.0,6.2)',
    gradleVersion: '8.10.2',
    jdk: 17,
    forgeConstructorStyle: 'classic'
  }

  it('build.gradle 保留 mappings channel=official，FG7 元素不出现', () => {
    const script = forgeBuildGradle(varsLegacy, 'china')
    expect(script).toContain("mappings channel: 'official'")
    expect(script).not.toContain('minecraft.mavenizer(it)')
    expect(script).not.toContain('eventbus-validator')
  })

  it('主类为无参构造器 + FMLJavaModLoadingContext.get()；客户端仍用旧包', () => {
    const src = forgeMainClass(varsLegacy)
    expect(src).toContain('public MymodMod()')
    expect(src).toContain('FMLJavaModLoadingContext.get().getModEventBus()')
    expect(forgeClientClass(varsLegacy)).toContain(
      'import net.minecraftforge.eventbus.api.SubscribeEvent;'
    )
  })
})
