import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  applyFaceUvs,
  buildCubeGroup,
  buildPreviewGroup,
  disposeCubeGroup,
  fitView,
  groupBounds,
  mcToThree
} from '../modelPreviewScene'
import { documentToElements, isMeshElement } from '../documentToElements'
import type { MeshElement } from '../documentToElements'
import { createDefaultCube, type CubeElement } from '../../../../../../shared/types/content'
import { addNode, createCubeNode, createDocument, createMeshNode } from '../../../../../../shared/modeler/document'
import { defaultMeshGeometry } from '../../../../../../shared/modeler/mesh'

function cube(from: [number, number, number], to: [number, number, number]): CubeElement {
  const el = createDefaultCube('c')
  el.from = from
  el.to = to
  return el
}

function pivotOf(group: THREE.Group, index: number): THREE.Group {
  const p = group.children.find((c) => c.userData.elementIndex === index)
  if (!p || !(p instanceof THREE.Group)) throw new Error(`pivot ${index} 不存在`)
  return p
}
function meshOf(group: THREE.Group, index: number): THREE.Mesh {
  const mesh = pivotOf(group, index).children[0]
  if (!(mesh instanceof THREE.Mesh)) throw new Error(`mesh ${index} 不存在`)
  return mesh
}

describe('modelPreviewScene mcToThree', () => {
  it('0..16 → ±0.5 中心原点', () => {
    expect(mcToThree(0)).toBeCloseTo(-0.5)
    expect(mcToThree(16)).toBeCloseTo(0.5)
    expect(mcToThree(8)).toBeCloseTo(0)
  })
})

describe('modelPreviewScene buildCubeGroup', () => {
  it('每个元素生成 pivot>mesh 层级并写 elementIndex', () => {
    const group = buildCubeGroup([createDefaultCube('a'), createDefaultCube('b')])
    expect(group.children).toHaveLength(2)
    expect(pivotOf(group, 0).userData.elementIndex).toBe(0)
    expect(meshOf(group, 0).userData.elementIndex).toBe(0)
    expect(meshOf(group, 1).userData.elementIndex).toBe(1)
    disposeCubeGroup(group)
  })

  it('默认 16³：pivot 居世界中心，mesh 缩放为 1', () => {
    const group = buildCubeGroup([createDefaultCube('full')])
    const pivot = pivotOf(group, 0)
    const mesh = meshOf(group, 0)
    expect(pivot.position.toArray()).toEqual([0, 0, 0])
    expect(mesh.position.toArray()).toEqual([0, 0, 0])
    expect(mesh.scale.toArray()).toEqual([1, 1, 1])
    disposeCubeGroup(group)
  })

  it('from/to 换算：pivot 居中、mesh scale=尺寸/16', () => {
    const group = buildCubeGroup([cube([1, 2, 3], [9, 10, 11])])
    const pivot = pivotOf(group, 0)
    const mesh = meshOf(group, 0)
    expect(pivot.position.toArray()).toEqual([mcToThree(5), mcToThree(6), mcToThree(7)])
    expect(mesh.scale.toArray()).toEqual([0.5, 0.5, 0.5])
    disposeCubeGroup(group)
  })

  it('单轴旋转：pivot 置于 origin 并绕轴旋转，mesh 相对 origin 偏移', () => {
    const el = cube([0, 0, 0], [4, 4, 4])
    el.rotation = { origin: [8, 0, 8], axis: 'y', angle: 45 }
    const group = buildCubeGroup([el])
    const pivot = pivotOf(group, 0)
    const mesh = meshOf(group, 0)
    expect(pivot.position.toArray()).toEqual([mcToThree(8), mcToThree(0), mcToThree(8)])
    // 中心 (2,2,2) 相对 origin (8,0,8) → (−6,2,−6)/16
    expect(mesh.position.toArray()).toEqual([-6 / 16, 2 / 16, -6 / 16])
    expect(pivot.rotation.y).toBeCloseTo(Math.PI / 4)
    disposeCubeGroup(group)
  })

  it('缺面剔除：缺失面材质 colorWrite=false，存在面为可见材质', () => {
    const el = createDefaultCube('partial')
    el.faces = { north: { uv: [0, 0, 16, 16], texture: 'all' } }
    const group = buildCubeGroup([el])
    const mesh = meshOf(group, 0)
    const mats = mesh.material as THREE.MeshLambertMaterial[]
    expect(mats).toHaveLength(6)
    const northIndex = 5 // px,nx,py,ny,pz,nz → north=nz
    expect(mats[northIndex]!.colorWrite).toBe(true)
    expect(mats[0]!.colorWrite).toBe(false)
    disposeCubeGroup(group)
  })

  it('共享贴图时复用同一材质贴图引用', () => {
    const texture = new THREE.Texture()
    const group = buildCubeGroup([createDefaultCube('a'), createDefaultCube('b')], texture, 16)
    const m0 = meshOf(group, 0).material as THREE.MeshLambertMaterial[]
    const m1 = meshOf(group, 1).material as THREE.MeshLambertMaterial[]
    expect(m0[0]!.map).toBe(texture)
    expect(m1[0]!.map).toBe(texture)
    // dispose 只清几何/材质，不动外部共享贴图（再遍历不抛错即可）
    disposeCubeGroup(group)
    expect(() => texture.dispose()).not.toThrow()
  })

  it('disposeCubeGroup：mesh 从场景摘除', () => {
    const scene = new THREE.Scene()
    const group = buildCubeGroup([createDefaultCube('a')])
    scene.add(group)
    disposeCubeGroup(group)
    expect(scene.children).toHaveLength(0)
  })
})

describe('modelPreviewScene applyFaceUvs', () => {
  it('north 面 UV：MC 左上原点重映射到 three 左下原点', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    applyFaceUvs(geo, { north: { uv: [0, 0, 8, 8], texture: 'all' } }, 16)
    const uv = geo.attributes.uv as THREE.BufferAttribute
    // north = 组 5，顶点 start=20；每面顶点 uv 序 0=左上(0,1) 1=右上(1,1) 2=左下(0,0) 3=右下(1,0)
    // 顶点 0（左上）→ (u1, 1−v1/size)
    expect(uv.getX(20)).toBeCloseTo(0)
    expect(uv.getY(20)).toBeCloseTo(1)
    // 顶点 3（右下）→ (u2, 1−v2/size)
    expect(uv.getX(23)).toBeCloseTo(0.5)
    expect(uv.getY(23)).toBeCloseTo(0.5)
    // 顶点 2（左下）→ (u1, 1−v2/size)
    expect(uv.getX(22)).toBeCloseTo(0)
    expect(uv.getY(22)).toBeCloseTo(0.5)
    geo.dispose()
  })

  it('rotation=90：左上角采样原左下角（置换表 [2,0,3,1]）', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    applyFaceUvs(geo, { north: { uv: [0, 0, 16, 16], texture: 'all', rotation: 90 } }, 16)
    const uv = geo.attributes.uv as THREE.BufferAttribute
    // 基准角（rotation=0）：TL=(0,1) TR=(1,1) BL=(0,0) BR=(1,0)
    // 目标顶点 0（TL）取基准角 2（BL）= (0,0)
    expect(uv.getX(20)).toBeCloseTo(0)
    expect(uv.getY(20)).toBeCloseTo(0)
    // 目标顶点 1（TR）取基准角 0（TL）= (0,1)
    expect(uv.getX(21)).toBeCloseTo(0)
    expect(uv.getY(21)).toBeCloseTo(1)
    geo.dispose()
  })
})

describe('modelPreviewScene 取景', () => {
  it('groupBounds：默认 16³ 单元的包围盒为 ±0.5', () => {
    const group = buildCubeGroup([createDefaultCube('full')])
    const box = groupBounds(group)!
    expect(box.min.x).toBeCloseTo(-0.5)
    expect(box.max.x).toBeCloseTo(0.5)
    expect(box.min.y).toBeCloseTo(-0.5)
    expect(box.max.y).toBeCloseTo(0.5)
    disposeCubeGroup(group)
  })

  it('groupBounds：旋转元素按世界包围盒扩展', () => {
    const el = cube([4, 4, 0], [12, 12, 16])
    el.rotation = { origin: [8, 8, 8], axis: 'z', angle: 45 }
    const group = buildCubeGroup([el])
    const box = groupBounds(group)!
    // 8×8 截面绕中心转 45° → 半径 4√2
    expect(box.max.x).toBeCloseTo(4 * Math.SQRT2 / 16, 5)
    expect(box.min.x).toBeCloseTo(-4 * Math.SQRT2 / 16, 5)
    disposeCubeGroup(group)
  })

  it('groupBounds：空 group 返回 null', () => {
    expect(groupBounds(new THREE.Group())).toBeNull()
  })

  it('fitView：目标为包围盒中心，距离使包围球入视', () => {
    const box = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5))
    const { target, distance } = fitView(box, 45)
    expect(target.toArray()).toEqual([0, 0, 0])
    // 半径 √3/2 ≈ 0.866；sin(22.5°) ≈ 0.3827；×1.12
    expect(distance).toBeCloseTo(((Math.sqrt(3) / 2) / Math.sin(Math.PI / 8)) * 1.12, 6)
  })

  it('fitView：空盒按 0.9 半径兜底', () => {
    const { target, distance } = fitView(new THREE.Box3(), 45)
    expect(target.toArray()).toEqual([0, 0, 0])
    expect(distance).toBeCloseTo((0.9 / Math.sin(Math.PI / 8)) * 1.12, 6)
  })
})

/* ------------------------------------------------------------------ */
/* v3 C4：mesh 只读预览                                                  */
/* ------------------------------------------------------------------ */

/** 构造含 cube + mesh 的文档（mesh 用默认四棱锥几何） */
function meshDoc(): { doc: ReturnType<typeof createDocument>; meshId: string } {
  let doc = createDocument({ name: 'prev', format: 'free' })
  const cube = createCubeNode('box', { from: [0, 0, 0], to: [16, 16, 16] })
  cube.faces = { north: { uv: [0, 0, 16, 16] } }
  doc = addNode(doc, cube, null)
  const mesh = createMeshNode('pyramid', defaultMeshGeometry())
  doc = addNode(doc, mesh, null)
  return { doc, meshId: mesh.id }
}

function meshElementOf(elements: ReturnType<typeof documentToElements>): MeshElement {
  const el = elements.find((e) => isMeshElement(e))
  if (!el || !isMeshElement(el)) throw new Error('未找到 mesh 预览元素')
  return el
}

describe('documentToElements mesh 适配（v3 C4）', () => {
  it('cube 与 mesh 都产出预览元素；mesh 打 kind 标记且几何/UV 直传', () => {
    const { doc, meshId } = meshDoc()
    const elements = documentToElements(doc)
    expect(elements).toHaveLength(2)
    const me = meshElementOf(elements)
    expect(me.name).toBe('pyramid')
    expect(me.faces.length).toBeGreaterThan(0)
    // 顶点/UV 直传（深拷贝，改预览元素不影响文档）
    const src = doc.nodes[meshId] as unknown as { vertices: number[][]; faces: { uv: number[][] }[] }
    expect(me.vertices).toHaveLength(src.vertices.length)
    expect(me.vertices[0]).toEqual(src.vertices[0])
    expect(me.vertices[0]).not.toBe(src.vertices[0])
    expect(me.faces[0]!.uv[0]).toEqual(src.faces[0]!.uv[0])
    expect(me.faces[0]!.uv[0]).not.toBe(src.faces[0]!.uv[0])
  })

  it('isMeshElement：cube 元素为 false、mesh 元素为 true', () => {
    const { doc } = meshDoc()
    const elements = documentToElements(doc)
    expect(elements.filter((e) => !isMeshElement(e))).toHaveLength(1)
    expect(elements.filter((e) => isMeshElement(e))).toHaveLength(1)
  })

  it('纯 mesh 文档不再被静默跳过', () => {
    let doc = createDocument({ name: 'only-mesh', format: 'free' })
    doc = addNode(doc, createMeshNode('pyramid', defaultMeshGeometry()), null)
    expect(documentToElements(doc)).toHaveLength(1)
  })
})

describe('buildPreviewGroup mesh 装配（v3 C4）', () => {
  it('pivot>mesh 结构与 elementIndex 标记与 cube 一致（混合元素）', () => {
    const { doc } = meshDoc()
    const elements = documentToElements(doc)
    const group = buildPreviewGroup(elements)
    expect(group.children).toHaveLength(2)
    expect(pivotOf(group, 0).userData.elementIndex).toBe(0)
    expect(meshOf(group, 0).userData.elementIndex).toBe(0)
    // mesh 元素（下标 1）：结构同样为 pivot>mesh，便于高亮/释放复用
    const meshPivot = pivotOf(group, 1)
    expect(meshPivot.children).toHaveLength(1)
    expect(meshOf(group, 1).userData.elementIndex).toBe(1)
    disposeCubeGroup(group)
  })

  it('mesh 几何：扇形三角化非索引化；geo 局部 = (顶点−origin)/16', () => {
    let doc = createDocument({ name: 'm', format: 'free' })
    const mesh = createMeshNode('tri', {
      vertices: [
        [0, 0, 0],
        [16, 0, 0],
        [0, 16, 0],
        [0, 0, 16]
      ],
      faces: [
        { vertices: [0, 1, 2], uv: [[0, 0], [16, 0], [0, 16]] },
        { vertices: [0, 1, 3], uv: [[0, 0], [16, 0], [0, 16]] }
      ]
    })
    doc = addNode(doc, mesh, null)
    const group = buildPreviewGroup(documentToElements(doc))
    const geo = meshOf(group, 0).geometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    expect(pos.count).toBe(6) // 2 三角 × 3 顶点
    // origin = 0 → geo 局部 = 顶点/16：v0 (0,0,0) → (0,0,0)；v1 (16,0,0) → (1,0,0)
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([0, 0, 0])
    expect([pos.getX(1), pos.getY(1), pos.getZ(1)]).toEqual([1, 0, 0])
    // UV：(0,0)→(0,1)；(16,0)→(1,1)
    const uv = geo.attributes.uv as THREE.BufferAttribute
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 1])
    expect([uv.getX(1), uv.getY(1)]).toEqual([1, 1])
    // 世界坐标 = pivot(mcToThree(0) = −0.5) + 局部 → 顶点 0 落在 (−0.5,−0.5,−0.5)
    const world = meshOf(group, 0).localToWorld(new THREE.Vector3(0, 0, 0))
    expect([world.x, world.y, world.z]).toEqual([-0.5, -0.5, -0.5])
    disposeCubeGroup(group)
  })

  it('mesh 旋转：pivot 位置 = origin/16 − 0.5，绕 origin 三轴欧拉', () => {
    let doc = createDocument({ name: 'm', format: 'free' })
    const mesh = createMeshNode('tri', {
      vertices: [
        [0, 0, 0],
        [16, 0, 0],
        [0, 16, 0]
      ],
      faces: [{ vertices: [0, 1, 2], uv: [[0, 0], [16, 0], [0, 16]] }]
    })
    mesh.origin = [8, 8, 8]
    mesh.rotation = [0, 0, 90]
    doc = addNode(doc, mesh, null)
    const group = buildPreviewGroup(documentToElements(doc))
    const pivot = pivotOf(group, 0)
    // origin (8,8,8) → mcToThree(8) = 0
    expect([pivot.position.x, pivot.position.y, pivot.position.z]).toEqual([0, 0, 0])
    expect(pivot.rotation.z).toBeCloseTo(Math.PI / 2)
    // geo 局部以 origin 为基准：(v − origin)/16 → v0 (0,0,0) → (−0.5,−0.5,−0.5)
    const pos = meshOf(group, 0).geometry.attributes.position as THREE.BufferAttribute
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([-0.5, -0.5, -0.5])
    group.updateMatrixWorld(true)
    // v1 (16,0,0) → 局部 (0.5,−0.5,−0.5)；Rz90: (x,y)→(−y,x) → 世界 (0.5, 0.5, −0.5)
    const world = meshOf(group, 0).localToWorld(new THREE.Vector3(0.5, -0.5, -0.5))
    expect(world.x).toBeCloseTo(0.5, 6)
    expect(world.y).toBeCloseTo(0.5, 6)
    expect(world.z).toBeCloseTo(-0.5, 6)
    disposeCubeGroup(group)
  })

  it('越界顶点索引被跳过；UV 槽位不齐走对角线兜底', () => {
    let doc = createDocument({ name: 'm', format: 'free' })
    const mesh = createMeshNode('bad', {
      vertices: [
        [0, 0, 0],
        [16, 0, 0],
        [0, 16, 0]
      ],
      faces: [
        { vertices: [0, 1, 99], uv: [[0, 0], [16, 0], [0, 16]] }, // 越界 → 仅 2 有效顶点 → 跳过
        { vertices: [0, 1, 2], uv: [] } // UV 不齐 → 0/0.5/1 对角线展开
      ]
    })
    doc = addNode(doc, mesh, null)
    const group = buildPreviewGroup(documentToElements(doc))
    const geo = meshOf(group, 0).geometry
    const pos = geo.attributes.position as THREE.BufferAttribute
    expect(pos.count).toBe(3) // 仅第二面成三角
    const uv = geo.attributes.uv as THREE.BufferAttribute
    expect([uv.getX(0), uv.getY(0)]).toEqual([0, 1])
    expect([uv.getX(1), uv.getY(1)]).toEqual([0.5, 0.5])
    expect([uv.getX(2), uv.getY(2)]).toEqual([1, 0])
    disposeCubeGroup(group)
  })

  it('groupBounds 纳入 mesh 几何（取景不再漏掉网格）', () => {
    let doc = createDocument({ name: 'm', format: 'free' })
    doc = addNode(
      doc,
      createMeshNode('tri', {
        vertices: [
          [0, 0, 0],
          [16, 0, 0],
          [0, 16, 0]
        ],
        faces: [{ vertices: [0, 1, 2], uv: [[0, 0], [16, 0], [0, 16]] }]
      }),
      null
    )
    const group = buildPreviewGroup(documentToElements(doc))
    const box = groupBounds(group)!
    expect(box.min.x).toBeCloseTo(-0.5)
    expect(box.max.x).toBeCloseTo(0.5)
    expect(box.max.y).toBeCloseTo(0.5)
    disposeCubeGroup(group)
  })
})
