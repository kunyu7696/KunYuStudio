/**
 * write-through（工作过程实时可见）：write_project_file 验收通过后立即写盘。
 *
 * 旧行为是「只登记、攒批到 generate 结束统一落盘」——运行中途工作台黑盒，
 * 开发者看不到 AI 正在写什么。工具层闸门（路径/白名单/括号 lint/JSON lint/
 * 模组 JSON 禁写）是终点 validateFileChanges 的超集，write-through 安全；
 * 终点复核若仍拒绝（概率趋零的兜底），由 rollback 回滚：
 * create → 删文件；modify → 恢复首次写入前的原文快照（同一文件多次提交只记首次）。
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

/** 一次落盘的事实（file-written 事件负载） */
export interface FileWrittenInfo {
  path: string
  action: 'create' | 'modify'
  bytes: number
}

export interface WriteThroughPort {
  /**
   * 立即写盘：modify 首次写入前快照原文；写失败抛错（工具层转 ok:false）。
   * 同一路径多次提交以最后一次为准（快照仍保留首次原文）。
   */
  write(relPath: string, action: 'create' | 'modify', content: string): void
  /**
   * 终点复核拒绝时回滚：create（快照为 null）→ 删文件；modify → 恢复快照。
   * 幂等：已回滚/未 write-through 的路径静默跳过。
   */
  rollback(relPaths: string[]): void
  /** 已 write-through 落盘且未被回滚的路径（终点统一写盘循环据此去重） */
  written(): ReadonlySet<string>
  /**
   * T2 对比/回滚：读取首次写入前的原文快照。
   * 三态：undefined=无快照（未 write-through 或已回滚）；null=create（原文不存在，
   * 回滚=删文件）；string=modify 原文（对比视图左侧 / 回滚恢复内容）。
   */
  snapshotOf(relPath: string): string | null | undefined
}

export function createWriteThrough(opts: {
  projectRoot: string
  writeFile: (absPath: string, content: string) => void
  onFileWritten?: (info: FileWrittenInfo) => void
}): WriteThroughPort {
  const { projectRoot, writeFile, onFileWritten } = opts
  /** 首次写入前的原文快照；null = 文件原本不存在（回滚时删除）。只记首次。 */
  const snapshots = new Map<string, string | null>()
  const writtenSet = new Set<string>()

  return {
    write(relPath, action, content) {
      const abs = resolve(projectRoot, relPath)
      if (!snapshots.has(relPath)) {
        snapshots.set(relPath, existsSync(abs) ? readFileSync(abs, 'utf8') : null)
      }
      writeFile(abs, content)
      writtenSet.add(relPath)
      onFileWritten?.({ path: relPath, action, bytes: Buffer.byteLength(content, 'utf8') })
    },
    rollback(relPaths) {
      for (const rel of relPaths) {
        if (!snapshots.has(rel)) continue
        const original = snapshots.get(rel) ?? null
        snapshots.delete(rel)
        writtenSet.delete(rel)
        const abs = resolve(projectRoot, rel)
        try {
          if (original === null) rmSync(abs, { force: true })
          else writeFile(abs, original)
        } catch {
          /* 回滚失败不阻断主流水线：终点 files 列表仍以复核结论为准 */
        }
      }
    },
    written: () => writtenSet,
    snapshotOf: (relPath) => (snapshots.has(relPath) ? snapshots.get(relPath) : undefined)
  }
}
