/**
 * M3a：cueContextService 单测
 *
 * 覆盖：三源检索、预算截断、缓存、来源标注、降级容错
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectCueContext } from '../cueContextService'

// ── mock 依赖 ─────────────────────────────────────────────────────────────────

vi.mock('../../projectService', () => ({
  openProject: vi.fn()
}))

vi.mock('../kbRagSingleton', () => ({
  isKbRagReady: vi.fn(),
  getKbRag: vi.fn()
}))

vi.mock('../referencePackageService', () => ({
  getReferenceService: vi.fn()
}))

vi.mock('../contextBuilder', () => ({
  createContextBuilder: vi.fn(),
  detectContentTypes: vi.fn()
}))

import { openProject } from '../../projectService'
import { isKbRagReady, getKbRag } from '../kbRagSingleton'
import { getReferenceService } from '../referencePackageService'
import { createContextBuilder, detectContentTypes } from '../contextBuilder'

const mockedOpenProject = vi.mocked(openProject)
const mockedIsKbRagReady = vi.mocked(isKbRagReady)
const mockedGetKbRag = vi.mocked(getKbRag)
const mockedGetReferenceService = vi.mocked(getReferenceService)
const mockedCreateContextBuilder = vi.mocked(createContextBuilder)
const mockedDetectContentTypes = vi.mocked(detectContentTypes)

// ── 夹具 ─────────────────────────────────────────────────────────────────────

let fixtureRoot: string

function makeJavaFile(name: string, content: string): void {
  const dir = join(fixtureRoot, 'src', 'main', 'java', 'com', 'example')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), content, 'utf8')
}

function makeJsonFile(name: string, content: string): void {
  const dir = join(fixtureRoot, 'src', 'main', 'resources')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), content, 'utf8')
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'cue-ctx-'))
  vi.clearAllMocks()

  // 默认：KB 未就绪、模板未加载（三源中仅 grep 可能命中）
  mockedIsKbRagReady.mockReturnValue(false)
  mockedGetKbRag.mockResolvedValue(null)
  mockedGetReferenceService.mockReturnValue({ isLoaded: () => false } as never)
  mockedCreateContextBuilder.mockReturnValue({ getTemplateContents: () => [] } as never)
  mockedDetectContentTypes.mockReturnValue([])
})

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true })
})

// ── 主测试 ────────────────────────────────────────────────────────────────────

describe('collectCueContext', () => {
  it('无项目时返回空', async () => {
    mockedOpenProject.mockReturnValue(undefined)
    const result = await collectCueContext({
      projectId: 'nonexistent',
      relPath: 'src/main/java/Foo.java',
      language: 'java',
      query: 'RegistryObject',
      maxChars: 3000,
      sources: { grep: true, kb: true, templates: true }
    })
    expect(result.text).toBe('')
    expect(result.sources).toEqual([])
  })

  it('grep 命中：返回匹配行并标注来源', async () => {
    makeJavaFile(
      'ModBlocks.java',
      `public class ModBlocks {
    public static final RegistryObject<Block> RUBY_BLOCK = registerBlock("ruby_block", () -> new Block(Behaviour.Properties.of().strength(4.0f)));
    public static final RegistryObject<Block> SAPPHIRE_BLOCK = registerBlock("sapphire_block", () -> new Block(Behaviour.Properties.of().strength(4.0f)));
}`
    )
    makeJsonFile('test.json', '{"ruby_block": "assets/example/textures/block/ruby_block.png"}')

    mockedOpenProject.mockReturnValue({ path: fixtureRoot } as never)

    const result = await collectCueContext({
      projectId: 'test-project',
      relPath: 'src/main/java/com/example/Other.java',
      language: 'java',
      query: 'RegistryObject RUBY_BLOCK',
      maxChars: 3000,
      sources: { grep: true, kb: false, templates: false }
    })

    expect(result.text).not.toBe('')
    expect(result.sources.some((s) => s.kind === 'grep')).toBe(true)
    expect(result.text).toContain('ModBlocks.java')
    expect(result.text).toContain('RUBY_BLOCK')
  })

  it('grep 排除当前文件', async () => {
    makeJavaFile(
      'ModBlocks.java',
      `public class ModBlocks {
    public static final RegistryObject<Block> RUBY_BLOCK = registerBlock("ruby_block");
}`
    )

    mockedOpenProject.mockReturnValue({ path: fixtureRoot } as never)

    const result = await collectCueContext({
      projectId: 'test-project',
      relPath: 'src/main/java/com/example/ModBlocks.java',
      language: 'java',
      query: 'RegistryObject RUBY_BLOCK',
      maxChars: 3000,
      sources: { grep: true, kb: false, templates: false }
    })

    expect(result.text).toBe('')
    expect(result.sources).toEqual([])
  })

  it('KB 未就绪时跳过不报错', async () => {
    mockedIsKbRagReady.mockReturnValue(false)
    mockedOpenProject.mockReturnValue({ path: fixtureRoot } as never)

    const result = await collectCueContext({
      projectId: 'test-project',
      relPath: 'src/main/java/Foo.java',
      language: 'java',
      query: 'RegistryObject',
      maxChars: 3000,
      sources: { grep: false, kb: true, templates: false }
    })

    expect(result.text).toBe('')
    expect(mockedGetKbRag).not.toHaveBeenCalled()
  })

  it('KB 命中时返回块文本并标注来源', async () => {
    mockedIsKbRagReady.mockReturnValue(true)
    mockedGetKbRag.mockResolvedValue({
      search: vi.fn().mockResolvedValue({
        hits: [
          {
            chunk: {
              id: 'kb-1',
              file: '/kb/java/registry.md',
              relPath: 'java/registry.md',
              index: 0,
              text: 'RegistryObject 是 Minecraft Forge 的延迟注册机制，用于在注册表事件触发时注册内容。'
            },
            score: 0.95
          }
        ]
      })
    } as never)
    mockedOpenProject.mockReturnValue({ path: fixtureRoot } as never)

    const result = await collectCueContext({
      projectId: 'test-project',
      relPath: 'src/main/java/Foo.java',
      language: 'java',
      query: 'RegistryObject',
      maxChars: 3000,
      sources: { grep: false, kb: true, templates: false }
    })

    expect(result.text).toContain('RegistryObject')
    expect(result.sources.some((s) => s.kind === 'kb')).toBe(true)
  })

  it('模板命中时返回模板内容并标注来源', async () => {
    mockedDetectContentTypes.mockReturnValue(['block'])
    mockedGetReferenceService.mockReturnValue({ isLoaded: () => true } as never)
    mockedCreateContextBuilder.mockReturnValue({
      getTemplateContents: vi.fn().mockReturnValue([
        {
          id: 'block-template',
          type: 'block',
          file: 'BlockTemplate.java',
          content: 'public class BlockTemplate { /* template */ }',
          provenance: 'test',
          build: 'test'
        }
      ])
    } as never)
    mockedOpenProject.mockReturnValue({
      path: fixtureRoot,
      loader: 'fabric',
      mcVersion: '1.20.1'
    } as never)

    const result = await collectCueContext({
      projectId: 'test-project',
      relPath: 'src/main/java/Foo.java',
      language: 'java',
      query: 'block 注册',
      maxChars: 3000,
      sources: { grep: false, kb: false, templates: true }
    })

    expect(result.text).toContain('BlockTemplate')
    expect(result.sources.some((s) => s.kind === 'template')).toBe(true)
  })

  it('预算截断：超限时尾部截断并保留来源头', async () => {
    makeJavaFile(
      'ModBlocks.java',
      `public class ModBlocks {
    public static final RegistryObject<Block> RUBY_BLOCK = registerBlock("ruby_block");
    public static final RegistryObject<Block> SAPPHIRE_BLOCK = registerBlock("sapphire_block");
    public static final RegistryObject<Block> TOPAZ_BLOCK = registerBlock("topaz_block");
    public static final RegistryObject<Block> AMETHYST_BLOCK = registerBlock("amethyst_block");
    public static final RegistryObject<Block> CITRINE_BLOCK = registerBlock("citrine_block");
    public static final RegistryObject<Block> PERIDOT_BLOCK = registerBlock("peridot_block");
}`
    )

    mockedOpenProject.mockReturnValue({ path: fixtureRoot } as never)

    const result = await collectCueContext({
      projectId: 'test-project',
      relPath: 'src/main/java/com/example/Other.java',
      language: 'java',
      query: 'RegistryObject',
      maxChars: 200,
      sources: { grep: true, kb: false, templates: false }
    })

    expect(result.text.length).toBeLessThanOrEqual(200)
    // 来源头必须保留（grep 来源标注）
    expect(result.text).toContain('[grep]')
    expect(result.text).toContain('ModBlocks.java')
  })

  it('query 为空时返回空', async () => {
    mockedOpenProject.mockReturnValue({ path: fixtureRoot } as never)

    const result = await collectCueContext({
      projectId: 'test-project',
      relPath: 'src/main/java/Foo.java',
      language: 'java',
      query: '',
      maxChars: 3000,
      sources: { grep: true, kb: true, templates: true }
    })

    expect(result.text).toBe('')
    expect(result.sources).toEqual([])
  })

  it('三源并行：grep + kb + template 同时命中时全部包含', async () => {
    makeJavaFile(
      'ModBlocks.java',
      `public class ModBlocks {
    public static final RegistryObject<Block> RUBY_BLOCK = registerBlock("ruby_block");
}`
    )

    mockedIsKbRagReady.mockReturnValue(true)
    mockedGetKbRag.mockResolvedValue({
      search: vi.fn().mockResolvedValue({
        hits: [
          {
            chunk: {
              id: 'kb-1',
              file: '/kb/java/registry.md',
              relPath: 'java/registry.md',
              index: 0,
              text: 'RegistryObject 延迟注册机制说明。'
            },
            score: 0.95
          }
        ]
      })
    } as never)
    mockedDetectContentTypes.mockReturnValue(['block'])
    mockedGetReferenceService.mockReturnValue({ isLoaded: () => true } as never)
    mockedCreateContextBuilder.mockReturnValue({
      getTemplateContents: vi.fn().mockReturnValue([
        {
          id: 'block-template',
          type: 'block',
          file: 'BlockTemplate.java',
          content: 'public class BlockTemplate { }',
          provenance: 'test',
          build: 'test'
        }
      ])
    } as never)
    mockedOpenProject.mockReturnValue({
      path: fixtureRoot,
      loader: 'fabric',
      mcVersion: '1.20.1'
    } as never)

    const result = await collectCueContext({
      projectId: 'test-project',
      relPath: 'src/main/java/com/example/Other.java',
      language: 'java',
      query: 'RegistryObject block',
      maxChars: 3000,
      sources: { grep: true, kb: true, templates: true }
    })

    expect(result.sources.some((s) => s.kind === 'grep')).toBe(true)
    expect(result.sources.some((s) => s.kind === 'kb')).toBe(true)
    expect(result.sources.some((s) => s.kind === 'template')).toBe(true)
  })

  it('来源标注格式：[kind] ref', async () => {
    makeJavaFile(
      'ModBlocks.java',
      `public class ModBlocks {
    public static final RegistryObject<Block> RUBY_BLOCK = registerBlock("ruby_block");
}`
    )

    mockedOpenProject.mockReturnValue({ path: fixtureRoot } as never)

    const result = await collectCueContext({
      projectId: 'test-project',
      relPath: 'src/main/java/com/example/Other.java',
      language: 'java',
      query: 'RegistryObject',
      maxChars: 3000,
      sources: { grep: true, kb: false, templates: false }
    })

    expect(result.text).toMatch(/\/\/ \[grep\] .+:\d+/)
  })
})
