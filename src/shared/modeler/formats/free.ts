/**
 * free 内部通用格式（方案 §4.1）：无任何游戏约束，文档即产物。
 * 导出 = 结构化克隆文档本身；导入 = 原样接收（校验由 document 层负责）。
 */
import type { ModelDocument } from '../types'
import type { FormatCapabilities, FormatDefinition } from './types'

export const FREE_CAPABILITIES: FormatCapabilities = {
  nodes: { cube: true, group: true, locator: true, mesh: true },
  textures: { multi: true, maxSize: 512, squareOnly: false },
  uv: { perFace: true, box: true, faceRotation: true },
  rotation: { mode: 'free' },
  coordinateRange: null,
  hierarchy: true,
  pivots: true,
  animations: true,
  display: false
}

export const freeFormat: FormatDefinition<ModelDocument, ModelDocument> = {
  id: 'free',
  name: '自由模型（内部）',
  capabilities: FREE_CAPABILITIES,
  exportDocument: (doc) => ({ output: structuredClone(doc), downgrades: [] }),
  importDocument: (input) => ({ doc: structuredClone(input), downgrades: [] })
}
