/**
 * 画廊模型条目 · 写回目标对象服务。
 *
 * 语义：把一份 Cube 几何（来源 = 独立模型资产 / 方块·物品·实体的内嵌 cubeModel）物化成
 * **目标对象自己的**独立模型资产，并把目标对象的 cubeModelId 指向它。
 *
 * 三条不对称约束（改动前务必先读，别照抄「都写内嵌」）：
 * 1. 方块只认 cubeModelId —— normalizeBlockSchema 会丢弃 model.cubeModel，写内嵌只造成假象；
 * 2. 物品/实体内嵌 cubeModel 可直出，但生成器优先 cubeModelId，故两者一起写（内嵌留住编辑态，绑定负责产物）；
 * 3. 实体 geo 与 cube 并列建模 —— 写 cube 必须 modelType='custom' 且清空 geoJson/animationPath/modelPath，
 *    这是破坏性替换，需要 confirm 二次确认。
 *
 * 来源与目标允许不同项目（画廊汇总模式跨项目复用），故 sourceRoot / targetRoot 分开传。
 * 贴图 PNG 落盘为 best-effort：失败不回滚语义写入（生成阶段仍会按像素重出）。
 */
import { loadContent, saveContent, saveModelTexture, saveTextureAsset } from './contentService'
import type { BlockSchema } from '../../shared/schemas/block.schema'
import type { EntitySchema } from '../../shared/schemas/entity.schema'
import type { ItemSchema } from '../../shared/schemas/item.schema'
import type { ContentDefinition, EmbeddedCubeModel, ModelAsset } from '../../shared/types/content'
import type {
  ModelApplyResponse,
  ModelApplySourceRef,
  ModelApplyTargetRef
} from '../../shared/types/ipc'
import {
  contentDisplayName,
  embeddedCubeOf,
  modelAssetFromEmbedded,
  normalizeCubeModel
} from '../../shared/utils/cubeModelAsset'

const OWNER_KINDS: readonly ModelApplySourceRef['ownerKind'][] = [
  'model',
  'block',
  'item',
  'entity'
]
const TARGET_KINDS: readonly ModelApplyTargetRef['kind'][] = ['block', 'item', 'entity']

/** 来源几何（已归一化：画布收窄 + 像素补齐），供物化为目标模型资产 */
interface SourceGeometry {
  cm: EmbeddedCubeModel
  displayName: string
  createdAt?: number
  updatedAt?: number
}

/** 读出并归一化来源几何；不可用时返回 error 文案（不抛错，交给 handler 回 ok:false） */
function readSource(
  sourceRoot: string,
  source: ModelApplySourceRef
): SourceGeometry | { error: string } {
  if (
    !OWNER_KINDS.includes(source?.ownerKind) ||
    typeof source?.ownerId !== 'string' ||
    !source.ownerId.trim()
  ) {
    return { error: '来源模型信息不合法' }
  }
  let def: ContentDefinition
  try {
    def = loadContent(sourceRoot, source.ownerKind, source.ownerId)
  } catch (err) {
    return { error: `读取来源模型失败：${(err as Error).message}` }
  }
  if (source.ownerKind === 'model') {
    const m = def as ModelAsset
    if (m.kind !== 'model' || !Array.isArray(m.elements) || m.elements.length === 0) {
      return { error: '来源模型没有可用的立方体几何' }
    }
    return {
      cm: normalizeCubeModel({
        textureSize: m.textureSize === 32 ? 32 : 16,
        pixels: Array.isArray(m.pixels)
          ? m.pixels.filter((p): p is string => typeof p === 'string')
          : [],
        elements: m.elements,
        ...(m.display ? { display: m.display } : {})
      }),
      displayName: contentDisplayName(m, source.ownerId),
      ...(typeof m.createdAt === 'number' ? { createdAt: m.createdAt } : {}),
      ...(typeof m.updatedAt === 'number' ? { updatedAt: m.updatedAt } : {})
    }
  }
  const cm = embeddedCubeOf(def, source.ownerKind)
  if (!cm) return { error: '来源对象没有内嵌的立方体模型' }
  return { cm: normalizeCubeModel(cm), displayName: contentDisplayName(def, source.ownerId) }
}

/** 目标已有同 id 模型资产时沿用其 createdAt（画廊排序稳定，不因重写而跳到最前） */
function previousCreatedAt(targetRoot: string, targetId: string, fallback: number): number {
  try {
    const prev = loadContent(targetRoot, 'model', targetId) as ModelAsset
    return typeof prev.createdAt === 'number' ? prev.createdAt : fallback
  } catch {
    return fallback
  }
}

/**
 * 把来源几何写回目标对象。
 * @param confirm 目标实体现为 Blockbench 骨骼模型时必须为 true（首次调用返回 needsConfirm:true）
 */
export function applyModelCandidate(
  sourceRoot: string,
  source: ModelApplySourceRef,
  targetRoot: string,
  target: ModelApplyTargetRef,
  confirm?: boolean
): ModelApplyResponse {
  if (typeof sourceRoot !== 'string' || !sourceRoot.trim()) {
    return { ok: false, errorMessage: '缺少来源项目根路径' }
  }
  if (typeof targetRoot !== 'string' || !targetRoot.trim()) {
    return { ok: false, errorMessage: '缺少目标项目根路径' }
  }
  if (
    !TARGET_KINDS.includes(target?.kind) ||
    typeof target?.id !== 'string' ||
    !target.id.trim()
  ) {
    return { ok: false, errorMessage: '目标对象信息不合法' }
  }
  const src = readSource(sourceRoot, source)
  if ('error' in src) return { ok: false, errorMessage: src.error }

  let tgt: ContentDefinition
  try {
    tgt = loadContent(targetRoot, target.kind, target.id)
  } catch (err) {
    return { ok: false, errorMessage: `找不到目标对象：${(err as Error).message}` }
  }
  if (tgt.kind !== target.kind) {
    return { ok: false, errorMessage: `${target.id} 不是 ${target.kind} 类型` }
  }

  // 实体骨骼模型 → Cube 模型是破坏性替换：内嵌 geoJson / 动画路径会一并清空
  if (target.kind === 'entity' && confirm !== true) {
    const r = (tgt as EntitySchema).renderer
    if (
      r &&
      r.modelType === 'blockbench_geo' &&
      ((r.geoJson ?? '') !== '' || (r.modelPath ?? '') !== '')
    ) {
      return {
        ok: false,
        needsConfirm: true,
        errorMessage:
          '该实体当前是 Blockbench 骨骼模型：写入 Cube 模型会清空内嵌骨骼几何（geoJson）与动画路径，原始骨骼模型不再保留'
      }
    }
  }

  const now = Date.now()
  const asset = modelAssetFromEmbedded(
    target.id,
    src.cm,
    contentDisplayName(tgt, target.id),
    { createdAt: previousCreatedAt(targetRoot, target.id, now), updatedAt: now }
  )

  const written: string[] = []
  try {
    saveContent(targetRoot, asset)
    written.push(`.kunyu/content/models/${target.id}.json`)
  } catch (err) {
    return { ok: false, errorMessage: `写入模型资产失败：${(err as Error).message}` }
  }

  const cubeModel: EmbeddedCubeModel = {
    textureSize: asset.textureSize,
    pixels: asset.pixels,
    elements: asset.elements,
    ...(asset.display ? { display: asset.display } : {})
  }
  let replacedGeo = false
  /** 目标自带贴图路径为空且来源是 16 画布时，贴图像素画直接物化到 textures/<kind>/<id>.png */
  let writeFlatPng = false
  try {
    if (target.kind === 'item') {
      const it = tgt as ItemSchema
      it.model = { ...it.model, cubeModel }
      it.cubeModelId = target.id
      it.updatedAt = now
      if (!it.texture.path) {
        it.texture = { ...it.texture, pixels: cubeModel.pixels }
        writeFlatPng = cubeModel.textureSize === 16
      }
    } else if (target.kind === 'entity') {
      const en = tgt as EntitySchema
      replacedGeo = en.renderer?.modelType === 'blockbench_geo'
      en.renderer = {
        modelType: 'custom',
        modelPath: null,
        animationPath: null,
        geoJson: null,
        cubeModel
      }
      en.cubeModelId = target.id
      en.updatedAt = now
    } else {
      const b = tgt as BlockSchema
      // 方块只认 cubeModelId（内嵌 model.cubeModel 会被 normalizeBlockSchema 丢弃）
      b.cubeModelId = target.id
      b.updatedAt = now
      if (!b.texture.path) {
        b.texture = { ...b.texture, pixels: cubeModel.pixels }
        writeFlatPng = cubeModel.textureSize === 16
      }
    }
    saveContent(targetRoot, tgt)
    written.push(`.kunyu/content/${target.kind}s/${target.id}.json`)
  } catch (err) {
    return { ok: false, errorMessage: `写入目标对象失败：${(err as Error).message}` }
  }

  // PNG 物化（best-effort）：cube 几何引用的 textures/model/<id>.png 必须有真实文件才渲染得出来
  const hasArt =
    cubeModel.pixels.length === cubeModel.textureSize * cubeModel.textureSize &&
    cubeModel.pixels.some((p) => p !== '')
  try {
    if (hasArt) {
      written.push(saveModelTexture(targetRoot, target.id, cubeModel.pixels, cubeModel.textureSize))
      if (writeFlatPng) {
        written.push(saveTextureAsset(targetRoot, target.id, target.kind, cubeModel.pixels, 16, 16))
      }
    }
  } catch {
    // 贴图落盘失败不回滚语义写入；生成阶段会按像素重出
  }

  return { ok: true, written, replacedGeo }
}
