/**
 * datapackService 文件系统冒烟测试：
 * embedded（模组内嵌 src/main/resources）与 standalone（项目根）两种布局的
 * 初始化、条目读写删、以及存量 standalone 项目自动升级。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deleteDataPackEntry,
  initDataPack,
  listDataPackEntries,
  readDataPackEntry,
  readDataPackMeta,
  upgradeStandaloneDataPack,
  writeDataPackEntry
} from '../datapackService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ky-dp-svc-'))
  registerProjectRoot(root)
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('数据包 embedded（模组内嵌）闭环', () => {
  it('init：元数据、src/main/resources 下 pack.mcmeta 与全部类别目录', () => {
    const meta = initDataPack(
      root,
      { namespace: 'mymod', description: '测试', mcVersion: '1.20.1' }
    )
    expect(meta.packFormat).toBe(15)
    const base = join(root, 'src', 'main', 'resources')
    expect(existsSync(join(base, 'pack.mcmeta'))).toBe(true)
    const parsed = JSON.parse(readFileSync(join(base, 'pack.mcmeta'), 'utf-8')) as {
      pack: { pack_format: number; description: string }
    }
    expect(parsed.pack.pack_format).toBe(15)
    expect(parsed.pack.description).toBe('测试')
    // 8 类别目录（1.20.1 复数 recipes，tag 在 tags/items）
    expect(existsSync(join(base, 'data', 'mymod', 'recipes'))).toBe(true)
    expect(existsSync(join(base, 'data', 'mymod', 'functions'))).toBe(true)
    expect(existsSync(join(base, 'data', 'mymod', 'tags', 'items'))).toBe(true)
    expect(readDataPackMeta(root)?.namespace).toBe('mymod')
  })

  it('JSON 条目与 .mcfunction 函数写读删闭环', () => {
    initDataPack(root, { namespace: 'mymod', description: '', mcVersion: '1.20.1' })

    const entry = writeDataPackEntry(root, 'recipe', 'ruby', '{"type":"crafting"}')
    expect(entry.path).toBe('data/mymod/recipes/ruby.json')
    expect(entry.category).toBe('recipe')
    const abs = join(root, 'src', 'main', 'resources', 'data', 'mymod', 'recipes', 'ruby.json')
    expect(existsSync(abs)).toBe(true)
    expect(readDataPackEntry(root, 'recipe', 'ruby')).toContain('crafting')

    const fn = writeDataPackEntry(root, 'function', 'give_ruby', 'give @s diamond')
    expect(fn.path).toBe('data/mymod/functions/give_ruby.mcfunction')
    expect(
      existsSync(join(root, 'src', 'main', 'resources', 'data', 'mymod', 'functions', 'give_ruby.mcfunction'))
    ).toBe(true)

    const entries = listDataPackEntries(root)
    expect(entries.some((e) => e.id === 'ruby' && e.category === 'recipe')).toBe(true)
    expect(entries.some((e) => e.id === 'give_ruby' && e.category === 'function')).toBe(true)

    expect(deleteDataPackEntry(root, 'recipe', 'ruby')).toBe(true)
    expect(listDataPackEntries(root).some((e) => e.id === 'ruby')).toBe(false)
  })

  it('非法 ID 与类别被拒绝', () => {
    initDataPack(root, { namespace: 'mymod', description: '', mcVersion: '1.20.1' })
    expect(() => writeDataPackEntry(root, 'recipe', 'Bad-Id', '{}')).toThrow()
    expect(() => writeDataPackEntry(root, 'not-a-category', 'x', '{}')).toThrow()
  })
})

describe('数据包 standalone（独立项目）闭环', () => {
  it('init：根即包根（pack.mcmeta + data），1.21.1 用单数类别目录', () => {
    const meta = initDataPack(
      root,
      { namespace: 'standns', description: '独立', mcVersion: '1.21.1' },
      'standalone'
    )
    expect(meta.packFormat).toBe(48)
    expect(existsSync(join(root, 'pack.mcmeta'))).toBe(true)
    expect(existsSync(join(root, 'data', 'standns', 'recipe'))).toBe(true)
    expect(existsSync(join(root, 'data', 'standns', 'tags', 'item'))).toBe(true)
    // 不应产生 src 目录
    expect(existsSync(join(root, 'src'))).toBe(false)
  })

  it('条目写读删在 standalone 根路径下闭环', () => {
    initDataPack(
      root,
      { namespace: 'mymod', description: '', mcVersion: '1.20.1' },
      'standalone'
    )
    writeDataPackEntry(root, 'recipe', 'ruby', '{"type":"crafting"}', 'standalone')
    expect(existsSync(join(root, 'data', 'mymod', 'recipes', 'ruby.json'))).toBe(true)
    expect(readDataPackEntry(root, 'recipe', 'ruby', 'standalone')).toContain('crafting')
    expect(
      listDataPackEntries(root, 'standalone').some((e) => e.id === 'ruby')
    ).toBe(true)
    expect(deleteDataPackEntry(root, 'recipe', 'ruby', 'standalone')).toBe(true)
  })

  it('upgrade：从根 pack.mcmeta + data 推导元数据并补全目录', () => {
    writeFileSync(
      join(root, 'pack.mcmeta'),
      JSON.stringify({ pack: { pack_format: 48, description: '外部数据包' } })
    )
    // 存量内容：data/old_ns/recipe 下已有文件
    const fileDir = join(root, 'data', 'old_ns', 'recipe')
    mkdirSync(fileDir, { recursive: true })
    writeFileSync(join(fileDir, 'x.json'), '{}')

    const upgraded = upgradeStandaloneDataPack(root)
    expect(upgraded).not.toBeNull()
    expect(upgraded?.namespace).toBe('old_ns')
    expect(upgraded?.mcVersion).toBe('1.21.1')
    expect(upgraded?.description).toBe('外部数据包')
    expect(existsSync(join(root, '.kunyu', 'datapack.json'))).toBe(true)
    // 1.21.1 标准目录补全
    expect(existsSync(join(root, 'data', 'old_ns', 'function'))).toBe(true)
    // 幂等
    expect(upgradeStandaloneDataPack(root)?.namespace).toBe('old_ns')
  })

  it('upgrade：无 pack.mcmeta 时无法识别，返回 null', () => {
    expect(upgradeStandaloneDataPack(root)).toBeNull()
  })
})
