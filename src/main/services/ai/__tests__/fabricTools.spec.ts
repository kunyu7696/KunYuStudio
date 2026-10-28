import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../settingsService', () => ({
  getSection: () => ({ proxyMode: 'none', proxyHost: '', proxyPort: 0, timeoutSec: 30 })
}))

import { builtinFabricTools } from '../fcTools/fabricTools'
import type { ToolRegistryDeps } from '../toolRegistry'
import type { ReferenceService } from '../referencePackageService'
import type { ManifestTemplate, TemplateView } from '../../../../shared/types/aiReference'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }

function stubTemplate(over: Partial<ManifestTemplate>): ManifestTemplate {
  return {
    id: 'fabric/1.20.1/item/simple_item.java',
    loader: 'fabric',
    version: '1.20.1',
    type: 'item',
    file: 'templates/fabric/1.20.1/item/simple_item.java',
    filename: 'simple_item.java',
    contentTypes: ['item'],
    keywords: ['item', '注册'],
    appliesTo: { loaders: ['fabric'], mcVersions: ['1.20.1'] },
    verified: '1.20.1',
    verifiedAt: '2026-01-01',
    build: 'pass',
    active: true,
    provenance: 'pdf',
    ...over
  }
}

function stubReference(opts: {
  loaded?: boolean
  templates?: ManifestTemplate[]
  contents?: Record<string, string>
}): ReferenceService {
  const templates = opts.templates ?? []
  const contents = opts.contents ?? {}
  return {
    isLoaded: () => opts.loaded !== false,
    loadError: () => 'stub load error',
    getManifest: () => ({ templates }) as never,
    listTemplates: () => templates,
    readTemplate: (id: string): TemplateView | null => {
      const t = templates.find((x) => x.id === id)
      if (!t) return null
      return { ...t, content: contents[id] ?? 'package com.example.mod;\n// examplemod\n' }
    }
  } as unknown as ReferenceService
}

describe('fabricTools', () => {
  let root: string
  let deps: ToolRegistryDeps

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kunyu-fabric-'))
    mkdirSync(join(root, 'src/main/resources'), { recursive: true })
    writeFileSync(join(root, 'src/main/resources/fabric.mod.json'), JSON.stringify({ id: 'examplemod' }))
    deps = { projectRoot: () => root }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function tool(name: string) {
    const t = builtinFabricTools(deps).find((x) => x.def.function.name === name)
    if (!t) throw new Error(`tool not found: ${name}`)
    return t
  }

  describe('fabric_meta_version_check', () => {
    it('项目未打开时拒绝', async () => {
      deps.projectRoot = () => null
      const r = await tool('fabric_meta_version_check').execute({ mcVersion: '1.20.1' }, CTX)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('没有打开的项目')
    })

    it('缺 mcVersion 且 gradle.properties 无 minecraft_version 时报错', async () => {
      const r = await tool('fabric_meta_version_check').execute({}, CTX)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('未提供 mcVersion')
    })

    it('离线时软失败并提示', async () => {
      vi.mock('../../httpUtil', () => ({
        httpGetText: vi.fn().mockRejectedValue(new Error('connect ETIMEDOUT'))
      }))
      const mod = await import('../fcTools/fabricTools')
      const t = mod.builtinFabricTools(deps).find((x) => x.def.function.name === 'fabric_meta_version_check')!
      const r = await t.execute({ mcVersion: '1.20.1' }, CTX)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('查询 Fabric meta 失败')
    })
  })

  describe('fabric_javadoc_lookup', () => {
    it('query 命中内置速查', async () => {
      const r = await tool('fabric_javadoc_lookup').execute({ query: 'MinecraftClient' }, CTX)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('net.minecraft.client.MinecraftClient')
    })

    it('methodName 过滤不命中时回退', async () => {
      const r = await tool('fabric_javadoc_lookup').execute(
        { className: 'LivingEntity', methodName: 'no_such_method_xyz' },
        CTX
      )
      expect(r.ok).toBe(true)
      expect(r.text).toContain('未命中')
    })

    it('无参数时列出全部速查', async () => {
      const r = await tool('fabric_javadoc_lookup').execute({}, CTX)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('常用类速查')
    })
  })

  describe('fabric_template_generate', () => {
    it('reference 未注入时报错', async () => {
      const r = await tool('fabric_template_generate').execute({}, CTX)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('参考包服务不可用')
    })

    it('列表模式返回模板 id', async () => {
      deps.reference = stubReference({ templates: [stubTemplate({})] })
      const r = await tool('fabric_template_generate').execute({}, CTX)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('fabric/1.20.1/item/simple_item.java')
    })

    it('模板不存在时报错', async () => {
      deps.reference = stubReference({ templates: [] })
      const r = await tool('fabric_template_generate').execute({ templateId: 'nope' }, CTX)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('模板不存在')
    })

    it('取全文并做占位替换', async () => {
      deps.reference = stubReference({
        templates: [stubTemplate({})],
        contents: {
          'fabric/1.20.1/item/simple_item.java':
            'package com.example.mod.item;\nString id = "examplemod";\nclass ExampleMod {}'
        }
      })
      writeFileSync(
        join(root, 'gradle.properties'),
        'minecraft_version=1.20.1\nmaven_group=com.testmod\n'
      )
      const r = await tool('fabric_template_generate').execute(
        { templateId: 'fabric/1.20.1/item/simple_item.java', params: { className: 'TestMod' } },
        CTX
      )
      expect(r.ok).toBe(true)
      expect(r.text).toContain('package com.testmod.item;')
      expect(r.text).toContain('class TestMod {}')
    })

    it('write 落盘且已存在需 overwrite；路径越界拒绝', async () => {
      deps.reference = stubReference({ templates: [stubTemplate({})] })
      const rel = 'src/main/java/com/examplemod/ModItems.java'
      const w1 = await tool('fabric_template_generate').execute(
        { templateId: 'fabric/1.20.1/item/simple_item.java', write: true, targetPath: rel },
        CTX
      )
      expect(w1.ok).toBe(true)
      expect(existsSync(join(root, rel))).toBe(true)

      const w2 = await tool('fabric_template_generate').execute(
        { templateId: 'fabric/1.20.1/item/simple_item.java', write: true, targetPath: rel },
        CTX
      )
      expect(w2.ok).toBe(false)
      expect(w2.error).toContain('已存在')

      const bad = await tool('fabric_template_generate').execute(
        { templateId: 'fabric/1.20.1/item/simple_item.java', write: true, targetPath: '../evil.java' },
        CTX
      )
      expect(bad.ok).toBe(false)
      expect(bad.error).toContain('越界')
    })
  })

  describe('fabric_content_register', () => {
    it('kind/name 非法拒绝', async () => {
      const r1 = await tool('fabric_content_register').execute({ kind: 'potion', name: 'x' }, CTX)
      expect(r1.ok).toBe(false)
      const r2 = await tool('fabric_content_register').execute({ kind: 'item', name: 'BadName' }, CTX)
      expect(r2.ok).toBe(false)
      expect(r2.error).toContain('非法')
    })

    it('生成 item 注册骨架含 Registry.register', async () => {
      const r = await tool('fabric_content_register').execute({ kind: 'item', name: 'ruby' }, CTX)
      expect(r.ok).toBe(true)
      expect(r.text).toContain('Registry.register(Registries.ITEM')
      expect(r.text).toContain('"examplemod"')
      expect(r.text).toContain('RUBY')
    })

    it('write 落盘到 registry 目录，重复写入需 overwrite', async () => {
      const w1 = await tool('fabric_content_register').execute(
        { kind: 'block', name: 'ruby_block', write: true },
        CTX
      )
      expect(w1.ok).toBe(true)
      const rel = join('src/main/java/com/examplemod/registry/ModBlocks.java')
      expect(existsSync(join(root, rel))).toBe(true)
      const src = readFileSync(join(root, rel), 'utf-8')
      expect(src).toContain('Registries.BLOCK')

      const w2 = await tool('fabric_content_register').execute(
        { kind: 'block', name: 'ruby_block', write: true },
        CTX
      )
      expect(w2.ok).toBe(false)
      expect(w2.error).toContain('已存在')
    })
  })

  describe('fabric_data_assets_generate', () => {
    it('model_item 生成路径与内容', async () => {
      const r = await tool('fabric_data_assets_generate').execute(
        { kind: 'model_item', name: 'ruby' },
        CTX
      )
      expect(r.ok).toBe(true)
      expect(r.text).toContain('assets/examplemod/models/item/ruby.json')
      expect(r.text).toContain('examplemod:item/ruby')
    })

    it('recipe_shapeless 缺产物/原料时报错', async () => {
      const r = await tool('fabric_data_assets_generate').execute(
        { kind: 'recipe_shapeless', name: 'ruby_from_block' },
        CTX
      )
      expect(r.ok).toBe(false)
      expect(r.error).toContain('resultItem')
    })

    it('lang_entry 合并写入 en_us.json', async () => {
      const w1 = await tool('fabric_data_assets_generate').execute(
        { kind: 'lang_entry', langKey: 'item.examplemod.ruby', langValue: 'Ruby', write: true },
        CTX
      )
      expect(w1.ok).toBe(true)
      const langPath = join(root, 'src/main/resources/assets/examplemod/lang/en_us.json')
      expect(JSON.parse(readFileSync(langPath, 'utf-8'))).toEqual({ 'item.examplemod.ruby': 'Ruby' })

      // 二次写入合并而非覆盖（overwrite=true 允许重写文件）
      const w2 = await tool('fabric_data_assets_generate').execute(
        {
          kind: 'lang_entry',
          langKey: 'block.examplemod.ruby_block',
          langValue: 'Ruby Block',
          write: true,
          overwrite: true
        },
        CTX
      )
      expect(w2.ok).toBe(true)
      const doc = JSON.parse(readFileSync(langPath, 'utf-8')) as Record<string, string>
      expect(doc['item.examplemod.ruby']).toBe('Ruby')
      expect(doc['block.examplemod.ruby_block']).toBe('Ruby Block')
    })

    it('blockstate 落盘', async () => {
      const w = await tool('fabric_data_assets_generate').execute(
        { kind: 'blockstate', name: 'ruby_block', write: true },
        CTX
      )
      expect(w.ok).toBe(true)
      const p = join(root, 'src/main/resources/assets/examplemod/blockstates/ruby_block.json')
      expect(JSON.parse(readFileSync(p, 'utf-8')).variants[''].model).toBe('examplemod:block/ruby_block')
    })
  })
})
