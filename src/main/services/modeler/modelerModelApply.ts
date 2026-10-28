/**
 * modelerModelApply：工坊 Java 方块/物品文档 → 内容对象写回（P5-open，方案 §4.11）。
 *
 * 语义：把 .kunyu/modeler/<docId>.json（format = java_block）经 shared
 * documentToModelAsset 导出为 ModelAsset（贴图 data URL 在主进程解码为语义像素），
 * 落盘为目标对象自己的模型资产（models/<targetId>.json），再委托 applyModelCandidate
 * 完成写回——复用其三条不对称约束（方块只认 cubeModelId、物品/实体内嵌+绑定双写、
 * 实体 geo→cube 破坏性替换需 confirm）。
 *
 * 与 modelerGeoApply 的对应关系：geo 写回走 GeckoLib 骨骼链，本服务走 Java cube 链；
 * 两侧都以「文档落盘态」为准（未保存编辑由渲染层先引导保存再调用）。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ModelApplyResponse } from '../../../shared/types/ipc'
import type { ModelDocument, ModelTexture } from '../../../shared/modeler/types'
import { documentToModelAsset } from '../../../shared/modeler/formats'
import { formatPixel } from '../../../shared/utils/pixelColor'
import { dataUrlToPngBuffer, decodePng } from '../ai/pixelize'
import { loadContent, saveContent } from '../contentService'
import { applyModelCandidate } from '../modelApplyService'
import type { EntitySchema } from '../../../shared/schemas/entity.schema'

/** id 清洗：仅允许安全文件名字符（防路径穿越，与 modelerGeoApply.safeId 同规则） */
function safeId(id: string, name: string): string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`非法${name}：${id}`)
  return id
}

function fail(errorMessage: string): ModelApplyResponse {
  return { ok: false, errorMessage }
}

/** 文档贴图 data URL → 行优先语义像素串（解码失败返回 null，由 codec 记 pixels_unresolved 告警） */
function resolvePixels(tex: ModelTexture): string[] | null {
  try {
    const raster = decodePng(dataUrlToPngBuffer(tex.data))
    const out: string[] = []
    for (let i = 0; i < raster.width * raster.height; i++) {
      const o = i * 4
      out.push(
        formatPixel({
          r: raster.data[o]!,
          g: raster.data[o + 1]!,
          b: raster.data[o + 2]!,
          a: raster.data[o + 3]!
        })
      )
    }
    return out
  } catch {
    return null
  }
}

/**
 * 把工坊 java_block 文档导出 ModelAsset 并写回目标对象。
 * @param confirm 目标实体现为骨骼几何时必须为 true（首次调用返回 needsConfirm:true）
 */
export function applyModelerModelToObject(
  root: string,
  docId: string,
  targetKind: 'block' | 'item' | 'entity',
  targetId: string,
  confirm?: boolean
): ModelApplyResponse {
  if (typeof root !== 'string' || !root.trim()) return fail('缺少项目根路径')
  if (targetKind !== 'block' && targetKind !== 'item' && targetKind !== 'entity') {
    return fail(`非法目标类型：${String(targetKind)}`)
  }
  let sid: string
  let stid: string
  try {
    sid = safeId(docId, '文档 id')
    stid = safeId(targetId, '目标 id')
  } catch (err) {
    return fail((err as Error).message)
  }

  /* 读工坊文档（落盘态；未保存的编辑由渲染层先提示保存再调用） */
  const docFile = path.join(root, '.kunyu', 'modeler', `${sid}.json`)
  if (!existsSync(docFile)) return fail(`找不到模型文档：${sid}（请先在模型工坊保存）`)
  let doc: ModelDocument
  try {
    doc = JSON.parse(readFileSync(docFile, 'utf8')) as ModelDocument
  } catch (err) {
    return fail(`模型文档解析失败：${(err as Error).message}`)
  }
  if (doc?.format !== 'java_block') {
    return fail(`文档「${doc?.name ?? sid}」不是 Java 方块/物品格式（当前：${doc?.format ?? '未知'}），无法写回该对象`)
  }

  /* 导出 ModelAsset：id 与贴图路径统一改写为目标对象 id（物化路径与 saveModelTexture 一致） */
  const { output: asset, downgrades } = documentToModelAsset(doc, { resolvePixels })
  for (const d of downgrades) {
    if (d.severity === 'warning') console.warn(`[modelerModelApply] ${d.code}: ${d.message}`)
  }
  asset.id = stid
  for (const [variable, p] of Object.entries(asset.textures)) {
    asset.textures[variable] = p.replace(`textures/model/${sid}`, `textures/model/${stid}`)
  }

  /* 目标对象预检（实体 geo→cube 破坏性替换：先确认再落盘，避免孤儿模型资产） */
  let tgt: unknown
  try {
    tgt = loadContent(root, targetKind, stid)
  } catch (err) {
    return fail(`找不到目标对象：${(err as Error).message}`)
  }
  if ((tgt as { kind?: string })?.kind !== targetKind) {
    return fail(`${stid} 不是 ${targetKind} 类型`)
  }
  if (targetKind === 'entity' && confirm !== true) {
    const r = (tgt as EntitySchema).renderer
    if (r && r.modelType === 'blockbench_geo' && ((r.geoJson ?? '') !== '' || (r.modelPath ?? '') !== '')) {
      return {
        ok: false,
        needsConfirm: true,
        errorMessage:
          '该实体当前是骨骼模型：写入 Cube 模型会清空内嵌骨骼几何（geoJson）与动画路径，原始骨骼模型不再保留'
      }
    }
  }

  /* 模型资产落盘（applyModelCandidate 以 ownerKind=model 现读它做归一化写回） */
  try {
    saveContent(root, asset)
  } catch (err) {
    return fail(`写入模型资产失败：${(err as Error).message}`)
  }

  return applyModelCandidate(
    root,
    { ownerKind: 'model', ownerId: stid },
    root,
    { kind: targetKind, id: stid },
    true
  )
}
