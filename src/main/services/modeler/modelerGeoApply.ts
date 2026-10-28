/**
 * modelerGeoApply：工坊骨骼文档 → 实体几何写回（P3-f，方案 §4.7/§6）。
 *
 * 语义：把 .kunyu/modeler/<docId>.json（format = bedrock_entity | geckolib）经
 * shared documentToGeo 导出为 Bedrock 1.12.0 geo.json，写回实体
 * renderer.geoJson（modelType='blockbench_geo'），供 GeckoLib 实体构建链
 * （contentGenerator/javaEntities）物化进资源目录。
 *
 * 与 modelApplyService（Cube 写回）的不对称约束对称执行：
 * - 写 geo 是破坏性替换：目标实体已有骨骼几何（geoJson/modelPath）时首次
 *   返回 needsConfirm，确认后覆盖（对齐画廊模型写回的 confirm 流程）；
 * - geo 与 cube 并列互斥：写 geo 时清空 cubeModel 与 cubeModelId（Cube 写回
 *   反向清空 geo，两侧语义一致）；
 * - animationPath 保留不动（动画文件独立于几何，不由几何写回销毁）；
 * - format 非 bedrock_entity/geckolib 的文档拒绝写回（Java 方块模型不是实体几何）。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ModelApplyResponse } from '../../../shared/types/ipc'
import type { ModelDocument } from '../../../shared/modeler/types'
import { documentToGeo } from '../../../shared/modeler/formats'
import { loadContent, saveContent } from '../contentService'
import type { EntitySchema } from '../../../shared/schemas/entity.schema'

/** id 清洗：仅允许安全文件名字符（防路径穿越，与 modelerBackup.safeId 同规则） */
function safeId(id: string, name: string): string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`非法${name}：${id}`)
  return id
}

function fail(errorMessage: string): ModelApplyResponse {
  return { ok: false, errorMessage }
}

/**
 * 把工坊文档导出 geo.json 并写回实体。
 * @param confirm 目标实体已有骨骼几何时必须为 true（首次调用返回 needsConfirm:true）
 */
export function applyModelerGeoToEntity(
  root: string,
  docId: string,
  entityId: string,
  confirm?: boolean
): ModelApplyResponse {
  if (typeof root !== 'string' || !root.trim()) return fail('缺少项目根路径')
  let sid: string
  let seid: string
  try {
    sid = safeId(docId, '文档 id')
    seid = safeId(entityId, '实体 id')
  } catch (err) {
    return fail((err as Error).message)
  }

  /* 读工坊文档（落盘态；未保存的编辑由渲染层先提示保存再调用） */
  const docFile = path.join(root, '.kunyu', 'modeler', `${sid}.json`)
  if (!existsSync(docFile)) return fail(`找不到模型文档：${sid}（请先在工坊保存）`)
  let doc: ModelDocument
  try {
    doc = JSON.parse(readFileSync(docFile, 'utf8')) as ModelDocument
  } catch (err) {
    return fail(`模型文档解析失败：${(err as Error).message}`)
  }
  if (doc?.format !== 'bedrock_entity' && doc?.format !== 'geckolib') {
    return fail(`文档「${doc?.name ?? sid}」不是实体几何格式（当前：${doc?.format ?? '未知'}），无法写回实体`)
  }

  /* 导出 geo.json：空骨骼拒绝（实体几何至少要有一根骨骼） */
  const { output: geo } = documentToGeo(doc)
  const bones = geo['minecraft:geometry']?.[0]?.bones ?? []
  if (bones.length === 0) return fail('文档没有任何骨骼/立方体，无法作为实体几何写回')
  const geoJson = JSON.stringify(geo)

  /* 读目标实体 */
  let entity: EntitySchema
  try {
    const def = loadContent(root, 'entity', seid) as EntitySchema
    if (def?.kind !== 'entity') return fail(`${seid} 不是实体类型`)
    entity = def
  } catch (err) {
    return fail(`找不到目标实体：${(err as Error).message}`)
  }

  /* 覆盖已有骨骼几何 = 破坏性替换，需确认（对齐画廊模型写回的 confirm 语义） */
  const r = entity.renderer
  const hadGeo =
    r?.modelType === 'blockbench_geo' && ((r.geoJson ?? '') !== '' || (r.modelPath ?? '') !== '')
  if (hadGeo && confirm !== true) {
    return {
      ok: false,
      needsConfirm: true,
      errorMessage: `实体「${entity.displayName?.zh_cn || seid}」已有骨骼几何，写回将覆盖现有 geoJson 与外置模型路径`
    }
  }

  /* 主贴图直出（贴图不走旧 cube/UV 铺底链）：文档 textures 第一张
     （bedrock 实体几何单贴图语义），剥 data: 前缀存 base64；
     文档无贴图时清空旧值，防上一次写回的贴图悬挂 */
  const firstTex = Object.values(doc.textures ?? {})[0]
  const texB64 = firstTex?.data?.startsWith('data:image/png;base64,')
    ? firstTex.data.slice('data:image/png;base64,'.length)
    : null

  entity.renderer = {
    modelType: 'blockbench_geo',
    modelPath: null,
    animationPath: r?.animationPath ?? null, // 动画路径保留，几何写回不销毁动画
    geoJson,
    modelerDocId: sid, // 登记来源工坊文档（P4-gen 生成器据此导出已创作动画）
    texturePng: texB64,
    cubeModel: null
  }
  entity.cubeModelId = null
  entity.updatedAt = Date.now()
  try {
    saveContent(root, entity)
  } catch (err) {
    return fail(`写入实体失败：${(err as Error).message}`)
  }
  return {
    ok: true,
    written: [`.kunyu/content/entities/${seid}.json`],
    replacedGeo: hadGeo
  }
}
