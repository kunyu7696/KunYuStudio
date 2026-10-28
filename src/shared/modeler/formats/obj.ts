/**
 * OBJ 导入编解码（方案 §4.1 formats/obj.ts，P5-obj）。
 *
 * 与旧 src/main/services/objImport.ts 的关系：旧链路是「内容管线一次性体素化」
 * （OBJ → ModelAsset 直接落盘，不可编辑）；本模块是「建模器文档层导入」——
 * 同一套自研体素化算法（shared/utils/objVoxelize）的产物改组装为 ModelDocument，
 * 在模型工坊可继续编辑（调分辨率重做、改 UV、换格式导出）。
 *
 * 管线：parseObj/parseMtl（v/vn/vt/f、usemtl/Kd）→ voxelizeObj（归一化 0..16、
 * 射线奇偶 inside、六向最近表面上色、同色合并 AABB、调色板 1×1 像素 UV）
 * → CubeNode 平铺 + 单张调色板贴图（EncodePixels 注入编码 PNG data URL）。
 *
 * OBJ 是单向导入格式（文档化子集不含 mesh，导出 OBJ 后续阶段评估）。
 */
import { MODELER_EDITOR_VERSION } from '../document'
import { isMeshNode } from '../types'
import type { CubeNode, FormatId, ModelDocument, ModelTexture, NodeId } from '../types'
import { FACE_NAMES } from '../types'
import { parseObj, voxelizeObj } from '../../utils/objVoxelize'
import type { FaceUv } from '../../types/content'
import type {
  EncodePixels,
  FormatDowngrade,
  FormatExportResult,
  FormatImportResult
} from './types'

export interface ObjImportInput {
  /** .obj 文件原文 */
  objText: string
  /** .mtl 文件原文（缺省 = 全部兜底色并 info 告警） */
  mtlText?: string
}

export interface ObjImportOptions {
  /** 最长轴体素分辨率（8..32，默认 16） */
  resolution?: number
  /** 覆盖文档 format 标记（缺省 free：OBJ 无游戏约束） */
  format?: FormatId
  /** 覆盖文档 id（缺省取 name/缺省 'obj_model' 清洗） */
  id?: string
  /** 文档显示名（缺省同 id） */
  name?: string
  /** 注入：调色板像素串 → 贴图 data URL（缺省时贴图无像素并告警，面 UV 保留） */
  encodePixels?: EncodePixels
  /** 注入：固定 meta 时间戳（测试确定性） */
  now?: number
}

function safeIdPart(raw: string, fallback: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_-]/g, '_')
  return s.length > 0 ? s : fallback
}

/**
 * OBJ → ModelDocument。空网格/不封闭网格/调色板溢出抛错（调用方按软失败展示）。
 */
export function objToDocument(
  input: ObjImportInput,
  options?: ObjImportOptions
): FormatImportResult {
  const mesh = parseObj(input.objText, input.mtlText)
  const result = voxelizeObj(mesh, { resolution: options?.resolution })
  const downgrades: FormatDowngrade[] = []

  if (!input.mtlText) {
    downgrades.push({
      severity: 'info',
      code: 'no_materials',
      message: '未提供 .mtl 材质（或 OBJ 未声明 mtllib），全部体素使用统一兜底色'
    })
  }
  for (const w of result.warnings) {
    downgrades.push({ severity: 'warning', code: 'voxelize_warning', message: w })
  }

  const now = options?.now ?? Date.now()
  const docId = safeIdPart(options?.id ?? options?.name ?? '', 'obj_model') || 'obj_model'
  const size = result.model.textureSize

  /* 调色板贴图（无编码器时保留 UV、不绑贴图，与 javaBlock 导入同策略） */
  const textures: Record<string, ModelTexture> = {}
  let texId: string | undefined
  if (options?.encodePixels) {
    const tex: ModelTexture = {
      id: `tex_${docId}`,
      name: 'palette',
      width: size,
      height: size,
      data: options.encodePixels(result.model.pixels, size, size),
      uvSize: [size, size],
      visible: true
    }
    textures[tex.id] = tex
    texId = tex.id
  } else {
    downgrades.push({
      severity: 'warning',
      code: 'texture_not_imported',
      message: '缺少像素编码器，调色板贴图未导入（面 UV 保留，贴图绑定为空）'
    })
  }

  /* 体素盒 → 立方体节点（顶层平铺；v1 OBJ 导入不建组） */
  const nodes: Record<NodeId, CubeNode> = {}
  const root: NodeId[] = []
  result.model.elements.forEach((el, i) => {
    const id = `voxel_${i + 1}`
    const faces: CubeNode['faces'] = {}
    for (const face of FACE_NAMES) {
      const f = el.faces[face]
      if (!f) continue
      faces[face] = {
        uv: [...f.uv] as FaceUv,
        ...(texId ? { texture: texId } : {})
      }
    }
    nodes[id] = {
      id,
      type: 'cube',
      name: el.name ?? `voxel_${i + 1}`,
      parent: null,
      visible: true,
      locked: false,
      from: [...el.from],
      to: [...el.to],
      origin: [8, 8, 8],
      rotation: [0, 0, 0],
      faces
    }
    root.push(id)
  })

  const doc: ModelDocument = {
    schemaVersion: 1,
    id: docId,
    name: options?.name || docId,
    format: options?.format ?? 'free',
    settings: { uvMode: 'per_face', textureSize: [size, size] },
    nodes,
    root,
    textures,
    animations: {},
    formatData: {
      obj: {
        resolution: result.stats.grid,
        voxels: result.stats.voxels,
        boxes: result.stats.boxes,
        colors: result.stats.colors
      }
    },
    meta: { createdAt: now, updatedAt: now, editorVersion: MODELER_EDITOR_VERSION }
  }
  return { doc, downgrades }
}

/* ================================================================== */
/* 导出：ModelDocument → .obj + .mtl（C8 OBJ export）                 */
/* ================================================================== */

/**
 * OBJ 导出产物：两个文本文件（.obj 几何 + .mtl 材质）。
 * 与 documentToGltf 同范式：文档单位 ÷16 = 米。
 */
export interface ObjExportOutput {
  /** .obj 几何文件原文 */
  objText: string
  /** .mtl 材质文件原文（所有材质统一 Default；OBJ 材质远简单于 Minecraft） */
  mtlText: string
}

export interface ObjExportOptions {
  /** 注入 meta 时间戳（测试确定性） */
  now?: number
}

/**
 * ModelDocument → OBJ .obj + .mtl 文本（C8 OBJ export）。
 *
 * 实现子集：
 *   - MeshNode → v/vt/f（mesh 顶点 ÷16 = 米，UV 像素 ÷ texSize 后翻 v 适配 OBJ 左下原点）；
 *   - CubeNode → info 降级跳过（OBJ 无 Box 原语，展平为 12 三角留给后续版本）；
 *   - GroupNode 变换 → **info 降级跳过**（MeshNode 顶点是父空间，OBJ 无层级）；
 *   - 材质：所有三角统一 Default 材质（OBJ 材质系统与 Minecraft 差异大）。
 *
 * 坐标系：OBJ Y 向上（与 KunYu 一致）；OBJ UV (0,0) 左下 vs KunYu (0,0) 左上，
 *  导出时翻 v：vt_v = 1 - (uv_px / texSize)。
 */
export function documentToObj(
  doc: ModelDocument,
  options?: ObjExportOptions
): FormatExportResult<ObjExportOutput> {
  void options // 保留参数签名一致性

  const downgrades: FormatDowngrade[] = []
  const lines: string[] = []

  /* ---- 头 ---- */
  lines.push(`# KunYu OBJ Export`)
  lines.push(`# From: ${doc.name} (${doc.id})`)
  lines.push(`# Format: ${doc.format}`)
  lines.push(`# Export unit: meters (doc units / 16)`)
  lines.push('mtllib model.mtl')
  lines.push('')

  /* ---- 收集所有 MeshNode ---- */
  /* ---- CubeNode → info 降级 ---- */
  const cubeNodes = Object.values(doc.nodes).filter((n) => n.type === 'cube')
  if (cubeNodes.length > 0) {
    downgrades.push({
      severity: 'info',
      code: 'obj_cube_skipped',
      message: `${cubeNodes.length} 个 CubeNode 未导出（OBJ 无 Box 原语，展平为 12 三角留给后续版本）`
    })
  }

  /* ---- 有 GroupNode 层级 → info 降级 ---- */
  const groupNodes = Object.values(doc.nodes).filter((n) => n.type === 'group')
  if (groupNodes.length > 0) {
    downgrades.push({
      severity: 'info',
      code: 'obj_group_flat',
      message: `${groupNodes.length} 个 GroupNode 变换未烘焙（OBJ 无层级，MeshNode 顶点视为世界空间）`
    })
  }

  const meshNodes = Object.values(doc.nodes).filter(isMeshNode)
  if (meshNodes.length === 0) {
    downgrades.push({
      severity: 'warning',
      code: 'obj_no_mesh',
      message: '文档无 MeshNode，OBJ 输出为空（CubeNode 不支持）'
    })
    return {
      downgrades,
      output: { objText: lines.join('\n') + '\n', mtlText: defaultMtl() }
    }
  }

  /* ---- 单位常量 ---- */
  const UNIT = 1 / 16

  /* ---- 烘焙所有 mesh 顶点 + UV + 面 ---- */
  let vertexOffset = 0 // OBJ 顶点全局偏移（从 1 开始）
  let uvOffset = 0
  const meshLines: string[] = []

  for (const mesh of meshNodes) {
    meshLines.push(`o ${mesh.name || mesh.id}`)

    /* 顶点输出（MeshNode.vertices 是父空间坐标，直接 ÷16 转米） */
    for (const v of mesh.vertices) {
      meshLines.push(`v ${(v[0]! * UNIT).toFixed(6)} ${(v[1]! * UNIT).toFixed(6)} ${(v[2]! * UNIT).toFixed(6)}`)
    }

    /* UV 输出（翻 v：OBJ 左下 vs KunYu 左上）
       像素坐标 → 0..1 的 uv_size 需要从 face.texture 引用的贴图拿到 */
    const defaultTexSize = doc.settings?.textureSize ?? [16, 16]
    const getTexSize = (texId?: string): [number, number] => {
      if (texId && doc.textures[texId]) {
        const t = doc.textures[texId]!
        return [t.width, t.height]
      }
      return defaultTexSize as [number, number]
    }
    for (const face of mesh.faces) {
      const [texW, texH] = getTexSize(face.texture)
      for (const uv of face.uv) {
        const u = uv[0]! / texW
        const v = 1 - uv[1]! / texH // OBJ (0,0)=左下，KunYu (0,0)=左上
        meshLines.push(`vt ${u.toFixed(6)} ${v.toFixed(6)}`)
      }
    }

    /* 面输出（OBJ 索引从 1 开始） */
    meshLines.push('usemtl Default')
    let uvIdx = uvOffset
    for (const face of mesh.faces) {
      /* OBJ 原生支持三角/四边面；>4 顶点降级为三角 fan（info 告警） */
      const verts = face.vertices
      if (verts.length > 4) {
        downgrades.push({
          severity: 'info',
          code: 'obj_face_triangulated',
          message: `MeshNode ${mesh.name || mesh.id} 有 ${verts.length} 顶点面，OBJ 只支持三角/四边，已三角扇形展开`
        })
        // 三角扇：[0, 1, 2], [0, 2, 3], ..., [0, n-2, n-1]
        const n = verts.length
        for (let i = 1; i < n - 1; i++) {
          const tri = [verts[0]!, verts[i]!, verts[i + 1]!]
          const f = tri.map((vi) => `${vi + vertexOffset + 1}/${uvIdx + vi + 1}`).join(' ')
          meshLines.push(`f ${f}`)
        }
      } else {
        // 三角面或四边面直接输出
        const f = verts.map((vi) => `${vi + vertexOffset + 1}/${uvIdx + vi + 1}`).join(' ')
        meshLines.push(`f ${f}`)
      }
      uvIdx += face.uv.length
    }

    vertexOffset += mesh.vertices.length
    uvOffset += mesh.faces.reduce((s, f) => s + f.uv.length, 0)
  }

  lines.push(...meshLines)
  lines.push('')

  return {
    downgrades,
    output: { objText: lines.join('\n') + '\n', mtlText: defaultMtl() }
  }
}

function defaultMtl(): string {
  return [
    '# OBJ Default Material',
    'newmtl Default',
    'Ka 0.2 0.2 0.2',
    'Kd 0.8 0.8 0.8',
    'Ks 0.0 0.0 0.0',
    'Ns 1.0',
    'd 1.0',
    ''
  ].join('\n')
}
