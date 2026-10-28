/**
 * 加载器 × MC 版本 API 漂移代码生成回归测试。
 *
 * 背景：1.20.5 物品组件重构（两映射同轮）与 1.21 资源位置/Identifier 构造器私有化
 * 造成生成代码按 (loader, mcVersion) 分派；本测试锁定各版本边界的生成形态，
 * 全部断言基于 Gradle 缓存映射 jar 的 javap 实证（1.18.2-1.21.1 Yarn + Mojmap）。
 *
 * 分派表（详见各断言注释）：
 *  - Yarn 工具：≥1.20.5 走 (ToolMaterial, Settings)+attributeModifiers；标识 1.21+ 为 Identifier
 *  - Yarn 护甲：<1.20 走 EquipmentSlot；1.20.x 走 ArmorMaterials.getDurability(Type)；
 *    ≥1.20.5 走 ArmorItem.Type.getMaxDamage(int)+CHAIN 改名
 *  - Yarn 食物：≥1.20.5 hunger→nutrition、meat 移除；FoodComponent 迁 component.type
 *  - Mojmap 工具：≥1.20.5 走 (Tier, Properties)+attributes；标识 1.21+ 为 ResourceLocation
 *  - Mojmap 护甲：≤1.20.4 getDurabilityForType(Type)；≥1.20.5 Type.getDurability(int)+CHAIN 改名
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateContent, resolveModContext } from '../contentGenerator'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import {
  neoForgeBuildGradle,
  neoForgeMetadataRelPath,
  neoForgeModsToml,
  type NeoForgeTemplateVars
} from '../../templates/neoForgeTemplates'
import {
  createDefaultItem,
  createTypeConfig,
  type ItemSchema
} from '../../../shared/schemas/item.schema'

/** 工具（铁剑：dmg 3 / speed -2.4） */
function toolItem(): ItemSchema {
  return createDefaultItem('iron_sword', 'tool')
}

/** 锁链胸甲（验证 1.20.5+ CHAINMAIL→CHAIN 改名与耐久迁移） */
function armorItem(): ItemSchema {
  const i = createDefaultItem('chain_chest', 'armor')
  const a = createTypeConfig('armor').armor!
  i.armor = { ...a, slot: 'chestplate', material: 'chainmail' }
  return i
}

/** 肉类食物（验证 hunger/nutrition 与 meat 分派） */
function foodItem(): ItemSchema {
  const i = createDefaultItem('tasty_stew', 'food')
  const f = createTypeConfig('food').food!
  i.food = { ...f, hunger: 4, saturation: 0.6, meat: true, snack: false }
  return i
}

const modItemsRel = 'src/main/java/com/kunyu/testmod/registry/ModItems.java'
const mainClassRel = 'src/main/java/com/kunyu/testmod/TestmodMod.java'

/* ------------------------------------------------------------------ */
/* Fabric（Yarn 映射）                                                 */
/* ------------------------------------------------------------------ */

function scaffoldFabric(root: string, mcVersion: string): void {
  const resources = join(root, 'src', 'main', 'resources')
  mkdirSync(join(root, 'src', 'main', 'java', 'com', 'kunyu', 'testmod'), { recursive: true })
  mkdirSync(resources, { recursive: true })
  writeFileSync(
    join(resources, 'fabric.mod.json'),
    JSON.stringify({ schemaVersion: 1, id: 'testmod', entrypoints: {} }, null, 2)
  )
  writeFileSync(
    join(root, 'gradle.properties'),
    `maven_group=com.kunyu.testmod\nminecraft_version=${mcVersion}\n`
  )
}

describe('Fabric 1.21.1（Yarn：组件重构 + Identifier 私有化）', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-drift-fab1211-'))
    registerProjectRoot(root)
    scaffoldFabric(root, '1.21.1')
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('工具：(ToolMaterial, Settings) + attributeModifiers（Identifier 标识）', () => {
    generateContent(root, [toolItem()])
    const java = readFileSync(join(root, modItemsRel), 'utf-8')
    expect(java).toContain('new SwordItem(ToolMaterials.IRON, new Item.Settings()')
    expect(java).toContain('.attributeModifiers(AttributeModifiersComponent.builder()')
    expect(java).toContain(
      '.add(EntityAttributes.GENERIC_ATTACK_DAMAGE, new EntityAttributeModifier(Identifier.of("minecraft", "attack_damage"), 3, EntityAttributeModifier.Operation.ADD_VALUE), AttributeModifierSlot.MAINHAND)'
    )
    expect(java).toContain(
      '.add(EntityAttributes.GENERIC_ATTACK_SPEED, new EntityAttributeModifier(Identifier.of("minecraft", "attack_speed"), -2.4f, EntityAttributeModifier.Operation.ADD_VALUE), AttributeModifierSlot.MAINHAND)'
    )
    expect(java).toContain('.maxDamage(ToolMaterials.IRON.getDurability())')
    // 旧 4 参构造器与 String 标识不得再出现
    expect(java).not.toContain('ToolMaterials.IRON, 3,')
    expect(java).not.toContain('"minecraft:attack_damage"')
    for (const imp of [
      'import net.minecraft.component.type.AttributeModifiersComponent;',
      'import net.minecraft.component.type.AttributeModifierSlot;',
      'import net.minecraft.entity.attribute.EntityAttributeModifier;',
      'import net.minecraft.entity.attribute.EntityAttributes;',
      'import net.minecraft.util.Identifier;'
    ]) {
      expect(java).toContain(imp)
    }
  })

  it('护甲：CHAIN 改名 + Type.getMaxDamage(multiplier)', () => {
    generateContent(root, [armorItem()])
    const java = readFileSync(join(root, modItemsRel), 'utf-8')
    expect(java).toContain('new ArmorItem(ArmorMaterials.CHAIN, ArmorItem.Type.CHESTPLATE,')
    expect(java).toContain('.maxDamage(ArmorItem.Type.CHESTPLATE.getMaxDamage(15))')
    expect(java).not.toContain('CHAINMAIL')
    expect(java).not.toContain('EquipmentSlot')
    expect(java).not.toContain('getDurability')
  })

  it('食物：nutrition + meat 移除 + FoodComponent 迁 component.type', () => {
    generateContent(root, [foodItem()])
    const java = readFileSync(join(root, modItemsRel), 'utf-8')
    expect(java).toContain('.nutrition(4)')
    expect(java).toContain('import net.minecraft.component.type.FoodComponent;')
    expect(java).not.toContain('.hunger(')
    expect(java).not.toContain('.meat(')
    expect(java).not.toContain('import net.minecraft.item.FoodComponent;')
  })

  it('主类：Identifier.of 静态工厂', () => {
    generateContent(root, [toolItem()])
    const main = readFileSync(join(root, mainClassRel), 'utf-8')
    expect(main).toContain('return Identifier.of(MOD_ID, path);')
    expect(main).not.toContain('new Identifier(MOD_ID')
  })
})

describe('Fabric 1.20.1（Yarn：经典构造器形态）', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-drift-fab1201-'))
    registerProjectRoot(root)
    scaffoldFabric(root, '1.20.1')
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('工具：4 参构造器（ToolMaterial, dmg, speed, Settings）', () => {
    generateContent(root, [toolItem()])
    const java = readFileSync(join(root, modItemsRel), 'utf-8')
    expect(java).toContain('new SwordItem(ToolMaterials.IRON, 3, -2.4f, new Item.Settings()')
    expect(java).not.toContain('attributeModifiers')
  })

  it('护甲：ArmorMaterials.getDurability(ArmorItem.Type) + CHAINMAIL 未改名', () => {
    generateContent(root, [armorItem()])
    const java = readFileSync(join(root, modItemsRel), 'utf-8')
    expect(java).toContain('new ArmorItem(ArmorMaterials.CHAINMAIL, ArmorItem.Type.CHESTPLATE,')
    expect(java).toContain(
      '.maxDamage(ArmorMaterials.CHAINMAIL.getDurability(ArmorItem.Type.CHESTPLATE))'
    )
    expect(java).not.toContain('EquipmentSlot')
  })

  it('食物：hunger + 无参 meat()', () => {
    generateContent(root, [foodItem()])
    const java = readFileSync(join(root, modItemsRel), 'utf-8')
    expect(java).toContain('.hunger(4)')
    expect(java).toContain('.meat()')
    expect(java).not.toContain('.meat(true)')
    expect(java).toContain('import net.minecraft.item.FoodComponent;')
  })

  it('主类：new Identifier 构造器仍公开', () => {
    generateContent(root, [toolItem()])
    const main = readFileSync(join(root, mainClassRel), 'utf-8')
    expect(main).toContain('return new Identifier(MOD_ID, path);')
  })
})

describe('Fabric 1.19.2（Yarn：护甲走 EquipmentSlot）', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-drift-fab1192-'))
    registerProjectRoot(root)
    scaffoldFabric(root, '1.19.2')
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('护甲：EquipmentSlot 构造参数 + getDurability(EquipmentSlot)', () => {
    generateContent(root, [armorItem()])
    const java = readFileSync(join(root, modItemsRel), 'utf-8')
    expect(java).toContain('new ArmorItem(ArmorMaterials.CHAINMAIL, EquipmentSlot.CHEST,')
    expect(java).toContain('.maxDamage(ArmorMaterials.CHAINMAIL.getDurability(EquipmentSlot.CHEST))')
    expect(java).toContain('import net.minecraft.entity.EquipmentSlot;')
    expect(java).not.toContain('ArmorItem.Type')
  })
})

/* ------------------------------------------------------------------ */
/* Forge / NeoForge（Mojmap 映射）                                     */
/* ------------------------------------------------------------------ */

function scaffoldMojmap(root: string, loader: 'forge' | 'neoforge', mcVersion: string): void {
  const resources = join(root, 'src', 'main', 'resources')
  const javaBase = join(root, 'src', 'main', 'java', 'com', 'kunyu', 'testmod')
  mkdirSync(javaBase, { recursive: true })
  mkdirSync(join(resources, 'META-INF'), { recursive: true })
  if (loader === 'forge') {
    writeFileSync(
      join(resources, 'META-INF', 'mods.toml'),
      'modLoader="javafml"\nloaderVersion="[46,)"\n\n[[mods]]\nmodId="testmod"\n'
    )
    writeFileSync(
      join(root, 'build.gradle'),
      "plugins { id 'net.minecraftforge.gradle' version '[6.0,6.2)' }\n"
    )
  } else {
    // NeoForge 元数据按版本分派（对齐 projectService 真实 scaffold）：
    // ≤1.20.4 为 Forge 式 mods.toml + 旧 schema；≥1.20.5 才是 neoforge.mods.toml
    const metaRel = mcVersion === '1.20.4' ? 'mods.toml' : 'neoforge.mods.toml'
    const toml =
      mcVersion === '1.20.4'
        ? 'modLoader="javafml"\nloaderVersion="[2,)"\n\n[[mods]]\nmodId="testmod"\n'
        : 'license="MIT"\n\n[[mods]]\nmodId="testmod"\n'
    writeFileSync(join(resources, 'META-INF', metaRel), toml)
    writeFileSync(
      join(root, 'build.gradle'),
      "plugins { id 'net.neoforged.moddev' version '2.0.147' }\n"
    )
  }
  writeFileSync(
    join(root, 'gradle.properties'),
    `maven_group=com.kunyu.testmod\nminecraft_version=${mcVersion}\n`
  )
}

describe('Forge 1.21.1（Mojmap：组件重构 + ResourceLocation 标识）', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-drift-fge1211-'))
    registerProjectRoot(root)
    scaffoldMojmap(root, 'forge', '1.21.1')
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('工具：(Tier, Properties) + attributes（ResourceLocation 标识）', () => {
    generateContent(root, [toolItem()])
    const java = readFileSync(join(root, modItemsRel), 'utf-8')
    expect(java).toContain('new SwordItem(Tiers.IRON, new Item.Properties()')
    expect(java).toContain('.attributes(ItemAttributeModifiers.builder()')
    expect(java).toContain(
      '.add(Attributes.ATTACK_DAMAGE, new AttributeModifier(ResourceLocation.withDefaultNamespace("attack_damage"), 3, AttributeModifier.Operation.ADD_VALUE), EquipmentSlotGroup.MAINHAND)'
    )
    expect(java).toContain(
      '.add(Attributes.ATTACK_SPEED, new AttributeModifier(ResourceLocation.withDefaultNamespace("attack_speed"), -2.4f, AttributeModifier.Operation.ADD_VALUE), EquipmentSlotGroup.MAINHAND)'
    )
    expect(java).toContain('.durability(Tiers.IRON.getUses())')
    // 旧 4 参构造器与 Yarn 风格 String 标识不得再出现
    expect(java).not.toContain('Tiers.IRON, 3,')
    expect(java).not.toContain('"minecraft:attack_damage"')
    for (const imp of [
      'import net.minecraft.world.entity.EquipmentSlotGroup;',
      'import net.minecraft.world.entity.ai.attributes.AttributeModifier;',
      'import net.minecraft.world.entity.ai.attributes.Attributes;',
      'import net.minecraft.world.item.component.ItemAttributeModifiers;',
      'import net.minecraft.resources.ResourceLocation;'
    ]) {
      expect(java).toContain(imp)
    }
  })

  it('护甲：CHAIN 改名 + Type.getDurability(multiplier)', () => {
    generateContent(root, [armorItem()])
    const java = readFileSync(join(root, modItemsRel), 'utf-8')
    expect(java).toContain('new ArmorItem(ArmorMaterials.CHAIN, ArmorItem.Type.CHESTPLATE,')
    expect(java).toContain('.durability(ArmorItem.Type.CHESTPLATE.getDurability(15))')
    expect(java).not.toContain('CHAINMAIL')
    expect(java).not.toContain('getDurabilityForType')
  })
})

describe('Forge 1.20.1 / 1.20.4（Mojmap：经典构造器形态）', () => {
  it.each(['1.20.1', '1.20.4'])(
    'forge %s：工具 4 参 + 护甲 getDurabilityForType + saturationMod',
    (mcVersion) => {
      const root = mkdtempSync(join(tmpdir(), `ky-drift-fge${mcVersion}-`))
      registerProjectRoot(root)
      try {
        scaffoldMojmap(root, 'forge', mcVersion)
        generateContent(root, [toolItem(), armorItem(), foodItem()])
        const java = readFileSync(join(root, modItemsRel), 'utf-8')
        expect(java).toContain('new SwordItem(Tiers.IRON, 3, -2.4f, new Item.Properties()')
        expect(java).toContain('.durability(Tiers.IRON.getUses())')
        expect(java).not.toContain('.attributes(')
        expect(java).toContain(
          '.durability(ArmorMaterials.CHAINMAIL.getDurabilityForType(ArmorItem.Type.CHESTPLATE))'
        )
        expect(java).not.toContain('.getDurability(ArmorItem.Type')
        expect(java).toContain('.saturationMod(')
        expect(java).not.toContain('.saturationModifier(')
        expect(java).not.toContain('ItemAttributeModifiers')
      } finally {
        unregisterProjectRoot(root)
        rmSync(root, { recursive: true, force: true })
      }
    }
  )
})

describe('NeoForge 1.20.4（Mojmap：经典构造器形态）', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-drift-neo1204-'))
    registerProjectRoot(root)
    scaffoldMojmap(root, 'neoforge', '1.20.4')
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('工具/护甲/食物：≤1.20.4 分支（getDurabilityForType + saturationMod）', () => {
    generateContent(root, [toolItem(), armorItem(), foodItem()])
    const java = readFileSync(join(root, modItemsRel), 'utf-8')
    expect(java).toContain('new SwordItem(Tiers.IRON, 3, -2.4f, new Item.Properties()')
    expect(java).toContain(
      '.durability(ArmorMaterials.CHAINMAIL.getDurabilityForType(ArmorItem.Type.CHESTPLATE))'
    )
    expect(java).toContain('.saturationMod(')
    expect(java).not.toContain('ItemAttributeModifiers')
    expect(java).not.toContain('net.minecraftforge')
  })
})

/* ------------------------------------------------------------------ */
/* NeoForge 元数据/构建脚本按版本分派：neo1204 元数据不合规    */
/* + bmclapi 动态版本 metadata 403）                                    */
/* ------------------------------------------------------------------ */

const NEO_BASE_VARS: NeoForgeTemplateVars = {
  modId: 'testmod',
  modName: 'Test Mod',
  version: '1.0.0',
  packageName: 'com.kunyu.testmod',
  mcVersion: '1.20.4',
  neoForgeVersion: '20.4.240',
  modDevGradleVersion: '2.0.147',
  gradleVersion: '8.10.2',
  jdk: 17
}

describe('NeoForge 元数据/构建脚本按版本分派', () => {
  it('1.20.4：mods.toml 旧 schema（modLoader/loaderVersion 必填 + mandatory 依赖）', () => {
    expect(neoForgeMetadataRelPath('1.20.4')).toBe('META-INF/mods.toml')
    const toml = neoForgeModsToml(NEO_BASE_VARS)
    expect(toml).toContain('modLoader="javafml"')
    expect(toml).toContain('loaderVersion="[2,)"')
    expect(toml).toContain('license="MIT"')
    expect(toml).toContain('mandatory=true')
    expect(toml).toContain('versionRange="[20.4,)"')
    expect(toml).not.toContain('type="required"')
    expect(toml).not.toContain('neoforge.mods.toml')
  })

  it('1.21.1：neoforge.mods.toml 新 schema（license + type="required"）', () => {
    expect(neoForgeMetadataRelPath('1.21.1')).toBe('META-INF/neoforge.mods.toml')
    const toml = neoForgeModsToml({ ...NEO_BASE_VARS, mcVersion: '1.21.1', neoForgeVersion: '21.1.250', jdk: 21 })
    expect(toml).not.toContain('modLoader=')
    expect(toml).not.toContain('loaderVersion=')
    expect(toml).toContain('type="required"')
    expect(toml).toContain('versionRange="[21.1,)"')
  })

  it('build.gradle：钉死 log4j-core + log4j-api 动态版本（bmclapi metadata 403 规避）', () => {
    for (const mirror of ['china', 'official'] as const) {
      const bg = neoForgeBuildGradle(NEO_BASE_VARS, mirror)
      expect(bg).toContain(
        "resolutionStrategy.force 'org.apache.logging.log4j:log4j-core:2.11.1', 'org.apache.logging.log4j:log4j-api:2.11.1'"
      )
    }
  })

  it('resolveModContext：仅 mods.toml + moddev 插件 → 判为 neoforge（1.20.4 旧元数据）', () => {
    const root = mkdtempSync(join(tmpdir(), 'ky-drift-neodetect-'))
    registerProjectRoot(root)
    try {
      scaffoldMojmap(root, 'neoforge', '1.20.4')
      const ctx = resolveModContext(root)
      expect(ctx.loader).toBe('neoforge')
      expect(ctx.mcVersion).toBe('1.20.4')
      expect(ctx.modId).toBe('testmod')
    } finally {
      unregisterProjectRoot(root)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('resolveModContext：mods.toml + ForgeGradle 插件 → 判为 forge', () => {
    const root = mkdtempSync(join(tmpdir(), 'ky-drift-fgedetect-'))
    registerProjectRoot(root)
    try {
      scaffoldMojmap(root, 'forge', '1.20.1')
      const ctx = resolveModContext(root)
      expect(ctx.loader).toBe('forge')
      expect(ctx.modId).toBe('testmod')
    } finally {
      unregisterProjectRoot(root)
      rmSync(root, { recursive: true, force: true })
    }
  })
})
