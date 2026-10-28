import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { createToolRegistry } from '../toolRegistry'
import { McDataService } from '../../mcDataService'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

describe('P0 知识源 FC 工具注册', () => {
  const svc = new McDataService(join(process.cwd(), 'resources', 'mcdata'))
  const registry = createToolRegistry({ mcData: () => svc })
  const names = registry.getToolDefinitions().map((d) => d.function.name)

  it('三个新工具均暴露给模型', () => {
    expect(names).toContain('mc_data_lookup')
    expect(names).toContain('fabric_docs_search')
    expect(names).toContain('mc_wiki_search')
  })

  it('未注入 mcData 时 mc_data_lookup 隐藏，知识工具仍可用', () => {
    const r2 = createToolRegistry({})
    const n2 = r2.getToolDefinitions().map((d) => d.function.name)
    expect(n2).not.toContain('mc_data_lookup')
    expect(n2).toContain('fabric_docs_search')
  })

  it('mc_data_lookup 执行：中文「钻石剑」返回注册名与耐久', async () => {
    const r = await registry.executeTool(
      'mc_data_lookup',
      { kind: 'item', query: '钻石剑' },
      CTX
    )
    expect(r.ok).toBe(true)
    expect(r.text).toContain('minecraft:diamond_sword')
    expect(r.data).toMatchObject({ count: expect.any(Number) })
  })

  it('mc_data_lookup recipe：木棍配方', async () => {
    const r = await registry.executeTool(
      'mc_data_lookup',
      { kind: 'recipe', query: 'stick' },
      CTX
    )
    expect(r.ok).toBe(true)
    expect(r.text).toContain('stick')
    expect(r.text).toContain('oak_planks')
  })

  it('mc_data_lookup 空 query 软失败', async () => {
    const r = await registry.executeTool('mc_data_lookup', { query: '' }, CTX)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('query')
  })

  it('fabric_docs_search 执行：注册系统片段', async () => {
    const r = await registry.executeTool(
      'fabric_docs_search',
      { query: 'Registry.register 注册方块 ItemGroup', limit: 4 },
      CTX
    )
    expect(r.ok).toBe(true)
    expect(r.text).toContain('注册')
  })

  it('mc_wiki_search 执行：命名空间片段', async () => {
    const r = await registry.executeTool(
      'mc_wiki_search',
      { query: '命名空间 Identifier 注册名', limit: 4 },
      CTX
    )
    expect(r.ok).toBe(true)
    expect(r.text).toContain('Identifier')
  })
})
