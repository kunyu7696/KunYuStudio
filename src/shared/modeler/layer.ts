/**
 * 纹理层纯函数层（B2-2，v2）：文档层多层编辑源操作。
 *
 * 设计要点：
 * - 全部不可变更新：返回新文档对象，原文档不被修改（与 document.ts 同一惯例）；
 * - 层栈仅作编辑源，data 始终是像素唯一事实来源（导出/渲染/生成全部以 data 为准）；
 * - 层变更后由渲染层烘焙为单张 data 写回文档（本层不依赖 DOM，不做烘焙）；
 * - 空 layers 数组视为无层（回退单基层）。
 */
import type { ModelDocument, ModelTexture, ReferenceImage, TextureId, TextureLayer } from './types'
import { uid } from './document'

/* ------------------------------------------------------------------ */
/* 查询                                                                */
/* ------------------------------------------------------------------ */

/** 贴图有效层栈（空数组/未定义 → 回退单基层） */
export function effectiveLayers(tex: ModelTexture): TextureLayer[] {
  if (!tex.layers || tex.layers.length === 0) {
    return [
      {
        id: 'base',
        name: '基层',
        data: tex.data,
        visible: true,
        opacity: 1
      }
    ]
  }
  return tex.layers
}

/** 贴图是否有自定义层栈（排除回退单基层） */
export function hasCustomLayers(tex: ModelTexture): boolean {
  return !!tex.layers && tex.layers.length > 0
}

/* ------------------------------------------------------------------ */
/* 层 CRUD（全部不可变更新）                                            */
/* ------------------------------------------------------------------ */

/** 带元数据更新的返回（与 document.ts 同一惯例） */
function withMeta(doc: ModelDocument, now?: number): ModelDocument {
  return { ...doc, meta: { ...doc.meta, updatedAt: now ?? Date.now() } }
}

/** 更新贴图层栈并写回文档（内部）；空数组删除 layers 键保持 JSON 干净 */
function withLayers(
  doc: ModelDocument,
  texId: TextureId,
  layers: TextureLayer[] | undefined,
  now?: number
): ModelDocument {
  const tex = doc.textures[texId]
  if (!tex) return doc
  const next = { ...tex }
  if (layers && layers.length > 0) next.layers = layers
  else delete next.layers
  return withMeta({ ...doc, textures: { ...doc.textures, [texId]: next } }, now)
}

/**
 * 新建层（追加到栈顶），返回新层 id。
 * @param data 初始像素（缺省 = 空字符串，由渲染层首次烘焙时补齐）
 */
export function addLayer(
  doc: ModelDocument,
  texId: TextureId,
  options?: { name?: string; data?: string; now?: number }
): { doc: ModelDocument; layerId: string } {
  const tex = doc.textures[texId]
  if (!tex) return { doc, layerId: '' }
  const layers = effectiveLayers(tex)
  const id = uid('ly')
  const layer: TextureLayer = {
    id,
    name: options?.name?.trim() || `层 ${layers.length + 1}`,
    data: options?.data ?? '',
    visible: true,
    opacity: 1
  }
  return { doc: withLayers(doc, texId, [...layers, layer], options?.now), layerId: id }
}

/** 删除层（至少保留一层；回退单基层时删除转为清空） */
export function removeLayer(
  doc: ModelDocument,
  texId: TextureId,
  layerId: string,
  now?: number
): ModelDocument {
  const tex = doc.textures[texId]
  if (!tex) return doc
  const layers = effectiveLayers(tex)
  if (layers.length <= 1) {
    // 单基层：仅当 layerId 匹配基层时删除 = 清空 data
    if (layers[0]!.id !== layerId) return doc
    return withLayers(doc, texId, [
      { ...layers[0]!, data: '' }
    ], now)
  }
  const next = layers.filter((l) => l.id !== layerId)
  if (next.length === layers.length) return doc // 未知层 id 不动文档
  return withLayers(doc, texId, next.length > 1 ? next : undefined, now)
}

/** 更新层字段（名称/显隐/不透明度/像素）；未知 id 原样返回 */
export function patchLayer(
  doc: ModelDocument,
  texId: TextureId,
  layerId: string,
  patch: Partial<Pick<TextureLayer, 'name' | 'data' | 'visible' | 'opacity'>>,
  now?: number
): ModelDocument {
  const tex = doc.textures[texId]
  if (!tex) return doc
  const layers = effectiveLayers(tex)
  const idx = layers.findIndex((l) => l.id === layerId)
  if (idx < 0) return doc
  const next = layers.map((l, i) => (i === idx ? { ...l, ...patch } : l))
  return withLayers(doc, texId, next, now)
}

/** 层上移/下移（delta 为负向上、正向下；越界 clamp） */
export function moveLayer(
  doc: ModelDocument,
  texId: TextureId,
  layerId: string,
  delta: number,
  now?: number
): ModelDocument {
  const tex = doc.textures[texId]
  if (!tex) return doc
  const layers = effectiveLayers(tex)
  const idx = layers.findIndex((l) => l.id === layerId)
  if (idx < 0) return doc
  const nextIdx = Math.min(layers.length - 1, Math.max(0, idx + delta))
  if (nextIdx === idx) return doc
  const next = [...layers]
  const [layer] = next.splice(idx, 1)
  next.splice(nextIdx, 0, layer!)
  return withLayers(doc, texId, next, now)
}

/* ------------------------------------------------------------------ */
/* 参考图（B3-1）                                                      */
/* ------------------------------------------------------------------ */

/** 带元数据更新（参考图变更也走同一惯例） */
function withRefMeta(doc: ModelDocument, now?: number): ModelDocument {
  return { ...doc, meta: { ...doc.meta, updatedAt: now ?? Date.now() } }
}

/** 添加参考图（追加到列表末尾），返回新图 id */
export function addReferenceImage(
  doc: ModelDocument,
  input: { name: string; data: string; position?: [number, number, number]; size?: [number, number]; now?: number }
): { doc: ModelDocument; refId: string } {
  const id = uid('ref')
  const ref: ReferenceImage = {
    id,
    name: input.name.trim() || '参考图',
    data: input.data,
    position: input.position ?? [0, 0, 0],
    size: input.size ?? [16, 16],
    opacity: 1,
    visible: true
  }
  const next = [...(doc.referenceImages ?? []), ref]
  return { doc: withRefMeta({ ...doc, referenceImages: next }, input.now), refId: id }
}

/** 删除参考图（未知 id 原样返回） */
export function removeReferenceImage(doc: ModelDocument, refId: string, now?: number): ModelDocument {
  const next = (doc.referenceImages ?? []).filter((r) => r.id !== refId)
  if (next.length === (doc.referenceImages ?? []).length) return doc
  const d = { ...doc, referenceImages: next.length > 0 ? next : undefined }
  return withRefMeta(d, now)
}

/** 更新参考图字段（位置/尺寸/不透明度/可见性/名称）；未知 id 原样返回 */
export function patchReferenceImage(
  doc: ModelDocument,
  refId: string,
  patch: Partial<Pick<ReferenceImage, 'name' | 'position' | 'size' | 'opacity' | 'visible'>>,
  now?: number
): ModelDocument {
  const list = doc.referenceImages ?? []
  const idx = list.findIndex((r) => r.id === refId)
  if (idx < 0) return doc
  const next = list.map((r, i) => (i === idx ? { ...r, ...patch } : r))
  return withRefMeta({ ...doc, referenceImages: next }, now)
}
