import { describe, expect, it } from 'vitest'
import {
  autoFaceUv,
  autoUvCube,
  boxUvFaces,
  boxUvRegionSize,
  cubeSize,
  effectiveFaceBindings,
  faceDimensions,
  fitMeshFaceUvIntoRect,
  meshFaceUvBounds,
  normalizeUvRect,
  packBoxUvOffsets,
  rotateUvCorners,
  setMeshFaceUvVertex,
  translateMeshFaceUv
} from '../uv'
import { createCubeNode } from '../document'
import type { MeshFace, Vec2 } from '../types'

describe('modeler/uv 尺寸与自动 UV', () => {
  it('cubeSize：逐轴取 |to−from|（容忍负向书写）', () => {
    expect(cubeSize({ from: [0, 0, 0], to: [3, 4, 5] })).toEqual([3, 4, 5])
    expect(cubeSize({ from: [5, 4, 3], to: [2, 0, 0] })).toEqual([3, 4, 3])
  })

  it('faceDimensions：north/south 看 Z；east/west 看 X；up/down 看 Y', () => {
    const size: [number, number, number] = [2, 3, 4]
    expect(faceDimensions(size, 'north')).toEqual({ w: 2, h: 3 })
    expect(faceDimensions(size, 'south')).toEqual({ w: 2, h: 3 })
    expect(faceDimensions(size, 'east')).toEqual({ w: 4, h: 3 })
    expect(faceDimensions(size, 'west')).toEqual({ w: 4, h: 3 })
    expect(faceDimensions(size, 'up')).toEqual({ w: 2, h: 4 })
    expect(faceDimensions(size, 'down')).toEqual({ w: 2, h: 4 })
  })

  it('autoFaceUv / autoUvCube：从 (0,0) 起取投影宽高，仅更新已存在面', () => {
    expect(autoFaceUv([2, 3, 4], 'east')).toEqual([0, 0, 4, 3])
    const cube = createCubeNode('c', { from: [0, 0, 0], to: [4, 8, 4] })
    cube.faces = { north: { uv: [9, 9, 9, 9], texture: 't1', rotation: 90 } }
    const next = autoUvCube(cube)
    expect(next.faces.north).toEqual({ uv: [0, 0, 4, 8], texture: 't1', rotation: 90 })
    expect(next.faces.south).toBeUndefined()
    expect(cube.faces.north!.uv).toEqual([9, 9, 9, 9])
  })
})

describe('modeler/uv box-uv 十字展开', () => {
  it('boxUvRegionSize：宽 2(dz+dx)、高 dy+dz', () => {
    expect(boxUvRegionSize([4, 8, 4])).toEqual({ width: 16, height: 12 })
  })

  it('boxUvFaces：16³ 立方体在 (0,0) 的标准布局', () => {
    const m = boxUvFaces([16, 16, 16], [0, 0])
    expect(m.up).toEqual([16, 0, 32, 16])
    expect(m.down).toEqual([32, 0, 48, 16])
    expect(m.west).toEqual([0, 16, 16, 32])
    expect(m.north).toEqual([16, 16, 32, 32])
    expect(m.east).toEqual([32, 16, 48, 32])
    expect(m.south).toEqual([48, 16, 64, 32])
  })

  it('boxUvFaces：偏移生效且各面互不重叠', () => {
    const m = boxUvFaces([2, 3, 4], [10, 20])
    // 总区域宽 2(4+2)=12、高 3+4=7
    expect(m.west).toEqual([10, 24, 14, 27])
    expect(m.south).toEqual([10 + 2 * 4 + 2, 24, 10 + 2 * 4 + 2 + 2, 27])
    expect(m.up).toEqual([10 + 4, 20, 10 + 4 + 2, 24])
  })

  it('effectiveFaceBindings：per_face 直用 faces；box 用十字展开并保留贴图绑定', () => {
    const cube = createCubeNode('c')
    cube.faces = { north: { uv: [1, 1, 5, 5], texture: 'tex-a' } }
    const perFace = effectiveFaceBindings(cube, 'per_face')
    expect(Object.keys(perFace)).toEqual(['north'])
    expect(perFace.north).toEqual({ uv: [1, 1, 5, 5], texture: 'tex-a' })

    cube.boxUv = { uvOffset: [0, 0] }
    const box = effectiveFaceBindings(cube, 'box')
    expect(Object.keys(box)).toHaveLength(6)
    expect(box.north).toEqual({
      uv: [16, 16, 32, 32],
      texture: 'tex-a',
      rotation: undefined,
      cullface: undefined,
      tint: undefined
    })

    // box 模式但缺 boxUv → 兜底回 faces
    delete cube.boxUv
    const fallback = effectiveFaceBindings(cube, 'box')
    expect(Object.keys(fallback)).toEqual(['north'])
    expect(fallback.north!.uv).toEqual([1, 1, 5, 5])
  })
})

describe('modeler/uv 面旋转与规范化', () => {
  it('rotateUvCorners：四种角度的角点映射', () => {
    const uv: [number, number, number, number] = [10, 20, 30, 40]
    expect(rotateUvCorners(uv, 0)).toEqual([[10, 20], [30, 20], [30, 40], [10, 40]])
    // 顺时针 90°：左上采样原左下
    expect(rotateUvCorners(uv, 90)).toEqual([[10, 40], [10, 20], [30, 20], [30, 40]])
    expect(rotateUvCorners(uv, 180)).toEqual([[30, 40], [10, 40], [10, 20], [30, 20]])
    expect(rotateUvCorners(uv, 270)).toEqual([[30, 20], [30, 40], [10, 40], [10, 20]])
  })

  it('rotateUvCorners：方形区域下再转 90° 的角点复合（M90: (u,v)→(v,S−u)）', () => {
    const S = 8
    const uv: [number, number, number, number] = [0, 0, S, S]
    const r90 = rotateUvCorners(uv, 90)
    const r180 = rotateUvCorners(uv, 180)
    const m90 = (p: [number, number]): [number, number] => [p[1], S - p[0]]
    r90.forEach((p, i) => expect(m90(p)).toEqual(r180[i]))
  })

  it('normalizeUvRect：自由框选反向时归一', () => {
    expect(normalizeUvRect([30, 40, 10, 20])).toEqual([10, 20, 30, 40])
    expect(normalizeUvRect([1, 2, 3, 4])).toEqual([1, 2, 3, 4])
  })
})

describe('modeler/uv box-uv 自动排布', () => {
  it('货架式排布并自动换行', () => {
    // 两个 16³：区域各 64×32，128 宽画布可并排
    const { offsets, overflow } = packBoxUvOffsets([[16, 16, 16], [16, 16, 16]], [128, 128])
    expect(offsets).toEqual([
      [0, 0],
      [64, 0]
    ])
    expect(overflow).toEqual([])
    // 三个 16³ 在 128 宽画布：第三个换行
    const r3 = packBoxUvOffsets([[16, 16, 16], [16, 16, 16], [16, 16, 16]], [128, 128])
    expect(r3.offsets[2]).toEqual([0, 32])
  })

  it('单体放不下记入 overflow；恰好贴合不换行', () => {
    // 24×16×16 区域宽 2(16+24)=80 > 64
    const tooBig = packBoxUvOffsets([[24, 16, 16]], [64, 64])
    expect(tooBig.overflow).toEqual([0])
    expect(tooBig.offsets).toEqual([[0, 0]])
    const exact = packBoxUvOffsets([[16, 16, 16]], [64, 32])
    expect(exact.overflow).toEqual([])
    expect(exact.offsets).toEqual([[0, 0]])
    // 第二个放不下（高度不足）
    const twoNoRoom = packBoxUvOffsets([[16, 16, 16], [16, 16, 16]], [64, 32])
    expect(twoNoRoom.overflow).toEqual([1])
  })
})

describe('modeler/uv mesh 逐顶点 UV 桥接（v3 C3b）', () => {
  const face = (uv: Vec2[]): MeshFace => ({ vertices: uv.map((_, i) => i), uv })

  it('meshFaceUvBounds：逐顶点 UV 归一到 per-face rect 语义', () => {
    expect(meshFaceUvBounds(face([[2, 3], [8, 3], [8, 9], [2, 9]]))).toEqual([2, 3, 8, 9])
    // 逆序/乱序点也取包围盒
    expect(meshFaceUvBounds(face([[8, 9], [2, 3], [8, 3]]))).toEqual([2, 3, 8, 9])
    // 无 uv → null
    expect(meshFaceUvBounds(face([]))).toBeNull()
  })

  it('translateMeshFaceUv：整体平移且不改原数组', () => {
    const uv: Vec2[] = [[0, 0], [4, 0], [4, 4]]
    const moved = translateMeshFaceUv(face(uv), 2, -1)
    expect(moved).toEqual([[2, -1], [6, -1], [6, 3]])
    expect(uv[0]).toEqual([0, 0])
  })

  it('setMeshFaceUvVertex：改单顶点 UV；越界槽位原样副本', () => {
    const uv: Vec2[] = [[0, 0], [4, 0], [4, 4]]
    expect(setMeshFaceUvVertex(face(uv), 1, [9, 9])).toEqual([[0, 0], [9, 9], [4, 4]])
    expect(setMeshFaceUvVertex(face(uv), 7, [9, 9])).toEqual([[0, 0], [4, 0], [4, 4]])
    expect(uv[1]).toEqual([4, 0])
  })

  it('fitMeshFaceUvIntoRect：按包围盒逐轴映射进目标矩形', () => {
    // 包围盒 2..8 / 3..9（6×6）→ 矩形 (16,16)-(32,32)
    const fitted = fitMeshFaceUvIntoRect(face([[2, 3], [8, 3], [8, 9], [2, 9]]), [16, 16, 32, 32])
    expect(fitted).toEqual([[16, 16], [32, 16], [32, 32], [16, 32]])
  })

  it('fitMeshFaceUvIntoRect：退化轴对齐矩形边；反向矩形归一', () => {
    // u 全为 5（宽 0，无延展）→ 对齐矩形左边；v 3..9 → v 装入 0..6
    const fitted = fitMeshFaceUvIntoRect(face([[5, 3], [5, 9]]), [0, 0, 10, 6])
    expect(fitted).toEqual([[0, 0], [0, 6]])
    // 反向矩形 (32,32)-(16,16) 归一为 (16,16)-(32,32)
    const rev = fitMeshFaceUvIntoRect(face([[0, 0], [4, 4]]), [32, 32, 16, 16])
    expect(rev).toEqual([[16, 16], [32, 32]])
  })

  it('fitMeshFaceUvIntoRect：面无 uv → 原样副本', () => {
    const f = face([])
    expect(fitMeshFaceUvIntoRect(f, [0, 0, 8, 8])).toEqual([])
  })
})
