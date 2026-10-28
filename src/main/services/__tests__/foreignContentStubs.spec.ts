/**
 * P1-4 兼容性兜底测试：importForeignContentStubs + protectForeignPlannedFiles。
 *
 * 场景：AI 直写 Java/资源的项目（.kunyu/content 为空），
 * 反向导入语义骨架让可视化编辑器可见；同名单全量重写文件登记为漂移保护，
 * 用户首次点「生成」时默认跳过而不是静默覆盖 AI 产物。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { importForeignContentStubs, listContent, loadContent, saveContent } from '../contentService'
import { generateContent } from '../contentGenerator'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { createDefaultBlock, type BlockSchema } from '../../../shared/schemas/block.schema'

let root: string

function writeRel(rel: string, content: string): void {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ky-foreign-stub-'))
  registerProjectRoot(root)
  writeRel('src/main/resources/fabric.mod.json', JSON.stringify({ schemaVersion: 1, id: 'testmod' }))
  writeRel('gradle.properties', 'maven_group=com.kunyu.testmod\n')
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

/** 模拟 AI 直写产物：blockstate + 物品模型 + 自写注册类 */
function seedAiArtifacts(): void {
  writeRel('src/main/resources/assets/testmod/blockstates/solar_furnace.json', '{"variants":{}}')
  writeRel(
    'src/main/resources/assets/testmod/models/block/solar_furnace.json',
    '{"parent":"minecraft:block/cube_all","textures":{"all":"testmod:block/solar_furnace"}}'
  )
  writeRel('src/main/resources/assets/testmod/models/item/solar_furnace.json', '{"parent":"testmod:block/solar_furnace"}')
  writeRel('src/main/resources/assets/testmod/models/item/ruby.json', '{"parent":"minecraft:item/generated","textures":{"layer0":"testmod:item/ruby"}}')
  writeRel('src/main/resources/assets/testmod/models/item/ruby_golem_spawn_egg.json', '{"parent":"minecraft:item/template_spawn_egg"}')
  writeRel(
    'src/main/java/com/kunyu/testmod/registry/ModBlocks.java',
    '// AI 手写注册类\npublic final class ModBlocks { /* solar furnace with block entity */ }\n'
  )
}

describe('importForeignContentStubs（P1-4 兼容性兜底）', () => {
  it('按 blockstates / models/item 反向导入方块与物品骨架，编辑器可见', () => {
    seedAiArtifacts()
    const r = importForeignContentStubs(root)
    expect(r.blocks).toEqual(['solar_furnace'])
    expect(r.items).toEqual(['ruby'])
    const listed = listContent(root)
    expect(listed.some((s) => s.kind === 'block' && s.id === 'solar_furnace')).toBe(true)
    expect(listed.some((s) => s.kind === 'item' && s.id === 'ruby')).toBe(true)
    const block = loadContent(root, 'block', 'solar_furnace') as BlockSchema
    expect(block.description).toContain('反向导入')
  })

  it('刷怪蛋模型与方块物品同名项不产生物品骨架', () => {
    seedAiArtifacts()
    const r = importForeignContentStubs(root)
    // ruby_golem_spawn_egg 排除；solar_furnace 物品模型与方块同名，不重复建物品
    expect(r.items).not.toContain('ruby_golem_spawn_egg')
    expect(r.items).not.toContain('solar_furnace')
  })

  it('已有语义资产的 id 跳过，重复调用幂等', () => {
    seedAiArtifacts()
    saveContent(root, createDefaultBlock('solar_furnace'))
    const r1 = importForeignContentStubs(root)
    expect(r1.blocks).toEqual([])
    expect(r1.items).toEqual(['ruby'])
    const r2 = importForeignContentStubs(root)
    expect(r2.blocks).toEqual([])
    expect(r2.items).toEqual([])
  })

  it('无任何产物目录时返回空结果', () => {
    const r = importForeignContentStubs(root)
    expect(r).toEqual({ blocks: [], items: [], protectedFiles: 0 })
  })

  it('模板占位 example_block 不产生骨架（P2-H）', () => {
    writeRel('src/main/resources/assets/testmod/blockstates/example_block.json', '{"variants":{}}')
    writeRel('src/main/resources/assets/testmod/models/block/example_block.json', '{"parent":"minecraft:block/cube_all"}')
    writeRel('src/main/resources/assets/testmod/models/item/example_block.json', '{"parent":"testmod:block/example_block"}')
    const r = importForeignContentStubs(root)
    expect(r.blocks).toEqual([])
    expect(r.items).toEqual([])
    expect(listContent(root).some((s) => s.id === 'example_block')).toBe(false)
  })

  it('漂移保护按段合并（P0-A）：注册类被生成内容接管，不可解析资源的同名文件仍跳过', () => {
    seedAiArtifacts()
    const registryRel = 'src/main/java/com/kunyu/testmod/registry/ModBlocks.java'
    const blockstateRel = 'src/main/resources/assets/testmod/blockstates/solar_furnace.json'
    const beforeBlockstate = readFileSync(join(root, blockstateRel), 'utf-8')

    const r = importForeignContentStubs(root)
    expect(r.protectedFiles).toBeGreaterThan(0)

    // 模拟用户在编辑器点「生成」：注册类以语义集合为准重写（fixture 的磁盘注册类
    // 只有注释、无可解析外来注册段）；blockstate 等不可解析资源仍整份跳过
    const result = generateContent(root, listContent(root).map((s) => loadContent(root, s.kind, s.id)))
    const registryAfter = readFileSync(join(root, registryRel), 'utf-8')
    // 导入的骨架 solar_furnace 已注册进生成内容——「语义层 → Java」这条路必须通
    expect(registryAfter).toContain('SOLAR_FURNACE')
    expect(registryAfter).toContain('"solar_furnace"')
    expect(readFileSync(join(root, blockstateRel), 'utf-8')).toBe(beforeBlockstate)
    expect(result.diverged).toContain(blockstateRel)
    expect(result.diverged).not.toContain(registryRel)

    // 用户显式确认覆盖后才允许重写不可解析资源
    const forced = generateContent(
      root,
      listContent(root).map((s) => loadContent(root, s.kind, s.id)),
      { overwritePaths: [blockstateRel] }
    )
    expect(readFileSync(join(root, blockstateRel), 'utf-8')).not.toBe(beforeBlockstate)
    expect(forced.diverged).not.toContain(blockstateRel)
  })

  it('外来注册段与新增语义内容在注册类中共存（P0-A 核心场景）', () => {
    seedAiArtifacts()
    // AI 手写的注册类：含自定义方块类引用（可被符号级解析的外来段）
    writeRel(
      'src/main/java/com/kunyu/testmod/registry/ModBlocks.java',
      [
        'package com.kunyu.testmod.registry;',
        '',
        'import com.kunyu.testmod.TestmodMod;',
        'import com.kunyu.testmod.block.SolarFurnaceBlock;',
        'import net.minecraft.block.Block;',
        'import net.minecraft.registry.Registries;',
        'import net.minecraft.registry.Registry;',
        '',
        'public class ModBlocks {',
        '    /** AI 手写太阳能熔炉（带方块实体） */',
        '    public static final Block SOLAR_FURNACE_CUSTOM = new SolarFurnaceBlock();',
        '',
        '    public static void register() {',
        '        Registry.register(Registries.BLOCK, TestmodMod.id("solar_furnace_custom"), SOLAR_FURNACE_CUSTOM);',
        '    }',
        '}',
        ''
      ].join('\n')
    )
    importForeignContentStubs(root)
    // 用户在编辑器新建一个方块 ruby_lamp
    saveContent(root, createDefaultBlock('ruby_lamp'))

    const result = generateContent(root, listContent(root).map((s) => loadContent(root, s.kind, s.id)))
    const registryRel = 'src/main/java/com/kunyu/testmod/registry/ModBlocks.java'
    const merged = readFileSync(join(root, registryRel), 'utf-8')

    // 新增语义内容必须注册生效
    expect(merged).toContain('RUBY_LAMP')
    expect(merged).toContain('"ruby_lamp"')
    // 外来注册段保留（字段 + register 调用 + 自定义类 import）
    expect(merged).toContain('SOLAR_FURNACE_CUSTOM')
    expect(merged).toContain('"solar_furnace_custom"')
    expect(merged).toContain('import com.kunyu.testmod.block.SolarFurnaceBlock;')
    // 合并已处理外来段，注册类不再列为待决冲突
    expect(result.diverged).not.toContain(registryRel)
  })

  it('lang 文件合并语义：漂移不跳过，外来键保留、托管键写入（P0-A）', () => {
    seedAiArtifacts()
    const langRel = 'src/main/resources/assets/testmod/lang/en_us.json'
    writeRel(langRel, JSON.stringify({ 'item.testmod.ruby': 'Ruby', 'custom.foreign.key': 'Keep Me' }))
    importForeignContentStubs(root)
    saveContent(root, createDefaultBlock('ruby_lamp'))

    const result = generateContent(root, listContent(root).map((s) => loadContent(root, s.kind, s.id)))
    const lang = JSON.parse(readFileSync(join(root, langRel), 'utf-8')) as Record<string, string>
    // 外来键保留 + 本轮托管键写入
    expect(lang['custom.foreign.key']).toBe('Keep Me')
    expect(lang['block.testmod.ruby_lamp']).toBeTruthy()
    expect(result.diverged).not.toContain(langRel)
  })

  it('织入型文件（主类）不登记保护，生成时仍可正常织入', () => {
    seedAiArtifacts()
    writeRel(
      'src/main/java/com/kunyu/testmod/TestmodMod.java',
      'public class TestmodMod { /* ai handwritten */ }\n'
    )
    importForeignContentStubs(root)
    generateContent(root, listContent(root).map((s) => loadContent(root, s.kind, s.id)))
    // 主类属于织入型：保留手写内容并补注册织入，而非跳过或整体覆盖
    const mainClass = readFileSync(join(root, 'src/main/java/com/kunyu/testmod/TestmodMod.java'), 'utf-8')
    expect(mainClass).toContain('ai handwritten')
  })
})
