import { describe, expect, it } from 'vitest'
import {
  applyBlockType,
  BLOCK_PRESETS,
  blockDisplayName,
  createDefaultBlock,
  migrateLegacyBlock,
  normalizeBlockSchema,
  validateBlockSchema,
  type BlockSchema
} from '../block.schema'

describe('createDefaultBlock（方块 Schema 默认值）', () => {
  it('simple 默认方块：完整字段、cube_all、生成 BlockItem', () => {
    const b = createDefaultBlock('ruby_ore')
    expect(b.kind).toBe('block')
    expect(b.blockType).toBe('simple')
    expect(b.id).toBe('ruby_ore')
    expect(b.displayName).toEqual({ en_us: 'ruby_ore', zh_cn: 'ruby_ore' })
    expect(b.properties.hardness).toBe(2)
    expect(b.properties.lightLevel).toBe(0)
    expect(b.properties.opaque).toBe(true)
    expect(b.properties.hasCollision).toBe(true)
    expect(b.properties.dropsSelf).toBe(true)
    expect(b.blockStates).toBeUndefined()
    expect(b.blockEntity).toBeUndefined()
    expect(b.interaction).toBeUndefined()
    expect(b.model.type).toBe('cube_all')
    expect(b.cubeModelId).toBeNull()
    expect(b.blockItem.enabled).toBe(true)
    expect(b.texture.generated).toBe(true)
  })

  it('directional 播种 facing 四向状态，toggle 播种 powered 布尔状态', () => {
    const d = createDefaultBlock('furnace_like', 'directional')
    expect(d.blockStates).toEqual([
      {
        name: 'facing',
        type: 'enum',
        values: ['north', 'east', 'south', 'west'],
        defaultValue: 'north'
      }
    ])
    const t = createDefaultBlock('lamp', 'toggle')
    expect(t.blockStates?.[0]).toMatchObject({ name: 'powered', type: 'boolean', defaultValue: 'false' })
    expect(t.blockStates?.[0].values).toEqual(['true', 'false'])
  })

  it('interactive 播种 gui 交互；entity 播种方块实体配置', () => {
    const i = createDefaultBlock('machine', 'interactive')
    expect(i.interaction?.action).toBe('gui')
    expect(i.blockStates).toBeUndefined()

    const e = createDefaultBlock('storage', 'entity')
    expect(e.blockEntity).toMatchObject({ tickable: true, persistent: true, syncToClient: true })
    expect(e.blockEntity?.fields).toEqual([])
    expect(e.interaction).toBeUndefined()
  })
})

describe('applyBlockType（类型切换）', () => {
  it('切换时清空旧分支并播种新分支，通用字段保留', () => {
    const b = createDefaultBlock('ruby_ore', 'directional')
    b.properties.lightLevel = 10
    b.texture.color = '#ff0000'
    applyBlockType(b, 'entity')
    expect(b.blockType).toBe('entity')
    expect(b.blockStates).toBeUndefined()
    expect(b.blockEntity).toBeDefined()
    expect(b.properties.lightLevel).toBe(10)
    expect(b.texture.color).toBe('#ff0000')

    applyBlockType(b, 'simple')
    expect(b.blockEntity).toBeUndefined()
    expect(b.interaction).toBeUndefined()
  })

  it('切到相同类型不做改动', () => {
    const b = createDefaultBlock('x', 'toggle')
    const before = JSON.stringify(b.blockStates)
    applyBlockType(b, 'toggle')
    expect(JSON.stringify(b.blockStates)).toBe(before)
  })
})

describe('normalizeBlockSchema（归一化）', () => {
  it('数值范围收敛与枚举回退', () => {
    const b = createDefaultBlock('crate')
    const n = normalizeBlockSchema({
      ...b,
      id: '  crate  ',
      displayName: { en_us: '  Crate ', zh_cn: ' 箱子 ' },
      properties: {
        ...b.properties,
        hardness: 999,
        resistance: -5,
        lightLevel: 32,
        miningLevel: 9 as never,
        toolType: 'banana' as never,
        renderType: 'weird' as never,
        soundGroup: undefined as never
      }
    })
    expect(n.id).toBe('crate')
    expect(n.displayName.en_us).toBe('Crate')
    expect(n.properties.hardness).toBe(50)
    expect(n.properties.resistance).toBe(0)
    expect(n.properties.lightLevel).toBe(15)
    expect(n.properties.miningLevel).toBe(4)
    expect(n.properties.toolType).toBe('hand')
    expect(n.properties.renderType).toBe('solid')
    expect(n.properties.soundGroup).toBe('stone')
  })

  it('布尔状态取值被强制为 true/false 且默认值合法', () => {
    const b = createDefaultBlock('lamp', 'toggle')
    b.blockStates = [
      { name: 'lit', type: 'boolean', values: ['on', 'off'], defaultValue: 'on' }
    ]
    const n = normalizeBlockSchema(b)
    expect(n.blockStates).toEqual([
      { name: 'lit', type: 'boolean', values: ['true', 'false'], defaultValue: 'false' }
    ])
  })

  it('枚举状态去重、非法默认值回落到首个取值；同名状态去重', () => {
    const b = createDefaultBlock('multi')
    b.blockStates = [
      { name: 'facing', type: 'enum', values: ['north', 'north', '', 'south'], defaultValue: 'west' },
      { name: 'facing', type: 'enum', values: ['up'], defaultValue: 'up' }
    ]
    const n = normalizeBlockSchema(b)
    expect(n.blockStates).toHaveLength(1)
    expect(n.blockStates?.[0].values).toEqual(['north', 'south'])
    expect(n.blockStates?.[0].defaultValue).toBe('north')
  })

  it('非法状态名/空状态列表被剔除；interaction=none 被移除', () => {
    const b = createDefaultBlock('multi')
    b.blockStates = [{ name: 'Bad Name', type: 'enum', values: ['a'], defaultValue: 'a' }]
    b.interaction = { action: 'none', eventName: '', soundEvent: '' }
    const n = normalizeBlockSchema(b)
    expect(n.blockStates).toBeUndefined()
    expect(n.interaction).toBeUndefined()
  })

  it('方块实体字段按类型归一化默认值并去重', () => {
    const b = createDefaultBlock('storage', 'entity')
    b.blockEntity!.fields = [
      { name: 'Counter', type: 'int', defaultValue: '3.7', sync: true },
      { name: 'ratio', type: 'float', defaultValue: 2, sync: false },
      { name: 'counter', type: 'string', defaultValue: 42, sync: false },
      { name: 'enabled', type: 'boolean', defaultValue: 'x', sync: false }
    ]
    const n = normalizeBlockSchema(b)
    const fields = n.blockEntity!.fields
    expect(fields.map((f) => f.name)).toEqual(['counter', 'ratio', 'enabled'])
    expect(fields[0].type).toBe('int')
    expect(fields[0].defaultValue).toBe(4)
    expect(fields[1].defaultValue).toBe(2)
    expect(fields[2].defaultValue).toBe(false)
  })

  it('custom 模型必须携带对象 JSON，否则 customJson 清空；非法颜色回退', () => {
    const b = createDefaultBlock('weird')
    b.model = { type: 'custom', customJson: 'not-object' as unknown as Record<string, unknown> }
    b.texture.color = 'red'
    const n = normalizeBlockSchema(b)
    expect(n.model.customJson).toBeNull()
    expect(n.texture.color).toBe('#7f848e')
  })

  it('像素画 256 项透传，非法长度丢弃；六面贴图仅保留非空面', () => {
    const b = createDefaultBlock('crate')
    b.texture.pixels = Array.from({ length: 256 }, () => '#ffffff')
    b.texture.faces = { up: 'textures/block/top.png', down: ' ', north: '' }
    const n = normalizeBlockSchema(b)
    expect(n.texture.pixels).toHaveLength(256)
    expect(n.texture.faces).toEqual({ up: 'textures/block/top.png' })

    const b2 = createDefaultBlock('crate2')
    b2.texture.pixels = ['#fff']
    const n2 = normalizeBlockSchema(b2)
    expect(n2.texture.pixels).toBeUndefined()
  })
})

describe('validateBlockSchema（保存校验）', () => {
  it('合法默认方块通过', () => {
    expect(validateBlockSchema(createDefaultBlock('ruby_ore'))).toBeNull()
  })

  it('ID 非法 / 名称全空报错', () => {
    const b = createDefaultBlock('BadId')
    expect(validateBlockSchema(b)).toContain('注册名')
    const b2 = createDefaultBlock('ok_id')
    b2.displayName = { en_us: '  ', zh_cn: '' }
    expect(validateBlockSchema(b2)).toContain('显示名称')
  })

  it('状态名非法/重复、默认值越界报错', () => {
    const b = createDefaultBlock('x')
    b.blockStates = [{ name: 'bad name', type: 'enum', values: ['a'], defaultValue: 'a' }]
    expect(validateBlockSchema(b)).toContain('状态名')

    b.blockStates = [
      { name: 'facing', type: 'enum', values: ['north'], defaultValue: 'north' },
      { name: 'facing', type: 'boolean', values: ['true', 'false'], defaultValue: 'false' }
    ]
    expect(validateBlockSchema(b)).toContain('重复')

    b.blockStates = [{ name: 'facing', type: 'enum', values: ['north', 'north'], defaultValue: 'north' }]
    expect(validateBlockSchema(b)).toContain('不能重复')

    b.blockStates = [{ name: 'powered', type: 'boolean', values: ['true', 'false'], defaultValue: 'true' }]
    expect(validateBlockSchema(b)).toBeNull()
  })

  it('custom 无 JSON、事件/音效缺参数报错', () => {
    const b = createDefaultBlock('x')
    b.model = { type: 'custom' }
    expect(validateBlockSchema(b)).toContain('模型 JSON')

    b.model = { type: 'cube_all' }
    b.interaction = { action: 'event', eventName: '  ', soundEvent: '' }
    expect(validateBlockSchema(b)).toContain('事件名')

    b.interaction = { action: 'sound', eventName: '', soundEvent: '' }
    expect(validateBlockSchema(b)).toContain('音效事件')
  })

  it('方块实体字段重名报错', () => {
    const b = createDefaultBlock('x', 'entity')
    b.blockEntity!.fields = [
      { name: 'count', type: 'int', defaultValue: 0, sync: false },
      { name: 'count', type: 'string', defaultValue: '', sync: false }
    ]
    expect(validateBlockSchema(b)).toContain('字段名重复')
  })
})

describe('migrateLegacyBlock（旧扁平磁盘迁移）', () => {
  function legacy(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      kind: 'block',
      id: 'ruby_ore',
      displayName: 'Ruby Ore',
      description: 'legacy desc',
      preset: 'ore',
      textureColor: '#ff0000',
      customTexture: null,
      modelId: null,
      hardness: 3,
      resistance: 3,
      miningTool: 'pickaxe',
      miningLevel: 1,
      luminance: 0,
      requiresTool: true,
      dropsSelf: true,
      pistonPushable: true,
      collisionType: 'full',
      rightClickAction: 'none',
      soundGroup: 'stone',
      createdAt: 100,
      updatedAt: 200,
      ...over
    }
  }

  it('常规矿石：双语双填、属性映射、类型为 simple', () => {
    const m = migrateLegacyBlock(legacy())
    expect(m.blockType).toBe('simple')
    expect(m.displayName).toEqual({ en_us: 'Ruby Ore', zh_cn: 'Ruby Ore' })
    expect(m.description).toBe('legacy desc')
    expect(m.properties.hardness).toBe(3)
    expect(m.properties.toolType).toBe('pickaxe')
    expect(m.properties.miningLevel).toBe(1)
    expect(m.properties.requiresTool).toBe(true)
    expect(m.properties.lightLevel).toBe(0)
    expect(m.texture.color).toBe('#ff0000')
    expect(m.texture.path).toBe('')
    expect(m.texture.generated).toBe(true)
    expect(m.model.type).toBe('cube_all')
    expect(m.blockItem.enabled).toBe(true)
    expect(m.createdAt).toBe(100)
  })

  it('glass 预设 → translucent + 不透明关闭；颜色回退到预设色', () => {
    const m = migrateLegacyBlock(
      legacy({ preset: 'glass', textureColor: null, soundGroup: 'glass' })
    )
    expect(m.properties.renderType).toBe('translucent')
    expect(m.properties.opaque).toBe(false)
    expect(m.properties.soundGroup).toBe('glass')
    expect(m.texture.color).toBe(BLOCK_PRESETS.glass.color)
  })

  it('collisionType=none → hasCollision=false；slab/stairs → model.type 语义保留', () => {
    const none = migrateLegacyBlock(legacy({ id: 'a', collisionType: 'none' }))
    expect(none.properties.hasCollision).toBe(false)
    expect(none.model.type).toBe('cube_all')

    const slab = migrateLegacyBlock(legacy({ id: 'b', collisionType: 'slab' }))
    expect(slab.properties.hasCollision).toBe(true)
    expect(slab.model.type).toBe('slab')

    const stairs = migrateLegacyBlock(legacy({ id: 'c', collisionType: 'stairs' }))
    expect(stairs.model.type).toBe('stairs')
  })

  it('rightClickAction 非 none → interactive + interaction；gui/event/sound 逐一映射', () => {
    for (const action of ['gui', 'event', 'sound'] as const) {
      const m = migrateLegacyBlock(legacy({ id: `b_${action}`, rightClickAction: action }))
      expect(m.blockType).toBe('interactive')
      expect(m.interaction?.action).toBe(action)
    }
  })

  it('customTexture/modelId 映射到 texture.path/cubeModelId；绑定时 slab 语义让位给模型', () => {
    const m = migrateLegacyBlock(
      legacy({
        customTexture: 'textures/block/foo.png',
        modelId: 'cube_42',
        collisionType: 'slab'
      })
    )
    expect(m.texture.path).toBe('textures/block/foo.png')
    expect(m.texture.generated).toBe(false)
    expect(m.cubeModelId).toBe('cube_42')
    expect(m.model.type).toBe('cube_all')
  })

  it('迁移产物再校验通过，且 blockDisplayName 走回落链', () => {
    const m = migrateLegacyBlock(legacy())
    expect(validateBlockSchema(m)).toBeNull()
    const b: BlockSchema = { ...m, displayName: { en_us: 'Ruby', zh_cn: '红宝石矿' } }
    expect(blockDisplayName(b)).toBe('红宝石矿')
    expect(blockDisplayName(b, 'en_us')).toBe('Ruby')
    const onlyEn: BlockSchema = { ...m, displayName: { en_us: 'Ruby', zh_cn: '' } }
    expect(blockDisplayName(onlyEn)).toBe('Ruby')
  })
})
