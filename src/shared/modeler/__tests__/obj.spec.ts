/**
 * OBJ 导入编解码测试（P5-obj）。
 *
 * 核心不变量：
 * - 体素化产物正确落地为文档：立方体平铺、调色板贴图（EncodePixels 注入）、
 *   面 UV 指向调色板格、材质色 → 调色板颜色、formatData.obj 统计透传；
 * - 无 .mtl → info 告警 + 兜底色；无编码器 → 贴图缺失告警、面 UV 保留；
 * - 空网格/不封闭网格抛错；文档通过不变量校验。
 *
 * OBJ 导出（C8）：
 * - MeshNode → v/vt/f（索引从 1 开始，÷16 转米）；
 * - UV 翻 v：OBJ 左下原点 vs KunYu 左上原点；
 * - CubeNode 跳过（obj_cube_skipped info），GroupNode 扁平化（obj_group_flat info）；
 * - 无 MeshNode → warning + 空输出；
 * - 多 MeshNode 顶点/UV 全局偏移正确。
 */
import { describe, expect, it } from 'vitest'
import { validateDocument, addNode, createDocument, createCubeNode, createGroupNode, createMeshNode } from '../document'
import { objToDocument, documentToObj } from '../formats/obj'
import { defaultMeshGeometry } from '../mesh'
import type { CubeNode } from '../types'

const CUBE_OBJ = `mtllib cube.mtl
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
usemtl red
f 1 2 3 4
f 5 6 7 8
usemtl blue
f 1 2 6 5
f 4 3 7 8
f 1 4 8 5
f 2 3 7 6
`

const CUBE_MTL = `newmtl red
Kd 1 0 0
newmtl blue
Kd 0 0 1
`

const fakeEncode = (pixels: string[], w: number, h: number): string =>
  `data:fake;${w}x${h};${pixels.filter((p) => p !== '').join(',')}`

describe('objToDocument 导入', () => {
  it('体素立方体落地：调色板双色/贴图绑定/面 UV 范围/统计透传，文档通过不变量校验', () => {
    const { doc, downgrades } = objToDocument(
      { objText: CUBE_OBJ, mtlText: CUBE_MTL },
      { resolution: 8, encodePixels: fakeEncode, now: 1000, name: 'cube' }
    )
    expect(validateDocument(doc)).toEqual([])
    expect(downgrades).toEqual([])
    expect(doc.id).toBe('cube')
    expect(doc.format).toBe('free')
    expect(doc.settings.uvMode).toBe('per_face')

    /* 调色板贴图：恰好两色（red/blue） */
    const tex = Object.values(doc.textures)
    expect(tex).toHaveLength(1)
    expect(tex[0]!.width).toBe(32)
    expect(tex[0]!.uvSize).toEqual([32, 32])
    expect(tex[0]!.data.startsWith('data:fake;32x32;')).toBe(true)
    expect(tex[0]!.data.replace('data:fake;32x32;', '').split(',').sort()).toEqual(['#0000ff', '#ff0000'])

    /* 立方体：数量与统计一致；可见盒全部绑定调色板贴图，UV 在画布内
       （被同色邻接完全包围的合并盒无暴露面，保留以维持体素无损） */
    const stats = doc.formatData!.obj as { boxes: number; colors: number; voxels: number }
    expect(stats.colors).toBe(2)
    expect(stats.voxels).toBeGreaterThan(0)
    expect(doc.root).toHaveLength(stats.boxes)
    let faceTotal = 0
    for (const id of doc.root) {
      const cube = doc.nodes[id] as CubeNode
      expect(cube.type).toBe('cube')
      expect(cube.parent).toBeNull()
      faceTotal += Object.keys(cube.faces).length
      for (const face of Object.values(cube.faces)) {
        expect(face!.texture).toBe(tex[0]!.id)
        const [u1, v1, u2, v2] = face!.uv!
        expect(u1).toBeGreaterThanOrEqual(0)
        expect(v1).toBeGreaterThanOrEqual(0)
        expect(u2).toBeLessThanOrEqual(32)
        expect(v2).toBeLessThanOrEqual(32)
        // 调色板格 = 1×1
        expect(u2 - u1).toBe(1)
        expect(v2 - v1).toBe(1)
      }
      // 体素盒在 0..16 MC 空间内
      for (const n of [...cube.from, ...cube.to]) {
        expect(n).toBeGreaterThanOrEqual(0)
        expect(n).toBeLessThanOrEqual(16)
      }
    }
    expect(faceTotal).toBeGreaterThan(0)
  })

  it('无 .mtl → no_materials info + 单色兜底色', () => {
    const { doc, downgrades } = objToDocument(
      { objText: CUBE_OBJ },
      { resolution: 8, encodePixels: fakeEncode, now: 1 }
    )
    expect(downgrades.map((d) => d.code)).toContain('no_materials')
    const stats = doc.formatData!.obj as { colors: number }
    expect(stats.colors).toBe(1)
    expect(Object.values(doc.textures)[0]!.data).toContain('#8b8b8b')
  })

  it('无编码器 → texture_not_imported 告警，面 UV 保留且无贴图绑定', () => {
    const { doc, downgrades } = objToDocument(
      { objText: CUBE_OBJ, mtlText: CUBE_MTL },
      { resolution: 8, now: 1 }
    )
    expect(downgrades.map((d) => d.code)).toContain('texture_not_imported')
    expect(Object.keys(doc.textures)).toHaveLength(0)
    const cube = doc.nodes[doc.root[0]!] as CubeNode
    const face = Object.values(cube.faces)[0]!
    expect(face.uv).toBeDefined()
    expect(face.texture).toBeUndefined()
  })

  it('空网格抛错；id 清洗与 format 覆盖', () => {
    expect(() => objToDocument({ objText: 'v 0 0 0\nv 1 0 0\n' }, { now: 1 })).toThrow()
    const { doc } = objToDocument(
      { objText: CUBE_OBJ, mtlText: CUBE_MTL },
      { resolution: 8, encodePixels: fakeEncode, now: 1, id: '我的 模型!', format: 'java_block' }
    )
    expect(doc.id).toMatch(/^[A-Za-z0-9_-]+$/) // 非安全字符（含中文/空格）清洗为下划线
    expect(doc.format).toBe('java_block')
  })
})

/* ------------------------------------------------------------------ */
/* documentToObj 导出（C8）                                           */
/* ------------------------------------------------------------------ */

describe('documentToObj 导出', () => {
  /** 构造仅含单个 MeshNode 的干净文档 */
  function singleMeshDoc() {
    let doc = createDocument({ name: 'pyramid', format: 'free', now: 1000 })
    const mesh = createMeshNode('pyr', defaultMeshGeometry())
    doc = addNode(doc, mesh, null)
    return doc
  }

  it('最小 MeshNode → v/vt/f 索引从 1 开始，usemtl Default，f 格式 vi/vu', () => {
    const doc = singleMeshDoc()
    const { output } = documentToObj(doc)
    expect(output.objText).toContain('v ')
    expect(output.objText).toContain('vt ')
    expect(output.objText).toContain('f ')
    expect(output.objText).toContain('usemtl Default')
    // 5 顶点 + 18 UV（6 面 × 3 顶点）
    expect((output.objText!.match(/^v /gm) ?? []).length).toBe(5)
    expect((output.objText!.match(/^vt /gm) ?? []).length).toBe(18)
    // 面格式 vi/vu
    const firstF = output.objText!.split('\n').find((l) => l.startsWith('f '))!
    expect(firstF).toMatch(/^f \d+\/\d+ \d+\/\d+ \d+\/\d+$/)
    // 索引从 1 开始
    const nums = firstF.match(/\d+/g)!.map(Number)
    expect(Math.min(...nums)).toBeGreaterThanOrEqual(1)
    // mtl 有 Default 材质
    expect(output.mtlText).toContain('newmtl Default')
  })

  it('单位 ÷16：顶点 16 坐标 → v 输出 1.000000', () => {
    let doc = createDocument({ name: 'unit', format: 'free', now: 1 })
    const mesh = createMeshNode('m', {
      vertices: [[16, 0, 0], [0, 16, 0], [0, 0, 16]],
      faces: [{ vertices: [0, 1, 2], uv: [[0, 0], [0, 0], [0, 0]] }]
    })
    doc = addNode(doc, mesh, null)
    const { output } = documentToObj(doc)
    const vLines = output.objText!.split('\n').filter((l) => l.startsWith('v '))
    expect(vLines[0]).toContain('1.000000')
  })

  it('UV 翻 v：uv_px=(0,0) texSize=16 → vt=(0, 1)；uv_px=(16,16) → vt=(1, 0)', () => {
    let doc = createDocument({ name: 'uv-flip', format: 'free', now: 1 })
    const mesh = createMeshNode('m', {
      vertices: [[0, 0, 0], [16, 0, 0], [0, 16, 0]],
      faces: [{ vertices: [0, 1, 2], uv: [[0, 0], [16, 16], [16, 0]] }]
    })
    doc = addNode(doc, mesh, null)
    const { output } = documentToObj(doc)
    const vtLines = output.objText!.split('\n').filter((l) => l.startsWith('vt '))
    // uv_px (0,0) → vt_v = 1 - 0/16 = 1.0
    expect(vtLines[0]).toMatch(/vt 0\.000000 1\.000000/)
    // uv_px (16,16) → vt_v = 1 - 16/16 = 0.0
    expect(vtLines[1]).toMatch(/vt 1\.000000 0\.000000/)
  })

  it('空文档（无 MeshNode）→ warning obj_no_mesh + objText 仅含注释/无几何', () => {
    const doc = createDocument({ name: 'empty', format: 'free', now: 1 })
    const { output, downgrades } = documentToObj(doc)
    // 空文档仍输出文件头注释，但不含 v/vt/f
    expect(output.objText).not.toContain('\nv ')
    expect(output.objText).not.toContain('\nf ')
    const warningCodes = downgrades.map((d) => d.code)
    expect(warningCodes).toContain('obj_no_mesh')
  })

  it('只有 CubeNode → info 降级 obj_cube_skipped + objText 仅含注释', () => {
    let doc = createDocument({ name: 'cube-only', format: 'free', now: 1 })
    const cube = createCubeNode('c', { from: [0, 0, 0], to: [16, 16, 16] })
    doc = addNode(doc, cube, null)
    const { output, downgrades } = documentToObj(doc)
    expect(output.objText).not.toContain('\nv ')
    const codes = downgrades.map((d) => d.code)
    expect(codes).toContain('obj_cube_skipped')
    expect(codes).toContain('obj_no_mesh')
  })

  it('有 GroupNode → info 降级 obj_group_flat', () => {
    let doc = createDocument({ name: 'grp', format: 'free', now: 1 })
    const g = createGroupNode('g1')
    const mesh = createMeshNode('m', defaultMeshGeometry())
    doc = addNode(doc, g, null)
    doc = addNode(doc, mesh, g.id)
    const { downgrades } = documentToObj(doc)
    expect(downgrades.map((d) => d.code)).toContain('obj_group_flat')
  })

  it('多 MeshNode → 每个 o name 前缀 + 全局顶点/UV 偏移正确', () => {
    let doc = createDocument({ name: 'multi', format: 'free', now: 1 })
    const m1 = createMeshNode('first', defaultMeshGeometry())
    const m2 = createMeshNode('second', {
      vertices: [[0, 0, 0], [16, 0, 0], [0, 16, 0]],
      faces: [{ vertices: [0, 1, 2], uv: [[0, 0], [16, 16], [16, 0]] }]
    })
    doc = addNode(doc, m1, null)
    doc = addNode(doc, m2, null)
    const { output } = documentToObj(doc)
    expect(output.objText).toContain('o first')
    expect(output.objText).toContain('o second')
    // 总顶点 = 5 + 3 = 8
    expect((output.objText!.match(/^v /gm) ?? []).length).toBe(8)
    // 第一个面的索引应从 1 开始
    const firstF = output.objText!.split('\n').find((l) => l.startsWith('f '))!
    const firstIdx = firstF.match(/\d+/g)!.map(Number)
    expect(Math.min(...firstIdx)).toBeGreaterThanOrEqual(1)
  })

  it('四边面直接输出为 f v1/v1 v2/v2 v3/v3 v4/v4（OBJ 原生支持）', () => {
    let doc = createDocument({ name: 'quad', format: 'free', now: 1 })
    const mesh = createMeshNode('m', {
      vertices: [[0, 0, 0], [16, 0, 0], [16, 16, 0], [0, 16, 0]],
      faces: [{ vertices: [0, 1, 2, 3], uv: [[0, 0], [16, 0], [16, 16], [0, 16]] }]
    })
    doc = addNode(doc, mesh, null)
    const { output, downgrades } = documentToObj(doc)
    const fLine = output.objText!.split('\n').find((l) => l.startsWith('f '))!
    const nums = fLine.match(/\d+/g)!
    // 4 个顶点索引 + 4 个 UV 索引 = 8 个数字
    expect(nums).toHaveLength(8)
    // 不是三角扇展开（无 obj_face_triangulated）
    expect(downgrades.map((d) => d.code)).not.toContain('obj_face_triangulated')
  })

  it('五顶点面 → info obj_face_triangulated + 三角扇展开', () => {
    let doc = createDocument({ name: 'pentagon', format: 'free', now: 1 })
    const mesh = createMeshNode('m', {
      vertices: [[0, 0, 0], [16, 0, 0], [16, 16, 0], [0, 16, 0], [8, 24, 0]],
      faces: [{
        vertices: [0, 1, 2, 3, 4],
        uv: [[0, 0], [16, 0], [16, 16], [0, 16], [8, 8]]
      }]
    })
    doc = addNode(doc, mesh, null)
    const { output, downgrades } = documentToObj(doc)
    expect(downgrades.map((d) => d.code)).toContain('obj_face_triangulated')
    // 五顶点 → 3 个三角面（三角扇）
    const fLines = output.objText!.split('\n').filter((l) => l.startsWith('f '))
    expect(fLines).toHaveLength(3)
  })

  it('output.objText + output.mtlText 均有值且 mtl 含 Ka/Kd/Ks/Ns/d', () => {
    const doc = singleMeshDoc()
    const { output } = documentToObj(doc)
    expect(output.objText!.length).toBeGreaterThan(0)
    expect(output.mtlText!.length).toBeGreaterThan(0)
    expect(output.mtlText).toContain('Ka')
    expect(output.mtlText).toContain('Kd')
    expect(output.mtlText).toContain('Ks')
    expect(output.mtlText).toContain('Ns')
    expect(output.mtlText).toContain('d ')
  })
})
