/**
 * fsService.readBinaryFile 测试：
 * - 正常读取返回 base64 + MIME + 原始大小
 * - 超过 20MB 上限拒绝（防渲染进程被 base64 撑爆）
 * - 未注册根目录越界拒绝
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  moveEntry,
  readBinaryFile,
  registerProjectRoot,
  searchFiles,
  unregisterProjectRoot
} from '../fsService'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-fs-'))
  registerProjectRoot(root)
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('readBinaryFile', () => {
  it('读取 PNG 返回 base64 与 image/png', () => {
    const p = join(root, 'icon.png')
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    writeFileSync(p, payload)
    const result = readBinaryFile(p)
    expect(result.mime).toBe('image/png')
    expect(result.size).toBe(payload.length)
    expect(Buffer.from(result.dataBase64, 'base64').equals(payload)).toBe(true)
    expect(result.mtime).toBeGreaterThan(0)
  })

  it('未知扩展名回退 application/octet-stream', () => {
    const p = join(root, 'data.bin')
    writeFileSync(p, Buffer.alloc(4))
    expect(readBinaryFile(p).mime).toBe('application/octet-stream')
  })

  it('超过 20MB 上限拒绝读取', () => {
    const p = join(root, 'huge.png')
    writeFileSync(p, Buffer.alloc(21 * 1024 * 1024))
    expect(() => readBinaryFile(p)).toThrow(/文件过大/)
  })

  it('未注册根目录的路径越界拒绝', () => {
    const outsider = join(tmpdir(), `kunyu-outsider-${process.pid}.png`)
    writeFileSync(outsider, Buffer.alloc(4))
    try {
      expect(() => readBinaryFile(outsider)).toThrow(/路径越界/)
    } finally {
      rmSync(outsider, { force: true })
    }
  })
})

describe('moveEntry', () => {
  it('文件跨目录移动成功', () => {
    const src = join(root, 'a.txt')
    const destDir = join(root, 'sub')
    writeFileSync(src, 'hello')
    mkdirSync(destDir)
    const target = moveEntry(src, destDir)
    expect(target).toBe(join(destDir, 'a.txt'))
    expect(existsSync(src)).toBe(false)
    expect(existsSync(target)).toBe(true)
  })

  it('目标已存在时拒绝', () => {
    const src = join(root, 'a.txt')
    const destDir = join(root, 'sub')
    writeFileSync(src, 'hello')
    mkdirSync(destDir)
    writeFileSync(join(destDir, 'a.txt'), 'occupied')
    expect(() => moveEntry(src, destDir)).toThrow(/目标已存在/)
    expect(existsSync(src)).toBe(true) // 源未被动
  })

  it('目录不能移动到它自己内部', () => {
    const dirA = join(root, 'A')
    const dirAB = join(dirA, 'B')
    mkdirSync(dirAB, { recursive: true })
    expect(() => moveEntry(dirA, dirAB)).toThrow(/自己内部/)
  })

  it('目标不是目录时拒绝', () => {
    const src = join(root, 'a.txt')
    const notDir = join(root, 'b.txt')
    writeFileSync(src, 'x')
    writeFileSync(notDir, 'y')
    expect(() => moveEntry(src, notDir)).toThrow(/不是目录/)
  })
})

describe('searchFiles', () => {
  beforeEach(() => {
    mkdirSync(join(root, 'src/main/java'), { recursive: true })
    mkdirSync(join(root, 'node_modules/pkg'), { recursive: true })
    writeFileSync(join(root, 'src/main/java/BlockA.java'), '')
    writeFileSync(join(root, 'src/main/java/ItemB.java'), '')
    writeFileSync(join(root, 'README.md'), '')
    writeFileSync(join(root, 'node_modules/pkg/BlockShadow.java'), '')
  })

  it('大小写不敏感子串匹配', () => {
    const hits = searchFiles(root, 'blocka')
    expect(hits.map((h) => h.name)).toEqual(['BlockA.java'])
  })

  it('排除目录（node_modules）内的同名文件不命中', () => {
    const hits = searchFiles(root, 'block')
    expect(hits.some((h) => h.path.includes('node_modules'))).toBe(false)
    expect(hits.length).toBe(1)
  })

  it('空查询返回空数组', () => {
    expect(searchFiles(root, '  ')).toEqual([])
  })
})
