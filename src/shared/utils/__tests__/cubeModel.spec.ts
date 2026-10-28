import { describe, expect, it } from 'vitest'
import { createDefaultCube, type CubeElement } from '../../types/content'
import {
  addElement,
  autoUvAllBox,
  autoUvFace,
  autoUvOne,
  cloneElement,
  commitElement,
  createSmallCube,
  duplicateElement,
  mirrorAt,
  removeElementAt,
  renameElement,
  setElementShade,
  toggleFace,
  updateFace
} from '../cubeModel'

function full(): CubeElement {
  return createDefaultCube('整盒')
}

describe('cubeModel 元素集合纯函数（M12）', () => {
  it('createSmallCube：居中 4³ 六面齐全绑 all', () => {
    const el = createSmallCube('小')
    expect(el.from).toEqual([6, 6, 6])
    expect(el.to).toEqual([10, 10, 10])
    expect(Object.keys(el.faces)).toHaveLength(6)
    expect(el.faces.north?.texture).toBe('all')
    expect(el.shade).toBe(true)
  })

  it('cloneElement 深拷贝：改副本不影响原件', () => {
    const src = full()
    const cp = cloneElement(src)
    cp.from[0] = 3
    cp.faces.north!.uv[0] = 9
    cp.rotation = undefined
    expect(src.from[0]).toBe(0)
    expect(src.faces.north!.uv[0]).toBe(0)
    expect(cp.faces.north).not.toBe(src.faces.north)
  })

  it('addElement 无选中：追加居中 4³ 并返回新下标', () => {
    const r = addElement([full()], null)
    expect(r.elements).toHaveLength(2)
    expect(r.index).toBe(1)
    expect(r.elements[1]!.from).toEqual([6, 6, 6])
  })

  it('addElement 有选中：偏移复制（+x 优先）', () => {
    const els = [createSmallCube('a')] // 6..10，+1 → 7..11
    const r = addElement(els, 0)
    expect(r.elements[1]!.from).toEqual([7, 6, 6])
    expect(r.elements[1]!.to).toEqual([11, 10, 10])
    // 原数组与原元素不被修改
    expect(els[0]!.from).toEqual([6, 6, 6])
  })

  it('duplicateElement：+x 越界时尝试 -x；命名带副本', () => {
    const el = createSmallCube('贴边')
    el.from = [12, 6, 6]
    el.to = [16, 10, 10]
    const r = duplicateElement([el], 0)
    expect(r.elements[1]!.from).toEqual([11, 6, 6])
    expect(r.elements[1]!.name).toContain('副本')
  })

  it('duplicateElement 全方向越界（整盒）：原地兜底且不越界', () => {
    const r = duplicateElement([full()], 0)
    expect(r.elements[1]!.from.every((v) => v >= 0)).toBe(true)
    expect(r.elements[1]!.to.every((v) => v <= 16)).toBe(true)
  })

  it('removeElementAt：仅剩 1 个时拒绝删除；非法下标原样返回', () => {
    const one = [full()]
    expect(removeElementAt(one, 0)).toBe(one)
    expect(removeElementAt([full(), createSmallCube('b')], 5)).toHaveLength(2)
    const two = [full(), createSmallCube('b')]
    expect(removeElementAt(two, 0)).toEqual([two[1]])
  })

  it('renameElement 只改名且不可变', () => {
    const els = [full()]
    const out = renameElement(els, 0, '新名字')
    expect(out[0]!.name).toBe('新名字')
    expect(out).not.toBe(els)
    expect(els[0]!.name).toBe('整盒')
  })

  it('commitElement：from/to 越界夹取并排序；rotation undefined 移除旋转', () => {
    const els = [createSmallCube('a')]
    const out = commitElement(els, 0, {
      from: [12, 18, -2],
      to: [4, 10, 8],
      rotation: undefined
    })
    // x 轴反转排序 → 4..12；y 夹 10..16；z 夹 0..8
    expect(out[0]!.from).toEqual([4, 10, 0])
    expect(out[0]!.to).toEqual([12, 16, 8])
    expect('rotation' in out[0]!).toBe(false)
  })

  it('commitElement：旋转补丁写入 origin/axis/angle', () => {
    const out = commitElement([full()], 0, {
      rotation: { origin: [8, 0, 8], axis: 'y', angle: 22.5 }
    })
    expect(out[0]!.rotation).toEqual({ origin: [8, 0, 8], axis: 'y', angle: 22.5 })
  })

  it('toggleFace：剔除后再开启，UV 按面尺寸、变量沿用首面', () => {
    const els = [full()]
    const removed = toggleFace(els, 0, 'north')
    expect(removed[0]!.faces.north).toBeUndefined()
    const back = toggleFace(removed, 0, 'north')
    expect(back[0]!.faces.north?.texture).toBe('all')
    // 16³ north 面 16×16
    expect(back[0]!.faces.north?.uv).toEqual([0, 0, 16, 16])
  })

  it('toggleFace：开启面沿用同立方体其他面的贴图变量', () => {
    const el = createSmallCube('a')
    delete el.faces.north
    el.faces.south!.texture = 'side'
    const out = toggleFace([el], 0, 'north')
    expect(out[0]!.faces.north?.texture).toBe('side')
  })

  it('updateFace：只改指定字段，不动其他面', () => {
    const out = updateFace([full()], 0, 'up', { texture: 'top', rotation: 90 })
    expect(out[0]!.faces.up).toMatchObject({ texture: 'top', rotation: 90 })
    expect(out[0]!.faces.up?.uv).toEqual([0, 0, 16, 16])
    expect(out[0]!.faces.down?.texture).toBe('all')
  })

  it('updateFace：面不存在时不变', () => {
    const els = [full()]
    delete els[0]!.faces.east
    expect(updateFace(els, 0, 'east', { texture: 'x' })).toBe(els)
  })

  it('autoUvOne：存在面按投影尺寸重算，剔面保持剔除', () => {
    const el = createSmallCube('a') // 4³
    const out = autoUvOne([el], 0)
    expect(out[0]!.faces.up?.uv).toEqual([0, 0, 4, 4])
    const partial = toggleFace(out, 0, 'south')
    const again = autoUvOne(partial, 0)
    expect(again[0]!.faces.south).toBeUndefined()
  })

  it('autoUvFace：只重算指定面，其他面 UV 不动', () => {
    const el = createSmallCube('a')
    el.faces.north!.uv = [1, 2, 3, 4]
    el.faces.up!.uv = [5, 6, 7, 8]
    const out = autoUvFace([el], 0, 'north')
    expect(out[0]!.faces.north?.uv).toEqual([0, 0, 4, 4])
    expect(out[0]!.faces.up?.uv).toEqual([5, 6, 7, 8])
    // 面剔除时原样返回
    const partial = toggleFace([createSmallCube('b')], 0, 'east')
    expect(autoUvFace(partial, 0, 'east')).toBe(partial)
  })

  it('autoUvAllBox：两个 4³ 十字展开不重叠（north UV 起点不同）', () => {
    const els = autoUvAllBox([createSmallCube('a'), createSmallCube('b')], 16)
    const n0 = els[0]!.faces.north!.uv
    const n1 = els[1]!.faces.north!.uv
    expect(n0).not.toEqual(n1)
    // 4³ 十字宽 16：第一个占满首行，第二个换行（y 偏移 8）
    expect(n0).toEqual([4, 4, 8, 8])
    expect(n1).toEqual([4, 12, 8, 16])
  })

  it('mirrorAt：x 镜像翻转坐标并对调 east/west', () => {
    const el = createSmallCube('a') // 6..10 → 镜像 6..10（对称，改用偏移体）
    el.from = [0, 0, 0]
    el.to = [4, 4, 4]
    const out = mirrorAt([el], 0, 'x')
    expect(out[0]!.from[0]).toBe(12)
    expect(out[0]!.to[0]).toBe(16)
    // 原 east 的 UV 数据应落到 west
    expect(out[0]!.faces.west?.uv).toEqual(el.faces.east?.uv)
  })

  it('setElementShade 与非法下标', () => {
    expect(setElementShade([full()], 0, false)[0]!.shade).toBe(false)
    expect(setElementShade([full()], 9, false)).toHaveLength(1)
  })
})
