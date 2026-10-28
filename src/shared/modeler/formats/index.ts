/**
 * 格式注册表（方案 §4.1 formats/index.ts）。
 *
 * FormatId → FormatDefinition 的单一目录：UI 按 capabilities 开关约束提示，
 * 导出/导入统一经注册表分派。新格式（bedrock_entity / geckolib / bbmodel / obj）
 * 在对应阶段实现后注册进来，UI 与场景代码不需要再改。
 */
import type { FormatId, ModelDocument } from '../types'
import { bedrockFormat, bedrockBlockFormat } from './bedrock'
import { freeFormat } from './free'
import { geckolibFormat } from './geckolib'
import { javaBlockFormat, javaItemFormat } from './javaBlock'
import type { FormatDefinition, FormatDowngrade } from './types'

/** 注册表持有的擦除类型：具体格式的产物/输入类型在调用点由 FormatId 断言还原 */
type AnyFormatDefinition = FormatDefinition<any, any>

const registry = new Map<FormatId, AnyFormatDefinition>()

/** 注册格式（重复注册同 id 抛错，防止能力矩阵被静默覆盖） */
export function registerFormat(def: AnyFormatDefinition): void {
  if (registry.has(def.id)) throw new Error(`格式 ${def.id} 已注册`)
  registry.set(def.id, def)
}

/** 取格式定义；未注册抛错（调用方应先用 listFormats 做可用性判断） */
export function getFormat(id: FormatId): AnyFormatDefinition {
  const def = registry.get(id)
  if (!def) throw new Error(`格式 ${id} 未注册`)
  return def
}

/** 已注册格式清单（UI 格式切换器数据源） */
export function listFormats(): AnyFormatDefinition[] {
  return [...registry.values()]
}

/**
 * 格式切换预检（P3-c）：以目标格式 dry-run 导出当前文档，返回失损降级告警。
 * 不修改文档、不产生命令栈记录；格式无导出能力时返回空列表。
 */
export function previewFormatSwitch(doc: ModelDocument, target: FormatId): FormatDowngrade[] {
  const def = registry.get(target)
  if (!def || !def.exportDocument) return []
  return def.exportDocument(doc).downgrades
}

registerFormat(javaBlockFormat)
registerFormat(javaItemFormat)
registerFormat(freeFormat)
registerFormat(bedrockFormat)
registerFormat(bedrockBlockFormat)
registerFormat(geckolibFormat)

export type {
  EncodePixels,
  FormatCapabilities,
  FormatDefinition,
  FormatDowngrade,
  FormatExportResult,
  FormatImportResult,
  ResolvePixels
} from './types'
export { JAVA_BLOCK_CAPABILITIES, documentToModelAsset, modelAssetToDocument } from './javaBlock'
export {
  BEDROCK_CAPABILITIES,
  bedrockFormat,
  documentToGeo,
  geoToDocument
} from './bedrock'
export type { BedrockFormatData, BedrockGeoJson } from './bedrock'
export { GECKOLIB_CAPABILITIES, geckolibFormat } from './geckolib'
export { FREE_CAPABILITIES, freeFormat } from './free'
export { bbmodelToDocument, documentToBbmodel } from './bbmodel'
export type { BbmodelDocJson, BbmodelFormatData, BbmodelImportOptions } from './bbmodel'
export { objToDocument } from './obj'
export type { ObjImportInput, ObjImportOptions } from './obj'
export { documentToObj } from './obj'
export type { ObjExportOutput, ObjExportOptions } from './obj'
export { daeToDocument } from './dae'
export type { DaeImportOptions } from './dae'
export { fbxTextToDocument, parseFbxAscii } from './fbx'
export type { FbxImportOptions } from './fbx'
export { gltfToDocument } from './gltf'
export type { GltfImportOptions } from './gltf'
export { documentToJem, documentToJpm, jemToDocument, jpmToDocument } from './optifine'
export type {
  OptifineBoxJson,
  OptifineFormatData,
  OptifineImportOptions,
  OptifineJemJson,
  OptifineModelJson,
  OptifinePartJson
} from './optifine'
