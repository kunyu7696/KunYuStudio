/**
 * 运行完整性核对测试（半成品被判成功）。
 * findMissingContentTypes：核对计划承诺的、有语义目录的内容类型是否真正落盘。
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findMissingContentTypes } from '../contentService'

const dirs: string[] = []
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'ky-complete-'))
  dirs.push(d)
  return d
}
/** 在项目下放置某语义类型的一个 JSON 文件 */
function placeKind(root: string, dirName: string, id = 'a'): void {
  const dir = join(root, '.kunyu', 'content', dirName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.json`), '{}')
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

describe('findMissingContentTypes（承诺类型完整性核对）', () => {
  it('空项目：承诺 block+recipe，两者都缺失', () => {
    const root = freshDir()
    expect(findMissingContentTypes(root, ['block', 'recipe'])).toEqual(['block', 'recipe'])
  })

  it('block 已落盘、recipe 未生成：仅报 recipe 缺失', () => {
    const root = freshDir()
    placeKind(root, 'blocks')
    expect(findMissingContentTypes(root, ['block', 'recipe'])).toEqual(['recipe'])
  })

  it('两类都已落盘：无缺失', () => {
    const root = freshDir()
    placeKind(root, 'blocks')
    placeKind(root, 'recipes')
    expect(findMissingContentTypes(root, ['block', 'recipe'])).toEqual([])
  })

  it('gui/mixin/command 等无独立语义目录的类型不参与核对', () => {
    const root = freshDir()
    expect(findMissingContentTypes(root, ['gui', 'mixin', 'command'])).toEqual([])
  })

  it('复数形式与重复类型归一化去重', () => {
    const root = freshDir()
    expect(findMissingContentTypes(root, ['recipes', 'recipe'])).toEqual(['recipe'])
  })

  it('generated.json 占位文件不计为已交付', () => {
    const root = freshDir()
    const dir = join(root, '.kunyu', 'content', 'recipes')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'generated.json'), '{}')
    expect(existsSync(dir)).toBe(true)
    expect(findMissingContentTypes(root, ['recipe'])).toEqual(['recipe'])
  })
})
