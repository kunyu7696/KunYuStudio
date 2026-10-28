import { describe, expect, it } from 'vitest'
import { validateUnifiedContent } from '../unified.schema'
import {
  QUICK_CREATE_TEMPLATES,
  buildQuickRecipe,
  createQuickContent,
  type QuickCreateTemplateId
} from '../quickCreate'
import { validateRecipe } from '../recipe.schema'
import { validateLootTable } from '../loot.schema'

describe('QuickCreate 模板元数据', () => {
  it('恰好暴露 8 个模板', () => {
    const ids = QUICK_CREATE_TEMPLATES.map((t) => t.id)
    expect(ids).toEqual(['block', 'item', 'food', 'entity', 'boss', 'tool', 'armor', 'recipe'])
  })
})

describe('createQuickContent', () => {
  it('方块：标准完整方块并通过保存校验', () => {
    const c = createQuickContent('block', { id: 'ruby_block', zhName: '红宝石块' })
    expect(c.type).toBe('block')
    expect(c.java.blockType).toBe('simple')
    expect(c.java.blockItem?.enabled).toBe(true)
    expect(c.displayName.zh_cn).toBe('红宝石块')
    expect(c.assets.lang['block.mymod.ruby_block']).toBe('红宝石块')
    expect(validateUnifiedContent(c)).toBeNull()
  })

  it('物品：可堆叠普通物品', () => {
    const c = createQuickContent('item', { id: 'ruby', namespace: 'gems' })
    expect(c.type).toBe('item')
    expect(c.java.itemType).toBe('simple')
    const p = c.java.properties
    expect('maxCount' in p ? p.maxCount : 0).toBe(64)
    expect(c.java.packageName).toBe('gems.item')
    expect(validateUnifiedContent(c)).toBeNull()
  })

  it('食物：food 子类型字段齐全', () => {
    const c = createQuickContent('food', { id: 'strawberry' })
    expect(c.java.itemType).toBe('food')
    expect(c.java.food).toMatchObject({ hunger: 6, saturation: 0.6, meat: false })
    expect(c.java.food?.effects).toEqual([])
    expect(validateUnifiedContent(c)).toBeNull()
  })

  it('实体：被动生物默认属性/生成', () => {
    const c = createQuickContent('entity', { id: 'panda_cat' })
    expect(c.type).toBe('entity')
    expect(c.java.entityType).toBe('passive')
    expect(c.java.spawnEgg?.enabled).toBe(true)
    expect(c.java.attributes?.maxHealth).toBe(20)
  })

  it('Boss：敌对 Monster/200 血高攻/大体型/近战 AI/单只黑暗生成', () => {
    const c = createQuickContent('boss', { id: 'shadow_lord', zhName: '暗影领主' })
    expect(c.type).toBe('entity')
    expect(c.java.entityType).toBe('hostile')
    expect(c.java.baseClass).toBe('Monster')
    expect(c.displayName.zh_cn).toBe('暗影领主')
    expect(c.java.attributes).toMatchObject({
      maxHealth: 200,
      attackDamage: 12,
      armor: 8,
      knockbackResistance: 0.8
    })
    const p = c.java.properties
    expect('height' in p ? p.height : 0).toBe(2.8)
    expect('fireImmune' in p ? p.fireImmune : false).toBe(true)
    expect('spawnGroup' in p ? p.spawnGroup : '').toBe('MONSTER')
    expect(c.java.ai?.goals.some((g) => g.type === 'melee_attack')).toBe(true)
    expect(c.java.ai?.targets.some((t) => t.type === 'attack_player')).toBe(true)
    expect(c.java.spawn).toMatchObject({
      weight: 2,
      minGroupSize: 1,
      maxGroupSize: 1,
      lightLevel: 'dark'
    })
    expect(c.java.spawnEgg?.enabled).toBe(true)
  })

  it('Boss：实体战利品表合法（钻石 + 概率下界之星），三阶段钩子已播种', () => {
    const c = createQuickContent('boss', { id: 'shadow_lord' })
    expect(c.data.lootTable).toBeTruthy()
    expect(c.data.lootTable?.type).toBe('entity')
    expect(validateLootTable(c.data.lootTable!)).toBeNull()
    const entries = c.data.lootTable!.pools[0].entries
    expect(entries.some((e) => e.item === 'minecraft:diamond')).toBe(true)
    expect(entries.find((e) => e.item === 'minecraft:nether_star')?.chance).toBe(0.25)
    expect(c.description).toContain('三阶段')
    expect(c.java.customLogic).toContain('phase')
    expect(validateUnifiedContent(c)).toBeNull()
  })

  it('工具：铁镐、不可堆叠、挖掘等级 2，cube 模型像素满足 ModelAsset 校验', () => {
    const c = createQuickContent('tool', { id: 'ruby_pickaxe' })
    expect(c.java.itemType).toBe('tool')
    expect(c.java.tool).toMatchObject({
      toolKind: 'pickaxe',
      material: 'iron',
      miningLevel: 2
    })
    const p = c.java.properties
    expect('maxCount' in p ? p.maxCount : 0).toBe(1)
    // 回归（P0）：cubeModel 导出 ModelAsset 走 validateModelSchema，pixels 长度必须为 textureSize²
    const cm = c.assets.model.cubeModel
    expect(cm).toBeTruthy()
    expect(cm!.pixels).toHaveLength(cm!.textureSize * cm!.textureSize)
    expect(cm!.elements.length).toBeGreaterThan(0)
    expect(validateUnifiedContent(c)).toBeNull()
  })

  it('护甲：铁胸甲、不可堆叠', () => {
    const c = createQuickContent('armor', { id: 'ruby_chestplate' })
    expect(c.java.itemType).toBe('armor')
    expect(c.java.armor).toMatchObject({
      slot: 'chestplate',
      material: 'iron',
      protection: 6
    })
    const p = c.java.properties
    expect('maxCount' in p ? p.maxCount : 0).toBe(1)
    expect(validateUnifiedContent(c)).toBeNull()
  })
})

describe('buildQuickRecipe', () => {
  it('方块：9 铁锭有序合成，配方合法', () => {
    const block = createQuickContent('block', { id: 'ruby_block' })
    const r = buildQuickRecipe(block)
    expect(r.kind).toBe('crafting_shaped')
    expect(r.pattern).toEqual(['III', 'III', 'III'])
    expect(r.key?.I.item).toBe('minecraft:iron_ingot')
    expect(r.result).toEqual({ item: 'ruby_block', count: 1 })
    expect(validateRecipe(r)).toBeNull()
  })

  it('物品：单原料无序合成，配方合法', () => {
    for (const t of ['item', 'food', 'tool', 'armor'] as Exclude<
      QuickCreateTemplateId,
      'block' | 'entity' | 'recipe'
    >[]) {
      const obj = createQuickContent(t, { id: `demo_${t}` })
      const r = buildQuickRecipe(obj)
      expect(r.kind).toBe('crafting_shapeless')
      expect(r.ingredients).toHaveLength(1)
      expect(validateRecipe(r)).toBeNull()
    }
  })

  it('实体/Boss：拒绝创建配方', () => {
    const ent = createQuickContent('entity', { id: 'ghost' })
    expect(() => buildQuickRecipe(ent)).toThrow(/实体/)
    const boss = createQuickContent('boss', { id: 'shadow_lord' })
    expect(() => buildQuickRecipe(boss)).toThrow(/实体/)
  })
})
