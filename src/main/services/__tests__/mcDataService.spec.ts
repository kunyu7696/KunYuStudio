import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { McDataService } from '../mcDataService'

const root = join(process.cwd(), 'resources', 'mcdata')
const svc = new McDataService(root)

describe('McDataService（minecraft-data 1.20.1 离线子集）', () => {
  it('数据目录就绪', () => {
    expect(svc.available()).toBe(true)
  })

  it('中文口语名 → 标准注册名：钻石矿', () => {
    const { entries } = svc.lookup('钻石矿', ['block'], 3)
    expect(entries[0].name).toBe('diamond_ore')
    expect(entries[0].zhName).toBe('钻石矿石')
  })

  it('注册名精确查询 + 方块事实参数（硬度/材质）', () => {
    const e = svc.resolve('stone', 'block')
    expect(e).not.toBeNull()
    expect(e!.displayName).toBe('Stone')
    expect(e!.facts.hardness).toBe(1.5)
    expect(e!.facts.material).toBeDefined()
  })

  it('英文名模糊：diamond sword 命中钻石剑（去空格宽松匹配）', () => {
    const { entries } = svc.lookup('diamond sword', ['item'], 5)
    expect(entries.map((e) => e.name)).toContain('diamond_sword')
  })

  it('实体中文：僵尸 → zombie，含碰撞箱与分类', () => {
    const { entries } = svc.lookup('僵尸', ['entity'], 3)
    expect(entries[0].name).toBe('zombie')
    expect(entries[0].facts.type).toBeDefined()
    expect((entries[0].facts.width as number) > 0).toBe(true)
  })

  it('附魔中文：锋利 → sharpness，带 maxLevel', () => {
    const { entries } = svc.lookup('锋利', ['enchantment'], 3)
    expect(entries[0].name).toBe('sharpness')
    expect(entries[0].facts.maxLevel).toBe(5)
  })

  it('食物事实：金胡萝卜 hunger 6 / 高饱和度', () => {
    const e = svc.resolve('golden_carrot', 'food')
    expect(e).not.toBeNull()
    expect(e!.facts.foodPoints).toBe(6)
  })

  it('全类检索：铁锭同时存在 item，命中排在前列', () => {
    const { entries } = svc.lookup('铁锭', undefined, 10)
    const top = entries[0]
    expect(top.kind).toBe('item')
    expect(top.name).toBe('iron_ingot')
  })

  it('配方查询：stick 返回木板合成配方并解析成分注册名', () => {
    const recipes = svc.recipes('stick', 5)
    expect(recipes.length).toBeGreaterThan(0)
    const first = recipes[0]
    expect(first.output).toBe('stick')
    expect(first.ingredients).toContain('oak_planks')
  })

  it('配方中文查询：火把 → torch', () => {
    const recipes = svc.recipes('火把', 5)
    expect(recipes.some((r) => r.output === 'torch')).toBe(true)
  })

  it('空查询返回空；未命中返回空集不抛错', () => {
    expect(svc.lookup('   ').entries).toEqual([])
    expect(svc.lookup('不存在的东西xyz123', ['block']).entries).toEqual([])
    expect(svc.recipes('不存在的东西xyz123')).toEqual([])
  })
})
