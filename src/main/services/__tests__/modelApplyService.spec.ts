/**
 * modelApplyService 单测（画廊模型条目「写回目标对象」）：
 * - 独立模型资产 → 方块：落 .kunyu/content/models/<id>.json，方块只写 cubeModelId（内嵌会被扁平 schema 丢弃）
 * - 内嵌 Cube 模型（物品）→ 物品：内嵌 + cubeModelId 双写，14 像素画落 textures/item/<id>.png
 * - 实体骨骼模型 → Cube：首次 needsConfirm，confirm=true 后清空 geoJson/modelPath/animationPath 并落 custom
 * - 目标已有模型资产时沿用其 createdAt；来源无 Cube 几何 / 目标不存在 / 入参非法一律 ok:false
 * - 语义写入成功后贴图 PNG 落盘为 best-effort
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultBlock } from '../../../shared/schemas/block.schema'
import { createDefaultEntity } from '../../../shared/schemas/entity.schema'
import { createDefaultItem } from '../../../shared/schemas/item.schema'
import type { ModelAsset, EmbeddedCubeModel } from '../../../shared/types/content'
import { applyModelCandidate } from '../modelApplyService'
import { saveContent } from '../contentService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'

let source: string
let target: string
const roots: string[] = []

function mkRoot(prefix: string): string {
  const r = mkdtempSync(join(tmpdir(), prefix))
  roots.push(r)
  registerProjectRoot(r)
  mkdirSync(join(r, 'src/main/resources'), { recursive: true })
  writeFileSync(
    join(r, 'src/main/resources/fabric.mod.json'),
    JSON.stringify({ id: 'testmod' })
  )
  writeFileSync(join(r, 'gradle.properties'), 'maven_group=com.test\n')
  return r
}

/** 16×16 隔格上色的合法像素画 */
function pixels256(color = '#ff0000'): string[] {
  return Array.from({ length: 256 }, (_, i) => (i % 2 === 0 ? color : ''))
}

function cubeFace(): Record<string, { uv: number[]; texture: string }> {
  const f = (): { uv: number[]; texture: string } => ({ uv: [0, 0, 16, 16], texture: 'all' })
  return { down: f(), up: f(), north: f(), south: f(), west: f(), east: f() }
}

/** 一份最小合法的 Cube 几何（一个整块） */
function cubeModel(pixels: string[], textureSize: 16 | 32 = 16): EmbeddedCubeModel {
  return {
    textureSize,
    pixels,
    elements: [
      { name: '立方体 1', from: [0, 0, 0], to: [16, 16, 16], shade: true, faces: cubeFace() }
    ]
  }
}

function crateModel(pixels: string[] = pixels256()): ModelAsset {
  return {
    kind: 'model',
    id: 'crate',
    displayName: 'Crate',
    description: '',
    textureSize: 16,
    pixels,
    textures: { all: 'textures/model/crate.png' },
    createdAt: 111,
    updatedAt: 111,
    elements: cubeModel(pixels).elements
  }
}

function readJson(root: string, rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, rel), 'utf-8').replace(/^\ufeff/, '')) as Record<
    string,
    unknown
  >
}

beforeEach(() => {
  source = mkRoot('kunyu-mas-src-')
  target = mkRoot('kunyu-mas-tgt-')
})

afterEach(() => {
  for (const r of roots.splice(0)) unregisterProjectRoot(r)
  rmSync(source, { recursive: true, force: true })
  rmSync(target, { recursive: true, force: true })
})

describe('modelApplyService · 写回目标对象', () => {
  it('独立模型资产 → 方块：落目标自己的模型资产，方块只写 cubeModelId（不写内嵌）', () => {
    saveContent(source, crateModel())
    saveContent(target, createDefaultBlock('altar'))
    const res = applyModelCandidate(
      source,
      { ownerKind: 'model', ownerId: 'crate' },
      target,
      { kind: 'block', id: 'altar' }
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.replacedGeo).toBe(false)
    // 目标是「对象自己的」模型资产（id = 目标 id），不是把来源文件搬过去
    expect(existsSync(join(target, '.kunyu/content/models/altar.json'))).toBe(true)
    expect(existsSync(join(source, '.kunyu/content/models/crate.json'))).toBe(true)

    const model = readJson(target, '.kunyu/content/models/altar.json')
    expect(model.id).toBe('altar')
    expect(model.displayName).toBe('altar')
    expect((model.elements as unknown[]).length).toBe(1)
    // 目标是全新模型资产：createdAt 回落为当前时间（来源的 111 不会被继承）
    expect(typeof model.createdAt).toBe('number')

    const block = readJson(target, '.kunyu/content/blocks/altar.json') as {
      cubeModelId?: string | null
      model?: { cubeModel?: unknown }
      texture?: { pixels?: string[] }
    }
    expect(block.cubeModelId).toBe('altar')
    // 方块扁平 schema 不以 model.cubeModel 承载几何，写内嵌只会造成假象
    expect(block.model?.cubeModel ?? null).toBe(null)
    expect(block.texture?.pixels?.length).toBe(256)
    expect(res.written.some((w) => w.includes('textures/block/altar.png'))).toBe(true)
    expect(
      existsSync(join(target, 'src/main/resources/assets/testmod/textures/block/altar.png'))
    ).toBe(true)
  })

  it('内嵌 Cube 模型（物品 → 物品）：内嵌与绑定双写，贴图 PNG 一并落盘', () => {
    const wand = createDefaultItem('wand', 'simple')
    wand.model = { ...wand.model, cubeModel: cubeModel(pixels256('#ffcc00')) }
    saveContent(source, wand)
    saveContent(target, createDefaultItem('staff', 'simple'))
    const res = applyModelCandidate(
      source,
      { ownerKind: 'item', ownerId: 'wand' },
      target,
      { kind: 'item', id: 'staff' }
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const item = readJson(target, '.kunyu/content/items/staff.json') as {
      cubeModelId?: string | null
      model?: { cubeModel?: { elements?: unknown[]; pixels?: string[] } }
      texture?: { pixels?: string[] }
    }
    expect(item.cubeModelId).toBe('staff')
    expect(item.model?.cubeModel?.elements?.length).toBe(1)
    expect(item.model?.cubeModel?.pixels?.length).toBe(256)
    // 物品自带贴图路径为空时像素画直接物化，便于产物阶段直接用上
    expect(item.texture?.pixels?.length).toBe(256)
    expect(res.written.some((w) => w.includes('textures/item/staff.png'))).toBe(true)
    expect(res.written.some((w) => w.includes('textures/model/staff.png'))).toBe(true)
  })

  it('实体骨骼模型 → Cube：先 needsConfirm，确认后清空骨骼几何与动画路径', () => {
    saveContent(source, crateModel())
    const golem = createDefaultEntity('golem')
    golem.renderer = {
      modelType: 'blockbench_geo',
      modelPath: 'geo/golem.geo.json',
      animationPath: 'animations/golem.animation.json',
      geoJson: JSON.stringify({
        format_version: '1.12.0',
        'minecraft:geometry': [{ bones: [{ name: 'root' }] }]
      })
    }
    saveContent(target, golem)

    const first = applyModelCandidate(
      source,
      { ownerKind: 'model', ownerId: 'crate' },
      target,
      { kind: 'entity', id: 'golem' }
    )
    expect(first.ok).toBe(false)
    if (first.ok) return
    expect(first.needsConfirm).toBe(true)
    // 未确认前不落盘：骨骼模型保持原样
    expect(
      (readJson(target, '.kunyu/content/entities/golem.json') as { renderer: { modelType: string } })
        .renderer.modelType
    ).toBe('blockbench_geo')

    const second = applyModelCandidate(
      source,
      { ownerKind: 'model', ownerId: 'crate' },
      target,
      { kind: 'entity', id: 'golem' },
      true
    )
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.replacedGeo).toBe(true)
    const saved = readJson(target, '.kunyu/content/entities/golem.json') as {
      cubeModelId?: string | null
      renderer: {
        modelType: string
        geoJson?: string | null
        modelPath?: string | null
        animationPath?: string | null
        cubeModel?: { elements?: unknown[] }
      }
    }
    expect(saved.cubeModelId).toBe('golem')
    expect(saved.renderer.modelType).toBe('custom')
    expect(saved.renderer.geoJson).toBe(null)
    expect(saved.renderer.modelPath).toBe(null)
    expect(saved.renderer.animationPath).toBe(null)
    expect(saved.renderer.cubeModel?.elements?.length).toBe(1)
  })

  it('实体本来就是 Cube 模型时无需确认，直接覆盖', () => {
    saveContent(source, crateModel())
    saveContent(target, createDefaultEntity('golem'))
    const res = applyModelCandidate(
      source,
      { ownerKind: 'model', ownerId: 'crate' },
      target,
      { kind: 'entity', id: 'golem' }
    )
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.replacedGeo).toBe(false)
  })

  it('目标已有模型资产时沿用其 createdAt，避免画廊排序被重写打乱', () => {
    saveContent(source, crateModel())
    saveContent(target, { ...crateModel(), id: 'altar', createdAt: 555, updatedAt: 555 })
    saveContent(target, createDefaultBlock('altar'))
    const res = applyModelCandidate(
      source,
      { ownerKind: 'model', ownerId: 'crate' },
      target,
      { kind: 'block', id: 'altar' }
    )
    expect(res.ok).toBe(true)
    const model = readJson(target, '.kunyu/content/models/altar.json')
    expect(model.createdAt).toBe(555)
    expect((model.updatedAt as number) > 555).toBe(true)
  })

  it('来源无 Cube 几何（骨骼实体 / 空模型）或目标不存在时拒绝', () => {
    const golem = createDefaultEntity('golem')
    golem.renderer = {
      modelType: 'blockbench_geo',
      modelPath: 'geo/golem.geo.json',
      animationPath: null,
      geoJson: JSON.stringify({
        format_version: '1.12.0',
        'minecraft:geometry': [{ bones: [{ name: 'root' }] }]
      })
    }
    saveContent(source, golem)
    saveContent(target, crateModel())
    // 骨骼实体不能当来源（无 Cube 几何，无法物化成 cube 模型）
    const noGeo = applyModelCandidate(
      source,
      { ownerKind: 'entity', ownerId: 'golem' },
      target,
      { kind: 'block', id: 'crate' }
    )
    expect(noGeo.ok).toBe(false)
    if (!noGeo.ok) expect(noGeo.errorMessage).toContain('内嵌的立方体模型')

    // 目标不存在
    const noTarget = applyModelCandidate(
      source,
      { ownerKind: 'entity', ownerId: 'golem' },
      target,
      { kind: 'block', id: 'nope' }
    )
    expect(noTarget.ok).toBe(false)
  })

  it('入参非法（缺根路径 / 类型或 id 不合法）一律拒绝', () => {
    saveContent(target, crateModel())
    expect(
      applyModelCandidate('', { ownerKind: 'model', ownerId: 'crate' }, target, {
        kind: 'block',
        id: 'crate'
      }).ok
    ).toBe(false)
    expect(
      applyModelCandidate(source, { ownerKind: 'model', ownerId: 'crate' }, '', {
        kind: 'block',
        id: 'crate'
      }).ok
    ).toBe(false)
    expect(
      applyModelCandidate(
        source,
        { ownerKind: 'nope' as never, ownerId: 'crate' },
        target,
        { kind: 'block', id: 'crate' }
      ).ok
    ).toBe(false)
    expect(
      applyModelCandidate(source, { ownerKind: 'model', ownerId: 'crate' }, target, {
        kind: 'nope' as never,
        id: 'crate'
      }).ok
    ).toBe(false)
    // 来源 id 与目标 id 都为空
    expect(
      applyModelCandidate(source, { ownerKind: 'model', ownerId: '' }, target, {
        kind: 'block',
        id: ''
      }).ok
    ).toBe(false)
  })
})
