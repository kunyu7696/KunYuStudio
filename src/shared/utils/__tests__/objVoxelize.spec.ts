/**
 * objVoxelize 单测：OBJ/MTL 解析 + 封闭立方体体素化 + 合并/调色板/剔面。
 */
import { describe, expect, it } from 'vitest'
import { parseMtl, parseObj, voxelizeObj } from '../objVoxelize'

/** 边长 1 的封闭立方体（8 顶点 6 四边面），up/east 红，其余蓝 */
const CUBE_OBJ = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
usemtl blue
f 1 4 3 2
f 5 6 7 8
f 1 5 8 4
f 1 2 6 5
usemtl red
f 2 3 7 6
f 4 8 7 3
`

const CUBE_MTL = `
newmtl red
Kd 1 0 0
newmtl blue
Kd 0.1 0.2 0.9
`

describe('parseMtl / parseObj', () => {
  it('Kd 0..1 转 #rrggbb', () => {
    const mats = parseMtl(CUBE_MTL)
    expect(mats['red']).toBe('#ff0000')
    expect(mats['blue']).toBe('#1a33e6')
  })

  it('四边面扇面三角化为 2 个三角形，usemtl 跟随', () => {
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nusemtl red\nf 1 2 3 4\n', 'newmtl red\nKd 1 0 0\n')
    expect(mesh.vertices).toHaveLength(4)
    expect(mesh.triangles).toHaveLength(2)
    expect(mesh.triangles.every((t) => t.material === 'red')).toBe(true)
    expect(mesh.materials['red']).toBe('#ff0000')
  })

  it('支持 v/vt/vn 混合索引与负索引', () => {
    const mesh = parseObj(`
v 0 0 0
v 1 0 0
v 1 1 0
f 1/1/1 2/2/1 -1/3/1
`)
    expect(mesh.triangles).toHaveLength(1)
    expect(mesh.triangles[0]).toMatchObject({ a: 0, b: 1, c: 2 })
  })
})

describe('voxelizeObj', () => {
  it('封闭立方体 16³ 体素全部占据，同色成片合并，总体积守恒，UV 不出界', () => {
    const mesh = parseObj(CUBE_OBJ, CUBE_MTL)
    const res = voxelizeObj(mesh, { resolution: 16, textureSize: 16 })
    expect(res.stats.grid).toEqual([16, 16, 16])
    expect(res.stats.voxels).toBe(4096)
    // 同色相邻体素成片合并，盒数显著少于体素数
    expect(res.stats.boxes).toBeLessThan(1024)

    const { model } = res
    expect(model.textureSize).toBe(16)
    expect(model.pixels).toHaveLength(256)
    // 合并后盒子体积之和守恒（不重不漏，1 体素 = 1 MC 单位³）
    const totalVolume = model.elements.reduce(
      (sum, el) =>
        sum +
        (el.to[0] - el.from[0]) * (el.to[1] - el.from[1]) * (el.to[2] - el.from[2]),
      0
    )
    expect(totalVolume).toBe(4096)
    for (const el of model.elements) {
      const coords = [...el.from, ...el.to]
      expect(Math.min(...coords)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...coords)).toBeLessThanOrEqual(16)
      for (const f of Object.values(el.faces)) {
        expect(f!.uv[0]).toBeGreaterThanOrEqual(0)
        expect(f!.uv[2]).toBeLessThanOrEqual(16)
        expect(f!.uv[3]).toBeLessThanOrEqual(16)
      }
    }
  })

  it('六向最近表面上色：红（上/东）与蓝（其余）都进入调色板', () => {
    const res = voxelizeObj(parseObj(CUBE_OBJ, CUBE_MTL), { resolution: 8 })
    const used = new Set(res.model.pixels.filter(Boolean))
    expect(used.has('#ff0000')).toBe(true)
    expect(used.has('#1a33e6')).toBe(true)
    expect(res.stats.colors).toBe(2)
  })

  it('非立方体比例保持：2×1×1 → 网格 16×8×8，XZ 居中、Y 落地', () => {
    const obj = `
v 0 0 0
v 2 0 0
v 2 1 0
v 0 1 0
v 0 0 1
v 2 0 1
v 2 1 1
v 0 1 1
f 1 4 3 2
f 5 6 7 8
f 1 5 8 4
f 2 3 7 6
f 4 8 7 3
f 1 2 6 5
`
    const res = voxelizeObj(parseObj(obj), { resolution: 16, defaultColor: '#abcdef' })
    expect(res.stats.grid).toEqual([16, 8, 8])
    const xs = res.model.elements.flatMap((e) => [e.from[0], e.to[0]])
    const zs = res.model.elements.flatMap((e) => [e.from[2], e.to[2]])
    const ys = res.model.elements.flatMap((e) => [e.from[1], e.to[1]])
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBe(16)
    expect(Math.min(...zs)).toBe(4)
    expect(Math.max(...zs)).toBe(12)
    expect(Math.min(...ys)).toBe(0)
    expect(Math.max(...ys)).toBe(8)
    expect(new Set(res.model.pixels.filter(Boolean))).toEqual(new Set(['#abcdef']))
  })

  it('分辨率夹取到 8..32', () => {
    const mesh = parseObj(CUBE_OBJ, CUBE_MTL)
    expect(voxelizeObj(mesh, { resolution: 2 }).stats.grid).toEqual([8, 8, 8])
    expect(voxelizeObj(mesh, { resolution: 99 }).stats.grid).toEqual([32, 32, 32])
  })

  it('异常输入：空 OBJ / 开口网格体素为空均抛错', () => {
    expect(() => voxelizeObj(parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nf 1 2 3\n'))).toThrow()
    // 只有一张单面 → 奇偶判定无内部点
    const openMesh = parseObj(`
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
`)
    // 共面单面：先在包围盒校验处拦截（extent 含 0）
    expect(() => voxelizeObj(openMesh)).toThrow(/为空|包围盒/)
  })
})
