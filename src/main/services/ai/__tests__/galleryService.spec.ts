/**
 * galleryService 单测：
 * - AI 候选入库：元数据 JSON + 缩略图 PNG 双落盘，list 能原样读回（像素/调色板/绑定）
 * - 非法项（像素长度与 size 不符）直接丢弃，不入库
 * - 单条 JSON 损坏只跳过该条，其余条目照常可用（绝不抛错）
 * - 删除：清掉 json+png，不存在/非法 id 返回 false
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteGalleryItem,
  listAssetGallery,
  listGallery,
  listGalleryAll,
  saveGalleryItems
} from '../galleryService'
import type { GallerySaveInputDto } from '../../../../shared/types/ipc'

let root: string

/** 构造一个 16x16 的合法入库项 */
function item(patch: Partial<GallerySaveInputDto> = {}): GallerySaveInputDto {
  return {
    assetKind: 'item',
    assetId: 'ruby_sword',
    size: 16,
    prompt: '寒冰符文剑',
    provider: 'fake-image-model',
    origin: 'agent',
    appliedIndex: 1,
    palette: ['#ff0000', '#00ff00'],
    pixels: Array.from({ length: 256 }, (_, i) => (i % 2 === 0 ? '#ff0000' : '')),
    ...patch
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-gallery-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('galleryService · 入库与读取', () => {
  it('入库后 json + png 双落盘，list 原样读回元数据与像素', () => {
    const saved = saveGalleryItems(root, [item()])
    expect(saved.length).toBe(1)
    const g = saved[0]
    const dir = join(root, '.kunyu', 'gallery')
    expect(existsSync(join(dir, `${g.id}.json`))).toBe(true)
    expect(existsSync(join(dir, `${g.id}.png`))).toBe(true)
    // 缩略图落盘为真 PNG（魔数 0x89PNG）
    expect(readFileSync(join(dir, `${g.id}.png`)).subarray(1, 4).toString('ascii')).toBe('PNG')

    const listed = listGallery(root)
    expect(listed.length).toBe(1)
    expect(listed[0].id).toBe(g.id)
    expect(listed[0].assetKind).toBe('item')
    expect(listed[0].assetId).toBe('ruby_sword')
    expect(listed[0].size).toBe(16)
    expect(listed[0].prompt).toBe('寒冰符文剑')
    expect(listed[0].provider).toBe('fake-image-model')
    expect(listed[0].origin).toBe('agent')
    expect(listed[0].appliedIndex).toBe(1)
    expect(listed[0].palette).toEqual(['#ff0000', '#00ff00'])
    expect(listed[0].pixels.length).toBe(256)
    expect(listed[0].pngPath).toBe(join(dir, `${g.id}.png`))
  })

  it('画廊为空/目录不存在时返回空数组', () => {
    expect(listGallery(root)).toEqual([])
  })

  it('多次入库按 createdAt 倒序（最新在前）', () => {
    const first = saveGalleryItems(root, [item({ prompt: '第一张' })])[0]
    const second = saveGalleryItems(root, [item({ prompt: '第二张' })])[0]
    // createdAt 相同（同毫秒）时仍保持全部条目，不做去重
    const listed = listGallery(root)
    expect(listed.length).toBe(2)
    expect(new Set([first.id, second.id])).toEqual(new Set(listed.map((i) => i.id)))
    expect(listed[0].createdAt >= listed[1].createdAt).toBe(true)
  })

  it('像素长度与 size 不符的非法项被丢弃（一张不丢仅针对合法候选）', () => {
    const saved = saveGalleryItems(root, [
      item(),
      item({ size: 32, pixels: Array.from({ length: 256 }, () => '') }),
      item({ pixels: Array.from({ length: 300 }, () => '') })
    ])
    expect(saved.length).toBe(1)
    expect(listGallery(root).length).toBe(1)
  })

  it('非 16/32 的 size 归一到 16，未绑定资产按 free 存档', () => {
    const saved = saveGalleryItems(root, [
      item({ size: 64 as unknown as 16, assetKind: 'nope' as never, assetId: '' })
    ])
    expect(saved[0].size).toBe(16)
    expect(saved[0].assetKind).toBe('free')
  })

  it('block 绑定入库后重读不降级（读写共用同一白名单）', () => {
    const saved = saveGalleryItems(root, [item({ assetKind: 'block', assetId: 'ruby_ore' })])
    expect(saved[0].assetKind).toBe('block')
    const listed = listGallery(root)
    expect(listed[0].assetKind).toBe('block')
    expect(listed[0].assetId).toBe('ruby_ore')
  })

  it('单条 JSON 损坏只跳过该条，其余条目照常可用', () => {
    const good = saveGalleryItems(root, [item({ prompt: '好的那张' })])[0]
    writeFileSync(join(root, '.kunyu', 'gallery', 'broken.json'), '{ 不是 JSON', 'utf-8')
    const listed = listGallery(root)
    expect(listed.length).toBe(1)
    expect(listed[0].id).toBe(good.id)
  })

  it('prompt 超长截断到 400 字', () => {
    const saved = saveGalleryItems(root, [item({ prompt: 'x'.repeat(600) })])
    expect(saved[0].prompt.length).toBe(400)
  })
})

describe('galleryService · 删除', () => {
  it('删除同时清掉 json 与 png，之后 list 不再包含', () => {
    const g = saveGalleryItems(root, [item()])[0]
    expect(deleteGalleryItem(root, g.id)).toBe(true)
    expect(existsSync(join(root, '.kunyu', 'gallery', `${g.id}.json`))).toBe(false)
    expect(existsSync(join(root, '.kunyu', 'gallery', `${g.id}.png`))).toBe(false)
    expect(listGallery(root)).toEqual([])
  })

  it('不存在或非法 id 返回 false，不抛错', () => {
    expect(deleteGalleryItem(root, 'not-exist')).toBe(false)
    expect(deleteGalleryItem(root, '../escape')).toBe(false)
  })
})

/** 写一个项目内容资产 JSON（.kunyu/content/<dir>/<id>.json） */
function writeAsset(relDir: string, id: string, body: Record<string, unknown>): void {
  const dir = join(root, '.kunyu', 'content', relDir)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(body, null, 2), 'utf-8')
}

/** 造一张「有画」的物品资产（256 项像素，隔格上色） */
function itemAssetBody(id: string, zhName: string, pixels?: string[]): Record<string, unknown> {
  return {
    kind: 'item',
    id,
    displayName: { en_us: id, zh_cn: zhName },
    texture: {
      path: '',
      generated: true,
      color: '#d0202c',
      pixels: pixels ?? Array.from({ length: 256 }, (_, i) => (i % 2 === 0 ? '#d0202c' : ''))
    }
  }
}

describe('galleryService · 汇总项目已有像素资产', () => {
  it('项目里已有的物品像素资产被合成画廊条目（origin=project，展示名作描述）', () => {
    writeAsset('items', 'ruby', itemAssetBody('ruby', '红宝石'))
    const items = listAssetGallery(root)
    expect(items).toHaveLength(1)
    const g = items[0]
    expect(g.id).toBe('asset-item-ruby')
    expect(g.assetKind).toBe('item')
    expect(g.assetId).toBe('ruby')
    expect(g.size).toBe(16)
    expect(g.origin).toBe('project')
    expect(g.prompt).toBe('红宝石')
    expect(g.pixels.length).toBe(256)
    expect(g.palette).toEqual(['#d0202c'])
    // 项目资产是读时汇总：不落盘、无缩略图文件
    expect(g.pngPath).toBe('')
    expect(existsSync(join(root, '.kunyu', 'gallery'))).toBe(false)
  })

  it('方块像素资产（texture.pixels）也汇总为画廊条目', () => {
    writeAsset('blocks', 'ruby_ore', {
      kind: 'block',
      id: 'ruby_ore',
      displayName: { en_us: 'ruby_ore', zh_cn: '红矿石' },
      texture: {
        path: '',
        generated: true,
        color: '#7f848e',
        pixels: Array.from({ length: 256 }, (_, i) => (i % 2 === 0 ? '#7f848e' : ''))
      }
    })
    const items = listAssetGallery(root)
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('asset-block-ruby_ore')
    expect(items[0].assetKind).toBe('block')
    expect(items[0].assetId).toBe('ruby_ore')
    expect(items[0].size).toBe(16)
    expect(items[0].origin).toBe('project')
    expect(items[0].prompt).toBe('红矿石')
    expect(items[0].pixels.length).toBe(256)
  })

  it('独立模型资产按 textureSize 合成模型条目（32 画布 → size 32 + 几何摘要）', () => {
    writeAsset('models', 'ruby_cube', {
      kind: 'model',
      id: 'ruby_cube',
      displayName: 'Ruby Cube',
      textureSize: 32,
      pixels: Array.from({ length: 1024 }, (_, i) => (i % 3 === 0 ? '#00ff00' : '')),
      elements: [{ name: 'core' }],
      template: 'cube_all'
    })
    const items = listAssetGallery(root)
    expect(items).toHaveLength(1)
    expect(items[0].entryKind).toBe('model')
    expect(items[0].assetKind).toBe('model')
    expect(items[0].size).toBe(32)
    expect(items[0].pixels.length).toBe(1024)
    expect(items[0].model).toEqual({
      geometry: 'cube',
      ownerKind: 'model',
      ownerId: 'ruby_cube',
      textureSize: 32,
      elementCount: 1,
      template: 'cube_all'
    })
  })

  it('有几何元素但贴图全透明的独立模型资产照样收录（几何本身就是资产）', () => {
    writeAsset('models', 'wire', {
      kind: 'model',
      id: 'wire',
      textureSize: 16,
      pixels: Array.from({ length: 256 }, () => ''),
      elements: [{ name: 'a' }, { name: 'b' }]
    })
    const items = listAssetGallery(root)
    expect(items).toHaveLength(1)
    expect(items[0].model?.elementCount).toBe(2)
    expect(items[0].pixels).toEqual([])
  })

  it('对象内嵌 Cube 模型（方块 / 物品 / 实体）各自合成为一条，实体骨骼模型另成一卡', () => {
    writeAsset('blocks', 'altar', {
      kind: 'block',
      id: 'altar',
      displayName: { zh_cn: '祭坛' },
      texture: { path: '', pixels: Array.from({ length: 256 }, (_, i) => (i % 2 ? '#888888' : '')) },
      model: { cubeModel: { textureSize: 16, pixels: [], elements: [{ name: 'base' }] } }
    })
    writeAsset('items', 'wand', {
      kind: 'item',
      id: 'wand',
      texture: { path: '', pixels: Array.from({ length: 256 }, (_, i) => (i % 2 ? '#ffcc00' : '')) },
      model: {
        cubeModel: {
          textureSize: 16,
          pixels: Array.from({ length: 256 }, (_, i) => (i % 2 ? '#ffcc00' : '')),
          elements: [{ name: 'handle' }, { name: 'tip' }]
        }
      }
    })
    writeAsset('entities', 'golem', {
      kind: 'entity',
      id: 'golem',
      renderer: {
        modelType: 'blockbench_geo',
        modelPath: 'geo/golem.geo.json',
        geoJson: JSON.stringify({ format_version: '1.12.0', 'minecraft:geometry': [{ bones: [{ name: 'root' }, { name: 'head' }] }] })
      }
    })
    const items = listAssetGallery(root)
    const byId = Object.fromEntries(items.map((i) => [i.id, i]))

    const altar = byId['object-block-altar']
    expect(altar.entryKind).toBe('model')
    expect(altar.model).toMatchObject({ geometry: 'cube', ownerKind: 'block', elementCount: 1 })
    // 内嵌几何为空像素时不编造贴图，但块自身的贴图像素画同时以贴图卡收录
    expect(altar.pixels).toEqual([])
    expect(byId['asset-block-altar'].pixels.length).toBe(256)

    const wand = byId['object-item-wand']
    expect(wand.model).toMatchObject({ ownerKind: 'item', elementCount: 2 })
    expect(wand.pixels.length).toBe(256)
    expect(wand.palette).toEqual(['#ffcc00'])

    // 实体骨骼模型独立成卡（与 cube 并列建模，不是同一份几何）
    const geo = byId['object-entity-golem-geo']
    expect(geo.entryKind).toBe('model')
    expect(geo.model).toMatchObject({
      geometry: 'blockbench',
      ownerKind: 'entity',
      boneCount: 2,
      textureSize: 16
    })
    expect(geo.pixels).toEqual([])
  })

  it('内嵌模型与独立模型资产互为镜像（cubeModelId === 自身 id）时只出一张卡并回填归属', () => {
    writeAsset('models', 'altar', {
      kind: 'model',
      id: 'altar',
      textureSize: 16,
      pixels: Array.from({ length: 256 }, (_, i) => (i % 2 ? '#888888' : '')),
      elements: [{ name: 'base' }]
    })
    writeAsset('blocks', 'altar', {
      kind: 'block',
      id: 'altar',
      texture: { path: '', pixels: [] },
      cubeModelId: 'altar',
      model: { cubeModel: { textureSize: 16, pixels: [], elements: [{ name: 'base' }] } }
    })
    const items = listAssetGallery(root)
    const models = items.filter((i) => i.entryKind === 'model')
    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('asset-model-altar')
    expect(models[0].model).toMatchObject({
      ownerKind: 'block',
      ownerId: 'altar',
      boundModelId: 'altar'
    })
    expect(items.some((i) => i.id === 'object-block-altar')).toBe(false)
  })

  it('坏 geoJson 只丢骨骼摘要，不让整座画廊不可用', () => {
    writeAsset('entities', 'bad', {
      kind: 'entity',
      id: 'bad',
      renderer: { modelType: 'blockbench_geo', geoJson: '{ 不是 JSON' }
    })
    const items = listAssetGallery(root)
    expect(items).toHaveLength(1)
    expect(items[0].model?.boneCount).toBe(0)
  })

  it('全透明且没有几何的资产不算「有画」也不成模型，不收录', () => {
    // 全透明：一张空画布不当作资产
    writeAsset('items', 'blank', itemAssetBody('blank', '空白', Array.from({ length: 256 }, () => '')))
    // 像素长度不符（缺数据）
    writeAsset('items', 'broken_len', itemAssetBody('broken_len', '坏长度', ['#ffffff']))
    // 模型无元素又无画
    writeAsset('models', 'empty', { kind: 'model', id: 'empty', pixels: [], elements: [] })
    expect(listAssetGallery(root)).toEqual([])
  })

  it('归档里的模型条目重读时保留 entryKind 与几何摘要；摘要残缺的条目整条丢弃', () => {
    const dir = join(root, '.kunyu', 'gallery')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'aaaaaaaa-1111-4111-8111-111111111111.json'),
      JSON.stringify({
        id: 'aaaaaaaa-1111-4111-8111-111111111111',
        createdAt: '2026-01-01T00:00:00.000Z',
        entryKind: 'model',
        model: {
          geometry: 'cube',
          ownerKind: 'block',
          ownerId: 'altar',
          textureSize: 32,
          elementCount: 3
        },
        assetKind: 'model',
        assetId: 'altar',
        size: 32,
        pixels: Array.from({ length: 1024 }, (_, i) => (i % 2 ? '#ffffff' : '')),
        palette: [],
        pngPath: ''
      }),
      'utf-8'
    )
    // 摘要残缺（缺 ownerId）→ 无法预览/导出/写回，整条跳过
    writeFileSync(
      join(dir, 'bbbbbbbb-2222-4222-8222-222222222222.json'),
      JSON.stringify({
        id: 'bbbbbbbb-2222-4222-8222-222222222222',
        entryKind: 'model',
        model: { geometry: 'cube', ownerKind: 'block', textureSize: 16, elementCount: 1 },
        assetKind: 'model',
        assetId: 'x',
        size: 16,
        pixels: Array.from({ length: 256 }, (_, i) => (i % 2 ? '#ffffff' : '')),
        palette: [],
        pngPath: ''
      }),
      'utf-8'
    )
    const listed = listGallery(root)
    expect(listed).toHaveLength(1)
    expect(listed[0].entryKind).toBe('model')
    expect(listed[0].model?.ownerId).toBe('altar')
    expect(listed[0].model?.textureSize).toBe(32)
  })

  it('kind 不匹配的 JSON（目录串位）与损坏 JSON 均跳过', () => {
    writeAsset('items', 'wrong_kind', { ...itemAssetBody('wrong_kind', '串位'), kind: 'block' })
    const dir = join(root, '.kunyu', 'content', 'items')
    writeFileSync(join(dir, 'bad.json'), '{ 不是 JSON', 'utf-8')
    expect(listAssetGallery(root)).toEqual([])
  })

  it('listGalleryAll 合并归档候选与项目资产，并按 createdAt 倒序统一排序', () => {
    writeAsset('items', 'ruby', itemAssetBody('ruby', '红宝石'))
    // 资产 mtime 钉到过去，确保与「刚入库的候选（现在）」排序确定、不受同毫秒抖动影响
    const old = new Date('2020-01-01T00:00:00.000Z')
    utimesSync(join(root, '.kunyu', 'content', 'items', 'ruby.json'), old, old)
    const archived = saveGalleryItems(root, [item({ prompt: 'AI 出的那张' })])[0]
    const all = listGalleryAll(root)
    expect(all).toHaveLength(2)
    expect(new Set(all.map((i) => i.origin))).toEqual(new Set(['agent', 'project']))
    expect(all[0].id).toBe(archived.id)
    expect(all[1].id).toBe('asset-item-ruby')
    expect(all[0].createdAt >= all[1].createdAt).toBe(true)
  })
})
