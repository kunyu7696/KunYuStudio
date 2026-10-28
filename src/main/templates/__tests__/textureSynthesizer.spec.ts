import { describe, expect, it } from 'vitest'
import {
  hexToRgb,
  resolveBlockPattern,
  synthesizeBlockTexture,
  synthesizeItemTexture
} from '../textureSynthesizer'

const HEX = /^#[0-9a-f]{6}$/

function distinct(pixels: string[]): Set<string> {
  return new Set(pixels.filter((p) => p !== ''))
}

describe('synthesizeItemTexture', () => {
  it('输出 256 项，物品形状带透明背景且包含多种明暗色', () => {
    const gem = synthesizeItemTexture('#d0203c', { type: 'simple', id: 'ruby' })
    expect(gem).toHaveLength(256)
    expect(gem.some((p) => p === '')).toBe(true)
    expect(gem.every((p) => p === '' || HEX.test(p))).toBe(true)
    // 描边/暗/主/亮/高光至少 5 档颜色
    expect(distinct(gem).size).toBeGreaterThanOrEqual(5)
  })

  it('工具：木柄色 + 主色派生色共存；不同工具形状互不相同', () => {
    const sword = synthesizeItemTexture('#d0203c', { type: 'tool', toolKind: 'sword' })
    const pickaxe = synthesizeItemTexture('#d0203c', { type: 'tool', toolKind: 'pickaxe' })
    expect(sword).toHaveLength(256)
    const colors = distinct(sword)
    expect(colors.has('#a07744')).toBe(true)
    expect(colors.has('#6e4c28')).toBe(true)
    // 主色 #d0203c 本身应在工具头上
    expect(colors.has('#d0203c')).toBe(true)
    expect(sword).not.toEqual(pickaxe)
  })

  it('五工具 + 四盔甲槽位各自形状不同', () => {
    const toolKinds = ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'] as const
    const toolSets = toolKinds.map((k) =>
      synthesizeItemTexture('#3b82f6', { type: 'tool', toolKind: k }).join(',')
    )
    expect(new Set(toolSets).size).toBe(toolKinds.length)

    const slots = ['helmet', 'chestplate', 'leggings', 'boots'] as const
    const armorSets = slots.map((s) =>
      synthesizeItemTexture('#3b82f6', { type: 'armor', slot: s }).join(',')
    )
    expect(new Set(armorSets).size).toBe(slots.length)
  })

  it('id 含 ingot 时走锭形，且与宝石形不同', () => {
    const gem = synthesizeItemTexture('#c0a050', { type: 'simple', id: 'ruby' })
    const ingot = synthesizeItemTexture('#c0a050', { type: 'simple', id: 'ruby_ingot' })
    expect(ingot).not.toEqual(gem)
  })

  it('食物不透明果体 + 茎/叶点缀色；非法颜色回退不抛错', () => {
    const food = synthesizeItemTexture('#e0543a', { type: 'food' })
    const colors = distinct(food)
    expect(colors.has('#6e4c28')).toBe(true) // 茎
    expect(colors.has('#5d9c3f')).toBe(true) // 叶
    expect(() => synthesizeItemTexture('not-a-color', { type: 'food' })).not.toThrow()
  })

  it('block_item：不透明立方块（亮/暗/描边），不再是全透明', () => {
    const cube = synthesizeItemTexture('#d0203c', { type: 'block_item' })
    expect(cube.some((p) => p !== '')).toBe(true)
    expect(cube.filter((p) => p === '').length).toBeGreaterThan(0) // 形状外仍透明
    const colors = distinct(cube)
    expect(colors.size).toBeGreaterThanOrEqual(4)
  })
})

describe('synthesizeBlockTexture', () => {
  it('方块贴图满幅不透明、颜色合法，且不是纯色', () => {
    for (const pattern of ['generic', 'gem', 'bricks', 'lamp', 'ore'] as const) {
      const px = synthesizeBlockTexture('#d0203c', pattern)
      expect(px).toHaveLength(256)
      expect(px.every((p) => HEX.test(p))).toBe(true)
      expect(distinct(px).size).toBeGreaterThan(1)
    }
  })

  it('bricks 有砖缝暗色网格；ore 同时含石灰与主色', () => {
    const bricks = synthesizeBlockTexture('#b04a5a', 'bricks')
    // y=3 整行为砖缝（描边色 = 0.45× 主色）
    const rgb = hexToRgb('#b04a5a')
    const mortar = `#${[rgb.r, rgb.g, rgb.b]
      .map((v) => Math.round(v * 0.45).toString(16).padStart(2, '0'))
      .join('')}`
    for (let x = 0; x < 16; x++) expect(bricks[3 * 16 + x]).toBe(mortar)

    const ore = synthesizeBlockTexture('#d0203c', 'ore')
    const colors = distinct(ore)
    expect(colors.has('#8b8b8b')).toBe(true)
    expect(colors.has('#d0203c')).toBe(true)
  })

  it('lamp 中心高光比边缘亮', () => {
    const lamp = synthesizeBlockTexture('#d0203c', 'lamp')
    const lum = (p: string): number => {
      const c = hexToRgb(p)
      return c.r + c.g + c.b
    }
    expect(lum(lamp[7 * 16 + 7])).toBeGreaterThan(lum(lamp[0]))
  })
})

describe('resolveBlockPattern', () => {
  it('按 id 关键字分派花纹，缺省 generic', () => {
    expect(resolveBlockPattern('ruby_ore')).toBe('ore')
    expect(resolveBlockPattern('ruby_bricks')).toBe('bricks')
    expect(resolveBlockPattern('ruby_lamp')).toBe('lamp')
    expect(resolveBlockPattern('ruby_block')).toBe('gem')
    expect(resolveBlockPattern('magic_plinth')).toBe('generic')
  })
})
