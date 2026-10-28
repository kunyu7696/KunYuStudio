import { describe, expect, it } from 'vitest'
import {
  blockSettingsExpr,
  blockSettingsImport,
  buildGradle,
  gradleProperties,
  identifierFactoryCall,
  isModernBlockSettings,
  mainClass,
  modBlocksClass,
  modItemsClass,
  type FabricTemplateVars
} from '../fabricTemplates'

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

const baseVars: FabricTemplateVars = {
  modId: 'mymod',
  modName: 'My Mod',
  version: '1.0.0',
  packageName: 'com.example.mymod',
  mcVersion: '1.20.1',
  loaderVersion: '0.15.11',
  fabricVersion: '0.92.1+1.20.1',
  yarnVersion: '1.20.1+build.10',
  loomVersion: '1.6-SNAPSHOT',
  gradleVersion: '8.10.2',
  jdk: 17
}

describe('fabric buildGradle 括号配平（矩阵门禁曾抓到 loom 块缺闭合导致 Groovy 解析失败）', () => {
  it.each(['1.20.1', '1.20.6', '1.21.5'] as const)('mcVersion=%s 两个镜像源均配平', (mcVersion) => {
    for (const mirror of ['china', 'official'] as const) {
      const script = buildGradle({ ...baseVars, mcVersion }, mirror)
      const { braces, parens } = balanceOf(script)
      expect(braces, `${mirror} 镜像下花括号未配平`).toBe(0)
      expect(parens, `${mirror} 镜像下圆括号未配平`).toBe(0)
    }
  })

  it('含 GeckoLib 变体也配平（仓库/依赖注入块带尾部花括号拼接）', () => {
    const script = buildGradle({ ...baseVars, geckolibVersion: '4.4.9' })
    expect(balanceOf(script).braces).toBe(0)
  })
})

describe('FabricBlockSettings 版本断点（1.21.4+ 改用 Block.Settings.create()）', () => {
  it.each([
    ['1.20.1', false],
    ['1.21.3', false],
    ['1.21.4', true],
    ['1.21.5', true],
    ['1.22.0', true]
  ] as const)('mcVersion=%s → isModernBlockSettings=%s', (mcVersion, expected) => {
    expect(isModernBlockSettings(mcVersion)).toBe(expected)
  })

  it('1.21.4+ 不导入 FabricBlockSettings，表达式用 Block.Settings.create()', () => {
    expect(blockSettingsImport('1.21.5')).toBe('')
    expect(blockSettingsExpr('1.21.5')).toBe('Block.Settings.create()')
  })

  it('1.21.3 及以下导入 FabricBlockSettings，表达式用 FabricBlockSettings.create()', () => {
    expect(blockSettingsImport('1.21.3')).toContain('FabricBlockSettings')
    expect(blockSettingsExpr('1.21.3')).toBe('FabricBlockSettings.create()')
  })

  it('modBlocksClass 模板 1.21.5 输出不含 FabricBlockSettings（编译期包不存在）', () => {
    const src = modBlocksClass({ ...baseVars, mcVersion: '1.21.5' })
    expect(src).not.toContain('FabricBlockSettings')
    expect(src).toContain('Block.Settings.create()')
  })

  it('modBlocksClass 模板 1.20.1 仍用 FabricBlockSettings.create()', () => {
    const src = modBlocksClass({ ...baseVars, mcVersion: '1.20.1' })
    expect(src).toContain('FabricBlockSettings.create()')
  })
})

describe('26.3 Fabric（Mojang 官方映射 / Loom 1.18 / Java 25）：对齐官方 fabric-example-mod 26.3 分支', () => {
  const vars263: FabricTemplateVars = {
    ...baseVars,
    mcVersion: '26.3',
    loaderVersion: '0.19.5',
    fabricVersion: '0.162.0+26.3',
    yarnVersion: '',
    loomVersion: '1.18-SNAPSHOT',
    gradleVersion: '9.7.1',
    jdk: 25
  }

  it('build.gradle：插件 id 带 net.fabricmc 前缀，无 yarn mappings，loader/api 用 implementation，release 25', () => {
    for (const mirror of ['china', 'official'] as const) {
      const script = buildGradle(vars263, mirror)
      expect(script, mirror).toContain("id 'net.fabricmc.fabric-loom' version '1.18-SNAPSHOT'")
      expect(script, mirror).not.toContain('yarn')
      expect(script, mirror).not.toMatch(/mappings\s+/)
      expect(script, mirror).toContain('implementation "net.fabricmc:fabric-loader:')
      expect(script, mirror).toContain('implementation "net.fabricmc.fabric-api:fabric-api:')
      expect(script, mirror).toContain('it.options.release = 25')
      expect(script, mirror).toContain('VERSION_25')
      expect(script, mirror).not.toContain('modImplementation')
      expect(balanceOf(script).braces, `${mirror} 花括号未配平`).toBe(0)
      expect(balanceOf(script).parens, `${mirror} 圆括号未配平`).toBe(0)
    }
  })

  it('gradle.properties：无 yarn_mappings 行（26.x Yarn 无构建）', () => {
    const props = gradleProperties(vars263)
    expect(props).not.toContain('yarn')
    expect(props).toContain('minecraft_version=26.3')
    expect(props).toContain('loader_version=0.19.5')
  })

  it('Identifier 走 resources.Identifier.fromNamespaceAndPath（不再是 net.minecraft.util.Identifier.of）', () => {
    expect(identifierFactoryCall('26.3')).toBe('Identifier.fromNamespaceAndPath')
    const main = mainClass(vars263)
    expect(main).toContain('import net.minecraft.resources.Identifier;')
    expect(main).toContain('Identifier.fromNamespaceAndPath')
    expect(main).not.toContain('net.minecraft.util.Identifier')
  })

  it('modBlocksClass：Mojmap 导入 + setId(ResourceKey) + BuiltInRegistries + noOcclusion 体系', () => {
    const src = modBlocksClass(vars263)
    expect(src).toContain('import net.minecraft.world.level.block.Block;')
    expect(src).toContain('import net.minecraft.world.level.block.state.BlockBehaviour;')
    expect(src).toContain('import net.minecraft.core.registries.BuiltInRegistries;')
    expect(src).toContain('import net.minecraft.resources.ResourceKey;')
    expect(src).toContain('BlockBehaviour.Properties.of()')
    expect(src).toContain('.setId(ResourceKey.create(Registries.BLOCK')
    expect(src).toContain('.requiresCorrectToolForDrops()')
    expect(src).toContain('Registry.register(BuiltInRegistries.BLOCK,')
    expect(src).not.toContain('net.minecraft.block.Block')
  })

  it('modItemsClass：world.item 包 + Item.Properties().setId + BuiltInRegistries.ITEM', () => {
    const src = modItemsClass(vars263)
    expect(src).toContain('import net.minecraft.world.item.BlockItem;')
    expect(src).toContain('import net.minecraft.world.item.Item;')
    expect(src).toContain('new Item.Properties().setId(ResourceKey.create(Registries.ITEM,')
    expect(src).toContain('Registry.register(BuiltInRegistries.ITEM,')
    expect(src).not.toContain('Item.Settings')
  })
})
