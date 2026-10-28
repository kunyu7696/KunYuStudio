/**
 * P0-1 legacy API 分派回归：
 * Fabric legacy（1.16.5/1.18.2/1.19.2）无 net.minecraft.registry 包（1.19.3 起）、
 * 无 Registries 类（常量挂 Registry.X 静态字段）、无 ItemGroups/ItemGroupEvents、
 * FabricBlockSettings 无 create() 工厂、Yarn 1.19.4 起 notSolid() 更名 nonOpaque()。
 * 单点分派在 templates/fabricTemplates.ts，模板/生成器/FC 工具共用——本文件按版本三段
 * （legacy / 1.19.3~1.21.3 / 现代）锁定断点边界与产物形态。
 */
import { describe, expect, it } from 'vitest'
import {
  blockSettingsExpr,
  blockSettingsImport,
  gradlewSh,
  identifierFactoryCall,
  isLegacyRegistry,
  nonOpaqueCall,
  registryImports,
  registriesConst,
  modBlocksClass,
  modItemsClass,
  type FabricTemplateVars
} from '../../templates/fabricTemplates'
import { toGeneratorBlock } from '../blockAdapter'
import { generateModBlocksJava } from '../contentGenerator/javaBlocks'
import { generateModItemsJava } from '../contentGenerator/javaItems'
import { fabricModEntitiesJava } from '../contentGenerator/javaEntities'
import { generateModEnchantmentsJava } from '../enchantmentCodegen'
import { createDefaultBlock } from '../../../shared/schemas/block.schema'
import { createDefaultItem } from '../../../shared/schemas/item.schema'
import { createDefaultEntity } from '../../../shared/schemas/entity.schema'
import { createDefaultEnchantment } from '../../../shared/schemas/enchantment.schema'

const LEGACY_VERSIONS = ['1.16.5', '1.18.2', '1.19.2'] as const
const MODERN_REGISTRY_VERSIONS = ['1.19.3', '1.20.1', '1.21.1'] as const

function ctxFor(mcVersion: string) {
  return {
    loader: 'fabric' as const,
    mcVersion,
    modId: 'testmod',
    modClassName: 'TestmodMod',
    packageName: 'com.kunyu.testmod',
    mavenGroup: 'com.kunyu.testmod',
    packageDiverged: false,
    pkgPath: 'com/kunyu/testmod',
    javaDir: 'java',
    registryDir: 'java/com/kunyu/testmod/registry',
    resourcesDir: 'res',
    assetsDir: 'res/assets/testmod',
    dataDir: 'res/data'
  }
}

function varsFor(mcVersion: string): FabricTemplateVars {
  return {
    modId: 'testmod',
    modName: 'Test Mod',
    version: '0.1.0',
    packageName: 'com.kunyu.testmod',
    mcVersion,
    loaderVersion: '0.15.11',
    fabricVersion: '0.92.1+1.20.1',
    yarnVersion: '1.20.1+build.10',
    loomVersion: '1.6-SNAPSHOT',
    gradleVersion: '8.10.2',
    jdk: 17
  }
}

describe('registry 断点真值表', () => {
  it('legacy 三版本为真，1.19.3 起为假', () => {
    for (const v of LEGACY_VERSIONS) expect(isLegacyRegistry(v)).toBe(true)
    for (const v of MODERN_REGISTRY_VERSIONS) expect(isLegacyRegistry(v)).toBe(false)
  })

  it('registryImports：legacy 只有 util.registry.Registry 一行', () => {
    expect(registryImports('1.18.2')).toBe('import net.minecraft.util.registry.Registry;\n')
    expect(registryImports('1.20.1')).toBe(
      'import net.minecraft.registry.Registries;\nimport net.minecraft.registry.Registry;\n'
    )
  })

  it('registriesConst：legacy 常量挂 Registry 静态字段', () => {
    expect(registriesConst('1.16.5', 'BLOCK')).toBe('Registry.BLOCK')
    expect(registriesConst('1.18.2', 'ITEM')).toBe('Registry.ITEM')
    expect(registriesConst('1.19.2', 'ENTITY_TYPE')).toBe('Registry.ENTITY_TYPE')
    expect(registriesConst('1.19.2', 'ENCHANTMENT')).toBe('Registry.ENCHANTMENT')
    expect(registriesConst('1.20.1', 'ITEM')).toBe('Registries.ITEM')
  })

  it('BlockSettings：legacy 走 of(Material)，1.19.3+ 走 create()，1.21.4+ 走 Block.Settings', () => {
    expect(blockSettingsExpr('1.16.5')).toBe('FabricBlockSettings.of(Material.STONE)')
    expect(blockSettingsImport('1.18.2')).toContain('import net.minecraft.block.Material;')
    expect(blockSettingsExpr('1.20.1')).toBe('FabricBlockSettings.create()')
    expect(blockSettingsExpr('1.21.4')).toBe('Block.Settings.create()')
  })

  it('notSolid→nonOpaque 更名断点在 1.19.4', () => {
    expect(nonOpaqueCall('1.18.2')).toBe('.notSolid()')
    expect(nonOpaqueCall('1.19.2')).toBe('.notSolid()')
    expect(nonOpaqueCall('1.19.3')).toBe('.notSolid()')
    expect(nonOpaqueCall('1.19.4')).toBe('.nonOpaque()')
  })

  it('Identifier 工厂断点在 1.21', () => {
    expect(identifierFactoryCall('1.20.1')).toBe('new Identifier')
    expect(identifierFactoryCall('1.21.1')).toBe('Identifier.of')
  })
})

describe('脚手架（模板）legacy 形态', () => {
  it('modBlocksClass/modItemsClass legacy 三版本不出现 net.minecraft.registry', () => {
    for (const v of LEGACY_VERSIONS) {
      const blocks = modBlocksClass(varsFor(v))
      expect(blocks).toContain('import net.minecraft.util.registry.Registry;')
      expect(blocks).not.toContain('net.minecraft.registry')
      expect(blocks).toContain('Registry.register(Registry.BLOCK,')
      expect(blocks).toContain('FabricBlockSettings.of(Material.STONE)')

      const items = modItemsClass(varsFor(v))
      expect(items).toContain('import net.minecraft.util.registry.Registry;')
      expect(items).not.toContain('net.minecraft.registry')
      expect(items).toContain('Registry.register(Registry.ITEM,')
    }
  })

  it('modBlocksClass 1.20.1 保持现代形态（回归保护）', () => {
    const blocks = modBlocksClass(varsFor('1.20.1'))
    expect(blocks).toContain('import net.minecraft.registry.Registries;')
    expect(blocks).toContain('Registry.register(Registries.BLOCK,')
    expect(blocks).toContain('FabricBlockSettings.create()')
  })

  it('gradlewSh 含官方 APP_HOME 解析块（P2：缺 APP_HOME 时 Linux/CI 必失败）', () => {
    expect(gradlewSh).toContain('# Attempt to set APP_HOME')
    expect(gradlewSh).toContain('APP_HOME=$( cd "${APP_HOME:-./}" > /dev/null && pwd -P ) || exit')
    expect(gradlewSh).toContain('CLASSPATH=$APP_HOME/gradle/wrapper/gradle-wrapper.jar')
    // JAVA_HOME 未设置时回退 PATH 上的 java，而非直接 die
    expect(gradlewSh).toContain('command -v java >/dev/null 2>&1')
  })
})

describe('内容生成器 legacy 形态', () => {
  it('ModBlocks：legacy 用 Registry.BLOCK 且 notSolid（玻璃预设）', () => {
    const ctx = ctxFor('1.18.2')
    const glass = { ...toGeneratorBlock(createDefaultBlock('glassy')), preset: 'glass' as const }
    const java = generateModBlocksJava(ctx, [glass])
    expect(java).toContain('import net.minecraft.util.registry.Registry;')
    expect(java).not.toContain('net.minecraft.registry')
    expect(java).toContain('Registry.register(Registry.BLOCK, TestmodMod.id("glassy"), GLASSY);')
    expect(java).toContain('.notSolid()')
    // 现代版本同输入仍走 nonOpaque（断点只在 legacy 生效）
    const modern = generateModBlocksJava(ctxFor('1.20.1'), [glass])
    expect(modern).toContain('.nonOpaque()')
    expect(modern).not.toContain('.notSolid()')
  })

  it('ModItems：legacy 无 ItemGroupEvents，走 Settings.group + 常量映射', () => {
    const ctx = ctxFor('1.18.2')
    const simple = createDefaultItem('ruby_ingot')
    const tool = { ...createDefaultItem('ruby_pickaxe', 'tool'), properties: { ...createDefaultItem('ruby_pickaxe', 'tool').properties, creativeTab: 'TOOLS' } }
    const java = generateModItemsJava(ctx, [], [simple, tool], [])
    expect(java).toContain('import net.minecraft.item.ItemGroup;')
    expect(java).not.toContain('ItemGroups')
    expect(java).not.toContain('ItemGroupEvents')
    expect(java).toContain('.group(ItemGroup.MISC))') // simple 默认 INGREDIENTS → legacy MISC
    expect(java).toContain('.group(ItemGroup.TOOLS))') // TOOLS 名称 legacy 未变
    expect(java).toContain('Registry.register(Registry.ITEM, TestmodMod.id("ruby_ingot"), RUBY_INGOT);')
    expect(java).not.toContain('net.minecraft.registry')

    // 1.20.1 保持 ItemGroupEvents 形态
    const modern = generateModItemsJava(ctxFor('1.20.1'), [], [simple], [])
    expect(modern).toContain('import net.minecraft.item.ItemGroups;')
    expect(modern).toContain('ItemGroupEvents.modifyEntriesEvent(ItemGroups.INGREDIENTS)')
  })

  it('ModItems：legacy 刷怪蛋入 MISC 组', () => {
    const ctx = ctxFor('1.18.2')
    const entity = { ...createDefaultEntity('goblin'), spawnEgg: { ...createDefaultEntity('goblin').spawnEgg, enabled: true } }
    const java = generateModItemsJava(ctx, [], [], [entity])
    expect(java).toContain('.group(ItemGroup.MISC)')
    expect(java).toContain('Registry.register(Registry.ITEM, TestmodMod.id("goblin_spawn_egg")')
  })

  it('ModEntities：legacy 用 Registry.ENTITY_TYPE + 主类 id() 助手（两版本段均不直写 new Identifier）', () => {
    const entity = createDefaultEntity('goblin')
    const legacy = fabricModEntitiesJava(ctxFor('1.18.2'), [entity])
    expect(legacy).toContain('import net.minecraft.util.registry.Registry;')
    expect(legacy).not.toContain('net.minecraft.registry')
    expect(legacy).toContain('Registry.register(\n        Registry.ENTITY_TYPE,')
    expect(legacy).not.toContain('new Identifier(')

    const modern = fabricModEntitiesJava(ctxFor('1.21.1'), [entity])
    expect(modern).toContain('Registries.ENTITY_TYPE,')
    expect(modern).not.toContain('new Identifier(')
  })

  it('ModEnchantments：legacy fabric 用 Registry.ENCHANTMENT', () => {
    const list = [createDefaultEnchantment('sharpness')]
    const legacy = generateModEnchantmentsJava(ctxFor('1.18.2'), list)
    expect(legacy).toContain('Registry.register(\n        Registry.ENCHANTMENT,')
    expect(legacy).toContain('import net.minecraft.util.registry.Registry;')
    expect(legacy).not.toContain('net.minecraft.registry')

    const modern = generateModEnchantmentsJava(ctxFor('1.20.1'), list)
    expect(modern).toContain('Registries.ENCHANTMENT,')
  })
})
