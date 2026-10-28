/**
 * modelSnapshot 单测：离线三视角渲染器 + 数值指标。
 * 全部经注入 readFile mock，不触盘。
 */
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodePng, type Raster } from '../ai/pixelize'
import {
  computeSnapshotMetrics,
  metricViolations,
  parseModelJson,
  renderModelSnapshot,
  type SnapshotReadFile
} from '../ai/modelSnapshot'

const MODEL_ABS = 'C:/proj/src/main/resources/assets/demo/models/block/katana.json'
const TEX_ABS = path.join('C:/proj/src/main/resources/assets/demo', 'textures', 'block', 'katana.png')

function solidPng(size: number, rgba: [number, number, number, number]): Buffer {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i++) data.set(rgba, i * 4)
  return encodePng({ width: size, height: size, data })
}

/** 棋盘格贴图（有明暗对比，供指标测试） */
function checkerPng(size: number): Buffer {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const on = (x + y) % 2 === 0
      data.set(on ? [220, 220, 220, 255] : [20, 20, 20, 255], (y * size + x) * 4)
    }
  }
  return encodePng({ width: size, height: size, data })
}

function reader(files: Record<string, Buffer>): SnapshotReadFile {
  return (p) => files[p] ?? files[p.replace(/\\/g, '/')] ?? null
}

const CUBE_MODEL = JSON.stringify({
  textures: { all: 'demo:block/katana', particle: '#all' },
  elements: [
    {
      from: [2, 2, 2],
      to: [14, 14, 14],
      faces: Object.fromEntries(
        ['north', 'south', 'east', 'west', 'up', 'down'].map((f) => [f, { uv: [0, 0, 16, 16], texture: '#all' }])
      )
    }
  ]
})

describe('parseModelJson', () => {
  it('解析 elements 与贴图引用（含 # 链式解引用）', () => {
    const read = reader({ [MODEL_ABS]: Buffer.from(CUBE_MODEL, 'utf8') })
    const parsed = parseModelJson(read, MODEL_ABS)
    expect(parsed).not.toBeNull()
    expect(parsed!.elements).toHaveLength(1)
    expect(parsed!.elements[0]!.faces['north']!.texture).toBe('all')
    expect(parsed!.textureFiles['all']).toBe(TEX_ABS)
    expect(parsed!.textureFiles['particle']).toBe(TEX_ABS)
    expect(parsed!.texSize).toEqual([16, 16])
  })

  it('文件缺失 / JSON 损坏返回 null', () => {
    expect(parseModelJson(() => null, MODEL_ABS)).toBeNull()
    const bad = reader({ [MODEL_ABS]: Buffer.from('{ broken', 'utf8') })
    expect(parseModelJson(bad, MODEL_ABS)).toBeNull()
  })

  it('texture_size 覆盖 uv 空间', () => {
    const model = JSON.stringify({
      texture_size: [32, 32],
      textures: { all: 'demo:block/katana' },
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { north: { uv: [0, 0, 32, 32], texture: '#all' } } }]
    })
    const read = reader({ [MODEL_ABS]: Buffer.from(model, 'utf8') })
    expect(parseModelJson(read, MODEL_ABS)!.texSize).toEqual([32, 32])
  })
})

describe('renderModelSnapshot', () => {
  it('单立方体输出 front/side/iso 三张 192×192 PNG', () => {
    const read = reader({
      [MODEL_ABS]: Buffer.from(CUBE_MODEL, 'utf8'),
      [TEX_ABS]: solidPng(16, [200, 30, 30, 255])
    })
    const r = renderModelSnapshot(read, MODEL_ABS)
    expect(r).not.toBeNull()
    expect(r!.views.map((v) => v.view)).toEqual(['front', 'side', 'iso'])
    for (const v of r!.views) {
      expect(v.raster.width).toBe(192)
      expect(v.raster.height).toBe(192)
      expect(v.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    }
    /* front 中心像素：north 面 shade 0.8 → 200*0.8=160 */
    const front = r!.views[0]!.raster
    const c = (96 * 192 + 96) * 4
    expect(front.data[c + 3]).toBe(255)
    expect(front.data[c]).toBeGreaterThan(140)
    expect(front.data[c]).toBeLessThan(180)
    expect(front.data[c + 1]).toBeLessThan(60)
    /* 角落透明 */
    const corner = (2 * 192 + 2) * 4
    expect(front.data[corner + 3]).toBe(0)
  })

  it('无 elements 但有 layer0 → 薄板精灵退化并记录告警', () => {
    const model = JSON.stringify({
      parent: 'minecraft:item/generated',
      textures: { layer0: 'demo:item/ruby' }
    })
    const itemAbs = 'C:/proj/src/main/resources/assets/demo/models/item/ruby.json'
    const texAbs = path.join('C:/proj/src/main/resources/assets/demo', 'textures', 'item', 'ruby.png')
    const read = reader({
      [itemAbs]: Buffer.from(model, 'utf8'),
      [texAbs]: solidPng(16, [40, 200, 60, 255])
    })
    const r = renderModelSnapshot(read, itemAbs)
    expect(r).not.toBeNull()
    expect(r!.warnings.some((w) => w.includes('item/generated'))).toBe(true)
    expect(r!.views.length).toBeGreaterThan(0)
  })

  it('贴图缺失 → 品红兜底 + 如实告警', () => {
    const read = reader({ [MODEL_ABS]: Buffer.from(CUBE_MODEL, 'utf8') })
    const r = renderModelSnapshot(read, MODEL_ABS)
    expect(r).not.toBeNull()
    expect(r!.warnings.some((w) => w.includes('贴图缺失'))).toBe(true)
    const front = r!.views[0]!.raster
    const c = (96 * 192 + 96) * 4
    /* 品红 248*0.8≈198 */
    expect(front.data[c]).toBeGreaterThan(170)
    expect(front.data[c + 1]).toBeLessThan(30)
    expect(front.data[c + 2]).toBeGreaterThan(170)
  })

  it('元素 rotation（y 轴 45°）正常渲染', () => {
    const model = JSON.stringify({
      textures: { all: 'demo:block/katana' },
      elements: [
        {
          from: [2, 2, 2],
          to: [14, 14, 14],
          rotation: { origin: [8, 8, 8], axis: 'y', angle: 45 },
          faces: Object.fromEntries(
            ['north', 'south', 'east', 'west', 'up', 'down'].map((f) => [f, { uv: [0, 0, 16, 16], texture: '#all' }])
          )
        }
      ]
    })
    const read = reader({
      [MODEL_ABS]: Buffer.from(model, 'utf8'),
      [TEX_ABS]: solidPng(16, [100, 100, 200, 255])
    })
    const r = renderModelSnapshot(read, MODEL_ABS)
    expect(r).not.toBeNull()
    expect(r!.views).toHaveLength(3)
    /* 旋转 45° 后 front 剪影宽度应大于未旋转的 12 单位投影 */
    const front = r!.views[0]!.raster
    let minX = 192
    let maxX = 0
    for (let y = 0; y < 192; y++) {
      for (let x = 0; x < 192; x++) {
        if (front.data[(y * 192 + x) * 4 + 3] >= 8) {
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
        }
      }
    }
    /* 未旋转 12 单位在 160px 适配下约 120px 宽；45° 旋转后 ≈ 12·√2 单位，等比更宽 */
    expect(maxX - minX).toBeGreaterThan(140)
  })

  it('模型文件缺失返回 null', () => {
    expect(renderModelSnapshot(() => null, MODEL_ABS)).toBeNull()
  })
})

describe('computeSnapshotMetrics / metricViolations', () => {
  it('全透明画布：occupancy 0', () => {
    const empty: Raster = { width: 192, height: 192, data: new Uint8ClampedArray(192 * 192 * 4) }
    const m = computeSnapshotMetrics([
      { view: 'front', raster: empty, dataUrl: '' },
      { view: 'side', raster: empty, dataUrl: '' }
    ])
    expect(m.occupancy).toBe(0)
    expect(m.clipping).toBe(0)
    expect(m.contrast).toBe(0)
  })

  it('渲染结果指标在合理区间', () => {
    const read = reader({
      [MODEL_ABS]: Buffer.from(CUBE_MODEL, 'utf8'),
      [TEX_ABS]: checkerPng(16)
    })
    const r = renderModelSnapshot(read, MODEL_ABS)!
    const m = computeSnapshotMetrics(r.views)
    expect(m.occupancy).toBeGreaterThan(0.2)
    expect(m.occupancy).toBeLessThan(0.7)
    expect(m.clipping).toBeLessThan(0.08)
    /* 棋盘格有明暗对比与边缘 */
    expect(m.contrast).toBeGreaterThan(0.05)
    expect(m.edgeDensity).toBeGreaterThan(0)
    /* 单一方块正/侧剪影一致度应很高 */
    expect(m.viewConsistency).toBeGreaterThan(0.8)
  })

  it('metricViolations 逐项列出越界指标', () => {
    const bad = metricViolations({ occupancy: 0.05, clipping: 0.2, contrast: 0.1, edgeDensity: 0.001, viewConsistency: 0 })
    expect(bad).toHaveLength(4)
    const ok = metricViolations({ occupancy: 0.3, clipping: 0.02, contrast: 0.4, edgeDensity: 0.05, viewConsistency: 0.1 })
    expect(ok).toHaveLength(0)
  })
})
