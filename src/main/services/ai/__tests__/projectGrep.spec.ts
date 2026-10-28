/**
 * project_grep 工具测试：有界扫描、跳过目录、glob、截断、根逃逸防护，
 * 以及 ToolRegistry 的门控（无项目不暴露）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { globToRegExp, searchProjectCode, isIgnoredByUser, parseKunyuIgnore } from '../projectGrep'
import { listProjectFiles } from '../fcTools/ideTools'
import { createToolRegistry } from '../toolRegistry'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-grep-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(rel: string, content: string): void {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf-8')
}

describe('globToRegExp', () => {
  it('* 与 ? 通配匹配', () => {
    expect(globToRegExp('*.java').test('Main.java')).toBe(true)
    expect(globToRegExp('*.java').test('Main.txt')).toBe(false)
    expect(globToRegExp('Mod?Blocks.java').test('ModXBlocks.java')).toBe(true)
  })
})

describe('searchProjectCode', () => {
  beforeEach(() => {
    write('src/main/java/com/demo/ModBlocks.java', 'Registry.register(Blocks.RUBY_ORE);\n// nothing\n')
    write('build.gradle', 'dependencies {}\n')
    write('build/tmp/Generated.java', 'Registry.register(SHOULD_BE_SKIPPED);\n')
    write('.kunyu/content/blocks/x.json', '{"kind":"block"}\n')
    write('notes.md', '# 说明 Registry 用法\n')
  })

  it('命中用户源码并给出 相对路径:行号:文本', () => {
    const res = searchProjectCode(root, { pattern: 'Registry\\.register' })
    expect(res.ok).toBe(true)
    const files = res.hits.map((h) => h.file)
    expect(files).toContain('src/main/java/com/demo/ModBlocks.java')
    const javaHit = res.hits.find((h) => h.file.endsWith('ModBlocks.java'))
    expect(javaHit?.line).toBe(1)
    expect(javaHit?.text).toContain('RUBY_ORE')
  })

  it('跳过 build/ 与 .kunyu/ 目录', () => {
    const res = searchProjectCode(root, { pattern: 'SHOULD_BE_SKIPPED|"kind":"block"' })
    expect(res.hits).toHaveLength(0)
  })

  it('glob 仅检索 gradle 文件', () => {
    const res = searchProjectCode(root, { pattern: 'dependencies', glob: '*.gradle' })
    expect(res.hits).toHaveLength(1)
    expect(res.hits[0].file).toBe('build.gradle')
  })

  it('ignoreCase 生效', () => {
    const sensitive = searchProjectCode(root, { pattern: 'registry\\.register' })
    expect(sensitive.hits).toHaveLength(0)
    const insensitive = searchProjectCode(root, { pattern: 'registry\\.register', ignoreCase: true })
    expect(insensitive.hits.length).toBeGreaterThan(0)
  })

  it('maxResults 截断并置 truncated', () => {
    write('a.java', 'x\nx\nx\n')
    const res = searchProjectCode(root, { pattern: 'x', glob: 'a.java', maxResults: 2 })
    expect(res.hits).toHaveLength(2)
    expect(res.truncated).toBe(true)
  })

  it('非法正则与空 pattern 返回 ok:false', () => {
    expect(searchProjectCode(root, { pattern: '(' }).ok).toBe(false)
    expect(searchProjectCode(root, { pattern: '  ' }).ok).toBe(false)
  })

  it('根不存在返回错误', () => {
    expect(searchProjectCode(join(root, 'nope'), { pattern: 'x' }).ok).toBe(false)
  })
})

describe('.kunyuignore 用户自定义排除', () => {
  it('无 ignore 文件时零规则、零命中影响', () => {
    const ig = parseKunyuIgnore(root)
    expect(ig.plainNames.size).toBe(0)
    expect(isIgnoredByUser(ig, 'src/Main.java')).toBe(false)
  })

  it('目录段规则排除子树；注释与空行跳过', () => {
    write('.kunyuignore', '# 注释\n\ngenerated/\nassets/sounds\n')
    write('src/generated/Gen.java', 'Registry.register(GEN);\n')
    write('assets/sounds/x.json', '{"Registry.register": 1}\n')
    write('src/main/Keep.java', 'Registry.register(KEEP);\n')
    const res = searchProjectCode(root, { pattern: 'Registry\\.register' })
    const files = res.hits.map((h) => h.file)
    expect(files).toContain('src/main/Keep.java')
    expect(files.some((f) => f.includes('generated'))).toBe(false)
    expect(files.some((f) => f.startsWith('assets/sounds'))).toBe(false)
  })

  it('文件名 glob 规则排除匹配文件', () => {
    write('.kunyuignore', '*.min.js\ncache_*.json\n')
    write('app.min.js', 'register(\n')
    write('cache_data.json', 'register(\n')
    write('main.java', 'register(\n')
    const res = searchProjectCode(root, { pattern: 'register' })
    const files = res.hits.map((h) => h.file)
    expect(files).toContain('main.java')
    expect(files.some((f) => f.endsWith('.min.js'))).toBe(false)
    expect(files.some((f) => f.startsWith('cache_'))).toBe(false)
  })

  it('list_files 同样遵守 ignore 规则', () => {
    write('.kunyuignore', 'secrets\n')
    write('secrets/key.properties', 'x=1\n')
    write('src/Ok.java', 'x\n')
    const res = listProjectFiles(root, { dir: '.' })
    expect(res.ok).toBe(true)
    expect(res.entries.some((e) => e.startsWith('secrets'))).toBe(false)
    expect(res.entries).toContain('src/Ok.java')
  })
})

describe('project_grep 工具门控', () => {
  it('无项目根不暴露；注入后暴露', () => {
    expect(
      createToolRegistry().getToolDefinitions().map((d) => d.function.name)
    ).not.toContain('project_grep')
    expect(
      createToolRegistry({ projectRoot: () => root })
        .getToolDefinitions()
        .map((d) => d.function.name)
    ).toContain('project_grep')
  })

  it('端到端：经注册表执行返回命中文本', async () => {
    write('src/A.java', 'class A { int ruby; }\n')
    const registry = createToolRegistry({ projectRoot: () => root })
    const r = await registry.executeTool(
      'project_grep',
      { pattern: 'ruby', glob: '*.java' },
      { loader: 'fabric', mcVersion: '1.20.1' }
    )
    expect(r.ok).toBe(true)
    expect(r.text).toContain('src/A.java:1')
  })
})
