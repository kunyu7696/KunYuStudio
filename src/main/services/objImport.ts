/**
 * OBJ 导入 → 体素化 → 语义模型资产（建模工坊 B2）。
 *
 * 主进程职责：读 .obj 与同目录 .mtl（mtllib 指定，找不到不报错，走兜底色），
 * 调共享纯函数 voxelizeObj，归一化校验后 saveContent 落盘，供统一编辑器嵌入。
 */
import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parseObj, voxelizeObj, type VoxelizeOptions } from '../../shared/utils/objVoxelize'
import { normalizeModelSchema, validateModelSchema } from '../../shared/schemas/model.schema'
import type { ModelAsset } from '../../shared/types/content'
import { saveContent } from './contentService'

export interface ObjImportOutcome {
  id: string
  model: ModelAsset
  warnings: string[]
  mtlLoaded: boolean
}

/** 从 OBJ 文本提取 mtllib 文件名（取第一个；模型工坊 OBJ 导入对话框复用） */
export function findMtlReference(objText: string): string | null {
  for (const line of objText.split(/\r?\n/)) {
    const m = /^\s*mtllib\s+(.+?)\s*$/i.exec(line)
    if (m) return m[1]
  }
  return null
}

/**
 * @param root 项目根
 * @param filePath 用户选择的 .obj 绝对路径
 * @param id 模型资产 id（取当前活动对象 id）
 */
export function importObjAsModel(
  root: string,
  filePath: string,
  id: string,
  options: VoxelizeOptions = {}
): ObjImportOutcome {
  const objText = readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')

  // 材质：优先 mtllib 同目录同名引用；缺失时静默兜底（模型仍可导入）
  let mtlText: string | undefined
  let mtlLoaded = false
  const mtlName = findMtlReference(objText)
  const candidates = mtlName ? [join(dirname(filePath), basename(mtlName))] : []
  // 常见约定：同名 .mtl
  candidates.push(filePath.replace(/\.obj$/i, '.mtl'))
  for (const candidate of candidates) {
    try {
      mtlText = readFileSync(candidate, 'utf-8')
      mtlLoaded = true
      break
    } catch {
      /* 试下一个候选 */
    }
  }

  const mesh = parseObj(objText, mtlText)
  const result = voxelizeObj(mesh, options)

  const model: ModelAsset = {
    kind: 'model',
    id,
    displayName: id,
    description: `OBJ 体素化导入（${basename(filePath)}）`,
    textureSize: result.model.textureSize,
    pixels: result.model.pixels,
    textures: { all: `textures/model/${id}.png` },
    elements: result.model.elements,
    ambientOcclusion: true,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  const normalized = normalizeModelSchema(model)
  const error = validateModelSchema(normalized)
  if (error) throw new Error(`体素模型校验失败：${error}`)
  saveContent(root, normalized)

  const warnings = [...result.warnings]
  if (!mtlLoaded) warnings.push('未找到 .mtl 材质文件（或 OBJ 未声明 mtllib），已使用统一兜底色')
  return { id, model: normalized, warnings, mtlLoaded }
}
