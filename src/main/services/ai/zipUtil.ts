/**
 * 最小 store-only zip 打包器（M8 weaver 整合包导出）。
 * 零新依赖：手写 zip 结构 + zlib crc32。整合包（mods/config/资源包等小文件）
 * 体积场景足够；不做压缩级别调优/加密/分卷。
 *
 * 提供两层 API：
 *  - `collectZipEntries` + `zipEntries`：显式清单打包，支持改名映射（如 run/mods/x.jar → overrides/mods/x.jar）
 *  - `zipDirectory`：整目录打包（委托上两者，签名与行为保持不变）
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

/** 打包时排除的目录与文件后缀（构建产物、VCS、IDE、运行目录、已导出的 dist） */
const EXCLUDED_DIRS = new Set([
  'build',
  'dist',
  '.gradle',
  '.git',
  '.idea',
  '.vscode',
  'run',
  'out'
])

/**
 * zip 条目：`name` 为包内 POSIX 路径。
 * `from: 'file'` 从磁盘取内容；`from: 'data'` 用内联内容（清单/README 等现场生成的文本）。
 */
export type ZipEntry =
  | { name: string; from: 'file'; absPath: string }
  | { name: string; from: 'data'; data: Buffer | string }

/** 收集选项 */
export interface CollectZipOptions {
  /** 追加排除的目录名（与默认排除表合并） */
  extraExcludedDirs?: Iterable<string>
  /** 包内路径前缀（POSIX，可为空） */
  prefix?: string
  /** 过滤回调：入参为包内相对路径（不含 prefix），返回 false 则跳过该文件 */
  filter?: (relPath: string) => boolean
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

function walk(
  base: string,
  rel: string,
  excluded: Set<string>,
  prefix: string,
  filter: ((relPath: string) => boolean) | undefined,
  acc: ZipEntry[]
): ZipEntry[] {
  for (const name of readdirSync(base)) {
    const abs = join(base, name)
    const st = statSync(abs)
    const childRel = rel ? posix.join(rel, name) : name
    if (st.isDirectory()) {
      if (excluded.has(name)) continue
      walk(abs, childRel, excluded, prefix, filter, acc)
    } else {
      if (filter && !filter(childRel)) continue
      acc.push({ name: prefix ? posix.join(prefix, childRel) : childRel, from: 'file', absPath: abs })
    }
  }
  return acc
}

/**
 * 收集目录下的文件清单（不读取内容，仅产出路径映射）。
 * 包内路径统一使用 POSIX 分隔符；默认排除构建产物/VCS/运行目录。
 */
export function collectZipEntries(root: string, opts: CollectZipOptions = {}): ZipEntry[] {
  const excluded = new Set(EXCLUDED_DIRS)
  if (opts.extraExcludedDirs) {
    for (const d of opts.extraExcludedDirs) excluded.add(d)
  }
  return walk(root, '', excluded, opts.prefix ?? '', opts.filter, [])
}

/** 将显式清单打包为确定性输出（固定时间戳）的 store-only zip */
export function zipEntries(entries: ZipEntry[], outZipPath: string): void {
  const records = entries.map((e) => {
    const data = e.from === 'file' ? readFileSync(e.absPath) : Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8')
    return { name: e.name, data, crc: crc32(data) }
  })

  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const e of records) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(0, 8) // store，无压缩
    local.writeUInt16LE(0, 10) // time
    local.writeUInt16LE(0x21, 12) // date（1980-01-01，确定性）
    local.writeUInt32LE(e.crc, 14)
    local.writeUInt32LE(e.data.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, e.data)

    // 中央目录头字段偏移：16=crc32 20=压缩后 24=原始 28=名长 30=扩展 34=磁盘 42=本地头偏移
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8) // UTF-8 names
    central.writeUInt16LE(0, 10) // store，无压缩
    central.writeUInt16LE(0, 12) // time
    central.writeUInt16LE(0x21, 14) // date（1980-01-01，确定性）
    central.writeUInt32LE(e.crc, 16)
    central.writeUInt32LE(e.data.length, 20)
    central.writeUInt32LE(e.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra length
    central.writeUInt16LE(0, 32) // comment length
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attributes
    central.writeUInt32LE(0, 38) // external attributes
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuf)

    offset += 30 + nameBuf.length + e.data.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(records.length, 8)
  end.writeUInt16LE(records.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)

  const outDir = dirname(outZipPath)
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  writeFileSync(outZipPath, Buffer.concat([...localParts, centralBuf, end]))
}

/** 将目录打包为确定性输出（固定时间戳）的 store-only zip */
export function zipDirectory(root: string, outZipPath: string): void {
  zipEntries(collectZipEntries(root), outZipPath)
}