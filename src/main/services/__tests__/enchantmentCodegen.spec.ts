/**
 * 附魔生成链路测试：
 * - Fabric 1.20.1：ModEnchantments.java（Yarn）+ 主类织入 + 语言键；无附魔时撤销织入并清理注册类
 * - Forge 1.20.1：ModEnchantments.java（Mojmap DeferredRegister）+ 主类事件总线织入
 * - 1.21.1（Fabric/Forge/NeoForge）：数据驱动 enchantment JSON + treasure/curse 标签，零 Java
 * - contentService 读写往返：.kunyu/content/enchantments/
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateContent } from '../contentGenerator'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { listContent, loadContent, saveContent } from '../contentService'
import {
  createDefaultEnchantment,
  type EnchantmentSchema
} from '../../../shared/schemas/enchantment.schema'

function namedEnchantment(id: string, patch?: Partial<EnchantmentSchema>): EnchantmentSchema {
  const e = createDefaultEnchantment(id)
  e.displayName = { en_us: `En ${id}`, zh_cn: `附魔${id}` }
  e.description = { en_us: `desc ${id}`, zh_cn: `说明${id}` }
  return patch ? { ...e, ...patch } : e
}

const PKG_REL = 'src/main/java/com/kunyu/testmod'
const MOD_ENCH_REL = `${PKG_REL}/registry/ModEnchantments.java`
const MAIN_REL = `${PKG_REL}/TestmodMod.java`

function fabricMainClass(): string {
  return `package com.kunyu.testmod;

import net.fabricmc.api.ModInitializer;
import net.minecraft.util.Identifier;

public class TestmodMod implements ModInitializer {
    public static final String MOD_ID = "testmod";

    public static Identifier id(String path) {
        return new Identifier(MOD_ID, path);
    }

    @Override
    public void onInitialize() {
    }
}
`
}

function forgeMainClass(): string {
  return `package com.kunyu.testmod;

import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import com.kunyu.testmod.registry.ModItems;

@Mod(TestmodMod.MOD_ID)
public class TestmodMod {
    public static final String MOD_ID = "testmod";

    public TestmodMod() {
        IEventBus modEventBus = FMLJavaModLoadingContext.get().getModEventBus();
        ModItems.ITEMS.register(modEventBus);
    }
}
`
}

describe('附魔生成 · Fabric 1.20.1（Yarn Java 路线）', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-ench-fabric-'))
    registerProjectRoot(root)
    const resources = join(root, 'src', 'main', 'resources')
    mkdirSync(join(root, PKG_REL), { recursive: true })
    mkdirSync(resources, { recursive: true })
    writeFileSync(
      join(resources, 'fabric.mod.json'),
      JSON.stringify({ schemaVersion: 1, id: 'testmod', entrypoints: {} })
    )
    writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.kunyu.testmod\nminecraft_version=1.20.1\n')
    writeFileSync(join(root, MAIN_REL), fabricMainClass())
  })

  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('生成 ModEnchantments.java：注册、内部子类、Yarn 方法名与曲线常量', () => {
    const ench = namedEnchantment('life_steal', {
      rarity: 'VERY_RARE',
      slots: ['mainhand', 'offhand'],
      damageBonus: { base: 1.5, perLevel: 0.5 }
    })
    generateContent(root, [ench])

    const java = readFileSync(join(root, MOD_ENCH_REL), 'utf-8')
    expect(java).toContain('public class ModEnchantments')
    expect(java).toContain('Registry.register(')
    expect(java).toContain('Registries.ENCHANTMENT')
    expect(java).toContain('TestmodMod.id("life_steal")')
    expect(java).toContain('public static class LifeStealEnchantment extends Enchantment')
    expect(java).toContain(
      'super(Enchantment.Rarity.VERY_RARE, EnchantmentTarget.WEAPON, new EquipmentSlot[]{EquipmentSlot.MAINHAND, EquipmentSlot.OFFHAND});'
    )
    expect(java).toContain('public int getMinPower(int level)')
    expect(java).toContain('return 10 + (level - 1) * 15;')
    expect(java).toContain('return super.getMinPower(level) + 50;')
    expect(java).toContain('public int getMaxLevel()')
    expect(java).toContain('return 3;')
    expect(java).toContain('import net.minecraft.entity.EntityGroup;')
    expect(java).toContain('public float getAttackDamage(int level, EntityGroup group)')
    expect(java).toContain('return 1.5f + 0.5f * (level - 1);')
    // 非宝藏/非诅咒不生成对应 override
    expect(java).not.toContain('isTreasure()')
    expect(java).not.toContain('isCursed()')

    // 主类织入
    const main = readFileSync(join(root, MAIN_REL), 'utf-8')
    expect(main).toContain('import com.kunyu.testmod.registry.ModEnchantments;')
    expect(main).toContain('ModEnchantments.register();')

    // 名称 + 描述语言键
    const en = JSON.parse(
      readFileSync(join(root, 'src/main/resources/assets/testmod/lang/en_us.json'), 'utf-8')
    )
    const zh = JSON.parse(
      readFileSync(join(root, 'src/main/resources/assets/testmod/lang/zh_cn.json'), 'utf-8')
    )
    expect(en['enchantment.testmod.life_steal']).toBe('En life_steal')
    expect(en['enchantment.testmod.life_steal.desc']).toBe('desc life_steal')
    expect(zh['enchantment.testmod.life_steal']).toBe('附魔life_steal')
    expect(zh['enchantment.testmod.life_steal.desc']).toBe('说明life_steal')
  })

  it('宝藏/诅咒附魔生成 isTreasure/isCursed；TOOL 目标映射为 Yarn DIGGER（1.20.1 无 TOOL 枚举）', () => {
    const ench = namedEnchantment('doom_edge', {
      treasure: true,
      curse: false,
      target: 'TOOL'
    })
    const curse = namedEnchantment('binding_chain', { curse: true, rarity: 'UNCOMMON' })
    generateContent(root, [ench, curse])

    const java = readFileSync(join(root, MOD_ENCH_REL), 'utf-8')
    expect(java).toContain('public boolean isTreasure()')
    expect(java).toContain('public boolean isCursed()')
    // Yarn 1.20.1 EnchantmentTarget 无 TOOL，工具类映射为 DIGGER
    expect(java).toContain('EnchantmentTarget.DIGGER')
    expect(java).not.toContain('EnchantmentTarget.TOOL')
    expect(java).not.toContain('EnchantmentCategory')
  })

  it('第二轮无附魔：撤销主类织入并删除 ModEnchantments.java', () => {
    generateContent(root, [namedEnchantment('life_steal')])
    expect(existsSync(join(root, MOD_ENCH_REL))).toBe(true)

    generateContent(root, [])
    expect(existsSync(join(root, MOD_ENCH_REL))).toBe(false)
    const main = readFileSync(join(root, MAIN_REL), 'utf-8')
    expect(main).not.toContain('ModEnchantments')
  })
})

describe('附魔生成 · Forge 1.20.1（Mojmap Java 路线）', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-ench-forge-'))
    registerProjectRoot(root)
    const metaInf = join(root, 'src', 'main', 'resources', 'META-INF')
    mkdirSync(join(root, PKG_REL), { recursive: true })
    mkdirSync(metaInf, { recursive: true })
    writeFileSync(
      join(metaInf, 'mods.toml'),
      '[[mods]]\nmodId="testmod"\n'
    )
    writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.kunyu.testmod\nminecraft_version=1.20.1\n')
    writeFileSync(join(root, MAIN_REL), forgeMainClass())
  })

  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('生成 DeferredRegister 注册类：Mojmap 命名 + 主类总线挂载', () => {
    const ench = namedEnchantment('soul_fire', {
      target: 'TOOL',
      treasure: true,
      damageBonus: { base: 2, perLevel: 1 }
    })
    generateContent(root, [ench])

    const java = readFileSync(join(root, MOD_ENCH_REL), 'utf-8')
    expect(java).toContain('DeferredRegister.create(ForgeRegistries.ENCHANTMENTS, TestmodMod.MOD_ID)')
    expect(java).toContain('RegistryObject<Enchantment> SOUL_FIRE')
    expect(java).toContain('SoulFireEnchantment::new')
    expect(java).toContain('public static class SoulFireEnchantment extends Enchantment')
    expect(java).toContain('Enchantment.Rarity.RARE')
    // Mojmap：TOOL→DIGGER
    expect(java).toContain('EnchantmentCategory.DIGGER')
    expect(java).toContain('public int getMinCost(int level)')
    expect(java).toContain('return getMinCost(level) + 50;')
    expect(java).toContain('public boolean isTreasureOnly()')
    expect(java).toContain('import net.minecraft.world.entity.MobType;')
    expect(java).toContain('public float getDamageBonus(int level, MobType mobType)')
    expect(java).toContain('return 2f + 1f * (level - 1);')

    const main = readFileSync(join(root, MAIN_REL), 'utf-8')
    expect(main).toContain('import com.kunyu.testmod.registry.ModEnchantments;')
    expect(main).toContain('ModEnchantments.ENCHANTMENTS.register(modEventBus);')
  })
})

describe('附魔生成 · 1.21.1（数据驱动 JSON 路线，与加载器无关）', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-ench-neo-'))
    registerProjectRoot(root)
    const metaInf = join(root, 'src', 'main', 'resources', 'META-INF')
    mkdirSync(join(root, PKG_REL), { recursive: true })
    mkdirSync(metaInf, { recursive: true })
    writeFileSync(join(metaInf, 'neoforge.mods.toml'), '[[mods]]\nmodId="testmod"\n')
    writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.kunyu.testmod\nminecraft_version=1.21.1\n')
  })

  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('落 data JSON（含效果/消耗曲线）与宝藏标签，且零 Java', () => {
    const ench = namedEnchantment('frost_thirst', {
      rarity: 'RARE',
      target: 'TOOL',
      treasure: true,
      curse: true,
      damageBonus: { base: 1, perLevel: 0.5 }
    })
    generateContent(root, [ench])

    const json = JSON.parse(
      readFileSync(
        join(root, 'src/main/resources/data/testmod/enchantment/frost_thirst.json'),
        'utf-8'
      )
    )
    expect(json.description.translate).toBe('enchantment.testmod.frost_thirst')
    // TOOL → mining_loot 标签；RARE → weight 2
    expect(json.supported_items).toBe('#minecraft:enchantable/mining_loot')
    expect(json.weight).toBe(2)
    expect(json.max_level).toBe(3)
    expect(json.min_cost).toEqual({ base: 10, per_level_above_first: 15 })
    // max_cost 与 Java 语义等价：base 平移 maxCostExtra
    expect(json.max_cost).toEqual({ base: 60, per_level_above_first: 15 })
    expect(json.anvil_cost).toBe(2)
    expect(json.slots).toEqual(['mainhand'])
    expect(json.effects['minecraft:damage'][0].effect).toEqual({
      type: 'minecraft:add',
      value: { type: 'minecraft:linear', base: 1, per_level_above_first: 0.5 }
    })

    const treasureTag = JSON.parse(
      readFileSync(
        join(root, 'src/main/resources/data/minecraft/tags/enchantment/treasure.json'),
        'utf-8'
      )
    )
    expect(treasureTag.values).toContain('testmod:frost_thirst')
    const curseTag = JSON.parse(
      readFileSync(
        join(root, 'src/main/resources/data/minecraft/tags/enchantment/curse.json'),
        'utf-8'
      )
    )
    expect(curseTag.values).toContain('testmod:frost_thirst')

    // 数据驱动路线不产出 Java 注册类
    expect(existsSync(join(root, MOD_ENCH_REL))).toBe(false)

    // 语言键照常落
    const en = JSON.parse(
      readFileSync(join(root, 'src/main/resources/assets/testmod/lang/en_us.json'), 'utf-8')
    )
    expect(en['enchantment.testmod.frost_thirst']).toBe('En frost_thirst')
  })

  it('supported_items 使用 1.21 真实标签（部位词在前/fishing），不写不存在的标签', () => {
    const cases: Array<[EnchantmentSchema['target'], string]> = [
      ['ARMOR_FEET', 'foot_armor'],
      ['ARMOR_LEGS', 'leg_armor'],
      ['ARMOR_CHEST', 'chest_armor'],
      ['ARMOR_HEAD', 'head_armor'],
      ['FISHING_ROD', 'fishing']
    ]
    for (const [target, tag] of cases) {
      const ench = namedEnchantment(`t_${tag}`, { target })
      generateContent(root, [ench])
      const json = JSON.parse(
        readFileSync(
          join(root, `src/main/resources/data/testmod/enchantment/t_${tag}.json`),
          'utf-8'
        )
      )
      expect(json.supported_items).toBe(`#minecraft:enchantable/${tag}`)
    }
  })
})

describe('附魔 contentService 读写往返', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-ench-svc-'))
    registerProjectRoot(root)
  })

  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('save/list/load 贯通，文件落 enchantments/ 目录并经归一化', () => {
    const ench = namedEnchantment('life_steal')
    const summary = saveContent(root, ench)
    expect(summary).toMatchObject({ kind: 'enchantment', id: 'life_steal' })

    expect(existsSync(join(root, '.kunyu/content/enchantments/life_steal.json'))).toBe(true)

    const list = listContent(root)
    expect(list).toContainEqual(
      expect.objectContaining({ kind: 'enchantment', id: 'life_steal' })
    )

    const loaded = loadContent(root, 'enchantment', 'life_steal') as EnchantmentSchema
    expect(loaded.kind).toBe('enchantment')
    expect(loaded.rarity).toBe('RARE')
    expect(loaded.slots).toEqual(['mainhand'])
    expect(loaded.displayName.zh_cn).toBe('附魔life_steal')
  })

  it('非法附魔保存抛中文校验错误', () => {
    const bad = createDefaultEnchantment('BadId')
    expect(() => saveContent(root, bad)).toThrow(/注册名/)
  })
})
