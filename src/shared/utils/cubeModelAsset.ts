/**
 * 内嵌 Cube 模型 ↔ 独立 ModelAsset 组装（画廊模型条目预览 / 送进工坊 / 写回对象共用）。
 *
 * 两种几何来源：
 * - 独立模型资产（ownerKind === 'model'）：内容本身就是 ModelAsset；
 * - 对象内嵌 Cube 模型（方块/物品 model.cubeModel、实体 renderer.cubeModel）：包装成等价 ModelAsset。
 * 实体 Blockbench 骨骼模型（geometry='blockbench'）无 Cube 几何，组装一律返回 null（预览降级为骨骼摘要）。
 */
import type { CubeElement, EmbeddedCubeModel, ModelAsset } from '../types/content'

/** 几何归属：model = 独立模型资产本身，其余 = 承载该内嵌模型的内容对象 */
export type GalleryModelOwnerKind = 'model' | 'block' | 'item' | 'entity'

export interface GalleryModelOwnerRef {
  ownerKind: GalleryModelOwnerKind
  ownerId: string
}

/** 内嵌 Cube 模型在对象里的位置：方块/物品在 model.cubeModel，实体在 renderer.cubeModel */
export function embeddedCubeOf(
  content: unknown,
  ownerKind: GalleryModelOwnerKind
): EmbeddedCubeModel | null {
  if (ownerKind === 'model') return null
  const o = content && typeof content === 'object' ? (content as Record<string, unknown>) : null
  const holderRaw = ownerKind === 'entity' ? o?.renderer : o?.model
  const holder =
    holderRaw && typeof holderRaw === 'object' ? (holderRaw as Record<string, unknown>) : null
  const cm = holder?.cubeModel
  if (!cm || typeof cm !== 'object') return null
  const c = cm as Record<string, unknown>
  if (!Array.isArray(c.elements) || c.elements.length === 0) return null
  return {
    textureSize: c.textureSize === 32 ? 32 : 16,
    pixels: Array.isArray(c.pixels)
      ? c.pixels.filter((p): p is string => typeof p === 'string')
      : [],
    elements: c.elements as CubeElement[],
    ...(c.display && typeof c.display === 'object'
      ? { display: c.display as EmbeddedCubeModel['display'] }
      : {})
  }
}

/** 像素补齐到 textureSize²：内嵌模型可能存了空/不完整像素数组，3D 预览与写回都需要完整长度 */
function fullPixels(size: 16 | 32, pixels: string[]): string[] {
  if (pixels.length === size * size) return pixels
  const out = Array.from({ length: size * size }, () => '')
  for (let i = 0; i < Math.min(pixels.length, out.length); i++) out[i] = pixels[i]
  return out
}

/** 独立 ModelAsset → 内嵌 Cube 模型（对象绑定的模型资产回灌到编辑态时用） */
export function embeddedFromModelAsset(m: ModelAsset): EmbeddedCubeModel {
  return {
    textureSize: m.textureSize === 32 ? 32 : 16,
    pixels: Array.isArray(m.pixels) ? m.pixels.filter((p): p is string => typeof p === 'string') : [],
    elements: Array.isArray(m.elements) ? m.elements : [],
    ...(m.display ? { display: m.display } : {})
  }
}

/** 归一化内嵌模型（画布 16/32 收窄 + 像素补齐），写回 / 物化前统一走这里 */
export function normalizeCubeModel(cm: EmbeddedCubeModel): EmbeddedCubeModel {
  const size: 16 | 32 = cm.textureSize === 32 ? 32 : 16
  return {
    textureSize: size,
    pixels: fullPixels(size, cm.pixels),
    elements: cm.elements,
    ...(cm.display ? { display: cm.display } : {})
  }
}

/** 对象显示名（zh_cn → en_us → id），仅用于预览标题 / 模型资产名 */
export function contentDisplayName(content: unknown, fallback: string): string {
  const o = content && typeof content === 'object' ? (content as Record<string, unknown>) : null
  const dn = o?.displayName
  if (typeof dn === 'string' && dn.trim()) return dn.trim()
  if (dn && typeof dn === 'object') {
    const d = dn as Record<string, unknown>
    for (const key of ['zh_cn', 'en_us']) {
      const v = d[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }
  return fallback
}

/**
 * 组装只读 ModelAsset（3D 预览用）：
 * - 独立模型资产：原样返回（数组浅拷贝，避免预览改动回写源数据）；
 * - 对象内嵌 Cube 模型：包装成等价 ModelAsset（id 用对象 id，贴图路径按 taget 对象命名约定）。
 * 拿不到 Cube 几何（如实体骨骼模型）返回 null。
 */
export function readonlyModelAsset(
  owner: GalleryModelOwnerRef,
  content: unknown
): ModelAsset | null {
  if (owner.ownerKind === 'model') {
    const m = content as ModelAsset | null
    if (!m || typeof m !== 'object' || m.kind !== 'model' || !Array.isArray(m.elements)) return null
    if (m.elements.length === 0) return null
    return {
      ...m,
      pixels: [...m.pixels],
      textures: { ...m.textures }
    }
  }
  const cm = embeddedCubeOf(content, owner.ownerKind)
  if (!cm) return null
  return modelAssetFromEmbedded(owner.ownerId, cm, contentDisplayName(content, owner.ownerId))
}

/** 内嵌 Cube 模型 → 独立 ModelAsset（与工坊保存时的物化规则一致：textures.all 指向 textures/model/<id>.png） */
export function modelAssetFromEmbedded(
  id: string,
  cm: EmbeddedCubeModel,
  displayName: string,
  timestamps?: { createdAt?: number; updatedAt?: number }
): ModelAsset {
  return {
    kind: 'model',
    id,
    displayName,
    description: '',
    textureSize: cm.textureSize === 32 ? 32 : 16,
    pixels: fullPixels(cm.textureSize === 32 ? 32 : 16, cm.pixels),
    textures: { all: `textures/model/${id}.png` },
    elements: cm.elements,
    ambientOcclusion: true,
    ...(cm.display ? { display: cm.display } : {}),
    createdAt: timestamps?.createdAt ?? Date.now(),
    updatedAt: timestamps?.updatedAt ?? Date.now()
  }
}
