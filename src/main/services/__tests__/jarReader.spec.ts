/**
 * jar/zip 读取器测试：store/deflate 条目还原、目录识别、sha256、损坏报错。
 */
import { createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { openZipBuffer, sha256Hex } from '../performance/jarReader'

/** 最小 store-only zip 构造（测试夹具） */
function buildZip(entries: Array<{ name: string; data: Buffer; method: 0 | 8 }>): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const metas: Array<{ crc: number; size: number; csize: number; offset: number }> = []

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const stored = e.method === 8 ? deflateRawSync(e.data) : e.data
    const crc = crc32(e.data)
    metas.push({ crc, size: e.data.length, csize: stored.length, offset })

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(e.method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(e.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, stored)
    offset += 30 + nameBuf.length + stored.length
  }

  let centralSize = 0
  entries.forEach((e, i) => {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const m = metas[i]!
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(e.method, 10)
    central.writeUInt32LE(m.crc, 16)
    central.writeUInt32LE(m.csize, 20)
    central.writeUInt32LE(m.size, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(m.offset, 42)
    centralParts.push(central, nameBuf)
    centralSize += 46 + nameBuf.length
  })

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...localParts, ...centralParts, eocd])
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const b of buf) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

describe('jarReader', () => {
  const aData = Buffer.from('hello store', 'utf8')
  const bData = Buffer.from('deflate '.repeat(50), 'utf8')

  const zipBuffer = buildZip([
    { name: 'a.txt', data: aData, method: 0 },
    { name: 'b.txt', data: bData, method: 8 },
    { name: 'dir/', data: Buffer.alloc(0), method: 0 }
  ])

  it('列出条目并正确识别属性', () => {
    const reader = openZipBuffer(zipBuffer)
    const entries = reader.entries()
    expect(entries).toHaveLength(3)
    expect(entries[0]).toMatchObject({ path: 'a.txt', method: 0, size: aData.length, isDirectory: false })
    expect(entries[1]?.method).toBe(8)
    expect(entries[2]?.isDirectory).toBe(true)
    expect(reader.has('a.txt')).toBe(true)
    expect(reader.has('nope')).toBe(false)
  })

  it('store 与 deflate 条目均能完整还原', () => {
    const reader = openZipBuffer(zipBuffer)
    expect(reader.read('a.txt').equals(aData)).toBe(true)
    expect(reader.read('b.txt').equals(bData)).toBe(true)
  })

  it('读取不存在条目抛错', () => {
    const reader = openZipBuffer(zipBuffer)
    expect(() => reader.read('missing.txt')).toThrow(/未找到/)
  })

  it('sha256 与独立计算一致', () => {
    const expected = createHash('sha256').update(zipBuffer).digest('hex')
    expect(sha256Hex(zipBuffer)).toBe(expected)
  })

  it('损坏 buffer 抛可识别错误', () => {
    expect(() => openZipBuffer(Buffer.from('not a zip at all'))).toThrow(/EOCD|zip/)
    expect(() => openZipBuffer(Buffer.alloc(40))).toThrow()
  })
})
