/**
 * T8/P5：造匠语义资产工具测试（content_list/read/upsert + model_validate + item_validate）。
 * 无项目时工具不暴露；有项目时读写 .kunyu/content；模型/物品结构编辑保留既存像素画。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createToolRegistry, type ToolRegistry, type ToolResult } from '../toolRegistry'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'
import {
  createDefaultBlock,
  createDefaultEnchantment,
  createDefaultEntity,
  createDefaultModel,
  type ContentDefinition,
  type ModelAsset
} from '../../../../shared/types/content'
import { createDefaultItem, type ItemSchema } from '../../../../shared/schemas/item.schema'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }
const CONTENT_TOOLS = ['content_list', 'content_read', 'content_upsert', 'model_validate', 'item_validate']

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-tools-'))
  registerProjectRoot(root)
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

async function run(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  return registry.executeTool(name, args, CTX)
}

describe('T8 语义资产工具门控', () => {
  it('未注入项目根时不暴露 content 工具，注入后可用', () => {
    const noProject = createToolRegistry()
    const exposed = noProject.getToolDefinitions().map((d) => d.function.name)
    for (const name of CONTENT_TOOLS) expect(exposed).not.toContain(name)
    // 既有只读工具不受影响
    expect(exposed).toContain('template_search')

    const withProject = createToolRegistry({ projectRoot: () => root })
    const exposed2 = withProject.getToolDefinitions().map((d) => d.function.name)
    for (const name of CONTENT_TOOLS) expect(exposed2).toContain(name)
  })

  it('无项目时直接执行返回错误', async () => {
    const registry = createToolRegistry()
    const result = await run(registry, 'content_list', {})
    expect(result.ok).toBe(false)
    expect(result.error).toContain('不可用')
  })
})

describe('T8 content_list / content_read / content_upsert', () => {
  it('upsert 方块后 list 可见、read 内容一致', async () => {
    const registry = createToolRegistry({ projectRoot: () => root })
    expect(await run(registry, 'content_list', {})).toMatchObject({ ok: true })
    const list0 = JSON.parse((await run(registry, 'content_list', {})).text)
    expect(list0).toHaveLength(0)

    const block = createDefaultBlock('ruby_block')
    block.displayName = { en_us: 'Ruby Block', zh_cn: '红宝石块' }
    const up = await run(registry, 'content_upsert', { content: block as ContentDefinition })
    expect(up.ok).toBe(true)
    expect(up.text).toContain('ruby_block')

    const list = JSON.parse((await run(registry, 'content_list', { kind: 'block' })).text)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ kind: 'block', id: 'ruby_block', displayName: '红宝石块' })

    // kind 过滤：模型仍为空
    const models = JSON.parse((await run(registry, 'content_list', { kind: 'model' })).text)
    expect(models).toHaveLength(0)

    const read = await run(registry, 'content_read', { kind: 'block', id: 'ruby_block' })
    expect(read.ok).toBe(true)
    expect(JSON.parse(read.text)).toMatchObject({ kind: 'block', id: 'ruby_block' })
  })

  it('实体走 entities/ 目录：upsert/list/read 贯通（P0 仅语义）', async () => {
    const registry = createToolRegistry({ projectRoot: () => root })
    const entity = createDefaultEntity('ruby_golem', 'hostile')
    entity.displayName = { en_us: 'Ruby Golem', zh_cn: '红宝石傀儡' }
    const up = await run(registry, 'content_upsert', { content: entity as ContentDefinition })
    expect(up.ok).toBe(true)

    const list = JSON.parse((await run(registry, 'content_list', { kind: 'entity' })).text)
    expect(list).toMatchObject([{ kind: 'entity', id: 'ruby_golem', displayName: '红宝石傀儡' }])

    const read = await run(registry, 'content_read', { kind: 'entity', id: 'ruby_golem' })
    expect(read.ok).toBe(true)
    expect(JSON.parse(read.text)).toMatchObject({ kind: 'entity', id: 'ruby_golem' })
  })

  it('附魔走 enchantments/ 目录：upsert/list/read 贯通，schema 经归一化', async () => {
    const registry = createToolRegistry({ projectRoot: () => root })
    const ench = createDefaultEnchantment('soul_fire')
    ench.displayName = { en_us: 'Soul Fire', zh_cn: '灵魂火' }
    ench.target = 'WEAPON'
    const up = await run(registry, 'content_upsert', { content: ench as ContentDefinition })
    expect(up.ok).toBe(true)

    const list = JSON.parse((await run(registry, 'content_list', { kind: 'enchantment' })).text)
    expect(list).toMatchObject([{ kind: 'enchantment', id: 'soul_fire', displayName: '灵魂火' }])

    const read = await run(registry, 'content_read', { kind: 'enchantment', id: 'soul_fire' })
    expect(read.ok).toBe(true)
    expect(read.text).toContain('"kind": "enchantment"')
    expect(JSON.parse(read.text)).toMatchObject({ id: 'soul_fire', rarity: 'RARE' })

    // 非法附魔（坏 id）经 saveContent 校验返回失败
    const bad = createDefaultEnchantment('Bad-Name')
    expect(
      await run(registry, 'content_upsert', { content: bad as ContentDefinition })
    ).toMatchObject({ ok: false })
  })

  it('参数校验：非对象 / 缺 id / 非法 kind / read 缺参均失败', async () => {
    const registry = createToolRegistry({ projectRoot: () => root })

    expect(await run(registry, 'content_upsert', { content: null })).toMatchObject({ ok: false })
    expect(await run(registry, 'content_upsert', { content: { kind: 'block' } })).toMatchObject({
      ok: false
    })
    expect(
      await run(registry, 'content_upsert', {
        content: { kind: 'weapon', id: 'sword' }
      })
    ).toMatchObject({ ok: false })
    expect(await run(registry, 'content_read', { kind: 'block' })).toMatchObject({ ok: false })
    expect(await run(registry, 'content_read', { kind: 'nope', id: 'x' })).toMatchObject({
      ok: false
    })
    expect(await run(registry, 'content_read', { kind: 'block', id: 'missing' })).toMatchObject({
      ok: false
    })
  })

  it('模型只改结构（不带 pixels）时保留既存像素画', async () => {
    const registry = createToolRegistry({ projectRoot: () => root })
    const model = createDefaultModel('crate')
    model.pixels.fill('#ff0000')
    expect(await run(registry, 'content_upsert', { content: model as ContentDefinition })).toMatchObject(
      { ok: true }
    )

    // Agent 读回模型（文本中 pixels 被摘要省略）
    const readText = (await run(registry, 'content_read', { kind: 'model', id: 'crate' })).text
    expect(readText).toContain('pixelsSummary')
    expect(readText).not.toContain('#ff0000')

    // 只改 elements，不带 pixels
    const edited: ModelAsset = {
      ...model,
      pixels: [],
      elements: [
        ...model.elements,
        {
          name: 'second',
          from: [8, 0, 8],
          to: [16, 8, 16],
          faces: model.elements[0].faces
        }
      ]
    }
    expect(await run(registry, 'content_upsert', { content: edited as ContentDefinition })).toMatchObject(
      { ok: true }
    )

    // data 通道为完整对象：像素保留、结构更新生效
    const full = (await run(registry, 'content_read', { kind: 'model', id: 'crate' })).data as ModelAsset
    expect(full.pixels).toHaveLength(16 * 16)
    expect(full.pixels.every((p) => p === '#ff0000')).toBe(true)
    expect(full.elements).toHaveLength(2)
    expect(full.elements[1].name).toBe('second')
  })
})

describe('T8 model_validate', () => {
  it('合法模型通过', async () => {
    const registry = createToolRegistry({ projectRoot: () => root })
    const result = await run(registry, 'model_validate', {
      model: createDefaultModel('ok_model')
    })
    expect(result.ok).toBe(true)
    expect(result.text).toContain('通过')
  })

  it('坏模型返回中文错误诊断（非法角度/越界 UV）', async () => {
    const registry = createToolRegistry({ projectRoot: () => root })
    const bad = createDefaultModel('bad_model')
    const first = bad.elements[0]
    expect(first).toBeTruthy()
    first.rotation = { origin: [8, 8, 8], axis: 'y', angle: 10 }
    if (first.faces.north) first.faces.north.uv = [0, 0, 99, 99]
    const result = await run(registry, 'model_validate', { model: bad })
    expect(result.ok).toBe(false)
    expect(result.text).toContain('错误')
  })

  it('不传 model 时按 id 校验已保存模型；无 id 则报错', async () => {
    const registry = createToolRegistry({ projectRoot: () => root })
    expect(await run(registry, 'model_validate', {})).toMatchObject({ ok: false })

    const model = createDefaultModel('saved_crate')
    await run(registry, 'content_upsert', { content: model as ContentDefinition })
    const result = await run(registry, 'model_validate', { id: 'saved_crate' })
    expect(result.ok).toBe(true)
  })
})

describe('P5 ItemTools：item_validate 与物品像素画保护', () => {
  it('合法工具物品通过并带归一化预览；缺 tool 配置返回中文诊断', async () => {
    const registry = createToolRegistry({ projectRoot: () => root })
    const sword = createDefaultItem('ruby_sword', 'tool')
    const ok = await run(registry, 'item_validate', { content: sword as unknown as Record<string, unknown> })
    expect(ok.ok).toBe(true)
    expect(ok.text).toContain('合法')
    expect(ok.text).toContain('itemType')

    const bad = createDefaultItem('ruby_axe', 'tool')
    delete bad.tool
    const res = await run(registry, 'item_validate', { content: bad as unknown as Record<string, unknown> })
    expect(res.ok).toBe(false)
    expect(res.text).toContain('工具物品缺少工具配置')
  })

  it('item_validate：非对象 / 非 item kind / 缺 id 快速失败', async () => {
    const registry = createToolRegistry({ projectRoot: () => root })
    expect(await run(registry, 'item_validate', { content: null })).toMatchObject({ ok: false })
    expect(
      await run(registry, 'item_validate', { content: { kind: 'block', id: 'x' } })
    ).toMatchObject({ ok: false })
    expect(await run(registry, 'item_validate', { content: { kind: 'item' } })).toMatchObject({
      ok: false
    })
  })

  it('content_upsert 物品不带 pixels 时保留既存像素画，read 文本摘要化', async () => {
    const registry = createToolRegistry({ projectRoot: () => root })
    const item = createDefaultItem('ruby', 'simple')
    item.texture.pixels = new Array<string>(256).fill('#00ff00')
    expect(
      await run(registry, 'content_upsert', { content: item as ContentDefinition })
    ).toMatchObject({ ok: true })

    // read 文本：pixels 摘要化，不回传 256 项数组
    const readText = (await run(registry, 'content_read', { kind: 'item', id: 'ruby' })).text
    expect(readText).toContain('pixelsSummary')
    expect(readText).not.toContain('#00ff00')

    // Agent 只改显示名（texture 不带 pixels）→ 像素画保留、字段更新生效
    const edited = {
      ...item,
      displayName: { en_us: 'Ruby', zh_cn: '红宝石' },
      texture: { path: '', generated: true, color: '#cbb37a' }
    }
    expect(
      await run(registry, 'content_upsert', { content: edited as ContentDefinition })
    ).toMatchObject({ ok: true })
    const full = (await run(registry, 'content_read', { kind: 'item', id: 'ruby' })).data as ItemSchema
    expect(full.texture.pixels).toHaveLength(256)
    expect(full.texture.pixels?.every((p) => p === '#00ff00')).toBe(true)
    expect(full.displayName).toMatchObject({ zh_cn: '红宝石' })
  })
})

describe('C2 kb_search 本地知识库工具', () => {
  it('未注入 kbRag 端口时不暴露工具', () => {
    const exposed = createToolRegistry().getToolDefinitions().map((d) => d.function.name)
    expect(exposed).not.toContain('kb_search')
  })

  it('命中时返回片段正文与相关度；降级时带提示', async () => {
    const registry = createToolRegistry({
      kbRag: async () => ({
        async search() {
          return {
            degraded: false,
            hits: [
              {
                score: 0.8123,
                chunk: {
                  relPath: 'ai-reference/templates/x/Block.java',
                  index: 2,
                  text: 'Registry.register(Registries.BLOCK, new Identifier(MOD_ID, "ruby"), block)'
                }
              }
            ]
          }
        }
      })
    })
    const exposed = registry.getToolDefinitions().map((d) => d.function.name)
    expect(exposed).toContain('kb_search')

    const res = await run(registry, 'kb_search', { query: '如何注册方块' })
    expect(res.ok).toBe(true)
    expect(res.text).toContain('Registry.register')
    expect(res.text).toContain('Block.java#2')
    expect(res.text).toContain('0.812')

    const degraded = await run(
      createToolRegistry({
        kbRag: async () => ({
          async search() {
            return { degraded: true, reason: '向量相似度过低，已改用关键词匹配', hits: [
              { score: 1, chunk: { relPath: 'a.md', index: 0, text: '关键词命中内容' } }
            ] }
          }
        })
      }),
      'kb_search',
      { query: 'x' }
    )
    expect(degraded.text).toContain('[提示]')
    expect(degraded.text).toContain('关键词')
  })

  it('空 query / 端口返回 null / 无命中均软处理', async () => {
    const registry = createToolRegistry({ kbRag: async () => null })
    expect(await run(registry, 'kb_search', { query: 'x' })).toMatchObject({ ok: false })

    const empty = createToolRegistry({
      kbRag: async () => ({ search: async () => ({ degraded: false, hits: [] }) })
    })
    const noHit = await run(empty, 'kb_search', { query: '不存在的东西' })
    expect(noHit.ok).toBe(true)
    expect(noHit.text).toContain('未命中')

    const blank = await run(empty, 'kb_search', { query: '  ' })
    expect(blank).toMatchObject({ ok: false })
  })
})

// 调度工具 kind 校验 + 熔断重抛
describe('T8 调度工具门控与熔断', () => {
  it('gradle_build 不在模型可见工具列表中', () => {
    const registry = createToolRegistry({ runGradle: () => 'x' })
    const exposed = registry.getToolDefinitions().map((d) => d.function.name)
    expect(exposed).not.toContain('gradle_build')
  })

  it('模型调用路径（不传 scheduling）执行 gradle_build 被拒绝', async () => {
    const registry = createToolRegistry({ runGradle: () => 'x' })
    // CTX 不含 scheduling
    const res = await registry.executeTool('gradle_build', { root }, CTX)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('调度工具')
  })

  it('传 scheduling:true 可执行 gradle_build，且 root 越界被拒', async () => {
    const registry = createToolRegistry({ runGradle: () => 'x' })
    // root 在已注册项目根内 → 不触发 assertWithinRoot；这里测越界
    const outside = await registry.executeTool(
      'gradle_build',
      { root: 'C:\\Windows\\System32' },
      { ...CTX, scheduling: true }
    )
    expect(outside.ok).toBe(false)
    expect(outside.error).toContain('项目根')
  })

  it('BudgetExceededError 在工具路径上抛（不被 catch-all 吞掉）', async () => {
    const registry = createToolRegistry({ runGradle: () => 'x' })
    // 注册一个会抛 BudgetExceededError 的 chat 工具
    const { BudgetExceededError } = await import('../orchestrator/types')
    registry.registerTool(
      { type: 'function', function: { name: 'budget_bomb', description: '', parameters: { type: 'object', properties: {} } } },
      async () => { throw new BudgetExceededError('over') },
      'chat'
    )
    await expect(registry.executeTool('budget_bomb', {}, CTX)).rejects.toThrow(BudgetExceededError)
  })
})
