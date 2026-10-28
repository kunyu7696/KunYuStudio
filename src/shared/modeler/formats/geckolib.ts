/**
 * GeckoLib 实体几何格式（方案 §4.7，P3-b 薄壳）。
 *
 * GeckoLib 读取 Bedrock 1.12.0 geo.json，几何编码与 bedrock_entity 完全同构，
 * 因此直接复用同一 codec 与 formatData（bedrock 键），仅在注册表中以独立
 * id/名称存在，供 GeckoLib 实体链路（P3-f）按格式名分派。
 *
 * identifier 约定：GeckoLib 客户端定义按 `geometry.<name>` 引用模型；
 * 导出缺省 identifier 与 bedrock_entity 相同（`geometry.<doc.id>`），
 * 导入时不改写文件里已有的 identifier。
 */
import type { BedrockGeoJson } from './bedrock'
import { BEDROCK_CAPABILITIES, documentToGeo, geoToDocument } from './bedrock'
import type { FormatCapabilities, FormatDefinition } from './types'

export const GECKOLIB_CAPABILITIES: FormatCapabilities = { ...BEDROCK_CAPABILITIES }

export const geckolibFormat: FormatDefinition<BedrockGeoJson, string | BedrockGeoJson> = {
  id: 'geckolib',
  name: 'GeckoLib 实体几何',
  capabilities: GECKOLIB_CAPABILITIES,
  exportDocument: (doc) => documentToGeo(doc),
  importDocument: (input) => geoToDocument(input as string | BedrockGeoJson, { format: 'geckolib' })
}
