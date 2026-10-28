/**
 * content:doctor 资源体检测试：
 * 非模组工程失败、干净工程无问题、缺贴图、悬空模型、配方未知引用、损坏 JSON。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runContentDoctor } from '../contentDoctor'
import { saveContent } from '../contentService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { createDefaultBlock } from '../../../shared/schemas/block.schema'
import { createDefaultItem } from '../../../shared/schemas/item.schema'
import { createDefaultModel } from '../../../shared/types/content'
import type { RecipeDef } from '../../../shared/schemas/recipe.schema'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-doctor-'))
  registerProjectRoot(root)
  // 最小 Fabric 模组工程（resolveModContext 需要描述文件）
  mkdirSync(join(root, 'src', 'main', 'resources'), { recursive: true })
  writeFileSync(
    join(root, 'src', 'main', 'resources', 'fabric.mod.json'),
    JSON.stringify({ id: 'demo', name: 'Demo' }),
    'utf-8'
  )
})
afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('runContentDoctor', () => {
  it('不是模组工程时 ok:false 并说明原因', () => {
    const empty = mkdtempSync(join(tmpdir(), 'kunyu-doctor-empty-'))
    registerProjectRoot(empty)
    try {
      const r = runContentDoctor(empty)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('模组')
    } finally {
      unregisterProjectRoot(empty)
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('干净工程（程序化贴图、引用自洽）无问题', () => {
    const block = createDefaultBlock('ruby_block')
    block.recipes = [
      {
        id: 'ruby_block',
        kind: 'crafting_shapeless',
        ingredients: [{ item: 'minecraft:stick' }],
        result: { item: 'ruby_block', count: 1 }
      }
    ]
    saveContent(root, block)
    saveContent(root, createDefaultItem('ruby'))
    const r = runContentDoctor(root)
    expect(r.ok).toBe(true)
    expect(r.objectCount).toBe(2)
    expect(r.issues).toHaveLength(0)
  })

  it('自定义贴图文件缺失 → error', () => {
    const block = createDefaultBlock('ruby_block')
    block.texture = { path: 'block/missing', generated: false, color: '#ff0000' }
    saveContent(root, block)
    const r = runContentDoctor(root)
    const issue = r.issues.find((i) => i.kind === 'missing_texture')
    expect(issue?.level).toBe('error')
    expect(issue?.message).toContain('textures/block/missing.png')
  })

  it('cubeModelId 悬空 → error，绑定存在的模型则无问题', () => {
    const dangling = createDefaultBlock('ghost_box')
    dangling.cubeModelId = 'no_such_model'
    saveContent(root, dangling)
    const r1 = runContentDoctor(root)
    expect(r1.issues.some((i) => i.kind === 'dangling_model' && i.id === 'ghost_box')).toBe(true)

    const model = createDefaultModel('real_model')
    saveContent(root, model)
    const bound = createDefaultBlock('bound_box')
    bound.cubeModelId = 'real_model'
    saveContent(root, bound)
    const r2 = runContentDoctor(root)
    expect(r2.issues.some((i) => i.kind === 'dangling_model' && i.id === 'bound_box')).toBe(false)
  })

  it('配方引用本模组不存在对象 → warn；原版 id 不报', () => {
    const recipe: RecipeDef = {
      id: 'ruby_block',
      kind: 'crafting_shapeless',
      ingredients: [{ item: 'demo:missing_gem' }, { item: 'minecraft:iron_ingot' }],
      result: { item: 'ruby_block', count: 1 }
    }
    const block = createDefaultBlock('ruby_block')
    block.recipes = [recipe]
    saveContent(root, block)
    const r = runContentDoctor(root)
    const warns = r.issues.filter((i) => i.kind === 'unknown_recipe_ref')
    expect(warns).toHaveLength(1)
    expect(warns[0].message).toContain('demo:missing_gem')
  })

  it('损坏/缺字段的语义文件 → corrupt_json error', () => {
    const dir = join(root, '.kunyu', 'content', 'blocks')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'broken.json'), '{ not json', 'utf-8')
    writeFileSync(join(dir, 'shapeless.json'), JSON.stringify({ kind: 'block' }), 'utf-8')
    const r = runContentDoctor(root)
    const corrupt = r.issues.filter((i) => i.kind === 'corrupt_json')
    expect(corrupt).toHaveLength(2)
    expect(r.errorCount).toBe(2)
  })
})
