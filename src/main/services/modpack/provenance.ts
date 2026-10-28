/**
 * 整合包模组来源记录（项目内 sidecar `.kunyu/modpack.json`）。
 *
 * 选项目内 JSON 而不选 SQLite：组装器无需依赖 DB 连接与项目表 join，
 * 记录随项目一起移动，风格与启动器的 records.json 一致，单测零 mock。
 * 旧项目无记录时组装全量降级 overrides + 告警，不阻断。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ModSourceEntry, ModpackSourcesFile } from '../../../shared/types/modpack'

/** 相对项目根的记录文件位置 */
export const MODPACK_SOURCES_REL = '.kunyu/modpack.json'

export function sourcesFilePath(projectRoot: string): string {
  return join(projectRoot, '.kunyu', 'modpack.json')
}

/** 按文件名覆盖式写入（纯函数，返回新数组） */
export function upsertEntry(entries: ModSourceEntry[], entry: ModSourceEntry): ModSourceEntry[] {
  const next = entries.filter((e) => e.fileName !== entry.fileName)
  next.push(entry)
  return next
}

/** 按文件名移除（纯函数，返回新数组） */
export function removeEntryByName(entries: ModSourceEntry[], fileName: string): ModSourceEntry[] {
  return entries.filter((e) => e.fileName !== fileName)
}

/** 读取记录；文件缺失或损坏一律容错返回空表（不阻断组装） */
export function readSources(projectRoot: string): Map<string, ModSourceEntry> {
  const map = new Map<string, ModSourceEntry>()
  const file = sourcesFilePath(projectRoot)
  if (!existsSync(file)) return map
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<ModpackSourcesFile> | null
    const entries = Array.isArray(raw?.entries) ? raw.entries : []
    for (const e of entries) {
      if (!e || typeof e.fileName !== 'string' || !e.fileName) continue
      map.set(e.fileName, e)
    }
  } catch (err) {
    console.warn(`[modpack] 来源记录解析失败，按空记录处理：${(err as Error).message}`)
  }
  return map
}

/** 写出记录（失败仅告警，不影响安装结果） */
export function writeSources(projectRoot: string, entries: ModSourceEntry[]): void {
  const file = sourcesFilePath(projectRoot)
  try {
    mkdirSync(dirname(file), { recursive: true })
    const payload: ModpackSourcesFile = { version: 1, entries }
    writeFileSync(file, JSON.stringify(payload, null, 2))
  } catch (err) {
    console.warn(`[modpack] 来源记录写入失败：${(err as Error).message}`)
  }
}

/**
 * 安装来源记录器：内存累积 + 一次落盘，避免依赖递归安装时的 O(N²) 全量写。
 * marketService 通过可选参数注入，保持对项目模块零依赖。
 */
export interface ProvenanceRecorder {
  record(entry: ModSourceEntry): void
  remove(fileName: string): void
  /** 把累积变更写回磁盘（失败仅告警） */
  flush(): void
}

export function createProvenanceRecorder(projectRoot: string): ProvenanceRecorder {
  let entries: ModSourceEntry[] | null = null
  return {
    record(entry: ModSourceEntry): void {
      if (!entries) entries = [...readSources(projectRoot).values()]
      entries = upsertEntry(entries, entry)
    },
    remove(fileName: string): void {
      if (!entries) entries = [...readSources(projectRoot).values()]
      entries = removeEntryByName(entries, fileName)
    },
    flush(): void {
      if (!entries) return
      writeSources(projectRoot, entries)
    }
  }
}