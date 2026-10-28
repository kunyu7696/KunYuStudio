/**
 * FBX（ASCII）导入编解码测试（P5-fbx）。
 *
 * 核心不变量：
 * - 最小 ASCII FBX 落地为 MeshNode：共享顶点池 + 面索引正确；
 * - PolygonVertexIndex 负值闭合解码（四边形）；
 * - >4 顶点多边形扇形三角化 + warning；
 * - LayerElementUV 逐多边形角 / 逐控制点两种映射 → 像素 UV（v 轴翻转）；
 * - 无 UV 层 → fbx_no_uv + 对角线兜底；
 * - 无几何 → fbx_no_geometry warning（不抛错）；二进制 FBX → 抛错；
 * - 每个产出文档通过 validateDocument（合法树）；
 * - fitToBox 归一化 → 顶点落进 0..16 且 info 降级。
 */
import { describe, expect, it } from 'vitest'
import { validateDocument } from '../document'
import { fbxTextToDocument } from '../formats/fbx'
import type { MeshNode } from '../types'

/* 最小 ASCII FBX：单三角面 Geometry，无 UV 层 */
const MIN_TRI = `; FBX 7.4.0 project file
FBXHeaderExtension:  {
	FBXHeaderVersion: 1003
	FBXVersion: 7400
}
Objects:  {
	Geometry: 100, "Geometry::Tri", "Mesh" {
		Vertices: *9 {
			a: 0,0,0,1,0,0,0,1,0
		}
		PolygonVertexIndex: *3 {
			a: 0,1,-3
		}
	}
}
`

/* 四边形：PolygonVertexIndex 末位 -4 表示闭合到顶点 3 */
const QUAD = `Objects:  {
	Geometry: 1, "Geometry::Quad", "Mesh" {
		Vertices: *12 {
			a: 0,0,0,1,0,0,1,1,0,0,1,0
		}
		PolygonVertexIndex: *4 {
			a: 0,1,2,-4
		}
	}
}
`

/* 五边形：需扇形三角化 */
const PENTA = `Objects:  {
	Geometry: 3, "Geometry::Penta", "Mesh" {
		Vertices: *15 {
			a: 0,0,0,1,0,0,2,1,0,1,2,0,0,2,0
		}
		PolygonVertexIndex: *5 {
			a: 0,1,2,3,-5
		}
	}
}
`

/* 逐多边形角 UV（ByPolygonVertex + IndexToDirect） */
const UV_BY_POLY_VERTEX = `Objects:  {
	Geometry: 2, "Geometry::Plane", "Mesh" {
		Vertices: *12 {
			a: 0,0,0,1,0,0,1,1,0,0,1,0
		}
		PolygonVertexIndex: *4 {
			a: 0,1,2,-4
		}
		LayerElementUV: 0 {
			Version: 101
			Name: "UVChannel_1"
			MappingInformationType: "ByPolygonVertex"
			ReferenceInformationType: "IndexToDirect"
			UV: *8 {
				a: 0,0,1,0,1,1,0,1
			}
			UVIndex: *4 {
				a: 0,1,2,3
			}
		}
	}
}
`

/* 逐控制点 UV（ByControlPoint + IndexToDirect） */
const UV_BY_CONTROL_POINT = `Objects:  {
	Geometry: 4, "Geometry::PlaneCP", "Mesh" {
		Vertices: *12 {
			a: 0,0,0,1,0,0,1,1,0,0,1,0
		}
		PolygonVertexIndex: *4 {
			a: 0,1,2,-4
		}
		LayerElementUV: 0 {
			Version: 101
			Name: "UVChannel_1"
			MappingInformationType: "ByControlPoint"
			ReferenceInformationType: "IndexToDirect"
			UV: *8 {
				a: 0,0,0.5,0,0.5,1,0,1
			}
			UVIndex: *4 {
				a: 0,1,2,3
			}
		}
	}
}
`

/* 无几何：仅一个空 Model */
const NO_GEO = `Objects:  {
	Model: 0, "Model::Empty", "Mesh" {
		Version: 232
	}
}
`

/* 大尺寸三角面（用于归一化断言） */
const BIG_TRI = `Objects:  {
	Geometry: 7, "Geometry::Big", "Mesh" {
		Vertices: *9 {
			a: 0,0,0,100,0,0,0,50,0
		}
		PolygonVertexIndex: *3 {
			a: 0,1,-3
		}
	}
}
`

const codes = (downgrades: { code: string }[]): string[] => downgrades.map((d) => d.code)

const firstMesh = (doc: ReturnType<typeof fbxTextToDocument>['doc']): MeshNode =>
  doc.nodes[doc.root[0] as string] as MeshNode

describe('fbxTextToDocument 导入', () => {
  it('最小 ASCII FBX → 单个 MeshNode，顶点池与面索引正确', () => {
    const { doc, downgrades } = fbxTextToDocument(MIN_TRI, { now: 1000, name: 'tri' })
    expect(validateDocument(doc)).toEqual([])
    expect(doc.id).toBe('tri')
    expect(doc.format).toBe('free')
    expect(doc.root).toHaveLength(1)
    const mesh = firstMesh(doc)
    expect(mesh.type).toBe('mesh')
    expect(mesh.parent).toBeNull()
    expect(mesh.vertices).toHaveLength(3)
    expect(mesh.faces).toHaveLength(1)
    expect(mesh.faces[0]!.vertices).toEqual([0, 1, 2])
    expect(codes(downgrades)).toContain('fbx_no_uv')
  })

  it('二进制 FBX 头 → 抛错', () => {
    const binLike = `Kaydara FBX Binary  \u0000\u001a\u0000` + '\u0001\u0002garbage'
    expect(() => fbxTextToDocument(binLike)).toThrow()
    expect(() => fbxTextToDocument(binLike)).toThrow(/二进制 FBX 暂不支持/)
  })

  it('PolygonVertexIndex 负值解码：[0,1,2,-4] → 四边形面顶点 0,1,2,3', () => {
    const { doc } = fbxTextToDocument(QUAD, { now: 1 })
    expect(validateDocument(doc)).toEqual([])
    const mesh = firstMesh(doc)
    expect(mesh.vertices).toHaveLength(4)
    expect(mesh.faces).toHaveLength(1)
    expect(mesh.faces[0]!.vertices).toEqual([0, 1, 2, 3])
  })

  it('四边形 → 单个 4 顶点面；五边形 → 扇形三角化成 3 个三角面 + warning', () => {
    const quad = fbxTextToDocument(QUAD, { now: 1 })
    expect(quad.doc.root).toHaveLength(1)
    expect(firstMesh(quad.doc).faces[0]!.vertices).toHaveLength(4)

    const penta = fbxTextToDocument(PENTA, { now: 1 })
    expect(validateDocument(penta.doc)).toEqual([])
    const mesh = firstMesh(penta.doc)
    expect(mesh.vertices).toHaveLength(5)
    expect(mesh.faces).toHaveLength(3)
    for (const f of mesh.faces) expect(f.vertices).toHaveLength(3)
    expect(codes(penta.downgrades)).toContain('fbx_polygon_fan_triangulated')
  })

  it('UV ByPolygonVertex + IndexToDirect → 逐角像素 UV（v 轴翻转，贴图 16）', () => {
    const { doc, downgrades } = fbxTextToDocument(UV_BY_POLY_VERTEX, {
      now: 1,
      textureSize: 16
    })
    expect(validateDocument(doc)).toEqual([])
    const mesh = firstMesh(doc)
    const face = mesh.faces[0]!
    expect(face.vertices).toEqual([0, 1, 2, 3])
    /* (0,0)→[0,16]；(1,0)→[16,16]；(1,1)→[16,0]；(0,1)→[0,0] */
    expect(face.uv).toEqual([
      [0, 16],
      [16, 16],
      [16, 0],
      [0, 0]
    ])
    expect(codes(downgrades)).not.toContain('fbx_no_uv')
  })

  it('UV ByControlPoint → 按顶点索引取 UV', () => {
    const { doc } = fbxTextToDocument(UV_BY_CONTROL_POINT, { now: 1, textureSize: 16 })
    expect(validateDocument(doc)).toEqual([])
    const face = firstMesh(doc).faces[0]!
    /* UV 池：(0,0)(0.5,0)(0.5,1)(0,1)；按顶点索引取 → 像素坐标 v 翻转 */
    expect(face.uv).toEqual([
      [0, 16],
      [8, 16],
      [8, 0],
      [0, 0]
    ])
  })

  it('无 LayerElementUV → fbx_no_uv 且 UV 按对角线兜底展开', () => {
    const { doc, downgrades } = fbxTextToDocument(MIN_TRI, { now: 1, textureSize: 16 })
    expect(codes(downgrades)).toContain('fbx_no_uv')
    const face = firstMesh(doc).faces[0]!
    /* 3 个角 → 0..16 对角线：0、8、16 */
    expect(face.uv).toEqual([
      [0, 0],
      [8, 8],
      [16, 16]
    ])
  })

  it('无几何 → fbx_no_geometry warning 且返回空文档（不抛错）', () => {
    const { doc, downgrades } = fbxTextToDocument(NO_GEO, { now: 1 })
    expect(validateDocument(doc)).toEqual([])
    expect(doc.root).toEqual([])
    expect(Object.keys(doc.nodes)).toHaveLength(0)
    expect(codes(downgrades)).toContain('fbx_no_geometry')
    expect(downgrades.some((d) => d.code === 'fbx_no_geometry' && d.severity === 'warning')).toBe(
      true
    )
  })

  it('每个产出文档均通过 validateDocument（合法树）', () => {
    for (const sample of [MIN_TRI, QUAD, PENTA, UV_BY_POLY_VERTEX, UV_BY_CONTROL_POINT, NO_GEO, BIG_TRI]) {
      const { doc } = fbxTextToDocument(sample, { now: 1 })
      expect(validateDocument(doc)).toEqual([])
    }
  })

  it('fitToBox 归一化：顶点落进 0..16 且推 fbx_scale_normalized', () => {
    const { doc, downgrades } = fbxTextToDocument(BIG_TRI, { now: 1 })
    expect(codes(downgrades)).toContain('fbx_scale_normalized')
    const mesh = firstMesh(doc)
    for (const v of mesh.vertices) {
      for (const c of v) {
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(16)
      }
    }
    /* 最长轴 100 → 缩放 0.16：x=100 → 16 */
    expect(mesh.vertices[1]).toEqual([16, 0, 0])
  })

  it('fitToBox:false → 坐标保持原样且不推 fbx_scale_normalized', () => {
    const { doc, downgrades } = fbxTextToDocument(BIG_TRI, { now: 1, fitToBox: false })
    expect(codes(downgrades)).not.toContain('fbx_scale_normalized')
    expect(firstMesh(doc).vertices).toEqual([
      [0, 0, 0],
      [100, 0, 0],
      [0, 50, 0]
    ])
  })
})
