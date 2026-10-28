import { describe, expect, it } from 'vitest'
import {
  applyTemplate,
  createTemplateModel,
  inferTemplate,
  normalizeModelSchema,
  validateModelSchema,
  type TemplatedModelAsset
} from '../model.schema'
import { isLegalRotationAngle } from '../../utils/modelMath'

describe('createTemplateModel（六种模板 + 空白）', () => {
  it('cube_all：单立方体六面 all，像素画布与贴图路径就绪', () => {
    const m = createTemplateModel('ruby_block', 'cube_all')
    expect(m.template).toBe('cube_all')
    expect(m.pixels).toHaveLength(256)
    expect(m.textures).toEqual({ all: 'textures/model/ruby_block.png' })
    expect(m.elements).toHaveLength(1)
    const el = m.elements[0]
    expect(el.from).toEqual([0, 0, 0])
    expect(el.to).toEqual([16, 16, 16])
    for (const face of ['north', 'south', 'east', 'west', 'up', 'down'] as const) {
      expect(el.faces[face]?.texture).toBe('all')
      expect(el.faces[face]?.uv).toEqual([0, 0, 16, 16])
    }
    expect(validateModelSchema(m)).toBeNull()
  })

  it('cube：六面变量；所有变量共享同一张 PNG 路径', () => {
    const m = createTemplateModel('machine', 'cube')
    expect(Object.keys(m.textures).sort()).toEqual(['down', 'east', 'north', 'south', 'up', 'west'])
    expect(new Set(Object.values(m.textures)).size).toBe(1)
    const el = m.elements[0]
    expect(el.faces.up?.texture).toBe('up')
    expect(el.faces.north?.texture).toBe('north')
    expect(validateModelSchema(m)).toBeNull()
  })

  it('cube_column：端面 end / 侧面 side', () => {
    const m = createTemplateModel('oak_log', 'cube_column')
    expect(Object.keys(m.textures).sort()).toEqual(['end', 'side'])
    const el = m.elements[0]
    expect(el.faces.up?.texture).toBe('end')
    expect(el.faces.down?.texture).toBe('end')
    expect(el.faces.north?.texture).toBe('side')
    expect(el.faces.east?.texture).toBe('side')
    expect(validateModelSchema(m)).toBeNull()
  })

  it('cross：两张 ±45° 薄板，仅四个侧面，旋转角合法', () => {
    const m = createTemplateModel('blue_flower', 'cross')
    expect(m.elements).toHaveLength(2)
    for (const el of m.elements) {
      expect([45, -45]).toContain(el.rotation?.angle)
      expect(isLegalRotationAngle(el.rotation!.angle)).toBe(true)
      expect(el.rotation?.axis).toBe('y')
      expect(el.faces.up).toBeUndefined()
      expect(el.faces.down).toBeUndefined()
      expect(el.faces.north?.texture).toBe('all')
    }
    expect(validateModelSchema(m)).toBeNull()
  })

  it('slab：单块半砖；stairs：两块无旋转立方体', () => {
    const slab = createTemplateModel('stone_slab', 'slab')
    expect(slab.elements[0].to[1]).toBe(8)
    expect(validateModelSchema(slab)).toBeNull()

    const stairs = createTemplateModel('stone_stairs', 'stairs')
    expect(stairs.elements).toHaveLength(2)
    expect(stairs.elements.every((el) => !el.rotation)).toBe(true)
    expect(validateModelSchema(stairs)).toBeNull()
  })

  it('custom：空白模型无元素（保存时校验拦截）', () => {
    const m = createTemplateModel('free', 'custom')
    expect(m.elements).toHaveLength(0)
    expect(validateModelSchema(m)).toContain('至少需要一个立方体')
  })

  it('32px 画布：像素长度 1024、UV 上限 32', () => {
    const m = createTemplateModel('hd_block', 'cube_all', 32)
    expect(m.pixels).toHaveLength(1024)
    const n = normalizeModelSchema(m)
    expect(n.elements[0].faces.north?.uv).toEqual([0, 0, 16, 16])
  })
})

describe('applyTemplate（切换模板）', () => {
  it('重建几何与变量，但保留 id / 名称 / 像素画 / 画布尺寸', () => {
    const m = createTemplateModel('log_x', 'cube_all')
    m.displayName = '原木'
    m.pixels = Array.from({ length: 256 }, () => '#abcdef')
    applyTemplate(m, 'cube_column')
    expect(m.template).toBe('cube_column')
    expect(m.elements[0].faces.up?.texture).toBe('end')
    expect(Object.keys(m.textures)).toEqual(['end', 'side'])
    expect(m.id).toBe('log_x')
    expect(m.displayName).toBe('原木')
    expect(m.pixels.every((p) => p === '#abcdef')).toBe(true)
    expect(m.textures.end).toBe('textures/model/log_x.png')

    applyTemplate(m, 'custom')
    expect(m.elements).toHaveLength(0)
  })
})

describe('inferTemplate（旧数据/无模板字段推断）', () => {
  it('各模板去掉 template 字段后可被推断回来（custom 除外）', () => {
    const cases = ['cube_all', 'cube', 'cube_column', 'cross', 'slab', 'stairs'] as const
    for (const t of cases) {
      const m = createTemplateModel(`t_${t}`, t)
      const { template: _omit, ...legacy } = m
      expect(inferTemplate(legacy)).toBe(t)
    }
    // 非特征几何 → custom
    const m = createTemplateModel('weird', 'cube_all')
    m.elements[0].to = [8, 8, 8]
    expect(inferTemplate(m)).toBe('custom')
  })
})

describe('normalizeModelSchema（归一化修复）', () => {
  it('无 template 字段的旧模型自动补全并归一像素', () => {
    const m = createTemplateModel('legacy_cube')
    const { template: _omit, ...legacy } = m
    legacy.pixels = ['#ffffff', 'bad', ' #aBcDeF ', ...Array.from({ length: 253 }, () => '')]
    const n = normalizeModelSchema(legacy as TemplatedModelAsset)
    expect(n.template).toBe('cube_all')
    expect(n.pixels).toHaveLength(256)
    expect(n.pixels[0]).toBe('#ffffff')
    expect(n.pixels[1]).toBe('')
    expect(n.pixels[2]).toBe('#abcdef')
  })

  it('坐标交换与收敛、非法旋转角丢弃、面变量缺失自动补路径', () => {
    const m = createTemplateModel('fix_me')
    const el = m.elements[0]
    el.from = [20, 8, -4] as never
    el.to = [4, 40, 6] as never
    el.rotation = { origin: [8, 8, 8], axis: 'y', angle: 30 }
    el.faces.north = { uv: [0, 0, 99, 99], texture: 'missing_var' }
    const n = normalizeModelSchema(m)
    const fixed = n.elements[0]
    expect(fixed.from).toEqual([4, 8, 0])
    expect(fixed.to).toEqual([16, 16, 6])
    expect(fixed.rotation).toBeUndefined()
    expect(n.textures.missing_var).toBe('textures/model/fix_me.png')
    expect(fixed.faces.north?.uv).toEqual([0, 0, 16, 16])
  })

  it('textures.all 路径随 id 重命名归一，非法变量名剔除', () => {
    const m = createTemplateModel('old_id')
    const renamed: TemplatedModelAsset = { ...m, id: 'new_id' }
    const n = normalizeModelSchema(renamed)
    expect(n.textures.all).toBe('textures/model/new_id.png')
  })

  it('非法面旋转值被剔除，空元素被过滤', () => {
    const m = createTemplateModel('rot_check')
    m.elements[0].faces.up = { uv: [0, 0, 16, 16], texture: 'all', rotation: 45 as 0 }
    const extra = JSON.parse(JSON.stringify(m.elements[0]))
    extra.name = 'extra'
    m.elements.push(null as never, extra)
    const n = normalizeModelSchema(m)
    expect(n.elements).toHaveLength(2)
    expect(n.elements[0].faces.up?.rotation).toBeUndefined()
  })
})

describe('validateModelSchema（保存校验）', () => {
  it('ID / 名称 / 像素长度非法时报错', () => {
    const m = createTemplateModel('Bad Id')
    expect(validateModelSchema(m)).toContain('注册名')
    m.id = 'ok_id'
    m.displayName = '   '
    expect(validateModelSchema(m)).toContain('显示名称')
    m.displayName = 'ok'
    m.pixels = []
    expect(validateModelSchema(m)).toContain('像素数据长度')
  })

  it('面引用未定义变量时报错（归一化后应自动修复）', () => {
    const m = createTemplateModel('broken_var')
    m.elements[0].faces.east = { uv: [0, 0, 16, 16], texture: 'side' }
    expect(validateModelSchema(m)).toContain('未定义的贴图变量')
    const n = normalizeModelSchema(m)
    expect(validateModelSchema(n)).toBeNull()
  })
})
