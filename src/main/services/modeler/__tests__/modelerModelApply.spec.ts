/**
 * modelerModelApply 单测（P5-open 工坊 java_block 文档 → 内容对象写回）：
 * - happy path block：模型资产落盘 + 方块只认 cubeModelId + 贴图 PNG 物化 + 路径改写
 * - happy path item：内嵌 cubeModel 与 cubeModelId 双写
 * - 贴图解析：文档贴图 data URL 正确解码为 asset.pixels
 * - 实体 geo→cube：首次 needsConfirm 不落盘，confirm=true 后 replacedGeo:true
 * - 格式守卫：bedrock_entity 文档拒绝；文档缺失 / 目标缺失 / 非法 id 一律 ok:false
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultBlock } from '../../../../shared/schemas/block.schema'
import { createDefaultItem } from '../../../../shared/schemas/item.schema'
import { createDefaultEntity } from '../../../../shared/schemas/entity.schema'
import {
  addNode,
  addTexture,
  createCubeNode,
  createDocument
} from '../../../../shared/modeler/document'
import { autoFaceUv, cubeSize } from '../../../../shared/modeler/uv'
import { FACE_NAMES } from '../../../../shared/modeler/types'
import type { ModelDocument } from '../../../../shared/modeler/types'
import { encodePng } from '../../ai/pixelize'
import { applyModelerModelToObject } from '../modelerModelApply'
import { saveContent } from '../../contentService'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'

let root: string
const roots: string[] = []

function mkRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'ky-model-apply-'))
  roots.push(r)
  registerProjectRoot(r)
  mkdirSync(join(r, 'src/main/resources'), { recursive: true })
  writeFileSync(join(r, 'src/main/resources/fabric.mod.json'), JSON.stringify({ id: 'testmod' }))
  writeFileSync(join(r, 'gradle.properties'), 'maven_group=com.test\n')
  return r
}

/** 16×16 纯红 PNG data URL（测试贴图） */
function redPngDataUrl(): string {
  const data = new Uint8ClampedArray(16 * 16 * 4)
  for (let i = 0; i < 16 * 16; i++) {
    data[i * 4] = 255
    data[i * 4 + 3] = 255
  }
  return `data:image/png;base64,${encodePng({ width: 16, height: 16, data }).toString('base64')}`
}

/** 一份单立方体 + 单贴图的 java_block 工坊文档 */
function javaDoc(id = 'block__stone'): ModelDocument {
  let doc = createDocument({ id, name: 'Stone', format: 'java_block', now: 1000 })
  const cube = createCubeNode('body')
  cube.from = [0, 0, 0]
  cube.to = [16, 16, 16]
  doc = addTexture(doc, {
    id: 'tex-1',
    name: 'all',
    width: 16,
    height: 16,
    data: redPngDataUrl(),
    visible: true
  })
  const size = cubeSize(cube)
  cube.faces = Object.fromEntries(
    FACE_NAMES.map((f) => [f, { uv: autoFaceUv(size, f), texture: 'tex-1' }])
  ) as typeof cube.faces
  doc = addNode(doc, cube, null)
  return doc
}

function writeDoc(doc: ModelDocument, id = 'block__stone'): void {
  mkdirSync(join(root, '.kunyu', 'modeler'), { recursive: true })
  writeFileSync(join(root, '.kunyu', 'modeler', `${id}.json`), JSON.stringify({ ...doc, id }, null, 2))
}

beforeEach(() => {
  root = mkRoot()
})

afterEach(() => {
  for (const r of roots.splice(0)) {
    unregisterProjectRoot(r)
    rmSync(r, { recursive: true, force: true })
  }
})

describe('applyModelerModelToObject', () => {
  it('block：模型资产落盘 + cubeModelId 绑定 + 贴图物化 + 路径改写', () => {
    writeDoc(javaDoc())
    saveContent(root, createDefaultBlock('stone'))
    const res = applyModelerModelToObject(root, 'block__stone', 'block', 'stone')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.written).toContain('.kunyu/content/models/stone.json')
    expect(res.written).toContain('.kunyu/content/blocks/stone.json')

    // 方块只认 cubeModelId（内嵌 model.cubeModel 会被 normalize 丢弃）
    const block = JSON.parse(
      readFileSync(join(root, '.kunyu', 'content', 'blocks', 'stone.json'), 'utf8')
    ) as { cubeModelId?: string | null }
    expect(block.cubeModelId).toBe('stone')

    // 模型资产：id 与贴图路径改写为目标 id
    const asset = JSON.parse(
      readFileSync(join(root, '.kunyu', 'content', 'models', 'stone.json'), 'utf8')
    ) as { id: string; textures: Record<string, string>; pixels: string[]; textureSize: number }
    expect(asset.id).toBe('stone')
    expect(asset.textures.all).toBe('textures/model/stone.png')
    expect(asset.pixels.length).toBe(16 * 16)
    expect(asset.pixels.every((p) => p === '#ff0000')).toBe(true)

    // 贴图 PNG 物化
    expect(
      existsSync(join(root, 'src/main/resources/assets/testmod/textures/model/stone.png'))
    ).toBe(true)
  })

  it('item：内嵌 cubeModel 与 cubeModelId 双写', () => {
    writeDoc(javaDoc('item__wand'), 'item__wand')
    saveContent(root, createDefaultItem('wand'))
    const res = applyModelerModelToObject(root, 'item__wand', 'item', 'wand')
    expect(res.ok).toBe(true)
    const item = JSON.parse(
      readFileSync(join(root, '.kunyu', 'content', 'items', 'wand.json'), 'utf8')
    ) as { cubeModelId?: string | null; model?: { cubeModel?: { elements?: unknown[] } | null } }
    expect(item.cubeModelId).toBe('wand')
    expect(item.model?.cubeModel?.elements?.length).toBe(1)
  })

  it('实体 geo→cube：首次 needsConfirm 不落盘，confirm 后 replacedGeo:true', () => {
    writeDoc(javaDoc('entity__golem'), 'entity__golem')
    const entity = createDefaultEntity('golem')
    entity.renderer = {
      modelType: 'blockbench_geo',
      modelPath: null,
      animationPath: 'animations/golem.animation.json',
      geoJson: '{"minecraft:geometry":[]}',
      cubeModel: null
    }
    saveContent(root, entity)

    const first = applyModelerModelToObject(root, 'entity__golem', 'entity', 'golem')
    expect(first.ok).toBe(false)
    if (first.ok) return
    expect(first.needsConfirm).toBe(true)
    // 未确认：模型资产不落盘（避免孤儿资产）
    expect(existsSync(join(root, '.kunyu', 'content', 'models', 'golem.json'))).toBe(false)

    const second = applyModelerModelToObject(root, 'entity__golem', 'entity', 'golem', true)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.replacedGeo).toBe(true)
    const written = JSON.parse(
      readFileSync(join(root, '.kunyu', 'content', 'entities', 'golem.json'), 'utf8')
    ) as { renderer: { modelType: string; geoJson?: string | null }; cubeModelId?: string | null }
    expect(written.renderer.modelType).toBe('custom')
    expect(written.renderer.geoJson ?? null).toBe(null)
    expect(written.cubeModelId).toBe('golem')
  })

  it('格式守卫与错误路径：非 java_block 文档 / 缺文档 / 缺目标 / 非法 id', () => {
    const geo = createDocument({ id: 'entity__beast', name: 'beast', format: 'bedrock_entity', now: 1000 })
    writeDoc(geo, 'entity__beast')
    saveContent(root, createDefaultBlock('stone'))

    const wrongFormat = applyModelerModelToObject(root, 'entity__beast', 'block', 'stone')
    expect(wrongFormat.ok).toBe(false)
    if (!wrongFormat.ok) expect(wrongFormat.errorMessage).toContain('不是 Java 方块/物品格式')

    const missingDoc = applyModelerModelToObject(root, 'block__ghost', 'block', 'stone')
    expect(missingDoc.ok).toBe(false)
    if (!missingDoc.ok) expect(missingDoc.errorMessage).toContain('找不到模型文档')

    writeDoc(javaDoc())
    const missingTarget = applyModelerModelToObject(root, 'block__stone', 'block', 'ghost')
    expect(missingTarget.ok).toBe(false)
    if (!missingTarget.ok) expect(missingTarget.errorMessage).toContain('找不到目标对象')

    const badId = applyModelerModelToObject(root, '../etc', 'block', 'stone')
    expect(badId.ok).toBe(false)
    if (!badId.ok) expect(badId.errorMessage).toContain('非法文档 id')

    const badKind = applyModelerModelToObject(root, 'block__stone', 'biome' as 'block', 'stone')
    expect(badKind.ok).toBe(false)
    if (!badKind.ok) expect(badKind.errorMessage).toContain('非法目标类型')
  })
})
