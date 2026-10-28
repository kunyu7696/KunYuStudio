/**
 * modelerGeoApply 单测（P3-f 工坊骨骼文档 → 实体 geoJson 写回）：
 * - happy path：bedrock_entity 文档 → renderer.geoJson = documentToGeo 产物，modelType=blockbench_geo，
 *   cubeModel/cubeModelId 清空，animationPath 保留
 * - 覆盖已有骨骼几何：首次 needsConfirm 不落盘，confirm=true 后 replacedGeo:true
 * - 格式守卫：java_block 文档拒绝；文档缺失 / 无骨骼 / 非法 id 一律 ok:false
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultEntity } from '../../../../shared/schemas/entity.schema'
import { createCubeNode, createDocument, createGroupNode, addNode } from '../../../../shared/modeler/document'
import { documentToGeo } from '../../../../shared/modeler/formats'
import type { ModelDocument } from '../../../../shared/modeler/types'
import { applyModelerGeoToEntity } from '../modelerGeoApply'
import { saveContent, loadContent } from '../../contentService'
import { registerProjectRoot, unregisterProjectRoot } from '../../fsService'
import { resolveEntityGeo } from '../../contentGenerator/javaEntities'

let root: string
const roots: string[] = []

function mkRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'ky-geo-apply-'))
  roots.push(r)
  registerProjectRoot(r)
  mkdirSync(join(r, 'src/main/resources'), { recursive: true })
  writeFileSync(join(r, 'src/main/resources/fabric.mod.json'), JSON.stringify({ id: 'testmod' }))
  writeFileSync(join(r, 'gradle.properties'), 'maven_group=com.test\n')
  return r
}

/** 一份带两骨骼的 bedrock_entity 工坊文档（落盘态） */
function boneDoc(format: 'bedrock_entity' | 'geckolib' = 'bedrock_entity'): ModelDocument {
  let doc = createDocument({ id: 'beast', name: 'beast', format, now: 1000 })
  const body = createGroupNode('body')
  body.origin = [0, 12, 0]
  doc = addNode(doc, body, null)
  const cube = createCubeNode('body_c1')
  cube.from = [-4, 0, -2]
  cube.to = [4, 12, 2]
  cube.boxUv = { uvOffset: [16, 16] }
  doc = addNode(doc, cube, body.id)
  return doc
}

function writeDoc(doc: ModelDocument, id = 'beast'): void {
  mkdirSync(join(root, '.kunyu', 'modeler'), { recursive: true })
  writeFileSync(
    join(root, '.kunyu', 'modeler', `${id}.json`),
    JSON.stringify({ ...doc, id }, null, 2)
  )
}

function readEntity(id = 'golem'): {
  renderer: { modelType: string; geoJson?: string | null; modelPath?: string | null; animationPath?: string | null; modelerDocId?: string | null; texturePng?: string | null; cubeModel?: unknown }
  cubeModelId?: string | null
} {
  return JSON.parse(readFileSync(join(root, '.kunyu', 'content', 'entities', `${id}.json`), 'utf8'))
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

describe('applyModelerGeoToEntity', () => {
  it('happy path：geoJson 与 documentToGeo 产物一致，cube 清空、animationPath 保留', () => {
    const doc = boneDoc()
    writeDoc(doc)
    const entity = createDefaultEntity('golem')
    entity.renderer = {
      modelType: 'custom',
      modelPath: null,
      animationPath: 'animations/golem.animation.json',
      geoJson: null,
      cubeModel: { textureSize: 16, pixels: [], elements: [] }
    }
    entity.cubeModelId = 'old'
    saveContent(root, entity)

    const res = applyModelerGeoToEntity(root, 'beast', 'golem')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.replacedGeo).toBe(false)
    expect(res.written).toContain('.kunyu/content/entities/golem.json')

    const saved = readEntity()
    expect(saved.renderer.modelType).toBe('blockbench_geo')
    expect(saved.renderer.modelPath).toBe(null)
    expect(saved.renderer.cubeModel ?? null).toBe(null)
    expect(saved.cubeModelId ?? null).toBe(null)
    expect(saved.renderer.animationPath).toBe('animations/golem.animation.json')
    expect(saved.renderer.modelerDocId).toBe('beast') // P4-gen：登记来源工坊文档
    expect(JSON.parse(saved.renderer.geoJson!)).toEqual(documentToGeo(doc).output)
  })

  it('主贴图直出：文档第一张 textures 剥前缀写回 renderer.texturePng；无贴图清空旧值防悬挂', () => {
    const doc = boneDoc()
    doc.textures = {
      t1: {
        id: 't1',
        name: 'main',
        width: 16,
        height: 16,
        data: 'data:image/png;base64,QUJD',
        visible: true
      }
    }
    writeDoc(doc)
    saveContent(root, createDefaultEntity('golem'))

    const res = applyModelerGeoToEntity(root, 'beast', 'golem')
    expect(res.ok).toBe(true)
    expect(readEntity().renderer.texturePng).toBe('QUJD')

    // 二次写回：文档无贴图 → 清空旧值（不遗留上一次贴图）
    writeDoc(boneDoc())
    const res2 = applyModelerGeoToEntity(root, 'beast', 'golem', true)
    expect(res2.ok).toBe(true)
    expect(readEntity().renderer.texturePng ?? null).toBe(null)
  })

  it('geckolib 文档同样可写回（format 标记仅作守卫，产物同构）', () => {
    writeDoc(boneDoc('geckolib'))
    saveContent(root, createDefaultEntity('golem'))
    const res = applyModelerGeoToEntity(root, 'beast', 'golem')
    expect(res.ok).toBe(true)
  })

  it('构建链闭环（P3 出口标准）：写回后 resolveEntityGeo 可解析出骨骼与贴图尺寸', () => {
    writeDoc(boneDoc())
    saveContent(root, createDefaultEntity('golem'))
    expect(applyModelerGeoToEntity(root, 'beast', 'golem').ok).toBe(true)
    const entity = loadContent(root, 'entity', 'golem') as Parameters<typeof resolveEntityGeo>[0]
    const info = resolveEntityGeo(entity)
    expect(info).not.toBeNull()
    if (!info) return
    expect(info.boneNames).toEqual(['body'])
    // 文档无贴图时 texture_width 缺省不写 → parseGeoModelInfo 回退 64
    expect(info.textureWidth).toBe(64)
    expect(info.textureHeight).toBe(64)
  })

  it('覆盖已有骨骼几何：首次 needsConfirm 不落盘，确认后 replacedGeo:true', () => {
    writeDoc(boneDoc())
    const entity = createDefaultEntity('golem')
    entity.renderer = {
      modelType: 'blockbench_geo',
      modelPath: 'geo/golem.geo.json',
      animationPath: null,
      geoJson: '{"format_version":"1.12.0"}'
    }
    saveContent(root, entity)

    const first = applyModelerGeoToEntity(root, 'beast', 'golem')
    expect(first.ok).toBe(false)
    if (first.ok) return
    expect(first.needsConfirm).toBe(true)
    // 未确认前不落盘
    expect(readEntity().renderer.modelType).toBe('blockbench_geo')
    expect(readEntity().renderer.modelPath).toBe('geo/golem.geo.json')

    const second = applyModelerGeoToEntity(root, 'beast', 'golem', true)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.replacedGeo).toBe(true)
    expect(readEntity().renderer.modelPath).toBe(null)
    expect(JSON.parse(readEntity().renderer.geoJson!)).toHaveProperty('minecraft:geometry')
  })

  it('格式守卫：java_block 文档拒绝写回', () => {
    writeDoc({ ...boneDoc(), format: 'java_block' })
    saveContent(root, createDefaultEntity('golem'))
    const res = applyModelerGeoToEntity(root, 'beast', 'golem')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errorMessage).toContain('不是实体几何格式')
  })

  it('文档缺失 / 无骨骼 / 非法 id 一律 ok:false 且不动实体', () => {
    saveContent(root, createDefaultEntity('golem'))
    expect(applyModelerGeoToEntity(root, 'ghost', 'golem').ok).toBe(false)
    // 空文档（无节点 → 无骨骼）
    writeDoc({ ...boneDoc(), nodes: {}, root: [] }, 'empty')
    const empty = applyModelerGeoToEntity(root, 'empty', 'golem')
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.errorMessage).toContain('没有任何骨骼')
    // 路径穿越 id
    expect(applyModelerGeoToEntity(root, '../evil', 'golem').ok).toBe(false)
    expect(applyModelerGeoToEntity(root, 'beast', '../evil').ok).toBe(false)
  })
})
