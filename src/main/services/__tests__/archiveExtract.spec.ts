/**
 * 零配置运行环境 3a：归档解包单测（不触网、不起 electron）。
 * 用内存构造的最小 .zip / .tar.gz 校验解包正确性、顶层剥离与 zip-slip 防护。
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  extractArchiveToDir,
  extractTarGzToDir,
  extractZipToDir,
  normalizeEntryName
} from '../archiveExtract'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kunyu-arc-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

interface ZipEntry {
  name: string
  data?: Buffer
  /** 0=stored, 8=deflate；目录条目固定 stored 空体 */
  method?: 0 | 8
  dir?: boolean
}

/** 构造内存 zip（不计算 CRC——本解包器不校验 CRC） */
function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const method: 0 | 8 = e.dir ? 0 : (e.method ?? 8)
    const raw = e.dir ? Buffer.alloc(0) : (e.data ?? Buffer.alloc(0))
    const comp = method === 8 ? deflateRawSync(raw) : raw
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    const localFull = Buffer.concat([local, name, comp])
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(comp.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, name]))
    locals.push(localFull)
    offset += localFull.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

/** 构造 ustar tar 头（checksum 计算后回填） */
function tarHeader(name: string, size: number, typeflag: string, prefix = ''): Buffer {
  const h = Buffer.alloc(512)
  h.write(name, 0, 100, 'utf8')
  h.write('0000644\0', 100, 8, 'ascii')
  h.write('0000000\0', 108, 8, 'ascii')
  h.write('0000000\0', 116, 8, 'ascii')
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii')
  h.write('00000000000\0', 136, 12, 'ascii')
  h.write('        ', 148, 8, 'ascii')
  h.write(typeflag, 156, 1, 'ascii')
  h.write('ustar\0', 257, 6, 'ascii')
  h.write('00', 263, 2, 'ascii')
  h.write(prefix, 345, 155, 'utf8')
  let sum = 0
  for (let i = 0; i < 512; i++) sum += h[i]
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return h
}

function pad512(buf: Buffer): Buffer {
  const rem = buf.length % 512
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(512 - rem)])
}

/** 构造含顶层目录 jdk-17/ 的 tar.gz */
function buildTarGz(): Buffer {
  const chunks: Buffer[] = []
  chunks.push(tarHeader('jdk-17/', 0, '5'))
  chunks.push(tarHeader('jdk-17/bin/', 0, '5'))
  const java = Buffer.from('#!/bin/sh\necho java\n', 'utf8')
  chunks.push(tarHeader('jdk-17/bin/java', java.length, '0'), pad512(java))
  const modules = Buffer.from('modules', 'utf8')
  chunks.push(tarHeader('jdk-17/lib/modules', modules.length, '0'), pad512(modules))
  chunks.push(Buffer.alloc(1024)) // 两个空块表示结束
  return gzipSync(Buffer.concat(chunks))
}

describe('normalizeEntryName（zip-slip 防护）', () => {
  it('拒绝绝对路径与 .. 逃逸，归一化反斜杠', () => {
    expect(normalizeEntryName('jdk/bin/java')).toBe('jdk/bin/java')
    expect(normalizeEntryName('/abs/path')).toBe('abs/path')
    expect(normalizeEntryName('a\\b\\c')).toBe('a/b/c')
    expect(normalizeEntryName('../evil')).toBeNull()
    expect(normalizeEntryName('a/../../evil')).toBeNull()
    expect(normalizeEntryName('')).toBeNull()
    expect(normalizeEntryName('./')).toBeNull()
  })
})

describe('extractZipToDir', () => {
  it('解包 deflate/stored/目录条目并剥离顶层', () => {
    const zip = buildZip([
      { name: 'jdk-17/bin/', dir: true },
      { name: 'jdk-17/bin/java.exe', data: Buffer.from('MZ'), method: 8 },
      { name: 'jdk-17/lib/modules', data: Buffer.from('modules-data'), method: 0 }
    ])
    const written = extractZipToDir(zip, dir, { stripComponents: 1 })
    expect(written.sort()).toEqual(['bin/java.exe', 'lib/modules'])
    expect(readFileSync(join(dir, 'bin', 'java.exe'), 'utf8')).toBe('MZ')
    expect(readFileSync(join(dir, 'lib', 'modules'), 'utf8')).toBe('modules-data')
    expect(statSync(join(dir, 'bin')).isDirectory()).toBe(true)
  })

  it('拒绝 zip-slip 条目（不落盘到目标目录外）', () => {
    const zip = buildZip([{ name: '../escape.txt', data: Buffer.from('x'), method: 0 }])
    const written = extractZipToDir(zip, dir, { stripComponents: 0 })
    expect(written).toEqual([])
  })

  it('非 zip 输入抛错', () => {
    expect(() => extractZipToDir(Buffer.from('not a zip'), dir)).toThrow(/中央目录/)
  })
})

describe('extractTarGzToDir', () => {
  it('解包 ustar tar.gz 并剥离顶层目录', () => {
    const written = extractTarGzToDir(buildTarGz(), dir, { stripComponents: 1 })
    expect(written.sort()).toEqual(['bin/java', 'lib/modules'])
    expect(readFileSync(join(dir, 'bin', 'java'), 'utf8')).toContain('#!/bin/sh')
    expect(readFileSync(join(dir, 'lib', 'modules'), 'utf8')).toBe('modules')
  })

  it('extractArchiveToDir 按扩展名分派', () => {
    const written = extractArchiveToDir(buildTarGz(), dir, '.tar.gz', { stripComponents: 1 })
    expect(written).toContain('bin/java')
  })

  it('不支持的扩展名抛错', () => {
    expect(() => extractArchiveToDir(Buffer.alloc(10), dir, '.7z')).toThrow(/不支持/)
  })
})
