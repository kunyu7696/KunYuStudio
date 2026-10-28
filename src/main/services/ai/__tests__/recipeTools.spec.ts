/**
 * P1 配方 FC 工具单测：
 * recipe_validate（校验+预览）、recipe_create（幂等挂载到 .kunyu/content）、
 * recipe_generate（中文→注册名解析、三种配方组装、原版参考、直接落盘）。
 * mcData 使用真实 resources/mcdata（1.20.1 子集）。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createToolRegistry, type ToolRegistry, type ToolResult } from '../toolRegistry'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'
import { McDataService } from '../../mcDataService'
import { createDefaultItem, type ItemSchema } from '../../../../shared/schemas/item.schema'
import type { ContentDefinition } from '../../../../shared/types/content'
import type { RecipeDef } from '../../../../shared/schemas/recipe.schema'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

let root: string
let registry: ToolRegistry

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-recipe-'))
  registerProjectRoot(root)
  mkdirSync(join(root, 'src', 'main', 'resources'), { recursive: true })
  writeFileSync(
    join(root, 'src', 'main', 'resources', 'fabric.mod.json'),
    JSON.stringify({ id: 'kunyutest', name: 'KunYu Test' })
  )
  const mcData = new McDataService(join(process.cwd(), 'resources', 'mcdata'))
  registry = createToolRegistry({ projectRoot: () => root, mcData: () => mcData })
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

async function run(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return registry.executeTool(name, args, CTX)
}

async function createItem(id: string): Promise<void> {
  const item = createDefaultItem(id) as ItemSchema
  const r = await run('content_upsert', { content: item as ContentDefinition })
  expect(r.ok).toBe(true)
}

describe('recipe_validate', () => {
  it('三个工具均已注册；recipe_create 无项目时不暴露', () => {
    const names = registry.getToolDefinitions().map((d) => d.function.name)
    expect(names).toContain('recipe_validate')
    expect(names).toContain('recipe_create')
    expect(names).toContain('recipe_generate')
    const noProject = createToolRegistry({})
    expect(noProject.getToolDefinitions().map((d) => d.function.name)).not.toContain('recipe_create')
  })

  it('合法 shaped 配方通过并预览原版 JSON（裸名补项目 ns）', async () => {
    const recipe: RecipeDef = {
      id: 'ruby_sword',
      kind: 'crafting_shaped',
      pattern: ['R', 'R', 'S'],
      key: { R: { item: 'ruby' }, S: { item: 'minecraft:stick' } },
      result: { item: 'ruby_sword', count: 1 }
    }
    const r = await run('recipe_validate', { recipe })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('校验通过')
    const vanilla = (r.data as { vanilla: Record<string, unknown> }).vanilla
    expect(vanilla['type']).toBe('minecraft:crafting_shaped')
    expect(vanilla['pattern']).toEqual(['R', 'R', 'S'])
    expect(vanilla['key']).toMatchObject({
      R: { item: 'kunyutest:ruby' },
      S: { item: 'minecraft:stick' }
    })
    expect(vanilla['result']).toMatchObject({ item: 'kunyutest:ruby_sword' })
  })

  it('网格字符未映射时失败；key 多余字符给警告', async () => {
    const bad: RecipeDef = {
      id: 'x',
      kind: 'crafting_shaped',
      pattern: ['D  ', '   ', '   '],
      key: {},
      result: { item: 'minecraft:diamond', count: 1 }
    }
    const r1 = await run('recipe_validate', { recipe: bad })
    expect(r1.ok).toBe(false)
    expect(r1.text).toContain('未映射')

    const warn: RecipeDef = {
      id: 'x2',
      kind: 'crafting_shaped',
      pattern: ['A  ', '   ', '   '],
      key: { A: { item: 'minecraft:stone' }, Z: { item: 'minecraft:cobblestone' } },
      result: { item: 'minecraft:diamond', count: 1 }
    }
    const r2 = await run('recipe_validate', { recipe: warn })
    expect(r2.ok).toBe(true)
    expect(r2.text).toContain('未在 pattern 中使用')
  })

  it('无项目且未给 namespace 时拒绝；给 namespace 可预览', async () => {
    const noProject = createToolRegistry({})
    const recipe: RecipeDef = {
      id: 'a',
      kind: 'crafting_shapeless',
      ingredients: [{ item: 'stone' }],
      result: { item: 'a', count: 1 }
    }
    const r1 = await noProject.executeTool('recipe_validate', { recipe }, CTX)
    expect(r1.ok).toBe(false)
    expect(r1.error).toContain('namespace')
    const r2 = await noProject.executeTool('recipe_validate', { recipe, namespace: 'mymod' }, CTX)
    expect(r2.ok).toBe(true)
    expect(r2.text).toContain('data/mymod/recipes/a.json')
  })

  it('shapeless 超过 9 原料失败；smelting 缺 input 失败', async () => {
    const tooMany: RecipeDef = {
      id: 'a',
      kind: 'crafting_shapeless',
      ingredients: Array.from({ length: 10 }, () => ({ item: 'minecraft:stone' })),
      result: { item: 'a', count: 1 }
    }
    expect((await run('recipe_validate', { recipe: tooMany })).ok).toBe(false)
    const noInput: RecipeDef = { id: 'a', kind: 'smelting', result: { item: 'a', count: 1 } }
    expect((await run('recipe_validate', { recipe: noInput })).ok).toBe(false)
  })
})

describe('recipe_create', () => {
  it('幂等挂载：首次追加、同 id 覆盖；非法配方拒绝；owner 不存在报错', async () => {
    await createItem('ruby_pickaxe')
    const recipe: RecipeDef = {
      id: 'ruby_pickaxe',
      kind: 'crafting_shaped',
      pattern: ['RRR', ' S ', ' S '],
      key: { R: { item: 'ruby' }, S: { item: 'minecraft:stick' } },
      result: { item: 'ruby_pickaxe', count: 1 }
    }
    const r1 = await run('recipe_create', { ownerKind: 'item', ownerId: 'ruby_pickaxe', recipe })
    expect(r1.ok).toBe(true)
    expect(r1.data).toMatchObject({ replaced: false, total: 1 })

    // 同 id 覆盖
    recipe.result.count = 2
    const r2 = await run('recipe_create', { ownerKind: 'item', ownerId: 'ruby_pickaxe', recipe })
    expect(r2.data).toMatchObject({ replaced: true, total: 1 })

    // 追加第二条
    const alt: RecipeDef = {
      id: 'ruby_pickaxe_alt',
      kind: 'crafting_shapeless',
      ingredients: [{ item: 'minecraft:diamond' }],
      result: { item: 'ruby_pickaxe', count: 1 }
    }
    const r3 = await run('recipe_create', { ownerKind: 'item', ownerId: 'ruby_pickaxe', recipe: alt })
    expect(r3.data).toMatchObject({ replaced: false, total: 2 })

    // 落盘后可读回
    const read = await run('content_read', { kind: 'item', id: 'ruby_pickaxe' })
    const def = JSON.parse(read.text) as { recipes?: RecipeDef[] }
    expect(def.recipes).toHaveLength(2)
    expect(def.recipes?.[0]?.result.count).toBe(2)

    // 非法配方拒绝写入
    const bad: RecipeDef = {
      id: 'bad',
      kind: 'crafting_shaped',
      pattern: ['X  ', '   ', '   '],
      key: {},
      result: { item: 'ruby_pickaxe', count: 1 }
    }
    const r4 = await run('recipe_create', { ownerKind: 'item', ownerId: 'ruby_pickaxe', recipe: bad })
    expect(r4.ok).toBe(false)

    // owner 不存在
    const r5 = await run('recipe_create', {
      ownerKind: 'item',
      ownerId: 'ghost',
      recipe: alt
    })
    expect(r5.ok).toBe(false)
    expect(r5.error).toContain('不存在')
  })
})

describe('recipe_generate', () => {
  it('shaped 中文解析：钻石剑 → 注册名 + pattern + 原版参考', async () => {
    const r = await run('recipe_generate', {
      kind: 'crafting_shaped',
      output: '钻石剑',
      ingredients: [
        { item: '钻石', char: 'D' },
        { item: '木棍', char: 'S' }
      ],
      rows: ['D', 'D', 'S']
    })
    expect(r.ok).toBe(true)
    const data = r.data as { recipe: RecipeDef }
    expect(data.recipe.result.item).toBe('minecraft:diamond_sword')
    expect(data.recipe.key).toMatchObject({
      D: { item: 'minecraft:diamond' },
      S: { item: 'minecraft:stick' }
    })
    expect(data.recipe.pattern).toEqual(['D', 'D', 'S'])
    // 产物为原版物品时保留 minecraft 命名空间（不落盘）
    const vanilla = (r.data as { vanilla: Record<string, unknown> }).vanilla
    expect(vanilla['result']).toMatchObject({ item: 'minecraft:diamond_sword' })
    expect(r.text).toContain('原版同产物配方参考')
  })

  it('shapeless amount 展开且不超过 9 格', async () => {
    const r = await run('recipe_generate', {
      kind: 'crafting_shapeless',
      output: 'minecraft:diamond',
      ingredients: [
        { item: 'minecraft:coal_block', amount: 1 },
        { item: '煤炭', amount: 8 }
      ]
    })
    expect(r.ok).toBe(true)
    const data = r.data as { recipe: RecipeDef }
    expect(data.recipe.ingredients).toHaveLength(9)
    expect(data.recipe.ingredients?.filter((i) => i.item === 'minecraft:coal')).toHaveLength(8)
  })

  it('smelting：铁矿石→铁锭，经验与烧炼时间透传', async () => {
    const r = await run('recipe_generate', {
      kind: 'smelting',
      output: '铁锭',
      input: '铁矿石',
      experience: 0.7,
      cookingTime: 200
    })
    expect(r.ok).toBe(true)
    const data = r.data as { recipe: RecipeDef; vanilla: Record<string, unknown> }
    expect(data.recipe.input).toBe('minecraft:iron_ore')
    expect(data.recipe.result.item).toBe('minecraft:iron_ingot')
    expect(data.vanilla['ingredient']).toEqual({ item: 'minecraft:iron_ore' })
    expect(data.vanilla['experience']).toBeCloseTo(0.7)
  })

  it('网格出现未声明字符 / 无法识别物品时失败并给候选', async () => {
    const r1 = await run('recipe_generate', {
      kind: 'crafting_shaped',
      output: '钻石剑',
      ingredients: [{ item: '钻石', char: 'D' }],
      rows: ['D', 'X']
    })
    expect(r1.ok).toBe(false)
    expect(r1.error).toContain('字符')

    const r2 = await run('recipe_generate', {
      kind: 'crafting_shapeless',
      output: '钻石剑',
      ingredients: [{ item: '一种不存在的夸克物品zzz' }]
    })
    expect(r2.ok).toBe(false)
  })

  it('给 owner 时直接幂等落盘（中文产物落到本 mod 物品用裸名）', async () => {
    await createItem('ruby_amulet')
    const r = await run('recipe_generate', {
      kind: 'crafting_shaped',
      output: 'ruby_amulet',
      ingredients: [
        { item: 'ruby', char: 'R' },
        { item: '金锭', char: 'G' }
      ],
      rows: ['GRG', 'GGG'],
      ownerKind: 'item',
      ownerId: 'ruby_amulet'
    })
    expect(r.ok).toBe(true)
    const data = r.data as { saved: { replaced: boolean; total: number }; vanilla: Record<string, unknown> }
    expect(data.saved).toMatchObject({ ownerKind: 'item', ownerId: 'ruby_amulet', replaced: false, total: 1 })
    // 本 mod 裸名补 kunyutest 命名空间
    expect((data.vanilla['result'] as { item: string }).item).toBe('kunyutest:ruby_amulet')
    const read = await run('content_read', { kind: 'item', id: 'ruby_amulet' })
    const def = JSON.parse(read.text) as { recipes?: RecipeDef[] }
    expect(def.recipes?.[0]?.id).toBe('ruby_amulet')
  })
})
