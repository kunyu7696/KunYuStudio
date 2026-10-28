/**
 * 零依赖 jar/zip 读取器：解析中央目录，按条目解压（store / deflate）。
 * 支持文件路径或 Buffer 输入（测试与手动导入场景）。
 *
 * 不支持 ZIP64（模组 jar 体积/条目数不会触及），检测到 ZIP64 字段时明确报错。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

export interface ZipEntry {
  /** POSIX 风格路径 */
  path: string
  /** 解压后大小 */
  size: number
  compressedSize: number
  /** 压缩方式：0 = store，8 = deflate */
  method: number
  isDirectory: boolean
}

export interface ZipReader {
  entries(): ZipEntry[]
  has(path: string): boolean
  read(path: string): Buffer
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

interface CentralEntry {
  meta: ZipEntry
  method: number
  compressedSize: number
  localOffset: number
}

/** 从文件路径打开 zip/jar */
export function openZip(file: string): ZipReader {
  return createZipReader(readFileSync(file))
}

/** 从 Buffer 打开 zip/jar */
export function openZipBuffer(buffer: Buffer): ZipReader {
  return createZipReader(buffer)
}

/** 计算文件/缓冲 sha256（十六进制） */
export function sha256Hex(input: string | Buffer): string {
  const buffer = typeof input === 'string' ? readFileSync(input) : input
  return createHash('sha256').update(buffer).digest('hex')
}

function createZipReader(buffer: Buffer): ZipReader {
  const central = parseCentralDirectory(buffer)
  const byPath = new Map<string, CentralEntry>()
  for (const e of central) byPath.set(e.meta.path, e)

  function read(path: string): Buffer {
    const entry = byPath.get(path)
    if (!entry) throw new Error(`zip 内未找到条目：${path}`)
    // 定位本地头获取实际数据偏移（name/extra 长度可能与中央目录不同）
    let offset = entry.localOffset
    if (buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
      throw new Error(`本地文件头签名损坏：${path}`)
    }
    const nameLen = buffer.readUInt16LE(offset + 26)
    const extraLen = buffer.readUInt16LE(offset + 28)
    const dataStart = offset + 30 + nameLen + extraLen
    const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize)
    if (entry.method === 0) return Buffer.from(raw)
    if (entry.method === 8) return inflateRawSync(raw)
    throw new Error(`不支持的压缩方式 ${entry.method}：${path}`)
  }

  return {
    entries: () => central.map((e) => ({ ...e.meta })),
    has: (path) => byPath.has(path),
    read
  }
}

/** 解析 EOCD → 遍历中央目录条目 */
function parseCentralDirectory(buffer: Buffer): CentralEntry[] {
  const eocdOffset = findEocd(buffer)
  if (buffer.readUInt32LE(eocdOffset) !== EOCD_SIGNATURE) {
    throw new Error('zip EOCD 签名损坏，不是有效的 zip/jar 文件')
  }
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const centralSize = buffer.readUInt32LE(eocdOffset + 12)
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16)

  // ZIP64 标记：字段为 0xFFFFFFFF
  if (centralOffset === 0xffffffff || centralSize === 0xffffffff || totalEntries === 0xffff) {
    throw new Error('该 zip 使用 ZIP64 格式，当前读取器暂不支持')
  }
  if (centralOffset + centralSize > buffer.length) {
    throw new Error('中央目录越界，zip 文件已损坏')
  }

  const entries: CentralEntry[] = []
  let cursor = centralOffset
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error(`中央目录第 ${i + 1} 条签名损坏`)
    }
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLen = buffer.readUInt16LE(cursor + 28)
    const extraLen = buffer.readUInt16LE(cursor + 30)
    const commentLen = buffer.readUInt16LE(cursor + 32)
    const diskStart = buffer.readUInt16LE(cursor + 34)
    const localOffset = buffer.readUInt32LE(cursor + 42)

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error('该 zip 使用 ZIP64 格式，当前读取器暂不支持')
    }
    if (diskStart !== 0) {
      throw new Error('该 zip 跨多磁盘，当前读取器暂不支持')
    }

    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8')
    const isDirectory = name.endsWith('/')
    entries.push({
      meta: {
        path: normalizeZipPath(name),
        size: uncompressedSize,
        compressedSize,
        method,
        isDirectory
      },
      method,
      compressedSize,
      localOffset
    })
    cursor += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 定位 EOCD：从尾部扫描（含注释情况） */
function findEocd(buffer: Buffer): number {
  // EOCD 最小长度 22；注释最长 65535
  const minStart = Math.max(0, buffer.length - 22 - 0xffff)
  for (let i = buffer.length - 22; i >= minStart; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i
  }
  throw new Error('未找到 zip EOCD，不是有效的 zip/jar 文件')
}

function normalizeZipPath(name: string): string {
  return name.split('\\').join('/')
}
