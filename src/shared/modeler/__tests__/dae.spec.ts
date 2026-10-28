/**
 * Collada（.dae）导入编解码测试（C5）。
 *
 * 核心不变量：
 * - `<triangles>` / `<polylist>` / `<polygons>` 图元落地为 MeshNode（共享顶点池 + 面索引）；
 * - `<vertices>` 的 POSITION 间接指向位置 source 被正确解引用；
 * - TEXCOORD 逐角 UV：Collada 0..1 + 左下原点 → 编辑器像素坐标 + 左上原点（v 翻转）；
 * - `<vcount>` > 4 的多边形扇形三角化 + warning；
 * - `<node>` 变换烘焙：纯平移 → 平移进顶点；含旋转/缩放 → 整链烘焙 + info 降级；
 * - 无场景实例 → 几何平铺到根 + info 降级；无几何 → warning（不抛错）；
 * - `<up_axis>Z_UP` → 全局旋转使 +Y 向上；
 * - 交错 stride 的 accessor 解析；
 * - 每个产出文档通过 validateDocument（合法树）。
 */
import { describe, expect, it } from 'vitest'
import { validateDocument } from '../document'
import { daeToDocument } from '../formats/dae'
import type { GroupNode, MeshNode } from '../types'

/* ---------- XML 片段工具 ---------- */

/** 位置 source（count 个三元组，非交错） */
const posSource = (id: string, values: string, count: number): string => `
  <source id="${id}">
    <float_array id="${id}-arr" count="${count * 3}">${values}</float_array>
    <technique_common>
      <accessor source="#${id}-arr" count="${count}" stride="3">
        <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
      </accessor>
    </technique_common>
  </source>`

const verts = (id: string, posId: string): string =>
  `<vertices id="${id}"><input semantic="POSITION" source="#${posId}"/></vertices>`

/** 组装最小 COLLADA（up_axis 缺省 Y_UP；可选几何体与场景） */
const collada = (geometries: string, scenes: string, upAxis = 'Y_UP'): string =>
  `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><unit meter="0.01" name="centimeter"/><up_axis>${upAxis}</up_axis></asset>
  <library_geometries>${geometries}</library_geometries>${scenes}
</COLLADA>`

/* ---------- 几何样本 ---------- */

/** 单三角形几何（无 UV，无场景） */
const GEO_TRI = `
  <geometry id="tri-geo" name="Tri">
    <mesh>
      ${posSource('tri-pos', '0 0 0 1 0 0 0 1 0', 3)}
      ${verts('tri-verts', 'tri-pos')}
      <triangles material="mat0" count="1">
        <input semantic="VERTEX" source="#tri-verts" offset="0"/>
        <p>0 1 2</p>
      </triangles>
    </mesh>
  </geometry>`

/** 带逐角 UV 的三角形几何 */
const GEO_TRI_UV = `
  <geometry id="triuv-geo" name="TriUv">
    <mesh>
      ${posSource('triuv-pos', '0 0 0 1 0 0 0 1 0', 3)}
      <source id="triuv-uv">
        <float_array id="triuv-uv-arr" count="6">0 0 1 0 0.5 1</float_array>
        <technique_common>
          <accessor source="#triuv-uv-arr" count="3" stride="2">
            <param name="S" type="float"/><param name="T" type="float"/>
          </accessor>
        </technique_common>
      </source>
      ${verts('triuv-verts', 'triuv-pos')}
      <triangles count="1">
        <input semantic="VERTEX" source="#triuv-verts" offset="0"/>
        <input semantic="TEXCOORD" source="#triuv-uv" offset="1"/>
        <p>0 0 1 1 2 2</p>
      </triangles>
    </mesh>
  </geometry>`

/** 四边形（polylist + vcount=4） */
const GEO_QUAD = `
  <geometry id="quad-geo" name="Quad">
    <mesh>
      ${posSource('quad-pos', '0 0 0 1 0 0 1 1 0 0 1 0', 4)}
      ${verts('quad-verts', 'quad-pos')}
      <polylist count="1">
        <input semantic="VERTEX" source="#quad-verts" offset="0"/>
        <vcount>4</vcount>
        <p>0 1 2 3</p>
      </polylist>
    </mesh>
  </geometry>`

/** 五边形（polylist + vcount=5 → 需扇形三角化） */
const GEO_PENTA = `
  <geometry id="penta-geo" name="Penta">
    <mesh>
      ${posSource('penta-pos', '0 0 0 1 0 0 2 1 0 1 2 0 0 2 0', 5)}
      ${verts('penta-verts', 'penta-pos')}
      <polylist count="1">
        <input semantic="VERTEX" source="#penta-verts" offset="0"/>
        <vcount>5</vcount>
        <p>0 1 2 3 4</p>
      </polylist>
    </mesh>
  </geometry>`

/** 交错 stride=4 的位置 accessor（每 4 个取前 3 个） */
const GEO_INTERLEAVED = `
  <geometry id="il-geo" name="Interleaved">
    <mesh>
      <source id="il-pos">
        <float_array id="il-pos-arr" count="12">0 0 0 9 1 0 0 9 0 1 0 9</float_array>
        <technique_common>
          <accessor source="#il-pos-arr" count="3" stride="4">
            <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>
          </accessor>
        </technique_common>
      </source>
      ${verts('il-verts', 'il-pos')}
      <triangles count="1">
        <input semantic="VERTEX" source="#il-verts" offset="0"/>
        <p>0 1 2</p>
      </triangles>
    </mesh>
  </geometry>`

/** z 分量不为零的三角形（用于 up_axis 旋转断言） */
const GEO_Z = `
  <geometry id="z-geo" name="Z">
    <mesh>
      ${posSource('z-pos', '0 0 0 1 0 0 0 1 2', 3)}
      ${verts('z-verts', 'z-pos')}
      <triangles count="1">
        <input semantic="VERTEX" source="#z-verts" offset="0"/>
        <p>0 1 2</p>
      </triangles>
    </mesh>
  </geometry>`

/* ---------- 场景样本 ---------- */

const scene = (nodes: string): string =>
  `<library_visual_scenes><visual_scene id="Scene" name="Scene">${nodes}</visual_scene></library_visual_scenes>`

/** 单节点：平移 + 实例几何 */
const SCENE_TRANSLATE = scene(`
  <node id="n1" name="Node1" type="NODE">
    <translate>1 2 3</translate>
    <instance_geometry url="#tri-geo"/>
  </node>`)

/** 嵌套节点：父平移 + 子平移 + 实例几何 */
const SCENE_NESTED = scene(`
  <node id="outer" name="Outer" type="NODE">
    <translate>10 0 0</translate>
    <node id="inner" name="Inner" type="NODE">
      <translate>0 5 0</translate>
      <instance_geometry url="#tri-geo"/>
    </node>
  </node>`)

/** 含旋转的节点（触发整链烘焙） */
const SCENE_ROTATE = scene(`
  <node id="rot" name="Rot" type="NODE">
    <rotate>0 0 1 90</rotate>
    <instance_geometry url="#tri-geo"/>
  </node>`)

/* ---------- 断言工具 ---------- */

const codes = (downgrades: { code: string }[]): string[] => downgrades.map((d) => d.code)
type Doc = ReturnType<typeof daeToDocument>['doc']
const node = (doc: Doc, id: string): MeshNode | GroupNode => doc.nodes[id]! as MeshNode | GroupNode
const firstMesh = (doc: Doc): MeshNode => {
  const id = Object.keys(doc.nodes).find((k) => doc.nodes[k]!.type === 'mesh')
  return doc.nodes[id!] as MeshNode
}
/** 顶点按浮点容差比较（三角函数的 √2/2、sin 等带微小误差） */
const expectVertsClose = (actual: readonly number[][], expected: number[][]): void => {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((v, i) => v.forEach((c, j) => expect(c).toBeCloseTo(expected[i]![j]!, 9)))
}

describe('daeToDocument 导入', () => {
  it('最小 <triangles> → 单个 MeshNode，顶点池与面索引正确（无场景 → 平铺根 + info）', () => {
    const { doc, downgrades } = daeToDocument(collada(GEO_TRI, ''), {
      now: 1000,
      name: 'tri',
      fitToBox: false
    })
    expect(validateDocument(doc)).toEqual([])
    expect(doc.id).toBe('tri')
    expect(doc.format).toBe('free')
    expect(doc.root).toHaveLength(1)
    const mesh = firstMesh(doc)
    expect(mesh.type).toBe('mesh')
    expect(mesh.parent).toBeNull()
    expect(mesh.vertices).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0]
    ])
    expect(mesh.faces).toHaveLength(1)
    expect(mesh.faces[0]!.vertices).toEqual([0, 1, 2])
    expect(codes(downgrades)).toContain('dae_no_scene_flat')
    expect(codes(downgrades)).toContain('dae_no_uv')
  })

  it('TEXCOORD 逐角 UV → 像素坐标且 v 轴翻转（texSize 16）', () => {
    const { doc, downgrades } = daeToDocument(collada(GEO_TRI_UV, ''), {
      now: 1,
      textureSize: 16,
      fitToBox: false
    })
    expect(validateDocument(doc)).toEqual([])
    const face = firstMesh(doc).faces[0]!
    expect(face.vertices).toEqual([0, 1, 2])
    /* (0,0)→[0,16]；(1,0)→[16,16]；(0.5,1)→[8,0] */
    expect(face.uv).toEqual([
      [0, 16],
      [16, 16],
      [8, 0]
    ])
    expect(codes(downgrades)).not.toContain('dae_no_uv')
  })

  it('<polylist> + vcount=4 → 单个 4 顶点四边形面', () => {
    const { doc } = daeToDocument(collada(GEO_QUAD, ''), { now: 1, fitToBox: false })
    expect(validateDocument(doc)).toEqual([])
    const mesh = firstMesh(doc)
    expect(mesh.vertices).toHaveLength(4)
    expect(mesh.faces).toHaveLength(1)
    expect(mesh.faces[0]!.vertices).toEqual([0, 1, 2, 3])
    expect(mesh.faces[0]!.uv).toHaveLength(4)
  })

  it('<polylist> + vcount=5 → 扇形三角化成 3 个三角面 + warning', () => {
    const { doc, downgrades } = daeToDocument(collada(GEO_PENTA, ''), { now: 1, fitToBox: false })
    expect(validateDocument(doc)).toEqual([])
    const mesh = firstMesh(doc)
    expect(mesh.faces).toHaveLength(3)
    expect(mesh.faces.map((f) => f.vertices)).toEqual([
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 4]
    ])
    for (const f of mesh.faces) expect(f.vertices).toHaveLength(3)
    expect(codes(downgrades)).toContain('dae_polygon_fan_triangulated')
    expect(downgrades.some((d) => d.code === 'dae_polygon_fan_triangulated' && d.severity === 'warning')).toBe(true)
  })

  it('场景单节点 <translate> → GroupNode + 平移烘焙进顶点（父子一致）', () => {
    const { doc, downgrades } = daeToDocument(collada(GEO_TRI, SCENE_TRANSLATE), {
      now: 1,
      fitToBox: false
    })
    expect(validateDocument(doc)).toEqual([])
    expect(doc.root).toHaveLength(1)
    const group = node(doc, doc.root[0]!) as GroupNode
    expect(group.type).toBe('group')
    expect(group.name).toBe('Node1')
    expect(group.children).toHaveLength(1)
    const mesh = node(doc, group.children[0]!) as MeshNode
    expect(mesh.parent).toBe(group.id)
    /* 顶点 = 原几何 + 平移 (1,2,3) */
    expect(mesh.vertices).toEqual([
      [1, 2, 3],
      [2, 2, 3],
      [1, 3, 3]
    ])
    expect(codes(downgrades)).not.toContain('dae_transforms_baked')
  })

  it('嵌套 <node> → 嵌套 GroupNode，mesh 挂叶子组下且平移动量叠加', () => {
    const { doc } = daeToDocument(collada(GEO_TRI, SCENE_NESTED), { now: 1, fitToBox: false })
    expect(validateDocument(doc)).toEqual([])
    const outer = node(doc, doc.root[0]!) as GroupNode
    expect(outer.name).toBe('Outer')
    expect(outer.children).toHaveLength(1)
    const inner = node(doc, outer.children[0]!) as GroupNode
    expect(inner.type).toBe('group')
    expect(inner.name).toBe('Inner')
    expect(inner.parent).toBe(outer.id)
    expect(inner.children).toHaveLength(1)
    const mesh = node(doc, inner.children[0]!) as MeshNode
    expect(mesh.parent).toBe(inner.id)
    /* 平移 (10,0,0) + (0,5,0) = (10,5,0) */
    expect(mesh.vertices).toEqual([
      [10, 5, 0],
      [11, 5, 0],
      [10, 6, 0]
    ])
  })

  it('含 <rotate> 的节点 → 整链仿射烘焙进顶点 + info dae_transforms_baked', () => {
    const { doc, downgrades } = daeToDocument(collada(GEO_TRI, SCENE_ROTATE), {
      now: 1,
      fitToBox: false
    })
    expect(validateDocument(doc)).toEqual([])
    const mesh = firstMesh(doc)
    /* Rz(90°)：(x,y)→(−y,x) */
    expectVertsClose(mesh.vertices, [
      [0, 0, 0],
      [0, 1, 0],
      [-1, 0, 0]
    ])
    expect(codes(downgrades)).toContain('dae_transforms_baked')
    expect(downgrades.find((d) => d.code === 'dae_transforms_baked')!.severity).toBe('info')
  })

  it('<up_axis>Z_UP → 全局旋转使 +Y 向上（y 取原 z）', () => {
    const { doc, downgrades } = daeToDocument(collada(GEO_Z, '', 'Z_UP'), {
      now: 1,
      fitToBox: false
    })
    expect(validateDocument(doc)).toEqual([])
    const mesh = firstMesh(doc)
    /* Rx(−90°)：(x,y,z)→(x, z, −y) */
    expectVertsClose(mesh.vertices, [
      [0, 0, 0],
      [1, 0, 0],
      [0, 2, -1]
    ])
    expect(codes(downgrades)).toContain('dae_up_axis_converted')
  })

  it('交错 stride=4 的位置 accessor → 每 4 个取前 3 个', () => {
    const { doc } = daeToDocument(collada(GEO_INTERLEAVED, ''), { now: 1, fitToBox: false })
    expect(validateDocument(doc)).toEqual([])
    expect(firstMesh(doc).vertices).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0]
    ])
  })

  it('无几何 → dae_no_geometry warning 且返回空文档（不抛错）', () => {
    const { doc, downgrades } = daeToDocument(collada('', ''), { now: 1 })
    expect(validateDocument(doc)).toEqual([])
    expect(doc.root).toEqual([])
    expect(Object.keys(doc.nodes)).toHaveLength(0)
    expect(downgrades.some((d) => d.code === 'dae_no_geometry' && d.severity === 'warning')).toBe(true)
  })

  it('XML 结构非法（结束标签不匹配）→ 抛错', () => {
    expect(() => daeToDocument('<COLLADA><asset></COLLADA>')).toThrow(/不匹配/)
  })

  it('fitToBox 缺省归一化：顶点落进 0..16 且推 dae_scale_normalized', () => {
    const { doc, downgrades } = daeToDocument(collada(GEO_TRI, ''), { now: 1 })
    expect(codes(downgrades)).toContain('dae_scale_normalized')
    for (const v of firstMesh(doc).vertices) {
      for (const c of v) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(16)
      }
    }
  })

  it('每个产出文档均通过 validateDocument（合法树）', () => {
    for (const [geo, scn, up] of [
      [GEO_TRI, '', 'Y_UP'],
      [GEO_TRI_UV, '', 'Y_UP'],
      [GEO_QUAD, '', 'Y_UP'],
      [GEO_PENTA, '', 'Y_UP'],
      [GEO_INTERLEAVED, '', 'Y_UP'],
      [GEO_Z, '', 'Z_UP'],
      [GEO_TRI, SCENE_TRANSLATE, 'Y_UP'],
      [GEO_TRI, SCENE_NESTED, 'Y_UP'],
      [GEO_TRI, SCENE_ROTATE, 'Y_UP']
    ] as const) {
      const { doc } = daeToDocument(collada(geo, scn, up), { now: 1 })
      expect(validateDocument(doc)).toEqual([])
    }
  })
})
