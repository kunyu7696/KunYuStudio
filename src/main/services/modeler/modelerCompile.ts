/**
 * modelerCompile：工坊文档 → 资源包产物落盘（D1）。
 *
 * 语义：把 .kunyu/modeler/<docId>.json 直接编译为
 *   - Java：assets/<modId>/models/model/<id>.json + textures/model/<id>.png
 *   - Bedrock/Gecko：assets/<modId>/geo/<id>.geo.json + animations/<id>.animation.json
 *     （mesh 节点按 bedrock codec 规则跳过）
 * 产物直接物化到 src/main/resources 下的资源包目录，用户跑客户端就能看到；
 * 不等 gradlew build 的全量生成链路。
 *
 * 触发时机：**只在工坊显式 save 时触发**（autosave 是影子文件，不写资源包）。
 * 主进程读落盘态文档 → 选格式 codec → 把 downgrades 全量返回给渲染层展示。
 * 任何一步失败（模组上下文拿不到、codec 抛错、PNG 写入失败）都整体 abort，
 * 返回 error，不留下半拉子产物。
 *
 * 多贴图说明（D1a）：工坊文档支持多贴图，但资源包 Java cube 模型仅支持单贴图
 * （textures/all 变量）；Bedrock geo 也是单贴图。故多贴图文档本次仅主贴图落盘，
 * 其余贴图 info 告警提示。这是 v1 资源包能力的天然边界，不是实现缺陷。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { dataUrlToPngBuffer, decodePng } from '../ai/pixelize'
import { pixelsToPngRect } from '../modelCompiler'
import { formatPixel } from '../../../shared/utils/pixelColor'
import { compileModelToMcJson } from '../modelCompiler'
import { resolveModContext } from '../contentGenerator/context'
import { documentToModelAsset } from '../../../shared/modeler/formats/javaBlock'
import { documentToGeo } from '../../../shared/modeler/formats/bedrock'
import { documentToAnimations } from '../../../shared/modeler/formats/bedrockAnim'
import type { ModelDocument } from '../../../shared/modeler/types'
import type { FormatDowngrade } from '../../../shared/modeler/formats/types'

/* ------------------------------------------------------------------ */
/* 返回类型                                                            */
/* ------------------------------------------------------------------ */

export interface ModelerCompileResult {
  ok: boolean
  /** 成功时：本次实际写入的相对路径（assets/…） */
  files: string[]
  /** codec + 本层报告的 downgrades（含 warning/info） */
  downgrades: FormatDowngrade[]
  /** 失败时填主因（成功时空） */
  errorMessage?: string
  /** 模组上下文快照（方便渲染层提示用户 modId） */
  modId?: string
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function ensureDir(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
}

/** doc texture data URL → 行优先语义像素串（decodePng 失败返回 null） */
function textureToPixels(
  dataUrl: string,
  label: string
): { pixels: string[]; width: number; height: number } | null {
  try {
    const raster = decodePng(dataUrlToPngBuffer(dataUrl))
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
    return { pixels: out, width: raster.width, height: raster.height }
  } catch {
    console.warn(`[modelerCompile] 贴图解码失败：${label}`)
    return null
  }
}

/**
 * 清理 textures/model/ 下不再被任何文档引用的旧 PNG。
 * 仅按 <docId> 前缀匹配——本批仅维护「工坊直接编译」的产物，gradlew build 生成物不动。
 * 返回被删除的文件名列表。
 */
function cleanupStaleModelTextures(
  assetsDir: string,
  activeDocIds: Set<string>
): string[] {
  const modelTexDir = path.join(assetsDir, 'textures', 'model')
  if (!existsSync(modelTexDir)) return []
  const deleted: string[] = []
  for (const entry of readdirSync(modelTexDir)) {
    if (!entry.endsWith('.png')) continue
    const docPrefix = entry.replace(/\.png$/, '')
    if (!activeDocIds.has(docPrefix)) {
      try {
        rmSync(path.join(modelTexDir, entry))
        deleted.push(entry)
      } catch {
        /* 删除失败静默忽略（可能被外部进程占用） */
      }
    }
  }
  return deleted
}

/** 收集 .kunyu/modeler/ 下所有活动文档 id（用于 stale 清理的"在产清单"） */
function listActiveDocIds(root: string): Set<string> {
  const dir = path.join(root, '.kunyu', 'modeler')
  if (!existsSync(dir)) return new Set()
  const ids = new Set<string>()
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith('.json')) ids.add(entry.slice(0, -'.json'.length))
  }
  return ids
}

/* ------------------------------------------------------------------ */
/* 主入口                                                              */
/* ------------------------------------------------------------------ */

/**
 * 把已保存的工坊文档（.kunyu/modeler/<docId>.json）直接编译落盘到资源包。
 * @param root 项目根
 * @param docId 已保存到磁盘的文档 id
 */
export function compileModelerDoc(root: string, docId: string): ModelerCompileResult {
  /* 1) 定位文档文件 */
  const docFile = path.join(root, '.kunyu', 'modeler', `${docId}.json`)
  if (!existsSync(docFile)) {
    return { ok: false, files: [], downgrades: [], errorMessage: `找不到模型文档：${docId}` }
  }
  let doc: ModelDocument
  try {
    doc = JSON.parse(readFileSync(docFile, 'utf8')) as ModelDocument
  } catch (err) {
    return { ok: false, files: [], downgrades: [], errorMessage: `模型文档解析失败：${(err as Error).message}` }
  }

  /* 2) 格式门禁：只编译已实现导出的格式；其他一律 abort 给用户提示 */
  const fmt = doc.format
  if (fmt !== 'java_block' && fmt !== 'bedrock_entity' && fmt !== 'geckolib') {
    return {
      ok: false,
      files: [],
      downgrades: [],
      errorMessage: `当前格式「${fmt}」没有 Java 方块 / Bedrock 几何导出能力，无法写入资源包`
    }
  }

  /* 3) 模组上下文 */
  let ctx
  try {
    ctx = resolveModContext(root)
  } catch (err) {
    return {
      ok: false,
      files: [],
      downgrades: [],
      errorMessage: `无法解析模组上下文：${(err as Error).message}`
    }
  }
  const { modId, assetsDir } = ctx

  const allFiles: string[] = []
  const allDowngrades: FormatDowngrade[] = []

  /* 4) 贴图先落盘（主贴图：textures/model/<id>.png） */
  const texList = Object.values(doc.textures)
  if (texList.length === 0) {
    allDowngrades.push({
      severity: 'info',
      code: 'modeler_no_texture',
      message: '文档没有贴图，资源包模型会绑定空贴图变量'
    })
  } else {
    const primary = texList[0]!
    const decoded = textureToPixels(primary.data, primary.name || primary.id)
    if (!decoded) {
      return {
        ok: false,
        files: allFiles,
        downgrades: allDowngrades,
        errorMessage: `主贴图「${primary.name || primary.id}」解码失败，无法写入资源包`
      }
    }
    const { pixels, width, height } = decoded
    if (width !== height) {
      allDowngrades.push({
        severity: 'info',
        code: 'modeler_texture_non_square',
        message: `主贴图 ${width}×${height} 非正方形，资源包 PNG 按原尺寸写入（Minecraft 会按材质 atlas 规则裁切）`
      })
    }
    const texRel = `textures/model/${doc.id}.png`
    const texAbs = path.join(assetsDir, texRel)
    ensureDir(texAbs)
    writeFileSync(texAbs, pixelsToPngRect(pixels, width, height))
    allFiles.push(texRel)
    if (texList.length > 1) {
      allDowngrades.push({
        severity: 'info',
        code: 'modeler_extra_textures_skipped',
        message: `文档有 ${texList.length} 张贴图，资源包仅落主贴图（Java/Bedrock 均只表达单贴图）`
      })
    }
  }

  /* 5) 按格式落产物文件 */
  const meshCount = Object.values(doc.nodes).filter((n) => n.type === 'mesh').length
  const meshDropWarn = (): void => {
    if (meshCount > 0) {
      allDowngrades.push({
        severity: 'info',
        code: 'mesh_dropped',
        message: `资源包几何不表达网格，已跳过 ${meshCount} 个 mesh 节点（仅 cube 进入产物）`
      })
    }
  }

  try {
    if (fmt === 'java_block') {
      const { output: asset, downgrades } = documentToModelAsset(doc)
      allDowngrades.push(...downgrades)
      meshDropWarn()
      const mcJson = compileModelToMcJson(asset, modId)
      const rel = `models/model/${doc.id}.json`
      ensureDir(path.join(assetsDir, rel))
      writeFileSync(path.join(assetsDir, rel), JSON.stringify(mcJson, null, 2) + '\n')
      allFiles.push(rel)
    } else {
      /* bedrock_entity / geckolib 共用 geo.json 与 animation.json 契约 */
      const { output: geo, downgrades } = documentToGeo(doc)
      allDowngrades.push(...downgrades)
      meshDropWarn()
      const geoRel = `geo/${doc.id}.geo.json`
      ensureDir(path.join(assetsDir, geoRel))
      writeFileSync(path.join(assetsDir, geoRel), JSON.stringify(geo, null, 2) + '\n')
      allFiles.push(geoRel)

      if (doc.animations && Object.keys(doc.animations).length > 0) {
        const { output: animFile, downgrades: animDown } = documentToAnimations(doc)
        allDowngrades.push(...animDown)
        const animRel = `animations/${doc.id}.animation.json`
        ensureDir(path.join(assetsDir, animRel))
        writeFileSync(path.join(assetsDir, animRel), JSON.stringify(animFile, null, 2) + '\n')
        allFiles.push(animRel)
      }
    }
  } catch (err) {
    return {
      ok: false,
      files: allFiles,
      downgrades: allDowngrades,
      errorMessage: `编写出错：${(err as Error).message}`,
      modId
    }
  }

  /* 6) stale 清理：删掉不再被任何活动文档引用的旧 model PNG（本批仅维护工坊直接产物） */
  try {
    const activeIds = listActiveDocIds(root)
    const deleted = cleanupStaleModelTextures(assetsDir, activeIds)
    if (deleted.length > 0) {
      allDowngrades.push({
        severity: 'info',
        code: 'modeler_stale_cleanup',
        message: `清理了 ${deleted.length} 个不再被活动文档引用的旧贴图：${deleted.slice(0, 3).join('、')}${deleted.length > 3 ? ' 等' : ''}`
      })
    }
  } catch (err) {
    /* stale 清理失败不阻塞主产出 */
    console.warn(`[modelerCompile] stale 贴图清理失败：${(err as Error).message}`)
  }

  return { ok: true, files: allFiles, downgrades: allDowngrades, modId }
}
