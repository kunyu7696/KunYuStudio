/**
 * imageAssetIndex 单测（P2-2）：
 * 扫描/IHDR 快路径/命名空间与类型解析/过滤/上限/withStats 慢路径统计/
 * 关键词检索打分/路径逃逸防护，以及 texture_asset_search 工具接线。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { listImageAssets, searchImageAssets } from '../imageAssetIndex'
import { builtinContentTools } from '../ai/fcTools/contentTools'

let root: string

/** 造一张 PNG 落盘：纯色 or 左半透明红/右半蓝 */
function writePng(rel: string, size: number, mode: 'solid' | 'half-transparent' = 'solid'): void {
  const abs = join(root, ...rel.split('/'))
  mkdirSync(join(abs, '..'), { recursive: true })
  const png = new PNG({ width: size, height: size })
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      const left = x < size / 2
      if (mode === 'half-transparent' && left) {
        png.data[o] = 200; png.data[o + 1] = 0; png.data[o + 2] = 0; png.data[o + 3] = 0
      } else {
        png.data[o] = 30; png.data[o + 1] = 60; png.data[o + 2] = 200; png.data[o + 3] = 255
      }
    }
  }
  writeFileSync(abs, PNG.sync.write(png))
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-assetidx-'))
  writePng('src/main/resources/assets/mymod/textures/block/ruby_ore.png', 16)
  writePng('src/main/resources/assets/mymod/textures/block/ruby_block.png', 16)
  writePng('src/main/resources/assets/mymod/textures/item/ruby_sword.png', 16, 'half-transparent')
  writePng('src/main/resources/assets/mymod/textures/entity/boss/wyvern.png', 64)
  writePng('src/main/resources/assets/othermod/textures/item/copper_ingot.png', 16)
  // 坏文件：扩展名是 .png 但内容不是 PNG → 跳过
  writeFileSync(join(root, 'src/main/resources/assets/mymod/textures/block/broken.png'), 'not a png at all, definitely')
  // 非 PNG 文件 → 不收录
  writeFileSync(join(root, 'src/main/resources/assets/mymod/textures/block/readme.txt'), 'hello')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listImageAssets', () => {
  it('扫描默认根：解析尺寸/命名空间/类型，按 relPath 排序', () => {
    const list = listImageAssets(root)
    expect(list.map((e) => e.relPath)).toEqual([
      'src/main/resources/assets/mymod/textures/block/ruby_block.png',
      'src/main/resources/assets/mymod/textures/block/ruby_ore.png',
      'src/main/resources/assets/mymod/textures/entity/boss/wyvern.png',
      'src/main/resources/assets/mymod/textures/item/ruby_sword.png',
      'src/main/resources/assets/othermod/textures/item/copper_ingot.png'
    ])
    const ore = list.find((e) => e.relPath.endsWith('ruby_ore.png'))!
    expect(ore.namespace).toBe('mymod')
    expect(ore.kind).toBe('block')
    expect(ore.width).toBe(16)
    expect(ore.height).toBe(16)
    expect(ore.hasAlphaChannel).toBe(true) // pngjs 默认写出 colorType 6
    const wyvern = list.find((e) => e.relPath.endsWith('wyvern.png'))!
    expect(wyvern.kind).toBe('entity')
    expect(wyvern.width).toBe(64)
  })

  it('namespace / kind 过滤', () => {
    expect(listImageAssets(root, { namespace: 'othermod' }).map((e) => e.relPath)).toEqual([
      'src/main/resources/assets/othermod/textures/item/copper_ingot.png'
    ])
    expect(listImageAssets(root, { kind: 'item' })).toHaveLength(2)
    expect(listImageAssets(root, { namespace: 'mymod', kind: 'block' })).toHaveLength(2)
  })

  it('limit 截断', () => {
    expect(listImageAssets(root, { limit: 2 })).toHaveLength(2)
  })

  it('roots 逃逸防护：项目外路径一律忽略', () => {
    expect(listImageAssets(root, { roots: ['../outside'] })).toEqual([])
    expect(listImageAssets(root, { roots: ['..'] })).toEqual([])
  })

  it('默认不跑慢路径统计（无 transparentRatio/palette 字段）', () => {
    const list = listImageAssets(root)
    expect(list[0]!.transparentRatio).toBeUndefined()
    expect(list[0]!.palette).toBeUndefined()
  })

  it('withStats：半透明图给出透明占比与主色板', () => {
    const list = listImageAssets(root, { withStats: true, kind: 'item', namespace: 'mymod' })
    const sword = list.find((e) => e.relPath.endsWith('ruby_sword.png'))!
    expect(sword.transparentRatio).toBeCloseTo(0.5, 2)
    expect(sword.palette).toContain('#1e3cc8') // 右半蓝（30,60,200）
  })
})

describe('searchImageAssets', () => {
  it('文件名子串命中排在前面', () => {
    const hits = searchImageAssets(root, 'ruby_sword')
    expect(hits[0]!.relPath).toContain('ruby_sword.png')
  })

  it('多词累计：ruby item 命中的应是 item 下的 ruby_sword', () => {
    const hits = searchImageAssets(root, 'ruby item')
    expect(hits[0]!.relPath).toContain('item/ruby_sword.png')
  })

  it('空关键词 = 列全部', () => {
    expect(searchImageAssets(root, '')).toHaveLength(5)
  })

  it('无命中返回空数组', () => {
    expect(searchImageAssets(root, 'netherite_hoe')).toEqual([])
  })
})

describe('texture_asset_search 工具', () => {
  it('execute 返回匹配清单；无项目根时报错', async () => {
    const tools = builtinContentTools({ projectRoot: () => root })
    const tool = tools.find((t) => t.def.function.name === 'texture_asset_search')!
    expect(tool).toBeDefined()
    const res = await tool.execute({ query: 'ruby', kind: 'block' }, {} as never)
    expect(res.ok).toBe(true)
    expect(res.data).toMatchObject({ count: 2 })

    const noProject = builtinContentTools({ projectRoot: () => null })
    const tool2 = noProject.find((t) => t.def.function.name === 'texture_asset_search')!
    const res2 = await tool2.execute({}, {} as never)
    expect(res2.ok).toBe(false)
    expect(res2.error).toContain('没有打开的项目')
  })
})
