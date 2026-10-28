/**
 * 纹理层纯函数测试（B2-2，v2）。
 *
 * 核心不变量：
 * - effectiveLayers：空/未定义 → 回退单基层（id='base'）；
 * - hasCustomLayers：仅 layers 非空 → true；
 * - addLayer：追加栈顶、自动命名、id 唯一；
 * - removeLayer：多层删键保留其余；单基层删除转为清空 data；
 * - patchLayer：字段更新、未知 id 不动文档；
 * - moveLayer：边界 clamp、交换位置。
 */
import { describe, expect, it } from 'vitest'
import { addLayer, effectiveLayers, hasCustomLayers, moveLayer, patchLayer, removeLayer } from '../layer'
import { addTexture, createDocument } from '../document'
import type { ModelTexture } from '../types'

function tex(w = 16, h = 16, name = 't'): ModelTexture {
  return { id: `tex-${name}`, name, width: w, height: h, data: 'data:image/png;base64,x', visible: true }
}

function docWithTex(t: ModelTexture = tex()) {
  let doc = createDocument({ name: 'd', format: 'free' })
  doc = addTexture(doc, t)
  return doc
}

describe('effectiveLayers', () => {
  it('无 layers → 回退单基层', () => {
    const layers = effectiveLayers(tex())
    expect(layers).toHaveLength(1)
    expect(layers[0]!.id).toBe('base')
    expect(layers[0]!.name).toBe('基层')
    expect(layers[0]!.data).toBe('data:image/png;base64,x')
    expect(layers[0]!.visible).toBe(true)
    expect(layers[0]!.opacity).toBe(1)
  })

  it('layers 为空数组 → 回退单基层', () => {
    const t = { ...tex(), layers: [] }
    expect(effectiveLayers(t)).toHaveLength(1)
    expect(effectiveLayers(t)[0]!.id).toBe('base')
  })

  it('有自定义层 → 原样返回', () => {
    const t = {
      ...tex(),
      layers: [
        { id: 'a', name: 'A', data: 'd1', visible: true, opacity: 1 },
        { id: 'b', name: 'B', data: 'd2', visible: false, opacity: 0.5 }
      ]
    }
    expect(effectiveLayers(t)).toHaveLength(2)
    expect(effectiveLayers(t)[0]!.id).toBe('a')
    expect(effectiveLayers(t)[1]!.id).toBe('b')
  })
})

describe('hasCustomLayers', () => {
  it('无 layers / 空数组 → false', () => {
    expect(hasCustomLayers(tex())).toBe(false)
    expect(hasCustomLayers({ ...tex(), layers: [] })).toBe(false)
  })

  it('有层 → true', () => {
    const t = { ...tex(), layers: [{ id: 'a', name: 'A', data: 'd', visible: true, opacity: 1 }] }
    expect(hasCustomLayers(t)).toBe(true)
  })
})

describe('addLayer', () => {
  it('追加到栈顶并自动命名', () => {
    const doc = docWithTex()
    const { doc: d1, layerId: id1 } = addLayer(doc, 'tex-t')
    expect(id1).toBeTruthy()
    const tex1 = d1.textures['tex-t']!
    expect(tex1.layers).toHaveLength(2) // 基层 + 新层
    expect(tex1.layers![1]!.id).toBe(id1)
    expect(tex1.layers![1]!.name).toBe('层 2')

    const { doc: d2 } = addLayer(d1, 'tex-t', { name: '高光' })
    expect(d2.textures['tex-t']!.layers).toHaveLength(3)
    expect(d2.textures['tex-t']!.layers![2]!.name).toBe('高光')
  })

  it('未知贴图 id → 原样返回', () => {
    const doc = docWithTex()
    const { doc: next, layerId } = addLayer(doc, 'tex-unknown')
    expect(next).toBe(doc)
    expect(layerId).toBe('')
  })
})

describe('removeLayer', () => {
  it('多层删除保留其余层', () => {
    let doc = docWithTex()
    const r1 = addLayer(doc, 'tex-t')
    doc = r1.doc
    const r2 = addLayer(doc, 'tex-t')
    doc = r2.doc
    expect(doc.textures['tex-t']!.layers).toHaveLength(3)

    const next = removeLayer(doc, 'tex-t', r1.layerId)
    expect(next.textures['tex-t']!.layers).toHaveLength(2)
    expect(next.textures['tex-t']!.layers!.map((l) => l.id)).not.toContain(r1.layerId)
  })

  it('单基层删除 = 清空 data（保留层栈）', () => {
    let doc = docWithTex()
    const r = addLayer(doc, 'tex-t')
    doc = r.doc
    // 删掉新层回到单基层
    doc = removeLayer(doc, 'tex-t', r.layerId)
    expect(doc.textures['tex-t']!.layers).toBeUndefined() // 空数组已删键

    // 单基层再删 = 清空 data
    const next = removeLayer(doc, 'tex-t', 'base')
    const layers = next.textures['tex-t']!.layers!
    expect(layers).toHaveLength(1)
    expect(layers[0]!.id).toBe('base')
    expect(layers[0]!.data).toBe('')
  })

  it('未知贴图/层 id → 原样返回', () => {
    const doc = docWithTex()
    expect(removeLayer(doc, 'tex-unknown', 'a')).toBe(doc)
    expect(removeLayer(doc, 'tex-t', 'unknown')).toBe(doc)
  })
})

describe('patchLayer', () => {
  it('更新名称/显隐/不透明度', () => {
    let doc = docWithTex()
    const r = addLayer(doc, 'tex-t')
    doc = r.doc
    const lid = r.layerId

    const next = patchLayer(doc, 'tex-t', lid, { name: '阴影', visible: false, opacity: 0.3 })
    const layer = next.textures['tex-t']!.layers!.find((l) => l.id === lid)!
    expect(layer.name).toBe('阴影')
    expect(layer.visible).toBe(false)
    expect(layer.opacity).toBe(0.3)
  })

  it('未知贴图/层 id → 原样返回', () => {
    const doc = docWithTex()
    expect(patchLayer(doc, 'tex-unknown', 'a', { name: 'x' })).toBe(doc)
    expect(patchLayer(doc, 'tex-t', 'unknown', { name: 'x' })).toBe(doc)
  })
})

describe('moveLayer', () => {
  it('上下移动交换位置', () => {
    let doc = docWithTex()
    const r1 = addLayer(doc, 'tex-t')
    doc = r1.doc
    const r2 = addLayer(doc, 'tex-t')
    doc = r2.doc
    const ids = () => doc.textures['tex-t']!.layers!.map((l) => l.id)
    expect(ids()).toEqual(['base', r1.layerId, r2.layerId])

    // 中间层上移
    doc = moveLayer(doc, 'tex-t', r1.layerId, -1)
    expect(ids()).toEqual([r1.layerId, 'base', r2.layerId])

    // 顶部层下移（clamp）
    doc = moveLayer(doc, 'tex-t', r2.layerId, 1)
    expect(ids()).toEqual([r1.layerId, 'base', r2.layerId])
  })

  it('越界 clamp 不动', () => {
    let doc = docWithTex()
    const r = addLayer(doc, 'tex-t')
    doc = r.doc
    expect(moveLayer(doc, 'tex-t', 'base', -1)).toBe(doc) // 底层再上移
    expect(moveLayer(doc, 'tex-t', r.layerId, 1)).toBe(doc) // 顶层再下移
  })
})

/* ------------------------------------------------------------------ */
/* 参考图（B3-1）                                                      */
/* ------------------------------------------------------------------ */

import { addReferenceImage, patchReferenceImage, removeReferenceImage } from '../layer'

function docWithRef() {
  let doc = createDocument({ name: 'd', format: 'free' })
  const r = addReferenceImage(doc, { name: '底图', data: 'data:image/png;base64,ref' })
  doc = r.doc
  return { doc, refId: r.refId }
}

describe('referenceImage', () => {
  it('添加参考图（自动命名/默认值）', () => {
    const { doc, refId } = docWithRef()
    expect(doc.referenceImages).toHaveLength(1)
    const ref = doc.referenceImages![0]!
    expect(ref.id).toBe(refId)
    expect(ref.name).toBe('底图')
    expect(ref.position).toEqual([0, 0, 0])
    expect(ref.size).toEqual([16, 16])
    expect(ref.opacity).toBe(1)
    expect(ref.visible).toBe(true)
  })

  it('删除参考图（未知 id 原样返回）', () => {
    const { doc, refId } = docWithRef()
    const next = removeReferenceImage(doc, refId)
    expect(next.referenceImages).toBeUndefined()
    expect(removeReferenceImage(doc, 'unknown')).toBe(doc)
  })

  it('更新参考图字段（未知 id 原样返回）', () => {
    const { doc, refId } = docWithRef()
    const next = patchReferenceImage(doc, refId, { name: '新名', opacity: 0.5, visible: false })
    const ref = next.referenceImages![0]!
    expect(ref.name).toBe('新名')
    expect(ref.opacity).toBe(0.5)
    expect(ref.visible).toBe(false)
    expect(patchReferenceImage(doc, 'unknown', { name: 'x' })).toBe(doc)
  })
})
