import { describe, expect, it } from 'vitest'
import {
  autoFaceUv,
  autoUvElement,
  boxUvLayout,
  clampElement,
  elementSize,
  elementToThree,
  faceDimensions,
  isLegalRotationAngle,
  mirrorElement,
  snapRotation,
  snapHalf,
  threeToMc
} from '../modelMath'
import { createDefaultCube, type CubeElement } from '../../types/content'

function cube(from: [number, number, number], to: [number, number, number], name = 'c'): CubeElement {
  const el = createDefaultCube(name)
  el.from = from
  el.to = to
  return el
}

describe('clampElement', () => {
  it('越界坐标夹取到 0..16', () => {
    const el = clampElement(cube([-2, 0, 3], [20, 16, 8]))
    expect(el.from).toEqual([0, 0, 3])
    expect(el.to).toEqual([16, 16, 8])
  })

  it('from>to 逐轴交换', () => {
    const el = clampElement(cube([10, 0, 0], [4, 16, 16]))
    expect(el.from[0]).toBe(4)
    expect(el.to[0]).toBe(10)
  })

  it('不修改原对象', () => {
    const src = cube([-5, 0, 0], [16, 16, 16])
    const out = clampElement(src)
    expect(src.from[0]).toBe(-5)
    expect(out.from[0]).toBe(0)
  })
})

describe('snapRotation', () => {
  it.each([
    [0, 0],
    [22, 22.5],
    [11.25, 22.5],
    [-11.25, -22.5],
    [46, 45],
    [-50, -45],
    [NaN, 0]
  ])('%s → %s', (input, expected) => {
    expect(snapRotation(input)).toBe(expected)
  })

  it('合法性判断', () => {
    expect(isLegalRotationAngle(0)).toBe(true)
    expect(isLegalRotationAngle(-45)).toBe(true)
    expect(isLegalRotationAngle(30)).toBe(false)
    expect(isLegalRotationAngle(67.5)).toBe(false)
  })
})

describe('面尺寸与自动 UV', () => {
  const el = cube([0, 0, 0], [10, 8, 6])
  it('各面投影尺寸正确', () => {
    expect(faceDimensions(el, 'north')).toEqual({ w: 10, h: 8 })
    expect(faceDimensions(el, 'east')).toEqual({ w: 6, h: 8 })
    expect(faceDimensions(el, 'up')).toEqual({ w: 10, h: 6 })
  })
  it('单面自动 UV 从原点取投影宽高', () => {
    expect(autoFaceUv(el, 'east')).toEqual([0, 0, 6, 8])
  })
  it('自动 UV 不改变剔面状态', () => {
    const partial = cube([0, 0, 0], [16, 16, 16])
    delete partial.faces.south
    const out = autoUvElement(partial)
    expect(out.faces.south).toBeUndefined()
    expect(out.faces.north?.uv).toEqual([0, 0, 16, 16])
  })
})

describe('boxUvLayout 十字展开', () => {
  it('8³ 立方体在 32 贴图上得到标准十字布局 UV', () => {
    const el = cube([0, 0, 0], [8, 8, 8])
    const [layout] = boxUvLayout([el], 32)
    expect(layout.faces.up).toEqual([8, 0, 16, 8])
    expect(layout.faces.down).toEqual([16, 0, 24, 8])
    expect(layout.faces.west).toEqual([0, 8, 8, 16])
    expect(layout.faces.north).toEqual([8, 8, 16, 16])
    expect(layout.faces.east).toEqual([16, 8, 24, 16])
    expect(layout.faces.south).toEqual([24, 8, 32, 16])
  })

  it('两个 8³ 横向排满一行', () => {
    const layouts = boxUvLayout([cube([0, 0, 0], [8, 8, 8]), cube([0, 0, 0], [8, 8, 8])], 32)
    // 第二个元素 x 偏移 32 超宽 → 换行 y=16
    expect(layouts[1].faces.north).toEqual([8, 24, 16, 32])
  })

  it('16³ 在 16 贴图画布上容不下十字格，UV 退化（超出由 validateModel 报越界）', () => {
    const el = cube([0, 0, 0], [16, 16, 16])
    const [layout] = boxUvLayout([el], 16)
    // 换行后仍越界：north 落到 [16,16,32,32]，校验器会提示 uv_range
    expect(layout.faces.north).toEqual([16, 16, 32, 32])
  })
})

describe('mirrorElement', () => {
  it('X 镜像：坐标翻转 + east/west 面对调', () => {
    const el = cube([1, 2, 3], [4, 5, 6])
    el.faces.east = { uv: [1, 1, 2, 2], texture: 'all' }
    delete el.faces.west
    const out = mirrorElement(el, 'x')
    expect(out.from).toEqual([12, 2, 3])
    expect(out.to).toEqual([15, 5, 6])
    expect(out.faces.west?.uv).toEqual([1, 1, 2, 2])
    expect(out.faces.east).toBeUndefined()
  })

  it('Z 镜像：north/south 面对调', () => {
    const el = cube([0, 0, 1], [8, 8, 5])
    const out = mirrorElement(el, 'z')
    expect(out.from[2]).toBe(11)
    expect(out.to[2]).toBe(15)
    expect(out.faces.south?.uv).toEqual([0, 0, 16, 16])
  })

  it('旋转原点同步镜像', () => {
    const el = cube([0, 0, 0], [8, 8, 8])
    el.rotation = { origin: [2, 4, 0], axis: 'y', angle: 22.5 }
    const out = mirrorElement(el, 'x')
    expect(out.rotation?.origin[0]).toBe(14)
    expect(out.rotation?.origin[1]).toBe(4)
  })
})

describe('three 坐标映射', () => {
  it('16³ 立方体 → 位置 0、尺寸 1', () => {
    const t = elementToThree(cube([0, 0, 0], [16, 16, 16]))
    expect(t.position).toEqual([0, 0, 0])
    expect(t.size).toEqual([1, 1, 1])
  })

  it('上半格立方体 → y 位置 0.25、高 0.5', () => {
    const t = elementToThree(cube([0, 8, 0], [16, 16, 16]))
    expect(t.position[1]).toBeCloseTo(0.25)
    expect(t.size[1]).toBeCloseTo(0.5)
  })

  it('threeToMc 与映射互逆', () => {
    const mc = threeToMc([0.25, -0.5, 0])
    expect(mc).toEqual([12, 0, 8])
    expect(elementSize(cube([0, 0, 0], [16, 16, 16]))).toEqual([16, 16, 16])
  })

  it('snapHalf 半格吸附', () => {
    expect(snapHalf(3.27)).toBe(3.5)
    expect(snapHalf(3.2)).toBe(3)
  })
})
