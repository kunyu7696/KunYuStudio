/**
 * modelerIo 纯函数层测试：PNG 解析校验（尺寸上限/非法输入）与 data URL 保留。
 * 对话框/落盘胶层（importTexturePngDialog/exportTexturePngDialog）由契约测试覆盖通道注册。
 * bbmodel 独立 PNG 引用：safeTextureRelPath / resolveBbmodelLinkedTextures /
 * materializeBbmodelTextures 的读盘/落盘行为用临时目录实测。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { encodePng, type Raster } from '../../ai/pixelize'
import {
  materializeBbmodelTextures,
  MODELER_TEXTURE_MAX_SIZE,
  resolveBbmodelLinkedTextures,
  safeTextureRelPath,
  textureFromPngBuffer
} from '../modelerIo'

/** 造一张 w×h 纯色 PNG */
function pngOf(width: number, height: number): Buffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255
    data[i + 3] = 255
  }
  const raster: Raster = { width, height, data }
  return encodePng(raster)
}

describe('textureFromPngBuffer', () => {
  it('合法 PNG：尺寸解析正确，data URL 保留原始字节', () => {
    const buf = pngOf(32, 16)
    const parsed = textureFromPngBuffer(buf)
    expect(parsed.width).toBe(32)
    expect(parsed.height).toBe(16)
    expect(parsed.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    // 原样字节（导入不缩放、不重编码，避免像素损失）
    expect(Buffer.from(parsed.dataUrl.split(',')[1]!, 'base64').equals(buf)).toBe(true)
  })

  it('边界：512×512 通过', () => {
    const parsed = textureFromPngBuffer(pngOf(MODELER_TEXTURE_MAX_SIZE, MODELER_TEXTURE_MAX_SIZE))
    expect(parsed.width).toBe(MODELER_TEXTURE_MAX_SIZE)
  })

  it('超尺寸（513）报错并提示上限', () => {
    expect(() => textureFromPngBuffer(pngOf(513, 16))).toThrow(/超出上限 512/)
  })

  it('非 PNG 内容报错', () => {
    expect(() => textureFromPngBuffer(Buffer.from('not a png'))).toThrow()
  })

  it('空缓冲区报错', () => {
    expect(() => textureFromPngBuffer(Buffer.alloc(0))).toThrow(/为空/)
  })
})

/* ------------------------------------------------------------------ */
/* bbmodel 独立 PNG 引用（path ↔ ModelTexture.file）                     */
/* ------------------------------------------------------------------ */

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'modelerio-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('safeTextureRelPath', () => {
  it('接受相对 POSIX 路径并规范化反斜杠/冗余段', () => {
    expect(safeTextureRelPath('textures/foo.png')).toBe('textures/foo.png')
    expect(safeTextureRelPath('textures\\sub\\foo.png')).toBe('textures/sub/foo.png')
    expect(safeTextureRelPath('foo.png')).toBe('foo.png')
    expect(safeTextureRelPath('./textures/./foo.png')).toBe('textures/foo.png')
  })

  it('拒绝绝对路径/盘符/.. 逃逸/空串', () => {
    expect(safeTextureRelPath('')).toBeNull()
    expect(safeTextureRelPath('/abs/foo.png')).toBeNull()
    expect(safeTextureRelPath('C:/work/foo.png')).toBeNull()
    expect(safeTextureRelPath('c:\\work\\foo.png')).toBeNull()
    expect(safeTextureRelPath('../foo.png')).toBeNull()
    expect(safeTextureRelPath('textures/../foo.png')).toBeNull()
    expect(safeTextureRelPath('..')).toBeNull()
  })
})

describe('resolveBbmodelLinkedTextures', () => {
  it('外链贴图按 .bbmodel 目录解引用：origin 填入 data URL，缺失尺寸补齐', () => {
    const dir = makeTmpDir()
    const png = pngOf(24, 8)
    writeFileSync(join(dir, 'linked.png'), png)
    const bbmodel = JSON.stringify({
      textures: [{ uuid: 't1', name: 'linked.png', path: 'linked.png' }]
    })
    const { content, warnings } = resolveBbmodelLinkedTextures(bbmodel, dir)
    expect(warnings).toEqual([])
    const tex = (JSON.parse(content) as { textures: Array<Record<string, unknown>> }).textures[0]!
    expect(tex.origin).toBe(`data:image/png;base64,${png.toString('base64')}`)
    expect(tex.width).toBe(24)
    expect(tex.height).toBe(8)
  })

  it('已内嵌 origin 的条目不读盘、原样返回（content 字符串不变）', () => {
    const dir = makeTmpDir()
    const bbmodel = JSON.stringify({
      textures: [{ uuid: 't1', name: 'a.png', path: 'missing.png', origin: 'data:image/png;base64,AAAA' }]
    })
    const { content, warnings } = resolveBbmodelLinkedTextures(bbmodel, dir)
    expect(content).toBe(bbmodel)
    expect(warnings).toEqual([])
  })

  it('外链读不到：替换为合法空白 PNG 并记告警（像素链保持可用）', () => {
    const dir = makeTmpDir()
    const bbmodel = JSON.stringify({
      textures: [{ uuid: 't1', name: 'gone.png', path: 'textures/gone.png', width: 32, height: 16 }]
    })
    const { content, warnings } = resolveBbmodelLinkedTextures(bbmodel, dir)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('textures/gone.png')
    const tex = (JSON.parse(content) as { textures: Array<Record<string, unknown>> }).textures[0]!
    expect(typeof tex.origin).toBe('string')
    expect((tex.origin as string).startsWith('data:image/png;base64,')).toBe(true)
    expect(tex.width).toBe(32)
    expect(tex.height).toBe(16)
  })

  it('非法 JSON / 无 textures 数组：原样返回不报错', () => {
    expect(resolveBbmodelLinkedTextures('not json', makeTmpDir()).content).toBe('not json')
    expect(resolveBbmodelLinkedTextures('{"a":1}', makeTmpDir()).content).toBe('{"a":1}')
  })
})

describe('materializeBbmodelTextures', () => {
  it('按引用路径把 PNG 物化到 .bbmodel 目录（含子目录创建），字节一致', () => {
    const dir = makeTmpDir()
    const png = pngOf(16, 16)
    const r = materializeBbmodelTextures(join(dir, 'golem.bbmodel'), [
      { file: 'textures/deco.png', data: `data:image/png;base64,${png.toString('base64')}`, name: 'deco' }
    ])
    expect(r.warnings).toEqual([])
    expect(r.written).toBe(1)
    const landed = readFileSync(join(dir, 'textures', 'deco.png'))
    expect(landed.equals(png)).toBe(true)
  })

  it('路径越界（绝对/..）逐条告警不落地、不中断后续贴图', () => {
    const dir = makeTmpDir()
    const png = pngOf(8, 8)
    const data = `data:image/png;base64,${png.toString('base64')}`
    const r = materializeBbmodelTextures(join(dir, 'golem.bbmodel'), [
      { file: '../escape.png', data, name: 'bad1' },
      { file: 'C:/abs/evil.png', data, name: 'bad2' },
      { file: 'ok.png', data, name: 'good' }
    ])
    expect(r.written).toBe(1)
    expect(r.warnings).toHaveLength(2)
    expect(existsSync(join(dir, 'ok.png'))).toBe(true)
    expect(existsSync(join(dir, '..', 'escape.png'))).toBe(false)
  })

  it('非法 data URL 记告警继续，不影响其他贴图', () => {
    const dir = makeTmpDir()
    const png = pngOf(8, 8)
    const r = materializeBbmodelTextures(join(dir, 'golem.bbmodel'), [
      { file: 'bad.png', data: 'not-a-data-url', name: 'bad' },
      { file: 'good.png', data: `data:image/png;base64,${png.toString('base64')}`, name: 'good' }
    ])
    expect(r.written).toBe(1)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toContain('bad.png')
  })
})
