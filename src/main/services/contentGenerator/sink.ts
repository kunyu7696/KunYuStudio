import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { deleteEntry, writeBinaryFile, writeFile } from '../fsService'
import { mergeRegistryClass } from './registryMerge'
import { rel } from './utils'

/**
 * 写入槽（M12）：实写模式落盘并做漂移检测；dry 模式只收集计划。
 * 所有生成路径（含织入/语言/标签合并）统一走 sink，保证 plan 与实际生成一致。
 */
export interface GenSink {
  text(absPath: string, content: string): void
  bin(absPath: string, data: Buffer): void
  /** 请求删除旧产物；若文件被手动改过则保留（返回是否保留） */
  remove(absPath: string): void
  /** 本轮仍保留为托管登记但实际跳过的文件（删除保护） */
  keptFromDelete: Set<string>
}

export function sha1(data: string | Buffer): string {
  return createHash('sha1').update(data).digest('hex')
}

export function sha1File(absPath: string): string | null {
  try {
    return sha1(readFileSync(absPath))
  } catch {
    return null
  }
}

export interface PlannedEntry {
  data: string | Buffer
  exists: boolean
  /** 磁盘内容 ≠ 工具上次产物（用户手改） */
  drifted: boolean
  /** 默认跳过策略下未执行写入 */
  skipped: boolean
  /** 注册类漂移时执行了符号级增量合并（外来注册语句已并入 data） */
  mergedForeign?: boolean
}

interface SinkContext {
  root: string
  dry: boolean
  overwrite: Set<string>
  /** 上轮工具产物 hash（relPath → sha1）；空对象表示基线轮（v1 清单/首轮） */
  oldHashes: Record<string, string>
  baseline: boolean
  /** 上轮清单登记、本轮语义已删除的内容 id（这些 id 的注册语句不视为外来，不并入） */
  retiredContentIds: Set<string>
  writes: Map<string, PlannedEntry>
  deletes: Map<string, { exists: boolean; drifted: boolean; skipped: boolean }>
}

/**
 * lang / tags 是 merge 语义路径（syncLangFile / syncTagFile 本就读磁盘合并），
 * 漂移时不应整份跳过——直接写合并结果即可。
 */
const MERGE_SEMANTIC_PATH_RE =
  /(^|\/)assets\/[^/]+\/lang\/[^/]+\.json$|(^|\/)data\/[^/]+\/tags\/.+\.json$/

/** 注册类路径（Fabric/Mojmap 皆命中）：漂移时走符号级增量合并而非整份跳过 */
const REGISTRY_CLASS_PATH_RE = /\/(ModBlocks|ModItems|ModEntities|ModEnchantments)\.java$/

export function makeSink(cx: SinkContext): GenSink {
  const keptFromDelete = new Set<string>()
  const planEntry = (absPath: string, data: string | Buffer): void => {
    const rp = rel(cx.root, absPath)
    const exists = existsSync(absPath)
    let drifted = false
    if (exists && !cx.baseline && Object.prototype.hasOwnProperty.call(cx.oldHashes, rp)) {
      const diskHash = sha1File(absPath)
      drifted = diskHash !== null && diskHash !== cx.oldHashes[rp]
    }
    let skipped = drifted && !cx.overwrite.has(rp)
    let mergedForeign = false
    let finalData = data
    if (skipped && typeof data === 'string' && exists) {
      if (MERGE_SEMANTIC_PATH_RE.test(rp)) {
        // lang/tags：sync*File 本就读磁盘合并，漂移不应跳过（P0-A）
        skipped = false
      } else if (REGISTRY_CLASS_PATH_RE.test(rp)) {
        // 注册类：符号级增量合并外来注册段（P0-A）；磁盘不像注册类才回落跳过
        try {
          const disk = readFileSync(absPath, 'utf-8')
          const merged = mergeRegistryClass(disk, data, cx.retiredContentIds)
          if (merged !== null) {
            finalData = merged.content
            skipped = false
            mergedForeign = merged.mergedForeign
          }
        } catch {
          /* 读取失败保持跳过 */
        }
      }
    }
    cx.writes.set(rp, { data: finalData, exists, drifted, skipped, mergedForeign })
    if (!cx.dry && !skipped) {
      if (typeof finalData === 'string') writeFile(absPath, finalData)
      else writeBinaryFile(absPath, finalData)
    }
  }
  return {
    keptFromDelete,
    text(absPath, content) {
      planEntry(absPath, content)
    },
    bin(absPath, data) {
      planEntry(absPath, data)
    },
    remove(absPath) {
      const rp = rel(cx.root, absPath)
      const exists = existsSync(absPath)
      let drifted = false
      if (exists && !cx.baseline && Object.prototype.hasOwnProperty.call(cx.oldHashes, rp)) {
        const diskHash = sha1File(absPath)
        drifted = diskHash !== null && diskHash !== cx.oldHashes[rp]
      }
      const skipped = drifted
      cx.deletes.set(rp, { exists, drifted, skipped })
      if (exists && !cx.dry && !skipped) deleteEntry(absPath)
      if (skipped) keptFromDelete.add(rp)
    }
  }
}
