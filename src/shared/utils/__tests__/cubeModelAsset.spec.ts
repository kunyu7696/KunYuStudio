/**
 * cubeModelAsset 单测（画廊模型预览 / 送进工坊 / 写回对象共用的几何组装）：
 * - embeddedCubeOf：方块/物品在 model.cubeModel、实体在 renderer.cubeModel；无元素一律 null
 * - modelAssetFromEmbedded：内嵌模型包装成等价 ModelAsset（id/画布/像素补齐/贴图路径约定）
 * - readonlyModelAsset：独立模型资产浅拷贝（数组隔离）；内嵌模型包装；骨骼模型返回 null
 * - normalizeCubeModel：画布收窄 + 像素补齐
 */
import { describe, expect, it } from 'vitest'
import type { CubeElement, CubeFace, EmbeddedCubeModel, ModelAsset } from '../../types/content'
import {
  contentDisplayName,
  embeddedCubeOf,
  embeddedFromModelAsset,
  modelAssetFromEmbedded,
  normalizeCubeModel,
  readonlyModelAsset
} from '../cubeModelAsset'

const FACE: CubeFace = { uv: [0, 0, 16, 16], texture: 'all' }

function element(name = '立方体 1'): CubeElement {
  return {
    name,
    from: [0, 0, 0],
    to: [16, 16, 16],
    shade: true,
    faces: { down: FACE, up: FACE, north: FACE, south: FACE, west: FACE, east: FACE }
  }
}

function cube(pixels: string[] = [], textureSize: 16 | 32 = 16): EmbeddedCubeModel {
  return { textureSize, pixels, elements: [element()] }
}

function modelAsset(patch: Partial<ModelAsset> = {}): ModelAsset {
  return {
    kind: 'model',
    id: 'crate',
    displayName: 'Crate',
    description: '',
    textureSize: 16,
    pixels: Array.from({ length: 256 }, (_, i) => (i % 2 ? '#ff0000' : '')),
    textures: { all: 'textures/model/crate.png' },
    createdAt: 1,
    updatedAt: 2,
    elements: [element()],
    ...patch
  }
}

describe('cubeModelAsset', () => {
  it('embeddedCubeOf：方块 / 物品读 model.cubeModel，实体读 renderer.cubeModel，独立模型资产不适用', () => {
    const block = { kind: 'block', model: { cubeModel: cube() } }
    const item = { kind: 'item', model: { cubeModel: cube() } }
    const entity = { kind: 'entity', renderer: { cubeModel: cube() } }
    expect(embeddedCubeOf(block, 'block')?.elements).toHaveLength(1)
    expect(embeddedCubeOf(item, 'item')?.elements).toHaveLength(1)
    expect(embeddedCubeOf(entity, 'entity')?.elements).toHaveLength(1)
    // 独立模型资产的几何就在资产本体里，不走内嵌路径
    expect(embeddedCubeOf(modelAsset(), 'model')).toBe(null)
  })

  it('embeddedCubeOf：无内嵌几何 / 空元素 / 坏结构一律 null（不抛错）', () => {
    expect(embeddedCubeOf({ kind: 'block' }, 'block')).toBe(null)
    expect(embeddedCubeOf({ model: { cubeModel: { elements: [] } } }, 'block')).toBe(null)
    expect(embeddedCubeOf({ model: 'not-an-object' }, 'block')).toBe(null)
    expect(embeddedCubeOf(null, 'entity')).toBe(null)
  })

  it('embeddedCubeOf：32 画布保留、非 16/32 归一到 16，像素只收字符串', () => {
    const big = embeddedCubeOf(
      { model: { cubeModel: { textureSize: 32, pixels: ['#fff', 1], elements: [element()] } } },
      'block'
    )!
    expect(big.textureSize).toBe(32)
    expect(big.pixels).toEqual(['#fff'])
    const odd = embeddedCubeOf(
      { model: { cubeModel: { textureSize: 8, pixels: [], elements: [element()] } } },
      'block'
    )!
    expect(odd.textureSize).toBe(16)
  })

  it('modelAssetFromEmbedded：按目标 id 命名，贴图指向 textures/model/<id>.png，像素补齐到画布', () => {
    const asset = modelAssetFromEmbedded('altar', cube(['#ff0000']), '祭坛', {
      createdAt: 10,
      updatedAt: 20
    })
    expect(asset.id).toBe('altar')
    expect(asset.displayName).toBe('祭坛')
    expect(asset.kind).toBe('model')
    expect(asset.textures.all).toBe('textures/model/altar.png')
    expect(asset.pixels.length).toBe(256)
    expect(asset.pixels[0]).toBe('#ff0000')
    expect(asset.elements).toHaveLength(1)
    expect(asset.createdAt).toBe(10)
    expect(asset.updatedAt).toBe(20)
  })

  it('readonlyModelAsset：独立模型资产返回浅拷贝（改预览不动源数据）', () => {
    const src = modelAsset()
    const view = readonlyModelAsset({ ownerKind: 'model', ownerId: 'crate' }, src)!
    expect(view.id).toBe('crate')
    expect(view.pixels).not.toBe(src.pixels)
    expect(view.textures).not.toBe(src.textures)
    expect(view.pixels).toEqual(src.pixels)
    // 预览改像素不会污染源资产
    view.pixels[0] = '#00ff00'
    expect(src.pixels[0]).toBe('')
  })

  it('readonlyModelAsset：内嵌模型包装成 ModelAsset；骨骼模型（无 Cube 几何）返回 null', () => {
    const block = { id: 'altar', displayName: { zh_cn: '祭坛' }, model: { cubeModel: cube() } }
    const view = readonlyModelAsset({ ownerKind: 'block', ownerId: 'altar' }, block)!
    expect(view.id).toBe('altar')
    expect(view.displayName).toBe('祭坛')

    const geo = { renderer: { modelType: 'blockbench_geo', geoJson: '{}' } }
    expect(readonlyModelAsset({ ownerKind: 'entity', ownerId: 'golem' }, geo)).toBe(null)
  })

  it('readonlyModelAsset：空元素的独立模型资产不可预览，返回 null', () => {
    expect(
      readonlyModelAsset({ ownerKind: 'model', ownerId: 'crate' }, modelAsset({ elements: [] }))
    ).toBe(null)
  })

  it('normalizeCubeModel：画布收窄 + 像素补齐 / 截断到画布长度', () => {
    const short = normalizeCubeModel(cube(['#ff0000']))
    expect(short.textureSize).toBe(16)
    expect(short.pixels.length).toBe(256)
    expect(short.pixels[0]).toBe('#ff0000')
    const long = normalizeCubeModel({
      textureSize: 16,
      pixels: Array.from({ length: 300 }, () => '#ff0000'),
      elements: [element()]
    })
    expect(long.pixels.length).toBe(256)
    const wide = normalizeCubeModel({ textureSize: 32, pixels: [], elements: [element()] })
    expect(wide.textureSize).toBe(32)
    expect(wide.pixels.length).toBe(1024)
  })

  it('embeddedFromModelAsset：独立资产几何回灌编辑态（画布与像素原样带出）', () => {
    const cm = embeddedFromModelAsset(modelAsset({ textureSize: 32, pixels: [] }))
    expect(cm.textureSize).toBe(32)
    expect(cm.elements).toHaveLength(1)
    expect(cm.pixels).toEqual([])
  })

  it('contentDisplayName：zh_cn → en_us → id 回落链', () => {
    expect(contentDisplayName({ displayName: { zh_cn: '祭坛', en_us: 'Altar' } }, 'x')).toBe('祭坛')
    expect(contentDisplayName({ displayName: { en_us: 'Altar' } }, 'x')).toBe('Altar')
    expect(contentDisplayName({ displayName: 'Altar' }, 'x')).toBe('Altar')
    expect(contentDisplayName({}, 'x')).toBe('x')
    expect(contentDisplayName(null, 'x')).toBe('x')
  })
})
