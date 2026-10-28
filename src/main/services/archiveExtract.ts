/**
 * 零配置运行环境：归档解包（仅服务于 JDK 置备，不追求通用性）。
 *
 * 只处理 JDK 官方分发包实际使用的两种容器：Windows 的 .zip 与跨平台的 .tar.gz。
 * 全部基于 node:zlib 自行解析，**不引入任何外部依赖**——国内网络/离线环境下
 * 新增 npm 依赖容易装不上，JDK 置备这条路径必须零依赖可用。
 *
 * 安全边界：任何条目名先归一化为 POSIX 相对路径并拒绝绝对路径与 `..` 逃逸，
 * 保证解包只落在目标目录内（防 zip-slip）。
 */
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync, inflateRawSync } from 'node:zlib'

export interface ExtractOptions {
  /** 剥离的前导目录层数（Adoptium 归档顶层通常是 jdk-<版本>，置备时剥 1 层） */
  stripComponents?: number
}

/**
 * 归一化归档条目名为安全 POSIX 相对路径；不安全（绝对/逃逸/空）返回 null。
 */
export function normalizeEntryName(raw: string): string | null {
  const posix = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!posix) return null
  const parts = posix.split('/')
  if (parts.some((p) => p === '..')) return null
  const cleaned = parts.filter((p) => p !== '' && p !== '.')
  if (cleaned.length === 0) return null
  return cleaned.join('/')
}

/** 剥离前导层；剥到空表示这条本身就是被剥离的顶层目录，返回 null。 */
function strip(name: string, count: number): string | null {
  if (count <= 0) return name
  const parts = name.split('/')
  if (parts.length <= count) return null
  return parts.slice(count).join('/')
}

function safeJoin(destDir: string, rel: string): string {
  return join(destDir, ...rel.split('/'))
}

/** 写入单个文件条目（自动建父目录） */
function writeEntry(destDir: string, rel: string, content: Buffer): void {
  const target = safeJoin(destDir, rel)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

/* ------------------------------- ZIP ---------------------------------- */

const ZIP_EOCD_SIG = 0x06054b50
const ZIP_CD_SIG = 0x02014b50
const ZIP_LOCAL_SIG = 0x04034b50

/** 从尾部向前扫描 End Of Central Directory 记录偏移 */
function findEocd(zip: Buffer): number {
  const minPos = Math.max(0, zip.length - 22 - 0xffff)
  for (let i = zip.length - 22; i >= minPos; i--) {
    if (zip.readUInt32LE(i) === ZIP_EOCD_SIG) return i
  }
  return -1
}

/**
 * 解包 .zip 到 destDir。
 * 支持 stored(0) 与 deflate(8) 两种压缩方法；不支持 zip64（JDK 分发包不会用到）。
 */
export function extractZipToDir(zip: Buffer, destDir: string, opts?: ExtractOptions): string[] {
  const stripCount = opts?.stripComponents ?? 0
  const eocd = findEocd(zip)
  if (eocd < 0) throw new Error('无效的 zip：未找到中央目录结尾记录')
  const total = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)
  if (total === 0xffff || offset === 0xffffffff) {
    throw new Error('暂不支持 zip64 归档')
  }
  const written: string[] = []
  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(offset) !== ZIP_CD_SIG) throw new Error('zip 中央目录损坏')
    const method = zip.readUInt16LE(offset + 10)
    const compSize = zip.readUInt32LE(offset + 20)
    const uncompSize = zip.readUInt32LE(offset + 24)
    const nameLen = zip.readUInt16LE(offset + 28)
    const extraLen = zip.readUInt16LE(offset + 30)
    const commentLen = zip.readUInt16LE(offset + 32)
    const localOffset = zip.readUInt32LE(offset + 42)
    const rawName = zip.toString('utf8', offset + 46, offset + 46 + nameLen)
    offset += 46 + nameLen + extraLen + commentLen

    if (zip.readUInt32LE(localOffset) !== ZIP_LOCAL_SIG) throw new Error('zip 本地头损坏')
    const lNameLen = zip.readUInt16LE(localOffset + 26)
    const lExtraLen = zip.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen

    // 目录条目：名字以 / 结尾，或空数据体
    const isDir = rawName.endsWith('/')
    const rel = normalizeEntryName(rawName)
    if (!rel) continue
    const stripped = strip(rel, stripCount)
    if (!stripped) continue
    if (isDir) {
      mkdirSync(safeJoin(destDir, stripped), { recursive: true })
      continue
    }
    const raw = zip.subarray(dataStart, dataStart + compSize)
    let content: Buffer
    if (method === 0) {
      content = raw
    } else if (method === 8) {
      content = inflateRawSync(raw)
    } else {
      throw new Error(`不支持的 zip 压缩方法：${method}`)
    }
    if (uncompSize !== 0 && content.length !== uncompSize) {
      throw new Error(`zip 条目解压大小不符：${rawName}`)
    }
    writeEntry(destDir, stripped, content)
    written.push(stripped)
  }
  return written
}

/**
 * 只列出 .zip 的条目名（读中央目录，不解压数据体）。
 * 用于 zip 结构探测（如资源库按 shaders/ data/ assets/ 判定包类型）。
 */
export function listZipEntries(zip: Buffer): string[] {
  const eocd = findEocd(zip)
  if (eocd < 0) throw new Error('无效的 zip：未找到中央目录结尾记录')
  const total = zip.readUInt16LE(eocd + 10)
  let offset = zip.readUInt32LE(eocd + 16)
  if (total === 0xffff || offset === 0xffffffff) {
    throw new Error('暂不支持 zip64 归档')
  }
  const names: string[] = []
  for (let i = 0; i < total; i++) {
    if (zip.readUInt32LE(offset) !== ZIP_CD_SIG) throw new Error('zip 中央目录损坏')
    const nameLen = zip.readUInt16LE(offset + 28)
    const extraLen = zip.readUInt16LE(offset + 30)
    const commentLen = zip.readUInt16LE(offset + 32)
    const rawName = zip.toString('utf8', offset + 46, offset + 46 + nameLen)
    offset += 46 + nameLen + extraLen + commentLen
    const rel = normalizeEntryName(rawName)
    if (rel) names.push(rel)
  }
  return names
}

/* ------------------------------ TAR.GZ -------------------------------- */

/** 读取 NUL 结尾的定长字段 */
function readCstr(buf: Buffer, start: number, len: number): string {
  let end = start
  const max = Math.min(start + len, buf.length)
  while (end < max && buf[end] !== 0) end++
  return buf.toString('utf8', start, end)
}

/** 解析八进制数值字段（tar 头） */
function parseOctal(buf: Buffer, start: number, len: number): number {
  const s = readCstr(buf, start, len).trim()
  if (!s) return 0
  const v = Number.parseInt(s, 8)
  return Number.isFinite(v) ? v : 0
}

function isZeroBlock(b: Buffer): boolean {
  for (let i = 0; i < 512; i++) if (b[i] !== 0) return false
  return true
}

/**
 * 解包 .tar.gz 到 destDir。
 * 支持 ustar 前缀字段、GNU 长名（typeflag 'L'）与 pax 扩展头（'x'/'g' 直接跳过）。
 */
export function extractTarGzToDir(gz: Buffer, destDir: string, opts?: ExtractOptions): string[] {
  const stripCount = opts?.stripComponents ?? 0
  const tar = gunzipSync(gz)
  const written: string[] = []
  let offset = 0
  let pendingLongName: string | null = null

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (isZeroBlock(header)) break
    const size = parseOctal(header, 124, 12)
    const typeflag = String.fromCharCode(header[156] || 0x30)
    const dataStart = offset + 512
    const next = dataStart + Math.ceil(size / 512) * 512

    if (typeflag === 'L') {
      pendingLongName = readCstr(tar, dataStart, size)
      offset = next
      continue
    }
    if (typeflag === 'x' || typeflag === 'g' || typeflag === 'K') {
      offset = next // pax/GNU 扩展头：直接跳过
      continue
    }

    let name = readCstr(header, 0, 100)
    const prefix = readCstr(header, 345, 155)
    if (prefix) name = `${prefix}/${name}`
    if (pendingLongName) {
      name = pendingLongName
      pendingLongName = null
    }

    const rel = normalizeEntryName(name)
    const stripped = rel ? strip(rel, stripCount) : null
    if (stripped) {
      if (typeflag === '5') {
        mkdirSync(safeJoin(destDir, stripped), { recursive: true })
      } else if (typeflag === '0' || typeflag === '\u0000') {
        const content = tar.subarray(dataStart, dataStart + size)
        writeEntry(destDir, stripped, Buffer.from(content))
        written.push(stripped)
      } else if (typeflag === '2') {
        // 符号链接：Windows 上跳过（JDK windows tar.gz 不含链接；linux 分发包含 bin 链接）
        if (process.platform !== 'win32') {
          const linkName = readCstr(header, 157, 100)
          const target = safeJoin(destDir, stripped)
          try {
            mkdirSync(dirname(target), { recursive: true })
            symlinkSync(linkName, target)
            written.push(stripped)
          } catch {
            /* 已存在等同名链接时忽略 */
          }
        }
      } else if (typeflag === '3' || typeflag === '4' || typeflag === '6') {
        // 字符/块设备、FIFO：JDK 分发包不含，忽略
      }
    }
    offset = next
  }
  return written
}

/** 按归档扩展名分派（.zip / .tar.gz / .tgz） */
export function extractArchiveToDir(
  archive: Buffer,
  destDir: string,
  ext: string,
  opts?: ExtractOptions
): string[] {
  mkdirSync(destDir, { recursive: true })
  const lower = ext.toLowerCase()
  if (lower.endsWith('.zip')) return extractZipToDir(archive, destDir, opts)
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    return extractTarGzToDir(archive, destDir, opts)
  }
  throw new Error(`不支持的归档格式：${ext}`)
}

/** 给解包产物补执行位（zip 不带 unix 权限；非 Windows 下 bin/java 需可执行） */
export function ensureExecutable(paths: string[], destDir: string): void {
  if (process.platform === 'win32') return
  for (const rel of paths) {
    if (!/(^|\/)(bin|jre\/bin|lib\/jexec)\//.test(rel) && !rel.endsWith('/java')) continue
    try {
      chmodSync(safeJoin(destDir, rel), 0o755)
    } catch {
      /* 无该文件（如链接目标）时忽略 */
    }
  }
}
