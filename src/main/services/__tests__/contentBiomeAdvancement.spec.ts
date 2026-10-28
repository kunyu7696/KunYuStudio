/**
 * biome / advancement 语义服务测试（M17）。
 * 覆盖：语义文件落盘 + 数据包产物双写、版本目录单复数差异、
 * 删除/重命名同步产物、校验失败拒绝保存。
 */
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
import { deleteContent, listContent, loadContent, saveContent } from '../contentService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import {
  createDefaultAdvancementContent,
  createDefaultBiome,
  type AdvancementDefinition,
  type BiomeDefinition
} from '../../../shared/types/content'
import { createBiomeDefault } from '../../../shared/schemas/datapack/biome.schema'
import { createAdvancementDefault } from '../../../shared/schemas/datapack/advancement.schema'

let root: string

function biomeDef(id: string): BiomeDefinition {
  const b = createDefaultBiome(id)
  b.displayName = `群系 ${id}`
  b.doc = createBiomeDefault()
  return b
}

function advancementDef(id: string): AdvancementDefinition {
  const a = createDefaultAdvancementContent(id)
  a.displayName = `进度 ${id}`
  a.doc = createAdvancementDefault()
  return a
}

/** 写 .kunyu/datapack.json 元数据（namespace/mcVersion 驱动产物路径） */
function writeDatapackMeta(namespace: string, mcVersion: string): void {
  const dir = join(root, '.kunyu')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'datapack.json'),
    JSON.stringify({
      namespace,
      mcVersion,
      loader: 'fabric',
      packFormat: 15,
      description: '',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ky-content-dp-'))
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

describe('biome/advancement 语义 CRUD', () => {
  it('保存后可列出并读回，落在 .kunyu/content/{biomes,advancements}/', () => {
    saveContent(root, biomeDef('crimson_grove'))
    saveContent(root, advancementDef('mine_diamond'))

    expect(
      existsSync(join(root, '.kunyu', 'content', 'biomes', 'crimson_grove.json'))
    ).toBe(true)
    expect(
      existsSync(join(root, '.kunyu', 'content', 'advancements', 'mine_diamond.json'))
    ).toBe(true)

    const summaries = listContent(root)
    expect(summaries.some((s) => s.kind === 'biome' && s.id === 'crimson_grove')).toBe(true)
    expect(summaries.some((s) => s.kind === 'advancement' && s.id === 'mine_diamond')).toBe(true)

    const back = loadContent(root, 'biome', 'crimson_grove') as BiomeDefinition
    expect(back.kind).toBe('biome')
    expect(back.doc.temperature).toBe(0.8)
  })

  it('校验失败拒绝保存：biome doc 缺必填字段', () => {
    const b = biomeDef('bad_biome')
    b.doc = {} // 缺 temperature/downfall/has_precipitation/effects
    expect(() => saveContent(root, b)).toThrow(/temperature/)
  })

  it('校验失败拒绝保存：advancement criteria 为空', () => {
    const a = advancementDef('bad_adv')
    a.doc = { criteria: {} }
    expect(() => saveContent(root, a)).toThrow(/criteria/)
  })

  it('displayName 为空拒绝保存', () => {
    const b = biomeDef('no_name')
    b.displayName = '  '
    expect(() => saveContent(root, b)).toThrow(/显示名称/)
  })
})

describe('数据包产物双写', () => {
  it('模组项目（无数据包元数据）：产物写入 src/main/resources/data/<modid>/worldgen/biome/', () => {
    saveContent(root, biomeDef('crimson_grove'))
    const product = join(
      root,
      'src',
      'main',
      'resources',
      'data',
      'testmod',
      'worldgen',
      'biome',
      'crimson_grove.json'
    )
    expect(existsSync(product)).toBe(true)
    const doc = JSON.parse(readFileSync(product, 'utf-8')) as Record<string, unknown>
    expect(doc.temperature).toBe(0.8)
    expect(doc.has_precipitation).toBe(true)
  })

  it('advancement 目录随版本切换：1.20.1 复数 / 1.21.1 单数', () => {
    // 1.20.1（无元数据时默认回落）：advancements/
    saveContent(root, advancementDef('adv_old'))
    expect(
      existsSync(
        join(root, 'src', 'main', 'resources', 'data', 'testmod', 'advancements', 'adv_old.json')
      )
    ).toBe(true)

    // 1.21.1（元数据驱动）：advancement/
    writeDatapackMeta('testmod', '1.21.1')
    saveContent(root, advancementDef('adv_new'))
    expect(
      existsSync(
        join(root, 'src', 'main', 'resources', 'data', 'testmod', 'advancement', 'adv_new.json')
      )
    ).toBe(true)
  })

  it('standalone 数据包（项目根有 pack.mcmeta）：产物落项目根 data/', () => {
    writeDatapackMeta('mypack', '1.20.1')
    writeFileSync(
      join(root, 'pack.mcmeta'),
      JSON.stringify({ pack: { pack_format: 15, description: '' } })
    )
    saveContent(root, biomeDef('lava_lake'))
    expect(existsSync(join(root, 'data', 'mypack', 'worldgen', 'biome', 'lava_lake.json'))).toBe(
      true
    )
  })

  it('删除语义对象时同步删除产物', () => {
    saveContent(root, biomeDef('gone_biome'))
    const product = join(
      root,
      'src',
      'main',
      'resources',
      'data',
      'testmod',
      'worldgen',
      'biome',
      'gone_biome.json'
    )
    expect(existsSync(product)).toBe(true)
    expect(deleteContent(root, 'biome', 'gone_biome')).toBe(true)
    expect(existsSync(product)).toBe(false)
    expect(existsSync(join(root, '.kunyu', 'content', 'biomes', 'gone_biome.json'))).toBe(false)
  })

  it('重命名保存删除旧产物与新语义文件之外的残留', () => {
    saveContent(root, advancementDef('old_adv'))
    const oldProduct = join(
      root,
      'src',
      'main',
      'resources',
      'data',
      'testmod',
      'advancements',
      'old_adv.json'
    )
    expect(existsSync(oldProduct)).toBe(true)

    const renamed = advancementDef('new_adv')
    saveContent(root, renamed, 'old_adv')
    expect(existsSync(oldProduct)).toBe(false)
    expect(
      existsSync(
        join(root, 'src', 'main', 'resources', 'data', 'testmod', 'advancements', 'new_adv.json')
      )
    ).toBe(true)
    expect(
      existsSync(join(root, '.kunyu', 'content', 'advancements', 'old_adv.json'))
    ).toBe(false)
  })
})
