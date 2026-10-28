import { describe, expect, it } from 'vitest'
import {
  AI_GOAL_CATALOG,
  AI_TARGET_CATALOG,
  applyEntityType,
  createAiGoal,
  createDefaultEntity,
  entityDisplayName,
  isKnownGoal,
  normalizeEntitySchema,
  validateEntitySchema,
  type EntitySchema
} from '../entity.schema'

describe('createDefaultEntity（各类型默认值）', () => {
  it('passive：PathAware 基类、无攻击、6 个默认 goal、无 target、刷怪蛋开启', () => {
    const e = createDefaultEntity('cloud_sheep')
    expect(e.kind).toBe('entity')
    expect(e.entityType).toBe('passive')
    expect(e.baseClass).toBe('PathAwareEntity')
    expect(e.id).toBe('cloud_sheep')
    expect(e.properties.spawnGroup).toBe('CREATURE')
    expect(e.attributes.attackDamage).toBe(0)
    expect(e.ai.goals.map((g) => g.type)).toEqual([
      'swim',
      'panic',
      'mate',
      'follow_parent',
      'wander',
      'look_at'
    ])
    expect(e.ai.goals.map((g) => g.priority)).toEqual([1, 2, 3, 4, 5, 6])
    expect(e.ai.targets).toEqual([])
    expect(e.spawn.naturalSpawn).toBe(true)
    expect(e.spawn.lightLevel).toBe('day')
    expect(e.spawn.biomes).toEqual(['#minecraft:is_overworld'])
    expect(e.spawnEgg.enabled).toBe(true)
    // 默认参数按目录播种
    const wander = e.ai.goals.find((g) => g.type === 'wander')!
    expect(wander.params.speed).toBe(0.8)
  })

  it('hostile：Monster 基类、近战 goal + 攻击玩家 target、黑暗生成', () => {
    const e = createDefaultEntity('shadow_zombie', 'hostile')
    expect(e.baseClass).toBe('Monster')
    expect(e.properties.spawnGroup).toBe('MONSTER')
    expect(e.attributes.attackDamage).toBe(3)
    expect(e.ai.goals[0].type).toBe('melee_attack')
    expect(e.ai.goals[0].params).toMatchObject({ speed: 1.0, pauseWhenIdle: false })
    expect(e.ai.targets.map((t) => t.type)).toEqual(['attack_player', 'hurt_by_target'])
    expect(e.spawn.lightLevel).toBe('dark')
  })

  it('neutral：仅反击 target；projectile/plain 基类 Entity 且无 AI、不自然生成、无刷怪蛋', () => {
    const n = createDefaultEntity('wasp', 'neutral')
    expect(n.baseClass).toBe('PathAwareEntity')
    expect(n.ai.targets.map((t) => t.type)).toEqual(['revenge'])
    expect(n.attributes.attackDamage).toBe(2)

    for (const t of ['projectile', 'plain'] as const) {
      const e = createDefaultEntity(`bolt_${t}`, t)
      expect(e.baseClass).toBe('Entity')
      expect(e.ai.goals).toEqual([])
      expect(e.ai.targets).toEqual([])
      expect(e.spawn.naturalSpawn).toBe(false)
      expect(e.spawnEgg.enabled).toBe(false)
    }
  })
})

describe('AI 目录与工厂', () => {
  it('所有目录条目参数规格完整、工厂按默认值播种', () => {
    for (const entry of AI_GOAL_CATALOG) {
      const g = createAiGoal(entry.value, 2)
      expect(g.type).toBe(entry.value)
      expect(g.priority).toBe(2)
      for (const spec of entry.params) {
        expect(g.params[spec.key]).toBe(spec.default)
      }
    }
    expect(AI_TARGET_CATALOG).toHaveLength(4)
    expect(isKnownGoal('wander')).toBe(true)
    expect(isKnownGoal('fly_to_moon')).toBe(false)
  })
})

describe('applyEntityType（类型切换）', () => {
  it('保留碰撞箱/描述/贴图，重播种属性与 AI；切换时清理或恢复群系', () => {
    const e = createDefaultEntity('sheep', 'passive')
    e.properties.width = 1.2
    e.description = 'fluffy'
    e.texture.path = 'textures/entity/sheep.png'
    applyEntityType(e, 'hostile')
    expect(e.entityType).toBe('hostile')
    expect(e.baseClass).toBe('Monster')
    expect(e.attributes.attackDamage).toBe(3)
    expect(e.ai.targets.length).toBeGreaterThan(0)
    expect(e.properties.width).toBe(1.2)
    expect(e.description).toBe('fluffy')
    expect(e.texture.path).toBe('textures/entity/sheep.png')

    applyEntityType(e, 'projectile')
    expect(e.spawn.naturalSpawn).toBe(false)
    expect(e.spawn.biomes).toEqual([])

    applyEntityType(e, 'passive')
    expect(e.spawn.biomes).toEqual(['#minecraft:is_overworld'])
  })
})

describe('normalizeEntitySchema（归一化）', () => {
  it('范围收敛、枚举回退、颜色合法化', () => {
    const e = createDefaultEntity('golem')
    const n = normalizeEntitySchema({
      ...e,
      id: ' golem ',
      displayName: { en_us: ' Golem ', zh_cn: '魔像 ' },
      properties: {
        ...e.properties,
        width: 999,
        height: -3,
        eyeHeight: 'x' as never,
        trackingRange: 0,
        updateInterval: 99,
        spawnGroup: 'BIRDS' as never,
        primaryColor: 'red'
      },
      attributes: {
        ...e.attributes,
        maxHealth: 'abc' as never,
        movementSpeed: 20,
        knockbackResistance: 5
      }
    })
    expect(n.id).toBe('golem')
    expect(n.displayName).toEqual({ en_us: 'Golem', zh_cn: '魔像' })
    expect(n.properties.width).toBe(16)
    expect(n.properties.height).toBe(0.1)
    expect(n.properties.eyeHeight).toBeGreaterThan(0)
    expect(n.properties.trackingRange).toBe(1)
    expect(n.properties.updateInterval).toBe(20)
    expect(n.properties.spawnGroup).toBe('CREATURE')
    expect(n.properties.primaryColor).toBe('#a8c98f')
    expect(n.attributes.maxHealth).toBe(20)
    expect(n.attributes.movementSpeed).toBe(10)
    expect(n.attributes.knockbackResistance).toBe(1)
  })

  it('AI：未知类型剔除、优先级收敛、参数按规格归一化', () => {
    const e = createDefaultEntity('wolf')
    e.ai.goals = [
      { type: 'melee_attack', priority: 200, params: { speed: 99, pauseWhenIdle: 'yes' } },
      { type: 'dance_party', priority: 1, params: {} }
    ] as EntitySchema['ai']['goals']
    e.ai.targets = [
      { type: 'revenge', priority: -5, params: {} },
      { type: 'attack_player', priority: 2, params: {} },
      { type: 'unknown_target', priority: 3, params: {} }
    ] as EntitySchema['ai']['targets']
    const n = normalizeEntitySchema(e)
    expect(n.ai.goals).toHaveLength(1)
    expect(n.ai.goals[0].type).toBe('melee_attack')
    expect(n.ai.goals[0].priority).toBe(99)
    expect(n.ai.goals[0].params.speed).toBe(5)
    expect(n.ai.goals[0].params.pauseWhenIdle).toBe(false)
    expect(n.ai.targets.map((t) => t.type)).toEqual(['revenge', 'attack_player'])
    expect(n.ai.targets[0].priority).toBe(0)
  })

  it('数字字符串参数可解析；群系列表去重去空，关闭自然生成时清空', () => {
    const e = createDefaultEntity('cat')
    e.ai.goals = [{ type: 'wander', priority: 1, params: { speed: '0.7' } }]
    e.spawn.naturalSpawn = true
    e.spawn.biomes = ['minecraft:plains', 'minecraft:plains', '  ', '#minecraft:is_forest']
    let n = normalizeEntitySchema(e)
    expect(n.ai.goals[0].params.speed).toBe(0.7)
    expect(n.spawn.biomes).toEqual(['minecraft:plains', '#minecraft:is_forest'])

    e.spawn.naturalSpawn = false
    n = normalizeEntitySchema(e)
    expect(n.spawn.biomes).toEqual([])
  })

  it('minGroupSize 大于 max 时自动交换；renderer 路径清理', () => {
    const e = createDefaultEntity('bull')
    e.spawn.minGroupSize = 6
    e.spawn.maxGroupSize = 2
    e.renderer = { modelType: 'blockbench_geo', modelPath: ' geo/bull.geo.json ', animationPath: '' }
    const n = normalizeEntitySchema(e)
    expect(n.spawn.minGroupSize).toBe(2)
    expect(n.spawn.maxGroupSize).toBe(6)
    expect(n.renderer.modelPath).toBe('geo/bull.geo.json')
    expect(n.renderer.animationPath).toBeNull()
  })
})

describe('validateEntitySchema（保存校验）', () => {
  it('合法默认实体通过', () => {
    expect(validateEntitySchema(createDefaultEntity('sheep'))).toBeNull()
  })

  it('ID/名称非法报错', () => {
    const e = createDefaultEntity('Bad Id')
    expect(validateEntitySchema(e)).toContain('注册名')
    e.id = 'ok_id'
    e.displayName = { en_us: '', zh_cn: ' ' }
    expect(validateEntitySchema(e)).toContain('显示名称')
  })

  it('自然生成必须有群系；blockbench 渲染必须有模型路径', () => {
    const e = createDefaultEntity('wolf')
    e.spawn.biomes = []
    expect(validateEntitySchema(e)).toContain('生物群系')

    e.spawn.biomes = ['minecraft:plains']
    expect(validateEntitySchema(e)).toBeNull()

    e.renderer.modelType = 'blockbench_geo'
    e.renderer.modelPath = null
    expect(validateEntitySchema(e)).toContain('模型文件路径')
  })

  it('entityDisplayName 双语回落链', () => {
    const e = createDefaultEntity('sheep')
    e.displayName = { en_us: 'Cloud Sheep', zh_cn: '云朵绵羊' }
    expect(entityDisplayName(e)).toBe('云朵绵羊')
    expect(entityDisplayName(e, 'en_us')).toBe('Cloud Sheep')
    e.displayName.zh_cn = ''
    expect(entityDisplayName(e)).toBe('Cloud Sheep')
    e.displayName.en_us = ''
    expect(entityDisplayName(e)).toBe('sheep')
  })
})
