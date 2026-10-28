/**
 * detectGapReasons 静态缺口门单测（run#7 增量假完成回归）：
 * - gui 内容类型必须有 *ScreenHandler.java + *Screen.java
 * - 模型 JSON 引用非 minecraft 贴图时 PNG 必须存在于磁盘
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectGapReasons } from '../orchestrator/generatePipeline'
import { encodePng } from '../pixelize'
import type { AgentFileChange } from '../../../../shared/types/agent'

function fc(relPath: string, content: string): AgentFileChange {
  return { path: relPath, action: 'create', content, accepted: true }
}

let root: string
let resRoot: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-gap-'))
  resRoot = join(root, 'src/main/resources/assets/yanshi')
  mkdirSync(join(resRoot, 'textures/block'), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('detectGapReasons · GUI 门', () => {
  const java = (name: string) => fc(`src/main/java/x/${name}.java`, 'class {}')

  it('gui 类型：只有普通 Java 类 → 报两个缺口', () => {
    const reasons = detectGapReasons([java('SolarFurnaceBlock')], ['gui', 'block'], root)
    expect(reasons.some((r) => r.includes('ScreenHandler'))).toBe(true)
    expect(reasons.some((r) => r.includes('Screen 界面类'))).toBe(true)
  })

  it('gui 类型：ScreenHandler+Screen 齐备且无贴图问题 → 无缺口', () => {
    const reasons = detectGapReasons(
      [java('SolarScreenHandler'), java('SolarScreen'), java('SolarBlock')],
      ['gui'],
      root
    )
    expect(reasons).toEqual([])
  })

  it('非 gui 类型不检查 GUI 类', () => {
    expect(detectGapReasons([java('Foo')], ['block'], root)).toEqual([])
  })
})

describe('detectGapReasons · 贴图引用门', () => {
  const modelJson = (tex: string) =>
    fc(
      'src/main/resources/assets/yanshi/models/block/solar.json',
      JSON.stringify({ parent: 'minecraft:block/cube', textures: { up: tex, north: tex } })
    )

  it('引用本 mod 贴图但 PNG 缺失 → 报告缺失贴图名', () => {
    const reasons = detectGapReasons([modelJson('yanshi:block/solar_top')], ['block'], root)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('yanshi:block/solar_top')
    expect(reasons[0]).toContain('texture_paint')
  })

  it('引用 minecraft 原版贴图 → 不检查（随游戏存在）', () => {
    expect(detectGapReasons([modelJson('minecraft:block/furnace_front_on')], ['block'], root)).toEqual([])
  })

  it('PNG 已在磁盘（如 texture_paint 已落盘）→ 无缺口', () => {
    writeFileSync(join(resRoot, 'textures/block/solar_top.png'), Buffer.from([1, 2, 3]))
    expect(detectGapReasons([modelJson('yanshi:block/solar_top')], ['block'], root)).toEqual([])
  })

  it('blockstate 的 model 引用不被误判为贴图；模型 JSON 未落盘则单独报模型缺口', () => {
    const bs = fc(
      'src/main/resources/assets/yanshi/blockstates/solar.json',
      JSON.stringify({ variants: { '': { model: 'yanshi:block/solar' } } })
    )
    const broken = fc('src/main/resources/assets/yanshi/models/block/bad.json', '{ broken')
    const reasons = detectGapReasons([bs, broken], ['block'], root)
    // model 引用不报贴图缺口；但 solar 模型 JSON 未落盘 → 报模型缺口
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('模型 JSON')
    expect(reasons[0]).toContain('yanshi:block/solar')
  })

  it('跨轮连带：本轮只改 Java，磁盘遗留同 id 模型引用缺失贴图 → 报缺口（run#8 回归）', () => {
    // 上一轮已落盘的模型 JSON（不在本次变更里），引用从未生成的贴图
    mkdirSync(join(resRoot, 'models/block'), { recursive: true })
    writeFileSync(
      join(resRoot, 'models/block/solar_furnace.json'),
      JSON.stringify({ parent: 'minecraft:block/cube', textures: { up: 'yanshi:model/solar_furnace_top' } })
    )
    // 本轮只产出 SolarFurnaceBlock.java → 关联 id solar_furnace
    const reasons = detectGapReasons(
      [fc('src/main/java/x/SolarFurnaceBlock.java', 'class {}')],
      ['block'],
      root
    )
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('yanshi:model/solar_furnace_top')
  })

  it('跨轮连带：磁盘上无关 id 的模型缺口不误报；同 id 贴图已存在则不报', () => {
    mkdirSync(join(resRoot, 'models/block'), { recursive: true })
    writeFileSync(
      join(resRoot, 'models/block/other_block.json'),
      JSON.stringify({ textures: { up: 'yanshi:model/other_missing' } })
    )
    writeFileSync(
      join(resRoot, 'models/block/solar_furnace.json'),
      JSON.stringify({ textures: { up: 'yanshi:model/solar_furnace_top' } })
    )
    mkdirSync(join(resRoot, 'textures/model'), { recursive: true })
    writeFileSync(join(resRoot, 'textures/model/solar_furnace_top.png'), Buffer.from([1]))
    // other_block 与本轮无关 → 不查；solar_furnace 贴图已存在 → 无缺口
    expect(
      detectGapReasons([fc('src/main/java/x/SolarFurnaceBlock.java', 'class {}')], ['block'], root)
    ).toEqual([])
  })
})

describe('detectGapReasons · 空白/纯色贴图闸门', () => {
  const java = (name: string) => fc(`src/main/java/x/${name}.java`, 'class {}')
  /** 与 lintTextureContent 解码互认的 PNG 构造（走项目同款 encodePng） */
  const png = (
    w: number,
    h: number,
    fill: (x: number, y: number) => readonly [number, number, number, number]
  ): Buffer => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const [r, g, b, a] = fill(x, y)
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
        data[i + 3] = a
      }
    }
    return encodePng({ width: w, height: h, data })
  }

  it('实体贴图 100% 透明 → 报空白（2026-10-18 RealAgentProbe 空白实体回归）', () => {
    mkdirSync(join(resRoot, 'textures/entity'), { recursive: true })
    writeFileSync(join(resRoot, 'textures/entity/ruby.png'), png(64, 64, () => [0, 0, 0, 0]))
    const reasons = detectGapReasons([java('RubyEntity')], ['entity'], root)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('entity/ruby')
    expect(reasons[0]).toContain('透明')
  })

  it('实体贴图纯色无细节 → 报纯色', () => {
    mkdirSync(join(resRoot, 'textures/entity'), { recursive: true })
    writeFileSync(join(resRoot, 'textures/entity/ruby.png'), png(64, 64, () => [200, 30, 30, 255]))
    const reasons = detectGapReasons([java('RubyEntity')], ['entity'], root)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('纯色')
  })

  it('物品贴图两种以上颜色且不透明 → 无缺口', () => {
    mkdirSync(join(resRoot, 'textures/item'), { recursive: true })
    writeFileSync(
      join(resRoot, 'textures/item/ruby.png'),
      png(16, 16, (x, y) => ((x + y) % 2 === 0 ? [255, 0, 0, 255] : [180, 0, 40, 255]))
    )
    expect(detectGapReasons([java('RubyItem')], ['item'], root)).toEqual([])
  })

  it('近全透明（不透明占比 <5%）→ 报近空白', () => {
    mkdirSync(join(resRoot, 'textures/entity'), { recursive: true })
    // 64x64 仅 4x4 方块有两色不透明（1.5%）
    writeFileSync(
      join(resRoot, 'textures/entity/ruby.png'),
      png(64, 64, (x, y) =>
        x < 4 && y < 4 ? (x % 2 === 0 ? [1, 2, 3, 255] : [4, 5, 6, 255]) : [0, 0, 0, 0]
      )
    )
    const reasons = detectGapReasons([java('RubyEntity')], ['entity'], root)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('近乎全透明')
  })

  it('PNG 字节损坏无法解析 → 报损坏', () => {
    mkdirSync(join(resRoot, 'textures/entity'), { recursive: true })
    writeFileSync(join(resRoot, 'textures/entity/ruby.png'), Buffer.from([1, 2, 3]))
    const reasons = detectGapReasons([java('RubyEntity')], ['entity'], root)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('损坏')
  })

  it('与本轮无关 id 的空白贴图不扫描（精度护栏）', () => {
    mkdirSync(join(resRoot, 'textures/entity'), { recursive: true })
    writeFileSync(join(resRoot, 'textures/entity/other_mob.png'), png(64, 64, () => [0, 0, 0, 0]))
    expect(detectGapReasons([java('RubyEntity')], ['entity'], root)).toEqual([])
  })
})

describe('detectGapReasons · 模型 JSON 门（blockstate 变体引用）', () => {
  const bs = (model: string) =>
    fc(
      'src/main/resources/assets/yanshi/blockstates/solar.json',
      JSON.stringify({ variants: { 'lit=true': { model } } })
    )

  it('blockstate 引用本 mod 模型但 JSON 缺失 → 报缺口（run#10 _on 模型回归）', () => {
    const reasons = detectGapReasons([bs('yanshi:block/solar_on')], ['block'], root)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('模型 JSON')
    expect(reasons[0]).toContain('yanshi:block/solar_on')
  })

  it('模型 JSON 已在磁盘 → 无缺口', () => {
    mkdirSync(join(resRoot, 'models/block'), { recursive: true })
    writeFileSync(join(resRoot, 'models/block/solar_on.json'), '{}')
    expect(detectGapReasons([bs('yanshi:block/solar_on')], ['block'], root)).toEqual([])
  })

  it('模型 JSON 在本次变更中（write_project_file 已提交）→ 无缺口', () => {
    const model = fc('src/main/resources/assets/yanshi/models/block/solar_on.json', '{}')
    expect(detectGapReasons([bs('yanshi:block/solar_on'), model], ['block'], root)).toEqual([])
  })

  it('引用 minecraft 原版模型 → 不检查（随游戏存在）', () => {
    expect(detectGapReasons([bs('minecraft:block/furnace_on')], ['block'], root)).toEqual([])
  })
})
