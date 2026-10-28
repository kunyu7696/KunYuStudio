/**
 * 统一内容对象适配层往返测试。
 * 验证 flat schema → UnifiedContent → flat schema 后数据无损。
 * 比较时对两端都调用各自的 normalize，消除默认值填充差异。
 */
import { describe, it, expect } from 'vitest'
import { createDefaultBlock, normalizeBlockSchema } from '../block.schema'
import { createDefaultItem, normalizeItemSchema } from '../item.schema'
import { createDefaultEntity, normalizeEntitySchema } from '../entity.schema'
import {
  blockToUnified,
  unifiedToBlock,
  itemToUnified,
  unifiedToItem,
  entityToUnified,
  unifiedToEntity
} from '../unified.adapter'

/** 深比较前先 JSON 序列化，消除 undefined 字段差异 */
function stable<T>(v: T): string {
  return JSON.stringify(v, null, 0)
}

describe('统一适配层往返：Block', () => {
  it('simple 方块往返无损', () => {
    const block = createDefaultBlock('ruby_ore')
    block.properties.hardness = 5
    block.properties.resistance = 6
    block.properties.requiresTool = true
    block.properties.toolType = 'pickaxe'
    block.properties.miningLevel = 2
    block.texture.color = '#9aa0a8'
    block.displayName = { en_us: 'Ruby Ore', zh_cn: '红宝石矿石' }

    const unified = blockToUnified(block, 'testmod')
    const back = normalizeBlockSchema(unifiedToBlock(unified))
    const expected = normalizeBlockSchema(block)

    expect(stable(back)).toBe(stable(expected))
  })

  it('directional 方块（含 blockStates）往返无损', () => {
    const block = createDefaultBlock('furnace', 'directional')
    block.displayName = { en_us: 'Furnace', zh_cn: '熔炉' }

    const unified = blockToUnified(block, 'testmod')
    const back = normalizeBlockSchema(unifiedToBlock(unified))
    const expected = normalizeBlockSchema(block)

    expect(back.blockStates).toEqual(expected.blockStates)
    expect(stable(back)).toBe(stable(expected))
  })

  it('interactive 方块（含 interaction）往返无损', () => {
    const block = createDefaultBlock('machine', 'interactive')
    if (block.interaction) {
      block.interaction.action = 'gui'
    }
    block.displayName = { en_us: 'Machine', zh_cn: '机器' }

    const unified = blockToUnified(block, 'testmod')
    const back = normalizeBlockSchema(unifiedToBlock(unified))
    const expected = normalizeBlockSchema(block)

    expect(back.interaction).toEqual(expected.interaction)
    expect(stable(back)).toBe(stable(expected))
  })

  it('entity 方块（含 blockEntity）往返无损', () => {
    const block = createDefaultBlock('chest', 'entity')
    if (block.blockEntity) {
      block.blockEntity.fields = [
        { name: 'energy', type: 'int', defaultValue: 0, sync: true }
      ]
    }
    block.displayName = { en_us: 'Chest', zh_cn: '箱子' }

    const unified = blockToUnified(block, 'testmod')
    const back = normalizeBlockSchema(unifiedToBlock(unified))
    const expected = normalizeBlockSchema(block)

    expect(back.blockEntity).toEqual(expected.blockEntity)
    expect(stable(back)).toBe(stable(expected))
  })

  it('含像素画与六面贴图的方块往返无损', () => {
    const block = createDefaultBlock('custom_block')
    block.model.type = 'cube'
    block.texture.pixels = Array(256).fill('#ff0000')
    block.texture.faces = {
      north: 'block/front',
      south: 'block/back',
      up: 'block/top',
      down: 'block/bottom',
      east: 'block/side',
      west: 'block/side'
    }

    const unified = blockToUnified(block, 'testmod')
    const back = normalizeBlockSchema(unifiedToBlock(unified))
    const expected = normalizeBlockSchema(block)

    expect(back.texture.pixels).toHaveLength(256)
    expect(back.texture.faces).toEqual(expected.texture.faces)
    expect(stable(back)).toBe(stable(expected))
  })

  it('绑定 Cube 模型的方块往返无损', () => {
    const block = createDefaultBlock('model_block')
    block.cubeModelId = 'my_cube_model'
    block.blockItem = { enabled: false, creativeTab: '' }

    const unified = blockToUnified(block, 'testmod')
    const back = normalizeBlockSchema(unifiedToBlock(unified))

    expect(back.cubeModelId).toBe('my_cube_model')
    expect(back.blockItem.enabled).toBe(false)
  })
})

describe('统一适配层往返：Item', () => {
  it('simple 物品往返无损', () => {
    const item = createDefaultItem('ruby')
    item.properties.maxCount = 16
    item.properties.rarity = 'rare'
    item.texture.color = '#c41e3a'
    item.displayName = { en_us: 'Ruby', zh_cn: '红宝石' }

    const unified = itemToUnified(item, 'testmod')
    const back = normalizeItemSchema(unifiedToItem(unified))
    const expected = normalizeItemSchema(item)

    expect(stable(back)).toBe(stable(expected))
  })

  it('tool 物品（含 tool 配置）往返无损', () => {
    const item = createDefaultItem('ruby_pickaxe', 'tool')
    if (item.tool) {
      item.tool.material = 'diamond'
      item.tool.attackDamage = 2
    }
    item.displayName = { en_us: 'Ruby Pickaxe', zh_cn: '红宝石镐' }

    const unified = itemToUnified(item, 'testmod')
    const back = normalizeItemSchema(unifiedToItem(unified))
    const expected = normalizeItemSchema(item)

    expect(back.tool).toEqual(expected.tool)
    expect(stable(back)).toBe(stable(expected))
  })

  it('armor 物品往返无损', () => {
    const item = createDefaultItem('ruby_helmet', 'armor')
    item.displayName = { en_us: 'Ruby Helmet', zh_cn: '红宝石头盔' }

    const unified = itemToUnified(item, 'testmod')
    const back = normalizeItemSchema(unifiedToItem(unified))
    const expected = normalizeItemSchema(item)

    expect(back.armor).toEqual(expected.armor)
  })

  it('food 物品（含 food 配置与效果）往返无损', () => {
    const item = createDefaultItem('ruby_apple', 'food')
    if (item.food) {
      item.food.hunger = 8
      item.food.effects = [{ effect: 'minecraft:speed', duration: 200, amplifier: 1, chance: 1 }]
    }
    item.displayName = { en_us: 'Ruby Apple', zh_cn: '红宝石苹果' }

    const unified = itemToUnified(item, 'testmod')
    const back = normalizeItemSchema(unifiedToItem(unified))
    const expected = normalizeItemSchema(item)

    expect(back.food).toEqual(expected.food)
    expect(stable(back)).toBe(stable(expected))
  })

  it('block_item 物品往返无损', () => {
    const item = createDefaultItem('ruby_ore_item', 'block_item')
    item.blockRef = 'ruby_ore'

    const unified = itemToUnified(item, 'testmod')
    const back = normalizeItemSchema(unifiedToItem(unified))

    expect(back.blockRef).toBe('ruby_ore')
  })

  it('含像素画的物品往返无损', () => {
    const item = createDefaultItem('pixel_item')
    item.texture.pixels = Array(256).fill('#00ff00')

    const unified = itemToUnified(item, 'testmod')
    const back = normalizeItemSchema(unifiedToItem(unified))

    expect(back.texture.pixels).toHaveLength(256)
  })
})

describe('统一适配层往返：Entity', () => {
  it('passive 实体往返无损', () => {
    const entity = createDefaultEntity('ruby_pig')
    entity.displayName = { en_us: 'Ruby Pig', zh_cn: '红宝石猪' }

    const unified = entityToUnified(entity, 'testmod')
    const back = normalizeEntitySchema(unifiedToEntity(unified))
    const expected = normalizeEntitySchema(entity)

    expect(stable(back)).toBe(stable(expected))
  })

  it('hostile 实体（含 AI 与属性）往返无损', () => {
    const entity = createDefaultEntity('ruby_zombie', 'hostile')
    entity.attributes.attackDamage = 6
    entity.displayName = { en_us: 'Ruby Zombie', zh_cn: '红宝石僵尸' }

    const unified = entityToUnified(entity, 'testmod')
    const back = normalizeEntitySchema(unifiedToEntity(unified))
    const expected = normalizeEntitySchema(entity)

    expect(back.ai).toEqual(expected.ai)
    expect(back.attributes.attackDamage).toBe(6)
    expect(stable(back)).toBe(stable(expected))
  })

  it('neutral 实体往返无损', () => {
    const entity = createDefaultEntity('ruby_golem', 'neutral')
    entity.displayName = { en_us: 'Ruby Golem', zh_cn: '红宝石傀儡' }

    const unified = entityToUnified(entity, 'testmod')
    const back = normalizeEntitySchema(unifiedToEntity(unified))
    const expected = normalizeEntitySchema(entity)

    expect(stable(back)).toBe(stable(expected))
  })

  it('blockbench 渲染器实体往返无损', () => {
    const entity = createDefaultEntity('bb_entity')
    entity.renderer = {
      modelType: 'blockbench_geo',
      modelPath: 'geo/bb_entity.geo.json',
      animationPath: 'anim/bb_entity.animation.json'
    }

    const unified = entityToUnified(entity, 'testmod')
    const back = normalizeEntitySchema(unifiedToEntity(unified))

    expect(back.renderer.modelType).toBe('blockbench_geo')
    expect(back.renderer.modelPath).toBe('geo/bb_entity.geo.json')
    expect(back.renderer.animationPath).toBe('anim/bb_entity.animation.json')
  })

  it('projectile 实体（无刷怪蛋）往返无损', () => {
    const entity = createDefaultEntity('ruby_arrow', 'projectile')

    const unified = entityToUnified(entity, 'testmod')
    const back = normalizeEntitySchema(unifiedToEntity(unified))

    expect(back.spawnEgg.enabled).toBe(false)
    expect(back.baseClass).toBe('Entity')
  })
})

describe('统一适配层：三端字段分布验证', () => {
  it('方块的 properties 在 java 端，texture/model 在 assets 端', () => {
    const block = createDefaultBlock('test_block')
    const u = blockToUnified(block, 'ns')

    expect(u.java.properties).toBe(block.properties)
    expect(u.assets.textures.block?.[0].path).toBe(block.texture.path)
    expect(u.assets.model.type).toBe(block.model.type)
    expect(u.data).toEqual({})
  })

  it('物品的 properties 在 java 端，tool/armor/food 在 java 端', () => {
    const item = createDefaultItem('test_sword', 'tool')
    const u = itemToUnified(item, 'ns')

    expect(u.java.properties).toBe(item.properties)
    expect(u.java.tool).toEqual(item.tool)
    expect(u.assets.textures.item?.path).toBe(item.texture.path)
  })

  it('实体的 attributes/ai/spawn 在 java 端，renderer 在 assets 端', () => {
    const entity = createDefaultEntity('test_entity')
    const u = entityToUnified(entity, 'ns')

    expect(u.java.attributes).toBe(entity.attributes)
    expect(u.java.ai).toBe(entity.ai)
    expect(u.java.spawn).toBe(entity.spawn)
    expect(u.assets.model.entityModelType).toBe(entity.renderer.modelType)
  })
})
