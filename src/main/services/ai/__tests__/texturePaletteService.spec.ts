/**
 * texturePaletteService 单测：默认值回退、写入回读、损坏 JSON 不抛错、patch 合并不丢字段。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_TEXTURE_PALETTE,
  readTexturePalette,
  writeTexturePalette
} from '../texturePaletteService'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-palette-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writeRaw(content: string): void {
  mkdirSync(join(root, '.kunyu'), { recursive: true })
  writeFileSync(join(root, '.kunyu', 'texture-palette.json'), content, 'utf-8')
}

describe('texturePaletteService', () => {
  it('文件不存在返回默认值', () => {
    expect(readTexturePalette(root)).toEqual({ ...DEFAULT_TEXTURE_PALETTE, palette: [] })
  })

  it('写入后回读一致', () => {
    writeTexturePalette(root, { palette: ['#112233', '#aabbcc'], maxColors: 8, dither: 'none' })
    const got = readTexturePalette(root)
    expect(got.palette).toEqual(['#112233', '#aabbcc'])
    expect(got.maxColors).toBe(8)
    expect(got.dither).toBe('none')
  })

  it('损坏 JSON 返回默认值且不抛错', () => {
    writeRaw('{ not json')
    expect(() => readTexturePalette(root)).not.toThrow()
    expect(readTexturePalette(root)).toEqual({ ...DEFAULT_TEXTURE_PALETTE, palette: [] })
  })

  it('字段非法回退默认（越界夹取，非法色板项丢弃）', () => {
    writeRaw(
      JSON.stringify({
        maxColors: 9999,
        outlineFactor: 5,
        dither: 'weird',
        downsample: 'bilinear',
        palette: ['#ffffff', 'oops']
      })
    )
    const got = readTexturePalette(root)
    expect(got.maxColors).toBe(256)
    expect(got.outlineFactor).toBe(1)
    expect(got.dither).toBe('floyd')
    expect(got.downsample).toBe('area')
    expect(got.palette).toEqual(['#ffffff'])
  })

  it('patch 合并不丢字段', () => {
    writeTexturePalette(root, { palette: ['#010203'] })
    writeTexturePalette(root, { maxColors: 16 })
    const got = readTexturePalette(root)
    expect(got.palette).toEqual(['#010203'])
    expect(got.maxColors).toBe(16)
    expect(got.dither).toBe(DEFAULT_TEXTURE_PALETTE.dither)
    expect(got.downsample).toBe('area')
    expect(got.outline).toBe(DEFAULT_TEXTURE_PALETTE.outline)
    expect(got.outlineFactor).toBe(DEFAULT_TEXTURE_PALETTE.outlineFactor)
  })
})
