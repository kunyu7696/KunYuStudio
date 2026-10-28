import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deleteContent,
  findExtraMissingContentTypes,
  listContent,
  loadContent,
  saveContent,
  saveItemTexture,
  saveModelTexture
} from '../contentService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import {
  createDefaultBlock,
  createDefaultEntity,
  createDefaultModel,
  type BlockSchema,
  type EntitySchema,
  type ModelAsset
} from '../../../shared/types/content'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ky-content-svc-'))
  registerProjectRoot(root)
  const resources = join(root, 'src', 'main', 'resources')
  mkdirSync(resources, { recursive: true })
  writeFileSync(
    join(resources, 'fabric.mod.json'),
    JSON.stringify({ schemaVersion: 1, id: 'testmod', version: '1.0.0' })
  )
  writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.kunyu.testmod\n')
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('ModelAsset 语义 CRUD（M12）', () => {
  it('保存默认模型后可列出并读回，落在 .kunyu/content/models/', () => {
    const m = createDefaultModel('ruby_crate')
    m.displayName = '红宝石箱'
    const summary = saveContent(root, m)
    expect(summary.kind).toBe('model')

    const listed = listContent(root).find((s) => s.kind === 'model' && s.id === 'ruby_crate')
    expect(listed?.displayName).toBe('红宝石箱')

    const back = loadContent(root, 'model', 'ruby_crate') as ModelAsset
    expect(back.kind).toBe('model')
    expect(back.elements).toHaveLength(1)
    expect(back.pixels).toHaveLength(256)
    expect(back.textures.all).toBe('textures/model/ruby_crate.png')
    expect(existsSync(join(root, '.kunyu', 'content', 'models', 'ruby_crate.json'))).toBe(true)
  })

  it('规范化：非法颜色像素清为透明，all 路径随 id 归一', () => {
    const m = createDefaultModel('crate2')
    m.pixels[0] = '#ff0000'
    m.pixels[1] = 'not-a-color'
    m.textures.all = 'textures/model/old_name.png'
    saveContent(root, m)
    const back = loadContent(root, 'model', 'crate2') as ModelAsset
    expect(back.pixels[0]).toBe('#ff0000')
    expect(back.pixels[1]).toBe('')
    expect(back.textures.all).toBe('textures/model/crate2.png')
  })

  it('重命名保存删除旧语义文件', () => {
    const m = createDefaultModel('old_id')
    saveContent(root, m)
    m.id = 'new_id'
    saveContent(root, m, 'old_id')
    expect(existsSync(join(root, '.kunyu', 'content', 'models', 'old_id.json'))).toBe(false)
    expect(existsSync(join(root, '.kunyu', 'content', 'models', 'new_id.json'))).toBe(true)
  })

  it('删除模型语义文件', () => {
    saveContent(root, createDefaultModel('gone'))
    expect(deleteContent(root, 'model', 'gone')).toBe(true)
    expect(listContent(root).some((s) => s.id === 'gone')).toBe(false)
  })

  it('硬校验：像素长度不符拒绝保存', () => {
    const m = createDefaultModel('bad')
    m.pixels = ['#000000']
    expect(() => saveContent(root, m)).toThrow(/像素数据长度/)
  })

  it('硬校验：from>to 的非法立方体拒绝保存', () => {
    const m = createDefaultModel('bad2')
    m.elements[0].to = [1, 1, 1]
    m.elements[0].from = [16, 16, 16]
    expect(() => saveContent(root, m)).toThrow(/from/)
  })

  it('硬校验：坐标越界拒绝保存', () => {
    const m = createDefaultModel('bad3')
    m.elements[0].to = [20, 16, 16]
    expect(() => saveContent(root, m)).toThrow(/0-16/)
  })
})

describe('saveModelTexture 像素画落盘（M12）', () => {
  it('写入 assets/testmod/textures/model/<id>.png 且为合法 PNG 文件头', () => {
    const pixels = Array.from({ length: 256 }, () => '')
    pixels[0] = '#ff0000'
    pixels[255] = '#00ff00'
    const rel = saveModelTexture(root, 'crate_tex', pixels, 16)
    expect(rel).toBe('textures/model/crate_tex.png')
    const buf = readFileSync(
      join(root, 'src', 'main', 'resources', 'assets', 'testmod', 'textures', 'model', 'crate_tex.png')
    )
    // PNG 签名 89 50 4E 47 0D 0A 1A 0A
    expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    // 含 IHDR 与 IEND chunk
    expect(buf.includes('IHDR')).toBe(true)
    expect(buf.includes('IEND')).toBe(true)
  })

  it('像素数量不符抛错', () => {
    expect(() => saveModelTexture(root, 'bad', ['#fff'], 16)).toThrow(/256/)
  })

  it('非法 id 抛错', () => {
    expect(() => saveModelTexture(root, 'Bad Id', [], 16)).toThrow()
  })
})

describe('saveItemTexture 物品像素画落盘（P4）', () => {
  it('写入 assets/testmod/textures/item/<id>.png 且为合法 PNG 文件头', () => {
    const pixels = Array.from({ length: 256 }, () => '')
    pixels[0] = '#ff0000'
    pixels[255] = '#00ff00'
    const rel = saveItemTexture(root, 'ruby', pixels)
    expect(rel).toBe('textures/item/ruby.png')
    const buf = readFileSync(
      join(root, 'src', 'main', 'resources', 'assets', 'testmod', 'textures', 'item', 'ruby.png')
    )
    expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(buf.includes('IHDR')).toBe(true)
    expect(buf.includes('IEND')).toBe(true)
  })

  it('像素数量不符抛错', () => {
    expect(() => saveItemTexture(root, 'bad', ['#fff'])).toThrow(/256/)
  })

  it('非法 id 抛错', () => {
    expect(() => saveItemTexture(root, 'Bad Id', [])).toThrow()
  })
})

describe('方块 Schema 重做：旧扁平 JSON 读取迁移', () => {
  it('无 blockType 的旧方块 JSON 在 loadContent 时迁移为 BlockSchema', () => {
    const blocksDir = join(root, '.kunyu', 'content', 'blocks')
    mkdirSync(blocksDir, { recursive: true })
    const legacy = {
      kind: 'block',
      id: 'old_lamp',
      displayName: '旧版电灯',
      description: 'legacy',
      preset: 'glowing',
      textureColor: '#b9e678',
      customTexture: null,
      hardness: 1.5,
      resistance: 1.5,
      miningTool: 'hand',
      miningLevel: 0,
      luminance: 12,
      requiresTool: false,
      dropsSelf: true,
      pistonPushable: true,
      collisionType: 'full',
      rightClickAction: 'none',
      soundGroup: 'stone',
      createdAt: 1,
      updatedAt: 1
    }
    writeFileSync(join(blocksDir, 'old_lamp.json'), JSON.stringify(legacy))

    const migrated = loadContent(root, 'block', 'old_lamp') as BlockSchema
    expect(migrated.kind).toBe('block')
    expect(migrated.blockType).toBe('simple')
    expect(migrated.displayName).toEqual({ en_us: '旧版电灯', zh_cn: '旧版电灯' })
    expect(migrated.properties.lightLevel).toBe(12)
    expect(migrated.texture.color).toBe('#b9e678')
    // listContent 摘要走双语名回落
    const listed = listContent(root).find((s) => s.kind === 'block' && s.id === 'old_lamp')
    expect(listed?.displayName).toBe('旧版电灯')
  })

  it('新方块保存双语名并可按名校验非空', () => {
    const b = createDefaultBlock('new_block')
    b.displayName = { en_us: 'New Block', zh_cn: '新方块' }
    const summary = saveContent(root, b)
    expect(summary.displayName).toBe('新方块')
    const back = loadContent(root, 'block', 'new_block') as BlockSchema
    expect(back.properties.hardness).toBe(2)
  })
})

describe('实体 P0：语义 JSON CRUD（entities/ 目录）', () => {
  it('保存默认被动实体后 list/read 可见，落在 .kunyu/content/entities/', () => {
    const e = createDefaultEntity('ruby_golem')
    e.displayName = { en_us: 'Ruby Golem', zh_cn: '红宝石傀儡' }
    const summary = saveContent(root, e)
    expect(summary.kind).toBe('entity')
    expect(summary.displayName).toBe('红宝石傀儡')

    const listed = listContent(root).find((s) => s.kind === 'entity' && s.id === 'ruby_golem')
    expect(listed?.displayName).toBe('红宝石傀儡')

    const back = loadContent(root, 'entity', 'ruby_golem') as EntitySchema
    expect(back.kind).toBe('entity')
    expect(back.entityType).toBe('passive')
    expect(existsSync(join(root, '.kunyu', 'content', 'entities', 'ruby_golem.json'))).toBe(true)
  })

  it('重命名实体删除旧文件，删除实体后列表消失', () => {
    const e = createDefaultEntity('temp_mob')
    saveContent(root, e)
    e.id = 'renamed_mob'
    saveContent(root, e, 'temp_mob')
    expect(existsSync(join(root, '.kunyu', 'content', 'entities', 'temp_mob.json'))).toBe(false)
    expect(existsSync(join(root, '.kunyu', 'content', 'entities', 'renamed_mob.json'))).toBe(true)
    expect(deleteContent(root, 'entity', 'renamed_mob')).toBe(true)
    expect(listContent(root).some((s) => s.id === 'renamed_mob')).toBe(false)
  })
})

describe('A-04：tag/worldgen/mixin/command 承诺类型轻量检测', () => {
  it('空项目：四类承诺全部缺失（去重、忽略大小写）', () => {
    const missing = findExtraMissingContentTypes(root, [
      'tag',
      'Worldgen',
      'mixin',
      'command',
      'tag'
    ])
    expect(missing).toEqual(['tag', 'worldgen', 'mixin', 'command'])
  })

  it('tag：data/<ns>/tags 下有 JSON 即视为已交付（任意注册表子目录、递归）', () => {
    const dir = join(root, 'src', 'main', 'resources', 'data', 'testmod', 'tags', 'blocks')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'ruby_ore.json'), '{"values":["minecraft:iron_ore"]}')
    expect(findExtraMissingContentTypes(root, ['tag'])).toEqual([])
  })

  it('worldgen：data/<ns>/worldgen 下有 JSON 即视为已交付', () => {
    const dir = join(
      root,
      'src',
      'main',
      'resources',
      'data',
      'testmod',
      'worldgen',
      'configured_feature'
    )
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'ruby_geode.json'), '{"type":"minecraft:ore","config":{}}')
    expect(findExtraMissingContentTypes(root, ['worldgen'])).toEqual([])
  })

  it('mixin：*.mixins.json 配置或 @Mixin Java 类任一存在即视为已交付', () => {
    expect(findExtraMissingContentTypes(root, ['mixin'])).toEqual(['mixin'])
    const javaDir = join(root, 'src', 'main', 'java', 'com', 'example')
    mkdirSync(javaDir, { recursive: true })
    writeFileSync(
      join(javaDir, 'ExampleMixin.java'),
      'package com.example;\n@Mixin(SomeClass.class)\npublic class ExampleMixin {}\n'
    )
    expect(findExtraMissingContentTypes(root, ['mixin'])).toEqual([])
  })

  it('mixin：资源根存在 mixins 配置文件也算交付（无 Java 中间轮）', () => {
    const resRoot = join(root, 'src', 'main', 'resources')
    writeFileSync(join(resRoot, 'testmod.mixins.json'), '{"client":[],"mixins":[]}')
    expect(findExtraMissingContentTypes(root, ['mixin'])).toEqual([])
  })

  it('command：Java 文件含各加载器命令注册标记即视为已交付', () => {
    expect(findExtraMissingContentTypes(root, ['command'])).toEqual(['command'])
    const javaDir = join(root, 'src', 'main', 'java', 'com', 'example')
    mkdirSync(javaDir, { recursive: true })
    writeFileSync(
      join(javaDir, 'ModCommands.java'),
      'import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;\n' +
        'CommandRegistrationCallback.EVENT.register((d, ra, e) -> {});\n'
    )
    expect(findExtraMissingContentTypes(root, ['command'])).toEqual([])
  })

  it('未知承诺类型忽略，不产生缺口', () => {
    expect(findExtraMissingContentTypes(root, ['gui', 'project', 'unknown-type'])).toEqual([])
  })
})
