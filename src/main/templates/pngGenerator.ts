import { deflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'

/**
 * 生成 16×16 纯色 PNG（RGBA）的 Buffer。
 * 用于 Fabric 模板中的方块占位贴图，避免在源码中嵌入二进制资源。
 */
export function createSolidPng(
  r: number,
  g: number,
  b: number,
  size = 16,
  a = 255
): Buffer {
  const width = size
  const height = size

  // 每个扫描线 = 1 字节 filter + width * 4 字节 RGBA
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4)
    raw[rowStart] = 0 // filter: None
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 4
      raw[p] = r
      raw[p + 1] = g
      raw[p + 2] = b
      raw[p + 3] = a
    }
  }

  const compressed = deflateSync(raw)

  const chunks: Buffer[] = []

  // PNG signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  chunks.push(makeChunk('IHDR', ihdr))

  // IDAT
  chunks.push(makeChunk('IDAT', compressed))

  // IEND
  chunks.push(makeChunk('IEND', Buffer.alloc(0)))

  return Buffer.concat(chunks)
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

// PNG 8 字节签名（137 80 78 71 13 10 26 10）
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/**
 * 读取 PNG 尺寸：仅解析 IHDR chunk（紧跟签名，offset 16-19=宽、20-23=高，big-endian uint32）。
 * 文件 <24 字节、签名错误或非 PNG 返回 null。本函数为验收契约 texture-ready 断言提供。
 */
export function readPngSize(absPath: string): { w: number; h: number } | null {
  let buf: Buffer
  try {
    buf = readFileSync(absPath)
  } catch {
    return null
  }
  if (buf.length < 24) return null
  // 签名校验（前 8 字节）
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) return null
  }
  // IHDR 紧跟签名：4 字节长度 + 4 字节类型('IHDR') + 13 字节数据（width[4]+height[4]+...）
  // width 在 offset 16-19，height 在 offset 20-23
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  if (w === 0 || h === 0) return null
  return { w, h }
}

/** 仅从 Buffer 解析 PNG 尺寸（单测用，避免磁盘依赖）。 */
export function readPngSizeFromBuffer(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24) return null
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) return null
  }
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  if (w === 0 || h === 0) return null
  return { w, h }
}
